# Slack 通道集成分析

## 概述

本文档基于 NanoClaw 现有架构（`project-codemap.md`）和 Telegram 技能包参考实现（`telegram-map.md`），分析如何将 Slack 作为消息通道集成到 NanoClaw。同时提炼开发过程中必须遵循的硬规范。

仓库中已有 `claudecode-slackbot/` 参考实现（独立 Slack Bot 项目，非 NanoClaw 通道适配器），以及 `.claude/skills/add-slack/` 技能定义（SKILL.md 交互指南），但尚无完整的技能包产物（`add/`、`modify/`、`manifest.yaml`）。

---

## 技术选型

### SDK：`@slack/bolt`（Socket Mode）

| 维度     | 决策                              | 理由                                                                    |
| -------- | --------------------------------- | ----------------------------------------------------------------------- |
| SDK      | `@slack/bolt@^4.4.0`              | 官方 Slack SDK，封装 WebSocket + Web API，与 `claudecode-slackbot` 一致 |
| 连接模式 | Socket Mode（`socketMode: true`） | 无需公网 HTTP 端点，出站 WebSocket 连接，适合个人单用户部署             |
| 对标     | Grammy（Telegram 长轮询）         | 同为无服务器模式，但 Socket Mode 是真正的 WebSocket 推送，延迟更低      |

Socket Mode 工作原理：

1. `app.start()` 使用 App-Level Token（`xapp-...`）调用 `apps.connections.open` 获取 WSS URL
2. Bolt 打开 WebSocket 连接，Slack 推送事件
3. Bolt 自动确认（ack）事件、处理心跳、断线重连
4. 无需 `ngrok`、无需公网 IP、无需 TLS 证书

### 依赖

```
@slack/bolt@^4.4.0    # 唯一 Slack 依赖，包含 Socket Mode + Web API
```

---

## 硬规范（开发必须遵循）

### R1：Channel 接口合规

`SlackChannel` 必须实现 `src/types.ts` 中的 `Channel` 接口，不得遗漏任何方法：

```typescript
interface Channel {
  name: string; // 必须为 'slack'
  connect(): Promise<void>; // 启动 Socket Mode，首次连接成功后 resolve
  sendMessage(jid: string, text: string): Promise<void>; // 发送消息，含分片逻辑
  isConnected(): boolean; // Socket Mode 连接状态
  ownsJid(jid: string): boolean; // jid.startsWith('slack:')
  disconnect(): Promise<void>; // app.stop()
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // 空实现，不得抛异常
}
```

### R2：JID 命名空间

所有 Slack 通道 ID 必须加 `slack:` 前缀，与 WhatsApp（`@g.us`/`@s.whatsapp.net`）和 Telegram（`tg:`）命名空间隔离：

| 通道类型       | JID 格式      | 示例                | ownsJid 判定           |
| -------------- | ------------- | ------------------- | ---------------------- |
| Slack 公共频道 | `slack:C{id}` | `slack:C07ABC123DE` | `startsWith('slack:')` |
| Slack 私有频道 | `slack:G{id}` | `slack:G07ABC123DE` | `startsWith('slack:')` |
| Slack DM       | `slack:D{id}` | `slack:D07ABC123DE` | `startsWith('slack:')` |
| WhatsApp 群组  | `{id}@g.us`   | `12345678@g.us`     | `endsWith('@g.us')`    |
| Telegram       | `tg:{chatId}` | `tg:-1001234567890` | `startsWith('tg:')`    |

Slack 原生 ID 前缀含义：`C` = 公共频道，`G` = 私有频道/群组 DM，`D` = 1:1 DM。

### R3：构造函数签名

必须接受与 WhatsApp/Telegram 相同的 `opts` 结构：

```typescript
interface SlackChannelOpts {
  onMessage: OnInboundMessage; // → storeMessage()
  onChatMetadata: OnChatMetadata; // → storeChatMetadata()
  registeredGroups: () => Record<string, RegisteredGroup>;
}

// 构造：new SlackChannel(botToken, appToken, signingSecret, opts)
```

### R4：connect() 模式

必须遵循 WhatsApp 的 Promise 包装模式：

- `connect()` 返回 `Promise<void>`，在 Socket Mode 首次连接成功时 resolve
- 内部通过 `app.start()` 启动，Bolt 自动处理重连
- 首次连接失败时 reject，后续断线由 Bolt 内部重连机制处理
- 连接成功后设置 `this.connected = true`

### R5：sendMessage() 规范

