# Slack 通道集成 — 用户故事

> 关联文档：[PRD 主文档](./slack-prd.md) · [技术规格附录](./technical-specs.md)

---

## US-1：安装 Slack 通道

**角色**：NanoClaw 用户  
**目标**：在现有 NanoClaw 安装上添加 Slack 支持  
**优先级**：P0

### 故事

> 作为 NanoClaw 用户，我希望通过 `/add-slack` 技能安装 Slack 通道，以便在 Slack 中使用 Claude Agent。

### 场景描述

1. 用户在 Claude Code 中执行 `/add-slack`
2. 技能询问运行模式：替换 WhatsApp 还是并行运行
3. 技能询问是否已有 Slack App
4. 技能引擎执行代码变更（`apply-skill.ts`）
5. `npm test && npm run build` 验证通过
6. 用户按指引在 Slack API 创建 App（若无）
7. 配置 OAuth Scopes、Event Subscriptions、Socket Mode（详见技术规格 §2.2-2.4）
8. 生成 Bot Token（`xoxb-`）+ App-Level Token（`xapp-`）
9. Token 写入 `.env`
10. 重启服务，Bot 上线

### 验收标准

- [ ] `/add-slack` 技能可正常执行
- [ ] 技能引擎应用后 `src/channels/slack.ts` 存在且可编译
- [ ] `src/channels/slack.test.ts` 测试通过
 [ ] `src/config.ts` 包含 `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_ONLY`、`SLACK_FILTER_BOT_MESSAGES` 导出
- [ ] 启动时校验 Token 格式：`SLACK_BOT_TOKEN` 以 `xoxb-` 开头、`SLACK_APP_TOKEN` 以 `xapp-` 开头，格式不匹配时 fail-fast
- [ ] `auth.test()` 失败时降级为安全模式（过滤所有 bot 消息，禁用 @mention 翻译）
- [ ] `package.json` 包含 `@slack/bolt` 依赖
- [ ] `.env.example` 包含 Slack 环境变量（注：当前 `.env.example` 为空文件，此项需同步补充所有通道的环境变量）
- [ ] `npm test && npm run build` 通过
- [ ] 技能应用记录在 `.nanoclaw/state.yaml` 中

### 前置条件

- NanoClaw 已安装并可运行
- Claude Code 可用
- `.nanoclaw/` 目录已初始化（或技能引擎自动初始化）

### 异常场景

| 场景                                        | 预期行为                          |
| ------------------------------------------- | --------------------------------- |
| 技能已应用过                                | 跳过代码变更，直接进入 Setup 阶段 |
| 合并冲突（`src/index.ts` 已被其他技能修改） | 读取 `intent.md` 文件手动解决冲突 |
| `npm test` 失败                             | 阻止继续，提示用户修复            |

---

## US-2：注册 Slack 频道

**角色**：NanoClaw 用户  
**目标**：将 Slack 频道或 DM 注册为受管通道  
**优先级**：P0

### 故事

> 作为用户，我希望注册 Slack 频道/DM 为受管通道，以便 Agent 能响应该频道的消息。

### 场景描述

1. 用户在 Slack 客户端获取频道或 DM ID（`C...` / `D...`）
2. 用户将 ID 以 `slack:{id}` 形式提供给 Claude Code
3. 系统调用 `registerGroup('slack:C...', {...})` 写入 SQLite（注册信息）
4. 创建对应的 `groups/{folder}/` 目录结构
5. 后续消息即可被轮询循环捕获并路由到 Agent

> **频道 ID 发现**：用户可通过在 Slack 频道中 @mention Bot 获取频道 ID。Bot 对未注册频道的 @mention 回复 `slack:{channelId}` 和注册指引（与 Telegram `/chatid` 命令对称）。Bot 实现 `!chatid` 消息命令用于频道发现（与 Telegram `/chatid` 对称）。
### 验收标准

