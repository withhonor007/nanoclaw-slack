# Slack Round 4 恢复金丝雀测试计划

## 摘要

> **快速总结**：通过扩展 W4 金丝雀工作流以包含双态恢复检查、修复金丝雀工具缺陷，以及在晋升前关闭关键恢复测试覆盖缺口，执行以恢复为重点的 Round-4 金丝雀。
>
> **可交付成果**：
> - 更正的金丝雀工具（`scripts/slack/canary-checkpoint.sh`、`scripts/slack/soak-monitor.sh`）
> - 针对索引级行为的恢复重点测试覆盖补充
> - Round-4 金丝雀证据包和 go/no-go 判决
> - W4 附录，记录 Round-4 增量和更新的阈值
>
> **预计工作量**：中等
> **并行执行**：是 - 2 个波次
> **关键路径**：2 -> 6 -> 11 -> 12

---

## 背景

### 原始请求
基于 `docs/slack/W4-canary-testing-runbook.md` 和完整审查，正式化下一步测试计划。

### 访谈总结
**关键讨论**：
- 当前仓库已处于已部署验证状态，恢复变更已落地。
- W4 保持为基线流程，但 Round-4 必须添加恢复特定验证。
- 计划范围应专注于测试/金丝雀执行和工具正确性，而非新功能扩展。

**研究发现**：
- 当前基线：31 个测试文件，413 个通过的测试。
- 现有金丝雀基础设施存在（`canary-checkpoint.sh`、`soak-monitor.sh`），但存在已知的正确性风险。
- 恢复事件现已在运行时日志中可用：`exhaustion_drop`、`cursor_commit_on_exhaustion`、`send_failed_non_delivery`、`slack_recovery_resume`、`recovery_callback_error`。
- 恢复集成测试存在，但索引级分支仍未充分测试。

### Metis 审查
**已识别的缺口（在本计划中解决）**：
- 金丝雀脚本 PID/日志解析可能与实际 pino-pretty 输出不匹配。
- C3（速率限制）逻辑可能将健康行为反转为虚假 FAIL。
- C4 未充分强制执行 W4 消息计数/幂等性门。
- `soak-monitor.sh` PID 陈旧性和依赖稳健性（`bc`）需要更正。
- `r3-` 证据命名和脚本路径假设必须为 Round-4 规范化。

---

## 工作目标

### 核心目标
通过确保工具正确性、关闭恢复测试盲点，以及生成可审计的晋升/回滚证据，为双态 API 恢复交付可信的 Round-4 金丝雀流程。

### 具体可交付成果
- 更新的金丝雀脚本，具有验证的门逻辑和 Round-4 证据命名。
- 为索引级非交付、游标门和仅 Slack 恢复重新入队接线添加的恢复重点测试。
- 执行干运行 + 短金丝雀证据包。
- Round-4 判决包和 W4 附录。

### 完成定义
- [ ] 更新的金丝雀脚本生成非平凡的、可审计的门输出。
- [ ] 添加的恢复特定测试在已部署模式下通过。
- [ ] 使用更正的脚本生成的 Round-4 短金丝雀证据。
- [ ] 完成的 go/no-go 决策表，带有明确的回滚触发器。

### 必须有
- 在任何 Round-4 判决使用前修复金丝雀工具正确性缺陷。
- 最终证据中的恢复行为可观测性。
- 明确的数值通过/失败阈值。

### 必须没有（护栏）
- 不重写无关的架构或通道功能。
- 除了最小可测试性导向的更改外，不进行广泛的 `src/index.ts` 重构。
- 不直接手动绕过双态工作流（必要时使用 `clean.sh` + apply-skill 路径）。
- 不因破损的 grep/解析器逻辑而出现平凡的金丝雀 PASS。

---

## 验证策略（强制）

> **零人工干预** — 所有验证由代理执行。

### 测试决策
- **基础设施存在**：是
- **自动化测试**：是（实现后测试）
- **框架**：vitest + tsc
- **模式**：已部署验证，用于运行时行为检查

### QA 政策
每个任务都包括可执行的 QA 场景，证据路径在 `.sisyphus/evidence/` 下。

- **脚本/工具任务**：Bash 执行 + 确定性输出断言
- **运行时测试任务**：`npx vitest run <target>` + 断言计数
- **金丝雀任务**：检查点 JSON 输出 + 日志查询输出 + 判决表

---

## 执行策略

### 并行执行波次

