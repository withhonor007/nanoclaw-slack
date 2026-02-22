# .claude/skills/add-telegram/

## 职责

确定性技能包，用于将 Telegram 作为消息通道添加到 NanoClaw。提供所有源码产物（新增文件 + 三向合并目标），由技能引擎 (`scripts/apply-skill.ts`) 消费，将仅 WhatsApp 的安装转换为多通道系统。

## 设计

遵循 NanoClaw **技能引擎模式** — 代码变更以声明式文件集打包，而非运行时插件：

- **`manifest.yaml`** — 技能元数据：声明 `adds`（新增文件）、`modifies`（合并目标）、`structured.npm_dependencies`（grammy）、`structured.env_additions`（TELEGRAM_BOT_TOKEN、TELEGRAM_ONLY）、版本约束（`core_version`）和测试命令（`test`）。
- **`add/`** — 原样复制到项目的新文件：
  - `src/channels/telegram.ts` — `TelegramChannel` 类，实现 `Channel` 接口（connect、sendMessage、setTyping、ownsJid、disconnect）。使用 Grammy 的 `Bot` 类进行长轮询，通过 `bot.start({ onStart })` 回调 resolve connect Promise。处理文本消息、媒体占位符（photo/video/voice/audio/document 含文件名/sticker 含 emoji/location/contact）、`/chatid` 和 `/ping` 命令、`@bot_username` → `@AssistantName` 的提及翻译，以及 `bot.catch()` 全局错误处理。
  - `src/channels/telegram.test.ts` — 50 个单元测试（10 个 describe 块），覆盖连接生命周期、文本/媒体消息处理、@提及翻译、sendMessage（含 4096 字符分片）、ownsJid 路由、setTyping、Bot 命令和通道属性。Grammy 完全 mock。
