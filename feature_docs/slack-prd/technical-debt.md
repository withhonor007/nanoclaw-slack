# 技术债务：跨通道交互问题

> 文档版本: 1.2
> 创建日期: 2026-02-23
> 更新日期: 2026-02-23
> 关联开发: Slack 通道集成 (slack-prd v1.1)
> 优先级: 中 — Slack 单通道开发完成后、多通道并行部署前必须解决

### 开发决策声明

> **当前开发目标为 Slack 通道集成。以下所有技术债务均涉及项目内核修改（`src/index.ts`、`src/config.ts`、`src/types.ts`、`src/db.ts`），不在 Slack 通道开发的考虑范围内。**
>
> Slack 通道集成采用与 Telegram 对称的 `SLACK_ONLY` 标志模式，保持技能包间的一致性。内核级统一（如 `CHANNEL_MODE` 枚举、多通道路由增强）留待多通道并行部署前的专项重构阶段。
>
> Slack 开发期间的兼容性保证：
> - `SLACK_ONLY=true` 时跳过 WhatsApp，仅启动 Slack — 单通道场景无冲突
> - 不配置 `SLACK_ONLY` 时，Slack 与 WhatsApp 并行 — 通过 JID 前缀（`slack:`）路由隔离
> - 不触碰 `src/types.ts`、`src/router.ts`、`src/db.ts` 的现有逻辑

---

## 1. `*_ONLY` 标志互斥语义未定义

### 问题描述

当前每个通道技能包都引入了自己的 `*_ONLY` 标志：

| 标志 | 来源 | 语义 |
|------|------|------|
| `SLACK_ONLY=true` | add-slack 技能包 | 禁用 WhatsApp 通道创建 |
| `TELEGRAM_ONLY=true` | add-telegram 技能包 | 禁用 WhatsApp 通道创建 |

但以下场景的行为完全未定义：

- `SLACK_ONLY=true` + `TELEGRAM_ONLY=true` — 两个通道都声称"仅此通道"，谁赢？
- `SLACK_ONLY=true` + Telegram token 存在 — Slack 禁用了 WhatsApp，但 Telegram 是否应该启动？
- `TELEGRAM_ONLY=true` + Slack tokens 存在 — 同上反向
- 三个通道同时配置 — 无优先级规则

### 当前临时方案

Slack 开发阶段默认 `SLACK_ONLY=true` 时 Slack 通道赢，不配置其他通道。这是一个硬编码假设，不是通用解决方案。

### 建议方案

**方案 A: 统一 `CHANNEL_MODE` 枚举**

```bash
# 替代所有 *_ONLY 标志
CHANNEL_MODE=slack        # 仅 Slack
CHANNEL_MODE=telegram     # 仅 Telegram
CHANNEL_MODE=whatsapp     # 仅 WhatsApp（默认）
CHANNEL_MODE=multi        # 所有已配置的通道并行
```

优点：语义清晰，无歧义。缺点：需要修改所有已发布的技能包。

**方案 B: 优先级链 + 自动降级**

```typescript
// index.ts main()
const priority = ['slack', 'telegram', 'whatsapp'];
// 如果多个 *_ONLY 为 true，按优先级取第一个
// 如果没有 *_ONLY，启动所有已配置的通道
```

优点：向后兼容。缺点：隐式行为，用户难以预测。

### 影响范围

- `src/index.ts` — `main()` 函数中的通道创建逻辑
- `src/config.ts` — 可能需要新增 `CHANNEL_MODE` 导出
- 所有通道技能包的 `index.ts.intent.md` — 需要更新条件创建描述
- 所有通道技能包的 `SKILL.md` — 需要更新配置说明

---

## 2. config.ts 基础文件漂移

### 问题描述

每个通道技能包的 `modify/src/config.ts` 都包含完整的 config.ts 副本（三方合并的"修改后"版本）。这些副本的基础部分已经出现分歧：

