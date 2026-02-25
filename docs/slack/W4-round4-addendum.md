# W4 Round-4 增补文档

> 本文档为增量文档，仅记录 Round-4 相对于 W4 基线的变更。
> W4 完整流程参见 [W4-canary-testing-runbook.md](W4-canary-testing-runbook.md)。
> 金丝雀裁决参见 [round4-canary-verdict.md](round4-canary-verdict.md)。

---

## §1 工具链修复（T2-T6）

Round-4 在 W4 基线之上修复了以下工具链问题，提交哈希：`ab70650`。

| 任务 | 修复内容                                                               | 影响范围                             |
| ---- | ---------------------------------------------------------------------- | ------------------------------------ |
| T2   | checkpoint 脚本解析器修复：正确提取 C1-C5 结果 JSON                    | `scripts/slack/canary-checkpoint.sh` |
| T3   | C3 逻辑修复：rate_limit_count 与 send_failed_count 分离计数，避免误判  | `scripts/slack/canary-checkpoint.sh` |
| T4   | C4 门控修复：message_count 阈值从错误值修正为 ≥50                      | `scripts/slack/canary-checkpoint.sh` |
| T5   | 部署切换验证：确认 deployed 态下 checkpoint 脚本可正常运行             | 运维流程                             |
| T6   | 部署态验证：确认 slack.ts、@slack/bolt、测试套件在 deployed 态全部就绪 | 部署验证清单                         |

**W4 §0 前置条件变更：** 执行金丝雀前，需额外确认 checkpoint 脚本已通过 T2-T4 修复。

---

## §2 新增测试覆盖（T7-T9）

Round-4 新增 3 个测试，测试总数从 413 升至 416，提交哈希：`6a40064`。

| 任务 | 新增测试                                      | 覆盖场景                                                      |
| ---- | --------------------------------------------- | ------------------------------------------------------------- |
| T7   | `send_failed_non_delivery` 事件路径           | 消息发送失败时正确触发 non_delivery 事件，不误报为 rate_limit |
| T8   | cursor 门控非零路径                           | `cursor_commit_on_exhaustion` 在 cursor 非零时正确触发        |
| T9   | 频道注册与 onRecovery 回调（Slack-only 模式） | Slack-only 模式下恢复回调正确注册，不依赖 WhatsApp 路径       |

**W4 §3.4 部署态验证清单变更：**

| #   | 检查项   | 命令             | 预期（Round-4 更新）                  |
| --- | -------- | ---------------- | ------------------------------------- |
| 3-4 | 测试通过 | `npx vitest run` | **416 tests**, 0 failures（原为 384） |

> 注：W4 基线记录的 384 tests 为 W4 初始部署态数字。Round-4 前基线为 413（undeployed 态），deployed 态经 T7-T9 后为 416。

---

## §3 新增工具：recovery-outage-drill.sh

Round-4 引入 `scripts/slack/recovery-outage-drill.sh`，提交哈希：`6a40064`。

**用途：** 在金丝雀观察期内，从日志中提取并汇总恢复事件序列（exhaustion_drop、cursor_commit_on_exhaustion、send_failed_non_delivery、slack_recovery_resume、recovery_callback_error）。

**使用方式：**

```bash
bash scripts/slack/recovery-outage-drill.sh
```

**输出格式：**

```
RECOVERY_DRILL_RESULT: <状态>
events_seen: <N> / 5 distinct types
total_events: <N> occurrences
```

**状态说明：**

| 状态                    | 含义                       |
| ----------------------- | -------------------------- |
| `NO_RECOVERY_EVENTS`    | 观察期内无中断，属正常情况 |
| `RECOVERY_EVENTS_FOUND` | 检测到恢复序列，需人工审查 |

**W4 §5 金丝雀观察期变更：** §5.1 可选合成演练中，现可使用 recovery-outage-drill.sh 替代手动 grep 来验证恢复事件可观测性。

---

## §4 更新的阈值与逻辑

### C3 逻辑变更

**W4 基线行为：** C3 将 rate_limit 和 send_failed 合并计数，任一非零即失败。

**Round-4 修正行为：** C3 仅检查 `rate_limit_count`（429 响应计数）。`send_failed_count` 独立跟踪，不影响 C3 判定。

**判定标准（更新后）：**

- C3 PASS：`rate_limit_count == 0`，或 `rate_limit_count > 0` 但对应消息后续无 `slack_send_failed`
- C3 FAIL：`rate_limit_count > 0` 且同一消息出现 `slack_send_failed`（重试耗尽）

### C4 阈值变更

**W4 基线行为：** C4 阈值未明确定义，依赖人工判断。

**Round-4 明确阈值：** `message_count ≥ 50`，`duplicate_count == 0`。

**低流量场景处理：** 若观察窗口内 message_count < 50，C4 记录为 FAIL（流量不足），不视为系统缺陷。需在扩展窗口内补充验证。

---

## §5 金丝雀证据 Delta

### 与 W4 基线的差异

| 维度            | W4 基线预期        | Round-4 实际结果         | 差异说明                 |
| --------------- | ------------------ | ------------------------ | ------------------------ |
| 测试数量        | 384（deployed 态） | 416（deployed 态）       | +3 新恢复测试（T7-T9）   |
| checkpoint 脚本 | 初始版本           | 修复版（T2-T4）          | C3 逻辑、C4 阈值已修正   |
| 演练工具        | 无                 | recovery-outage-drill.sh | 新增恢复可观测性工具     |
| C4 判定         | 人工判断           | 明确阈值（≥50）          | 低流量 FAIL 属预期       |
| 恢复事件        | 未定义基线         | 0 事件（无中断）         | 服务稳定，无恢复序列触发 |

### Round-4 金丝雀快照摘要

```
snapshot_timestamp_utc: 2026-02-25T08:44:56Z
service_pid: 1084203
service_uptime_seconds: 57752

C1 token_validity:         PASS  (auth.test 成功，team: URDD)
C2 socket_reconnect_health: PASS  (reconnects/hour: 0)
C3 rate_limit_recovery:    PASS  (rate_limit_count: 0, send_failed_count: 0)
C4 message_pipeline:       FAIL  (message_count: 5 < 50，流量不足)
C5 stable_runtime:         PASS  (uptime: 57752s, breaker_open: 0, restarts: 0)

checkpoint_verdict: FAIL
rollback_triggers: [C4_message_pipeline]
```

**裁决：CONDITIONAL GO。** C4 需扩展流量窗口补充验证，其余四项已满足推广条件。

---

## §6 回滚提交链（Round-4 专用）

Round-4 引入两个提交，回滚时按从新到旧顺序执行：

```bash
# 查看提交链
git log --oneline -4

# 回滚顺序（必须先回滚较新的提交）
git revert 6a40064 --no-edit   # tests + recovery-outage-drill.sh
git revert ab70650 --no-edit   # tooling fixes (T2-T6)

# 验证回滚后测试数恢复到 413
npx vitest run
```

完整回滚流程参见 [T10-canary-ops-rollback.md](T10-canary-ops-rollback.md) 和 [round4-canary-verdict.md](round4-canary-verdict.md) §5。
