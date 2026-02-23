# Slack 通道集成 — 技术规格附录

> 关联文档：[PRD 主文档](./slack-prd.md) · [用户故事](./user-stories.md)

---

## 1. Slack 入口契约

### 1.1 事件→消息模型映射

| Slack 事件                              | NanoClaw 动作                    | 幂等键                              |
| --------------------------------------- | -------------------------------- | ----------------------------------- |
| `message`（无 subtype）                 | → `onMessage()`                  | `event.client_msg_id` 或 `event.ts` |
| `app_mention`                           | → `onMessage()`（翻译 @mention） | `event.client_msg_id` 或 `event.ts` |
| `message`（subtype: `bot_message`）     | 忽略                             | —                                   |
| `message`（subtype: `message_changed`） | 忽略                             | —                                   |
| `message`（subtype: `message_deleted`） | 忽略                             | —                                   |
| `message`（subtype: `channel_join`）    | 忽略                             | —                                   |
| `message`（subtype: `channel_leave`）   | 忽略                             | —                                   |
| `tokens_revoked`                        | → 安全断连                       | —                                   |
| `app_uninstalled`                       | → 安全断连                       | —                                   |

### 1.2 幂等处理规则

- 主要去重：内存 TTL Map（`channel:ts` 键，5 分钟 TTL），单进程架构下无需分布式锁
- 辅助字段：`client_msg_id`（存在时优先使用，不存在时回退到 `ts`）
- SQLite 层：消息 ID 唯一约束提供持久化去重保障
- Socket Mode 下 Slack 可能因 ack 超时重发相同 `envelope_id` 的事件（参见 slack-edge-cases.md §9.1）
- 进程重启时内存 TTL Map 清空，SQLite 消息 ID 唯一约束防止重复写入，轮询游标从上次处理位置恢复

### 1.3 忽略事件清单

所有带 `subtype` 的 `message` 事件一律忽略，包括但不限于：

- `message_changed` — 消息编辑（含 URL unfurl 触发）
- `message_deleted` — 消息删除
- `bot_message` — Bot 发送的消息
- `channel_join` — 用户加入频道
- `channel_leave` — 用户离开频道
- `channel_topic` — 频道主题变更
- `channel_purpose` — 频道描述变更
- `file_share` — 文件分享

仅处理无 subtype 的纯文本消息和 `app_mention` 事件。

### 1.4 过滤代码模式

```typescript
// 入站消息过滤（伪代码）
app.event('message', async ({ event }) => {
  // 1. 过滤所有带 subtype 的消息
  if ('subtype' in event && event.subtype) return;
  // 2. Bot 过滤（可配置）
  if (SLACK_FILTER_BOT_MESSAGES) {
    // 默认：过滤所有 bot 消息（subtype 已在步骤 1 过滤 bot_message）
    if (event.user === this.botUserId) return;
  } else {
    // 仅过滤自身消息
    if (event.user === this.botUserId) return;
  }

  // 3. 内存 TTL Map 去重
  const dedupKey = `${event.channel}:${event.ts}`;
  if (this.seenMessages.has(dedupKey)) return;
  this.seenMessages.set(dedupKey, Date.now()); // 5 分钟 TTL 自动清理

  // 4. 构造 JID 并通过 onMessage 写入 SQLite
  const slackJid = `slack:${event.channel}`;
  // ... onChatMetadata + onMessage → storeMessage [SQLite] → 轮询循环处理
});
```

### 1.5 DM 排除语义

"DM 排除"指路由排序逻辑中的行为：`findChannel()` 通过 `ownsJid()` 匹配时，DM（`slack:D{id}`）与频道（`slack:C{id}`/`slack:G{id}`）使用相同路由路径，但在 `router.ts` 的排序测试中，DM 不参与频道排序逻辑（DM 为独立群组，不与频道混排）。

---

## 2. Token Scope 规格

### 2.1 Token 类型

