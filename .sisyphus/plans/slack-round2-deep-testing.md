# Slack 通道第二轮深度测试计划

## TL;DR

> **目标**: 对 NanoClaw Slack 通道进行全流程端到端深度测试，从状态修复 → 部署切换 → 服务激活 → 频道注册 → 功能验证 → 弹性测试 → 金丝雀观察 → 推广/回滚。
>
> **交付物**:
>
> - Slack 通道在 deployed 态下完整运行并通过 5 项金丝雀退出条件
> - 每阶段证据文件收集到 `.sisyphus/evidence/`
> - 最终测试报告记录到本计划的执行记录章节
>
> **预估工作量**: Medium（部署 ~1h + 金丝雀观察 ≥24h + 收尾 ~1h）
> **并行执行**: NO — 严格串行（每阶段有 GO/NO-GO 门控）
> **关键路径**: Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

---

## Context

### 原始需求

用户要求参考 `docs/slack-user-guide.md` 和 `docs/slack/W4-canary-testing-runbook.md`，对全流程 Slack 通道部署进行第二轮深度测试。Slack 集成已还原（技能包存在于 `.claude/skills/add-slack/`，W4 阶段 24/24 门控全部通过）。

### 当前状态（Metis 审计发现）

- `.nanoclaw/dev-mode` 显示 `deployed`，但 `src/channels/slack.ts` **不存在**
- `.nanoclaw/state.yaml` 记录 `add-slack` 已应用
- 测试数为 345（undeployed 计数），非 384（deployed 计数）
- `@slack/bolt` 已安装在 `node_modules/`
- 已有快照：`predeploy-w4`、`deployed-w4-verified`、`pre-canary`、`canary-deployed`

**结论**：系统处于不一致状态，必须先修复再开始测试。

### 关键参考文档

- `docs/slack-user-guide.md` — 用户指南（安装、注册、使用、运维、故障排除）
- `docs/slack/W4-canary-testing-runbook.md` — W4 金丝雀测试运行手册（§0-§8）
- `docs/slack/T10-canary-ops-rollback.md` — 金丝雀协议与回滚（5 退出条件、4 回滚触发、监控命令）
- `.sisyphus/plans/slack-tracking-matrix.md` — 跟踪矩阵（24/24 门控、15/15 需求覆盖）
- `.claude/skills/add-slack/SKILL.md` — 技能定义（5 阶段部署流程）

---

## Work Objectives

### 核心目标

验证 Slack 通道从部署到生产运行的完整流程，确保所有安全机制（去重、看门狗、限流恢复、Token 生命周期）在真实环境中正常工作。

### 具体交付物

- deployed 态下 384 测试全部通过 + 构建成功
- Socket Mode 连接成功并保持稳定
- 至少 1 个 Main Channel + 1 个 Regular Channel 注册并正常收发消息
- 5 项金丝雀退出条件全部满足
- 每阶段证据文件完整收集

### 完成定义

- [ ] `npx vitest run` → 384 passed, 0 failures（deployed 态）
- [ ] `npm run build` → exit code 0
- [ ] `Slack bot connected via Socket Mode` 出现在日志中
- [ ] `!chatid` 命令在 Slack 中返回正确频道 ID
- [ ] 金丝雀 5 项退出条件全部 ☑
- [ ] 证据文件存在于 `.sisyphus/evidence/`

### Must Have

- 状态不一致修复（Phase 0）
- 完整的 undeployed → deployed 切换流程
- Token 有效性预验证（部署前）
- 初始健康检查（Socket Mode 连接 + `!chatid` 往返）
- 功能深度测试（Main Channel + Regular Channel + 触发词 + @mention）
- 金丝雀观察期（≥24h，5 项退出条件）
- 回滚就绪验证

### Must NOT Have（护栏）

- 不修改任何源代码文件 — 发现 bug 记录到"发现问题"章节
- 不删除或覆盖已有快照（`predeploy-w4`、`deployed-w4-verified`、`pre-canary`、`canary-deployed`）
- 不运行 `clean.sh nuke`、`clean.sh data` 或任何破坏性清理命令
- 不在 undeployed 态提交核心 guard 文件变更
- 不测试 WhatsApp 功能（本次仅测试 Slack 通道）
- 不编写监控自动化脚本（使用 T10 中的手动命令）
- 不扩展测试范围到 W4 runbook 未覆盖的功能

---

## Verification Strategy

> **零人工干预** — 所有验证由 agent 执行。不允许"用户手动确认"类验收标准。

### 测试决策

- **基础设施存在**: YES（vitest 已配置）
- **自动化测试**: YES（Tests-after — 运行已有测试套件验证）
- **框架**: vitest
- **TDD**: 否 — 本计划不编写新代码，仅运行已有测试

### QA 策略

每个任务包含 agent 可执行的 QA 场景。证据保存到 `.sisyphus/evidence/task-{N}-{slug}.{ext}`。

- **服务验证**: 使用 Bash（journalctl/grep/sqlite3）— 检查日志、数据库、进程状态
- **Slack 交互**: 使用 Bash（curl Slack API）— 发送测试消息、验证响应
- **状态检查**: 使用 Bash（clean.sh/ls/npm）— 验证文件存在性、测试计数、构建状态

---

## Execution Strategy

### 执行阶段（严格串行）

