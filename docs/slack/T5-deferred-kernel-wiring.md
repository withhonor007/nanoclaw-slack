# T5: 延迟内核接线

## 状态: DEFERRED

不在当前执行范围内。本阶段不对 `src/index.ts` 或 `src/config.ts` 进行任何代码变更。

此任务延迟至"多渠道并行部署"重构阶段。范围锁定决策记录于 `feature_docs/slack-prd/technical-debt.md`：所有内核修改（`src/index.ts`、`src/config.ts`、`src/types.ts`、`src/db.ts`、`src/router.ts`）均不在 Slack 单渠道集成的范围之内。当前阶段任务（T1-T4、T6-T11）不依赖本任务。

---

## 激活模型

基于 token 存在性的激活方式，与 Telegram 模式对称：

- 当 **同时** 存在 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN` 且均非空时，Slack 渠道激活。
- 不设独立的 `SLACK_ENABLE` 标志。两个 token 同时存在即为激活信号。
- `SLACK_ONLY=true` 快速失败：若 `SLACK_ONLY` 为 true 且任一 token 缺失，则记录错误并调用 `process.exit(1)`。这可防止 WhatsApp 被禁用而 Slack 又无法启动的状态。
- 未设置 `SLACK_ONLY` 时，Slack 与 WhatsApp 并行运行，通过 JID 前缀（`slack:` 与无前缀）进行路由。

---

## src/config.ts 变更（已延迟）

### 需要添加的内容

将 `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_ONLY` 和 `SLACK_FILTER_BOT_MESSAGES` 添加到 `readEnvFile()` 的 keys 数组中。NanoClaw 不会自动将 `.env` 加载到 `process.env`，因此所有 `.env` 中的值必须通过 `readEnvFile()` 显式请求。

```typescript
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  // ... existing keys ...
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_ONLY',
  'SLACK_FILTER_BOT_MESSAGES',
]);
```

使用与 `ASSISTANT_NAME` 相同的模式导出每个常量（优先读取 `process.env`，回退到 `envConfig`）：

```typescript
export const SLACK_BOT_TOKEN: string =
  process.env.SLACK_BOT_TOKEN || envConfig.SLACK_BOT_TOKEN || '';

export const SLACK_APP_TOKEN: string =
  process.env.SLACK_APP_TOKEN || envConfig.SLACK_APP_TOKEN || '';

export const SLACK_ONLY: boolean =
  (process.env.SLACK_ONLY || envConfig.SLACK_ONLY) === 'true';

export const SLACK_FILTER_BOT_MESSAGES: boolean =
  (process.env.SLACK_FILTER_BOT_MESSAGES ||
    envConfig.SLACK_FILTER_BOT_MESSAGES ||
    'true') === 'true';
```

### 不变量（来自 intent.md）

- 所有现有配置导出保持不变。Slack 配置仅为追加。
- 新导出追加在文件末尾。
- 不修改任何现有行为。
- 同时检查 `process.env` 和 `envConfig`（与 `ASSISTANT_NAME` 模式相同）。
- 保留 `readEnvFile` 模式。所有从 `.env` 读取的配置必须通过此函数。
- `escapeRegex` 辅助函数和 `TRIGGER_PATTERN` 构造保持不变。
- 所有现有导出（`ASSISTANT_NAME`、`POLL_INTERVAL`、`TRIGGER_PATTERN` 等）均保留。

---

## src/index.ts 变更（已延迟）

### 需要添加的内容

**导入：**

```typescript
import { SlackChannel } from './channels/slack.js';
import {
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN,
  SLACK_FILTER_BOT_MESSAGES,
  SLACK_ONLY,
} from './config.js';
import { findChannel } from './router.js';
import type { Channel } from './types.js';
```

**模块级状态：**

```typescript
const channels: Channel[] = [];
// whatsapp: WhatsAppChannel is still kept for syncGroupMetadata reference
```

**main() 渠道创建：**

```typescript
const channelOpts = {
  /* shared callbacks */
};

if (!SLACK_ONLY) {
  whatsapp = new WhatsAppChannel(channelOpts);
  channels.push(whatsapp);
  await whatsapp.connect();
}

if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  const slack = new SlackChannel(SLACK_BOT_TOKEN, SLACK_APP_TOKEN, channelOpts);
  channels.push(slack);
  await slack.connect();
}

// SLACK_ONLY fail-fast
if (SLACK_ONLY && (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN)) {
  logger.error(
    'SLACK_ONLY=true but SLACK_BOT_TOKEN or SLACK_APP_TOKEN is missing',
  );
  process.exit(1);
}
```

**关闭：**

```typescript
for (const ch of channels) {
  await ch.disconnect();
}
```

**processGroupMessages() 和 startMessageLoop()：**

将直接调用 `whatsapp.sendMessage()` 和 `whatsapp.setTyping()` 替换为渠道感知路由：

```typescript
const channel = findChannel(channels, chatJid);
if (!channel) {
  /* log and return */
}

