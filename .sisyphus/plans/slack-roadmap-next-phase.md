# Slack 集成详细路线图与下一阶段开发计划

## 摘要

> **快速概览**：以现有 `.claude/skills/add-slack/` 包作为基线，在不修改项目内核（`src/index.ts`、`src/config.ts`、`src/types.ts`、`src/db.ts`、`src/router.ts`、`src/ipc.ts`、`src/task-scheduler.ts`）的前提下，执行由 `slack-map.md`（R1-R15）和 `slack-edge-cases.md` 驱动的风险优先加固阶段，最终进行条件金丝雀发布。
>
> **交付物**：
>
> - 一条面向 NanoClaw 的生产就绪 Slack 渠道集成路径（技能优先，非重写）
> - 一份风险优先排序的下一阶段实施计划，包含明确的护栏和验证关卡
> - 条件金丝雀发布与回滚手册，以及延后事项积压清单
>
> **预估工作量**：中等（Medium）  
> **并行执行**：是 - 3 个波次（当前执行 10 个任务 + 1 个 DEFERRED）  
> **关键路径**：max(1,2) -> max(4,6) -> max(7,8) -> 9 -> 10（最长链：1 → 4 → 7 → 9 → 10）  
> **架构影响说明**：统一管道架构：WhatsApp 和 Slack 共享 SQLite + 轮询路径，Slack 通过 Socket Mode 实时接收事件后写入 SQLite，由轮询循环统一处理，单进程架构不变。当前阶段所有 Slack 逻辑封装在技能包内（`.claude/skills/add-slack/`），不触及项目内核文件。
>
> **决策同步（2026-02-23）**：根据最新范围锁定，项目内核文件（`src/index.ts`、`src/config.ts`、`src/types.ts`、`src/db.ts`、`src/router.ts`、`src/ipc.ts`、`src/task-scheduler.ts`）修改不在当前执行范围；相关内容统一标记为 DEFERRED。
>
> **开发原则强制执行（2026-02-23 修正）**：
> 在执行过程中发现 `src/index.ts` 和 `src/config.ts` 被直接修改，违反了「技能优先，不改项目内核」原则。已执行修正：
> 1. 还原 `src/index.ts`、`src/config.ts` 到基线状态（`git checkout HEAD`）
> 2. 将加固后的 `SlackChannel` 实现（含入站过滤、TTL 去重、看门狗、token 生命周期）回写至技能骨架 `.claude/skills/add-slack/add/src/channels/`
> 3. 从暂存区移除所有 `src/` 下的新增/修改文件（`slack.ts`、`slack.test.ts`、`routing.test.ts`）
> 4. 技能包的 `modify/` 目录保留完整的 3-way merge 目标文件，供 `apply-skill.ts` 在 DEFERRED 阶段执行时使用
>
> **硬性规则**：当前阶段任何任务（T1-T4, T6-T11）的代码产物必须落入 `.claude/skills/add-slack/` 技能包内。`src/` 目录仅在 `apply-skill.ts` 执行时由技能引擎写入，不得手动修改。根配置文件（`package.json`、`package-lock.json`、`.env.example`）同样仅由 `apply-skill.ts` 通过 `manifest.yaml` 的 `structured` 字段自动写入（`mergeNpmDependencies` / `mergeEnvAdditions`），不得手动修改。违反此规则的变更必须立即回退。

## 双态开发流程（2026-02-23 重构）

### 状态定义

 **undeployed（未部署开发态）**：仅允许修改 `.claude/skills/add-slack/**` 与文档；禁止手工修改 `src/`、`package.json`、`package-lock.json`、`.env.example`。
 **deployed（已部署验证态）**：仅允许通过 `scripts/apply-skill.ts` 将技能写入运行时；禁止手工修改核心 guard 文件（`src/index.ts`、`src/config.ts`、`src/types.ts`、`src/db.ts`、`src/router.ts`、`src/ipc.ts`、`src/task-scheduler.ts`）及根配置文件（`package.json`、`package-lock.json`、`.env.example`）。
 **dirty-core（异常态）**：任一 guard 文件或根配置文件存在手工变更，必须立即停止任务并回退到快照基线。

### 状态切换与备份/还原 SOP（强制）

统一使用 `feature_docs/clean.sh` 执行状态管理，不再以人工 `git checkout` 临时兜底：

1. 建立 undeployed 基线（首次或变更后）：
   - `./feature_docs/clean.sh status`
   - `./feature_docs/clean.sh install-guard`
   - `./feature_docs/clean.sh guard-check`
   - `./feature_docs/clean.sh backup undeployed-<tag>`
2. 切换到 deployed 验证态：
   - `./feature_docs/clean.sh backup predeploy-<tag>`
   - `./feature_docs/clean.sh switch deployed`
   - `npm test && npm run build`
   - `./feature_docs/clean.sh backup deployed-<tag>`
3. 回到 undeployed 开发态：
   - `./feature_docs/clean.sh switch undeployed undeployed-<tag>`
   - `./feature_docs/clean.sh status`（必须为 `undeployed`）