```
Phase 0（状态修复 + 预检，~30min）：
├── Task 1: 状态不一致修复 — 恢复到干净 undeployed 基线 [quick]
├── Task 2: 预检清单验证 — 确认 6 项前置条件 [quick]
└── Task 3: Token 有效性预验证 [quick]

Phase 1（部署切换 + 验证，~30min）：
├── Task 4: 创建 Round 2 部署前快照 [quick]
├── Task 5: 执行 deployed 态切换 [quick]
└── Task 6: 部署态验证清单（5 项） [quick]

Phase 2（服务激活 + 初始健康检查，~30min）：
├── Task 7: 环境变量配置与同步 [quick]
├── Task 8: 服务重启 + 初始健康检查 [quick]
└── Task 9: 频道注册（Main + Regular） [quick]

Phase 3（功能深度测试 + 弹性测试，~2h）：
├── Task 10: Main Channel 功能测试 [unspecified-high]
├── Task 11: Regular Channel 功能测试 [unspecified-high]
├── Task 12: 消息边界与格式测试 [unspecified-high]
└── Task 13: 弹性机制验证（去重、看门狗、限流） [deep]

Phase 4（金丝雀观察期，≥24h）：
├── Task 14: 金丝雀观察 — T+1h 检查点 [unspecified-high]
├── Task 15: 金丝雀观察 — T+4h 检查点 [unspecified-high]
├── Task 16: 金丝雀观察 — T+8h 检查点 [unspecified-high]
└── Task 17: 金丝雀观察 — T+24h 最终检查点 [deep]

Phase 5（退出判定 + 收尾，~30min）：
├── Task 18: 金丝雀退出判定 — 5 项条件汇总 [deep]
└── Task 19: 创建金丝雀成功快照 + 推广提交 [quick]

Critical Path: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10-T13 → T14-T17 → T18 → T19
```

### 依赖矩阵

| 任务    | 依赖    | 解锁    | 阶段    |
| ------- | ------- | ------- | ------- |
| T1      | —       | T2      | Phase 0 |
| T2      | T1      | T3      | Phase 0 |
| T3      | T2      | T4      | Phase 0 |
| T4      | T3      | T5      | Phase 1 |
| T5      | T4      | T6      | Phase 1 |
| T6      | T5      | T7      | Phase 1 |
| T7      | T6      | T8      | Phase 2 |
| T8      | T7      | T9      | Phase 2 |
| T9      | T8      | T10-T13 | Phase 2 |
| T10-T13 | T9      | T14     | Phase 3 |
| T14     | T10-T13 | T15     | Phase 4 |
| T15     | T14     | T16     | Phase 4 |
| T16     | T15     | T17     | Phase 4 |
| T17     | T16     | T18     | Phase 4 |
| T18     | T17     | T19     | Phase 5 |
| T19     | T18     | —       | Phase 5 |

### Agent 分配摘要

- **Phase 0**: 3 tasks → `quick` × 3
- **Phase 1**: 3 tasks → `quick` × 3
- **Phase 2**: 3 tasks → `quick` × 3
- **Phase 3**: 4 tasks → `unspecified-high` × 3, `deep` × 1
- **Phase 4**: 4 tasks → `unspecified-high` × 3, `deep` × 1
- **Phase 5**: 2 tasks → `deep` × 1, `quick` × 1

---

## TODOs

- [x] 1. 状态不一致修复 — 恢复到干净 undeployed 基线 ✅

  **What to do**:
  - 运行 `./feature_docs/clean.sh status` 确认当前状态不一致
  - 运行 `./feature_docs/clean.sh switch undeployed predeploy-w4` 恢复到 W4 前的干净 undeployed 基线
  - 运行 `npm install` 重新安装依赖
  - 验证恢复结果

  **Must NOT do**:
  - 不删除已有快照
  - 不运行 `clean.sh nuke` 或 `clean.sh data`
  - 不手动编辑 `.nanoclaw/` 下的文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References**:
  - `feature_docs/clean.sh:273-291` — `switch_to_undeployed()` 函数，使用快照恢复 + 清理构建/测试缓存/IPC
  - `docs/slack/W4-canary-testing-runbook.md:10-21` — §0 前置条件检查表
  - `.sisyphus/plans/slack-tracking-matrix.md:243-246` — 已有快照列表

  **Acceptance Criteria**:
  - [ ] `./feature_docs/clean.sh status` → 输出包含 `Mode: undeployed`
  - [ ] `ls src/channels/slack.ts 2>/dev/null && echo EXISTS || echo MISSING` → `MISSING`
  - [ ] `npx vitest run 2>&1 | tail -1` → 包含 `345 passed`
  - [ ] `npm run build` → exit code 0

  **QA Scenarios**:

  ```
  Scenario: 状态恢复到干净 undeployed 基线
    Tool: Bash
    Preconditions: 系统处于不一致状态（dev-mode=deployed 但 slack.ts 不存在）
    Steps:
      1. 运行 `./feature_docs/clean.sh status` — 记录当前状态
      2. 运行 `./feature_docs/clean.sh switch undeployed predeploy-w4`
      3. 运行 `npm install`
      4. 运行 `./feature_docs/clean.sh status` — 确认 `Mode: undeployed`
      5. 运行 `ls src/channels/slack.ts 2>/dev/null` — 确认文件不存在
      6. 运行 `npx vitest run` — 确认 345 tests passed
      7. 运行 `npm run build` — 确认 exit code 0
    Expected Result: 系统恢复到干净 undeployed 态，345 测试通过，构建成功
    Failure Indicators: clean.sh 报错、测试数不为 345、构建失败
    Evidence: .sisyphus/evidence/task-1-state-fix.txt
  ```

  **Commit**: NO

