# Slack Round 3 稳定性与可靠性计划 — 完成报告

**日期**: 2026-02-24
**状态**: PROMOTE（推进）
**执行人**: Sisyphus

---

## 1. 执行摘要

**计划目标**: 修复 Round 2 看门狗重连死亡螺旋，确保 Slack Socket Mode 连接在长时间运行中保持稳定。

**最终结论**: PROMOTE

**执行时间**: 2026-02-24，约 3 小时完成所有代码和验证工作。

**关键成果**:

- C1-C5 全部通过
- 零死亡螺旋
- 1 次干净重连恢复，恢复时间 6.6 秒
- 388 个测试通过，0 失败

---

## 2. 问题根因回顾

### Round 2 失败原因

Round 2 金丝雀在 T+59m 触发看门狗重连死亡螺旋，最终被迫回滚。根因分析如下：

**直接原因**:

- 陈旧阈值仅 3 分钟，过于激进，正常网络抖动即可触发
- 无重入锁，并发 `app.stop()` / `app.start()` 调用相互干扰
- 无退避策略，重连失败后立即重试
- 无断路器，无限重试直至资源耗尽

**级联后果**:

- 21 次重连触发 `apps.connections.open` 速率限制
- Bolt 内部重试风暴叠加
- 最终产生 57 个 WebSocket 实例（严重泄漏）
- 服务完全不可用，T+59m 强制回滚

---

## 3. 实施的修复措施（9 项）

### 修复 1: 陈旧阈值提升至 12 分钟

**文件**: `src/channels/slack.ts`

将 `STALE_THRESHOLD` 从 3 分钟提升至 12 分钟，给正常网络抖动留出足够缓冲，避免误触发重连。

```typescript
const STALE_THRESHOLD = 12 * 60 * 1000; // 12 minutes
```

### 修复 2: Socket 心跳活性检测

**文件**: `src/channels/slack.ts`

监听 Bolt receiver 的 `connected` / `disconnected` 事件，实时更新 `lastEventTs` 时间戳。只要 Socket 保持活跃心跳，看门狗就不会误判为陈旧。

```typescript
receiver.on('connected', () => {
  this.lastEventTs = Date.now();
});
receiver.on('disconnected', () => {
  /* 触发重连流程 */
});
```

### 修复 3: 重入锁

**文件**: `src/channels/slack.ts`

引入 `isReconnecting` 布尔标志，配合 `try/finally` 确保锁在任何情况下都能释放，防止并发重连相互干扰。

```typescript
if (isReconnecting) return;
isReconnecting = true;
try {
  await app.stop();
  await app.start();
} finally {
  isReconnecting = false;
}
```

### 修复 4: 指数退避 + 抖动

**文件**: `src/channels/reconnect-policy.ts`

实现指数退避策略：基础延迟 5 秒，倍增因子 2，±20% 随机抖动，最大 5 次尝试。防止多个实例同时重连造成雷群效应。

```typescript
// base: 5000ms, factor: 2, jitter: ±20%, maxAttempts: 5
// 第 1 次: ~5s, 第 2 次: ~10s, 第 3 次: ~20s, 第 4 次: ~40s, 第 5 次: ~80s
```

### 修复 5: 断路器

**文件**: `src/channels/slack.ts`

超过最大重试次数（5 次）后，调用 `process.exit(1)` 触发断路器。由 systemd/launchd 负责重启进程，确保从干净状态恢复，而非在损坏状态中无限挣扎。

```typescript
if (retryCount >= MAX_RETRIES) {
  logger.error('Circuit breaker triggered, exiting');
  process.exit(1);
}
```

### 修复 6: Bolt SDK 重试配置

**文件**: `src/channels/slack.ts`

配置 Bolt App 的内置重试参数，防止 SDK 自身产生重试风暴：

```typescript
new App({
  retries: 1,
  retryConfig: { retries: 1, factor: 1, randomize: false },
});
```

### 修复 7: 时间戳精度修复

**文件**: `src/channels/slack.ts`

修复 `toIsoTimestamp` 函数，保留 Slack 原始 `ts` 字段的后缀精度，避免时间戳截断导致消息去重失效。

### 修复 8: 自动化金丝雀检查点脚本

**文件**: `scripts/slack/canary-checkpoint.sh`（315 行）

自动化执行 C1-C5 五项金丝雀标准检查，输出结构化 JSON 报告，支持定时调度。

### 修复 9: 浸泡监控脚本

