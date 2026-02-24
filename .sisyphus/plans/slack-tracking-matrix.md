# Slack 集成功能实现跟踪矩阵

> 生成日期：2026-02-23 | 审计修正：2026-02-23（基于提交 `9f54644`）| W4 更新：2026-02-23 | W5 更新：2026-02-24
> 关联路线图：`.sisyphus/plans/slack-roadmap-next-phase.md`
> 关联需求：`feature_docs/slack-map.md`（R1-R15）
> 关联边界情况：`feature_docs/slack-edge-cases.md`（§1-§10）
> 关联同步计划：`.sisyphus/plans/curious-soaring-petal.md`（频道名称自动同步）

---

## 1. 任务执行状态总览

| 波次 | 任务 | 描述                              | 类别             | 状态    | 产物                                            |
| ---- | ---- | --------------------------------- | ---------------- | ------- | ----------------------------------------------- |
| W1   | T1   | Phase-0 基线验证 + 技能引擎引导   | quick            | ✅ 完成 | `docs/slack/W1-T1-baseline.md`                  |
| W1   | T2   | 运行时差异审计 + 范围锁定         | unspecified-high | ✅ 完成 | `docs/slack/W1-T2-runtime-diff-audit.md`        |
| W1   | T3   | 入口契约定稿 + 边界情况优先级矩阵 | writing          | ✅ 完成 | `docs/slack/W1-T3-entry-contract-matrix.md`     |
| W2   | T4   | 应用技能包 + 合并配置             | quick            | ✅ 完成 | 技能包应用记录                                  |
| W2   | T5   | 内核接线（DEFERRED → W4 完成）    | —                | ✅ 完成 | `docs/slack/T5-deferred-kernel-wiring.md`       |
| W2   | T6   | 合并路由测试 + Slack JID 兼容     | quick            | ✅ 完成 | W4 Step 4 经 apply-skill 合并至 `src/`          |
| W2   | T7   | 入站加固（GATE）                  | unspecified-high | ✅ 完成 | `slack.ts` 入站过滤逻辑                         |
| W2   | T8   | 出站加固（GATE）                  | deep             | ✅ 完成 | `slack.ts` 重试/限流逻辑                        |
| W3   | T9   | Token 生命周期 + Socket 看门狗    | unspecified-high | ✅ 完成 | `slack.ts` 看门狗逻辑（R3 重构加固）              |
| W3   | T10  | 运维手册 + 条件金丝雀 + 回滚协议  | writing          | ✅ 完成 | `docs/slack/T10-canary-ops-rollback.md`         |
| W3   | T11  | 延后积压清单 + 最终合规审计       | writing          | ✅ 完成 | `docs/slack/T11-deferred-backlog-compliance.md` |
| W4   | T5a  | 最小内核接线（审查新增）          | quick            | ✅ 完成 | W4 Step 4 经 apply-skill 验证                   |
| —    | T5b  | 高级重构（\*\_ONLY 统一语义）     | —                | ➖ 延后 | —                                               |
| W5   | T12  | Slack 频道名称自动同步            | deep             | ⏳ 未开始 | `.sisyphus/plans/curious-soaring-petal.md`      |
| W5-R3| —   | 看门狗稳定性修复（9 项）+ 金丝雀  | deep             | ✅ PROMOTE | `slack-round3-completion-report.md`             |

**统计**：12/13 执行任务完成（含 W5-R3 看门狗修复），1 个高级重构延后（T5b），1 个频道同步待实现（T12）。

---

## 2. 任务 × 需求覆盖矩阵（R1-R15）