| Token 类型      | 前缀    | 用途                           | 必需 |
| --------------- | ------- | ------------------------------ | ---- |
| Bot Token       | `xoxb-` | Web API 调用（发消息、查用户） | 是   |
| App-Level Token | `xapp-` | Socket Mode 连接               | 是   |
| Signing Secret  | —       | 请求签名验证                   | 否（仅 HTTP 模式需要，Socket Mode 不使用） |

### 2.2 最小 Bot OAuth Scopes

**MVP 必需**：

| Scope               | 用途             |
| ------------------- | ---------------- |
| `app_mentions:read` | 接收 @提及事件   |
| `channels:history`  | 读取公共频道消息 |
| `channels:read`     | 读取频道元数据   |
| `chat:write`        | 发送消息         |
| `im:history`        | 读取 DM 消息     |
| `im:read`           | 读取 DM 元数据   |

**可选（私有频道支持）**：

| Scope            | 用途               |
| ---------------- | ------------------ |
| `groups:history` | 读取私有频道消息   |
| `groups:read`    | 读取私有频道元数据 |

**可选（增强功能）**：

| Scope        | 用途                             |
| ------------ | -------------------------------- |
| `im:write`   | 打开 DM 通道                     |
| `users:read` | 查询用户信息（sender_name 填充） |

### 2.3 App-Level Token Scope

| Scope               | 用途                 |
| ------------------- | -------------------- |
| `connections:write` | Socket Mode 连接必需 |

### 2.4 事件订阅

```yaml
settings:
  socket_mode_enabled: true
  event_subscriptions:
    bot_events:
      - app_mention # @Bot 提及
      - message.channels # 公共频道消息
      - message.im # DM 消息
      - message.groups # 私有频道消息（可选）
```

### 2.5 Token 守卫

启动时必须验证：

```typescript
// Token-presence 激活（与 Telegram 对称）
if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  // 两个必需 Token 齐全 → 创建 SlackChannel
} else if (SLACK_BOT_TOKEN || SLACK_APP_TOKEN) {
  logger.warn('Slack tokens incomplete (need both BOT_TOKEN and APP_TOKEN) — skipping Slack channel');
}
// SLACK_ONLY 守卫
if (SLACK_ONLY && (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN)) {
  logger.error('SLACK_ONLY is true but missing required Slack tokens — cannot start');
  process.exit(1);
}
```
> **注意**：`SLACK_ONLY=true` 时必须显式跳过 WhatsApp `connect()`。WhatsApp 通道在无认证时会尝试 QR 码流程，不会静默跳过。

### 2.6 可配置 Bot 过滤

| 环境变量 | 默认值 | 行为 |
|---|---|---|
| `SLACK_FILTER_BOT_MESSAGES=true` | 是（默认） | 过滤所有 bot 消息：subtype 过滤 + botUserId 过滤 |
| `SLACK_FILTER_BOT_MESSAGES=false` | — | 仅过滤自身消息（event.user === botUserId），允许其他 bot 消息触发 Agent |

**使用场景**：当用户需要 NanoClaw Agent 响应其他 Slack bot 的消息时（如 CI/CD 通知 bot），设置 `SLACK_FILTER_BOT_MESSAGES=false`。

**安全保障**：无论此设置如何，Bot 自身消息（`event.user === botUserId`）始终被过滤，防止自循环。

> **安全降级**：若 `auth.test()` 失败导致 `botUserId` 为空，无论 `SLACK_FILTER_BOT_MESSAGES` 设置如何，均强制过滤所有 bot 消息（`subtype` 过滤），并禁用 @mention 翻译。记录 error 级别日志。

---

## 3. Slack API 速率限制

### 3.1 方法级限制

