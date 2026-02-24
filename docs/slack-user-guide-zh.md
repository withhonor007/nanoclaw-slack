# NanoClaw Slack 用户手册

---

## 目录

1. [概述](#概述)
2. [前置条件](#前置条件)
3. [安装](#安装)
4. [创建 Slack App](#创建-slack-app)
5. [配置 Token](#配置-token)
6. [注册频道](#注册频道)
7. [日常使用](#日常使用)
8. [Main Channel 管理员功能](#main-channel-管理员功能)
9. [消息格式与限制](#消息格式与限制)
10. [运维与监控](#运维与监控)
11. [故障排查](#故障排查)
12. [已知限制](#已知限制)
13. [卸载](#卸载)

---

## 概述

NanoClaw 支持将 Slack 作为消息通道，与 WhatsApp 并行运行或完全替代 WhatsApp。Slack 集成使用 Socket Mode（出站 WebSocket 连接），无需公网 IP 或 HTTP 端点。

核心特性：
- 通过 @mention 或触发词触发 AI Agent
- 支持 Main Channel（管理员频道）和普通频道两种模式
- 每个频道拥有独立的文件系统和记忆（`CLAUDE.md`）
- 消息超过 40,000 字符自动分片发送
- 内置 Bot 自循环防护、事件去重、Socket 断线重连

---

## 前置条件

| 条件 | 说明 |
|------|------|
| NanoClaw 已安装 | 已完成 `/setup`，服务正常运行 |
| Claude Code | 已安装并可用 |
| Slack 工作区 | 你拥有管理员权限（用于创建 App） |
| Node.js 20+ | 运行环境 |

---

## 安装

在 Claude Code 中运行：

```
/add-slack
```

技能会询问两个问题：

1. **运行模式**：替换 WhatsApp 还是并行运行？
   - 替换 → 设置 `SLACK_ONLY=true`，WhatsApp 通道不会启动
   - 并行 → 两个通道同时运行（默认）

2. **是否已有 Slack App**：如果已有，直接提供 Token；如果没有，下一步创建。

技能引擎会自动完成代码变更、依赖安装和测试验证。

---

## 创建 Slack App

如果你还没有 Slack App，按以下步骤创建：

### 步骤 1：生成 App Manifest

```bash
npx tsx .claude/skills/add-slack/scripts/generate-manifest.ts "你的Bot名称"
```

这会输出一个一键创建链接。

### 步骤 2：创建 App

点击生成的链接，Slack 会自动配置所有必需的权限和事件订阅：

- `app_mentions:read` — 接收 @提及
- `channels:history` / `groups:history` / `im:history` — 读取消息
- `chat:write` — 发送消息
- `users:read` — 查询用户信息
- Socket Mode 已启用
- 事件订阅已配置（`app_mention`、`message.channels`、`message.im`）

### 步骤 3：获取 Token

| Token | 位置 | 格式 |
|-------|------|------|
| Bot Token | **Install App** → Install to Workspace → Bot User OAuth Token | `xoxb-...` |
| App Token | **Socket Mode** → App-Level Tokens → 创建（scope: `connections:write`） | `xapp-...` |

---

## 配置 Token

将 Token 写入 `.env` 文件：

```bash
# .env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# 可选：仅使用 Slack，不启动 WhatsApp
# SLACK_ONLY=true
```

同步到容器环境（容器读取 `data/env/env`，不直接读 `.env`）：

```bash
mkdir -p data/env && cp .env data/env/env
```

重启服务：

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user restart nanoclaw
```

---

## 注册频道

Bot 启动后，需要注册频道才能响应消息。

### 获取频道 ID

1. 在 Slack 中邀请 Bot 到频道：`/invite @你的Bot名称`
2. 在频道中发送任意消息提及 Bot，或直接发送 `!chatid`
3. Bot 会回复频道 ID，格式为 `slack:C0123456789`
4. DM（私聊）：直接给 Bot 发消息，发送 `!chatid` 获取 ID

频道 ID 前缀含义：

| 前缀 | 类型 |
|------|------|
| `C` | 公共频道 |
| `G` | 私有频道 / 群组 DM |
| `D` | 1:1 私聊 |

### 注册为 Main Channel（管理员频道）

Main Channel 是你的私人管理频道，拥有最高权限。建议使用 DM 或私有频道。

在 Claude Code 中告诉 Agent：
```
注册 slack:D0123456789 为 main channel，名称为 "My Admin"
```

Main Channel 特权：
- 无需触发词，所有消息直接路由到 Agent
- Agent 容器可访问整个项目根目录
- 可查看和管理所有已注册频道
- 可查看和管理所有定时任务
- 可向任意频道发送消息（跨组 IPC）

### 注册普通频道

```
注册 slack:C0123456789 为普通频道，名称为 "Team Chat"
```

普通频道特性：
- 需要 @mention 或触发词（默认 `@Andy`）才能触发 Agent
- Agent 容器只能访问该频道自己的 `groups/{folder}/` 目录
- 无法看到其他频道的数据
- 拥有独立的 `CLAUDE.md` 记忆文件

---

## 日常使用

### 在 Main Channel 中

直接发送任何消息，无需触发词：
```
今天有什么新邮件？
列出所有定时任务
给 Team Chat 频道发一条提醒
```

### 在普通频道中

使用 @mention 触发：
```
@Andy 帮我总结一下今天的讨论
@Andy 这个 bug 怎么修？
```

或者使用触发词（默认 `@Andy`）：
```
@Andy 查一下最近的销售数据
```

### 内置命令

| 命令 | 功能 | 适用范围 |
|------|------|----------|
| `!chatid` | 返回当前频道的注册 ID | 所有频道（含未注册） |

### 文件附件

Slack 中发送的文件会以占位符形式传递给 Agent：
- 普通文件：`[File: report.pdf]`
- 图片：`[File: screenshot.png]`

Agent 可以看到文件名但无法下载文件内容。

---

## Main Channel 管理员功能

Main Channel（`folder: 'main'`）是 NanoClaw 的控制中心，拥有以下独占能力：

| 能力 | 说明 |
|------|------|
| 免触发词 | 所有消息直接处理，无需 `@Andy` 前缀 |
| 完整项目访问 | 容器挂载整个项目根目录（`/workspace/project`） |
| 跨组可见 | 可查看所有已注册频道列表 |
| 全局任务管理 | 可查看、创建、暂停、删除所有频道的定时任务 |
| 跨组消息 | 可通过 IPC 向任意已注册频道发送消息 |

示例用法：
```
列出所有频道的定时任务
暂停 Team Chat 的周一简报任务
给 slack:C0123456789 发一条消息：明天下午 3 点开会
每个工作日早上 9 点发送销售概览到 Team Chat
```

普通频道的 Agent 只能看到自己的任务和文件，无法访问其他频道的数据。这是容器级隔离，由操作系统保证。

---

## 消息格式与限制

| 项目 | 限制 |
|------|------|
| 单条消息最大长度 | 40,000 字符（超长自动分片） |
| 消息格式 | Agent 输出为 Markdown，Slack 直接显示（不转换为 mrkdwn） |
| 代码块 | ` ``` ` 语法在 Slack 中正常渲染 |
| 引用 | `> ` 语法在 Slack 中正常渲染 |
| 粗体/斜体 | Markdown 的 `**bold**` 和 `*italic*` 在 Slack 中可能显示异常，但可读 |
| 链接 | Markdown 的 `[text](url)` 不会自动转换为 Slack 格式，URL 仍可点击 |

---

## 运维与监控

### 日志查看

```bash
tail -f logs/nanoclaw.log
```

关键日志事件：

| 事件 | 含义 |
|------|------|
| `Slack bot connected via Socket Mode` | 连接成功 |
| `slack_rate_limited` | 触发 Slack API 速率限制，自动等待重试 |
| `slack_send_failed` | 消息发送失败（重试耗尽） |
| `socket_stale` | 3 分钟无事件，触发重连 |
| `socket_reconnect` | 重连结果（成功/失败） |
| `token_revoked` | Token 被撤销，Bot 断开连接 |
| `app_uninstalled` | App 被卸载，Bot 断开连接 |

### 数据库查询

```bash
# 查看已注册的 Slack 频道
sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"

# 查看最近的 Slack 消息
sqlite3 store/messages.db "SELECT * FROM messages WHERE chat_jid LIKE 'slack:%' ORDER BY timestamp DESC LIMIT 10"
```

### 安全机制

Slack 集成包含以下自动防护：

| 机制 | 说明 |
|------|------|
| Bot 自循环防护 | 三层过滤：subtype 过滤 + botUserId 对比 + bot_id 过滤 |
| 事件去重 | `channel:ts` 键 + 5 分钟 TTL 内存 Map |
| 速率限制 | Bolt 自动处理 429 Retry-After，3 次指数退避重试 |
| Socket 看门狗 | 每 60 秒检查，3 分钟无事件自动重连 |
| Token 生命周期 | 监听 `tokens_revoked` 和 `app_uninstalled` 事件 |
| Safe Mode | `auth.test()` 失败时进入安全模式，强制过滤所有 Bot 消息 |

---

## 故障排查

### Bot 不响应

按顺序检查：

1. Token 是否配置：`.env` 中有 `SLACK_BOT_TOKEN`（`xoxb-`）和 `SLACK_APP_TOKEN`（`xapp-`）
2. 是否同步到容器：`data/env/env` 内容与 `.env` 一致
3. Socket Mode 是否启用：Slack App 设置页面确认
4. 频道是否注册：
   ```bash
   sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"
   ```
5. 非 Main Channel 是否包含触发词：消息需以 `@Andy` 开头或 @mention Bot
6. 服务是否运行：
   ```bash
   # macOS
   launchctl list | grep nanoclaw
   # Linux
   systemctl --user status nanoclaw
   ```
7. 检查日志：`grep -E 'token_revoked|socket_stale|slack_send_failed' logs/nanoclaw.log`

### 重复响应

- 正常情况下不会发生（事件去重机制保护）
- 如果发生，检查日志中是否有相同 `ts` 值的重复事件
- 重启后内存去重 Map 会清空，但 SQLite 的唯一约束仍然防护重复写入

### Socket 断线

- 搜索日志：`grep -E 'socket_stale|socket_reconnect' logs/nanoclaw.log`
- `socket_stale` 表示 3 分钟无事件，安静时段属正常
- `socket_reconnect` 带错误表示重连失败，检查 `SLACK_APP_TOKEN` 是否有效
- 如果 `reconnect_attempt` 持续增长，App Token 可能已撤销，需在 Slack 设置中重新生成

### 速率限制

- 搜索日志：`grep slack_rate_limited logs/nanoclaw.log`
- `retry_after_s` 字段显示等待时间
- 如果频繁触发，减少消息发送频率
- 连续 3 次最终失败会记录 `slack_send_failed`

---

## 已知限制

| 限制 | 说明 | 状态 |
|------|------|------|
| 无打字指示器 | Slack 不提供 Bot 打字状态 API | 平台限制 |
| 无处理中状态消息 | 不会发送"思考中..."状态 | 设计选择 |
| 文件不可下载 | 仅传递文件名占位符 | 计划中 |
| 无 mrkdwn 转换 | Markdown 粗体/斜体/链接可能显示异常 | 设计选择 |
| 无线程级隔离 | 所有消息在频道级别处理，不区分线程 | 设计选择 |
| 无交互模式 | 不支持 `!open`/`!close` 免触发词模式 | 延后 |
| 不响应 Slack Connect 外部用户 | 跨组织用户消息不处理 | 延后 |
| 已归档频道无检测 | 发送失败会记录日志但不会提前检测 | 低优先级 |

---

## 卸载

1. 删除源文件：`src/channels/slack.ts` 和 `src/channels/slack.test.ts`
2. 从 `src/index.ts` 中移除 `SlackChannel` 导入和创建逻辑
3. 从 `src/config.ts` 中移除 Slack 配置导出
4. 清除 SQLite 中的 Slack 注册：
   ```bash
   sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'slack:%'"
   ```
5. 卸载依赖：`npm uninstall @slack/bolt`
6. 重新构建并重启：
   ```bash
   npm run build
   # macOS
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   # Linux
   systemctl --user restart nanoclaw
   ```