```text
波次 1（工具正确性 + 基线，6 个任务）：
- T1 基线假设验证包
- T2 修复 canary-checkpoint 日志解析/PID 匹配
- T3 修复 canary-checkpoint C3 速率限制恢复逻辑
- T4 修复 canary-checkpoint C4 消息计数/幂等性门
- T5 修复 soak-monitor PID 刷新 + bc 备选
- T6 规范化 Round-4 命名 + 脚本路径引用

波次 2（恢复覆盖 + 执行，6 个任务）：
- T7 为 send_failed_non_delivery 回滚路径添加测试
- T8 为 cursor_commit_on_exhaustion 门分支添加测试
- T9 为真实仅 Slack onRecovery 接线添加测试
- T10 实现合成中断演习运行器 + 证据格式
- T11 使用更正的脚本执行短 Round-4 金丝雀（2h）
- T12 生成 Round-4 判决包 + W4 附录 + go/no-go 表
```

### 依赖矩阵（完整）
- **T1**：无阻塞；阻塞 T11、T12
- **T2**：无阻塞；阻塞 T11
- **T3**：无阻塞；阻塞 T11
- **T4**：无阻塞；阻塞 T11
- **T5**：无阻塞；阻塞 T11
- **T6**：被 T2 阻塞；阻塞 T11、T12
- **T7**：被 T1 阻塞；阻塞 T11
- **T8**：被 T1 阻塞；阻塞 T11
- **T9**：被 T1 阻塞；阻塞 T11
- **T10**：被 T2、T3、T4 阻塞；阻塞 T11
- **T11**：被 T1、T2、T3、T4、T5、T6、T7、T8、T9、T10 阻塞；阻塞 T12
- **T12**：被 T1、T6、T11 阻塞；阻塞最终验证

### 代理分派总结
- **波次 1**：6 个代理 — T1 快速、T2 未指定-高、T3 快速、T4 深度、T5 快速、T6 写作
- **波次 2**：6 个代理 — T7 深度、T8 深度、T9 深度、T10 未指定-高、T11 深度、T12 写作
- **最终**：4 个代理 — 预言机 + 质量 + qa + 范围

---

## 待办事项

- [ ] 1. 基线假设验证包

  **要做什么**：
  - 在 Round-4 工作前验证当前模式、快照可用性和测试/构建基线。
  - 验证 Metis 的假设 A1-A5：模式、测试计数、日志格式、env 门值、事件键一致性。
  - 在单个证据文件中记录基线结果。

  **必须不做**：
  - 不要在验证基线假设前开始金丝雀执行。
  - 不要依赖旧运维手册中的陈旧预期测试计数值。

  **推荐代理配置**：
  - **类别**：`quick`
    - 原因：命令驱动的基线验证，实现复杂度低。
  - **技能**：[`debug`]
    - `debug`：日志、运行时状态和环境验证工作流。
  - **评估但省略的技能**：
    - `add-slack`：此任务不需要功能编码。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与 T2-T6）
  - **阻塞**：T7、T8、T9、T11、T12
  - **被阻塞**：无

  **参考**：
  - `docs/slack/W4-canary-testing-runbook.md` - 基线预检期望和金丝雀流。
  - `feature_docs/clean.sh` - 权威的模式/快照工作流（`status`、`snapshots`、`switch`）。
  - `src/config.ts` - `RECOVERY_EXHAUSTED_GATE_MS` 默认/解析行为以验证 env 假设。
  - `.sisyphus/evidence/r3-task-9-canary-verdict.txt` - 先前金丝雀判决基线。

  **验收标准**：
  - [ ] 基线证据捕获模式、快照、typecheck/test/build 输出。
  - [ ] 记录实际当前测试计数（无陈旧硬编码期望）。
  - [ ] 假设验证表（A1-A5）以 PASS/FAIL 记录。

  **QA 场景（强制）**：

  ```text
  场景：基线门包生成
    工具：Bash
    前置条件：仓库可用，脚本可执行
    步骤：
      1. 运行 `./feature_docs/clean.sh status` 并捕获模式输出。
      2. 运行 `./feature_docs/clean.sh snapshots` 并验证至少存在一个未部署/已部署快照。
      3. 运行 `npm run typecheck && npm test && npm run build`。
    预期结果：所有命令成功，基线文件包括状态 + 测试计数 + 门输出。
    失败指示器：缺少快照、命令失败、模式锁不匹配。
    证据：.sisyphus/evidence/task-1-baseline-assumptions.txt

  场景：配置门值验证
    工具：Bash
    前置条件：配置文件存在
    步骤：
      1. 查询 `src/config.ts` 中 `RECOVERY_EXHAUSTED_GATE_MS` 的存在。
      2. 验证当 env 缺失/无效时默认备选为 `0`。
    预期结果：默认/备选逻辑明确，在证据中记录。
    证据：.sisyphus/evidence/task-1-gate-config.txt
  ```

  **提交**：否

