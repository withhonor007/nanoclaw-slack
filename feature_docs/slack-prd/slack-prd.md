# Slack 通道集成 — 产品需求文档 (PRD)

> 版本：1.1  
> 日期：2026-02-23  
> 状态：草案  
> 关联文档：[用户故事](./user-stories.md) · [技术规格附录](./technical-specs.md)

---

## 1. 执行摘要

### 1.1 问题陈述

NanoClaw 当前仅支持 WhatsApp 作为消息通道。部分用户的主要工作沟通工具为 Slack，无法在 Slack 中直接与 Claude Agent 交互，需要切换到 WhatsApp 才能使用 NanoClaw 的全部能力（定时任务、容器隔离 Agent、持久记忆等）。

### 1.2 解决方案

以现有 `.claude/skills/add-slack/` 技能包为基线，将 Slack 作为 NanoClaw 的消息通道集成。采用 `@slack/bolt` Socket Mode 实现，保持 NanoClaw 单进程的核心架构不变。Slack 采用与 Telegram 相同的 SQLite+轮询路径（`onMessage → storeMessage → 轮询循环 → GroupQueue → 容器`），保持单一消息管道的可靠性。直接分发路径（内存去重+内存缓冲→GroupQueue）作为 v1.1 性能优化延后。
 **并行模式**：Slack 与 WhatsApp 同时运行（两个 Slack Token 已配置 + WhatsApp 已配置）
 **仅 Slack**：仅启用 Slack（`SLACK_ONLY=true`，跳过 WhatsApp 通道创建）

### 1.3 成功标准

| KPI            | 目标值                                        | 度量方式                 |
| -------------- | --------------------------------------------- | ------------------------ |
| 消息处理可靠性 | 幂等保证：内存 TTL Map（`channel:ts` 键，5 分钟 TTL）+ SQLite 消息 ID 唯一约束 + `botUserId` 过滤，确保同一消息不触发 ≥2 次 Agent 调用 | 测试覆盖 + 金丝雀期间监控 |
| 入站消息幂等   | 处理 ≥50 条消息，内存 TTL Map 去重无重复且无重复 Agent 调用 | 测试覆盖 + 金丝雀观察 |
| 限流恢复       | 429 响应后按 `Retry-After` 成功重试           | 测试覆盖 + 金丝雀观察    |
| 连接稳定性     | 连续运行 ≥24 小时无未捕获异常                 | 金丝雀期间日志监控       |
| Socket 恢复    | 看门狗 3 分钟检测陈旧 + 2 分钟恢复窗口（总计 ≤5 分钟） | 看门狗检测 + 金丝雀观察  |
| 构建健康       | `npm test && npm run build` 零错误            | CI 门控                  |

---

## 2. 用户体验与功能

### 2.1 用户画像

| 画像                 | 描述                                                                | 核心需求                                                 |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| **个人用户（主要）** | 使用 Slack 作为日常工作沟通工具的开发者/知识工作者，已部署 NanoClaw | 在 Slack 中直接与 Claude Agent 交互，无需切换到 WhatsApp |
| **纯 Slack 用户**    | 不使用 WhatsApp 的用户，希望完全替换 WhatsApp 通道                  | 仅通过 Slack 使用 NanoClaw 全部功能                      |
| **多通道用户**       | 同时使用 WhatsApp 和 Slack 的用户                                   | 两个通道并行运行，各自独立的群组和上下文                 |

### 2.2 用户故事概览

完整用户故事及验收标准详见 [user-stories.md](./user-stories.md)。核心故事：