- **`modify/`** — 三向合并目标（已内置 Telegram 改动的基础版本）：
  - `src/index.ts` — 将 `main()` 从单一 `whatsapp` 变量重构为 `channels: Channel[]` 数组。添加条件式通道创建（`TELEGRAM_ONLY` 跳过 WhatsApp，`TELEGRAM_BOT_TOKEN` 启用 Telegram）。通过 `findChannel(channels, jid)` 在 processGroupMessages、startMessageLoop、scheduler 和 IPC 中路由。关闭时遍历所有通道。
  - `src/config.ts` — 将 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_ONLY` 添加到 `readEnvFile()` 调用和导出。遵循现有模式：`process.env` → `envConfig` 回退。
  - `src/routing.test.ts` — 扩展路由测试，增加 Telegram JID 所有权模式（`tg:` 前缀、负数群组 ID）和 WhatsApp+Telegram 混合排序测试。无 intent.md 文件。
  - `index.ts.intent.md`、`config.ts.intent.md` — 合并指导文档，描述变更内容、需保持的不变量和必须保留的代码段。当三向合并产生冲突时由技能引擎使用。仅 `index.ts` 和 `config.ts` 有对应的 intent 文件。
- **`tests/`** — 技能包验证测试（非运行时测试）。验证 manifest 结构、文件存在性、内容断言（类名、导入、保留的导出）。
- **`SKILL.md`** — 5 阶段交互式指南：预检 → 应用代码 → BotFather 设置 → 聊天注册 → 验证。包含故障排除、卸载说明、开发模式提示（After Setup）和 Agent Swarms 团队协作引导。

## 流程

### 技能应用（确定性）

1. `npx tsx scripts/apply-skill.ts .claude/skills/add-telegram`
2. 引擎读取 `manifest.yaml` → 复制 `add/` 文件 → 对 `modify/` 文件与当前源码进行三向合并
3. 安装 `grammy` 依赖 → 更新 `.env.example` → 记录到 `.nanoclaw/state.yaml`
4. 合并冲突时 → 开发者阅读 `*.intent.md` 获取解决指导

### 运行时消息流（应用后）

1. Grammy `Bot.start({ onStart })` 开始长轮询 Telegram API，`onStart` 回调 resolve `connect()` Promise
2. 收到文本消息 → `bot.on('message:text')` 处理器（跳过 `/` 开头的命令）
3. 构造 JID 为 `tg:{chatId}` → 调用 `onChatMetadata`（含 chatName）→ 检查 `registeredGroups` → 已注册则调用 `onMessage` 写入 SQLite
4. 非文本消息（photo/video 等）→ `storeNonText` 处理器 → 调用 `onChatMetadata`（不传 chatName）→ 存储占位符如 `[Photo] caption`
5. `index.ts` 中的轮询循环拉取新消息 → `findChannel(channels, 'tg:...')` → 路由到 `TelegramChannel`
6. Agent 输出 → `channel.sendMessage()` → `bot.api.sendMessage()`（超过 4096 字符自动分片）

### @提及翻译

检测 Telegram `@bot_username` 实体，若消息尚未匹配 `TRIGGER_PATTERN`，则在前面添加触发词（`@AssistantName`）。这将 Telegram 原生提及系统桥接到 NanoClaw 基于触发词的路由机制。

## 用户故事

### US-1：安装 Telegram 通道

**角色**：NanoClaw 用户
**目标**：在现有 WhatsApp 安装上添加 Telegram 支持

1. 用户在 Claude Code 中执行 `/add-telegram`
2. 技能询问运行模式：替换 WhatsApp 还是并行运行
3. 技能询问是否已有 Bot Token
4. 技能引擎执行代码变更（`apply-skill.ts`）
5. `npm test && npm run build` 验证通过
6. 用户按指引在 BotFather 创建 Bot（若无 Token）
7. Token 写入 `.env` 并同步到 `data/env/env`
8. 重启服务，Bot 上线

### US-2：注册 Telegram 聊天

**角色**：NanoClaw 用户
**目标**：将 Telegram 私聊或群组注册为受管通道

1. 用户在 Telegram 中向 Bot 发送 `/chatid`
2. Bot 回复 `tg:{chatId}`、聊天名称和类型
3. 用户将 Chat ID 提供给 Claude Code
4. 系统调用 `registerGroup("tg:<chatId>", {...})` 写入 SQLite
5. 创建对应的 `groups/{folder}/` 目录结构
6. 后续消息即可被轮询循环捕获并路由到 Agent

### US-3：在群组中通过 @提及触发 Agent

**角色**：Telegram 群组成员
**目标**：在群组中 @Bot 来触发 AI 回复

1. 用户在群组中发送 `@andy_ai_bot 今天天气怎么样`
2. `TelegramChannel` 检测到 `@bot_username` 实体
3. 消息不匹配 `TRIGGER_PATTERN`（`^@Andy\b`），自动前置 `@Andy`
4. 转换后内容：`@Andy @andy_ai_bot 今天天气怎么样`
5. 消息存入 SQLite，轮询循环检测到触发词
6. `processGroupMessages` 拉取待处理消息 → `runAgent` → 容器内 Agent 处理
7. Agent 输出通过 `channel.sendMessage()` 发回群组

### US-4：接收非文本消息

**角色**：Telegram 用户
**目标**：发送图片/语音/文件等，Agent 知道收到了什么

1. 用户在已注册聊天中发送一张带标题的图片
2. `bot.on('message:photo')` 触发 `storeNonText` 处理器
3. 消息内容存储为 `[Photo] 用户的标题文字`
4. Agent 在上下文中看到占位符，知道用户发送了图片及其标题

### US-5：仅 Telegram 模式

**角色**：不使用 WhatsApp 的用户
**目标**：完全替换 WhatsApp，仅用 Telegram

1. 用户在安装时选择"替换 WhatsApp"
2. `.env` 中设置 `TELEGRAM_ONLY=true`
3. `main()` 中 `if (!TELEGRAM_ONLY)` 条件跳过 WhatsApp 通道创建
4. `channels[]` 数组仅包含 `TelegramChannel`
5. 所有消息路由、定时任务、IPC 均通过 Telegram 通道工作

## 集成接口规范

### Channel 接口（`src/types.ts`）

`TelegramChannel` 实现的核心抽象：

```typescript
interface Channel {
  name: string; // "telegram"
  connect(): Promise<void>; // 启动 Grammy Bot 长轮询
  sendMessage(jid: string, text: string): Promise<void>; // 发送消息，超 4096 字符自动分片
  isConnected(): boolean; // Bot 实例是否存在
  ownsJid(jid: string): boolean; // jid.startsWith('tg:')
  disconnect(): Promise<void>; // Bot.stop()
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // sendChatAction('typing')
}
```

### 回调类型（`src/types.ts`）

通道通过回调将入站消息和元数据传递给主进程：

```typescript
// 入站消息回调 — 通道收到消息后调用，写入 SQLite
type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// 聊天元数据回调 — 用于聊天发现和名称同步
type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string, // Telegram 内联传递聊天名称；WhatsApp 通过 syncGroupMetadata 单独同步
  channel?: string, // "telegram" | "whatsapp"
  isGroup?: boolean,
) => void;
```

### TelegramChannel 构造参数

```typescript
interface TelegramChannelOpts {
  onMessage: OnInboundMessage; // → storeMessage()
  onChatMetadata: OnChatMetadata; // → storeChatMetadata()
  registeredGroups: () => Record<string, RegisteredGroup>; // 运行时查询已注册群组
}