4. 任一时刻发现 `dirty-core`：
   - 立即 `./feature_docs/clean.sh restore undeployed-<tag>`
   - 禁止继续编码，先完成原因分析与记录

### 门控要求

- 所有任务必须显式声明执行状态（undeployed / deployed / deferred-doc）。
- undeployed 任务提交前，`./feature_docs/clean.sh status` 不得出现 `dirty-core`。
- undeployed 任务提交前，`./feature_docs/clean.sh guard-check` 必须通过。
 deployed 验证仅用于测试与观测；新代码仍需回写技能包路径。
 **启动前合规审查（强制）**：任何任务启动实施前，执行 agent 必须先审查本路线图的「硬性规则」和「状态定义」，确认当前任务的执行状态（undeployed / deployed / deferred-doc）以及受保护文件清单（`src/` guard 文件 + `package.json` / `package-lock.json` / `.env.example`）。未经审查直接开始编码的任务视为违规。
 **违规记录（强制）**：每次发现违规后，必须在本文档「开发原则强制执行」章节追加违规记录（日期、违规文件、修正动作），作为后续审查的参考基线。

---

## 背景

### 原始需求

编写详细的开发路线图文档和下一阶段开发计划，参考 `feature_docs/slack-edge-cases.md`、`feature_docs/slack-map.md` 与 `claudecode-slackbot` 项目代码。

### 访谈摘要

**关键讨论**：

- 现有运行时在 `src/` 中仍仅支持 WhatsApp；Slack 实现目前存放在 `.claude/skills/add-slack/` 下的技能产物中。
- `slack-map.md` 定义了 NanoClaw 兼容 Slack 集成的硬性需求 R1-R15。
- `slack-edge-cases.md` 提供了故障模式情报和优先加固领域。
- 计划必须与 NanoClaw 哲学保持一致：最小核心、技能优于功能、不引入独立 slackbot 的复杂性。

**研究发现**：

- 差距分析：核心 Slack 技能功能在技能包中基本具备，但运行时集成和可靠性加固尚不完整。
- 最高风险：消息子类型导致的重复处理、Slack 429/5xx 处理、socket 生命周期漂移、token 生命周期处理。
- 架构指导建议分阶段发布：基础验证 -> 集成 -> 加固 -> 受控金丝雀。

### Metis 审查

**已识别的差距（本计划已解决）**：

- 缺少明确的 Phase-0 验证关卡（技能引擎就绪性、基线绿灯检查）
- 缺少严格的范围锁定以避免引入非必要的 slackbot 子系统
- 缺少每个任务的可执行验收标准和证据路径
- 缺少明确的金丝雀退出/回滚条件

### Oracle 审查结论

1. 无 event_id 幂等处理
2. 无 thread_ts 线程策略强制执行
3. 无 MVP 运行模式定义
4. 金丝雀退出为固定 24h，非条件触发
5. 无分方法速率预算/分层限流
6. 无 Slack 入口契约文档
7. 加固全部在 Wave 3，未前置到 Wave 2
8. 21 个任务偏多，建议压缩至 10-12
9. 无轮询→事件驱动混合模式架构说明
10. 无 token scope/权限规格


### 结构化多智能体审查结论（2026-02-23）

> 由 Skeptic / Constraint Guardian / User Advocate / Oracle 四角色联合审查。

**裁定：REVISE — 工程质量高，但存在结构性缺陷需修正。**

**必须修正（阻塞项）**：
1. **T5 必须从「永久延后」提升为「下一阶段首要阻塞任务」** — 10 个任务全部完成但 Slack 无法启动，因为 `src/index.ts` 未实例化 `SlackChannel`。建议拆分为 T5a（最小内核接线）立即执行。
2. **修复时间戳精度丢失** — `toIsoTimestamp()` 丢弃 Slack `ts` 的微秒部分（`ts.split('.')[0]`），突发消息场景下同秒消息会被轮询游标跳过。数据丢失风险。
3. **增加 deployed 状态端到端冒烟测试** — 当前 384 个测试均在 undeployed 状态通过，未验证「Socket Mode 事件 → SQLite → 轮询 → 出站」完整路径。

**建议修正（非阻塞）**：
4. 修复看门狗 `stop()`/`start()` 之间 `connected` 状态不一致（`stop()` 后应立即设 `false`）。
5. 金丝雀退出条件中「生产经历 429」改为「429 路径已通过测试验证 + 可选合成演练」（低流量场景 429 可能永不发生）。
6. 清理 `SLACK_SIGNING_SECRET` 在 `slack-map.md` R10 与实际构造函数签名之间的不一致。
7. 简化双态开发流程（750 行 `clean.sh` 与「小到能理解」哲学不符）。

**评分**：完整性 7/10，合理性 6/10。修正后可达 9/10 和 8/10。

---

## 工作目标

### 核心目标

创建一份实用的、可执行的路线图，将现有 Slack 技能产物转化为生产安全的 NanoClaw 集成路径，风险控制优先于扩展工作。

### 具体交付物