| 需求 | 描述                  | T1  | T2  | T3  | T4  | T5a | T6  | T7  | T8  | T9  | T10 | T11 | 覆盖状态                                                                   |
| ---- | --------------------- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | -------------------------------------------------------------------------- |
| R1   | Channel 接口合规      |     |  ◎  |     |  ●  |  ●  |     |     |     |     |     |  ◎  | ✅ T4 实现，T5a 接线                                                       |
| R2   | JID 命名空间 `slack:` |     |  ◎  |     |  ●  |     |  ●  |     |     |     |     |  ◎  | ✅ T4 实现，T6 已合并至 `src/`                                             |
| R3   | 构造函数签名          |     |  ◎  |     |  ●  |  ●  |     |     |     |     |     |  ◎  | ✅ T4 实现，T5a 实例化（TD-3 已修复）                                      |
| R4   | connect() 模式        |     |     |     |  ●  |  ●  |     |     |     |     |     |     | ✅ T4 实现，T5a 调用                                                       |
| R5   | sendMessage() 分片    |     |     |     |  ●  |     |     |     |  ●  |     |     |  ◎  | ✅ T4+T8                                                                   |
| R6   | Bot 消息过滤          |     |     |  ◎  |     |     |     |  ●  |     |     |     |  ◎  | ✅ T7                                                                      |
| R7   | onMessage 回调数据    |     |     |  ◎  |  ●  |     |     |  ●  |     |     |     |  ◎  | ✅ T4+T7                                                                   |
| R8   | onChatMetadata 回调   |     |     |  ◎  |  ●  |     |     |  ●  |     |     |     |  ◎  | ✅ T4+T7                                                                   |
| R9   | setTyping 空实现      |     |     |     |  ●  |     |     |     |     |     |     |  ◎  | ✅ T4                                                                      |
| R10  | 环境变量              |     |  ◎  |     |  ●  |  ●  |     |     |     |     |     |  ◎  | ✅ T4+T5a（TD-3 已修复，signingSecret 已移除）                             |
| R11  | 技能包结构            |  ●  |  ◎  |     |  ●  |     |     |     |     |     |     |  ◎  | ✅ T1+T4                                                                   |
| R12  | modify/ 合并目标      |     |  ●  |     |     |  ●  |  ●  |     |     |     |     |  ◎  | ✅ T5a+T6 已合并                                                           |
| R13  | 秘钥隔离              |     |     |     |  ●  |  ●  |     |     |     |     |     |  ◎  | ✅ T4，T5a 验证                                                            |
| R14  | 测试规范              |     |     |     |  ●  |     |  ●  |  ●  |  ●  |  ●  |     |  ◎  | ✅ deployed 388 测试通过 + 1 todo（含 43 Slack 测试），undeployed 345 通过 |
| R15  | @提及翻译             |     |     |  ◎  |  ●  |     |     |     |     |     |     |  ◎  | ✅ T4                                                                      |

**图例**：● = 主要实现任务 | ◎ = 审计/验证任务 | 空 = 不涉及

**覆盖率**：15/15 需求全部覆盖完成。✅ 无待处理项。

---

## 3. 任务 × 边界情况覆盖矩阵（P0/P1/P2）

### P0 — 金丝雀前必须实现

| 边界情况           | 来源             | 负责任务 | 状态      | 验证方式                                |
| ------------------ | ---------------- | -------- | --------- | --------------------------------------- |
| Bot 消息自循环     | §1.2, §6.3       | T7       | ✅ 已实现 | `botUserId` 过滤 + 测试覆盖             |
| 消息子类型重复处理 | §6.4, §9.5       | T7       | ✅ 已实现 | 全 subtype 过滤 + URL unfurl 回归测试   |
| 事件重复投递       | §4.5, §9.1, §9.7 | T7       | ✅ 已实现 | TTL Map + SQLite 双重去重               |
| Slack 429 限流     | §2.2             | T8       | ✅ 已实现 | 重试配置测试覆盖，行为依赖 Bolt 内建    |
| 5xx 服务端错误     | §3.2             | T8       | ✅ 已实现 | 有界重试（3次，1s/2s/4s+jitter）        |
| Token 撤销/卸载    | §5.4             | T9       | ✅ 已实现 | `tokens_revoked`/`app_uninstalled` 处理 |

**P0 覆盖率**：6/6（100%）

### P1 — 应实现，可在后续波次

| 边界情况            | 来源 | 负责任务 | 状态      | 备注                              |
| ------------------- | ---- | -------- | --------- | --------------------------------- |
| Socket 静默失联     | §9.3 | T9       | ✅ 已实现 | 60s 检查 + 12min 陈旧阈值（R3 修复）  |
| WebSocket pong 超时 | §9.9 | T9       | ✅ 已实现 | 看门狗覆盖                        |
| too_many_websockets | §9.2 | T9       | ⚠️ 部分   | Bolt 内建处理，看门狗辅助         |
| 队列满/排队超时     | §1.1 | 延后     | ➖ 延后   | NanoClaw group-queue 已有并发控制 |
| 有状态正则表达式    | §9.6 | T7       | ✅ 已实现 | Bolt 注册无 /g /y 标志            |

