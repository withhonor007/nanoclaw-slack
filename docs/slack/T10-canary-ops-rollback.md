# Slack 频道：金丝雀协议与回滚

本文档涵盖强化版 Slack 频道实现（T7+T8+T9）的条件性金丝雀退出标准、回滚触发条件、回滚命令序列以及监控命令。

## 条件性金丝雀检查清单

金丝雀期没有固定计时器，当以下全部五个条件均满足时才结束。在生产环境中逐一观察并勾选。

- [ ] **Socket 重连恢复。** 至少观察到一次完整的断开-重连-恢复周期。通过查找 `socket_stale` 日志条目，确认其后紧跟一条无 `err` 字段的 `socket_reconnect` 条目，以及后续事件处理正常继续。

- [ ] **限流恢复。** 至少一次 429 响应被端到端处理：日志中出现带有 `retry_after_s` 值的 `slack_rate_limited` 条目，随后该消息发送成功（该消息无 `slack_send_failed`）。

- [ ] **消息幂等性。** 处理 50 条或更多入站消息，零重复 Agent 调用。通过交叉核对 TTL Map 行为（无重复 `channel:ts` 键被处理）和 SQLite（日志中无唯一约束违规）来验证。

- [ ] **稳定运行时。** 连续运行 24 小时或更长时间，零未捕获异常。检查 `logs/nanoclaw.error.log` 中是否有未处理的 rejection 或进程崩溃。

- [ ] **Token 有效性。** 至少确认一次 `auth.test()` 成功路径。这在连接时自动发生；查找 `Slack bot connected via Socket Mode` 日志行，且其前无 `Slack auth.test failed` 警告。

全部五项勾选后，退出金丝雀并推广至生产环境。

## 回滚触发条件

以下任意单一条件即足以触发立即回滚，不要等待多个故障同时出现。

1. 未捕获异常导致进程崩溃（在 `logs/nanoclaw.error.log` 或 `journalctl` 中可见）。
2. 重复消息响应：同一条 Slack 消息触发两次或更多 Agent 调用（同一 `channel:ts` 键在单个进程生命周期内被处理两次）。
3. Socket 断开后看门狗在 5 分钟内未能重连。表现为重复出现 `socket_stale` 条目，且其间无成功的 `socket_reconnect`，持续超过 5 分钟。
4. 限流重试耗尽：同一频道连续出现 3 次 `slack_send_failed` 事件，表明 WebClient 在所有重试后放弃。

## 回滚命令序列

```bash
# 1. Identify the commit group to revert
#    Group A: feat(slack) - initial implementation
#    Group B: fix(slack) - inbound/outbound hardening (T7+T8)
#    Group C: fix(slack) - lifecycle/watchdog hardening (T9)
#    Group D: docs(slack) - documentation
git log --oneline -10

# 2. Revert the specific commit (or range)
#    To revert a single commit:
git revert <commit-hash>
#    To revert a range (e.g., all Slack commits), revert in reverse order:
git revert <newest-hash>
git revert <older-hash>
# ...continue until all Slack commits are reverted

# 3. Rebuild
npm run build

# 4. Restart the service
#    Linux (systemd user unit):
systemctl --user restart nanoclaw
#    macOS (launchd):
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

如需在重启前验证回滚：

```bash
# Confirm slack.ts is gone or reverted
ls src/channels/slack.ts 2>/dev/null && echo "still present" || echo "removed"
# Confirm build is clean
npm run build 2>&1 | tail -5
```

## 监控命令

在金丝雀期间使用这些命令跟踪上述条件。

```bash
# Check for rate limit events (condition 2)
journalctl --user -u nanoclaw | grep slack_rate_limited
# Check for socket stale/reconnect events (condition 1, trigger 3)
journalctl --user -u nanoclaw | grep -E 'socket_stale|socket_reconnect'
# Check for send failures after retry exhaustion (trigger 4)
journalctl --user -u nanoclaw | grep slack_send_failed
# Check for token revocation or app uninstall (condition 5, general health)
journalctl --user -u nanoclaw | grep -E 'token_revoked|app_uninstalled'
# Check for uncaught exceptions (trigger 1)
journalctl --user -u nanoclaw -p err
# Count inbound messages processed (condition 3 progress)
journalctl --user -u nanoclaw | grep -c 'Slack message sent'
# Tail live logs during canary observation
journalctl --user -u nanoclaw -f
# macOS: use log files directly instead of journalctl
grep slack_rate_limited logs/nanoclaw.log
grep -E 'socket_stale|socket_reconnect' logs/nanoclaw.log
grep slack_send_failed logs/nanoclaw.log
grep -E 'token_revoked|app_uninstalled' logs/nanoclaw.log
tail -f logs/nanoclaw.log
```

## 结构化日志字段参考

Slack 频道输出结构化日志条目。评估金丝雀条件时需关注的关键字段：

| 字段                | 值                   | 含义                                                    |
| ------------------- | -------------------- | ------------------------------------------------------- |
| `event`             | `socket_stale`       | 看门狗检测到 3 分钟以上无事件                           |
| `event`             | `socket_reconnect`   | 看门狗尝试重连（检查是否有 `err` 字段）                 |
| `event`             | `slack_rate_limited` | 收到 429；客户端将等待并重试                            |
| `event`             | `slack_send_failed`  | 所有重试耗尽后发送失败                                  |
| `event`             | `token_revoked`      | 从 Slack 收到 `tokens_revoked` 事件                     |
| `event`             | `app_uninstalled`    | 从 Slack 收到 `app_uninstalled` 事件                    |
| `last_event_ts`     | Unix ms timestamp    | 检测到 stale 前最后一次收到事件的时间                   |
| `reconnect_attempt` | integer              | 本次会话已尝试重连的次数                                |
| `duration_ms`       | integer              | 重连耗时                                                |
| `retry_after_s`     | integer              | 收到 429 后客户端等待的秒数                             |
| `status_code`       | integer              | 发送失败时的 HTTP 状态码                                |