- 一份具有依赖感知的分阶段路线图
- 一份下一阶段实施积压清单，包含明确的范围内和延后事项
- 一份验证和金丝雀发布协议，包含可量化的关卡

### 完成定义

- [ ] 路线图中所有任务都有可执行的验收标准。
- [ ] 集成路径保持 NanoClaw 单进程架构不变；WhatsApp 和 Slack 共享 SQLite + 轮询路径，架构统一。
- [ ] 高风险 Slack 故障模式在金丝雀发布前由明确的加固任务覆盖。
- [ ] 延后事项作为明确的积压清单捕获，不与当前范围混淆。
- [ ] MVP 运行模式已定义。
- [ ] Slack 入口契约已文档化。
- [ ] 条件金丝雀退出标准已定义。
- [ ] 双态切换流程（undeployed/deployed）已执行并留存快照证据。

### 必须包含

- 技能优先的集成路径（`apply-skill.ts`），先于手动代码加固
- R1-R15 合规覆盖和边界情况覆盖映射
- 明确的金丝雀、回滚和门控计划

### 必须排除（护栏）

- 不迁移 `claudecode-slackbot` 的命令框架、MCP 权限流程或工作目录子系统
- 本阶段不扩展范围至斜杠命令、线程级上下文隔离、mrkdwn 转换、文件上传管道或交互模式
- 不偏离 NanoClaw 的单进程 + 渠道抽象模型；WhatsApp 的 SQLite + 轮询路径不变
- 不响应 Slack Connect 外部用户消息
- 事件驱动直接分发路径（`enqueueWithPrompt`、内存缓冲、`conversations.history` backfill）— 延后至 v1.1

## Slack 入口契约

### 事件→消息模型映射

| Slack 事件 | NanoClaw 动作 | 幂等键 |
|---|---|---|
| `message` (无 subtype) | → `onMessage()` | `event.client_msg_id` 或 `event.ts` |
| `app_mention` | → `onMessage()` (翻译 @mention) | `event.client_msg_id` 或 `event.ts` |
| `message` (subtype: `bot_message`) | 忽略 | — |
| `message` (subtype: `message_changed`) | 忽略 | — |
| `message` (subtype: `message_deleted`) | 忽略 | — |
| `tokens_revoked` | → 安全断连 | — |
| `app_uninstalled` | → 安全断连 | — |

### 幂等处理

 Slack 入站消息使用内存 TTL Map 去重（`channel:ts` 键，5 分钟 TTL），单进程架构下无需分布式锁
 Socket Mode 下 Slack 可能因 ack 超时重发相同 `envelope_id` 的事件（参见 slack-edge-cases.md §9.1）
 对有副作用操作使用 `event_ts + user_id` 组合做幂等键
 内存 TTL Map 在进程重启时清空，SQLite 消息 ID 唯一约束防止重复写入，轮询游标从上次处理位置恢复

### 忽略事件清单

所有带 `subtype` 的 `message` 事件一律忽略（`message_changed`、`message_deleted`、`bot_message`、`channel_join`、`channel_leave` 等），仅处理无 subtype 的纯文本消息和 `app_mention`。

## MVP 运行模式

### 初始运行范围

- **DM 优先**：所有 `slack:D{id}` DM 默认可注册和响应
- **频道 @mention 触发**：公共/私有频道中仅响应 `<@{botUserId}>` 提及
- **频道白名单**：仅已通过 `registerGroup()` 注册的频道接收处理，未注册频道的消息仅触发 `onChatMetadata()` 用于发现
- **频道发现**：Bot 对未注册频道的 @mention 回复 `slack:{channelId}` 和注册指引（`!chatid` 消息命令）

### 不支持（本阶段）

- 交互模式（`!open`/`!close`）
- 线程级上下文隔离（所有消息归入频道级上下文）
- 斜杠命令
- 文件上传管道
- mrkdwn 格式转换

## Token Scope 规格

### 最小权限 Token

| Token 类型 | 前缀 | 用途 | 必需 |
|---|---|---|---|
| Bot Token | `xoxb-` | Web API 调用（发消息、查用户） | 是 |
| App-Level Token | `xapp-` | Socket Mode 连接 | 是 |
| Signing Secret | — | 请求签名验证 | 否（仅 HTTP 模式需要，Socket Mode 不使用）|

### 最小 Bot OAuth Scopes

参见 `slack-map.md` §OAuth Scopes，MVP 阶段必需：
- `app_mentions:read` — 接收 @提及
- `channels:history` — 读取公共频道消息
- `channels:read` — 读取频道元数据
- `chat:write` — 发送消息
- `im:history` — 读取 DM 消息
- `im:read` — 读取 DM 元数据

可选（私有频道支持）：
- `groups:history`、`groups:read`

### App-Level Token Scope

- `connections:write` — Socket Mode 连接必需

> 构造函数签名为 `new SlackChannel(botToken, appToken, opts)`，不接受 signingSecret 参数。

## 架构说明

### 统一管道架构