**P1 覆盖率**：4/5 已实现或部分实现，1 个合理延后。

### P2 — 延后至未来阶段

| 边界情况                   | 来源  | 状态    | 延后理由                      |
| -------------------------- | ----- | ------- | ----------------------------- |
| 交互模式                   | §1.3  | ➖ 延后 | 本阶段不实现                  |
| mrkdwn 格式转换            | §4.2  | ➖ 延后 | 直接发送纯文本                |
| 文件上传                   | §4.4  | ➖ 延后 | 使用占位符文本                |
| 线程级上下文隔离           | §6.2  | ➖ 延后 | 频道级对话模型                |
| Slack Connect 外部用户     | §4.6  | ➖ 延后 | 安全考虑                      |
| assistant.userMessage 循环 | §9.8  | ➖ 延后 | NanoClaw 不使用 Assistant API |
| HTTP 模式重试头            | §9.10 | ➖ 延后 | 使用 Socket Mode              |

---

## 4. 技术债跟踪

| ID   | 描述                               | 严重级 | 修复时机 | 状态      | 关联任务                                                    |
| ---- | ---------------------------------- | ------ | -------- | --------- | ----------------------------------------------------------- |
| TD-1 | 时间戳精度丢失（`toIsoTimestamp`） | 阻塞   | T5a 前   | ✅ 已修复 | W4 Step 1：`parseFloat(ts)` 替代 `Number(ts.split('.')[0])` |
| TD-2 | 看门狗 `disconnect()` 状态竞态     | 建议   | T5a 中   | ✅ 已修复 | W4 Step 3：`connected=false` 移至 `disconnect()` 首行       |
| TD-3 | `SLACK_SIGNING_SECRET` 契约漂移    | 建议   | T5a 前   | ✅ 已修复 | W4 Step 2：移除 phantom import + 构造函数参数 + 文档更新    |
| TD-4 | `clean.sh` 750 行复杂度            | 建议   | 金丝雀后 | ➖ 低优先 | —                                                           |
| TD-5 | 缺少 deployed 端到端冒烟测试       | 阻塞   | T5a 中   | ✅ 已验证 | W4 Step 4-5：deployed 态 384 测试 + build 通过              |

---

## 5. 波次门控状态

| 波次 | 门控条件                                                             | 状态 |
| ---- | -------------------------------------------------------------------- | ---- |
| W1   | `npm test && npm run build` 通过                                     | ✅   |
| W1   | `.nanoclaw/` 已初始化                                                | ✅   |
| W1   | 合并冲突风险矩阵已产出                                               | ✅   |
| W1   | 入口契约已写入路线图                                                 | ✅   |
| W1   | undeployed 基线快照已创建                                            | ✅   |
| W2   | `npm test && npm run build` 通过                                     | ✅   |
| W2   | 所有 subtype 消息被过滤（测试覆盖）                                  | ✅   |
| W2   | TTL Map 去重已实现（测试覆盖）                                       | ✅   |
| W2   | 429 Retry-After 重试已实现（配置测试覆盖，行为依赖 Bolt 内建）       | ✅   |
| W2   | 5xx 有界重试已实现（测试覆盖）                                       | ✅   |
| W3   | token 生命周期事件处理（测试覆盖）                                   | ✅   |
| W3   | socket 看门狗已实现（测试覆盖）                                      | ✅   |
| W3   | 条件金丝雀检查清单已产出                                             | ✅   |
| W3   | 延后积压清单已产出                                                   | ✅   |
| W3   | 11/11 执行任务完成                                                   | ✅   |
| W4   | TD-1 时间戳精度修复（技能包内）                                      | ✅   |
| W4   | TD-3 文档契约漂移修复                                                | ✅   |
| W4   | TD-2 看门狗状态修复（技能包内）                                      | ✅   |
| W4   | T5a `src/config.ts` Slack 变量导出                                   | ✅   |
| W4   | T5a `src/index.ts` SlackChannel 条件创建                             | ✅   |
| W4   | T6 `src/routing.test.ts` Slack JID 测试合并                          | ✅   |
| W4   | deployed 态 `npm test && npm run build` 通过（384 tests + 0 errors） | ✅   |
| W4   | undeployed 态 `npm test` 通过（345 tests）                           | ✅   |
| W4   | 最终状态回到 undeployed                                              | ✅   |

**门控通过率**：30/30（100%）。