- [ ] 2. 修复 `canary-checkpoint.sh` 日志解析和 PID 关联

  **要做什么**：
  - 替换脆弱的 PID grep 假设，使指标与实际 pino-pretty 输出匹配。
  - 确保事件计数逻辑适用于真实生产日志行格式。
  - 为解析器行为添加脚本级回归检查。

  **必须不做**：
  - 不要保留在 pino-pretty 下总是返回零的 `pid_log_count` 逻辑。
  - 不要在此任务中更改门语义（仅解析/关联正确性）。

  **推荐代理配置**：
  - **类别**：`unspecified-high`
    - 原因：脚本内部 + 生产约束下的日志格式推理。
  - **技能**：[`debug`]
    - `debug`：结构化日志解释和解析诊断。
  - **评估但省略的技能**：
    - `writing`：这是实现/脚本正确性，不是文档优先。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与 T1、T3-T6）
  - **阻塞**：T6、T10、T11
  - **被阻塞**：无

  **参考**：
  - `scripts/slack/canary-checkpoint.sh` - 要修复的解析器/计数器实现。
  - `src/logger.ts` - 解析器必须匹配的实际输出格式行为。
  - `.sisyphus/evidence/r3-canary-*.json` - 检查点工件的预期 JSON 输出形状。

  **验收标准**：
  - [ ] 解析器/计数器在真实日志上返回非平凡计数。
  - [ ] `--dry-run` 输出包括有意义的指标（不总是零）。
  - [ ] 无回归到现有金丝雀证据工作流消费的 JSON 模式。

  **QA 场景（强制）**：

  ```text
  场景：检查点解析器干运行健全性
    工具：Bash
    前置条件：脚本已更新
    步骤：
      1. 运行 `bash scripts/slack/canary-checkpoint.sh --dry-run`。
      2. 验证 JSON 输出存在且包括 C1-C5 详情，带有非空指标字段。
    预期结果：脚本确定性退出，有效 JSON 和真实解析器输出。
    失败指示器：空指标、格式错误的 JSON、硬编码零计数。
    证据：.sisyphus/evidence/task-2-checkpoint-parser-dryrun.txt

  场景：真实日志格式兼容性
    工具：Bash
    前置条件：至少存在一个带 `event` 的真实日志行
    步骤：
      1. 对当前日志运行脚本。
      2. 将计数的事件与至少一个事件键的手动 grep 计数进行比较。
    预期结果：自动计数和手动计数精确匹配。
    证据：.sisyphus/evidence/task-2-parser-compatibility.txt
  ```

  **提交**：是（与 T3-T6 分组）
  - 消息：`chore(canary): fix checkpoint parsing, gate logic, and soak monitor robustness`

- [ ] 3. 更正 `canary-checkpoint.sh` 中的 C3 速率限制门逻辑

  **要做什么**：
  - 更新 C3 以评估恢复结果（速率限制然后成功继续），而非仅存在失败。
  - 确保 C3 仅在与 W4 语义一致的未恢复速率限制模式上失败。
  - 为通过和失败样本添加确定性固定装置或 shell 检查。

  **必须不做**：
  - 不要将所有 `slack_rate_limited` 出现标记为 FAIL。
  - 不要引入没有证据友好输出字段的不透明逻辑。

  **推荐代理配置**：
  - **类别**：`quick`
    - 原因：对一个门条件和断言的受限更改。
  - **技能**：[`debug`]
    - `debug`：失败模式分类和负路径验证。
  - **评估但省略的技能**：
    - `deep`：任务保持狭窄和脚本本地。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与 T1、T2、T4-T6）
  - **阻塞**：T10、T11
  - **被阻塞**：无

  **参考**：
  - `docs/slack/W4-canary-testing-runbook.md` - C3 预期语义（`429` 恢复有效）。
  - `docs/slack/T10-canary-ops-rollback.md` - 回滚触发链接到重复发送失败。
  - `scripts/slack/canary-checkpoint.sh` - C3 实现行和输出字段。

  **验收标准**：
  - [ ] C3 对恢复的速率限制序列通过。
  - [ ] C3 对重复未恢复的发送失败序列失败。
  - [ ] 证据包括明确的为什么通过/为什么失败详情。

  **QA 场景（强制）**：

  ```text
  场景：C3 恢复的速率限制路径
    工具：Bash
    前置条件：样本日志或带 `slack_rate_limited` 然后成功的合成序列
    步骤：
      1. 对恢复序列样本运行检查点脚本。
      2. 验证 C3 判决是 PASS。
    预期结果：C3 将恢复路径标记为健康。
    失败指示器：C3 在健康 429 恢复上错误地失败。
    证据：.sisyphus/evidence/task-3-c3-recovered-pass.txt

  场景：C3 未恢复的速率限制路径
    工具：Bash
    前置条件：带重复 `slack_send_failed` 的样本序列
    步骤：
      1. 对失败序列样本运行检查点脚本。
      2. 验证 C3 判决是 FAIL。
    预期结果：C3 标记未恢复的速率限制为失败。
    证据：.sisyphus/evidence/task-3-c3-unrecovered-fail.txt
  ```

  **提交**：是（与 T2、T4-T6 分组）