- [x] 2. 预检清单验证 — 确认 6 项前置条件 ✅

  **What to do**:
  - 逐一验证 W4 runbook §0 的 6 项前置条件
  - 记录每项检查结果到证据文件

  **Must NOT do**:
  - 不跳过任何检查项
  - 任一条件不满足时停止并报告

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:10-21` — §0 前置条件检查表（6 项）
  - `.sisyphus/plans/slack-tracking-matrix.md:112-139` — §5 波次门控状态（24/24）

  **Acceptance Criteria**:
  - [ ] 0-1: `.sisyphus/plans/slack-tracking-matrix.md` §5 显示 24/24 ✅
  - [ ] 0-2: `git status` → `nothing to commit, working tree clean`（或仅有 .sisyphus/ 变更）
  - [ ] 0-3: `./feature_docs/clean.sh status` → `Mode: undeployed`
  - [ ] 0-4: `./feature_docs/clean.sh snapshots` → 至少有 `predeploy-w4` 快照
  - [ ] 0-5: `npx vitest run` → 345 tests, 0 failures
  - [ ] 0-6: `npm run build` → exit code 0

  **QA Scenarios**:

  ```
  Scenario: 6 项前置条件全部通过
    Tool: Bash
    Preconditions: Task 1 已完成，系统处于干净 undeployed 态
    Steps:
      1. 检查 `.sisyphus/plans/slack-tracking-matrix.md` 中 §5 门控状态
      2. 运行 `git status` — 确认工作树干净
      3. 运行 `./feature_docs/clean.sh status` — 确认 undeployed
      4. 运行 `./feature_docs/clean.sh snapshots` — 确认快照存在
      5. 运行 `npx vitest run` — 确认 345 passed
      6. 运行 `npm run build` — 确认 exit code 0
    Expected Result: 6/6 条件全部满足
    Failure Indicators: 任一条件不满足
    Evidence: .sisyphus/evidence/task-2-preflight.txt
  ```

  **Commit**: NO

- [x] 3. Token 有效性预验证 ✅

  **What to do**:
  - 读取 `.env` 中的 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN`
  - 验证 token 格式（`xoxb-` 和 `xapp-` 前缀）
  - 使用 `curl` 调用 Slack `auth.test` API 验证 token 有效性
  - 如果 token 无效，停止并报告（需要用户重新生成）

  **Must NOT do**:
  - 不在日志或证据文件中记录完整 token 值（仅记录前缀 + 最后 4 位）
  - 不修改 `.env` 文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:92-122` — §2 环境配置
  - `docs/slack-user-guide.md:92-110` — Token 格式说明
  - `.claude/skills/add-slack/SKILL.md:261-265` — Token 错误排查

  **Acceptance Criteria**:
  - [ ] `grep SLACK_BOT_TOKEN .env` → 值以 `xoxb-` 开头
  - [ ] `grep SLACK_APP_TOKEN .env` → 值以 `xapp-` 开头
  - [ ] `curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test` → `"ok":true`

  **QA Scenarios**:

  ```
  Scenario: Token 格式和有效性验证
    Tool: Bash
    Preconditions: .env 文件存在且包含 SLACK_BOT_TOKEN 和 SLACK_APP_TOKEN
    Steps:
      1. 运行 `grep -c 'SLACK_BOT_TOKEN=xoxb-' .env` — 确认格式正确
      2. 运行 `grep -c 'SLACK_APP_TOKEN=xapp-' .env` — 确认格式正确
      3. 运行 `source .env && curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test | grep -o '"ok":[a-z]*'` — 确认返回 `"ok":true`
    Expected Result: 两个 token 格式正确且 auth.test 返回 ok:true
    Failure Indicators: token 缺失、格式错误、auth.test 返回 ok:false 或 invalid_auth
    Evidence: .sisyphus/evidence/task-3-token-validation.txt

  Scenario: Token 无效时的失败处理
    Tool: Bash
    Preconditions: 同上
    Steps:
      1. 如果 auth.test 返回 `"ok":false`，记录错误信息
      2. 输出 `FAIL: Token 无效，需要用户重新生成` 并停止后续任务
    Expected Result: 明确的失败信息和停止指令
    Evidence: .sisyphus/evidence/task-3-token-validation-error.txt
  ```

  **Commit**: NO
- [x] 4. 创建 Round 2 部署前快照 ✅
  **What to do**:
  - 运行 `./feature_docs/clean.sh backup pre-canary-r2` 创建本轮测试的部署前快照
  - 验证快照创建成功
  **Must NOT do**:
  - 不覆盖已有快照（如果 `pre-canary-r2` 已存在，使用 `pre-canary-r2-{timestamp}` 命名）
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 5
  - **Blocked By**: Task 3
  **References**:
  - `feature_docs/clean.sh:200-228` — `create_snapshot()` 函数
  - `docs/slack/W4-canary-testing-runbook.md:130-139` — §3.1 创建部署前快照
  **Acceptance Criteria**:
  - [ ] `./feature_docs/clean.sh snapshots` → 列表中包含 `pre-canary-r2`
  **QA Scenarios**:
  ```
  Scenario: 快照创建成功
    Tool: Bash
    Preconditions: Task 3 已完成，系统处于 undeployed 态
    Steps:
      1. 运行 `./feature_docs/clean.sh backup pre-canary-r2`
      2. 运行 `./feature_docs/clean.sh snapshots` — 确认快照存在
    Expected Result: 快照 `pre-canary-r2` 出现在列表中
    Evidence: .sisyphus/evidence/task-4-snapshot.txt
  ```
  **Commit**: NO

- [x] 5. 执行 deployed 态切换 ✅
  **What to do**:
  - 运行 `./feature_docs/clean.sh switch deployed` 执行技能包应用
  - 该命令会运行 `npx tsx scripts/apply-skill.ts .claude/skills/add-slack`
  - 应用后运行 `npm install` 安装新依赖
  **Must NOT do**:
  - 不直接调用 `apply-skill.ts`（通过 clean.sh 管理）
  - 不手动编辑 `src/` 下的任何文件
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 6
  - **Blocked By**: Task 4
  **References**:
  - `feature_docs/clean.sh:294-312` — `switch_to_deployed()` 函数
  - `scripts/apply-skill.ts:1-14` — 技能应用入口
  - `docs/slack/W4-canary-testing-runbook.md:141-173` — §3.2-3.3 切换到 deployed 态
  - `.claude/skills/add-slack/SKILL.md:24-65` — Phase 2 应用代码变更
  **Acceptance Criteria**:
  - [ ] `./feature_docs/clean.sh status` → `Mode: deployed`
  - [ ] `ls src/channels/slack.ts` → 文件存在
  - [ ] `ls node_modules/@slack/bolt/package.json` → 文件存在
  **QA Scenarios**:
  ```
  Scenario: 技能包成功应用到 src/
    Tool: Bash
    Preconditions: Task 4 已完成，快照已创建
    Steps:
      1. 运行 `./feature_docs/clean.sh switch deployed`
      2. 运行 `npm install`
      3. 运行 `./feature_docs/clean.sh status` — 确认 `Mode: deployed`
      4. 运行 `ls src/channels/slack.ts` — 确认文件存在
      5. 运行 `ls node_modules/@slack/bolt/package.json` — 确认依赖安装
    Expected Result: deployed 态切换成功，slack.ts 存在，@slack/bolt 已安装
    Failure Indicators: clean.sh 报错、文件缺失、npm install 失败
    Evidence: .sisyphus/evidence/task-5-deploy-switch.txt
  ```
  **Commit**: NO

- [x] 6. 部署态验证清单ﾈ5 项ﾉ ✅
  **What to do**:
  - 逐一验证 W4 runbook §3.4 的 5 项部署态检查
  - 运行全量测试套件（期望 384 tests）
  - 运行构建（期望 exit code 0）
  - 创建 deployed 快照 `canary-deployed-r2`
  **Must NOT do**:
  - 不跳过任何检查项
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 7
  - **Blocked By**: Task 5
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:175-184` — §3.4 部署态验证清单
  **Acceptance Criteria**:
  - [ ] 3-1: `./feature_docs/clean.sh status` → `Mode: deployed`
  - [ ] 3-2: `ls src/channels/slack.ts` → 文件存在
  - [ ] 3-3: `ls node_modules/@slack/bolt/package.json` → 文件存在
  - [ ] 3-4: `npx vitest run` → 384 tests, 0 failures
  - [ ] 3-5: `npm run build` → exit code 0
  - [ ] 快照 `canary-deployed-r2` 已创建
  **QA Scenarios**:
  ```
  Scenario: deployed 态 5 项验证全部通过
    Tool: Bash
    Preconditions: Task 5 已完成
    Steps:
      1. 运行 `./feature_docs/clean.sh status` — 确认 `Mode: deployed`
      2. 运行 `ls src/channels/slack.ts` — 确认文件存在
      3. 运行 `ls node_modules/@slack/bolt/package.json` — 确认依赖
      4. 运行 `npx vitest run` — 确认 384 passed
      5. 运行 `npm run build` — 确认 exit code 0
      6. 运行 `./feature_docs/clean.sh backup canary-deployed-r2`
    Expected Result: 5/5 检查通过 + 快照已创建
    Failure Indicators: 测试数不为 384、构建失败、文件缺失
    Evidence: .sisyphus/evidence/task-6-deploy-verify.txt
  ```
  **Commit**: NO