### Round 3 看门狗稳定性修复门控（W5-R3）

| 门控条件 | 状态 |
| --- | --- |
| 陈旧阈值提升至 12 分钟（`STALE_THRESHOLD`） | ✅ |
| Socket 心跳活性检测（`receiver.on('connected')`） | ✅ |
| 重入锁防止并发重连（`isReconnecting`） | ✅ |
| 指数退避 + 抖动（`reconnect-policy.ts` 66 行） | ✅ |
| 断路器 5 次失败后 `process.exit(1)` | ✅ |
| Bolt SDK 重试配置（`retryConfig.retries: 1`） | ✅ |
| 时间戳精度修复（`toIsoTimestamp`） | ✅ |
| 自动化金丝雀检查点脚本（`scripts/slack/canary-checkpoint.sh` 315 行） | ✅ |
| 浸泡监控脚本（`scripts/slack/soak-monitor.sh` 78 行） | ✅ |
| 6 个新增看门狗可靠性测试全部通过 | ✅ |
| deployed 态 388 测试通过 + 1 todo，0 失败 | ✅ |
| 金丝雀 C1-C5 全部 PASS，裁决 PROMOTE | ✅ |

---

## 6. 下一步行动

| 优先级    | 行动                            | 状态        |
| --------- | ------------------------------- | ----------- |
| ~~🔴 P0~~ | ~~修复 TD-1（时间戳精度）~~     | ✅ 已完成   |
| ~~🔴 P0~~ | ~~修复 TD-3（文档契约漂移）~~   | ✅ 已完成   |
| ~~🔴 P0~~ | ~~执行 T5a（最小内核接线）~~    | ✅ 已完成   |
| ~~🟡 P1~~ | ~~修复 TD-2（看门狗状态）~~     | ✅ 已完成   |
| ~~🟡 P1~~ | ~~修复 TD-5（端到端冒烟测试）~~ | ✅ 已验证   |
| 🟡 P1     | T12 Slack 频道名称自动同步（5 步） | ⏳ 未开始 |
| 🟢 P2     | 简化 TD-4（clean.sh）           | ➖ 金丝雀后 |
| ~~🟢 P2~~ | ~~条件金丝雀发布~~                  | ✅ PROMOTE（R3 C1-C5 全通过） |

**T12 进度明细**（详见 `.sisyphus/plans/curious-soaring-petal.md`）：

| 步骤 | 描述 | 涉及文件 | 状态 |
| ---- | ---- | -------- | ---- |
| Step 1 | `db.ts` 参数化 sentinel + 新增 `updateRegisteredGroupName` | `src/db.ts` | ⏳ 未开始 |
| Step 2 | `index.ts` sentinel 过滤泛化 + IPC 接线扩展 | `src/index.ts` | ⏳ 未开始 |
| Step 3 | `slack.ts` 核心 `syncChannelMetadata` 实现 | `src/channels/slack.ts` | ⏳ 未开始 |
| Step 4 | `slack.test.ts` 新增 sync 测试（5 个用例） | `src/channels/slack.test.ts` | ⏳ 未开始 |
| Step 5 | `routing.test.ts` sentinel 排除测试 | `src/routing.test.ts` | ⏳ 未开始 |

**关键路径**：T12 不阻塞金丝雀发布，但建议在金丝雀后尽快实现以修复频道名称显示不一致问题。

---

## 7. 审计修正记录（2026-02-23）

基于提交 `9f54644` 的代码审计，发现以下 5 处不一致并已修正：

| #   | 原始声明                           | 实际状态                                                    | 修正                 |
| --- | ---------------------------------- | ----------------------------------------------------------- | -------------------- |
| 1   | T6 ✅ 完成                         | `src/routing.test.ts` 无 Slack 引用，测试仅存在于 `modify/` | → ⏳ 待合并          |
| 2   | R14「384 测试通过」                | 执行强制后 vitest 范围内 345 测试，34 个 Slack 测试在技能包 | → 345+34             |
| 3   | R12 仅依赖 T5a                     | T6 路由测试也未合并至 `src/`                                | → T5a+T6             |
| 4   | 429「Retry-After 重试 + 测试覆盖」 | 实际 429 行为测试为 `it.todo()`，仅配置测试通过             | → 注明依赖 Bolt 内建 |
| 5   | T5b 仅在统计行提及                 | 任务表无 T5b 行                                             | → 补充 T5b 行        |