| ID    | 故事                                                                                       | 优先级 |
| ----- | ------------------------------------------------------------------------------------------ | ------ |
| US-1  | 作为 NanoClaw 用户，我希望通过 `/add-slack` 技能安装 Slack 通道，以便在 Slack 中使用 Agent | P0     |
| US-2  | 作为用户，我希望注册 Slack 频道/DM 为受管通道，以便 Agent 能响应该频道的消息               | P0     |
| US-3  | 作为 Slack 频道成员，我希望通过 @mention Bot 触发 Agent 回复                               | P0     |
| US-4  | 作为用户，我希望配置 Slack Token 后自动启用 Slack 通道                                          | P0     |
| US-5  | 作为用户，我希望在 DM 中直接与 Bot 对话，无需 @mention                                     | P1     |
| US-6  | 作为用户，我希望 Bot 能正确处理 Slack 限流（429），不丢失消息                              | P0     |
| US-7  | 作为用户，我希望 Bot 在 Socket 断连后自动恢复，不需要手动重启                              | P0     |
| US-8  | 作为用户，我希望定时任务能通过 Slack 通道发送消息                                          | P1     |
| US-9  | 作为用户，我希望 Token 被撤销时 Bot 能优雅断连而非崩溃                                     | P0     |
| US-10 | 作为运维者，我希望有条件金丝雀发布协议和回滚手册                                           | P1     |
| US-11 | 作为多通道用户，我希望 WhatsApp 和 Slack 同时运行，各自独立                                | P1     |
| US-12 | 作为系统，我需要防止 Bot 自身消息触发无限循环                                              | P0     |
| US-13 | 作为系统，我需要将超过 40,000 字符的消息自动分片发送                                       | P1     |
| US-14 | 作为系统，我需要将 Slack @mention 翻译为 NanoClaw 触发词                                   | P1     |

### 2.3 非目标（本阶段不构建）

| 排除项                         | 原因                                                   |
| ------------------------------ | ------------------------------------------------------ |
| 交互模式（`!open`/`!close`）   | 增加去重复杂度，NanoClaw 使用触发词机制                |
| 线程级上下文隔离               | NanoClaw 核心模型为频道级对话，线程隔离需重大架构变更  |
| 斜杠命令（`/command`）         | 需额外 App Manifest 配置，与触发词机制语义冲突         |
| mrkdwn 格式转换                | 直接发送 Markdown，大部分内容可读，降低复杂度          |
| 文件上传管道                   | 使用占位符文本 `[File: filename]`，安全考虑 + 容器隔离 |
| Slack Connect 外部用户         | 跨组织安全风险，初始版本不响应                         |
| `claudecode-slackbot` 命令框架 | 独立项目架构，不迁移其 MCP 权限流程或工作目录子系统    |

---

## 3. 技术规格

### 3.1 架构概览

#### 统一管道架构

NanoClaw 采用统一消息管道——WhatsApp 和 Slack 均经过 SQLite + 轮询路径：

```
┌─────────────────────────────────────────────────────────────────┐
│                     HOST (Node.js 单进程)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                  ┌────────────────────┐       │
│  │  WhatsApp    │                  │   SQLite Database  │       │
│  │  (baileys)   │  onMessage()     │   (messages.db)    │       │
│  │  WebSocket   │──────────────────▶  storeMessage()    │       │
│  └──────────────┘                  └─────────┬──────────┘       │
│                                              │                   │
│  ┌──────────────┐                            │                   │
│  │  Slack       │  ack → filter/dedup        │                   │
│  │  (bolt)      │  onMessage()               │                   │
│  │  Socket Mode │──────────────────────────▶ │                   │
│  └──────────────┘                            │                   │
│                                    ┌─────────▼──────────┐       │
│                                    │  Message Loop      │       │
│                                    │  (polls SQLite 2s) │       │
│                                    └─────────┬──────────┘       │
│                                              │                   │
│                                              ▼                   │
│                               ┌────────────────────┐            │
│                               │  GroupQueue        │  MAX_CONCURRENT_CONTAINERS=5 │
│                               │  → Container       │            │
│                               └────────┬───────────┘            │
│                                        │                        │
│                                        ▼                        │
│                               ┌────────────────────┐            │
│                               │  channel.send      │  路由到 WhatsApp 或 Slack │
│                               │  Message()         │            │
│                               └────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```
关键设计决策：
- **WhatsApp 和 Slack 共享同一消息管道**（SQLite + 轮询），保持架构简单性和可靠性一致性。Slack 的事件驱动特性通过 Socket Mode 实时接收消息，但消息仍经 `onMessage → storeMessage` 写入 SQLite，由轮询循环统一处理。
- **单进程不变**：Bolt 的 Socket Mode 客户端运行在同一 Node.js 进程中