| API 方法                     | 限制          | 影响场景                     |
| ---------------------------- | ------------- | ---------------------------- |
| `chat.postMessage`           | ~1 次/秒/频道 | 高频状态更新、多用户同时触发 |
| `chat.update`                | ~1 次/秒/频道 | 状态消息实时更新             |
| `reactions.add`              | ~20+ 次/分钟  | 表情状态反馈                 |
| `users.info`                 | ~100+ 次/分钟 | 用户信息查询                 |
| `files.getUploadURLExternal` | 较低          | 文件上传                     |

### 3.1.1 NanoClaw 限流预算

MVP 阶段仅使用 `chat.postMessage`，预算策略：
- **频道级**：遵循 Slack 官方 ~1 次/秒/频道限制
- **全局级**：依赖 `GroupQueue` 并发控制（默认 MAX_CONCURRENT_CONTAINERS=5）天然限流
- **429 回退**：读取 `Retry-After` 头；头缺失时默认等待 1 秒
- **不实现**：主动令牌桶或滑动窗口（YAGNI — NanoClaw 架构天然低频，Slack 路径经 GroupQueue 并发控制）

### 3.2 限流处理策略

```
请求发送
  ↓
响应状态码检查
  ├── 200 OK → 成功
  ├── 429 Too Many Requests
  │     ├── 读取 Retry-After 头
  │     ├── 等待指定秒数
  │     └── 重试（最多 3 次，超过后终态失败）
  ├── 5xx Server Error
  │     ├── 重试 1: 等待 1s + jitter
  │     ├── 重试 2: 等待 2s + jitter
  │     ├── 重试 3: 等待 4s + jitter
  │     └── 终态失败 → 记录日志
  └── 网络错误
        └── 记录日志，交给 Bolt 重连
```

### 3.3 NanoClaw 架构优势

NanoClaw 的架构天然降低了速率限制风险：

- **WhatsApp 路径**：消息经 SQLite 缓冲 + 轮询，天然低频
- **Slack 路径**：事件经 Socket Mode 实时接收，通过 onMessage 写入 SQLite，由轮询循环统一处理，经 GroupQueue 并发控制（默认 MAX_CONCURRENT_CONTAINERS=5），出站频率受限
- Agent 处理时间通常 >2s，天然降低出站频率
- 不实现实时状态更新（`chat.update`），避免最常见的限流触发

---

## 4. 边界情况优先级矩阵

### 4.1 P0 — 金丝雀前必须实现

| 边界情况           | 来源             | 风险等级 | 路线图任务 | 说明                                           |
| ------------------ | ---------------- | -------- | ---------- | ---------------------------------------------- |
| Bot 消息自循环     | §1.2, §6.3       | 高       | T7         | 无限循环风险，必须在集成阶段解决               |
| 消息子类型重复处理 | §6.4, §9.5       | 高       | T7         | URL unfurl 触发 `message_changed` 导致重复响应 |
| 事件重复投递       | §4.5, §9.1, §9.7 | 高       | T7         | Socket Mode ack 超时重发 + 平台级重复          |
| Slack 429 限流     | §2.2             | 高       | T8         | `chat.postMessage` 1次/秒/频道限制             |
| 5xx 服务端错误     | §3.2             | 中       | T8         | 需有界重试避免消息丢失                         |
| Token 撤销/卸载    | §5.4             | 高       | T9         | 未处理会导致僵尸进程                           |

### 4.2 P1 — 应实现，可在后续波次

| 边界情况                   | 来源 | 风险等级 | 路线图任务 | 说明                                  |
| -------------------------- | ---- | -------- | ---------- | ------------------------------------- |
| Socket 静默失联            | §9.3 | 高       | T9         | 进程存活但不处理事件                  |
| WebSocket pong 超时        | §9.9 | 中       | T9         | 重连后事件洪峰需幂等处理              |
| `too_many_websockets` 崩溃 | §9.2 | 中       | T9         | 旧进程未退出时连接数耗尽              |
| 队列满/排队超时            | §1.1 | 中       | 延后       | NanoClaw `group-queue` 已有并发控制   |
| 有状态正则表达式           | §9.6 | 低       | T7         | 确保 Bolt 注册的正则无 `/g` `/y` 标志 |