- [ ] 4. 加强 C4 消息计数和幂等性门

  **要做什么**：
  - 实现与 W4 标准对齐的明确 `>=50` 处理消息检查。
  - 添加重复检测信号检查（无重复 `channel:ts` 处理证据）。
  - 在检查点 JSON 中发出机器可读的 C4 详情。

  **必须不做**：
  - 不要将 C4 仅保留为进程活跃/socket 活跃代理。
  - 不要在消息量低于阈值时静默通过 C4。

  **推荐代理配置**：
  - **类别**：`deep`
    - 原因：结合指标推导 + 幂等性语义 + 证据输出。
  - **技能**：[`debug`]
    - `debug`：日志查询和信号正确性验证。
  - **评估但省略的技能**：
    - `writing`：主要工作是脚本逻辑，不是文档。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与 T1-T3、T5-T6）
  - **阻塞**：T10、T11
  - **被阻塞**：无

  **参考**：
  - `docs/slack/W4-canary-testing-runbook.md` - C4 退出规则（`>=50` 入站消息，无重复）。
  - `scripts/slack/canary-checkpoint.sh` - C4 门逻辑和 JSON 输出。
  - `src/channels/slack.ts` - 入站去重模型（`channel:ts`）以与实现对齐诊断。

  **验收标准**：
  - [ ] C4 包括数值处理消息计数和阈值评估。
  - [ ] C4 包括重复信号检查结果。
  - [ ] C4 在量低于阈值或出现重复证据时失败。

  **QA 场景（强制）**：

  ```text
  场景：C4 低于阈值失败
    工具：Bash
    前置条件：样本/日志窗口，<50 个处理消息
    步骤：
      1. 在低于阈值数据上运行检查点脚本。
      2. 验证 C4 判决是 FAIL，详情字段中有明确计数。
    预期结果：阈值违反明确且确定性。
    失败指示器：C4 在不满足 >=50 要求时通过。
    证据：.sisyphus/evidence/task-4-c4-below-threshold.txt

  场景：C4 阈值通过，清洁幂等性
    工具：Bash
    前置条件：日志/样本窗口，>=50 条消息，无重复键信号
    步骤：
      1. 运行检查点脚本。
      2. 验证 C4 通过且计数 >=50 已记录。
    预期结果：C4 仅在满足量和幂等性条件时通过。
    证据：.sisyphus/evidence/task-4-c4-threshold-pass.txt
  ```

  **提交**：是（与 T2、T3、T5、T6 分组）

- [ ] 5. 修复 `soak-monitor.sh` PID 刷新和依赖稳健性

  **要做什么**：
  - 每个检查点重新发现服务 PID，以在浸泡窗口期间幸存重启。
  - 为没有 `bc` 的环境添加弹性备选。
  - 保留现有输出格式，同时添加 PID 变更跟踪行。

  **必须不做**：
  - 不要在整个浸泡期间保留静态 PID 捕获。
  - 如果整数安全备选可能，不要在 `bc` 缺失时硬失败。

  **推荐代理配置**：
  - **类别**：`quick`
    - 原因：有界的 shell 脚本更正。
  - **技能**：[`debug`]
    - `debug`：重启路径和脚本可移植性故障排查。
  - **评估但省略的技能**：
    - `deep`：此专注补丁不需要。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与 T1-T4、T6）
  - **阻塞**：T11
  - **被阻塞**：无

  **参考**：
  - `scripts/slack/soak-monitor.sh` - PID 捕获和指标计算逻辑。
  - `.sisyphus/evidence/r3-task-7-soak.txt` - 先前假阴性模式和预期输出形状。
  - `docs/slack/W4-canary-testing-runbook.md` - 浸泡/观测意图和运行时稳定性要求。

  **验收标准**：
  - [ ] 浸泡监视器检测 PID 变更并继续监视新 PID。
  - [ ] 脚本无 `bc` 相关失败地运行。
  - [ ] 输出清楚地分离每个间隔指标和最终判决。

  **QA 场景（强制）**：

  ```text
  场景：PID 翻转处理
    工具：Bash
    前置条件：浸泡运行期间模拟服务重启
    步骤：
      1. 以短间隔/窗口启动浸泡监视器。
      2. 在运行中重启服务。
      3. 验证脚本记录 PID 变更并继续计数事件。
    预期结果：重启后无陈旧 PID 盲点。
    失败指示器：重启后指标冻结或为空。
    证据：.sisyphus/evidence/task-5-soak-pid-rollover.txt

  场景：无 bc 备选路径
    工具：Bash
    前置条件：`bc` 不可用或故意屏蔽
    步骤：
      1. 在备选环境中执行浸泡监视器。
      2. 验证脚本完成并打印确定性数值字段。
    预期结果：脚本无 `bc` 硬依赖仍可运行。
    证据：.sisyphus/evidence/task-5-soak-bc-fallback.txt
  ```

  **提交**：是（与 T2-T4、T6 分组）