### 3.2 Channel 接口合规（R1）

`SlackChannel` 必须实现 `src/types.ts` 中的 `Channel` 接口：
```typescript
interface Channel {
  name: string; // 'slack'
  connect(): Promise<void>; // 启动 Socket Mode；auth.test() 失败时降级为安全模式（过滤所有 bot 消息，禁用 @mention 翻译），而非仅记录 warn 日志后继续
  sendMessage(jid: string, text: string): Promise<void>; // 发送消息 + 分片
  isConnected(): boolean; // Socket Mode 连接状态
  ownsJid(jid: string): boolean; // jid.startsWith('slack:')
  disconnect(): Promise<void>; // app.stop()
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // 空实现
}
```

### 3.3 JID 命名空间（R2）
| 通道类型       | JID 格式      | 示例                | ownsJid 判定           |
| -------------- | ------------- | ------------------- | ---------------------- |
| Slack 公共频道 | `slack:C{id}` | `slack:C07ABC123DE` | `startsWith('slack:')` |
| Slack 私有频道 | `slack:G{id}` | `slack:G07ABC123DE` | `startsWith('slack:')` |
| Slack DM       | `slack:D{id}` | `slack:D07ABC123DE` | `startsWith('slack:')` |
### 3.4 消息流

#### 入站流程

```
Slack (Socket Mode WebSocket)
  → app.event('message') / app.event('app_mention')
  → 立即 ack（3 秒内）
  → 过滤: subtype 存在 → 忽略（bot_message, message_changed, message_deleted 等）
  → Bot 过滤（可配置）:
      SLACK_FILTER_BOT_MESSAGES=true（默认）→ 过滤所有 bot 消息（subtype + botUserId）
      SLACK_FILTER_BOT_MESSAGES=false → 仅过滤自身（event.user === botUserId）
  → 幂等检查: 内存 TTL Map（channel:ts 键，5 分钟 TTL）+ SQLite 消息 ID 唯一约束
  → 构造 JID: slack:{channelId}
  → onChatMetadata(slackJid, timestamp, channelName, 'slack', isGroup)
  → 检查 registeredGroups → 已注册则调用 onMessage()
  → storeMessage() [SQLite]
  → 轮询循环 → GroupQueue → 容器
  → runAgent() → 容器内 Agent 处理
  → channel.sendMessage('slack:C...', text)
```

#### 出站流程

```
Agent 输出 / IPC send_message
  → findChannel(channels, 'slack:C...')
  → SlackChannel.sendMessage('slack:C...', text)
  → 剥离 'slack:' 前缀 → channelId
  → text.length > 40000 ? 分片发送 : 单条发送
  → 5xx → 最多 3 次重试 (1s/2s/4s + jitter)
  → app.client.chat.postMessage({ channel: channelId, text })
```

### 3.5 环境变量