// 构造：new TelegramChannel(botToken: string, opts: TelegramChannelOpts)
```

### JID 命名空间

| 通道          | JID 格式               | 示例                      | ownsJid 判定                  |
| ------------- | ---------------------- | ------------------------- | ----------------------------- |
| Telegram 私聊 | `tg:{userId}`          | `tg:100200300`            | `startsWith('tg:')`           |
| Telegram 群组 | `tg:{negativeGroupId}` | `tg:-1001234567890`       | `startsWith('tg:')`           |
| WhatsApp 群组 | `{id}@g.us`            | `12345678@g.us`           | `endsWith('@g.us')`           |
| WhatsApp 私聊 | `{id}@s.whatsapp.net`  | `12345678@s.whatsapp.net` | `endsWith('@s.whatsapp.net')` |

### 路由函数（`src/router.ts`）

```typescript
// 根据 JID 前缀/后缀查找对应通道
function findChannel(channels: Channel[], jid: string): Channel | undefined;
// 实现：channels.find(c => c.ownsJid(jid))
```

### 环境变量

| 变量                 | 类型    | 默认值  | 说明                                                   |
| -------------------- | ------- | ------- | ------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | string  | `""`    | BotFather 颁发的 Bot Token，为空则不创建 Telegram 通道 |
| `TELEGRAM_ONLY`      | boolean | `false` | 为 `true` 时跳过 WhatsApp 通道创建                     |

两个变量均通过 `readEnvFile()` 从 `.env` 读取，遵循 `process.env` → `envConfig` 的回退链。容器环境需同步到 `data/env/env`。

### Telegram Bot 命令

| 命令      | 功能                  | 响应格式                                                      |
| --------- | --------------------- | ------------------------------------------------------------- |
| `/chatid` | 返回当前聊天的注册 ID | ``Chat ID: `tg:{id}`\nName: {name}\nType: {type}`` (Markdown) |
| `/ping`   | 检查 Bot 在线状态     | `{ASSISTANT_NAME} is online.`                                 |

### 消息长度限制

Telegram API 单条消息上限 4096 字符。`sendMessage` 自动按 4096 字符边界分片发送，无需调用方处理。

## 集成关系

- **消费方**：`scripts/apply-skill.ts`（技能引擎）、Claude Code `/add-telegram` 技能调用
- **依赖**：`Channel` 接口（`src/types.ts`）、`findChannel`（`src/router.ts`）、`readEnvFile`（`src/env.ts`）、`grammy` npm 包
- **应用时修改**：`src/index.ts`、`src/config.ts`、`src/routing.test.ts`、`.env.example`、`package.json`
- **关联技能**：`/add-telegram-swarm`（Agent 群组协作支持，需先安装本技能）