NanoClaw 采用统一管道架构——所有通道共享 SQLite + 轮询路径：
 **WhatsApp 路径（不变）**：baileys WebSocket → `storeMessage()` 写入 SQLite → 轮询循环（2s）读取 → GroupQueue → 容器
 **Slack 路径（新）**：Socket Mode 事件 → 立即 ack → 内存过滤/去重（TTL Map，`channel:ts` 键，5 分钟 TTL）→ `onMessage()` → `storeMessage()` 写入 SQLite → 轮询循环（2s）读取 → GroupQueue → 容器
 **SQLite 角色**：消息存储 + registered_groups/sessions/tasks（与 WhatsApp/Telegram 完全一致）
 **单进程不变**：Bolt 的 Socket Mode 客户端运行在同一 Node.js 进程中
 **延后优化**：事件驱动直接分发（内存缓冲 → GroupQueue.enqueueWithPrompt()）作为 v1.1 性能优化，仅在测量数据显示轮询延迟不可接受时实施

---

## 验证策略（强制）

> **零人工干预** — 所有验证由 agent 执行。

### 测试决策

- **基础设施已就绪**：是
- **自动化测试**：以波次 DoD 作为唯一门控
- **框架**：vitest + tsc（`npm test`、`npm run build`、`npm run typecheck`）

### DoD 门控策略

- 不再要求任务级 QA 场景和任务级证据清单。
- 每个波次必须通过对应 DoD，未通过不得进入下一波次。
- Wave 2 的任务 7 与任务 8 为硬性门控。

---

## 执行策略

### 并行执行波次

```
Wave 1（基础验证与契约 — 3 个任务并行）：
├── 任务 1：Phase-0 基线验证 + 技能引擎引导 [quick]
├── 任务 2：运行时差异审计 + 范围锁定 [unspecified-high]
└── 任务 3：入口契约定稿 + 边界情况优先级矩阵 [writing]

Wave 1 DoD（门控）：
- npm test && npm run build 通过
- .nanoclaw/ 已初始化
- 合并冲突风险矩阵已产出
- 入口契约已写入本文档
- slack-edge-cases.md §10 已填充（路线图内部产物，不作为 PRD 强制门控）
- 已产出至少 1 份 undeployed 基线快照（`./feature_docs/clean.sh backup undeployed-<tag>`）

Wave 2（集成 + 内联加固 — 4 个执行任务 + 1 个 DEFERRED 事项，加固为门控）：
├── 任务 4：应用技能包 + 合并配置 [quick]（合并原 T6+T7+T10）
├── 任务 5（DEFERRED）：内核接线（`src/index.ts` / `src/config.ts`）[writing]
├── 任务 6：合并路由测试 + Slack JID 兼容 [quick]
├── 任务 7：入站加固 — 子类型过滤 + 事件幂等 + 自循环防止 [unspecified-high]（GATE）
└── 任务 8：出站加固 — 分层限流 + 429/5xx 重试退避 [deep]（GATE）

注：任务 5 仅做文档化沉淀，不进入当前执行链路。

Wave 2 DoD（门控 — 任务 7+8 为硬性门控）：
- npm test && npm run build 通过
- 通过 `./feature_docs/clean.sh switch deployed` 生成运行态文件并可编译（禁止手工改 `src/`）
- 所有带 subtype 的消息被过滤（测试覆盖）
- 内存 TTL Map 去重已实现（测试覆盖）
- 429 Retry-After 重试已实现（测试覆盖）
- 5xx 有界重试已实现（测试覆盖）
- 未通过门控则不进入 Wave 3

Wave 3（运维与发布 — 3 个任务）：
├── 任务 9：Token 生命周期 + Socket 看门狗 [unspecified-high]（合并原 T13+T14）
├── 任务 10：运维手册 + 条件金丝雀 + 回滚协议 [writing]（合并原 T15+T16）
└── 任务 11：延后积压清单 + 最终合规审计 [writing]（合并原 T17+F1-F4）

Wave 3 DoD（最终）：
- npm test && npm run build 通过
- token 生命周期事件处理已实现（测试覆盖）
- socket 看门狗已实现（测试覆盖）
- 条件金丝雀检查清单已产出
- 延后积压清单已产出
- 全部 10 个执行任务完成，且 1 个 DEFERRED 事项已记录
```

---

## 待办事项

### 任务 1：Phase-0 基线验证 + 技能引擎引导

**执行状态**：`undeployed`

**要做什么**

- 运行 `npm test`、`npm run build` 并记录基线状态。
- 若 `.nanoclaw/` 缺失则执行初始化，并验证 `apply-skill.ts` 可执行。
- 使用 `./feature_docs/clean.sh backup undeployed-<tag>` 固化 undeployed 基线快照。

**不得做**

- 不在本任务应用 Slack 技能包。
- 不修改 `src/` 运行时代码。
- 不跳过基线失败记录。

**Agent 配置**

- 类别：`quick`
- 技能：[`debug`]

**依赖**：被阻塞：无；阻塞：4、6、7、8（任务 5 为 DEFERRED）

**验收标准**