| 变量                   | 类型    | 必需 | 说明                                         |
| ---------------------- | ------- | ---- | -------------------------------------------- |
| `SLACK_BOT_TOKEN`      | string  | 是   | Bot OAuth Token（`xoxb-`）                   |
| `SLACK_APP_TOKEN`      | string  | 是   | App-Level Token（`xapp-`），Socket Mode 必需 |
| `SLACK_ONLY`           | boolean | 否   | `true` 时跳过 WhatsApp 通道创建（与 `TELEGRAM_ONLY` 对称）|
| `SLACK_FILTER_BOT_MESSAGES` | boolean | 否   | `true`（默认）过滤所有 bot 消息；`false` 仅过滤自身（botUserId） |
> **激活规则**：当 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN` 同时存在时自动启用 Slack 通道（与 Telegram 的 token-presence 模式对称）。无需额外的 ENABLE 标志。
> **注意**：`SLACK_SIGNING_SECRET` 仅在 HTTP 模式下需要，Socket Mode 不使用，不纳入配置。

### 3.6 MVP 运行模式

- **DM 优先**：所有 `slack:D{id}` DM 默认可注册和响应
- **频道 @mention 触发**：公共/私有频道中仅响应 `<@{botUserId}>` 提及
- **频道白名单**：仅已通过 `registerGroup()` 注册的频道接收处理，未注册频道的消息仅触发 `onChatMetadata()` 用于发现
- **频道发现**：Bot 对未注册频道的 @mention 回复 `slack:{channelId}` 和注册指引（`!chatid` 消息命令，与 Telegram `/chatid` 对称）
- **`SLACK_ONLY=true` 跳过 WhatsApp**：`SLACK_ONLY=true` 时必须显式跳过 WhatsApp `connect()`，不能依赖“不配置 WhatsApp”（WhatsApp 通道在无认证时会尝试 QR 码流程，不会静默跳过）

### 3.7 集成点

| 集成点               | 说明                                              |
| -------------------- | ------------------------------------------------- |
| `src/types.ts`       | `Channel` 接口定义                                |
| `src/index.ts`       | `channels[]` 数组构建 + 多通道生命周期 + Slack onMessage 回调 |
| `src/config.ts`      | Slack 环境变量导出                                |
| `src/router.ts`      | `findChannel()` 路由                              |
| `src/db.ts`          | 消息存储 + registered_groups/sessions/tasks       |
| `src/group-queue.ts` | 并发控制                                          |
| `src/ipc.ts`         | IPC 消息路由（已有，通过 `findChannel` 自动支持） |
| `@slack/bolt`        | 唯一 Slack 依赖                                   |

### 3.8 安全与隐私

| 维度           | 措施                                                        |
| -------------- | ----------------------------------------------------------- |
| Token 存储     | `.env` + `readEnvFile()` 读取，不直接写入 `process.env`     |
| 容器隔离       | Agent 运行在容器中，工具权限由 OS 保证，无需 Slack 按钮审批 |
| 秘钥传递       | 容器内通过 stdin JSON 传递，不作为环境变量或挂载文件        |
| 频道白名单     | 仅 `registeredGroups` 中的频道接收处理                      |
| Bot 自循环防止 | `botUserId` 过滤 + `subtype` 过滤                           |
| Token 生命周期 | 监听 `tokens_revoked` / `app_uninstalled` 事件，优雅断连    |
| Token 守卫     | 启动时校验 `BOT_TOKEN && APP_TOKEN`；仅单个 Token 存在则警告日志；`SLACK_ONLY` 缺 Token 则 fail-fast |

---

## 4. 可靠性加固

### 4.1 入站加固

| 加固项             | 实现方式                                   | 测试覆盖 |
| ------------------ | ------------------------------------------ | -------- |
| 子类型过滤         | 所有带 `subtype` 的 `message` 事件一律忽略 | 是       |
| 事件幂等           | 内存 TTL Map（`channel:ts` 键，5 分钟 TTL）+ SQLite 消息 ID 唯一约束 | 是       |
| 自循环防止         | `event.user === botUserId` 过滤            | 是       |
| URL unfurl 防护    | `message_changed` 子类型被过滤             | 是       |
| 重复 envelope 防护 | 内存 TTL Map + SQLite 唯一约束双重保障     | 是       |
| 可配置 Bot 过滤    | `SLACK_FILTER_BOT_MESSAGES` 环境变量控制过滤策略   | 是       |

### 4.2 出站加固

| 加固项       | 实现方式                              | 测试覆盖 |
| ------------ | ------------------------------------- | -------- |
| 429 限流处理 | 等待 `Retry-After` 头指定的秒数后重试 | 是       |
| 5xx 重试     | 最多 3 次，间隔 1s/2s/4s + jitter     | 是       |
| 消息分片     | 超过 40,000 字符按边界分片            | 是       |
| 网络错误     | 仅记录日志，交给 Bolt 重连路径恢复    | 是       |
| 无界重试防护 | 重试次数有上限，终态失败记录日志      | 是       |

### 4.3 连接加固

| 加固项        | 实现方式                                             |
| ------------- | ---------------------------------------------------- |
| Token 撤销    | 监听 `tokens_revoked` / `app_uninstalled`，优雅断连  |
| Socket 看门狗 | 每 60 秒检查最后事件时间戳，陈旧（>3 分钟）则触发重连 |
| 优雅关闭      | `process.on('SIGTERM')` / `SIGINT` 调用 `app.stop()` |
| 结构化诊断    | 重连事件输出结构化日志，支撑金丝雀观察               |
| 重启恢复      | SQLite 消息持久化，轮询循环重启后自动处理未完成消息 |

---

## 5. 风险与路线图

### 5.1 技术风险

| 风险                                              | 等级 | 缓解措施                                  |
| ------------------------------------------------- | ---- | ----------------------------------------- |
| Socket Mode 静默失联（进程存活但不处理事件）      | 高   | 应用层看门狗检测最后事件时间戳            |
| `too_many_websockets` 导致进程崩溃                | 中   | 优雅关闭 + 升级 `@slack/bolt` ≥ 4.x       |
| URL unfurl 触发 `message_changed` 重复响应        | 高   | 过滤所有带 `subtype` 的消息               |
| Slack 429 限流（`chat.postMessage` 1次/秒/频道）  | 高   | 分层限流 + `Retry-After` 遵循             |
| 技能包合并冲突（`src/index.ts` 已被其他技能修改） | 中   | 三方合并 + rerere 自动解决 + 冲突风险矩阵 |
| WebSocket pong 超时导致事件洪峰                   | 中   | 幂等写入 + 看门狗重连                     |

### 5.2 分阶段路线图

#### Wave 1：基础验证与契约（3 个任务并行）

| 任务 | 内容                              | 类别             |
| ---- | --------------------------------- | ---------------- |
| T1   | Phase-0 基线验证 + 技能引擎引导   | quick            |
| T2   | 运行时差异审计 + 范围锁定         | unspecified-high |
| T3   | 入口契约定稿 + 边界情况优先级矩阵 | writing          |

**Wave 1 DoD**：`npm test && npm run build` 通过；`.nanoclaw/` 已初始化；合并冲突风险矩阵已产出；入口契约已定稿。

#### Wave 2：集成 + 内联加固（5 个任务，T7/T8 为硬性门控）

| 任务 | 内容                                         | 类别             | 门控     |
| ---- | -------------------------------------------- | ---------------- | -------- |
| T4   | 应用技能包 + 合并配置                        | quick            | —        |
| T5   | 合并 index.ts 多通道生命周期                 | unspecified-high | —        |
| T6   | 合并路由测试 + Slack JID 兼容                | quick            | —        |
| T7   | 入站加固：子类型过滤 + 事件幂等 + 自循环防止 | unspecified-high | **GATE** |
| T8   | 出站加固：分层限流 + 429/5xx 重试退避        | deep             | **GATE** |

**Wave 2 DoD**：所有 `subtype` 消息被过滤（测试覆盖）；内存 TTL Map 去重（测试覆盖）；429 `Retry-After` 重试（测试覆盖）；5xx 有界重试（测试覆盖）。**T7+T8 未通过不得进入 Wave 3。**

#### Wave 3：运维与发布（3 个任务）

| 任务 | 内容                             | 类别             |
| ---- | -------------------------------- | ---------------- |
| T9   | Token 生命周期 + Socket 看门狗   | unspecified-high |
| T10  | 运维手册 + 条件金丝雀 + 回滚协议 | writing          |
| T11  | 延后积压清单 + 最终合规审计      | writing          |

**Wave 3 DoD**：Token 生命周期事件处理（测试覆盖）；Socket 看门狗（测试覆盖）；条件金丝雀检查清单已产出；延后积压清单已产出；全部 11 个任务完成。

### 5.3 条件金丝雀退出标准

全部满足方可退出金丝雀：

1. **Socket 重连恢复**：至少经历一次断连→重连→恢复事件处理
2. **限流恢复**：至少经历一次 429 响应→Retry-After 等待→成功重试
3. **消息幂等**：处理 ≥50 条入站消息，零重复响应
4. **稳定运行**：连续运行 ≥24 小时，零未捕获异常
5. **Token 验证**：至少验证一次 token 有效性检查路径

### 5.4 回滚触发条件

任一满足立即回滚：

1. 未捕获异常导致进程崩溃
2. 消息重复响应（同一消息触发 ≥2 次 Agent 调用）
3. Socket 断连后 3 分钟内看门狗未触发重连，或触发后 2 分钟内未恢复
4. 429 限流后重试 3 次仍失败

### 5.5 回滚命令

```bash
git revert <commit-group-hash>
npm run build
systemctl --user restart nanoclaw  # Linux
# 或 launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