| 差异点 | Telegram 技能包 | Slack 技能包 | 当前项目 src/config.ts |
|--------|----------------|-------------|----------------------|
| `import` | `import path` | `import os` + `import path` | `import os` + `import path` |
| `HOME_DIR` | `process.env.HOME \|\| '/Users/user'` (硬编码) | `process.env.HOME \|\| os.homedir()` | `process.env.HOME \|\| os.homedir()` |

### 风险

- Telegram 技能包的基础文件是旧版本，如果在 Slack 之后应用，三方合并可能产生冲突或回退 `os.homedir()` 改进
- 如果项目 config.ts 继续演进（新增导出、修改常量），所有技能包的基础文件都会过时

### 建议方案

1. **短期**: 更新 Telegram 技能包的 `modify/src/config.ts` 基础部分，使其与当前项目 `src/config.ts` 一致（`import os`, `os.homedir()`）
2. **长期**: 技能引擎应该只存储 diff/patch 而非完整文件副本，避免基础文件漂移问题

### 影响范围

- `.claude/skills/add-telegram/modify/src/config.ts` — 需要更新基础部分
- `skills-engine/migrate.ts` — 长期需要重构合并策略

---

## 3. Telegram 技能包 HOME_DIR 硬编码

### 问题描述

Telegram 技能包的 `modify/src/config.ts` 第 24 行：

```typescript
const HOME_DIR = process.env.HOME || '/Users/user';
```

这是一个 macOS 特定的硬编码回退值。在 Linux 上 `HOME` 环境变量通常存在，但如果缺失，回退到 `/Users/user` 是错误的（Linux 应该是 `/home/user` 或使用 `os.homedir()`）。

### 当前状态

项目主代码 `src/config.ts` 已经修复为 `os.homedir()`。但 Telegram 技能包的副本仍然是旧版本。

### 修复方案

将 Telegram 技能包的 config.ts 第 1 行和第 24 行更新为：

```typescript
import os from 'os';
import path from 'path';
// ...
const HOME_DIR = process.env.HOME || os.homedir();
```

### 优先级

低 — 仅在 Linux 上且 `HOME` 环境变量缺失时触发。但作为代码质量问题应该修复。

---

## 4. 多通道消息路由冲突

### 问题描述

当前 `findChannel(channels, chatJid)` 通过 JID 前缀匹配通道（`slack:*` → SlackChannel, `telegram:*` → TelegramChannel）。但以下场景未处理：

- 同一用户在多个通道注册了同一个 group folder — 消息可能重复处理
- 定时任务的 `sendMessage` 需要指定目标通道 — 当前通过 `findChannel` 按 JID 查找，但如果任务创建时的通道已断开？
- IPC 回调的通道查找 — 容器运行期间通道可能重连，`channels` 数组引用可能过时

### 当前临时方案

Slack 开发阶段假设 `SLACK_ONLY=true`，不存在多通道并行场景。

### 建议方案

在多通道并行部署前，需要：

1. 定义 group folder 与通道的绑定关系（一个 folder 只能属于一个通道？还是可以跨通道？）
2. 定时任务存储目标通道标识，而非仅存储 JID
3. IPC 回调使用通道 ID 查找而非数组引用

---

## 解决时间线

| 债务项 | 阻塞场景 | 建议解决时机 | Slack 开发影响 |
|--------|----------|-------------|---------------|
| #1 `*_ONLY` 互斥 | 多通道并行部署 | Slack 开发完成后、第二通道集成前 | 无 — Slack 采用 `SLACK_ONLY` 与 Telegram 对称 |
| #2 config.ts 漂移 | Telegram + Slack 同时应用 | 下次 Telegram 技能包更新时 | 无 — Slack 技能包基础文件已与主项目一致 |
| #3 HOME_DIR 硬编码 | Linux 部署（无 HOME 变量） | 随 #2 一起修复 | 无 — 仅影响 Telegram 技能包 |
| #4 多通道路由 | 多通道并行部署 | 随 #1 一起设计 | 无 — Slack JID 前缀路由已通过 `ownsJid()` 支持 |

---

## 代码验证分析与配置优化修复建议

> 分析日期: 2026-02-23
> 基于: 当前 `src/index.ts`, `src/config.ts`, `src/router.ts`, 以及 `.claude/skills/add-slack/` 和 `.claude/skills/add-telegram/` 技能包的实际代码
> 状态: 以下建议均为未来内核重构参考，不在 Slack 通道集成范围内