- 消息长度上限 **40,000 字符**（Slack API 限制），超长自动按 40,000 字符边界分片
- 发送前剥离 `slack:` 前缀：`const channelId = jid.replace(/^slack:/, '')`
- 断线时推入 `outgoingQueue`，重连后 `flushOutgoingQueue()` 排空
- `flushOutgoingQueue()` 必须有 `flushing` 布尔守卫防止并发排空
- 发送失败时推入队列而非抛异常（与 WhatsApp 行为一致）
- 消息前缀：非独立号码模式下添加 `${ASSISTANT_NAME}: ` 前缀

### R6：Bot 消息过滤

必须检测并标记 Bot 自身发送的消息，防止自循环：

- 启动时通过 `app.client.auth.test()` 获取 `botUserId`
- 入站消息中 `event.user === botUserId` 或 `event.subtype === 'bot_message'` 时设置 `is_bot_message: true`
- `is_from_me` 同理：`event.user === botUserId`

### R7：onMessage 回调数据

必须构造完整的 `NewMessage` 对象：

```typescript
this.opts.onMessage(slackJid, {
  id: event.client_msg_id || event.ts, // ts 作为后备 ID
  chat_jid: slackJid, // 'slack:C...'
  sender: event.user, // Slack user ID
  sender_name: userDisplayName, // 通过 users.info 查询或缓存
  content: translatedText, // @mention 翻译后的文本
  timestamp: new Date(parseFloat(event.ts) * 1000).toISOString(),
  is_from_me: event.user === botUserId,
  is_bot_message: event.user === botUserId || event.subtype === 'bot_message',
});
```

### R8：onChatMetadata 回调

必须对每条入站消息调用（包括未注册的聊天），用于聊天发现：

```typescript
const isGroup = channelId.startsWith('C') || channelId.startsWith('G');
this.opts.onChatMetadata(slackJid, timestamp, channelName, 'slack', isGroup);
// channelName 可内联传递（Slack 有频道名），不像 WhatsApp 需要单独同步
```

### R9：setTyping 空实现

Slack 不提供 Bot 打字指示器 API。`setTyping` 必须为空实现，**不得抛出异常**：

```typescript
async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
  // Slack 不支持 Bot 打字指示器
}
```

可选增强：发送临时 "思考中..." 消息，完成后通过 `chat.update` 更新内容。

### R10：环境变量

| 变量                   | 类型    | 必需 | 说明                                            |
| ---------------------- | ------- | ---- | ----------------------------------------------- |
| `SLACK_BOT_TOKEN`      | string  | 是   | Bot OAuth Token（`xoxb-...`）                   |
| `SLACK_APP_TOKEN`      | string  | 是   | App-Level Token（`xapp-...`），Socket Mode 必需 |
| `SLACK_SIGNING_SECRET` | string  | 是   | 请求签名验证密钥                                |
| `SLACK_ONLY`           | boolean | 否   | 为 `true` 时跳过 WhatsApp 通道创建              |

所有变量通过 `readEnvFile()` 从 `.env` 读取，遵循 `process.env` → `envConfig` 回退链。容器环境需同步到 `data/env/env`。

### R11：技能包结构

必须遵循技能引擎模式（与 `add-telegram` 一致）：

```
.claude/skills/add-slack/
├── manifest.yaml          # 技能元数据、依赖、合并目标
├── SKILL.md               # 交互式安装指南
├── add/
│   ├── src/channels/slack.ts       # SlackChannel 实现
│   └── src/channels/slack.test.ts  # 单元测试
├── modify/
│   ├── src/index.ts                # channels[] 数组 + 条件创建
│   ├── src/config.ts               # SLACK_* 环境变量
│   ├── src/index.ts.intent.md      # 合并冲突指导
│   └── src/config.ts.intent.md     # 合并冲突指导
└── tests/
    └── skill-validation.test.ts    # 技能包结构验证
```

### R12：modify/ 合并目标

**`src/index.ts`** 必须修改：

- 在 `channels[]` 数组构建逻辑中添加 Slack 条件分支
- `if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN)` → 创建 `SlackChannel` 并 push
- `if (SLACK_ONLY)` → 跳过 WhatsApp 通道创建
- 关闭时遍历所有通道调用 `disconnect()`

**`src/config.ts`** 必须修改：

- 将 `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_SIGNING_SECRET`、`SLACK_ONLY` 添加到 `readEnvFile()` 调用
- 导出这些常量

### R13：秘钥隔离

- Slack Token 通过 `.env` + `readEnvFile()` 读取，**不得**直接写入 `process.env`
- 容器内通过 stdin JSON 传递，**不得**作为环境变量或挂载文件传入
- 与 WhatsApp/Telegram 的秘钥处理方式完全一致

### R14：测试规范