- [ ] 6. 规范化 Round-4 命名和脚本路径引用

  **要做什么**：
  - 将 `r3-` 证据前缀替换为 Round-4 命名约定。
  - 更正脚本路径引用到 `scripts/slack/canary-checkpoint.sh`（必要时）。
  - 将生成的证据位置与当前计划和运维手册对齐。

  **必须不做**：
  - 不要留下混合轮前缀，混淆证据血统。
  - 不要保留陈旧脚本路径别名，造成文件不存在失败。

  **推荐代理配置**：
  - **类别**：`writing`
    - 原因：脚本和运维引用间的命名/协议一致性。
  - **技能**：[`debug`]
    - `debug`：验证路径正确性和调用一致性。
  - **评估但省略的技能**：
    - `add-slack`：此任务不需要功能集成。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与 T1-T5）
  - **阻塞**：T11、T12
  - **被阻塞**：T2

  **参考**：
  - `scripts/slack/canary-checkpoint.sh` - 证据文件名前缀和输出路径。
  - `scripts/slack/soak-monitor.sh` - 证据文件名前缀和引用。
  - `.sisyphus/evidence/r3-task-9-canary-log.txt` - 观测到的路径失败模式。

  **验收标准**：
  - [ ] Round-4 证据文件名一致且可追踪。
  - [ ] 所有脚本引用解析为现有文件路径。
  - [ ] 活跃金丝雀脚本中无剩余 `r3-` 硬编码值。

  **QA 场景（强制）**：

  ```text
  场景：命名和路径一致性扫描
    工具：Bash
    前置条件：脚本已更新
    步骤：
      1. 搜索脚本中的 `r3-` 和陈旧金丝雀路径字符串。
      2. 执行两个脚本一次，检查生成的证据文件名。
    预期结果：仅出现 Round-4 命名；所有路径解析。
    失败指示器：陈旧前缀/路径保留或执行在缺失文件上失败。
    证据：.sisyphus/evidence/task-6-naming-path-consistency.txt

  场景：端到端脚本调用健全性
    工具：Bash
    前置条件：金丝雀脚本可执行
    步骤：
      1. 以短窗口运行检查点脚本和浸泡脚本。
      2. 验证两者都将证据写入预期目录。
    预期结果：脚本输出以一致的命名约定生成。
    证据：.sisyphus/evidence/task-6-script-sanity.txt
  ```

  **提交**：是（与 T2-T5 分组）

- [ ] 7. 为 `send_failed_non_delivery` 回滚行为添加恢复测试

  **要做什么**：
  - 为 Slack 发送抛出异常且编排器将其视为非交付的路径添加有针对性的运行时测试覆盖。
  - 验证游标处理遵循回滚语义（无虚假交付状态）。
  - 将断言存储在专注恢复测试文件中（扩展现有恢复测试套件）。

  **必须不做**：
  - 不要在断言中将失败发送标记为已交付。
  - 不要添加广泛编排器重构仅为使测试通过。

  **推荐代理配置**：
  - **类别**：`deep`
    - 原因：此路径跨越通道发送行为 + 编排器错误语义。
  - **技能**：[`debug`]
    - `debug`：失败路径测试设计和确定性断言。
  - **评估但省略的技能**：
    - `writing`：任务是运行时测试实现。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 2（与 T8-T10）
  - **阻塞**：T11
  - **被阻塞**：T1

  **参考**：
  - `src/index.ts` - `send_failed_non_delivery` 分支和游标决策。
  - `src/channels/slack.ts` - 发送失败重新抛出行为。
  - `src/recovery.integration.test.ts` - 已建立的集成风格恢复测试模式。

  **验收标准**：
  - [ ] 新测试明确覆盖抛出发送路径并断言非交付语义。
  - [ ] 测试在旧/不正确行为上失败，在预期行为上通过。
  - [ ] 完整套件在测试添加后保持绿色。

  **QA 场景（强制）**：

  ```text
  场景：失败的 Slack 发送视为非交付
    工具：Bash
    前置条件：恢复测试已实现
    步骤：
      1. 运行 `npx vitest run src/recovery.integration.test.ts -t "send_failed_non_delivery"`（或等效的有针对性测试）。
      2. 验证断言确认无虚假交付状态和回滚兼容结果。
    预期结果：有针对性测试通过，带有明确的非交付断言。
    失败指示器：输出标记为已交付，尽管发送失败。
    证据：.sisyphus/evidence/task-7-send-failed-non-delivery.txt

  场景：回归安全性
    工具：Bash
    前置条件：有针对性测试已添加
    步骤：
      1. 运行完整 `npm test`。
      2. 确认无无关回归。
    预期结果：完整套件通过，包括新测试。
    证据：.sisyphus/evidence/task-7-full-suite.txt
  ```

  **提交**：是（与 T8-T10 分组）
  - 消息：`test(recovery): add index-path recovery coverage and outage drill`

