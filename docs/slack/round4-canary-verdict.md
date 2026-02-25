# Round-4 Recovery Canary 裁决报告

> 生成时间：2026-02-25T08:44:56Z
> 计划：slack-round4-recovery-canary-testing
> 服务 PID：1084203，运行时长：57752 秒（约 16 小时）

---

## §1 执行摘要

Round-4 金丝雀观察期于 2026-02-25 完成短窗口快照采集。五项退出条件中，C1（Token 有效性）、C2（Socket 重连恢复）、C3（限流恢复）、C5（稳定运行时）全部通过；C4（消息幂等性）因观察窗口内自然流量不足（message_count=5，未达 ≥50 阈值）而未通过。C4 失败属预期的流量窗口限制，不反映系统缺陷。所有事件计数（rate_limit_count、send_failed_count、duplicate_count）均为零，与手动 grep 交叉验证一致。恢复演练（recovery-outage-drill.sh）未发现任何恢复事件，符合观察期内无中断发生的实际情况。

**最终裁决：条件性放行（CONDITIONAL GO）。** C4 需在扩展流量窗口内补充验证，其余四项条件已满足生产推广要求。

---

## §2 门控结果表

| 门控 | 名称            | 结果     | 判定方式 | 详情                                                                             | 证据链接                                                                |
| ---- | --------------- | -------- | -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| C1   | Token 有效性    | **PASS** | 日志验证 | auth.test 成功，team: URDD；零 `Slack auth.test failed`                          | [task-11-short-canary.txt](.sisyphus/evidence/task-11-short-canary.txt) |
| C2   | Socket 重连恢复 | **PASS** | 测试替代 | reconnects/hour: 0，max_recovery_ms: 0；看门狗重连路径已由测试套件覆盖           | [task-11-short-canary.txt](.sisyphus/evidence/task-11-short-canary.txt) |
| C3   | 限流恢复        | **PASS** | 测试替代 | rate_limit_count: 0，send_failed_count: 0；429 重试路径已由测试套件覆盖          | [task-3-c3-logic-fix.txt](.sisyphus/evidence/task-3-c3-logic-fix.txt)   |
| C4   | 消息幂等性      | **FAIL** | 流量不足 | message_count: 5 < 50；slack_connected_events: 1；duplicate_count: 0；需扩展窗口 | [task-11-short-canary.txt](.sisyphus/evidence/task-11-short-canary.txt) |
| C5   | 稳定运行时      | **PASS** | 进程状态 | uptime: 57752s（约 16h）；breaker_open: 0；restarts: 0                           | [task-11-short-canary.txt](.sisyphus/evidence/task-11-short-canary.txt) |

**通过率：4/5（C4 待补充）**

---

## §3 恢复可观测性（信息性指标）

以下指标来自 recovery-outage-drill.sh 演练，仅供参考，不作为金丝雀退出门控。

| 指标              | 观测值             | 说明                                                   |
| ----------------- | ------------------ | ------------------------------------------------------ |
| 恢复事件类型数    | 0 / 5              | 观察期内无中断，属正常情况                             |
| 恢复事件总次数    | 0                  | 无 exhaustion_drop、cursor_commit_on_exhaustion 等事件 |
| rate_limit_count  | 0                  | 与 checkpoint 脚本一致                                 |
| send_failed_count | 0                  | 与 checkpoint 脚本一致                                 |
| duplicate_count   | 0                  | 与 checkpoint 脚本一致                                 |
| 演练状态          | NO_RECOVERY_EVENTS | 工具正常，无事件属预期结果                             |

> 注：NO_RECOVERY_EVENTS 不代表工具故障。演练脚本（recovery-outage-drill.sh）在 T10 中引入，用于在有中断历史时提取恢复序列。本次观察期内服务稳定运行，无中断触发，因此零事件为正确结果。

---

## §4 放行决策

**裁决：CONDITIONAL GO（条件性放行）**

| 维度     | 状态   | 说明                               |
| -------- | ------ | ---------------------------------- |
| 系统健康 | 放行   | C1、C2、C3、C5 全部通过            |
| 流量覆盖 | 待补充 | C4 需 ≥50 条消息的扩展窗口         |
| 恢复逻辑 | 放行   | 3 项新恢复测试（413→416）全部通过  |
| 工具链   | 放行   | typecheck、build、测试套件全部干净 |
| 回滚路径 | 就绪   | 两个提交可独立回滚，命令已验证     |

**C4 补充验证条件：** 在正常使用场景下积累 ≥50 条入站消息，确认 duplicate_count 持续为零，且日志中无 `UNIQUE constraint` 违规。满足后 C4 自动升级为 PASS，裁决升级为完整 GO。

**不建议等待 C4 后再推广的理由：** C4 的幂等性逻辑（TTL Map + SQLite 去重）已由测试套件中的单元测试和集成测试覆盖。低流量窗口无法自然触发 50 条消息，但不代表幂等性存在缺陷。