### 5.6 提交策略

| 组              | 任务    | 提交消息                                                  |
| --------------- | ------- | --------------------------------------------------------- |
| A（集成核心）   | T4-T6   | `feat(slack): apply baseline channel integration`         |
| B（可靠性加固） | T7-T8   | `fix(slack): harden inbound filtering and outbound retry` |
| C（运维加固）   | T9      | `fix(slack): add token lifecycle and socket watchdog`     |
| D（文档）       | T10-T11 | `docs(slack): add canary protocol and deferred roadmap`   |

---

## 6. 延后积压清单

以下功能明确排除在本阶段范围之外，作为未来迭代的候选项：

| 功能                               | 阶段标签 | 重审触发条件                         |
| ---------------------------------- | -------- | ------------------------------------ |
| 交互模式（`!open`/`!close`）       | v2.0     | 用户反馈需要免触发词对话             |
| 线程级上下文隔离                   | v2.0     | 频道级对话无法满足多话题并行需求     |
| mrkdwn 格式转换                    | v1.1     | 用户反馈 Markdown 渲染问题影响可读性 |
| 文件上传管道                       | v1.1     | 用户需要 Agent 发送文件到 Slack      |
| 斜杠命令                           | v2.0     | 用户需要 Slack 原生命令体验          |
| Slack Connect 外部用户             | v2.0     | 跨组织协作需求                       |
| `users.info` 查询填充 display name | v1.1     | 用户反馈 sender_name 显示为 user ID  |
| 状态消息反馈（"处理中..."）        | v1.1     | 用户反馈 Agent 处理时间长无反馈      |
| Agent Swarm Slack 支持             | v2.0     | `/add-telegram-swarm` 完成后参考实现 |
| 未注册频道 @Bot 静默无响应提示     | v1.1     | 用户反馈在未注册频道 @Bot 无任何反馈 |
| DM vs 频道触发规则差异说明         | v1.1     | 用户反馈不理解 DM 免 @mention 但频道需要 |
| 事件驱动直接分发（内存去重+缓冲→GroupQueue.enqueueWithPrompt()） | v1.1 | 测量数据显示 SQLite 轮询延迟不可接受 |