- [ ] 8. 为 `cursor_commit_on_exhaustion` 门分支添加恢复测试

  **要做什么**：
  - 为 `RECOVERY_EXHAUSTED_GATE_MS > 0` 分支添加测试覆盖。
  - 验证游标提交正确使用门控下限，且在门为 `0` 时不回归。
  - 包括快乐路径和边界值路径。

  **必须不做**：
  - 不要仅测试默认 `0` 门路径。
  - 不要仅从日志推断分支行为。

  **推荐代理配置**：
  - **类别**：`deep`
    - 原因：需要分支特定状态/时间推理和确定性测试。
  - **技能**：[`debug`]
    - `debug`：边界值测试和时间断言设计。
  - **评估但省略的技能**：
    - `quick`：此处分支覆盖逻辑繁重，不平凡。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 2（与 T7、T9、T10）
  - **阻塞**：T11
  - **被阻塞**：T1

  **参考**：
  - `src/index.ts` - `cursor_commit_on_exhaustion` 分支和门计算。
  - `src/config.ts` - `RECOVERY_EXHAUSTED_GATE_MS` 解析/默认行为。
  - `src/recovery.integration.test.ts` - 现有耗尽/恢复工具。

  **验收标准**：
  - [ ] 测试明确覆盖非零门分支。
  - [ ] 测试验证提交时间戳遵守门下限逻辑。
  - [ ] 现有零门行为保持验证。

  **QA 场景（强制）**：

  ```text
  场景：非零门分支行为
    工具：Bash
    前置条件：测试用例已添加，非零门配置
    步骤：
      1. 为 `cursor_commit_on_exhaustion` 非零门路径运行有针对性测试。
      2. 验证计算提交时间戳/下限行为的断言。
    预期结果：分支执行，断言对门控行为通过。
    失败指示器：分支未测试或时间戳逻辑不匹配。
    证据：.sisyphus/evidence/task-8-cursor-gate-nonzero.txt

  场景：零门兼容性
    工具：Bash
    前置条件：现有默认路径测试保留
    步骤：
      1. 运行有针对性的默认门测试。
      2. 验证非零分支添加无回归。
    预期结果：默认路径仍以预期语义通过。
    证据：.sisyphus/evidence/task-8-cursor-gate-zero.txt
  ```

  **提交**：是（与 T7、T9-T10 分组）

- [ ] 9. 为真实仅 Slack `onRecovery` 接线添加恢复测试

  **要做什么**：
  - 添加测试以执行实际接线路径（不仅内联模拟）。
  - 验证 `onRecovery` 仅重新入队 `slack:` 组，跳过非 Slack JID。
  - 验证此行为在重复恢复信号间保持幂等。

  **必须不做**：
  - 不要仅依赖简化的仅模拟伪回调测试。
  - 不要在恢复断言期间入队 WhatsApp/非 Slack 组。

  **推荐代理配置**：
  - **类别**：`deep`
    - 原因：测试通道回调和编排器队列行为间的集成接缝。
  - **技能**：[`debug`]
    - `debug`：回调接线验证和幂等性检查。
  - **评估但省略的技能**：
    - `unspecified-high`：此保持专注集成测试。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 2（与 T7、T8、T10）
  - **阻塞**：T11
  - **被阻塞**：T1

  **参考**：
  - `src/index.ts` - `onRecovery` 回调接线和 Slack 前缀过滤。
  - `src/channels/slack.ts` - 成功重新连接后的回调调用点。
  - `src/recovery.integration.test.ts` - 当前模拟测试以升级为真实接线覆盖。

  **验收标准**：
  - [ ] 测试验证仅 `slack:` 组在恢复时入队。
  - [ ] 测试验证重复恢复信号安全/幂等。
  - [ ] 测试绑定到运行时使用的真实接线路径。

  **QA 场景（强制）**：

  ```text
  场景：仅 Slack 恢复重新入队
    工具：Bash
    前置条件：集成风格接线测试已添加
    步骤：
      1. 运行有针对性的 `onRecovery` 接线测试。
      2. 验证仅 Slack JID 发生入队。
    预期结果：无非 Slack 组重新入队副作用。
    失败指示器：观测到任何非 Slack 入队。
    证据：.sisyphus/evidence/task-9-onrecovery-slack-only.txt

  场景：重复恢复幂等性
    工具：Bash
    前置条件：重复回调调用测试用例
    步骤：
      1. 在测试中多次触发恢复回调。
      2. 验证行为保持有界且确定性。
    预期结果：安全重复处理，无虚假副作用。
    证据：.sisyphus/evidence/task-9-onrecovery-idempotent.txt
  ```

  **提交**：是（与 T7、T8、T10 分组）