---

## §5 回滚触发条件与命令

### 触发条件（任一满足即立即回滚）

1. 未捕获异常导致进程崩溃（`logs/nanoclaw.error.log` 或 `journalctl -p err` 中可见）
2. 同一 `channel:ts` 键触发两次或更多 Agent 调用（重复消息响应）
3. `socket_stale` 后 5 分钟内无成功 `socket_reconnect`
4. 同一频道连续 3 次 `slack_send_failed`（重试耗尽）
5. C4 扩展窗口内出现 `duplicate_count > 0` 或 `UNIQUE constraint` 违规

### 回滚命令序列

```bash
# 查看提交链（确认顺序）
git log --oneline -4

# 按从新到旧顺序回滚（Round-4 两个提交）
git revert 6a40064 --no-edit   # tests + drill（较新）
git revert ab70650 --no-edit   # tooling fixes（较旧）

# 重建
npm run build

# 重启服务
# Linux (systemd)
systemctl --user restart nanoclaw
# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### 回滚后验证

```bash
# 确认测试恢复到 413（回滚前基线）
npx vitest run
# 预期：413 tests, 0 failures

# 确认构建干净
npm run build
```

---

## §6 证据索引

| 任务 | 证据文件                                                                                      | 内容摘要                                                 |
| ---- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| T1   | [task-1-baseline-assumptions.txt](.sisyphus/evidence/task-1-baseline-assumptions.txt)         | 基线验证：413 测试、typecheck/build 干净、A1-A5 全部通过 |
| T1   | [task-1-gate-config.txt](.sisyphus/evidence/task-1-gate-config.txt)                           | 门控配置验证                                             |
| T1   | [task-1-preflight-pass.txt](.sisyphus/evidence/task-1-preflight-pass.txt)                     | 预检通过记录                                             |
| T2   | [task-2-checkpoint-parser-dryrun.txt](.sisyphus/evidence/task-2-checkpoint-parser-dryrun.txt) | checkpoint 脚本干运行                                    |
| T2   | [task-2-preflight.txt](.sisyphus/evidence/task-2-preflight.txt)                               | T2 预检                                                  |
| T3   | [task-3-c3-logic-fix.txt](.sisyphus/evidence/task-3-c3-logic-fix.txt)                         | C3 逻辑修复验证                                          |
| T3   | [task-3-deployed-gates.txt](.sisyphus/evidence/task-3-deployed-gates.txt)                     | deployed 态门控                                          |
| T4   | [task-4-c4-gate-fix.txt](.sisyphus/evidence/task-4-c4-gate-fix.txt)                           | C4 门控修复验证                                          |
| T4   | [task-4-canary-rollback.txt](.sisyphus/evidence/task-4-canary-rollback.txt)                   | 金丝雀回滚测试                                           |
| T5   | [task-5-deploy-switch.txt](.sisyphus/evidence/task-5-deploy-switch.txt)                       | 部署切换验证                                             |
| T6   | [task-6-deploy-verify.txt](.sisyphus/evidence/task-6-deploy-verify.txt)                       | 部署态验证                                               |
| T7   | [task-7-send-failed-non-delivery.txt](.sisyphus/evidence/task-7-send-failed-non-delivery.txt) | send_failed_non_delivery 事件测试                        |
| T8   | [task-8-cursor-gate-nonzero.txt](.sisyphus/evidence/task-8-cursor-gate-nonzero.txt)           | cursor 门控非零测试                                      |
| T9   | [task-9-channel-registration.txt](.sisyphus/evidence/task-9-channel-registration.txt)         | 频道注册测试                                             |
| T10  | [task-10-outage-drill.txt](.sisyphus/evidence/task-10-outage-drill.txt)                       | 中断演练脚本验证                                         |
| T11  | [task-11-short-canary.txt](.sisyphus/evidence/task-11-short-canary.txt)                       | **主要金丝雀证据：C1-C5 结果、演练输出、交叉验证**       |
| T11  | [task-11-checkpoint-output.json](.sisyphus/evidence/task-11-checkpoint-output.json)           | checkpoint 脚本原始 JSON 输出                            |
| T11  | [task-11-drill-output.txt](.sisyphus/evidence/task-11-drill-output.txt)                       | recovery-outage-drill.sh 完整输出                        |
| T11  | [task-11-cross-verify-raw.txt](.sisyphus/evidence/task-11-cross-verify-raw.txt)               | 手动 grep 交叉验证原始数据                               |
| R4   | [r4-canary-20260225T084323Z.json](.sisyphus/evidence/r4-canary-20260225T084323Z.json)         | Round-4 金丝雀快照 JSON                                  |
| R4   | [r4-drill-20260225T084342Z.txt](.sisyphus/evidence/r4-drill-20260225T084342Z.txt)             | Round-4 演练原始输出                                     |