- [ ] `npm test` 与 `npm run build` 已执行并有结论。
- [ ] `.nanoclaw/` 已存在且可用。
- [ ] `apply-skill.ts` 可执行路径已验证。
- [ ] `clean.sh install-guard` 已完成，pre-commit/pre-push 已激活。
- [ ] undeployed 基线快照已创建并可列出（`./feature_docs/clean.sh snapshots`）。

**提交**：否

### 任务 2：运行时差异审计 + 范围锁定

**要做什么**

- 对比运行时文件与技能 `modify/` 目标差异，产出合并冲突风险矩阵。
- 生成范围契约（IN/OUT/DEFERRED）。

**不得做**

- 不在本任务直接解决冲突并改代码。
- 不运行 `apply-skill` 替代审计。
- 不引入超出范围的新能力。

**Agent 配置**

- 类别：`unspecified-high`
- 技能：[`add-slack`, `git-master`]

**依赖**：被阻塞：无；阻塞：4、6、7、8（任务 5 为 DEFERRED）

**验收标准**

- [ ] 冲突风险矩阵已产出。
- [ ] 范围契约已明确 IN/OUT/DEFERRED。
- [ ] 高风险热点均映射到具体目标文件。

**提交**：否

### 任务 3：入口契约定稿 + 边界情况优先级矩阵

**要做什么**

- 完成本文档中的 Slack 入口契约定稿。
- 填充 `slack-edge-cases.md` §10 的 P0/P1/P2 优先级矩阵。
- 将每个 P0 项映射到路线图任务 ID。

**不得做**

- 不扩展净新功能范围。
- 不复制独立 slackbot 架构。
- 不留下未映射的 P0 条目。

**Agent 配置**

- 类别：`writing`
- 技能：[`add-slack`]

**依赖**：被阻塞：无；阻塞：7、8、11

**验收标准**

- [ ] 本文档入口契约完整可读。
- [ ] `slack-edge-cases.md` §10 已完成。
- [ ] 每个 P0 条目均有任务 ID 映射。

**提交**：否

### 任务 4：应用技能包 + 合并配置

**执行状态**：`deployed`（由脚本切换）

**要做什么**

- 应用技能 add-files，生成 `slack.ts` 与 `slack.test.ts`。
- 使用 `./feature_docs/clean.sh switch deployed` 触发 `apply-skill.ts`，不得手工写入 `src/`。
- 对齐 Slack 配置项说明（`SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_ONLY`、`SLACK_FILTER_BOT_MESSAGES`）；`src/config.ts` 导出修改归入 DEFERRED。
 校验 `package.json` 包含 `@slack/bolt`（仅在 deployed 状态下成立，由 `apply-skill.ts` 的 `mergeNpmDependencies` 自动写入）。
 校验 `.env.example` 包含 Slack 变量（仅在 deployed 状态下成立，由 `apply-skill.ts` 的 `mergeEnvAdditions` 自动写入；注意：`mergeEnvAdditions` 仅写入 `.env.example`，用户需手动在 `.env` 中填入实际 token 值）。

**不得做**

- 不跳过技能引擎直接手工重写全部文件。
- 不遗漏任何必需 Slack 配置导出。
- 不把机密值写入版本库。

**Agent 配置**

- 类别：`quick`
- 技能：[`add-slack`]

**依赖**：被阻塞：1、2；阻塞：7、8、9

**验收标准**

- [ ] 技能包基础文件已应用到运行时。
- [ ] 运行态写入路径由 `clean.sh switch deployed` 触发且命令记录可追溯。
 [ ] `@slack/bolt` 依赖存在（deployed 状态下，由 `mergeNpmDependencies` 写入）。
 [ ] `.env.example` 包含 `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_ONLY`、`SLACK_FILTER_BOT_MESSAGES`（deployed 状态下，由 `mergeEnvAdditions` 写入）。
 [ ] 用户已知晓 `.env` 需手动填入实际 token 值（`mergeEnvAdditions` 仅操作 `.env.example`）。
- [ ] Slack token 格式校验已定义：`SLACK_BOT_TOKEN` 必须以 `xoxb-` 开头，`SLACK_APP_TOKEN` 必须以 `xapp-` 开头，格式不匹配时 fail-fast。
- [ ] `src/config.ts` 导出修改已记录为 DEFERRED（不在当前执行范围）。
- [ ] 技能应用记录在 `.nanoclaw/state.yaml` 中。
- [ ] `registerGroup()` 接受 `slack:` 前缀 JID（验证路径存在）。
- [ ] R15 @mention 翻译逻辑存在于 `slack.ts`。
- [ ] R13 秘钥通过 stdin JSON 传递到容器（遵循现有模式）。

**提交**：是，消息：`feat(slack): apply baseline channel integration`

### 任务 5（DEFERRED → 下一阶段首要阻塞任务）：内核接线（`src/index.ts` / `src/config.ts`）