- [ ] `registerGroup()` 接受 `slack:` 前缀的 JID
- [ ] SQLite `registered_groups` 表中正确写入 Slack 频道记录
- [ ] `groups/{folder}/` 目录已创建
- [ ] `groups/{folder}/CLAUDE.md` 在 Agent 首次响应后自动生成（注：`registerGroup()` 仅创建目录结构，CLAUDE.md 由容器内 Agent 首次运行时初始化）
- [ ] 注册后的频道消息可被轮询循环检测并路由到 Agent

### 前置条件

- Slack 通道已安装（US-1 完成）
- Bot 已上线并连接到 Slack

### 异常场景

| 场景               | 预期行为                                 |
| ------------------ | ---------------------------------------- |
| 频道 ID 格式错误   | 提示正确格式 `slack:C...` / `slack:D...` |
| 频道已注册         | 更新现有记录（UPSERT）                   |
| Bot 未被邀请到频道 | 提示用户先邀请 Bot                       |

---

## US-3：频道中通过 @mention 触发 Agent

**角色**：Slack 频道成员  
**目标**：在频道中 @Bot 来触发 AI 回复  
**优先级**：P0

### 故事

> 作为 Slack 频道成员，我希望通过 @mention Bot 触发 Agent 回复，以便在频道中获得 AI 协助。

### 场景描述

1. 用户在频道中发送 `<@U0BOT1D> 今天天气怎么样`
2. `SlackChannel` 检测到 `<@{botUserId}>` 提及
3. 消息不匹配 `TRIGGER_PATTERN`，自动前置 `@Andy`
4. 转换后内容：`@Andy <@U0BOT1D> 今天天气怎么样`
5. 消息经内存 TTL Map 去重后通过 onMessage 写入 SQLite，由轮询循环处理
6. `processGroupMessages` → `runAgent` → 容器内 Agent 处理
7. Agent 输出通过 `channel.sendMessage()` 发回频道

### 验收标准

- [ ] `<@{botUserId}>` 格式的 @mention 被正确检测
- [ ] 消息自动前置 `@{ASSISTANT_NAME}` 触发词
- [ ] 翻译后的消息匹配 `TRIGGER_PATTERN`
- [ ] Agent 回复发送到频道顶层（不使用 `thread_ts`）
- [ ] 回复内容正确且完整
> **设计决策**：频道中需要 @mention 触发（避免噪音），DM 中所有消息自动触发（类似 WhatsApp 私聊）。此不对称是有意为之——频道是多人环境，DM 是一对一对话。

### 前置条件

- 频道已注册（US-2 完成）
- Bot 在线且 Socket Mode 连接正常

### 异常场景

| 场景                                 | 预期行为                              |
| ------------------------------------ | ------------------------------------- |
| 消息已包含触发词                     | 不重复添加触发词                      |
| Bot 自身消息                         | 被 `botUserId` 过滤，不触发处理       |
| 带 `subtype` 的消息（如 URL unfurl） | 被过滤，不触发处理                    |
| 未注册频道的 @mention                | 仅触发 `onChatMetadata()`，不处理消息 |

---

## US-4：Slack 通道自动启用
**角色**：NanoClaw 用户  
**目标**：配置 Slack Token 后自动启用 Slack 通道  
**优先级**：P0
### 故事

> 作为用户，我希望配置 Slack Token 后自动启用 Slack 通道，以便在 Slack 中使用 NanoClaw。

### 场景描述