### 4.3 P2 — 延后至未来阶段

| 边界情况                         | 来源  | 风险等级 | 路线图任务 | 说明                          |
| -------------------------------- | ----- | -------- | ---------- | ----------------------------- |
| 交互模式                         | §1.3  | 低       | 延后       | 本阶段不实现                  |
| mrkdwn 格式转换                  | §4.2  | 低       | 延后       | 直接发送，不转换              |
| 文件上传                         | §4.4  | 低       | 延后       | 使用占位符文本                |
| 线程级上下文隔离                 | §6.2  | 中       | 延后       | 频道级对话，非线程级          |
| Slack Connect 外部用户           | §4.6  | 低       | 延后       | 初始版本不响应                |
| `assistant.userMessage` 无限循环 | §9.8  | 低       | 延后       | NanoClaw 不使用 Assistant API |
| HTTP 模式重试头                  | §9.10 | 低       | 延后       | NanoClaw 使用 Socket Mode     |

---

## 5. 硬规范合规映射（R1-R15）

| 规范 | 描述                             | 覆盖任务       | 状态                      |
| ---- | -------------------------------- | -------------- | ------------------------- |
| R1   | Channel 接口合规                 | T4             | 技能包已实现              |
| R2   | JID 命名空间（`slack:` 前缀）    | T4, T6         | 技能包已实现              |
| R3   | 构造函数签名                     | T4             | 技能包已实现              |
| R4   | `connect()` 模式                 | T4, T5         | 技能包已实现              |
| R5   | `sendMessage()` 规范（40k 分片） | T4, T8         | 基础已实现，T8 加固       |
| R6   | Bot 消息过滤                     | T7             | 需加固（全 subtype 过滤） |
| R7   | `onMessage` 回调数据             | T4             | 技能包已实现              |
| R8   | `onChatMetadata` 回调            | T4             | 技能包已实现              |
| R9   | `setTyping` 空实现               | T4             | 技能包已实现              |
| R10  | 环境变量                         | T4             | 技能包已实现              |
| R11  | 技能包结构                       | T1, T2         | 已就绪                    |
| R12  | `modify/` 合并目标               | T4, T5, T6     | 需三方合并                |
| R13  | 秘钥隔离                         | T4             | 遵循现有模式              |
| R14  | 测试规范                         | T4, T6, T7, T8 | 持续覆盖                  |
| R15  | @提及翻译                        | T4             | 技能包已实现              |

---

## 6. Socket Mode 连接生命周期

### 6.1 正常生命周期

```
app.start()
  → apps.connections.open (使用 xapp- token)
  → 获取 WSS URL
  → 建立 WebSocket 连接
  → connected = true
  → 接收事件 → ack → 处理
  → ...
  → app.stop()
  → WebSocket 关闭
  → connected = false
```

### 6.2 断连恢复

```
WebSocket 断开
  → Bolt 内置重连（自动）
  → 重新调用 apps.connections.open
  → 建立新 WebSocket
  → 恢复事件处理
```

### 6.3 看门狗检测

```
每 60 秒检查:
  lastEventTimestamp = 最后一次事件时间
  if (now - lastEventTimestamp > 3 分钟):
    logger.warn('Socket stale, triggering reconnect')
    app.stop() → app.start()
```

### 6.4 Token 撤销

```
tokens_revoked 事件
  → logger.warn('Token revoked, disconnecting')
  → connected = false
  → app.stop()
  → 不影响其他通道
```

### 6.5 可观测性字段规范

