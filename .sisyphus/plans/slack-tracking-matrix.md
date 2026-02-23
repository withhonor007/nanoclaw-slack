# Slack 集成功能实现跟踪矩阵

> 生成日期：2026-02-23 | 审计修正：2026-02-23（基于提交 `9f54644`）| W4 更新：2026-02-23
> 关联路线图：`.sisyphus/plans/slack-roadmap-next-phase.md`
> 关联需求：`feature_docs/slack-map.md`（R1-R15）
> 关联边界情况：`feature_docs/slack-edge-cases.md`（§1-§10）

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
| W3   | T9   | Token 生命周期 + Socket 看门狗    | unspecified-high | ✅ 完成 | `slack.ts` 看门狗逻辑                           |
| W3   | T10  | 运维手册 + 条件金丝雀 + 回滚协议  | writing          | ✅ 完成 | `docs/slack/T10-canary-ops-rollback.md`         |
| W3   | T11  | 延后积压清单 + 最终合规审计       | writing          | ✅ 完成 | `docs/slack/T11-deferred-backlog-compliance.md` |
| W4   | T5a  | 最小内核接线（审查新增）          | quick            | ✅ 完成 | W4 Step 4 经 apply-skill 验证                   |
| —    | T5b  | 高级重构（\*\_ONLY 统一语义）     | —                | ➖ 延后 | —                                               |

**统计**：11/11 执行任务全部完成，1 个高级重构延后（T5b）。**可进入金丝雀发布。**

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
| R14  | 测试规范              |     |     |     |  ●  |     |  ●  |  ●  |  ●  |  ●  |     |  ◎  | ✅ deployed 384 测试通过 + 1 todo（含 35 Slack 测试），undeployed 345 通过 |
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
| Socket 静默失联     | §9.3 | T9       | ✅ 已实现 | 60s 检查 + 3min 陈旧阈值          |
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

**门控通过率**：24/24（100%）。

---

## 6. 下一步行动

| 优先级    | 行动                            | 状态        |
| --------- | ------------------------------- | ----------- |
| ~~🔴 P0~~ | ~~修复 TD-1（时间戳精度）~~     | ✅ 已完成   |
| ~~🔴 P0~~ | ~~修复 TD-3（文档契约漂移）~~   | ✅ 已完成   |
| ~~🔴 P0~~ | ~~执行 T5a（最小内核接线）~~    | ✅ 已完成   |
| ~~🟡 P1~~ | ~~修复 TD-2（看门狗状态）~~     | ✅ 已完成   |
| ~~🟡 P1~~ | ~~修复 TD-5（端到端冒烟测试）~~ | ✅ 已验证   |
| 🟢 P2     | 简化 TD-4（clean.sh）           | ➖ 金丝雀后 |
| 🟢 P2     | 条件金丝雀发布                  | ⏳ 待执行   |

**关键路径已清除。** 所有阻塞金丝雀发布的任务已完成。下一步：按 `docs/slack/T10-canary-ops-rollback.md` 执行条件金丝雀发布。

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