---

## 8. W4 开发计划（双态流程）— ✅ 已完成

### 概述

W4 是从 undeployed 开发态切换到 deployed 验证态的关键波次。所有前置技术债修复在 undeployed 态完成，T5a 内核接线通过 `apply-skill.ts` 切换到 deployed 态执行，最终验证后回到 undeployed 态提交。

### 执行序列

```
W4（内核接线 + 金丝雀准备 — 5 个步骤，严格串行）：

Step 1: TD-1 修复（undeployed 态）                              ✅ 已完成
  ├── 修改 `.claude/skills/add-slack/add/src/channels/slack.ts`
  ├── toIsoTimestamp() 使用 parseFloat(ts) 替代 Number(ts.split('.')[0])
  ├── 测试期望值无需更新（微秒精度低于 Date 分辨率）
  └── 门控：deployed 态测试通过

Step 2: TD-3 修复（undeployed 态）                              ✅ 已完成
  ├── 更新 `feature_docs/slack-map.md` R10/R12/对比表
  ├── 清理 `modify/src/index.ts` 中 SLACK_SIGNING_SECRET 导入 + 构造函数参数
  └── 门控：构造函数签名与 SlackChannel(botToken, appToken, opts) 一致

Step 3: TD-2 修复（undeployed 态）                              ✅ 已完成
  ├── 修改 `.claude/skills/add-slack/add/src/channels/slack.ts`
  ├── disconnect() 首行设 this.connected = false（防止看门狗竞态）
  └── 门控：deployed 态测试通过

Step 4: T5a + T6 执行（deployed 态切换）                        ✅ 已完成
  ├── `./feature_docs/clean.sh backup predeploy-w4`
  ├── `./feature_docs/clean.sh switch deployed`
  │   └── apply-skill.ts 成功写入 src/、package.json
  ├── 验证 src/config.ts 导出 SLACK_BOT_TOKEN/APP_TOKEN/ONLY（无 SIGNING_SECRET）
  ├── 验证 src/index.ts SlackChannel 3 参数构造
  ├── 验证 src/routing.test.ts 包含 Slack JID 测试（8→13 tests）
  ├── `npm test` → 384 passed, 1 todo, 30 test files
  ├── `npm run build` → 0 errors
  └── 门控：全部通过

Step 5: 收口（deployed 态 → undeployed 态）                     ✅ 已完成
  ├── `./feature_docs/clean.sh backup deployed-w4-verified`
  ├── `./feature_docs/clean.sh switch undeployed predeploy-w4`
  ├── 清理 deployed 残留（src/channels/slack.ts 等）
  ├── `npm test` → 345 passed, 29 test files
  └── 门控：undeployed 态干净，仅 3 个技能包文件有变更
```

### W4 门控条件

| 门控条件                                     | 状态 |
| -------------------------------------------- | ---- |
| TD-1 时间戳精度修复（技能包内）              | ✅   |
| TD-3 文档契约漂移修复                        | ✅   |
| TD-2 看门狗状态修复（技能包内）              | ✅   |
| T5a `src/config.ts` Slack 变量导出           | ✅   |
| T5a `src/index.ts` SlackChannel 条件创建     | ✅   |
| T5a SLACK_ONLY fail-fast 守卫                | ✅   |
| T6 `src/routing.test.ts` Slack JID 测试合并  | ✅   |
| deployed 态 `npm test && npm run build` 通过 | ✅   |
| undeployed 态 `npm test` 通过                | ✅   |
| 最终状态回到 undeployed                      | ✅   |

### 提交策略

- ~~Group E（技术债修复）：Step 1-3~~
- ~~Group F（内核接线）：Step 4-5~~
- 实际：合并为单次提交（TD 修复 + 文档更新，内核接线通过 apply-skill 验证但不提交 src/ 变更）

### 快照记录

| 快照名                 | 用途                                    | 创建时间  |
| ---------------------- | --------------------------------------- | --------- |
| `predeploy-w4`         | TD 修复后、deploy 前的 undeployed 基线  | W4 Step 4 |
| `deployed-w4-verified` | 384 测试 + build 通过后的 deployed 快照 | W4 Step 5 |

---

## 9. 审计记录（2026-02-24）

基于 `deep-test-r2` 分支代码审计，对照 `.sisyphus/plans/curious-soaring-petal.md` 开发计划（T12 Slack 频道名称自动同步），逐项验证实现状态：