金丝雀/回滚判定依赖以下结构化日志字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `event` | string | 事件类型：`socket_reconnect` / `socket_stale` / `token_revoked` / `retry_429` / `retry_5xx` / `retry_exhausted` |
| `last_event_ts` | number | 最后收到事件的 Unix 时间戳 |
| `reconnect_attempt` | number | 当前重连尝试次数 |
| `duration_ms` | number | 操作耗时（重连/重试） |
| `retry_after_s` | number | 429 响应的 Retry-After 值（秒） |
| `status_code` | number | HTTP 响应状态码（429/5xx） |

---

## 7. 与现有通道的对比

| 维度         | WhatsApp                    | Telegram         | Slack                   |
| ------------ | --------------------------- | ---------------- | ----------------------- |
| SDK          | `@whiskeysockets/baileys`   | `grammy`         | `@slack/bolt@^4.4.0`    |
| 连接模式     | WebSocket                   | 长轮询           | Socket Mode (WebSocket) |
| Token 数量   | 0（QR 认证）                | 1                | 2（Bot + App）          |
| JID 前缀     | `@g.us` / `@s.whatsapp.net` | `tg:`            | `slack:`                |
| 消息长度限制 | 无硬限制                    | 4,096 字符       | 40,000 字符             |
| 打字指示器   | `sendPresenceUpdate`        | `sendChatAction` | 不支持（空实现）        |
| @提及格式    | N/A                         | `@bot_username`  | `<@BOTID>`              |
| 频道类型区分 | `@g.us` / `@s.whatsapp.net` | 正/负 chatId     | `C`/`G`/`D` 前缀        |
| 启用方式     | 默认                        | `TELEGRAM_BOT_TOKEN` 存在  | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` 同时存在 |
| 仅此通道     | N/A                         | `TELEGRAM_ONLY`  | `SLACK_ONLY`            |
| Bot 消息检测 | `fromMe` / 名称前缀         | `from.is_bot`    | `subtype` + `botUserId` |
| 重连机制     | 内置 + 5s 回退              | 内置             | Bolt 内置 + 看门狗      |

---

## 8. 文件变更清单

### 8.1 新增文件（`add/`）

| 文件                         | 用途                |
| ---------------------------- | ------------------- |
| `src/channels/slack.ts`      | SlackChannel 类实现 |
| `src/channels/slack.test.ts` | 单元测试            |

### 8.2 修改文件（`modify/`）

| 文件                  | 变更内容                                      |
| --------------------- | --------------------------------------------- |
| `src/index.ts`        | `channels[]` 数组 + 条件创建 + 多通道生命周期 |
| `src/config.ts`       | `SLACK_*` 环境变量导出                        |
| `src/routing.test.ts` | Slack JID 兼容测试                            |

### 8.3 配置文件

| 文件           | 变更内容                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| `package.json` | 添加 `@slack/bolt@^4.4.0` 依赖                                                  |
| `.env.example` | 添加 `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_ONLY`、`SLACK_FILTER_BOT_MESSAGES` |

### 8.4 不修改的文件

| 文件                      | 原因                                      |
| ------------------------- | ----------------------------------------- |
| `src/types.ts`            | `Channel` 接口已满足需求                  |
| `src/router.ts`           | `findChannel()` 通过 `ownsJid()` 自动路由 |
| `src/db.ts`               | SQLite 操作已通用，Slack 消息通过现有 `storeMessage()` 写入，无需修改 |
| `src/ipc.ts`              | IPC 通过 `findChannel()` 自动支持         |
| `src/container-runner.ts` | 容器运行与通道无关                        |

---

## 9. 依赖清单

### 9.1 运行时依赖

| 包            | 版本     | 用途                               |
| ------------- | -------- | ---------------------------------- |
| `@slack/bolt` | `^4.4.0` | Slack SDK（Socket Mode + Web API） |

### 9.2 无新增开发依赖

测试使用现有 vitest 框架，mock `@slack/bolt`。

### 9.3 系统依赖

- Node.js 20+（已有）
- 网络出站连接（WebSocket 到 Slack 服务器）
- 无需公网 IP、无需 ngrok、无需 TLS 证书