- [x] 7. 环境变量配置与同步 ✅
  **What to do**:
  - 确认 `.env` 中 `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN` 已配置
  - 确认 `SLACK_ONLY` 设置（本次测试使用 `SLACK_ONLY=true` 仅测试 Slack）
  - 运行 `mkdir -p data/env && cp .env data/env/env` 同步到容器环境
  - 验证 `.env` 和 `data/env/env` 内容一致
  **Must NOT do**:
  - 不修改 token 值（仅验证和同步）
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 8
  - **Blocked By**: Task 6
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:92-122` — §2 环境配置
  - `docs/slack-user-guide.md:99-127` — Configure Tokens + 同步
  **Acceptance Criteria**:
  - [ ] `grep -E 'SLACK_BOT_TOKEN|SLACK_APP_TOKEN|SLACK_ONLY' .env` → 3 行输出
  - [ ] `grep -E 'SLACK_BOT_TOKEN|SLACK_APP_TOKEN|SLACK_ONLY' data/env/env` → 与 .env 一致
  **QA Scenarios**:
  ```
  Scenario: 环境变量同步到容器环境
    Tool: Bash
    Preconditions: Task 6 已完成，.env 包含 Slack token
    Steps:
      1. 运行 `grep -c 'SLACK_BOT_TOKEN=xoxb-' .env` — 确认存在
      2. 运行 `mkdir -p data/env && cp .env data/env/env`
      3. 运行 `diff <(grep -E 'SLACK_BOT_TOKEN|SLACK_APP_TOKEN|SLACK_ONLY' .env) <(grep -E 'SLACK_BOT_TOKEN|SLACK_APP_TOKEN|SLACK_ONLY' data/env/env)` — 确认一致
    Expected Result: 两处配置完全一致
    Evidence: .sisyphus/evidence/task-7-env-sync.txt
  ```
  **Commit**: NO
- [x] 8. 服务重启 + 初始健康检查 ✅
  **What to do**:
  - 重启 NanoClaw 服务（Linux: `systemctl --user restart nanoclaw`）
  - 等待 30 秒后执行初始健康检查
  - 检查 1: Socket Mode 连接成功（日志中出现 `Slack bot connected via Socket Mode`）
  - 检查 2: 无启动错误（`logs/nanoclaw.error.log` 为空或不存在）
  - 检查 3: 在 Slack 中发送 `!chatid` 测试消息收发
  **Must NOT do**:
  - 不在健康检查失败时继续后续任务
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 9
  - **Blocked By**: Task 7
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:187-256` — §4 服务启动与初始健康检查
  - `docs/slack-user-guide.md:259-297` — Operations & Monitoring
  - `.claude/skills/add-slack/add/src/channels/slack.ts:91-101` — auth.test() + 连接日志
  **Acceptance Criteria**:
  - [ ] 4-1: `grep 'Slack bot connected via Socket Mode' logs/nanoclaw.log | tail -1` → 有输出
  - [ ] 4-2: `cat logs/nanoclaw.error.log 2>/dev/null | wc -l` → 0
  - [ ] 4-3: `!chatid` 命令在 Slack 中返回 `Chat ID: slack:C*` 或 `slack:D*`
  **QA Scenarios**:
  ```
  Scenario: 服务启动并通过 3 项健康检查
    Tool: Bash
    Preconditions: Task 7 已完成，环境变量已同步
    Steps:
      1. 运行 `systemctl --user restart nanoclaw`
      2. 等待 30 秒: `sleep 30`
      3. 运行 `grep 'Slack bot connected via Socket Mode' logs/nanoclaw.log | tail -1` — 确认连接
      4. 运行 `cat logs/nanoclaw.error.log 2>/dev/null | wc -l` — 确认无错误
      5. 运行 `grep 'Slack auth.test failed' logs/nanoclaw.log | wc -l` — 确认为 0
    Expected Result: Socket Mode 连接成功，无启动错误，无 auth 失败
    Failure Indicators: 无连接日志、error.log 非空、auth.test 失败
    Evidence: .sisyphus/evidence/task-8-health-check.txt
  Scenario: auth.test 失败进入 safe mode
    Tool: Bash
    Preconditions: 同上
    Steps:
      1. 检查 `grep 'Slack auth.test failed' logs/nanoclaw.log`
      2. 如果存在 → 记录错误并触发回滚
    Expected Result: 无 auth.test 失败日志
    Evidence: .sisyphus/evidence/task-8-health-check-error.txt
  ```
  **Commit**: NO