**审查修正（2026-02-23）**：多智能体审查裁定 T5 不应永久延后。当前 10 个任务全部完成但 Slack 无法启动，因为 `src/index.ts` 未实例化 `SlackChannel`。建议拆分为：
 **T5a（最小内核接线 — 立即执行）**：在 `src/index.ts` 的 `main()` 中添加条件 Slack 初始化（`if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN)`）、`channels[]` 推入、关闭路径。在 `src/config.ts` 中导出 Slack 环境变量。参考 `modify/src/index.ts.intent.md` 执行。
 **T5b（高级重构 — 保持延后）**：`SLACK_ONLY` 与 `TELEGRAM_ONLY` 的内核统一语义、多通道生命周期管理器。

**T5a 要做什么**

 在 `src/index.ts` 的 `main()` 中添加 `SlackChannel` 条件创建和 `channels.push()`。
 在 `src/config.ts` 中导出 `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`、`SLACK_ONLY`、`SLACK_FILTER_BOT_MESSAGES`。
 确保 `SLACK_ONLY=true` 时跳过 WhatsApp 初始化（fail-fast if tokens missing）。
 确保关闭路径断开所有 channels。
 参考 `modify/src/index.ts.intent.md` 和 `modify/src/config.ts.intent.md` 执行。

**T5a 不得做**

 不引入 `SLACK_ENABLE` 额外开关（保持 token-presence 激活模型）。
 不重构多通道生命周期管理器（归入 T5b）。
 不实现 `SLACK_ONLY` 与 `TELEGRAM_ONLY` 的内核统一语义（归入 T5b）。

**T5a Agent 配置**

 类别：`quick`
 技能：[`add-slack`]

**依赖**：被阻塞：T1-T11 全部完成；阻塞：金丝雀发布

**T5a 验收标准**

 [ ] `src/index.ts` 中 `SlackChannel` 条件创建已实现。
 [ ] `src/config.ts` 中 Slack 环境变量已导出。
 [ ] `SLACK_ONLY=true` + tokens 缺失时 fail-fast。
 [ ] 关闭路径断开所有 channels（测试覆盖）。
 [ ] deployed 状态下 `npm test && npm run build` 通过。
 [ ] deployed 状态端到端冒烟测试通过（Socket Mode 事件 → SQLite → 轮询 → 出站）。

**提交**：是，消息：`feat(slack): wire kernel bootstrap for Slack channel`

### 任务 6：合并路由测试 + Slack JID 兼容

**要做什么**

- 合并 `routing.test.ts` 的 Slack JID 兼容测试。
- 验证混合通道排序逻辑。
- 验证 DM 排除逻辑符合预期。
- 保持现有 WhatsApp 路由断言。

**不得做**

- 不删除或弱化既有路由断言。
- 不添加依赖环境的脆弱测试。
- 不引入与路由无关改动。

**Agent 配置**

- 类别：`quick`
- 技能：[`add-slack`]

**依赖**：被阻塞：1、2；阻塞：7

**验收标准**

- [ ] Slack JID 模式测试已并入。
- [ ] 混合通道排序测试通过。
- [ ] DM 排除测试通过。
- [ ] 路由测试套件整体通过。

**提交**：是，消息：`feat(slack): apply baseline channel integration`

### 任务 7：入站加固 — 子类型过滤 + 事件幂等 + 自循环防止 [GATE]

**要做什么**

- 过滤所有带 `subtype` 的消息事件，不仅限于 `bot_message`。
- 实现基于内存 TTL Map 的幂等去重（`channel:ts` 键，5 分钟 TTL）。
- 基于 `botUserId` 过滤 Bot 自身消息，防止自循环。
- 实现 `SLACK_FILTER_BOT_MESSAGES` 可配置 bot 过滤（默认 `true` 过滤所有 bot；`false` 仅过滤自身）。
- 增加 URL unfurl、重复 envelope、bot loop 回归测试。

**不得做**

- 不放行任意 `subtype` 消息进入 `onMessage()`。
- 不放行任意 `subtype` 消息进入 `onChatMetadata()`。
- 不移除内存 TTL Map 去重与 SQLite 唯一约束的双重保障。

**Agent 配置**

- 类别：`unspecified-high`
- 技能：[`add-slack`, `debug`]

**依赖**：被阻塞：4、6；阻塞：9、10、11

**验收标准**

- [ ] 所有 `subtype` 消息均被过滤（测试覆盖）。
- [ ] 内存 TTL Map 去重生效（测试覆盖）。
- [ ] Bot 自循环过滤生效（测试覆盖）。
- [ ] `SLACK_FILTER_BOT_MESSAGES` 可配置过滤生效（测试覆盖）。
- [ ] `!chatid` 消息命令已实现（与 Telegram `/chatid` 对称）。
- [ ] 三类回归场景测试通过。
- [ ] 过滤后的消息不触发 `onMessage()` 或 `onChatMetadata()`（测试覆盖）。

**提交**：是，消息：`fix(slack): harden inbound filtering and outbound retry`

### 任务 8：出站加固 — 分层限流 + 429/5xx 重试退避 [GATE]

**要做什么**