---

### #1 修复建议：统一 `CHANNEL_MODE` 配置项

**代码现状验证：**

- `src/index.ts` 当前无条件创建 WhatsApp（第 437–439 行），不存在任何 `*_ONLY` 判断逻辑
- `src/config.ts` 不导出 `SLACK_ONLY`、`TELEGRAM_ONLY` 或 `CHANNEL_MODE`
- `*_ONLY` 标志仅存在于技能包的 `modify/` 副本中：
  - add-slack: `if (!SLACK_ONLY)` 守卫 WhatsApp 创建（modify/src/index.ts:442）
  - add-telegram: `if (!TELEGRAM_ONLY)` 守卫 WhatsApp 创建（modify/src/index.ts:485）
- 两个技能包独立添加各自的 `*_ONLY` 到 `readEnvFile()` 调用中

**推荐方案 A（统一 `CHANNEL_MODE`），具体实施：**

1. **`src/config.ts` 变更** — 新增 `CHANNEL_MODE` 配置导出：

```typescript
// 在 readEnvFile 调用中添加 'CHANNEL_MODE'
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'CHANNEL_MODE',
]);

// 新增导出（文件末尾）
export type ChannelMode = 'whatsapp' | 'slack' | 'telegram' | 'multi';
export const CHANNEL_MODE: ChannelMode =
  (process.env.CHANNEL_MODE || envConfig.CHANNEL_MODE || 'whatsapp') as ChannelMode;
```

2. **`src/index.ts` main() 变更** — 基于 `CHANNEL_MODE` 决定通道创建：

```typescript
import { CHANNEL_MODE } from './config.js';

const shouldCreateWhatsApp = CHANNEL_MODE === 'whatsapp' || CHANNEL_MODE === 'multi';
const shouldCreateSlack = CHANNEL_MODE === 'slack' || CHANNEL_MODE === 'multi';
const shouldCreateTelegram = CHANNEL_MODE === 'telegram' || CHANNEL_MODE === 'multi';

if (shouldCreateWhatsApp) {
  whatsapp = new WhatsAppChannel(channelOpts);
  channels.push(whatsapp);
  await whatsapp.connect();
}
if (shouldCreateSlack && SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  const slack = new SlackChannel(...);
  channels.push(slack);
  await slack.connect();
}
if (shouldCreateTelegram && TELEGRAM_BOT_TOKEN) {
  const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
  channels.push(telegram);
  await telegram.connect();
}
if (channels.length === 0) {
  logger.fatal({ CHANNEL_MODE }, 'No channels created — check CHANNEL_MODE and token config');
  process.exit(1);
}
```

3. **向后兼容** — 在 config.ts 中添加 `*_ONLY` → `CHANNEL_MODE` 迁移逻辑：

```typescript
function resolveChannelMode(): ChannelMode {
  const explicit = process.env.CHANNEL_MODE || envConfig.CHANNEL_MODE;
  if (explicit) return explicit as ChannelMode;
  // 向后兼容旧的 *_ONLY 标志
  if ((process.env.SLACK_ONLY || envConfig.SLACK_ONLY) === 'true') return 'slack';
  if ((process.env.TELEGRAM_ONLY || envConfig.TELEGRAM_ONLY) === 'true') return 'telegram';
  return 'whatsapp';
}
export const CHANNEL_MODE = resolveChannelMode();
```

4. **技能包更新** — 两个技能包的 intent.md 需要：
   - 移除各自的 `*_ONLY` 导出，改为依赖统一的 `CHANNEL_MODE`
   - `index.ts` 的条件创建逻辑改为基于 `CHANNEL_MODE` 判断

---

### #2 + #3 修复建议：Telegram 技能包 config.ts 同步

**代码现状验证：**