- [x] 9. 频道注册（Main + Regular） ✅
  **What to do**:
  - 在 Slack 中向 bot 发送 `!chatid` 获取 DM 频道 ID（用于 Main Channel）
  - 在 Slack 公共频道中 `/invite @BotName` 后发送 `!chatid` 获取频道 ID（用于 Regular Channel）
  - 使用 SQLite 注册 Main Channel（folder: main, requiresTrigger: false）
  - 使用 SQLite 注册 Regular Channel（folder: 自定义名称, requiresTrigger: true）
  - 验证注册结果
  **Must NOT do**:
  - 不注册超过 2 个频道（本次测试仅需 1 Main + 1 Regular）
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 10, 11, 12, 13
  - **Blocked By**: Task 8
  **References**:
  - `docs/slack-user-guide.md:130-177` — Register Channels
  - `docs/slack/W4-canary-testing-runbook.md:232-245` — §4.2 检查 3 发送测试消息
  - `.claude/skills/add-slack/SKILL.md:121-157` — Phase 4 Registration
  **Acceptance Criteria**:
  - [ ] `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"` → 至少 2 行
  - [ ] Main Channel: folder='main', requiresTrigger=0
  - [ ] Regular Channel: requiresTrigger=1
  **QA Scenarios**:
  ```
  Scenario: 两个频道注册成功
    Tool: Bash
    Preconditions: Task 8 已完成，bot 在线
    Steps:
      1. 在 Slack DM 中发送 `!chatid` — 记录返回的 `slack:D*` ID
      2. 在 Slack 公共频道中发送 `!chatid` — 记录返回的 `slack:C*` ID
      3. 注册 Main Channel（通过 IPC 或直接 SQLite）
      4. 注册 Regular Channel
      5. 运行 `sqlite3 store/messages.db "SELECT jid, name, folder FROM registered_groups WHERE jid LIKE 'slack:%'"` — 确认 2 行
    Expected Result: 2 个 Slack 频道已注册，Main 和 Regular 各一个
    Evidence: .sisyphus/evidence/task-9-channel-registration.txt
  ```
  **Commit**: NO
- [x] 10. Main Channel 功能测试 ✅
  **What to do**:
  - 在 Main Channel（DM）中发送普通消息（无触发词）— 验证 bot 直接响应
  - 发送多条消息验证消息队列处理
  - 验证 Agent 容器正确启动并返回响应
  - 检查日志中 `Slack message sent` 事件
  - 检查 SQLite 中消息记录
  **Must NOT do**:
  - 不测试跨频道功能（本任务仅测试 Main Channel）
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 11, 12 可并行，但建议串行以避免日志混淆）
  - **Blocks**: Task 14
  - **Blocked By**: Task 9
  **References**:
  - `docs/slack-user-guide.md:179-208` — Daily Usage: Main Channel
  - `.claude/skills/add-slack/modify/src/index.ts:125-220` — processGroupMessages() 消息处理流程
  - `.claude/skills/add-slack/add/src/channels/slack.ts:104-138` — sendMessage() 实现
  **Acceptance Criteria**:
  - [ ] Main Channel 中发送消息后 bot 在 60 秒内响应
  - [ ] `grep 'Slack message sent' logs/nanoclaw.log | tail -5` → 有新条目
  - [ ] `sqlite3 store/messages.db "SELECT COUNT(*) FROM messages WHERE chat_jid LIKE 'slack:D%'"` → ≥ 1
  **QA Scenarios**:
  ```
  Scenario: Main Channel 无触发词直接响应
    Tool: Bash
    Preconditions: Task 9 已完成，Main Channel 已注册
    Steps:
      1. 在 Slack DM 中发送 "Hello, what time is it?"
      2. 等待 60 秒
      3. 运行 `grep 'Slack message sent' logs/nanoclaw.log | tail -3` — 确认有新发送记录
      4. 运行 `sqlite3 store/messages.db "SELECT content FROM messages WHERE chat_jid LIKE 'slack:D%' ORDER BY timestamp DESC LIMIT 3"` — 确认消息已存储
    Expected Result: bot 响应消息，日志和数据库均有记录
    Failure Indicators: 60 秒内无响应、日志无 Slack message sent、数据库无记录
    Evidence: .sisyphus/evidence/task-10-main-channel.txt
  ```
  **Commit**: NO
