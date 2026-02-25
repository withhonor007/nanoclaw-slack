# 双态恢复运维手册

操作员参考指南，涵盖在提交 `5a3f05e` 和 `de993c9` 中引入的耗尽-丢弃/恢复模型。

---

## 1. 状态机

每个群组队列有两种状态。每个群组初始状态为 NORMAL。

```
NORMAL --[重试耗尽 (>5)]--> EXHAUSTED_DROP --[恢复 / 新消息]--> NORMAL
```

### NORMAL

有界重试，指数退避。

| 参数 | 值 |
| --------------- | --------------------------------------- |
| MAX_RETRIES | 5 |
| BASE_RETRY_MS | 5 000 ms |
| 退避公式 | `5000 * 2^(retryCount-1)` |
| 重试计划 | 5s, 10s, 20s, 40s, 80s（总计 ~2.5 分钟） |

每次失败时，`scheduleRetry` 递增 `retryCount`。当 `retryCount <= 5` 时，群组保持在 NORMAL 状态，并安排延迟的 `enqueueMessageCheck`。

### EXHAUSTED_DROP

当 `retryCount > MAX_RETRIES`（即第 6 次失败）时触发。

进入时发生的事：

1. 记录 `event: exhaustion_drop`（warn 级别）
2. 重置 `retryCount = 0`
3. 清除 `pendingMessages = false`（丢弃冻结窗口）
4. 调用 `onExhaustionDropFn(groupJid)`（编排器回调）
   - 编排器将游标提交到最新用户消息时间戳（`cursor_commit_on_exhaustion`）
   - 立即将状态持久化到磁盘

群组现在处于空闲状态。不会安排重试。当新消息到达时，它将正常处理。

### 恢复转换（EXHAUSTED_DROP -> NORMAL）

两条路径触发恢复：

**路径 A：Slack socket 重新连接**
`slack.ts` 中的看门狗在成功的 `app.stop()` / `app.start()` 循环后调用 `opts.onRecovery()`。编排器迭代所有带有 `slack:` JID 的已注册群组，并为每个群组调用 `queue.enqueueMessageCheck(jid)`。这会记录 `event: slack_recovery_resume`。

**路径 B：新入站消息**
群组的任何新消息直接调用 `enqueueMessageCheck`。群组从提交的游标位置处理它。

---

## 2. 事件分类

所有事件都作为结构化日志字段发出（`event: '<name>'`）。使用 `grep '"event"' logs/nanoclaw.log` 或 `journalctl --user -u nanoclaw | grep '"event"'` 来过滤。

| 事件 | 来源 | 严重级别 | 何时发出 | 关键字段 |
| -------------------------------- | ----------------------- | -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `exhaustion_drop` | `src/group-queue.ts` | warn | retryCount 超过 MAX_RETRIES (>5) | `groupJid`, `retryCount` |
| `exhaustion_drop_callback_error` | `src/group-queue.ts` | error | `onExhaustionDropFn` 抛出异常 | `groupJid`, `err` |
| `cursor_commit_on_exhaustion` | `src/index.ts` | warn | 编排器在丢弃后提交游标 | `group`, `groupJid`, `commitTimestamp`, `gateMs` |
| `send_failed_non_delivery` | `src/index.ts` | error | `channel.sendMessage` 在代理输出期间抛出异常 | `group`, `chatJid`, `sendErr` |
| `slack_recovery_resume` | `src/index.ts` | info | Slack 重新连接触发所有 slack: 群组的重新入队 | (无) |
| `socket_connected` | `src/channels/slack.ts` | info | Socket Mode 接收器发出 `connected` | `liveness_source: 'socket_event'` |
| `socket_disconnected` | `src/channels/slack.ts` | warn | Socket Mode 接收器发出 `disconnected` | `liveness_source: 'socket_event'` |
| `socket_stale` | `src/channels/slack.ts` | warn | 超过 STALE_THRESHOLD (12 分钟) 未收到事件 | `last_event_ts`, `reconnect_attempt`, `stale_duration_ms`, `backoff_delay_ms`, `breaker_state` |
| `socket_reconnect` | `src/channels/slack.ts` | info | 看门狗重新连接成功 | `reconnect_attempt`, `duration_ms`, `breaker_state` |
| `socket_reconnect_failed` | `src/channels/slack.ts` | error | 看门狗重新连接尝试失败 | `reconnect_attempt`, `duration_ms`, `error` |
| `reconnect_skipped` | `src/channels/slack.ts` | debug | 看门狗 tick 被跳过 | `reason: 'in_flight'` 或 `'breaker_open'` |
| `breaker_open` | `src/channels/slack.ts` | error | 断路器在最大重新连接尝试后打开；进程退出 | `attempt`, `stale_duration_ms`, `breaker_state: 'open'` |
| `slack_send_failed` | `src/channels/slack.ts` | error | 所有 WebClient 重试耗尽 | `jid`, `status_code`, `length`, `err` |
| `slack_rate_limited` | `src/channels/slack.ts` | warn | 收到 HTTP 429 | `retry_after_s`, `url` |
| `token_revoked` | `src/channels/slack.ts` | warn | Slack 发送 `tokens_revoked` 事件 | (无) |
| `app_uninstalled` | `src/channels/slack.ts` | warn | Slack 发送 `app_uninstalled` 事件 | (无) |
| `recovery_callback_error` | `src/channels/slack.ts` | error | `opts.onRecovery()` 抛出异常 | `err` |

