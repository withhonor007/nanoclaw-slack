# W1-T2: 运行时差异审计 + 范围锁定

**日期:** 2026-02-23  
**技能包:** `.claude/skills/add-slack/`  
**审计人:** Kiro（自动化差异 + 意图分析）

---

## 1. 文件对分析

### 1.1 `src/config.ts`

**意图文件:** `.claude/skills/add-slack/modify/src/config.ts.intent.md`  
**状态: DEFERRED**

#### 差异摘要

两处独立的纯增量变更，未修改任何现有行：

| 位置                      | 变更内容                                                                                     | 影响行数 |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| `readEnvFile([...])` 调用 | 新增 4 个键：`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_ONLY`, `SLACK_FILTER_BOT_MESSAGES` | ~L11–15  |
| 文件末尾                  | 追加 10 行 Slack 配置块（4 个新导出）                                                        | ~L74–83  |

#### 冲突风险：低

- 与现有行零重叠，两处变更均为纯增量
- `readEnvFile` 数组扩展是在现有数组字面量内安全追加
- 新导出追加至文件末尾，不影响周围代码
- 无现有导出被重命名、移动或改变类型
- `modify/src/index.ts` 中导入的 `SLACK_SIGNING_SECRET` 在 `modify/src/config.ts` 中不存在，这是一处差异（见 §3 热点）

#### 已确认的不变量（来自意图文件）

- 所有现有导出保持不变
- `readEnvFile` 模式保持不变，所有 `.env` 读取均通过此函数
- `escapeRegex` 辅助函数和 `TRIGGER_PATTERN` 构造未被修改
- 新导出遵循与 `ASSISTANT_NAME` 完全相同的模式（process.env → envConfig → 默认值）

---

### 1.2 `src/index.ts`

**意图文件:** `.claude/skills/add-slack/modify/src/index.ts.intent.md`  
**状态: DEFERRED**

#### 差异摘要

三个变更区域：

| 区域 | 位置                | 变更内容                                                                                                             | 影响行数  |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| A    | 导入块（顶部）      | 新增 4 个配置导入（`SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_ONLY`, `SLACK_SIGNING_SECRET`）+ `SlackChannel` 导入 | ~L9–16    |
| B    | `main()` — 频道创建 | 将无条件创建 WhatsApp 替换为条件块，并添加条件性 Slack 创建                                                          | ~L437–457 |
| C    | 文件末尾            | 缺少换行符（外观问题）                                                                                               | 最后一行  |

#### 冲突风险：中

- **区域 A（导入）：** 纯增量，未修改任何现有导入行。风险：低。
- **区域 B（main() 频道创建）：** 这是风险最高的区域。当前运行时无条件创建 WhatsApp：
  ```ts
  // CURRENT (runtime)
  whatsapp = new WhatsAppChannel(channelOpts);
  channels.push(whatsapp);
  await whatsapp.connect();
  ```
  该技能将其包裹在 `if (!SLACK_ONLY)` 中，并添加 Slack 条件块。对 `main()` 此区域的任何并发编辑都会产生冲突。风险：中（独立块，但存在行为变更）。
- **区域 C（文件末尾换行符）：** 外观问题。风险：无。

#### 差异：`SLACK_SIGNING_SECRET`

`modify/src/index.ts` 从 `./config.js` 导入 `SLACK_SIGNING_SECRET`，但 `modify/src/config.ts` **未**导出 `SLACK_SIGNING_SECRET`。这是一个潜在的类型错误，当两个文件同时应用时将在构建阶段暴露。技能中的 `SlackChannel` 构造函数也将其作为参数传入，在 Task 5 应用这些变更之前需要解决此问题。

#### 已确认的不变量（来自意图文件）

- 所有消息处理逻辑（触发器、游标、空闲计时器）保持不变，差异中已确认完全一致
- `runAgent()` 函数完全未变，已确认
- `loadState()` / `saveState()` 未变，已确认
- 恢复逻辑未变，已确认
- `escapeXml` / `formatMessages` 重导出保留，已确认
- `_setRegisteredGroups` 测试辅助函数保留，已确认
- 底部的 `isDirectRun` 守卫保留，已确认