- [x] 11. Regular Channel 功能测试 ✅
  **What to do**:
  - 在 Regular Channel 中发送不含触发词的消息 — 验证 bot 不响应
  - 发送含 @mention 的消息 — 验证 bot 响应
  - 发送含触发词（`@Andy`）的消息 — 验证 bot 响应
  - 验证频道隔离（Regular Channel Agent 只能访问自己的 groups/ 目录）
  **Must NOT do**:
  - 不测试 Main Channel 功能（已在 Task 10 覆盖）
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 10, 12 可并行）
  - **Blocks**: Task 14
  - **Blocked By**: Task 9
  **References**:
  - `docs/slack-user-guide.md:192-208` — Daily Usage: Regular Channels
  - `.claude/skills/add-slack/add/src/channels/slack.ts:223-295` — handleInboundEvent() 触发词检测
  - `.claude/skills/add-slack/add/src/channels/slack.ts:277-284` — mentionsBot 逻辑
  **Acceptance Criteria**:
  - [ ] 无触发词消息 → bot 不响应（日志中无对应 `Slack message sent`）
  - [ ] @mention 消息 → bot 在 60 秒内响应
  - [ ] `@Andy` 触发词消息 → bot 在 60 秒内响应
  **QA Scenarios**:
  ```
  Scenario: Regular Channel 触发词过滤
    Tool: Bash
    Preconditions: Task 9 已完成，Regular Channel 已注册
    Steps:
      1. 在 Regular Channel 中发送 "hello" （无触发词）
      2. 等待 30 秒
      3. 检查日志 — 确认无对应的 `Slack message sent`
      4. 在 Regular Channel 中发送 "@Andy what is 2+2?"
      5. 等待 60 秒
      6. 检查日志 — 确认有 `Slack message sent`
    Expected Result: 无触发词不响应，有触发词正常响应
    Evidence: .sisyphus/evidence/task-11-regular-channel.txt
  ```
  **Commit**: NO
- [x] 12. 消息边界与格式测试 ✅
  **What to do**:
  - 发送长消息（>40000 字符）— 验证自动分片
  - 发送包含代码块的消息 — 验证格式保留
  - 发送文件附件 — 验证占位符 `[File: name]` 传递
  - 验证 `!chatid` 在未注册频道中也能工作
  **Must NOT do**:
  - 不测试 mrkdwn 转换（已知限制，不在范围内）
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 10, 11 可并行）
  - **Blocks**: Task 14
  - **Blocked By**: Task 9
  **References**:
  - `docs/slack-user-guide.md:247-253` — Message Format & Limits
  - `.claude/skills/add-slack/add/src/channels/slack.ts:104-138` — sendMessage() 40k 分片逻辑
  - `.claude/skills/add-slack/add/src/channels/slack.ts:297-308` — extractContent() 文件附件处理
  - `.claude/skills/add-slack/add/src/channels/slack.test.ts:154-179` — 分片边界测试（40000/40001/120001）
  **Acceptance Criteria**:
  - [ ] 长消息被正确分片发送（日志中 postMessage 调用次数 > 1）
  - [ ] `!chatid` 在未注册频道中返回正确 ID
  **QA Scenarios**:
  ```
  Scenario: !chatid 在未注册频道中工作
    Tool: Bash
    Preconditions: bot 在线
    Steps:
      1. 在一个未注册的 Slack 频道中发送 `!chatid`
      2. 确认 bot 回复了 `Chat ID: slack:C*`
    Expected Result: bot 回复频道 ID（!chatid 不需要注册即可工作）
    Evidence: .sisyphus/evidence/task-12-message-boundary.txt
  ```
  **Commit**: NO
- [x] 13. 弹性机制验证（去重、看门狗、限流） ✅
  **What to do**:
  - **去重验证**: 快速连续发送相同消息，检查日志确认仅处理一次
  - **看门狗验证**: 检查日志中是否有 `socket_stale` / `socket_reconnect` 事件（如无自然触发，确认测试套件覆盖）
  - **限流验证**: 检查日志中是否有 `slack_rate_limited` 事件（如无自然触发，确认测试套件覆盖）
  - **Bot 自循环验证**: 确认 bot 不会响应自己的消息
  - **Safe Mode 验证**: 确认 `auth.test()` 成功（非 safe mode）
  **Must NOT do**:
  - 不主动制造故障（除非低流量场景需要合成演练）
  - 不修改代码来触发边界条件
  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO（需要在 Task 10-12 之后执行以积累日志）
  - **Blocks**: Task 14
  - **Blocked By**: Task 10, 11, 12
  **References**:
  - `.claude/skills/add-slack/add/src/channels/slack.ts:209-221` — isDuplicate() TTL 去重
  - `.claude/skills/add-slack/add/src/channels/slack.ts:165-207` — startWatchdog() 看门狗
  - `docs/slack/T10-canary-ops-rollback.md:9-18` — 5 项金丝雀退出条件
  - `docs/slack/W4-canary-testing-runbook.md:271-281` — §5.1 可选合成演练
  - `.claude/skills/add-slack/add/src/channels/slack.test.ts:371-412` — 去重测试
  - `.claude/skills/add-slack/add/src/channels/slack.test.ts:478-543` — 看门狗测试
  **Acceptance Criteria**:
  - [ ] 快速连续发送相同消息 → 日志中仅一次 `onMessage` 调用
  - [ ] `grep 'Slack auth.test failed' logs/nanoclaw.log | wc -l` → 0（非 safe mode）
  - [ ] 看门狗和限流：日志验证或测试套件覆盖确认
  **QA Scenarios**:
  ```
  Scenario: 消息去重验证
    Tool: Bash
    Preconditions: Task 10-12 已完成，有足够日志
    Steps:
      1. 在 Main Channel 中快速连续发送 3 条相同消息（间隔 < 1 秒）
      2. 等待 60 秒
      3. 检查日志中对应时间段的 `Slack message sent` 数量
    Expected Result: 仅 1 条 `Slack message sent`（去重生效）
    Evidence: .sisyphus/evidence/task-13-resilience.txt
  Scenario: 看门狗和限流测试覆盖确认
    Tool: Bash
    Preconditions: deployed 态
    Steps:
      1. 运行 `npx vitest run src/channels/slack.test.ts` — 确认看门狗和限流测试通过
      2. 检查日志中 `socket_stale` / `socket_reconnect` / `slack_rate_limited` 事件
    Expected Result: 测试通过；如有自然触发事件，记录到证据
    Evidence: .sisyphus/evidence/task-13-resilience-watchdog.txt
  ```
  **Commit**: NO