1. 用户在安装时配置 Slack Token
2. `.env` 中设置 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN`
3. `main()` 中检测两个 Token 同时存在时创建 `SlackChannel`（token-presence 激活，与 Telegram 对称）
4. `channels[]` 数组包含 `SlackChannel`（可与 WhatsApp 并行）
5. 若 `SLACK_ONLY=true`，显式跳过 WhatsApp `connect()`（WhatsApp 在无认证时会尝试 QR 码流程，不会静默跳过）

### 验收标准

- [ ] `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN` 同时存在时创建 Slack 通道（token-presence 激活）
- [ ] 仅单个 Token 存在时不创建 Slack 通道，输出警告日志
- [ ] 不影响 WhatsApp 通道的独立运行（两者可并行）
- [ ] 消息路由、定时任务、IPC 通过 Slack 正常工作
- [ ] 关闭时所有已连接通道都优雅断连
- [ ] `SLACK_ONLY=true` 时显式跳过 WhatsApp 通道创建
- [ ] `SLACK_ONLY=true` 且缺少任一必需 Token 时启动失败（fail-fast）并输出明确错误
### 前置条件

- Slack Token 已配置（`SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`）

### 异常场景
| 场景                                  | 预期行为                          |
| ------------------------------------- | --------------------------------- |
| 仅单个 Token 存在（BOT 或 APP） | 启动时警告日志，不创建 Slack 通道 |
| `SLACK_ONLY=true` 但缺少任一必需 Token | 启动失败（`process.exit(1)`），输出明确错误提示 |
| 无 Slack Token 且无 WhatsApp auth | WhatsApp 连接失败，Slack 不创建 |
| `SLACK_ONLY=true` 且 `TELEGRAM_ONLY=true` | Slack 通道赢，WhatsApp 被跳过（跨通道交互语义详见技术债务文档） |
| Token 格式正确但已过期/撤销                        | `connect()` 中 `auth.test()` 失败 → 记录错误日志，不创建通道 |
| Token 格式正确但权限不足（缺少必要 scope）         | `connect()` 失败 → 同上处理 |

---

## US-5：DM 直接对话

**角色**：NanoClaw 用户  
**目标**：在 Slack DM 中直接与 Bot 对话  
**优先级**：P1

### 故事

> 作为用户，我希望在 DM 中直接与 Bot 对话，无需 @mention，以便获得更自然的对话体验。

### 场景描述

1. 用户在 Slack 中打开与 Bot 的 DM
2. 用户发送消息（无需 @mention）
3. `SlackChannel` 检测到 DM（`D` 前缀频道）
4. DM 消息自动前置触发词
5. 消息经内存 TTL Map 去重后通过 onMessage 写入 SQLite，由轮询循环处理
6. Agent 回复发送到 DM

### 验收标准

- [ ] DM 消息（`slack:D{id}`）被正确识别
- [ ] DM 可注册为独立群组
- [ ] DM 消息自动前置触发词（无需用户 @mention）
- [ ] Agent 回复发送到 DM
- [ ] DM 拥有独立的 `groups/{folder}/` 和 `CLAUDE.md`

### 前置条件

- DM 已注册为受管通道
- Bot 在线

---

## US-6：限流恢复

**角色**：NanoClaw 用户  
**目标**：Bot 正确处理 Slack API 限流  
**优先级**：P0

### 故事

> 作为用户，我希望 Bot 能正确处理 Slack 限流（429），不丢失消息，以便在高频交互时仍能可靠工作。

### 场景描述

1. Agent 输出需要发送到 Slack
2. `chat.postMessage` 返回 429 + `Retry-After: 5`
3. `sendMessage()` 等待 5 秒后重试
4. 重试成功，消息送达
5. 若连续 429，最多重试 3 次（与 5xx 对齐），超过后放弃
6. 若 5xx 错误，最多重试 3 次（1s/2s/4s + jitter）
7. 若最终失败，记录错误日志

### 验收标准

- [ ] 429 响应时读取 `Retry-After` 头并等待指定秒数
- [ ] 429 最多重试 3 次，超过后记录日志并放弃（防止无限循环）
- [ ] 等待后重试成功
- [ ] 5xx 响应时最多重试 3 次，间隔递增 + jitter
- [ ] 不使用无界重试循环（429 和 5xx 均有上限）
- [ ] 最终失败时记录结构化错误日志
- [ ] 网络错误仅记录日志，交给 Bolt 重连

### 前置条件

- Slack 通道已连接

### 异常场景

| 场景                 | 预期行为                          |
| -------------------- | --------------------------------- |
| 连续 429             | 每次按 `Retry-After` 等待，最多重试 3 次，超过后放弃并记录日志 |
| `Retry-After` 头缺失 | 使用默认退避（1s）                |
| 5xx 重试 3 次仍失败  | 记录日志，不再重试                |

---

## US-7：Socket 断连自动恢复

**角色**：NanoClaw 用户  
**目标**：Bot 在 Socket 断连后自动恢复  
**优先级**：P0

### 故事

> 作为用户，我希望 Bot 在 Socket 断连后自动恢复，不需要手动重启，以便保持 7×24 可用性。

### 场景描述

1. Socket Mode 连接因网络波动断开
2. Bolt 内置重连机制尝试恢复
3. 看门狗检测最后事件时间戳
4. 若 >3 分钟无事件，主动触发重连（为 5 分钟 SLO 预留 2 分钟恢复窗口）
5. 重连成功后恢复事件处理
6. 输出结构化重连诊断日志

### 验收标准

- [ ] Bolt 内置重连机制正常工作
- [ ] 看门狗每 60 秒检查最后事件时间戳
- [ ] 超过 3 分钟陈旧阈值时主动触发重连（为 5 分钟 SLO 预留 2 分钟恢复窗口）
- [ ] 重连后事件处理恢复正常
- [ ] 重连事件输出结构化日志
- [ ] 重连期间不导致进程崩溃

### 前置条件

- Slack 通道已连接

### 异常场景

| 场景                  | 预期行为                   |
| --------------------- | -------------------------- |
| DNS 解析失败          | 看门狗检测到陈旧，触发重连 |
| `too_many_websockets` | 优雅处理，不崩溃           |
| 重连后事件洪峰        | 内存 TTL Map + SQLite 消息 ID 唯一约束防止重复处理       |

---

## US-8：定时任务通过 Slack 发送

**角色**：NanoClaw 用户  
**目标**：定时任务能通过 Slack 通道发送消息  
**优先级**：P1

### 故事

> 作为用户，我希望定时任务能通过 Slack 通道发送消息，以便在 Slack 中接收定时提醒和报告。

### 场景描述

1. 用户在 Slack 频道中创建定时任务
2. 任务到期时，`startSchedulerLoop()` 触发
3. `runTask()` 在容器中执行 Agent
4. Agent 通过 IPC `send_message` 发送消息
5. `findChannel(channels, 'slack:C...')` 路由到 `SlackChannel`
6. 消息发送到 Slack 频道

### 验收标准

- [ ] 定时任务可在 Slack 频道中创建
- [ ] 任务执行后消息通过 `findChannel()` 正确路由到 Slack
- [ ] IPC `send_message` 支持 `slack:` 前缀 JID
- [ ] 消息成功发送到目标 Slack 频道

### 前置条件

- Slack 频道已注册
- 定时任务已创建

---

## US-9：Token 撤销优雅处理

**角色**：NanoClaw 用户  
**目标**：Token 被撤销时 Bot 优雅断连  
**优先级**：P0

### 故事

> 作为用户，我希望 Token 被撤销时 Bot 能优雅断连而非崩溃，以便我能安全地轮换 Token。

### 场景描述

1. 管理员在 Slack App 设置中撤销 Token
2. Slack 发送 `tokens_revoked` 事件
3. `SlackChannel` 接收事件并触发优雅断连
4. 记录结构化日志说明断连原因
5. 不影响其他通道（WhatsApp）的运行
6. 不导致进程崩溃

### 验收标准

- [ ] 监听 `tokens_revoked` 事件
- [ ] 监听 `app_uninstalled` 事件
- [ ] 收到事件后优雅断连（`app.stop()`）
- [ ] 记录结构化日志
- [ ] 不影响其他通道
- [ ] 不导致进程崩溃或未捕获异常

### 前置条件

- Slack 通道已连接

### 异常场景

| 场景                   | 预期行为                                 |
| ---------------------- | ---------------------------------------- |
| `app_uninstalled` 事件 | 同 `tokens_revoked`，优雅断连            |
| 断连后尝试发送消息     | `isConnected()` 返回 `false`，消息不发送 |

---

## US-10：条件金丝雀发布

**角色**：运维者  
**目标**：有条件金丝雀发布协议和回滚手册  
**优先级**：P1

### 故事

> 作为运维者，我希望有条件金丝雀发布协议和回滚手册，以便安全地将 Slack 集成部署到生产环境。

### 场景描述

1. 完成所有开发任务后进入金丝雀阶段
2. 按条件检查清单逐项验证
3. 全部条件满足后退出金丝雀
4. 若触发回滚条件，执行回滚命令序列

### 验收标准

- [ ] 条件金丝雀检查清单已产出且可执行
- [ ] 退出条件为条件触发（非固定 24h）
- [ ] 回滚协议已定义并含完整命令序列
- [ ] 回滚触发条件明确且可量化
- [ ] `SKILL.md` 加固流程与排障说明已更新

### 金丝雀退出条件（全部满足）

1. Socket 重连恢复：至少经历一次断连→重连→恢复
2. 限流恢复：至少经历一次 429→Retry-After→成功重试
3. 消息幂等：处理 ≥50 条入站消息，零重复
4. 稳定运行：连续 ≥24 小时，零未捕获异常
5. Token 验证：至少验证一次 token 有效性

### 回滚触发条件（任一满足）

1. 未捕获异常导致进程崩溃
2. 消息重复响应
3. Socket 断连后 5 分钟内未恢复
4. 429 限流后连续 3 次重试失败

---

## US-11：多通道并行运行

**角色**：多通道用户  
**目标**：WhatsApp 和 Slack 同时运行  
**优先级**：P1

### 故事

> 作为多通道用户，我希望 WhatsApp 和 Slack 同时运行，各自独立的群组和上下文，以便在不同平台使用 NanoClaw。

### 场景描述

1. 用户配置 Slack Token（WhatsApp 保持已有配置）
2. `main()` 检测两个 Slack Token 同时存在，创建 `channels[]` 数组包含 WhatsApp 和 Slack
3. 两个通道各自连接
4. 消息通过 JID 前缀路由到正确通道
5. 关闭时两个通道都优雅断连
### 验收标准

 [ ] `channels[]` 数组同时包含 WhatsApp 和 Slack
 [ ] 两个通道各自独立连接
 [ ] `findChannel()` 通过 JID 前缀正确路由
 [ ] WhatsApp 消息不路由到 Slack，反之亦然
 [ ] 关闭时两个通道都调用 `disconnect()`
 [ ] 仅 WhatsApp 启动路径不受影响（无 Slack Token 时）
 [ ] Slack `connect()` 失败时，已连接的 WhatsApp 通道不受影响（需 try-catch 隔离）

### 前置条件

 WhatsApp 已配置
 Slack Token 已配置（`SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`）

---

## US-12：Bot 消息自循环防止

**角色**：系统  
**目标**：防止 Bot 自身消息触发无限循环  
**优先级**：P0（安全关键）

### 故事

> 作为系统，我需要防止 Bot 自身发送的消息触发重新处理，以避免无限循环消耗资源。

### 场景描述
2. Slack 将 Bot 的消息作为事件推送回来
3. Bolt 内置 `ignoreSelf` 中间件（默认启用）作为第一层防护，过滤 `bot_message` subtype 和 `botUserId` 匹配的事件
4. `SlackChannel` 在 `app.event('message')` 回调内实现防御性冗余过滤：
   - 过滤所有带 `subtype` 的消息（`bot_message`、`message_changed`、`channel_join` 等）
   - 过滤 `event.user === botUserId` 的消息
5. 双重过滤确保即使 `ignoreSelf` 被意外禁用，Bot 消息仍不会触发处理
6. Bot 过滤策略可通过 `SLACK_FILTER_BOT_MESSAGES` 环境变量配置：
   - `true`（默认）：过滤所有 bot 消息（subtype 过滤 + botUserId 过滤）
   - `false`：仅过滤自身消息（event.user === botUserId），允许其他 bot 消息触发 Agent

> **设计决策**：`ignoreSelf` 仅覆盖 `bot_message` subtype，不覆盖 `message_changed`、`channel_join` 等。手动过滤所有 `subtype` 消息是必要的防御层，非冗余。

### 验收标准
- [ ] 启动时通过 `app.client.auth.test()` 获取 `botUserId`
- [ ] Bolt `ignoreSelf` 中间件保持默认启用（第一层防护）
- [ ] `event.user === botUserId` 的消息被过滤（防御性冗余）
- [ ] 所有带 `subtype` 的消息被过滤（覆盖 `ignoreSelf` 未处理的 `message_changed`、`channel_join` 等）
- [ ] 过滤后不调用 `onMessage()` 或 `onChatMetadata()`
- [ ] 无限循环场景测试通过
- [ ] `SLACK_FILTER_BOT_MESSAGES=true`（默认）时过滤所有 bot 消息
- [ ] `SLACK_FILTER_BOT_MESSAGES=false` 时仅过滤自身消息，允许其他 bot 触发 Agent
- [ ] 无论 `SLACK_FILTER_BOT_MESSAGES` 设置如何，Bot 自身消息始终被过滤
- [ ] `auth.test()` 失败导致 `botUserId` 为空时，强制过滤所有 bot 消息（`subtype` 过滤），禁用 @mention 翻译，记录 error 级别日志
### 前置条件
- Slack 通道已连接
- `botUserId` 已获取

---

## US-13：消息分片发送

**角色**：系统  
**目标**：超长消息自动分片发送  
**优先级**：P1

### 故事

> 作为系统，我需要将超过 40,000 字符的消息自动分片发送，以符合 Slack API 限制。

### 场景描述

1. Agent 输出超过 40,000 字符的长文本
2. `sendMessage()` 检测到超长
3. 按 40,000 字符边界分片
4. 依次发送每个分片
5. 每个分片之间遵守速率限制

### 验收标准

- [ ] 超过 40,000 字符的消息自动分片
- [ ] 分片边界正确（不截断 UTF-8 字符）
- [ ] 每个分片独立发送
- [ ] 分片发送遵守速率限制
- [ ] 短消息（≤40,000 字符）不分片

---

## US-14：@mention 翻译

**角色**：系统  
**目标**：将 Slack @mention 翻译为 NanoClaw 触发词  
**优先级**：P1

### 故事

> 作为系统，我需要将 Slack 的 `<@{botUserId}>` 格式翻译为 NanoClaw 触发词，以便触发消息处理。

### 场景描述

1. 用户在频道中发送 `<@U0BOT1D> 帮我查一下`
2. `SlackChannel` 检测到 `<@{botUserId}>` 实体
3. 消息不匹配 `TRIGGER_PATTERN`
4. 在消息前面添加 `@{ASSISTANT_NAME}`
5. 翻译后：`@Andy <@U0BOT1D> 帮我查一下`
6. 消息匹配触发词，进入处理流程

### 验收标准

- [ ] 检测消息中的 `<@{botUserId}>` 实体
- [ ] 消息尚未匹配 `TRIGGER_PATTERN` 时前置触发词
- [ ] 已匹配触发词的消息不重复添加
- [ ] 翻译后的消息能被 `TRIGGER_PATTERN` 匹配
- [ ] 与 Telegram 的 `@bot_username` → `@AssistantName` 翻译逻辑对称

> **已知折衷**：翻译后消息保留原始 Slack 格式 `<@U0BOT1D>`（与 Telegram 保留 `@bot_username` 一致）。Agent 会看到此格式，可读性略低于纯文本，但保持了跨通道翻译逻辑的一致性。