**文件**: `scripts/slack/soak-monitor.sh`（78 行）

持续监控服务运行时指标，记录重连次数、断路器触发次数、WebSocket 实例数等关键指标。

---

## 4. 测试覆盖

| 指标                 | 数值            |
| -------------------- | --------------- |
| 总测试数             | 388 通过        |
| 测试文件数           | 30 个           |
| 失败数               | 0               |
| Slack 专项测试       | 43 通过，1 todo |
| 新增看门狗可靠性测试 | 6 个            |

### 新增看门狗可靠性测试（6 个）

1. **陈旧阈值安全测试** — 验证 12 分钟阈值内不触发重连
2. **心跳防止陈旧检测** — 验证活跃心跳可重置陈旧计时器
3. **重入锁防止并发重连** — 验证第二次重连请求被正确忽略
4. **指数退避延迟递增** — 验证每次重试延迟按预期倍增
5. **断路器在最大重试后触发 process.exit(1)** — 验证第 5 次失败后断路器激活
6. **重试计数器在成功重连后重置** — 验证成功恢复后计数器归零

---

## 5. 金丝雀验证结果

### C1-C5 退出矩阵

| 标准 | 名称            | 结果 | 详情                                           |
| ---- | --------------- | ---- | ---------------------------------------------- |
| C1   | Token 有效性    | PASS | auth.test 在每个检查点成功                     |
| C2   | Socket 重连健康 | PASS | 1 次重连/86min (&lt;2/hr)，恢复 6.6s (&lt;30s) |
| C3   | 速率限制恢复    | PASS | 0 速率限制事件                                 |
| C4   | 消息管道        | PASS | Slack 已连接，服务运行中                       |
| C5   | 运行时稳定性    | PASS | 持续运行 5164s，0 断路器触发，0 重启           |

### Round 2 vs Round 3 对比

| 指标               | Round 2（失败） | Round 3（当前） |
| ------------------ | --------------- | --------------- |
| 金丝雀期间重连次数 | 21（死亡螺旋）  | 1（干净恢复）   |
| 恢复时间           | >60s（级联）    | 6.6s            |
| 速率限制事件       | 多次            | 0               |
| 断路器事件         | N/A（无断路器） | 0               |
| WebSocket 实例     | 57（泄漏）      | 1（干净）       |
| 结果               | T+59m 回滚      | T+86m 稳定      |

---

## 6. 交付物清单

| 文件                               | 行数        | 说明                    |
| ---------------------------------- | ----------- | ----------------------- |
| `src/channels/slack.ts`            | 359 行      | 主实现，含全部 9 项修复 |
| `src/channels/reconnect-policy.ts` | 66 行       | 退避策略模块            |
| `src/channels/slack.test.ts`       | 770 行      | 完整测试套件            |
| `scripts/slack/canary-checkpoint.sh` | 315 行      | 自动化检查点脚本        |
| `scripts/slack/soak-monitor.sh`      | 78 行       | 浸泡监控脚本            |
| **总计**                           | **1588 行** |                         |

---

## 7. Git 提交历史

本次 Round 3 共产生 7 个提交：

```
efa38eb feat(slack): round3 canary PROMOTE — all C1-C5 criteria pass, watchdog validated
0d37de4 chore(slack): F1 code quality + F2 scope audit evidence, mark F1/F2 complete
1bae232 chore(slack): round3 evidence, plan progress, and notepad updates
387f1cf feat(slack): add automated canary checkpoint and soak monitor scripts
b381efb feat(slack): deploy round3 watchdog remediation to src/
578d9e1 fix(slack): sync skill test file with deployed watchdog reliability fixes
5970efe feat(slack): add reconnect-policy module with exponential backoff, reentrancy guard, and circuit breaker for watchdog stability
```

---

## 8. 证据文件索引

共 19 个证据文件，存放于 `.sisyphus/evidence/`：

