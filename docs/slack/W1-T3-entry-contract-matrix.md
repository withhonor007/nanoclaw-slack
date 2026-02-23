# W1-T3: Slack 入口契约 + 边缘情况优先级矩阵

**Wave 1，任务 3 交付物。** 最终确定路线图中的 Slack 入口契约，并生成带有任务 ID 映射的 P0/P1/P2 优先级矩阵。

源文档：`feature_docs/slack-edge-cases.md`、`feature_docs/slack-map.md`、`.sisyphus/plans/slack-roadmap-next-phase.md`

---

## 第 1 节：Slack 入口契约（最终版）

### 事件到消息模型的映射

| Slack 事件                             | NanoClaw 动作                                   | 幂等键                              |
| -------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| `message` (无 subtype)                 | `onMessage()`                                   | `event.client_msg_id` 或 `event.ts` |
| `app_mention`                          | `onMessage()`（将 `<@botUserId>` 转换为触发词） | `event.client_msg_id` 或 `event.ts` |
| `message` (subtype: `bot_message`)     | 忽略                                            | —                                   |
| `message` (subtype: `message_changed`) | 忽略                                            | —                                   |
| `message` (subtype: `message_deleted`) | 忽略                                            | —                                   |
| `message` (subtype: `channel_join`)    | 忽略                                            | —                                   |
| `message` (subtype: `channel_leave`)   | 忽略                                            | —                                   |
| `message` (subtype: `file_share`)      | 忽略                                            | —                                   |
| `message` (任何其他 subtype)           | 忽略                                            | —                                   |
| `tokens_revoked`                       | 优雅断开连接                                    | —                                   |
| `app_uninstalled`                      | 优雅断开连接                                    | —                                   |

**规则**：所有带有任何 `subtype` 字段的 `message` 事件均被忽略。只有裸 `message` 事件（无 subtype）和 `app_mention` 事件才会进入 `onMessage()`。

### 幂等性处理

双层去重：

1. **内存 TTL Map**（`channel:ts` 键，5 分钟 TTL）。单进程架构意味着无需分布式锁。进程重启时清除。
2. **SQLite 唯一约束**，作用于消息 ID。防止跨重启的重复写入。轮询游标从上次处理位置恢复。

对于有副作用的操作（欢迎消息、元数据写入），使用 `event_ts + user_id` 作为幂等键，而非 `envelope_id`。Slack 可能以不同的 `envelope_id` 传递相同的 `event_ts`（参见边缘情况 §9.7）。

Socket Mode 注意事项：由于网络抖动，Slack 可能在 ack 超时后重新传递相同的 `envelope_id`（参见边缘情况 §9.1）。TTL Map 会透明地处理这种情况。

### 被忽略的事件（完整列表）

所有 `message` subtype 均无例外地被忽略：

- `message_changed`（包括 URL 展开重新传递）
- `message_deleted`
- `bot_message`
- `channel_join`
- `channel_leave`
- `file_share`
- `reply_broadcast`
- `thread_broadcast`
- 上述未列出的任何其他 subtype

过滤器实现：

```typescript
// In app.message() handler — drop anything with a subtype
if ('subtype' in message && message.subtype) return;
```

这个单一守卫覆盖了所有当前和未来的 subtype。

---

## 第 2 节：MVP 运行模式（最终版）

### MVP 支持的功能

- **DM 优先**：所有 `slack:D{id}` 私信在通过 `registerGroup()` 注册后默认可接收
- **频道 @mention 触发**：公共和私有频道仅响应 `<@{botUserId}>` 提及；频道中的裸消息通过 `onChatMetadata()` 存储，但不路由到 agent
- **频道白名单**：只有通过 `registerGroup()` 注册的频道才会接受 agent 处理；未注册频道的消息触发 `onChatMetadata()` 仅用于发现
- **频道发现**：当 bot 在未注册频道收到 @mention 时，回复该频道的 `slack:{channelId}` 和注册指引（通过 `!chatid` 消息命令）

### MVP 不支持的功能

- 交互模式（`!open` / `!close` 命令）
- 线程级上下文隔离（所有消息进入频道级上下文）
- Slash 命令
- 文件上传管道
- Markdown 到 mrkdwn 的转换
- Slack Connect 外部用户响应

---

## 第 3 节：Token 权限范围规范（最终版）

### Token 类型

| Token 类型      | 前缀    | 用途                               | 是否必需               |
| --------------- | ------- | ---------------------------------- | ---------------------- |
| Bot Token       | `xoxb-` | Web API 调用（发送消息、查询用户） | 是                     |
| App-Level Token | `xapp-` | Socket Mode 连接                   | 是                     |
| Signing Secret  | —       | 请求签名验证（仅 HTTP 模式）       | 否，Socket Mode 不使用 |

