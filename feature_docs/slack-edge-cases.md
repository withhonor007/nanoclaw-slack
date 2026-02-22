# Slack Bot 边界情况参考文档

## 概述

本文档基于 `claudecode-slackbot/` 参考实现的深度分析（6 个并行研究代理的完整结果），系统性梳理 Slack Bot 集成中的所有边界情况、交互设计模式和平台陷阱。作为 `slack-map.md`（硬规范 + 架构设计）的补充文档，聚焦于"什么会出错"和"如何防御"。

参考实现分析范围：`claudecode-slackbot/src/` 全部源码 + 92+ 测试文件。

---

## 1. 多用户并发处理

### 1.1 会话队列（Session Queue）

参考实现采用信号量模式控制并发：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_CONCURRENT_SESSIONS` | 3 | 同时运行的最大会话数 |
| `REQUEST_QUEUE_SIZE` | 10 | 等待队列最大长度 |
| `QUEUE_TIMEOUT_MS` | 30000 | 排队超时时间（毫秒） |

**会话键（Session Key）**：`user-channel-threadTs`

- 每个用户在每个频道的每个线程中拥有独立的会话槽位
- 同一用户在不同频道的请求互不阻塞
- 同一频道中不同用户的请求共享频道级并发限制

**边界情况**：

| 场景 | 行为 | NanoClaw 建议 |
| --- | --- | --- |
| 队列已满（>10 请求） | 返回 `⛔ System Busy` 状态消息 | 必须实现，否则请求静默丢失 |
| 排队超时（>30s） | 返回 `⏱️ Request Timeout` 状态消息 | 必须实现，用户需要明确反馈 |
| 用户连续发送多条消息 | 中止前一个请求（AbortController），更新旧状态为"已中断" | 推荐实现，避免资源浪费 |
| 会话泄漏（进程异常） | 每 5 分钟清理 >30 分钟不活跃的会话 | 必须实现定期清理 |

### 1.2 请求中止（Abort）

参考实现通过 `AbortController` 管理请求生命周期。中止检测有 4 个条件：

```typescript
// 以下任一条件为 true 即判定为中止
1. error.name === 'AbortError'
2. error.exitCode === 143 && error.signal !== undefined  // SIGTERM
3. error.message 包含 'abort' 文本
4. signal.aborted === true
```

**关键设计**：当用户发送新消息时，中止前一个正在处理的请求，并将旧的状态消息更新为"已中断"。这避免了用户看到两个并行的"处理中"状态。

### 1.3 交互模式（Interactive Mode）

参考实现支持 `!open` / `!close` 命令切换交互模式：

- 交互模式键：`userId-channelId`
- 开启后，该用户在该频道的所有消息（无需 @mention）都会路由到 Bot
- `!close` 或超时自动关闭
- `shouldContinueSession()` 检查：会话存在 + `closedAt` 未设置 + AbortSignal 未中止

**NanoClaw 适配建议**：NanoClaw 使用 `TRIGGER_PATTERN` 触发，交互模式可作为可选增强。若实现，需在 `slack-map.md` R5 的 `!` 前缀命令体系中注册。

---

## 2. 速率限制

### 2.1 应用层速率限制

参考实现采用双滑动窗口机制：

```
┌─────────────────────────────────────┐
│  请求到达                            │
│    ↓                                │
│  Per-User 限制器 ──→ 通过？         │
│    ↓ 是                             │
│  Per-Channel 限制器 ──→ 通过？      │
│    ↓ 是                             │
│  进入会话队列                        │
└─────────────────────────────────────┘
```

- 两个限制器都必须通过，请求才能进入队列
- 滑动窗口而非固定窗口，避免窗口边界突发

### 2.2 Slack API 速率限制

| API 方法 | 限制 | 影响场景 |
| --- | --- | --- |
| `chat.postMessage` | ~1 次/秒/频道 | 高频状态更新、多用户同时触发 |
| `chat.update` | ~1 次/秒/频道 | 状态消息实时更新 |
| `reactions.add` | ~20+ 次/分钟 | 表情状态反馈 |
| `users.info` | ~100+ 次/分钟 | 用户信息查询 |
| `files.getUploadURLExternal` | 较低 | 文件上传 |

**关键陷阱**：

- `chat.postMessage` 的 1 次/秒/频道限制是最容易触发的瓶颈
- 超限后 Slack 返回 `429 Too Many Requests` + `Retry-After` 头
- 参考实现未实现退避重试（仅两次一次性重试），NanoClaw 应考虑指数退避
- `chat.update` 与 `chat.postMessage` 共享频道级限制

### 2.3 NanoClaw 建议

NanoClaw 的轮询架构天然降低了速率限制风险（不像参考实现的实时推送模式），但仍需注意：

- `sendMessage()` 中实现基本的速率限制感知（检测 429 响应）
- 状态消息更新频率不超过 1 次/秒
- 批量消息发送时添加间隔

---

## 3. 错误处理

### 3.1 错误分类与响应

| 错误类型 | 参考实现行为 | NanoClaw 建议 |
| --- | --- | --- |
| 队列满 | `⛔ System Busy` 状态 | 同上 |
| 排队超时 | `⏱️ Request Timeout` 状态 | 同上 |
| SDK 协议噪声 | 回退到直接 API 调用 | 记录日志，不向用户暴露 |
| 空响应 | 诊断分析 + 建议（如"尝试更具体的问题"） | 推荐实现，避免静默失败 |
| AbortError | 更新状态为"已中断" | 必须处理，否则状态消息卡在"处理中" |
| Slack API 错误 | 记录日志 + 通用错误消息 | 区分可恢复/不可恢复错误 |
| Socket 断连 | Bolt 自动重连 | 依赖 Bolt 内置机制，添加连接状态监控 |

### 3.2 重试策略

参考实现的重试策略较为简单：

- 仅两次一次性重试（resume 失败、协议噪声）
- 无指数退避
- 无重试队列

**NanoClaw 建议**：由于 NanoClaw 的轮询架构，大部分重试场景不适用。但 `sendMessage()` 中应实现：

1. 检测 `429` 响应 → 等待 `Retry-After` 秒后重试
2. 检测 `5xx` 响应 → 最多重试 2 次，间隔 1s/2s
3. 检测网络错误 → 依赖 Bolt 重连机制

---

## 4. Slack 平台特性与陷阱

### 4.1 Socket Mode 连接管理

| 特性 | 说明 | 影响 |
| --- | --- | --- |
| 连接过期 | ~3600 秒后连接过期 | Bolt 自动重连，但期间事件可能丢失 |
| `refresh_requested` | Slack 主动要求断开重连 | Bolt 处理，无需额外代码 |
| 事件丢失窗口 | 断连到重连之间的事件不会重放 | NanoClaw 轮询架构天然容错（消息已在 SQLite 中） |
| 3 秒确认要求 | 事件必须在 3 秒内 ack | Bolt 自动 ack，但自定义中间件不能阻塞 |

### 4.2 消息格式（mrkdwn ≠ Markdown）

Slack 使用自有的 `mrkdwn` 格式，与标准 Markdown 不同：

| Markdown | Slack mrkdwn | 说明 |
| --- | --- | --- |
| `**bold**` | `*bold*` | 单星号为粗体 |
| `*italic*` | `_italic_` | 下划线为斜体 |
| `[text](url)` | `<url\|text>` | 链接语法完全不同 |
| `@username` | `<@U123ABC>` | 必须使用用户 ID |
| `#channel` | `<#C123ABC>` | 必须使用频道 ID |
| ` ``` ` | ` ``` ` | 代码块语法相同 |
| `> quote` | `> quote` | 引用语法相同 |

