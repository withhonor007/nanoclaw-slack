# Dual-State Recovery Runbook

Operator reference for the exhaustion-drop / recovery model introduced in commits `5a3f05e` and `de993c9`.

---

## 1. State Machine

The per-group queue has two states. Every group starts in NORMAL.

```
NORMAL --[retries exhausted (>5)]--> EXHAUSTED_DROP --[recovery / new msg]--> NORMAL
```

### NORMAL

Bounded retries with exponential backoff.

| Parameter       | Value                                   |
| --------------- | --------------------------------------- |
| MAX_RETRIES     | 5                                       |
| BASE_RETRY_MS   | 5 000 ms                                |
| Backoff formula | `5000 * 2^(retryCount-1)`               |
| Retry schedule  | 5s, 10s, 20s, 40s, 80s (~2.5 min total) |

On each failure `scheduleRetry` increments `retryCount`. While `retryCount <= 5` the group stays in NORMAL and a delayed `enqueueMessageCheck` is scheduled.

### EXHAUSTED_DROP

Triggered when `retryCount > MAX_RETRIES` (i.e. the 6th failure).

What happens on entry:

1. Logs `event: exhaustion_drop` (warn)
2. Resets `retryCount = 0`
3. Clears `pendingMessages = false` (discards frozen window)
4. Calls `onExhaustionDropFn(groupJid)` (orchestrator callback)
   - Orchestrator commits cursor to latest user message timestamp (`cursor_commit_on_exhaustion`)
   - Persists state to disk immediately

The group is now idle. No retries are scheduled. It will process new messages normally when they arrive.

### Recovery transition (EXHAUSTED_DROP -> NORMAL)

Two paths trigger recovery:

**Path A: Slack socket reconnect**
The watchdog in `slack.ts` calls `opts.onRecovery()` after a successful `app.stop()` / `app.start()` cycle. The orchestrator iterates all registered groups with `slack:` JIDs and calls `queue.enqueueMessageCheck(jid)` for each. This logs `event: slack_recovery_resume`.

**Path B: New inbound message**
Any new message for the group calls `enqueueMessageCheck` directly. The group processes it from the committed cursor position.

---

## 2. Event Taxonomy

All events are emitted as structured log fields (`event: '<name>'`). Use `grep '"event"' logs/nanoclaw.log` or `journalctl --user -u nanoclaw | grep '"event"'` to filter.

| Event                            | Source                  | Severity | When emitted                                                       | Key fields                                                                                     |
| -------------------------------- | ----------------------- | -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `exhaustion_drop`                | `src/group-queue.ts`    | warn     | retryCount exceeds MAX_RETRIES (>5)                                | `groupJid`, `retryCount`                                                                       |
| `exhaustion_drop_callback_error` | `src/group-queue.ts`    | error    | `onExhaustionDropFn` throws                                        | `groupJid`, `err`                                                                              |
| `cursor_commit_on_exhaustion`    | `src/index.ts`          | warn     | orchestrator commits cursor after drop                             | `group`, `groupJid`, `commitTimestamp`, `gateMs`                                               |
| `send_failed_non_delivery`       | `src/index.ts`          | error    | `channel.sendMessage` throws during agent output                   | `group`, `chatJid`, `sendErr`                                                                  |
| `slack_recovery_resume`          | `src/index.ts`          | info     | Slack reconnect triggers re-enqueue of all slack: groups           | (none)                                                                                         |
| `socket_connected`               | `src/channels/slack.ts` | info     | Socket Mode receiver emits `connected`                             | `liveness_source: 'socket_event'`                                                              |
| `socket_disconnected`            | `src/channels/slack.ts` | warn     | Socket Mode receiver emits `disconnected`                          | `liveness_source: 'socket_event'`                                                              |
| `socket_stale`                   | `src/channels/slack.ts` | warn     | No event received for >STALE_THRESHOLD (12 min)                    | `last_event_ts`, `reconnect_attempt`, `stale_duration_ms`, `backoff_delay_ms`, `breaker_state` |
| `socket_reconnect`               | `src/channels/slack.ts` | info     | Watchdog reconnect succeeded                                       | `reconnect_attempt`, `duration_ms`, `breaker_state`                                            |
| `socket_reconnect_failed`        | `src/channels/slack.ts` | error    | Watchdog reconnect attempt failed                                  | `reconnect_attempt`, `duration_ms`, `error`                                                    |
| `reconnect_skipped`              | `src/channels/slack.ts` | debug    | Watchdog tick skipped                                              | `reason: 'in_flight'` or `'breaker_open'`                                                      |
| `breaker_open`                   | `src/channels/slack.ts` | error    | Circuit breaker opened after max reconnect attempts; process exits | `attempt`, `stale_duration_ms`, `breaker_state: 'open'`                                        |
| `slack_send_failed`              | `src/channels/slack.ts` | error    | All WebClient retries exhausted                                    | `jid`, `status_code`, `length`, `err`                                                          |
| `slack_rate_limited`             | `src/channels/slack.ts` | warn     | Received HTTP 429                                                  | `retry_after_s`, `url`                                                                         |
| `token_revoked`                  | `src/channels/slack.ts` | warn     | Slack sent `tokens_revoked` event                                  | (none)                                                                                         |
| `app_uninstalled`                | `src/channels/slack.ts` | warn     | Slack sent `app_uninstalled` event                                 | (none)                                                                                         |
| `recovery_callback_error`        | `src/channels/slack.ts` | error    | `opts.onRecovery()` threw                                          | `err`                                                                                          |