---

## 7. 验证策略

### 7.1 测试框架

- **框架**：vitest + tsc
- **命令**：`npm test`、`npm run build`、`npm run typecheck`
- **原则**：完全 mock `@slack/bolt`，不发起真实 API 调用

### 7.2 必须覆盖的测试场景

| 场景                                  | 优先级 |
| ------------------------------------- | ------ |
| Bot 消息过滤（防止无限循环）          | P0     |
| 所有 `subtype` 消息过滤               | P0     |
| 内存 TTL Map 去重                        | P0     |
| JID 命名空间路由（`slack:` 前缀）     | P0     |
| 消息分片（40k 字符边界）              | P0     |
| `connect()` / `disconnect()` 生命周期 | P0     |
| `sendMessage()` 429 重试              | P0     |
| `sendMessage()` 5xx 有界重试          | P0     |
| @mention 翻译为触发词                 | P1     |
| Token-presence 激活模式分支                 | P1     |
| Token 生命周期事件处理                | P1     |
| Socket 看门狗陈旧检测                 | P1     |
| 混合通道排序逻辑                      | P1     |
| DM 排除逻辑                           | P1     |
| `SLACK_FILTER_BOT_MESSAGES` 可配置过滤 | P0     |

### 7.3 DoD 门控

- 不要求任务级 QA 场景和证据清单
- 每个波次必须通过对应 DoD，未通过不得进入下一波次
- Wave 2 的 T7 与 T8 为硬性门控