**关键决策**：Claude Agent 输出为标准 Markdown。NanoClaw 需要决定：

1. **不转换**（推荐）：直接发送，Slack 会渲染大部分内容（代码块、引用正常），粗体/斜体/链接可能显示异常但可读
2. **转换**：实现 Markdown → mrkdwn 转换器，增加复杂度但显示更美观

参考实现选择了不转换。

### 4.3 消息长度限制

| 限制 | 值 | 说明 |
| --- | --- | --- |
| 文本消息 | 40,000 字符 | `chat.postMessage` / `chat.update` |
| Block Kit | 50 个 blocks | 富文本消息 |
| 附件 | 20 个 | 旧版消息格式 |

**关键发现**：参考实现未实现消息分片（40k 限制未强制执行）。NanoClaw 的 `slack-map.md` R5 已要求实现 40,000 字符分片，这是对参考实现的改进。

### 4.4 文件上传

**`files.upload` 已废弃**。新的 3 步流程：

```
1. files.getUploadURLExternal → 获取上传 URL + file_id
2. POST 到上传 URL（form-encoded，非 JSON）
3. files.completeUploadExternal → 关联到频道/消息
```

参考实现的文件处理：

- 50MB 文件大小限制
- 文本文件截断至 10,000 字符
- `finally` 块中清理临时文件
- 图片类型分类（screenshot、diagram、photo 等）

**NanoClaw 建议**：初始版本可不支持文件上传（`slack-map.md` R5 已将文件附件定义为占位符 `[File: filename]`）。后续迭代再添加。

### 4.5 事件去重

Slack 事件投递特性：

- 事件不保证有序
- 事件可能重复投递
- 参考实现未实现事件级去重（无 `event_id` 追踪）