---

## 3. 金丝雀检查清单

在任何涉及恢复路径的部署前后运行这些检查。

### 检查 C1-C3：静态验证（必须全部通过）

```bash
# C1：TypeScript 检查
npm run typecheck
# 通过：exit 0，无错误

# C2：测试套件
npm test
# 通过：413+ 个测试，0 个失败

# C3：构建
npm run build
# 通过：exit 0，dist/ 已填充
```

### 检查 C4-C6：运行时信号阈值

| 检查 | 信号 | 通过阈值 | 失败阈值 | 日志查询 |
| ---- | -------------------------- | ----------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| C4 | `exhaustion_drop` | 正常流量下为 0 | 任何 1 小时窗口内 >5 | `grep exhaustion_drop logs/nanoclaw.log` |
| C5 | `slack_recovery_resume` | 仅在确认中断后出现 | 出现但没有前置 `socket_stale` | `grep slack_recovery_resume logs/nanoclaw.log` |
| C6 | `send_failed_non_delivery` | 正常流量下为 0 | 任何 1 小时窗口内 >10 | `grep send_failed_non_delivery logs/nanoclaw.log` |

### 通过/失败总结

C1、C2、C3 必须全部 exit 0。C4-C6 必须在预期范围内。任何单个检查失败都是禁止部署。

---

## 4. 回滚程序

### 何时触发

如果发生以下任何情况，立即触发回滚：

- 部署后 C1、C2 或 C3 失败
- 正常流量下任何 1 小时窗口内 `exhaustion_drop` 计数 > 5
- 任何 1 小时窗口内 `send_failed_non_delivery` 计数 > 10
- `socket_stale` 出现但 5 分钟内没有 `socket_reconnect` 跟随
- `breaker_open` 出现（进程将退出；监督程序重启它，但需要调查根本原因）
- `recovery_callback_error` 出现（恢复路径已损坏）

### 回滚序列

要回滚的两个提交是：

| 提交 | 哈希 | 描述 |
| --------------------- | --------- | ----------------------------------------------------------------------------- |
| 提交 2（已部署） | `de993c9` | test(recovery): validate deployed outage exhaustion and recovery flow |
| 提交 1（技能端） | `5a3f05e` | fix(recovery): implement dual-state exhaustion drop and slack recovery bridge |

按相反顺序回滚（最新的优先）：

```bash
# 步骤 1：回滚集成测试提交
git revert de993c9 --no-edit

# 步骤 2：回滚运行时 + 技能实现提交
git revert 5a3f05e --no-edit

# 步骤 3：验证
npm run typecheck && npm test && npm run build

# 步骤 4：重启服务
# Linux
systemctl --user restart nanoclaw
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### 回滚后验证

```bash
# 确认新日志中没有 exhaustion_drop 事件
grep exhaustion_drop logs/nanoclaw.log | tail -5

# 确认没有 cursor_commit_on_exhaustion
grep cursor_commit_on_exhaustion logs/nanoclaw.log | tail -5

# 确认服务正在运行
# Linux
systemctl --user status nanoclaw
# macOS
launchctl list | grep nanoclaw
```

预期：重启时间戳之后没有新的 `exhaustion_drop` 或 `cursor_commit_on_exhaustion` 条目。

---

## 5. Go/No-Go 检查清单

在生产部署前填写。所有行必须显示 PASS。

| # | 标准 | 阈值 | 实际 | 结果 |
| --- | ------------------------------------------------------ | ---------------------- | ------ | ------ |
| C1 | `npm run typecheck` | exit 0 | | |
| C2 | `npm test` | 413+ 通过，0 失败 | | |
| C3 | `npm run build` | exit 0 | | |
| C4 | `exhaustion_drop` 计数（1 小时窗口） | 正常流量下为 0 | | |
| C5 | `slack_recovery_resume` 无前置中断 | 0 个虚假出现 | | |
| C6 | `send_failed_non_delivery` 计数（1 小时窗口） | 正常流量下为 0 | | |
| C7 | `socket_reconnect` 在 5 分钟内跟随 `socket_stale` | 100% 的陈旧事件 | | |
| C8 | 日志中没有 `breaker_open` | 0 个出现 | | |
| C9 | 日志中没有 `recovery_callback_error` | 0 个出现 | | |

**Go** = 所有行 PASS。**No-go** = 任何行 FAIL，触发回滚。

---

## 6. 快速诊断命令

```bash
# 实时跟踪日志
journalctl --user -u nanoclaw -f          # Linux
tail -f logs/nanoclaw.log                  # macOS

# 检查耗尽事件
grep exhaustion_drop logs/nanoclaw.log

# 检查恢复事件
grep slack_recovery_resume logs/nanoclaw.log

# 检查 socket 健康状态
grep -E 'socket_stale|socket_reconnect|breaker_open' logs/nanoclaw.log

# 检查传递失败
grep send_failed_non_delivery logs/nanoclaw.log

# 统计最后一小时的发送失败次数（Linux）
journalctl --user -u nanoclaw --since '1 hour ago' | grep -c send_failed_non_delivery

# 检查耗尽时的游标提交
grep cursor_commit_on_exhaustion logs/nanoclaw.log
```