- 必须完全 mock `@slack/bolt`，不得发起真实 API 调用
- 使用 `vi.mock('@slack/bolt')` + 假 `App` 对象
- 覆盖：连接生命周期、消息处理、@提及翻译、sendMessage 分片、ownsJid 路由、Bot 命令、断线重连
- 测试辅助函数模式与 WhatsApp 测试一致：`createTestOpts()`、`connectChannel()`

### R15：@提及翻译

Slack 中 `<@U012AB3CD>` 格式的 Bot 提及必须翻译为 NanoClaw 触发词：

- 检测消息中的 `<@{botUserId}>` 实体
- 若消息尚未匹配 `TRIGGER_PATTERN`，在前面添加触发词（`@AssistantName`）
- 与 Telegram 的 `@bot_username` → `@AssistantName` 翻译逻辑对称

---

## 运行时消息流

### 入站流程

```
Slack (Socket Mode WebSocket)
  -> app.event('message') / app.event('app_mention')
  -> 过滤 bot_message / 自身消息
  -> 构造 JID: slack:{channelId}
  -> onChatMetadata(slackJid, timestamp, channelName, 'slack', isGroup)
  -> 检查 registeredGroups → 已注册则 onMessage(slackJid, newMessage)
  -> storeMessage() [SQLite]
  -> startMessageLoop() 轮询 getNewMessages() 每 2s
  -> findChannel(channels, 'slack:C...') → 路由到 SlackChannel
  -> processGroupMessages() → runAgent() → 容器内 Agent 处理
  -> Agent 输出 → channel.sendMessage('slack:C...', text)
  -> app.client.chat.postMessage({ channel: 'C...', text })
```

### 出站流程

```
Agent 输出 / IPC send_message
  -> routeOutbound(channels, 'slack:C...', text)
  -> SlackChannel.sendMessage('slack:C...', text)
  -> 剥离 'slack:' 前缀 → channelId = 'C...'
  -> text.length > 40000 ? 分片发送 : 单条发送
  -> app.client.chat.postMessage({ channel: channelId, text })
  -> 断线时 → outgoingQueue.push({ jid, text })
  -> 重连后 → flushOutgoingQueue()
```

### IPC 流程（与通道无关）

```
容器写入 JSON 到 data/ipc/{group}/messages/
  -> startIpcWatcher() 拾取文件
  -> findChannel(channels, jid) → 根据 JID 前缀路由到对应通道
  -> channel.sendMessage(jid, text)
```

---

## 设计决策

### D1：线程模型

**推荐方案：频道级对话（非线程级）**

NanoClaw 的核心模型是「每个注册群组 = 一个对话上下文」。Slack 的 thread 机制与此不完全对齐。

- 入站消息不区分线程，统一存入该频道的消息队列
- 出站回复发送到频道顶层（不使用 `thread_ts`）
- 这与 WhatsApp 和 Telegram 的行为一致：所有消息在群组级别处理

若未来需要线程级隔离，可作为增强功能单独实现。

### D2：DM 处理

- Slack DM（`D` 前缀）视为独立聊天，JID 为 `slack:D{id}`
- 可注册为独立群组，拥有自己的 `groups/{folder}/` 和 `CLAUDE.md`
- 与 Telegram 私聊（`tg:{userId}`）处理方式一致

### D3：文件附件

- Slack 文件附件存储为占位符文本：`[File: {filename}] {caption}`
- 图片：`[Image: {filename}] {caption}`
- 与 Telegram 的 `[Photo] caption` 模式对齐
- 不下载文件内容（安全考虑 + 容器隔离）

### D4：Slack Bot 命令

| 命令      | 功能                  | 响应格式                                              |
| --------- | --------------------- | ----------------------------------------------------- |
| `!chatid` | 返回当前频道的注册 ID | ``Chat ID: `slack:{id}`\nName: {name}\nType: {type}`` |
| `!ping`   | 检查 Bot 在线状态     | `{ASSISTANT_NAME} is online.`                         |

注意：使用 `!` 前缀的消息命令而非 Slack `/` 斜杠命令，避免 App Manifest 注册复杂度。Slack 斜杠命令需要额外的 Manifest 配置和 scope，且与 NanoClaw 的触发词机制存在语义冲突。

---

## 与 Telegram 技能包的对比