---

## 3. Canary Checklist

Run these gates before and after any deployment touching the recovery path.

### Gates C1-C3: Static validation (must all pass)

```bash
# C1: TypeScript clean
npm run typecheck
# Pass: exit 0, no errors

# C2: Test suite
npm test
# Pass: 413+ tests, 0 failures

# C3: Build
npm run build
# Pass: exit 0, dist/ populated
```

### Gates C4-C6: Runtime signal thresholds

| Gate | Signal                     | Pass threshold                      | Fail threshold                             | Log query                                         |
| ---- | -------------------------- | ----------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| C4   | `exhaustion_drop`          | 0 under normal traffic              | >5 in any 1-hour window                    | `grep exhaustion_drop logs/nanoclaw.log`          |
| C5   | `slack_recovery_resume`    | Appears only after confirmed outage | Appears without a preceding `socket_stale` | `grep slack_recovery_resume logs/nanoclaw.log`    |
| C6   | `send_failed_non_delivery` | 0 under normal traffic              | >10 in any 1-hour window                   | `grep send_failed_non_delivery logs/nanoclaw.log` |

### Pass/fail summary

All of C1, C2, C3 must exit 0. C4-C6 must be within expected ranges. Any single gate failure is a no-go.

---

## 4. Rollback Procedure

### When to trigger

Trigger rollback immediately if any of the following occur:

- C1, C2, or C3 fails after deployment
- `exhaustion_drop` count > 5 in any 1-hour window under normal traffic
- `send_failed_non_delivery` count > 10 in any 1-hour window
- `socket_stale` appears but no `socket_reconnect` follows within 5 minutes
- `breaker_open` appears (process will exit; supervisor restarts it, but the root cause needs investigation)
- `recovery_callback_error` appears (recovery path is broken)

### Rollback sequence

The two commits to revert are:

| Commit                | Hash      | Description                                                                   |
| --------------------- | --------- | ----------------------------------------------------------------------------- |
| Commit 2 (deployed)   | `de993c9` | test(recovery): validate deployed outage exhaustion and recovery flow         |
| Commit 1 (skill-side) | `5a3f05e` | fix(recovery): implement dual-state exhaustion drop and slack recovery bridge |

Revert in reverse order (newest first):

```bash
# Step 1: revert the integration test commit
git revert de993c9 --no-edit

# Step 2: revert the runtime + skill implementation commit
git revert 5a3f05e --no-edit

# Step 3: validate
npm run typecheck && npm test && npm run build

# Step 4: restart service
# Linux
systemctl --user restart nanoclaw
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### Post-rollback validation

```bash
# Confirm no exhaustion_drop events in new logs
grep exhaustion_drop logs/nanoclaw.log | tail -5

# Confirm no cursor_commit_on_exhaustion
grep cursor_commit_on_exhaustion logs/nanoclaw.log | tail -5

# Confirm service is running
# Linux
systemctl --user status nanoclaw
# macOS
launchctl list | grep nanoclaw
```

Expected: no new `exhaustion_drop` or `cursor_commit_on_exhaustion` entries after the restart timestamp.

---

## 5. Go/No-Go Checklist

Fill in before production rollout. All rows must show PASS.

| #   | Criterion                                              | Threshold              | Actual | Result |
| --- | ------------------------------------------------------ | ---------------------- | ------ | ------ |
| C1  | `npm run typecheck`                                    | exit 0                 |        |        |
| C2  | `npm test`                                             | 413+ pass, 0 fail      |        |        |
| C3  | `npm run build`                                        | exit 0                 |        |        |
| C4  | `exhaustion_drop` count (1h window)                    | 0 under normal traffic |        |        |
| C5  | `slack_recovery_resume` without preceding outage       | 0 spurious occurrences |        |        |
| C6  | `send_failed_non_delivery` count (1h window)           | 0 under normal traffic |        |        |
| C7  | `socket_reconnect` follows `socket_stale` within 5 min | 100% of stale events   |        |        |
| C8  | No `breaker_open` in logs                              | 0 occurrences          |        |        |
| C9  | No `recovery_callback_error` in logs                   | 0 occurrences          |        |        |

**Go** = all rows PASS. **No-go** = any row FAIL, trigger rollback.

---

## 6. Quick Diagnostic Commands

```bash
# Tail live logs
journalctl --user -u nanoclaw -f          # Linux
tail -f logs/nanoclaw.log                  # macOS

# Check exhaustion events
grep exhaustion_drop logs/nanoclaw.log

# Check recovery events
grep slack_recovery_resume logs/nanoclaw.log

# Check socket health
grep -E 'socket_stale|socket_reconnect|breaker_open' logs/nanoclaw.log

# Check delivery failures
grep send_failed_non_delivery logs/nanoclaw.log

# Count send failures in last hour (Linux)
journalctl --user -u nanoclaw --since '1 hour ago' | grep -c send_failed_non_delivery

# Check cursor commits on exhaustion
grep cursor_commit_on_exhaustion logs/nanoclaw.log
```