- [x] 14. 金丝雀观察 — T+1h 检查点 ✅（早期检查点 ~T+12min）
  **What to do**:
  - 服务启动 1 小时后执行第一次全量诊断
  - 运行 T10 §监控命令中的所有 5 项检查
  - 记录当前状态到证据文件
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 15
  - **Blocked By**: Task 13
  **References**:
  - `docs/slack/T10-canary-ops-rollback.md:68-92` — 监控命令
  - `docs/slack/W4-canary-testing-runbook.md:285-404` — §6 成功诊断
  **Acceptance Criteria**:
  - [ ] C1 Token 有效性: `grep 'Slack bot connected' logs/nanoclaw.log` → 有输出，零条 `token_revoked`
  - [ ] C5 进程运行中: `systemctl --user status nanoclaw` → active (running)
  - [ ] 无回滚触发条件
  **QA Scenarios**:
  ```
  Scenario: T+1h 全量诊断
    Tool: Bash
    Steps:
      1. `grep 'Slack bot connected via Socket Mode' logs/nanoclaw.log | wc -l` — ≥ 1
      2. `grep 'Slack auth.test failed' logs/nanoclaw.log | wc -l` — 0
      3. `grep -E 'token_revoked|app_uninstalled' logs/nanoclaw.log | wc -l` — 0
      4. `grep -E 'socket_stale|socket_reconnect' logs/nanoclaw.log` — 记录状态
      5. `grep slack_rate_limited logs/nanoclaw.log` — 记录状态
      6. `grep slack_send_failed logs/nanoclaw.log | wc -l` — 0
      7. `grep -c 'Slack message sent' logs/nanoclaw.log` — 记录进度
      8. `cat logs/nanoclaw.error.log 2>/dev/null | wc -l` — 0
      9. `systemctl --user status nanoclaw | grep Active` — active (running)
    Expected Result: 无回滚触发条件，服务稳定运行
    Evidence: .sisyphus/evidence/task-14-canary-1h.txt
  ```
  **Commit**: NO
- [x] 15. 金丝雀观察 — T+4h 检查点 ❌ BLOCKED（bot 在 T+59min 死亡）
  **What to do**:
  - 服务启动 4 小时后执行第二次全量诊断
  - 与 T+1h 检查点相同的 9 项命令
  - 对比 T+1h 和 T+4h 的消息计数增长
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 16
  - **Blocked By**: Task 14
  **References**:
  - 同 Task 14
  **Acceptance Criteria**:
  - [ ] 同 Task 14 的 9 项检查
  - [ ] `Slack message sent` 计数持续增长
  **QA Scenarios**:
  ```
  Scenario: T+4h 全量诊断
    Tool: Bash
    Steps: 同 Task 14 的 9 项命令
    Expected Result: 无回滚触发条件，消息计数增长
    Evidence: .sisyphus/evidence/task-15-canary-4h.txt
  ```
  **Commit**: NO
- [x] 16. 金丝雀观察 — T+8h 检查点 ❌ BLOCKED（bot 在 T+59min 死亡）
  **What to do**:
  - 服务启动 8 小时后执行第三次全量诊断
  - 与前两次检查点相同的 9 项命令
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 17
  - **Blocked By**: Task 15
  **References**:
  - 同 Task 14
  **Acceptance Criteria**:
  - [ ] 同 Task 14 的 9 项检查
  **QA Scenarios**:
  ```
  Scenario: T+8h 全量诊断
    Tool: Bash
    Steps: 同 Task 14 的 9 项命令
    Expected Result: 无回滚触发条件
    Evidence: .sisyphus/evidence/task-16-canary-8h.txt
  ```
  **Commit**: NO