**NanoClaw 建议**：由于 NanoClaw 使用 SQLite 轮询架构，消息写入时可通过 `message_id`（Slack 的 `ts` 值，全局唯一）做幂等写入，天然解决去重问题。

### 4.6 频道与用户类型

**频道类型边界**：

| 类型 | 风险 | 处理建议 |
| --- | --- | --- |
| 已归档频道（`is_archived`） | API 调用返回错误 | 检测并跳过，不尝试发送 |
| 共享频道（Slack Connect） | 外部组织成员可见 | 初始版本不支持，记录日志 |
| 只读频道 | 无法发送消息 | 检测权限错误，优雅降级 |
| 私有频道 | Bot 需被邀请 | `member_joined_channel` 事件触发欢迎消息 |

**用户类型边界**：

| 类型 | 风险 | 处理建议 |
| --- | --- | --- |
| Bot 用户 | Bot 消息触发无限循环 | `slack-map.md` R6 已要求过滤 `message.bot_id` |
| 访客用户（Guest） | 权限受限 | 正常处理，权限问题由 Slack 平台拦截 |
| 已停用用户（Deactivated） | 消息来自不存在的用户 | 忽略，不查询用户信息 |
| Slack Connect 外部用户 | 跨组织安全风险 | 初始版本不响应外部用户消息 |

---

## 5. 安全与权限

### 5.1 参考实现的权限模型

参考实现通过 MCP（Model Context Protocol）实现工具审批：

```
Claude 请求使用工具 → MCP permission_prompt → Slack 按钮（Approve/Deny）→ 文件 IPC 轮询 → 返回结果
```

- 超时 = 拒绝（默认 60 秒）
- 错误 = 拒绝
- 无用户级授权 — 工作区内任何成员都可使用 Bot
- 无频道白名单

**NanoClaw 差异**：NanoClaw 的 Agent 运行在容器中，工具权限由容器隔离保证，无需 Slack 按钮审批流程。这是架构优势。

### 5.2 工作目录隔离

参考实现的目录作用域：

| 上下文 | 工作目录 |
| --- | --- |
| 频道消息 | `{base}/{channelId}/` |
| DM 消息 | `{base}/{channelId}-{userId}/` |

**NanoClaw 差异**：NanoClaw 已有 `groups/{name}/` 隔离机制，Slack 频道映射为 group 即可。`slack-map.md` R2 的 JID 命名空间（`slack:C...`）确保路由正确。

### 5.3 路径安全

参考实现的防御措施：

- 禁止路径黑名单（系统目录、敏感文件）
- 路径遍历检查（`../` 检测）
- `~` 展开处理
- 日志脱敏：API 密钥、Token、密码自动替换为 `[REDACTED]`

**NanoClaw 差异**：容器隔离已覆盖路径安全。Agent 只能访问挂载的目录，无需应用层路径验证。

### 5.4 安全缺口（参考实现未覆盖）

| 缺口 | 风险 | NanoClaw 状态 |
| --- | --- | --- |
| 无消息内容扫描 | 用户可能在消息中发送密钥/Token | 容器隔离降低风险，但仍建议记录 |
| 无用户级授权 | 任何工作区成员可触发 Agent | NanoClaw 单用户设计，风险较低 |
| 无频道白名单 | Bot 可在任意频道被触发 | 通过 `registeredGroups` 机制控制 |
| Token 撤销事件未处理 | `tokens_revoked` / `app_uninstalled` | 应监听并优雅关闭 |

---

## 6. Slack 交互设计模式

### 6.1 状态消息生命周期

参考实现的状态反馈模式：

```
用户发送消息
  ↓
Bot 发送状态消息（🤔 Thinking...）
  ↓
chat.update 更新状态（⚙️ Processing...）
  ↓
chat.update 更新为最终结果（✅ 完成 / ❌ 错误）
```

同时在用户原始消息上添加 Reaction 表情作为并行状态指示。

**NanoClaw 建议**：由于 NanoClaw 的轮询架构，Agent 处理时间较长。建议：

1. 收到消息时立即发送"处理中"状态
2. Agent 完成后直接发送结果（替代实时更新）
3. 不实现 Reaction 表情（简化实现）

### 6.2 线程路由

```typescript
// 参考实现的线程路由逻辑
sessionThreadTs = message.thread_ts || message.ts
// 如果消息在线程中 → 使用线程的根 ts
// 如果消息在频道顶层 → 使用消息自身的 ts（创建新线程）
```

**`reply_broadcast` 边界**：用户可以将线程回复广播到频道。此时消息同时出现在线程和频道中，但 `thread_ts` 仍指向原线程。

**NanoClaw 建议**：`slack-map.md` 已决定使用频道级会话（非线程级）。线程路由复杂度可暂时忽略，但需注意：