- [ ] 10. 实现合成中断演习运行器和证据模板

  **要做什么**：
  - 在 `scripts/slack/recovery-outage-drill.sh` 创建可重复的金丝雀演习运行器，执行中断 -> 重试耗尽 -> 恢复观测。
  - 标准化演习输出的证据捕获格式（时间戳、命令、判决字段）在 `.sisyphus/evidence/task-10-*.txt`。
  - 确保演习输出清楚地映射到 W4 条件和恢复信息指标。

  **必须不做**：
  - 不要使演习步骤非确定性或仅手动。
  - 不要在没有标签的情况下混合生产金丝雀日志和演习日志。

  **推荐代理配置**：
  - **类别**：`unspecified-high`
    - 原因：结合脚本编写、执行协议和可审计输出结构。
  - **技能**：[`debug`]
    - `debug`：失败模拟序列和证据验证。
  - **评估但省略的技能**：
    - `artistry`：此运维工作流不需要非常规方法。

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 2（与 T7-T9）
  - **阻塞**：T11
  - **被阻塞**：T2、T3、T4

  **参考**：
  - `docs/slack/W4-canary-testing-runbook.md` - 观测和成功诊断流。
  - `scripts/slack/canary-checkpoint.sh` - 检查点输出合约。
  - `docs/slack/dual-state-recovery-runbook.md` - 恢复事件分类和预期信号。

  **验收标准**：
  - [ ] 演习程序端到端可执行，带有确定性证据输出。
  - [ ] 演习证据清楚地分离门判决和信息恢复指标。
  - [ ] 演习可在不编辑程序文本的情况下重放。

  **QA 场景（强制）**：

  ```text
  场景：合成中断演习执行
    工具：Bash
    前置条件：T2-T4 中的脚本已更新
    步骤：
      1. 在受控环境中执行演习运行器一次。
      2. 收集检查点输出和演习记录。
      3. 验证证据模式字段存在且已填充。
    预期结果：演习生成确定性、可解析工件。
    失败指示器：缺少字段、模糊时间戳、不可重现输出。
    证据：.sisyphus/evidence/task-10-outage-drill.txt

  场景：演习重放一致性
    工具：Bash
    前置条件：第一次演习运行完成
    步骤：
      1. 以相同输入重新运行演习。
      2. 比较关键判决字段和事件计数部分。
    预期结果：判决语义在运行间保持一致。
    证据：.sisyphus/evidence/task-10-outage-drill-replay.txt
  ```

  **提交**：是（与 T7-T9 分组）

- [ ] 11. 使用更正的工具执行短 Round-4 金丝雀（2h）

  **要做什么**：
  - 使用更正的检查点 + 浸泡脚本运行短金丝雀窗口。
  - 捕获 C1-C5 门输出和 C6+ 恢复信息指标。
  - 记录明确的通过/失败结果和触发状态。

  **必须不做**：
  - 不要从陈旧/破损脚本报告判决。
  - 不要跳过任何门的证据捕获。

  **推荐代理配置**：
  - **类别**：`deep`
    - 原因：在现实运行时条件下编排多信号运维验证。
  - **技能**：[`debug`]
    - `debug`：金丝雀解释、异常分类和证据完整性。
  - **评估但省略的技能**：
    - `quick`：金丝雀执行和解释不是平凡命令链。

  **并行化**：
  - **可并行运行**：否
  - **并行组**：波次 2（T1-T10 后顺序）
  - **阻塞**：T12
  - **被阻塞**：T1、T2、T3、T4、T5、T6、T7、T8、T9、T10

  **参考**：
  - `docs/slack/W4-canary-testing-runbook.md` - 金丝雀观测和退出条件框架。
  - `scripts/slack/canary-checkpoint.sh` - 检查点门执行。
  - `scripts/slack/soak-monitor.sh` - 窗口期间稳定性趋势监视。
  - `.sisyphus/evidence/task-3-deployed-gates.txt` - 已部署基线比较点。

  **验收标准**：
  - [ ] 2 小时金丝雀运行以完整证据包完成。
  - [ ] C1-C5 判决明确，带有支持命令/日志输出。
  - [ ] 恢复信息指标（C6+）已记录且可解释。

  **QA 场景（强制）**：

  ```text
  场景：2h 金丝雀门执行
    工具：Bash
    前置条件：更正的脚本和测试就位
    步骤：
      1. 在 2h 窗口期间以配置间隔运行检查点脚本。
      2. 在相同窗口上运行浸泡监视器。
      3. 将输出聚合到金丝雀证据目录。
    预期结果：短金丝雀周期的完整门/证据跟踪。
    失败指示器：缺少间隔输出、解析器错误、不可验证判决状态。
    证据：.sisyphus/evidence/task-11-short-canary.txt

  场景：门到日志一致性审计
    工具：Bash
    前置条件：短金丝雀证据已生成
    步骤：
      1. 对照手动 grep 计数交叉检查报告的门值。
      2. 验证判决和原始日志间无矛盾。
    预期结果：门输出和原始日志一致。
    证据：.sisyphus/evidence/task-11-gate-log-consistency.txt
  ```

  **提交**：否