| 维度           | Telegram (`add-telegram`)  | Slack (`add-slack`)                               |
| -------------- | -------------------------- | ------------------------------------------------- |
| SDK            | `grammy`                   | `@slack/bolt@^4.4.0`                              |
| 连接模式       | 长轮询（`bot.start()`）    | Socket Mode（WebSocket）                          |
| Token 数量     | 1（`TELEGRAM_BOT_TOKEN`）  | 3（`BOT_TOKEN` + `APP_TOKEN` + `SIGNING_SECRET`） |
| JID 前缀       | `tg:`                      | `slack:`                                          |
| 消息长度限制   | 4,096 字符                 | 40,000 字符                                       |
| 打字指示器     | `sendChatAction('typing')` | 不支持（空实现）                                  |
| @提及格式      | `@bot_username`（实体）    | `<@BOTID>`（标记语法）                            |
| 频道类型区分   | 正/负 chatId               | `C`/`G`/`D` 前缀                                  |
| 独占模式       | `TELEGRAM_ONLY`            | `SLACK_ONLY`                                      |
| 群组元数据同步 | 内联传递 chatName          | 内联传递 channelName                              |
| 文件处理       | `[Photo] caption` 占位符   | `[File: name] caption` 占位符                     |
| Bot 命令注册   | BotFather `/setcommands`   | 消息命令（`!chatid`）                             |

---

## Slack App 配置要求

### 必需的 OAuth Scopes

```yaml
oauth_config:
  scopes:
    bot:
      - app_mentions:read # 接收 @提及
      - channels:history # 读取公共频道消息
      - channels:read # 读取公共频道元数据
      - chat:write # 发送消息
      - groups:history # 读取私有频道消息（可选）
      - groups:read # 读取私有频道元数据（可选）
      - im:history # 读取 DM 消息
      - im:read # 读取 DM 元数据
      - im:write # 打开 DM 通道
      - users:read # 查询用户信息（sender_name）
```

### 必需的事件订阅

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

### App-Level Token

必须在 Slack App 设置中生成 App-Level Token，scope 为 `connections:write`。此 Token 以 `xapp-` 开头，仅用于建立 Socket Mode 连接。

---

## 用户故事

### US-1：安装 Slack 通道

**角色**：NanoClaw 用户
**目标**：在现有安装上添加 Slack 支持

1. 用户在 Claude Code 中执行 `/add-slack`
2. 技能询问运行模式：替换 WhatsApp 还是并行运行
3. 技能询问是否已有 Slack App
4. 技能引擎执行代码变更（`apply-skill.ts`）
5. `npm test && npm run build` 验证通过
6. 用户按指引在 Slack API 创建 App（若无）
7. 配置 OAuth Scopes、Event Subscriptions、Socket Mode
8. 生成 Bot Token + App Token + Signing Secret
9. Token 写入 `.env` 并同步到 `data/env/env`
10. 重启服务，Bot 上线

### US-2：注册 Slack 频道

**角色**：NanoClaw 用户
**目标**：将 Slack 频道或 DM 注册为受管通道

1. 用户在 Slack 中向 Bot 发送 `!chatid`
2. Bot 回复 `slack:{channelId}`、频道名称和类型
3. 用户将 Channel ID 提供给 Claude Code
4. 系统调用 `registerGroup('slack:C...', {...})` 写入 SQLite
5. 创建对应的 `groups/{folder}/` 目录结构
6. 后续消息即可被轮询循环捕获并路由到 Agent

### US-3：在频道中通过 @提及触发 Agent

**角色**：Slack 频道成员
**目标**：在频道中 @Bot 来触发 AI 回复

1. 用户在频道中发送 `<@U0BOT1D> 今天天气怎么样`
2. `SlackChannel` 检测到 `<@{botUserId}>` 提及
3. 消息不匹配 `TRIGGER_PATTERN`，自动前置 `@Andy`
4. 转换后内容：`@Andy <@U0BOT1D> 今天天气怎么样`
5. 消息存入 SQLite，轮询循环检测到触发词
6. `processGroupMessages` → `runAgent` → 容器内 Agent 处理
7. Agent 输出通过 `channel.sendMessage()` 发回频道

### US-4：仅 Slack 模式

**角色**：不使用 WhatsApp 的用户
**目标**：完全替换 WhatsApp，仅用 Slack

1. 用户在安装时选择"替换 WhatsApp"
2. `.env` 中设置 `SLACK_ONLY=true`
3. `main()` 中条件跳过 WhatsApp 通道创建
4. `channels[]` 数组仅包含 `SlackChannel`
5. 所有消息路由、定时任务、IPC 均通过 Slack 通道工作

---

## 集成关系

- **消费方**：`scripts/apply-skill.ts`（技能引擎）、Claude Code `/add-slack` 技能调用
- **依赖**：`Channel` 接口（`src/types.ts`）、`findChannel`（`src/router.ts`）、`readEnvFile`（`src/env.ts`）、`@slack/bolt` npm 包
- **应用时修改**：`src/index.ts`、`src/config.ts`、`.env.example`、`package.json`
- **参考实现**：`claudecode-slackbot/`（独立项目，架构更复杂，不直接移植但可参考边界情况处理）
- **关联技能**：未来可扩展 `/add-slack-swarm`（Agent 团队协作支持）