- Bot 回复应发送到频道顶层（不使用 `thread_ts`）
- 如果用户在线程中 @mention Bot，仍应响应（提取消息文本，忽略线程上下文）

### 6.3 事件处理与去重

参考实现注册了三个事件处理器：

| 处理器 | 触发条件 | 用途 |
| --- | --- | --- |
| `app.message` | DM 消息 | 直接消息处理 |
| `app_mention` | 频道中 @mention | 频道触发 |
| `message`（通用） | 交互模式下的所有消息 | 免 @mention 触发 |

**去重问题**：`app_mention` 和 `message` 可能对同一条消息同时触发。参考实现通过交互模式状态判断优先级。

**NanoClaw 建议**：仅注册 `app_mention`（频道）和 `app.message`（DM），不实现交互模式，避免去重复杂度。

### 6.4 消息编辑与删除

参考实现对消息编辑和删除采取静默忽略策略：

- 编辑后的消息不会重新触发处理
- 删除的消息不会中止正在进行的处理

**NanoClaw 建议**：保持一致，静默忽略。Slack 的 `message_changed` 和 `message_deleted` 子类型事件不注册处理器。

### 6.5 Bot 加入频道

参考实现在 `member_joined_channel` 事件中发送欢迎消息。

**NanoClaw 建议**：可选实现。若实现，发送简短说明（触发词、基本用法）。

---

## 7. 测试覆盖参考

参考实现的 92+ 测试文件覆盖了以下关键边界：

| 测试类别 | 覆盖的边界情况 |
| --- | --- |
| 会话队列 | 并发控制、队列满拒绝、超时处理 |
| 中止处理 | 中止时序窗口、流处理中中止 |
| 回归测试 | 关闭期间流处理（close-during-stream） |
| 速率限制 | 线程安全、滑动窗口边界 |
| 命令检测 | 重复命令、中文全角 `！continue` 识别 |
| 空响应 | 诊断分析、建议生成 |
| 会话过期 | >30 分钟不活跃检测 |
| 权限审批 | 审批流程、超时拒绝 |
| 路径验证 | 遍历攻击、禁止路径 |
| 输入验证 | ReDoS 安全的正则表达式 |

**NanoClaw 测试建议**：优先覆盖以下场景（按风险排序）：

1. Bot 消息过滤（防止无限循环）— 最高优先级
2. JID 命名空间路由（`slack:` 前缀正确性）
3. 消息分片（40k 字符边界）
4. `connect()` / `disconnect()` 生命周期
5. `sendMessage()` 错误处理（429、5xx、网络错误）

---

## 8. NanoClaw 架构优势总结

NanoClaw 的架构设计天然规避了参考实现中的多个复杂边界：

| 参考实现的复杂度 | NanoClaw 为何不需要 |
| --- | --- |
| MCP 权限审批流程 | 容器隔离，工具权限由 OS 保证 |
| 应用层路径验证 | 容器只能访问挂载目录 |
| 工作目录管理器 | `groups/{name}/` 已有隔离 |
| 复杂的会话队列 | `group-queue.ts` 已有并发控制 |
| 日志脱敏 | 容器内日志与宿主隔离 |
| 多用户授权 | 单用户设计，无需授权 |

**仍需从参考实现借鉴的**：

| 特性 | 原因 |
| --- | --- |
| Bot 消息过滤 | Slack 平台特性，与架构无关 |
| 速率限制感知 | Slack API 限制，与架构无关 |
| 状态消息反馈 | 用户体验需求 |
| `mrkdwn` 格式意识 | Slack 平台特性 |
| Token 撤销监听 | 安全最佳实践 |
| 消息分片 | Slack 40k 限制 |

---

## 9. 实现优先级矩阵

基于风险和用户影响的实现优先级：

| 优先级 | 边界情况 | 风险 | 实现复杂度 |
| --- | --- | --- | --- |
| P0（必须） | Bot 消息过滤 | 无限循环 | 低 |
| P0（必须） | 消息分片（40k） | 消息丢失 | 低 |
| P0（必须） | `connect()` 错误处理 | 启动失败无反馈 | 低 |
| P1（应该） | 429 速率限制处理 | API 封禁 | 中 |
| P1（应该） | 状态消息（处理中） | 用户体验差 | 中 |
| P1（应该） | 已归档/只读频道检测 | 静默失败 | 低 |
| P2（可选） | 交互模式 | 便利性 | 高 |
| P2（可选） | 文件上传支持 | 功能完整性 | 高 |
| P2（可选） | Markdown → mrkdwn 转换 | 显示美观 | 中 |
| P3（延后） | Token 撤销监听 | 安全加固 | 低 |
| P3（延后） | Slack Connect 支持 | 企业场景 | 高 |