- [ ] 12. 发布 Round-4 判决包、W4 附录和 Go/No-Go 表

  **要做什么**：
  - 在 `docs/slack/round4-canary-verdict.md` 生成最终 Round-4 金丝雀判决文档，带有通过/失败理由。
  - 在 `docs/slack/W4-round4-addendum.md` 发布 W4 附录，捕获 Round-4 增量：更新的测试计数、更正的脚本行为、恢复信息指标。
  - 最终化 go/no-go 矩阵，带有明确的回滚触发器和命令序列。

  **必须不做**：
  - 不要从头重写 W4；发布增量/附录。
  - 不要留下模糊阈值或触发措辞。

  **推荐代理配置**：
  - **类别**：`writing`
    - 原因：合成、运维清晰性和审计级文档输出。
  - **技能**：[`debug`]
    - `debug`：确保文档与观测到的运行时行为和工具输出匹配。
  - **评估但省略的技能**：
    - `deep`：核心挑战是文档保真度和决策清晰性。

  **并行化**：
  - **可并行运行**：否
  - **并行组**：波次 2（最终合成）
  - **阻塞**：最终验证
  - **被阻塞**：T1、T6、T11

  **参考**：
  - `docs/slack/W4-canary-testing-runbook.md` - 基线程序。
  - `docs/slack/T10-canary-ops-rollback.md` - 回滚协议基线。
  - `docs/slack/dual-state-recovery-runbook.md` - 恢复事件语义和阈值。
  - `.sisyphus/evidence/task-11-short-canary.txt` - 最终判决的金丝雀输出。

  **验收标准**：
  - [ ] `docs/slack/round4-canary-verdict.md` 包括门表 + 证据链接 + 最终判决。
  - [ ] `docs/slack/W4-round4-addendum.md` 捕获所有 Round-4 增量，无重复完整 W4 内容。
  - [ ] Go/no-go + 回滚矩阵命令完整且无歧义。

  **QA 场景（强制）**：

  ```text
  场景：文档到证据对齐
    工具：Bash
    前置条件：判决/附录已草拟
    步骤：
      1. 验证文档中的每个陈述阈值都有匹配的证据来源。
      2. 验证每个判决声明都有引用的工件路径。
    预期结果：最终文档中无无支持声明。
    失败指示器：孤立声明、缺少证据引用。
    证据：.sisyphus/evidence/task-12-doc-evidence-alignment.txt

  场景：回滚决策演习
    工具：Bash
    前置条件：go/no-go 表和回滚块已草拟
    步骤：
      1. 对回滚命令序列运行语法检查。
      2. 验证命令与最新提交哈希和模式工作流对齐。
    预期结果：回滚块可执行且当前。
    证据：.sisyphus/evidence/task-12-rollback-drill.txt
  ```

  **提交**：是
  - 消息：`docs(slack): publish round4 canary addendum and verdict checklist`

---

## 最终验证波次（强制）

- [ ] F1. **计划合规审计** — `oracle`
  验证所有必须有/必须没有对照实际输出、脚本、测试和证据。
  输出：`Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. **代码质量审查** — `unspecified-high`
  运行 `npm run typecheck`、`npm test`、`npm run build`；扫描更改文件中的反模式和脚本回归。
  输出：`Build [PASS/FAIL] | Tests [N/N] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **QA 重放审计** — `unspecified-high`
  重新运行所有任务 QA 场景，验证证据文件存在且与预期输出匹配。
  输出：`Scenarios [N/N pass] | Evidence [N/N found] | VERDICT`

- [ ] F4. **范围保真度检查** — `deep`
  确保仅计划文件/关注点已更改；检测范围蔓延或缺少计划工作。
  输出：`Tasks [N/N compliant] | Scope [CLEAN/N issues] | VERDICT`

---

## 提交策略

- **1**：`chore(canary): fix checkpoint parsing, gate logic, and soak monitor robustness`
- **2**：`test(recovery): add index-path recovery coverage and outage drill`
- **3**：`docs(slack): publish round4 canary addendum and verdict checklist`

---

## 成功标准

### 验证命令
```bash
npm run typecheck
npm test
npm run build
bash scripts/slack/canary-checkpoint.sh --dry-run
bash scripts/slack/soak-monitor.sh 15 120
```

### 最终检查清单
- [ ] 工具缺陷已修复且验证（无平凡 PASS）
- [ ] 恢复关键分支有可执行测试覆盖
- [ ] Round-4 金丝雀证据完整且可审计
- [ ] Go/no-go 决策和回滚触发矩阵已最终化