- 优先复用 Slack WebClient 内建重试机制（429 `Retry-After` + 5xx 指数退避），并补齐结构化观测日志。
- 处理 `429`：等待 `Retry-After` 后重试（头缺失时默认 1 秒退避）。
- 处理 `5xx`：采用有界重试策略（最多 3 次，`1s/2s/4s` + jitter）。
- 网络错误仅记录并交给 Bolt 重连路径恢复。
- 增加重试成功与终态失败测试。

**不得做**

- 不使用无界重试循环。
- 不忽略 `Retry-After` 头。
- 不吞掉最终失败日志。

**Agent 配置**

- 类别：`deep`
- 技能：[`add-slack`, `debug`]

**依赖**：被阻塞：4；阻塞：9、10、11

**验收标准**

- [ ] `429` 路径按 `Retry-After` 重试成功。
- [ ] `5xx` 路径有界重试并可终态失败。
- [ ] 分层限流预算策略已生效。
- [ ] 重试成功/失败测试均通过。
- [ ] `Retry-After` 头缺失时使用默认 1 秒退避（测试覆盖）。
- [ ] R5 消息分片（40,000 字符边界）已验证（测试覆盖）。

**提交**：是，消息：`fix(slack): harden inbound filtering and outbound retry`

### 任务 9：Token 生命周期 + Socket 看门狗

**要做什么**

- 注册 `tokens_revoked`、`app_uninstalled` 处理并优雅断连。
- 添加 socket 健康看门狗：每 60 秒检查最后事件时间戳，超过 3 分钟判定陈旧并触发重连（为 5 分钟恢复 SLO 预留 2 分钟恢复窗口）。
- 输出结构化重连诊断，支撑金丝雀观察。

**不得做**

- 不忽略 token 生命周期事件。
- 不在连接陈旧时继续静默运行。
- 不输出不可观测的重连行为。

**Agent 配置**

- 类别：`unspecified-high`
- 技能：[`debug`]

**依赖**：被阻塞：7、8；阻塞：10、11

**验收标准**

- [ ] token 生命周期事件处理已实现并有测试覆盖。
- [ ] socket 看门狗陈旧检测与重连生效。
- [ ] 看门狗检查频率为 60 秒，陈旧阈值为 3 分钟（测试覆盖）。
- [ ] 结构化重连诊断可用于金丝雀监控。
- [ ] 重连诊断日志包含字段：`event=socket_reconnect|socket_stale|token_revoked`、`last_event_ts`、`reconnect_attempt`、`duration_ms`。
- [ ] 生命周期路径不导致进程崩溃。

**提交**：是，消息：`fix(slack): add token lifecycle and socket watchdog`

### 任务 10：运维手册 + 条件金丝雀 + 回滚协议

**要做什么**

- 更新 `SKILL.md`，补齐加固后流程与排障路径。
- 产出条件金丝雀检查清单（非固定 24h），退出条件为：
  - 至少经历一次 Socket 重连并恢复
  - 至少经历一次 429 限流并成功重试
  - 至少处理 50 条入站消息无重复
  - 至少运行 24 小时无未捕获异常
  - 至少验证一次 token 有效性检查路径
  - 以上全部满足 → 退出金丝雀
- 定义回滚流程：`git revert` 提交组 + `npm run build` + 重启服务。

**不得做**

- 不使用固定时长即退出的金丝雀策略。
- 不省略回滚命令序列。
- 不写与代码行为不一致的运维说明。

**Agent 配置**

- 类别：`writing`
- 技能：[`add-slack`, `debug`]

**依赖**：被阻塞：9；阻塞：11

**验收标准**

- [ ] `SKILL.md` 加固流程与排障说明已更新。
- [ ] 条件金丝雀清单已产出且可执行。
- [ ] 回滚协议已定义并含命令序列。
- [ ] 金丝雀退出不再依赖固定 24h。

**提交**：是，消息：`docs(slack): add canary protocol and deferred roadmap`

### 任务 11：延后积压清单 + 最终合规审计

**执行状态**：`deferred-doc` + `undeployed`（收口）

**要做什么**

- 发布延后积压清单，包含阶段标签与重审触发条件。
- 执行最终合规检查：所有 MUST INCLUDE 已实现、所有 MUST EXCLUDE 未出现。
- 执行最终门控：`npm test && npm run build`。
- 结束前执行 `./feature_docs/clean.sh switch undeployed <baseline>`，确保工作区回到未部署开发态。

**不得做**

- 不将延后项混入当前范围实现。
- 不跳过最终合规审计。
- 不在最终门控失败时宣布完成。

**Agent 配置**

- 类别：`writing`
- 技能：[`add-slack`]

**依赖**：被阻塞：10；阻塞：无

**验收标准**

- [ ] 延后积压清单已发布。
- [ ] MUST INCLUDE/MUST EXCLUDE 合规检查通过。
- [ ] 最终 `npm test && npm run build` 通过。
- [ ] 全部 10 个执行任务已完成，且 DEFERRED 事项已登记。
- [ ] 最终状态为 undeployed，且 `clean.sh status` 不包含 `dirty-core`。

**提交**：是，消息：`docs(slack): add canary protocol and deferred roadmap`

---

## 条件金丝雀退出标准