await channel.setTyping?.();
// ...
await channel.sendMessage(jid, text);
```

调度器和 IPC 的 `sendMessage` 调用也通过 `findChannel()` 路由。

### 不变量（来自 intent.md）

- 所有现有消息处理逻辑（触发器、游标、空闲计时器）均保留。
- `runAgent` 函数完全不变。
- 状态管理（`loadState`/`saveState`）不变。
- 恢复逻辑不变。
- 容器运行时检查不变（`ensureContainerSystemRunning`）。
- `escapeXml` 和 `formatMessages` 的重新导出保留。
- `_setRegisteredGroups` 测试辅助函数保留。
- 底部的 `isDirectRun` 守卫保留。
- `processGroupMessages` 中所有错误处理和游标回滚逻辑保留。
- 出站队列刷新和重连逻辑（在 `WhatsAppChannel` 中）不受影响。

---

## 触发条件

仅当以下所有条件均为真时才执行本任务：

1. "多渠道并行部署"重构阶段已启动。
2. Slack 单渠道集成已完成（T1-T4、T6-T11 全部完成并已上线）。
3. 技术债务 #1（`*_ONLY` 互斥 / `CHANNEL_MODE` 枚举）已按 `feature_docs/slack-prd/technical-debt.md` 解决。
4. 第二个渠道（Telegram 或其他）正在与 Slack 并行集成。

不得提前执行。当前单渠道 Slack 路径无需内核接线即可工作，因为 `src/channels/slack.ts` 直接应用，技能包自行处理集成。

---

## 预写验收标准

以下标准在本任务执行时可直接使用：

- [ ] 基于 token 存在性的激活模型已实现：`SLACK_BOT_TOKEN && SLACK_APP_TOKEN` 激活 Slack，不存在 `SLACK_ENABLE` 标志。
- [ ] `SLACK_ONLY=true` 且任一 token 缺失时触发 `process.exit(1)` 并输出结构化错误日志。
- [ ] `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_ONLY`、`SLACK_FILTER_BOT_MESSAGES` 使用 `process.env` + `envConfig` 回退模式从 `src/config.ts` 导出。
- [ ] 所有四个键均存在于 `readEnvFile()` 调用中。
- [ ] `const channels: Channel[] = []` 在 `src/index.ts` 的模块级声明。
- [ ] WhatsApp 创建由 `if (!SLACK_ONLY)` 守卫。
- [ ] Slack 创建由 `if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN)` 守卫。
- [ ] 关闭循环通过 `for (const ch of channels)` 断开所有渠道连接。
- [ ] `processGroupMessages()` 通过 `findChannel()` 路由出站消息，而非直接调用 `whatsapp.sendMessage()`。
- [ ] `startMessageLoop()` 通过 `channel.setTyping?.()` 路由输入指示器。
- [ ] 调度器和 IPC 的 `sendMessage` 调用通过 `findChannel()` 路由。
- [ ] 所有现有测试通过（`npm test`）。
- [ ] 构建干净（`npm run build`）。
- [ ] 当前阶段任务（T1-T4、T6-T11）不依赖本任务完成。

---

## 已知问题（来自 T2 审计）

T2 运行时差异审计期间发现了两个热点问题。执行本任务时必须解决：

**问题 1：`SLACK_SIGNING_SECRET` 导入不匹配**

`modify/src/index.ts` 从 `./config.js` 导入 `SLACK_SIGNING_SECRET`，但 `modify/src/config.ts` 并未导出 `SLACK_SIGNING_SECRET`。应用内核接线时将导致 TypeScript 编译错误。解决方案：要么将 `SLACK_SIGNING_SECRET` 添加到 `src/config.ts` 的导出中，要么从 `src/index.ts` 中移除该导入（Socket Mode 不使用签名密钥，因此移除是正确的修复方式）。

**问题 2：`SLACK_ONLY=true` 且 token 缺失时产生零渠道**

在技能包的 `modify/src/index.ts` 中，若 `SLACK_ONLY=true` 且两个 Slack token 均缺失，WhatsApp 守卫（`if (!SLACK_ONLY)`）会跳过 WhatsApp 创建，Slack 守卫（`if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN)`）也会跳过 Slack 创建。结果是 `channels` 数组为空且没有快速失败守卫。进程启动但无法处理任何消息。解决方案：在渠道创建块之前添加上述激活模型部分描述的快速失败检查。

---

## Enforcement Record (2026-02-23)

During T4-T9 execution, `src/index.ts` and `src/config.ts` were directly modified in violation of the skill-first principle. The changes were reverted and all hardened Slack code was moved into `.claude/skills/add-slack/add/src/channels/`. The roadmap was updated with a hard rule: current-phase code must land in the skill package only; `src/` is written exclusively by `apply-skill.ts` at T5 activation time. See `.sisyphus/plans/slack-roadmap-next-phase.md` "开发原则强制执行" section for full details.