- [x] 17. 金丝雀观察 — T+24h 最终检查点 ❌ BLOCKED（bot 在 T+59min 死亡）
  **What to do**:
  - 服务启动 24 小时后执行最终全量诊断
  - 逐一验证 5 项金丝雀退出条件（使用 W4 runbook §6 的精确命令）
  - 记录每项条件的 PASS/FAIL 状态
  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 18
  - **Blocked By**: Task 16
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:285-404` — §6 成功诊断（5 项条件的精确命令）
  - `docs/slack/T10-canary-ops-rollback.md:6-19` — 金丝雀退出检查清单
  **Acceptance Criteria**:
  - [ ] C1 Token 有效性: ≥ 1 条 `Slack bot connected`，0 条 `auth.test failed`，0 条 `token_revoked`
  - [ ] C2 Socket 重连恢复: 日志验证或测试替代
  - [ ] C3 限流恢复: 日志验证或测试替代
  - [ ] C4 消息幂等性: `grep -c 'Slack message sent' logs/nanoclaw.log` ≥ 50
  - [ ] C5 稳定运行时: 进程运行 ≥ 24h，`nanoclaw.error.log` 为空
  **QA Scenarios**:
  ```
  Scenario: 5 项金丝雀退出条件最终验证
    Tool: Bash
    Steps:
      1. C1: `grep 'Slack bot connected via Socket Mode' logs/nanoclaw.log | wc -l` ≥ 1
      2. C1: `grep -E 'Slack auth.test failed|token_revoked|app_uninstalled' logs/nanoclaw.log | wc -l` = 0
      3. C2: `grep -E 'socket_stale|socket_reconnect' logs/nanoclaw.log` — 记录状态
      4. C2: 如无自然触发 → `npx vitest run src/channels/slack.test.ts` 看门狗测试通过
      5. C3: `grep slack_rate_limited logs/nanoclaw.log` — 记录状态
      6. C3: `grep slack_send_failed logs/nanoclaw.log | wc -l` = 0
      7. C4: `grep -c 'Slack message sent' logs/nanoclaw.log` ≥ 50
      8. C5: `cat logs/nanoclaw.error.log 2>/dev/null | wc -l` = 0
      9. C5: `systemctl --user status nanoclaw | grep Active` — 运行时间 ≥ 24h
    Expected Result: 5/5 条件全部 PASS
    Failure Indicators: 任一条件 FAIL → 触发回滚
    Evidence: .sisyphus/evidence/task-17-canary-24h.txt
  ```
  **Commit**: NO
- [x] 18. 金丝雀退出判定 — VERDICT: ROLLBACK ❌
  **What to do**:
  - 读取 Task 14-17 的证据文件
  - 汇总 5 项金丝雀退出条件的 PASS/FAIL 状态
  - 如果全部 PASS → 输出 `VERDICT: PROMOTE`
  - 如果任一 FAIL → 输出 `VERDICT: ROLLBACK` 并执行回滚流程
  **回滚流程**（仅在 FAIL 时执行）:
  ```bash
  ./feature_docs/clean.sh switch undeployed pre-canary-r2
  npm install
  npx vitest run  # 期望: 345 tests
  npm run build
  systemctl --user restart nanoclaw
  ```
  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 19
  - **Blocked By**: Task 17
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:393-404` — 金丝雀退出检查清单
  - `docs/slack/W4-canary-testing-runbook.md:408-447` — §7 回滚流程
  - `docs/slack/T10-canary-ops-rollback.md:21-56` — 回滚触发条件与命令序列
  **Acceptance Criteria**:
  - [ ] 5 项条件汇总表已生成
  - [ ] VERDICT 明确为 PROMOTE 或 ROLLBACK
  - [ ] 如果 ROLLBACK: 回滚后 `./feature_docs/clean.sh status` → `Mode: undeployed`
  **QA Scenarios**:
  ```
  Scenario: 金丝雀退出判定
    Tool: Bash
    Steps:
      1. 读取 .sisyphus/evidence/task-17-canary-24h.txt
      2. 汇总: C1 [PASS/FAIL] | C2 [PASS/FAIL] | C3 [PASS/FAIL] | C4 [PASS/FAIL] | C5 [PASS/FAIL]
      3. 如果全部 PASS → VERDICT: PROMOTE
      4. 如果任一 FAIL → VERDICT: ROLLBACK → 执行回滚流程
    Expected Result: 明确的 PROMOTE 或 ROLLBACK 判定
    Evidence: .sisyphus/evidence/task-18-verdict.txt
  ```
  **Commit**: NO
- [x] 19. 回滚执行（VERDICT: ROLLBACK） ✅
  **What to do**（仅在 VERDICT: PROMOTE 时执行）:
  - 运行 `./feature_docs/clean.sh backup canary-passed-r2` 创建成功快照
  - 更新 `.sisyphus/plans/slack-tracking-matrix.md` 中的金丝雀状态
  - 执行推广提交: `git add -A && git commit -m "feat(slack): canary round 2 passed, promote to production"`
  **Must NOT do**:
  - 不在 VERDICT: ROLLBACK 时执行本任务
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: None
  - **Blocked By**: Task 18
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md:450-478` — §8 金丝雀退出与推广
  **Acceptance Criteria**:
  - [ ] `./feature_docs/clean.sh snapshots` → 包含 `canary-passed-r2`
  - [ ] `git log --oneline -1` → 包含 `feat(slack): canary round 2 passed`
  **QA Scenarios**:
  ```
  Scenario: 推广提交成功
    Tool: Bash
    Preconditions: Task 18 VERDICT = PROMOTE
    Steps:
      1. 运行 `./feature_docs/clean.sh backup canary-passed-r2`
      2. 运行 `git add -A && git commit -m "feat(slack): canary round 2 passed, promote to production"`
      3. 运行 `git log --oneline -1` — 确认提交消息
    Expected Result: 快照已创建，提交成功
    Evidence: .sisyphus/evidence/task-19-promote.txt
  ```
  **Commit**: YES
  - Message: `feat(slack): canary round 2 passed, promote to production`
  - Files: 所有当前变更
  - Pre-commit: `npm run build`

- [ ] F1. **金丝雀退出条件汇总审计** — `deep`
      读取 Task 14-17 的证据文件，逐一核对 5 项退出条件。任一条件未满足 → 触发回滚流程（参见 `docs/slack/T10-canary-ops-rollback.md`）。
      输出: `C1 [PASS/FAIL] | C2 [PASS/FAIL] | C3 [PASS/FAIL] | C4 [PASS/FAIL] | C5 [PASS/FAIL] | VERDICT: PROMOTE/ROLLBACK`

---

## Commit Strategy

- **Phase 5 推广提交**: `feat(slack): canary round 2 passed, promote to production` — 仅在金丝雀全部通过后执行
- **回滚提交**: 不需要 — 使用 `clean.sh switch undeployed` 快照恢复

---

## Success Criteria

### 验证命令

```bash
./feature_docs/clean.sh status          # Expected: Mode: deployed
npx vitest run                          # Expected: 384 passed, 0 failures
npm run build                           # Expected: exit code 0
grep 'Slack bot connected' logs/nanoclaw.log  # Expected: 至少一行
grep -c 'Slack message sent' logs/nanoclaw.log  # Expected: ≥ 50
cat logs/nanoclaw.error.log             # Expected: 空或不存在
```

### 最终清单

- [ ] 所有 "Must Have" 已完成
- [ ] 所有 "Must NOT Have" 未违反
- [ ] 5 项金丝雀退出条件全部 PASS
- [ ] 证据文件完整存在于 `.sisyphus/evidence/`
- [ ] 测试报告已记录