### 退出条件（全部满足方可退出金丝雀）

1. Socket 重连恢复：至少经历一次断连→重连→恢复事件处理
2. 限流恢复：429→Retry-After→成功重试路径已通过单元测试验证（`slack-rate-limit.test.ts`）；低流量场景下 429 可能永不自然发生，可选执行合成 429 演练（见 T10 运维手册）
3. 消息幂等：处理 ≥50 条入站消息，内存 TTL Map + SQLite 去重无重复 Agent 调用
4. 稳定运行：连续运行 ≥24 小时，零未捕获异常
5. Token 刷新：至少验证一次 token 有效性检查路径

### 回滚触发条件（任一满足立即回滚）

1. 未捕获异常导致进程崩溃
2. 消息重复响应（同一消息触发 ≥2 次 Agent 调用）
3. Socket 断连后 3 分钟内看门狗未触发重连，或触发后 2 分钟内未恢复
4. 429 限流后重试仍失败（连续 3 次）

### 回滚命令

```bash
git revert <commit-group-hash>
npm run build
systemctl --user restart nanoclaw  # Linux
# 或 launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

---

## 提交策略

- Group A（集成核心）：任务 4、6 → `feat(slack): apply baseline channel integration`（任务 5 为 DEFERRED，不纳入当前提交）
- Group B（可靠性加固）：任务 7-8 → `fix(slack): harden inbound filtering and outbound retry`
- Group C（运维加固）：任务 9 → `fix(slack): add token lifecycle and socket watchdog`
- Group D（文档）：任务 10-11 → `docs(slack): add canary protocol and deferred roadmap`

> **提交粒度**：每组一个 squash 提交。同组内多个任务的变更合并为单一提交，回滚时使用该组的单一提交哈希。

---

## 成功标准

### 验证命令

```bash
npm run typecheck   # Expected: no TypeScript errors
npm test            # Expected: all tests pass (including Slack-specific tests)
npm run build       # Expected: successful build output in dist/
```

### 最终检查清单

- [ ] 所有必须包含项已实现并验证
- [ ] 所有必须排除项均不存在
- [ ] 高风险 Slack 边界情况已明确加固或明确延后
- [ ] 条件金丝雀退出标准已定义
- [ ] MVP 运行模式已定义并在入口契约中文档化
- [ ] 入口契约已完成（事件映射、幂等键、忽略列表）
- [ ] Token scope 规格已文档化
- [ ] 架构说明已更新
---

## 审查发现的已知技术债（2026-02-23）

> 以下技术债由结构化多智能体审查发现，建议在 T5a 执行前或执行中修复。

### TD-1：时间戳精度丢失（阻塞级）

**位置**：`.claude/skills/add-slack/add/src/channels/slack.ts` 第 310-314 行 `toIsoTimestamp()`
**问题**：`ts.split('.')[0]` 丢弃 Slack `ts` 的微秒部分。突发消息场景下同秒消息会被轮询游标跳过，导致数据丢失。
**修复方向**：保留完整 `ts` 精度写入 SQLite，或使用 `ts` 原始值作为游标而非转换后的 ISO 时间戳。
**修复时机**：T5a 执行前（阻塞金丝雀发布）。

### TD-2：看门狗状态不一致（建议级）

**位置**：`slack.ts` 的 `stop()` 方法
**问题**：`stop()` 调用 `disconnect()` 后未立即设置 `this.connected = false`，在 `stop()`/`start()` 快速切换场景下可能导致看门狗误判。
**修复方向**：`stop()` 入口处立即设 `connected = false`。
**修复时机**：T5a 执行中（非阻塞但建议一并修复）。

### TD-3：签名密钥契约漂移（建议级）

**位置**：`feature_docs/slack-map.md` R10 vs `slack.ts` 构造函数签名
**问题**：`slack-map.md` R10 要求 `SLACK_SIGNING_SECRET`，但实际构造函数 `new SlackChannel(botToken, appToken, opts)` 不接受 `signingSecret` 参数（Socket Mode 不需要）。文档与代码不一致。
**修复方向**：在 `slack-map.md` R10 中注明 Socket Mode 下 `signingSecret` 不适用，或在构造函数中保留可选参数以备 HTTP 模式。
**修复时机**：T5a 执行前（文档修正）。

### TD-4：双态管理脚本复杂度（建议级）

**位置**：`feature_docs/clean.sh`（750 行）
**问题**：与 NanoClaw「小到能理解」哲学不符。功能正确但维护成本高。
**修复方向**：在 Slack 集成稳定后，考虑简化为核心功能子集或拆分为独立脚本。
**修复时机**：金丝雀发布后（低优先级）。

### TD-5：缺少 deployed 端到端冒烟测试（阻塞级）

**位置**：测试套件整体
**问题**：当前 384 个测试均在 undeployed 状态通过，未验证「Socket Mode 事件 → SQLite → 轮询 → 出站」完整路径。
**修复方向**：在 T5a 验收标准中已包含端到端冒烟测试要求。
**修复时机**：T5a 执行中（已纳入验收标准）。