- `src/config.ts`（主项目）：第 1 行 `import os from 'os'`，第 23 行 `os.homedir()` ✓
- `.claude/skills/add-slack/modify/src/config.ts`：第 1 行 `import os from 'os'`，第 27 行 `os.homedir()` ✓
- `.claude/skills/add-telegram/modify/src/config.ts`：第 1 行缺少 `import os`，第 24 行硬编码 `'/Users/user'` ✗
- 全代码库无其他 `/Users/user` 硬编码（仅本文档引用）

**修复操作（两行变更）：**

文件：`.claude/skills/add-telegram/modify/src/config.ts`

```diff
- import path from 'path';
+ import os from 'os';
+ import path from 'path';
```

```diff
- const HOME_DIR = process.env.HOME || '/Users/user';
+ const HOME_DIR = process.env.HOME || os.homedir();
```

**长期建议不变**：技能引擎应存储 diff/patch 而非完整文件副本。

---

### #4 修复建议：多通道路由配置增强

**代码现状验证：**

- `findChannel`（router.ts:39–43）通过 `channels.find(c => c.ownsJid(jid))` 线性扫描，纯依赖各通道的 `ownsJid()` 实现
- `findChannel` 有 4 个调用点（index.ts），其中 3 个静默丢弃未匹配消息，仅 IPC 路径抛出异常
- `channels` 数组在 `main()` 中一次性填充，通过闭包引用传递给 scheduler 和 IPC — 正确但不透明
- DB `chats.channel` 列存储通道类型字符串（`'whatsapp'`/`'telegram'`/`'discord'`），但运行时路由从不读取此列
- `registered_groups` 以 JID 为键，不包含通道类型信息
- 定时任务仅存储 `chat_jid`，不存储目标通道标识

**配置优化修复方案：**

1. **`registered_groups` 增加通道绑定** — 在 `RegisteredGroup` 类型中添加 `channel` 字段：

```typescript
// src/types.ts
export interface RegisteredGroup {
  name: string;
  folder: string;
  requiresTrigger?: boolean;
  channel: string;  // 'whatsapp' | 'slack' | 'telegram' — 注册时记录来源通道
}
```

2. **定时任务存储通道标识** — `tasks` 表增加 `channel_type` 列：

```sql
ALTER TABLE tasks ADD COLUMN channel_type TEXT DEFAULT 'whatsapp';
```

3. **`findChannel` 增加通道断连降级日志** — 将 3 个静默丢弃点改为 `logger.warn`：

```typescript
// 当前（静默丢弃）：
if (!channel) { console.log(`Warning: ...`); return; }
// 改为：
if (!channel) {
  logger.warn({ jid }, 'No connected channel for JID, message dropped');
  return;
}
```

4. **利用 DB `chats.channel` 列做路由辅助** — 当 `findChannel` 返回 `undefined` 时，查询 DB 确认该 JID 属于哪个通道，提供更有意义的错误信息（如“Slack 通道已断开”而非“无通道匹配”）。

---

### 修复优先级与依赖关系

> 以下修复均为未来内核重构参考，不在 Slack 通道集成范围内。

```
#3 Telegram HOME_DIR ──┐
                       ├──▶ 可立即修复（无依赖，两行变更，仅影响 Telegram 技能包）
#2 config.ts 漂移 ─────┘

#1 CHANNEL_MODE ──────────▶ 多通道并行部署前的内核重构
       │
       └──▶ #4 多通道路由 ──▶ 依赖 #1 完成后实施
```

| 债务项 | 修复复杂度 | 配置变更 | 代码变更 | 可独立修复 | Slack 开发阻塞 |
|--------|-----------|---------|---------|-----------|--------------|
| #3 HOME_DIR | 低（2 行） | 无 | `.claude/skills/add-telegram/modify/src/config.ts` | ✓ | 否 |
| #2 config.ts 漂移 | 低（随 #3） | 无 | 同上 | ✓ | 否 |
| #1 CHANNEL_MODE | 中 | `.env` 新增 `CHANNEL_MODE` | `config.ts` + `index.ts` + 两个技能包 | ✓ | 否 |
| #4 多通道路由 | 高 | DB schema 变更 | `types.ts` + `db.ts` + `index.ts` + `task-scheduler.ts` | ✗（依赖 #1） | 否 |