构造函数签名：`new SlackChannel(botToken, appToken, opts)`。无 `signingSecret` 参数。

激活模型：`SLACK_BOT_TOKEN && SLACK_APP_TOKEN`（token 存在性检测）。无单独的 `SLACK_ENABLE` 标志。

启动时的 token 格式验证：

- `SLACK_BOT_TOKEN` 必须以 `xoxb-` 开头
- `SLACK_APP_TOKEN` 必须以 `xapp-` 开头
- 格式不匹配会在 `app.start()` 之前触发快速失败

### 最小 Bot OAuth 权限范围

MVP 所需：

| 权限范围            | 用途                             |
| ------------------- | -------------------------------- |
| `app_mentions:read` | 接收 @mention                    |
| `channels:history`  | 读取公共频道消息                 |
| `channels:read`     | 读取频道元数据                   |
| `chat:write`        | 发送消息                         |
| `im:history`        | 读取私信消息                     |
| `im:read`           | 读取私信元数据                   |
| `im:write`          | 开启私信频道                     |
| `users:read`        | 查询用户信息以获取 `sender_name` |

可选（私有频道支持）：

| 权限范围         | 用途               |
| ---------------- | ------------------ |
| `groups:history` | 读取私有频道消息   |
| `groups:read`    | 读取私有频道元数据 |

### App-Level Token 权限范围

- `connections:write`，Socket Mode 连接所必需

---

## 第 4 节：边缘情况优先级矩阵

### P0，金丝雀发布前必须修复

每个 P0 项目都有对应的任务 ID。没有未映射的 P0 项。

#### P0-1：Bot 自循环

**描述**：Bot 将自己发出的消息作为入站事件接收，触发无限处理循环。Slack 为所有 bot 发起的消息传递 `bot_message` subtype 事件。

**缓解措施**：

1. 在处理器入口点过滤 `event.subtype === 'bot_message'`。
2. 启动时调用 `app.client.auth.test()` 获取 `botUserId`。过滤任何 `event.user === botUserId` 作为二级守卫。
3. `SLACK_FILTER_BOT_MESSAGES` 配置标志：`true`（默认）丢弃所有 bot 消息；`false` 仅丢弃自身消息。

**所属任务**：T7（入站加固）

**验证**：单元测试，发出 `bot_message` 事件并断言 `onMessage()` 从未被调用；单元测试，发出来自 `botUserId` 的消息并断言相同结果。

---

#### P0-2：URL 展开导致的 `message_changed`

**描述**：当消息包含 URL 时，Slack 在链接预览加载后发送 `message_changed` 事件。`text` 字段与原始消息相同。若没有 subtype 过滤，bot 会处理同一消息两次并发送重复响应。

**缓解措施**：通用 subtype 过滤器（`if ('subtype' in message && message.subtype) return`）无条件丢弃 `message_changed`，无论原因是用户编辑、URL 展开还是文件附件。

**所属任务**：T7（入站加固）

**验证**：单元测试，发出带有 `subtype: 'message_changed'` 的 `message_changed` 事件并断言 `onMessage()` 从未被调用。

---

#### P0-3：Socket Mode ack 超时重新传递

**描述**：当 Slack 在约 3 秒内未收到 ack 时，会重新传递相同事件（相同 `envelope_id`，递增的 `retry_attempt`），即使 ack 已发送且 WebSocket 处于 OPEN 状态。这会导致重复的 agent 调用。

**缓解措施**：以 `channel:ts` 为键的内存 TTL Map（5 分钟 TTL）在重新传递的事件到达 `onMessage()` 之前进行去重。SQLite 对消息 ID 的唯一约束在进程重启后提供第二层保护。

**所属任务**：T7（入站加固）

**验证**：单元测试，用相同的 `channel:ts` 两次调用入站处理器，并断言 `onMessage()` 恰好被调用一次。

---

#### P0-4：`chat.postMessage` 的 429 速率限制

**描述**：Slack 对 `chat.postMessage` 强制执行约每频道每秒 1 次请求的限制。高频响应（多用户、长 agent 输出分块）会触发此限制。Slack 返回带有 `Retry-After` 头的 HTTP 429。若不处理，消息会被静默丢弃。

**缓解措施**：

1. 在 `sendMessage()` 中检测 429 响应。
2. 读取 `Retry-After` 头；若缺失则默认为 1 秒。
3. 等待指定时长，然后重试一次。
4. 记录结构化事件：`{ event: 'rate_limited', channel, retry_after_ms }`。

Slack 内置的 WebClient 重试逻辑处理了部分情况，但显式处理可确保可观测性和正确的回退行为。

**所属任务**：T8（出站加固）

**验证**：单元测试，模拟 `chat.postMessage` 在第一次调用时返回 429，第二次返回 200，断言消息最终被发送且 `Retry-After` 等待被遵守。

---