---

### 1.3 `src/routing.test.ts`

**意图文件：** 无（此文件不存在 `.intent.md`）  
**状态: IN SCOPE**

#### 差异摘要

四个变更区域，均为增量：

| 区域 | 变更内容                                                                           | 影响行数      |
| ---- | ---------------------------------------------------------------------------------- | ------------- |
| A    | 导入：移除未使用的 `getAllChats` 导入                                              | L3            |
| B    | 移除 `JID ownership patterns` describe 块内的 2 行注释块                           | L14–15        |
| C    | 在现有 `describe('JID ownership patterns')` 内为 Slack JID 模式新增 2 个 `it()` 块 | After L24     |
| D    | 移除 `excludes non-group chats` 测试内的 3 条内联注释                              | L84, L86, L88 |
| E    | 在 `getAvailableGroups` describe 末尾为 Slack 频道行为新增 3 个 `it()` 块          | After L100    |

#### 冲突风险：低

- 所有新测试均为增量，未修改或删除任何现有测试
- 区域 A（移除导入）：`getAllChats` 在当前文件中已导入但未在任何测试体中使用，可安全移除
- 区域 B（移除注释）：外观问题，无行为变更
- 区域 D（移除内联注释）：外观问题，无行为变更
- 区域 C 和 E（新测试）：纯增量，除非 describe 块结构发生变化，否则不可能产生合并冲突
- 新 Slack 测试依赖 `storeChatMetadata` 接受值为 `'slack'` 的 `channel` 参数，当前 `db.ts` 模式已支持此功能（通过现有测试使用模式确认）

#### 新增测试（区域 C — JID 模式）

```
it('Slack channel JID: starts with slack:')
it('Slack DM JID: starts with slack:')
```

#### 新增测试（区域 E — getAvailableGroups）

```
it('includes Slack channel JIDs')
it('marks registered Slack channels correctly')
it('mixes WhatsApp and Slack chats ordered by activity')
```

#### 合并策略

由于此文件没有 `.intent.md`，合并过程较为直接：

1. 从导入行移除 `getAllChats`
2. 移除 `JID ownership patterns` 中的 2 行注释
3. 在现有 WhatsApp DM 测试之后插入 2 个新 `it()` 块
4. 移除 `excludes non-group chats` 测试中的 3 条内联注释
5. 在 `getAvailableGroups` 的 `});` 闭合前插入 3 个新 `it()` 块

无三方合并复杂性，技能版本是当前文件的干净超集。

---

## 2. 冲突风险矩阵

| 文件                  | 风险等级 | 变更类型        | 冲突区域                         | 范围决策 |
| --------------------- | -------- | --------------- | -------------------------------- | -------- |
| `src/config.ts`       | 低       | 仅增量          | 无，纯追加                       | DEFERRED |
| `src/index.ts`        | 中       | 增量 + 行为变更 | `main()` 频道创建块（~L437–457） | DEFERRED |
| `src/routing.test.ts` | 低       | 增量 + 外观调整 | 无，超集合并                     | IN SCOPE |

---

## 3. 高风险热点

### 热点 1：`SLACK_SIGNING_SECRET` 不匹配（index.ts ↔ config.ts）

- **文件：** `modify/src/index.ts` L12，`modify/src/config.ts`（缺失）
- **风险：** Task 5 同时应用两个文件时出现构建错误
- **详情：** `index.ts` 从 config 导入 `SLACK_SIGNING_SECRET`，但 config 未导出该值。`SlackChannel` 构造函数调用将其作为第 3 个参数传入。解决方案之一：
  - `config.ts` 需要添加 `SLACK_SIGNING_SECRET` 导出（技能包中未包含），或
  - `SlackChannel` 构造函数签名不需要该参数，或
  - 该导入是多余的，应从 `index.ts` 中移除
- **Task 5 前必须处理：** 解决此差异。`SlackChannel` 的实现（位于 `add/src/channels/slack.ts`）将决定正确的修复方式。