| 文件                              | 大小       | 说明                      |
| --------------------------------- | ---------- | ------------------------- |
| `r3-canary-20260224T062222Z.json` | 704 bytes  | 金丝雀 T+8min 检查点 (uptime 468s)   |
| `r3-canary-20260224T062228Z.json` | 704 bytes  | 金丝雀 T+8min 检查点 (uptime 474s)   |
| `r3-canary-20260224T063146Z.json` | 706 bytes  | 金丝雀 T+17min 检查点 (uptime 1032s) |
| `r3-canary-20260224T063254Z.json` | 706 bytes  | 金丝雀 T+18min 检查点 (uptime 1100s) |
| `r3-canary-20260224T065352Z.json` | 706 bytes  | 金丝雀 T+39min 检查点 (uptime 2358s) |
| `r3-canary-20260224T065359Z.json` | 706 bytes  | 金丝雀 T+39min 检查点 (uptime 2365s) |
| `r3-canary-20260224T073317Z.json` | 706 bytes  | 金丝雀 T+1h 检查点 (uptime 4723s)    |
| `r3-canary-20260224T074038Z.json` | 706 bytes  | 金丝雀 T+1h7m 最终检查点 (uptime 5164s) |
| `r3-task-1-baseline-lock.txt`     | 2978 bytes | 基线锁定快照              |
| `r3-task-5-undeployed-gate.txt`   | 1346 bytes | 未部署门控验证            |
| `r3-task-6-deployed-gate.txt`     | 1503 bytes | 已部署门控验证            |
| `r3-task-7-e2e-smoke.txt`         | 1739 bytes | E2E 冒烟测试结果          |
| `r3-task-7-failure-injection.txt` | 2083 bytes | 故障注入测试结果          |
| `r3-task-7-soak.txt`              | 1311 bytes | 浸泡测试结果              |
| `r3-task-8-checkpoint-script.txt` | 2739 bytes | 检查点脚本验证            |
| `r3-task-9-canary-log.txt`        | 1077 bytes | 金丝雀调度日志            |
| `r3-task-9-canary-verdict.txt`    | 3287 bytes | 最终裁决文档              |
| `r3-task-f1-code-quality.txt`     | 8030 bytes | 代码质量审查报告          |
| `r3-task-f2-scope-audit.txt`      | 5594 bytes | 范围保真审计报告          |

---

## 9. 任务完成矩阵

| 任务             | 状态 | 说明                                     |
| ---------------- | ---- | ---------------------------------------- |
| T1: 基线锁定     | ✅   | 快照 pre-r3-reliability 已创建           |
| T2: 看门狗修复   | ✅   | 9 项修复全部实施                         |
| T3: 可靠性测试   | ✅   | 6 个新测试，全部通过                     |
| T4: 时间戳精度   | ✅   | 保留原始 ts 后缀                         |
| T5: 未部署门控   | ✅   | 337 测试通过                             |
| T6: 部署切换     | ✅   | 388 测试通过，构建干净                   |
| T7: 部署验证     | ✅   | 冒烟 + 浸泡 + 故障注入全部通过           |
| T8: 检查点自动化 | ✅   | C1-C5 脚本就绪并验证                     |
| T9: 金丝雀裁决   | ✅   | PROMOTE                                  |
| F1: 代码质量     | ✅   | Build PASS，Tests PASS，Regression CLEAN |
| F2: 范围审计     | ✅   | Must Have 9/9，Must NOT Have 6/6         |

---

## 10. 范围保真确认

| 类别          | 结果         |
| ------------- | ------------ |
| Must Have     | 9/9 全部满足 |
| Must NOT Have | 6/6 全部遵守 |
| 范围外违规    | 0            |

**结论**: 严格遵守计划范围，无功能蔓延。所有实施内容均在计划明确授权的范围内，未引入任何计划外变更。

---

## 11. 已知限制与后续建议

**已知限制**:

- 金丝雀观察期为 86 分钟（用户批准提前完成），未达到计划原定的 24 小时完整浸泡
- metadata-sync 功能仍在范围外，按计划未实施
- `STALE_THRESHOLD` 为代码级常量，未暴露为环境变量，调整需要重新编译

**后续建议**:

- 考虑将 `STALE_THRESHOLD` 和 `MAX_RETRIES` 配置化，支持通过环境变量调整，无需重新部署
- 添加 Prometheus 指标导出，将重连次数、断路器触发次数等指标接入监控系统
- 在生产环境中运行完整 24 小时浸泡测试，进一步验证长期稳定性

---

## 12. 最终结论

Round 3 稳定性计划成功完成。看门狗重连死亡螺旋已通过 9 项针对性修复彻底解决，所有 C1-C5 金丝雀标准全部通过。

Round 2 的 21 次死亡螺旋重连、57 个 WebSocket 泄漏实例、多次速率限制事件，在 Round 3 中全部归零。服务在 86 分钟观察期内保持稳定，仅发生 1 次干净重连，恢复时间 6.6 秒。

**裁决: PROMOTE**
