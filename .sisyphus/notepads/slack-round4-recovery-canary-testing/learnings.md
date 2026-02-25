# Learnings

## T1 Baseline Verification (2026-02-25)

### clean.sh mode clarification

- `clean.sh status` shows two fields: 状态 (state) and 模式锁 (mode lock)
- State "undeployed" = working tree not switched to a snapshot
- Mode lock "deployed" = the mode IS set to deployed (this is what matters for A1)
- A1 PASSES: mode lock is `deployed`

### Baseline numbers (confirmed current, not stale)

- Test files: 31
- Passing tests: 413
- Todo tests: 1
- Build: clean
- Typecheck: clean

### pino-pretty confirmed

- src/logger.ts: `transport: { target: 'pino-pretty', options: { colorize: true } }`
- No `($PID):` format in output — Metis finding confirmed

### RECOVERY_EXHAUSTED_GATE_MS gate

- Default: 0 (gate disabled)
- Safe parseInt with non-finite/negative fallback to 0
- Canary will observe all exhaustion_drop events unfiltered by default

### Recovery event key locations (verified)

- exhaustion_drop → src/group-queue.ts:267
- cursor_commit_on_exhaustion → src/index.ts:589
- send_failed_non_delivery → src/index.ts:220
- slack_recovery_resume → src/index.ts:516
- recovery_callback_error → src/channels/slack.ts:372

### Snapshots available (8 total)

Key ones: deployed-w4-verified, pre-canary, canary-deployed, predeploy-w4, pre-r3-deployed, pre-r3-reliability, canary-deployed-r2, pre-canary-r2

### No canary script files in feature_docs/

Canary scripts are runtime log-grep commands, not separate files. A5 cross-check was done against source only.

## T5: soak-monitor.sh PID Refresh & bc Fallback (2026-02-25)

### grep -c double-zero bug

`grep "pattern" file | grep -c "other" 2>/dev/null || echo 0` produces `0\n0` when file is missing.

- `grep -c` exits 1 on 0 matches on some systems, triggering `|| echo 0`
- Fix: `grep "pattern" file 2>/dev/null | grep -c "other"; true` — `; true` ensures clean exit, `grep -c` always outputs the count

### PID refresh pattern

Move `PID=$(pgrep -f 'dist/index.js' | head -1)` inside the while loop before each checkpoint.
Track `PREV_PID` to detect restarts and log `PID changed: $OLD -> $NEW`.
Guard with `[ -z "$PID" ] || ! kill -0 "$PID"` to handle disappeared process.

### bc replacement

`$(( RECONNECT * 60 / ELAPSED ))` replaces `echo "scale=2; $RECONNECT * 60 / $ELAPSED" | bc`
Integer division is fine for reconnects/hour threshold checks.

## T2-T4: canary-checkpoint.sh parser + C3/C4 gates (2026-02-25)

### T2 parser cleanup and dry-run metrics

- Removed dead `log_count()` helper; it was never called.
- Kept `pid_log_count()` and documented pino-pretty header format `(PID):`.
- Added `pid_log_sum_field()` to parse multiline pretty logs (header line + structured field lines), stripping ANSI color codes before extracting numeric fields.
- Dry-run now emits non-zero parser sample metrics (`dry_run_samples`) with a fallback chain: pid-filtered -> global log scan -> synthetic fallback.
- Dry-run can recover a PID from log headlines when process lookup fails, improving parser demonstration for offline checks.

### T3 C3 recovery heuristic

- C3 now tracks both `RATE_LIMIT_COUNT` and `SEND_FAILED_COUNT`.
- PASS when no rate limits, or when rate limits happened but send failures are zero (recovered).
- FAIL only when both are non-zero (unrecovered rate-limit pattern).

### T4 C4 message and idempotency gate

- C4 now requires all of: process alive, Slack connected, `message_count >= 50`, and `duplicate_count == 0`.
- `message_count` is summed from `Processing messages` entries using `messageCount` field.
- Failure detail now explicitly reports measured counts (`message_count`, `duplicate_count`, `slack_connected_events`).

## T6: Round-4 Naming Normalization (2026-02-25)
- Only 2 r3- references existed in active scripts (one per file, as inherited wisdom stated)
- canary-checkpoint.sh: EVIDENCE_FILE var on line 26
- soak-monitor.sh: EVIDENCE_FILE var on line 7
- soak-monitor.sh --dry-run doesn't exist; use `bash scripts/slack/soak-monitor.sh 1 1` for quick test (exits after 1 min)
- soak-monitor.sh writes evidence file on first checkpoint, confirming new r4-soak.txt path works
- canary-checkpoint.sh --dry-run skips API calls but still produces full JSON output (good for syntax/path verification)