### 热点 2：`main()` 中 WhatsApp 条件化（index.ts）

- **文件：** `src/index.ts` ~L437–457
- **风险：** 中，启动序列存在行为变更
- **详情：** 将 WhatsApp 创建包裹在 `if (!SLACK_ONLY)` 中意味着，若 `.env` 配置错误（例如 `SLACK_ONLY=true` 但未提供 Slack 令牌），将导致零频道启动。意图文件提到了针对此情况的快速失败守卫，但 `modify/src/index.ts` 中并不存在，该技能仅检查 `if (SLACK_BOT_TOKEN)`，而不会在 `SLACK_ONLY=true` 且令牌缺失时报错退出。
- **Task 5 前必须处理：** 添加快速失败守卫，或将静默零频道行为记录为可接受。

### 热点 3：`routing.test.ts` — 无 `.intent.md`

- **文件：** `.claude/skills/add-slack/modify/src/routing.test.ts`
- **风险：** 低，但合并必须在无意图指导的情况下手动完成
- **详情：** 此文件不存在 `.intent.md`。差异干净且为增量，因此风险较低，但缺少文档意味着没有可供验证的不变量记录。
- **所需操作：** 无阻塞项。记录合并为干净超集即可。

---

## 4. 范围合同

### IN SCOPE（当前执行 — Task 3/4）

| 条目                              | 来源                             | 备注                                                                                 |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| NEW: `src/channels/slack.ts`      | `add/src/channels/slack.ts`      | 实现 Channel 接口的 SlackChannel 类                                                  |
| NEW: `src/channels/slack.test.ts` | `add/src/channels/slack.test.ts` | SlackChannel 的单元测试                                                              |
| MODIFY: `src/routing.test.ts`     | `modify/src/routing.test.ts`     | 合并 Slack JID 测试，仅增量，不修改现有测试                                          |
| MODIFY: `package.json`            | 依赖安装                         | 添加 `@slack/bolt`                                                                   |
| MODIFY: `.env.example`            | `add/.env.example` 或手动        | 添加 `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_ONLY`, `SLACK_FILTER_BOT_MESSAGES` |

### DEFERRED（Task 5 — 不在当前范围内）

| 条目                    | 来源                   | 原因                                                                           |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| MODIFY: `src/index.ts`  | `modify/src/index.ts`  | 多频道接线，需要 `SlackChannel` 先存在；存在 `SLACK_SIGNING_SECRET` 差异待解决 |
| MODIFY: `src/config.ts` | `modify/src/config.ts` | Slack 配置导出，按 technical-debt.md 决策与 index.ts 一同延期                  |

### OUT OF SCOPE（本阶段不涉及）

| 条目                    | 原因                                                    |
| ----------------------- | ------------------------------------------------------- |
| `src/types.ts`          | 无需变更，`Channel` 接口已存在                          |
| `src/db.ts`             | 无需模式变更，`storeChatMetadata` 已接受 `channel` 参数 |
| `src/router.ts`         | 无需变更，`findChannel` 已实现                          |
| `src/ipc.ts`            | 无需变更                                                |
| `src/task-scheduler.ts` | 无需变更                                                |

---

## 5. Task 5 前置检查清单

在应用延期的 `index.ts` 和 `config.ts` 变更之前，必须解决以下问题：

- [ ] **解决 `SLACK_SIGNING_SECRET`**：检查 `src/channels/slack.ts` 构造函数签名。若不需要签名密钥（Socket Mode 不需要），则从 `modify/src/index.ts` 中移除该导入及构造函数参数。
- [ ] **添加快速失败守卫**：当 `SLACK_ONLY=true` 但 `SLACK_BOT_TOKEN` 或 `SLACK_APP_TOKEN` 为空时，记录错误并退出，防止零频道启动。
- [ ] **确认 `@slack/bolt` 已安装**：`package.json` 必须包含 `@slack/bolt`，`src/channels/slack.ts` 才能编译。
- [ ] **确认 `src/channels/slack.ts` 构建干净**：在应用 index.ts/config.ts 变更之前，添加新文件后运行 `npm run build`。