| 步骤 | 计划变更 | 代码实际状态 | 结论 |
| ---- | -------- | ------------ | ---- |
| 1a | `getLastGroupSync` 加 `sentinel` 默认参数 | `db.ts:217-223` 硬编码 `'__group_sync__'`，无参数 | ⏳ 未实现 |
| 1b | `setLastGroupSync` 加 `sentinel` 默认参数 | `db.ts:228-233` 硬编码 `'__group_sync__'`，无参数 | ⏳ 未实现 |
| 1c | 新增 `updateRegisteredGroupName` 函数 | `db.ts` 中不存在该函数 | ⏳ 未实现 |
| 2a | sentinel 过滤改为 `!c.jid.startsWith('__')` | `index.ts:107` 仍为 `c.jid !== '__group_sync__'` | ⏳ 未实现 |
| 2b | IPC `syncGroupMetadata` 扩展调用 Slack sync | `index.ts:487` 仅调用 WhatsApp sync | ⏳ 未实现 |
| 3a | `slack.ts` 导入 db 同步函数 | 无 `getLastGroupSync` 等导入 | ⏳ 未实现 |
| 3b | 新增 `SLACK_SYNC_SENTINEL` / `SLACK_SYNC_INTERVAL_MS` 常量 | 不存在 | ⏳ 未实现 |
| 3c | 新增 `syncTimerStarted` / `syncTimer` 类字段 | 不存在 | ⏳ 未实现 |
| 3d | 新增 `syncChannelMetadata()` 方法 | 不存在 | ⏳ 未实现 |
| 3e | `connect()` 末尾触发同步 + 定时器 | `slack.ts:115-117` 仅 `startWatchdog()`，无 sync | ⏳ 未实现 |
| 3f | `disconnect()` 清理 sync 定时器 | `slack.ts:164-174` 仅清理 watchdog | ⏳ 未实现 |
| 4a | MockApp.client 添加 `conversations` mock | `slack.test.ts:27-35` 无 `conversations` | ⏳ 未实现 |
| 4b | 新增 `vi.mock('../db.js')` | 不存在 | ⏳ 未实现 |
| 4c | 新增 `syncChannelMetadata` 测试 describe（5 用例） | 不存在 | ⏳ 未实现 |
| 5 | `routing.test.ts` 新增 `__slack_sync__` 排除测试 | 仅有 `__group_sync__` 测试（第 42-49 行） | ⏳ 未实现 |

**结论**：T12 计划 5 步 16 子项，0/16 已实现。全部待开发。


---

## 10. 审计修正记录（2026-02-24，Round 3 一致性审查）

基于完成报告 `slack-round3-completion-report.md` 与本跟踪矩阵的交叉审计，发现以下不一致并已修正：

| # | 文件 | 原始声明 | 实际状态 | 修正 |
| --- | --- | --- | --- | --- |
| 1 | 跟踪矩阵 R14 | 384 测试, 35 Slack 测试 | 388 测试, 43 Slack 测试（R3 新增 6 个看门狗测试） | → 388/43 |
| 2 | 跟踪矩阵 §3 P1 | Socket 静默失联: 3min 陈旧阈值 | `STALE_THRESHOLD = 12 * 60 * 1000`（R3 Fix 1） | → 12min |
| 3 | 跟踪矩阵 §6 | 条件金丝雀发布: ⏳ 待执行 | R3 金丝雀已执行，C1-C5 全部 PASS，裁决 PROMOTE | → ✅ PROMOTE |
| 4 | 跟踪矩阵 §1/§5 | 无 Round 3 记录 | R3 含 9 项修复、6 个新测试、reconnect-policy.ts、2 个脚本 | → 新增 W5-R3 行 + R3 门控段 |
| 5 | 完成报告 §3/§6 | `scripts/canary-checkpoint.sh` | 实际路径 `scripts/slack/canary-checkpoint.sh` | → 修正路径 |
| 6 | 完成报告 §3/§6 | `scripts/soak-monitor.sh` | 实际路径 `scripts/slack/soak-monitor.sh` | → 修正路径 |
| 7 | 完成报告 Fix 2 | 变量名 `lastHeartbeat` | 实际变量名 `lastEventTs` | → 修正伪代码 |

---

## 11. W6 开发计划：T12 频道名称自动同步（双态流程）