#### P0-5：出站发送时的 5xx 服务器错误

**描述**：Slack API 在后端瞬时故障期间返回 5xx 错误。若没有有界重试，消息会被静默丢失。

**缓解措施**：`sendMessage()` 中的有界重试：最多 3 次尝试，延迟为 `1s / 2s / 4s` 加抖动。3 次失败后，记录结构化错误并向调用方报告。网络错误（无响应）传递给 Bolt 的重连路径。

**所属任务**：T8（出站加固）

**验证**：单元测试，模拟 `chat.postMessage` 三次返回 500，断言重试次数和最终失败日志。

---

#### P0-6：Token 撤销 / 应用卸载

**描述**：当工作区管理员撤销 bot 的 token 或卸载应用时，Slack 发送 `tokens_revoked` 和 `app_uninstalled` 事件。若不处理，进程会继续以无效凭证运行，在每次出站调用时记录错误且永远无法恢复。

**缓解措施**：

1. 为 `tokens_revoked` 和 `app_uninstalled` 注册处理器。
2. 收到后，调用 `app.stop()` 关闭 Socket Mode 连接。
3. 设置 `this.connected = false`。
4. 记录结构化事件：`{ event: 'token_revoked' | 'app_uninstalled', timestamp }`。
5. 不尝试重连（凭证已无效）。若已配置，让进程监督器重启。

**所属任务**：T9（token 生命周期 + 看门狗）

**验证**：单元测试，发出 `tokens_revoked` 并断言 `app.stop()` 被调用且 `isConnected()` 返回 false。

---

### P1，应在 Wave 3 实现

| 边缘情况                   | 来源 | 所属任务 | 风险 | 备注                                                                                           |
| -------------------------- | ---- | -------- | ---- | ---------------------------------------------------------------------------------------------- |
| Socket 静默断开            | §9.3 | T9       | 高   | 进程存活但不处理事件。看门狗：每 60 秒检查最后事件时间戳，若超过 3 分钟无活动则重连。          |
| WebSocket pong 超时        | §9.9 | T9       | 中   | 重连触发事件洪流；幂等层（P0-3）处理重复项。监控 `slack_socket_mode_no_reply_received_error`。 |
| `too_many_websockets` 崩溃 | §9.2 | T9       | 中   | 通过 `app.stop()` 优雅处理 SIGTERM/SIGINT。升级到 `@slack/bolt` >=4.x（状态机修复）。          |
| 有状态正则 `/g`/`/y` 标志  | §9.6 | T7       | 低   | 确保传递给 Bolt 处理器的所有正则表达式不使用 `/g` 或 `/y` 标志。                               |
| 队列满 / 队列超时          | §1.1 | 延期     | 中   | NanoClaw 的 `group-queue.ts` 已提供并发控制。                                                  |

---

### P2，延期到未来阶段

| 边缘情况                         | 来源  | 风险 | 延期原因                              |
| -------------------------------- | ----- | ---- | ------------------------------------- |
| 交互模式（`!open`/`!close`）     | §1.3  | 低   | 不在 MVP 范围内                       |
| mrkdwn 格式转换                  | §4.2  | 低   | 直接发送可接受；大多数内容渲染正确    |
| 文件上传管道                     | §4.4  | 低   | 占位文本 `[File: name]` 对 MVP 已足够 |
| 线程级上下文隔离                 | §6.2  | 中   | 频道级对话模型是既定决策              |
| Slack Connect 外部用户           | §4.6  | 低   | MVP 不响应外部用户                    |
| `assistant.userMessage` 无限循环 | §9.8  | 低   | NanoClaw 不使用 Assistant API         |
| HTTP 模式 `X-Slack-Retry-Num`    | §9.10 | 低   | NanoClaw 使用 Socket Mode，不适用     |
| 多实例事件分发                   | §9.4  | 低   | NanoClaw 是单进程，不适用             |
| `team_join` 重复传递             | §9.7  | 低   | NanoClaw 在 MVP 中不发送欢迎消息      |
| 已归档 / 只读频道                | §4.6  | 低   | 发送失败时优雅记录日志已足够          |
| 共享频道（Slack Connect）        | §4.6  | 低   | MVP 不支持                            |

---

## 完整性检查

**P0 项目**：共 6 项。全部映射到任务 ID。

| P0 项目                          | 任务 ID | 状态   |
| -------------------------------- | ------- | ------ |
| Bot 自循环                       | T7      | 已映射 |
| URL 展开导致的 `message_changed` | T7      | 已映射 |
| Socket Mode ack 超时重新传递     | T7      | 已映射 |
| 429 速率限制                     | T8      | 已映射 |
| 5xx 服务器错误                   | T8      | 已映射 |
| Token 撤销 / 应用卸载            | T9      | 已映射 |

无未映射的 P0 项目。