### 前置状态

- 当前分支：`deep-test-r2`
- 当前态：**deployed**（`slack.ts` 已在 `src/`，388 测试通过）
- Round 3 看门狗修复已 PROMOTE，代码稳定
- T12 计划已完成详细设计（`curious-soaring-petal.md`，406 行，16 子项全部有精确代码）

### 执行策略

T12 修改涉及 `src/db.ts`、`src/index.ts`、`src/channels/slack.ts`、`src/channels/slack.test.ts`、`src/routing.test.ts` 共 5 个文件。由于当前已处于 deployed 态，且所有修改均为 `src/` 文件，采用以下流程：

```
W6（T12 频道名称自动同步 — 5 步，严格串行）：

Step 1: db.ts 参数化 + 新增函数（deployed 态）
  ├── 1a: getLastGroupSync() 加 sentinel 默认参数
  ├── 1b: setLastGroupSync() 加 sentinel 默认参数
  ├── 1c: 新增 updateRegisteredGroupName(jid, name)
  └── 门控：npm run build 通过 + 现有测试不回归

Step 2: index.ts sentinel 泛化 + IPC 扩展（deployed 态）
  ├── 2a: 第 107 行 filter 改为 !c.jid.startsWith('__')
  ├── 2b: 第 487 行 syncGroupMetadata 扩展调用 Slack sync
  └── 门控：npm run build 通过 + 现有测试不回归

Step 3: slack.ts 核心 syncChannelMetadata 实现（deployed 态）
  ├── 3a: 新增 db 函数 import
  ├── 3b: 新增 SLACK_SYNC_SENTINEL / SLACK_SYNC_INTERVAL_MS 常量
  ├── 3c: 新增 syncTimerStarted / syncTimer 类字段
  ├── 3d: 新增 syncChannelMetadata() 方法
  ├── 3e: connect() 末尾触发同步 + 定时器
  ├── 3f: disconnect() 清理 sync 定时器
  └── 门控：npm run build 通过 + 现有 43 Slack 测试不回归

Step 4: slack.test.ts 新增 sync 测试（deployed 态）
  ├── 4a: MockApp.client 添加 conversations mock
  ├── 4b: 新增 vi.mock('../db.js')
  ├── 4c: 新增 syncChannelMetadata describe（5 用例）
  └── 门控：npx vitest run src/channels/slack.test.ts 全部通过

Step 5: routing.test.ts sentinel 排除测试（deployed 态）
  ├── 新增 __slack_sync__ sentinel 排除测试
  └── 门控：npx vitest run src/routing.test.ts 全部通过
```

### 最终门控

| 门控条件 | 验证方式 |
| --- | --- |
| `npm run build` 零错误 | 编译输出 |
| `npx vitest run` 全量测试通过（预期 393+ tests） | vitest 输出 |
| 新增 5 个 sync 测试 + 1 个 sentinel 测试全部通过 | vitest 输出 |
| 现有 388 测试无回归 | vitest 输出 |
| `lsp_diagnostics` 变更文件零错误 | LSP 检查 |

### 回写技能包

T12 代码在 deployed 态验证通过后，需同步回写至技能包：

| src/ 文件 | 回写目标 |
| --- | --- |
| `src/channels/slack.ts` | `.claude/skills/add-slack/add/src/channels/slack.ts` |
| `src/channels/slack.test.ts` | `.claude/skills/add-slack/add/src/channels/slack.test.ts` |
| `src/db.ts` | `.claude/skills/add-slack/modify/src/db.ts`（更新 3-way merge 目标）|
| `src/index.ts` | `.claude/skills/add-slack/modify/src/index.ts`（更新 3-way merge 目标）|
| `src/routing.test.ts` | `.claude/skills/add-slack/modify/src/routing.test.ts`（更新 3-way merge 目标）|

### Slack OAuth 前置条件

T12 使用 `conversations.list` API，需确认 Bot Token Scopes 包含：
- `channels:read` — 读取公共频道
- `groups:read` — 读取私有频道

### 预估

- 代码量：~80 行新增（db 15 + index 8 + slack 50 + tests 60 + routing 8 ≈ 141 行，含测试）
- 风险：低（所有代码已在 curious-soaring-petal.md 中精确设计，无架构变更）
- 依赖：无外部依赖新增（`conversations.list` 已在 `@slack/bolt` 内置）