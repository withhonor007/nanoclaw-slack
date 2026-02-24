## Notepad initialized


## T2: Watchdog Remediation Implementation (2026-02-24)

### Changes Applied to slack.ts
- Import: `calculateBackoff` from `./reconnect-policy.js`
- New properties: `isReconnecting`, `breakerOpen`, `STALE_THRESHOLD` (12 min)
- Socket heartbeat liveness via `receiver.on('connected'/'disconnected')`
- Reentrancy guard: `isReconnecting` boolean with try/finally
- Exponential backoff: base 5s, factor 2, jitter ±20%, max 5 attempts
- Circuit breaker: `process.exit(1)` after max retries
- Bolt SDK retries reduced from 3 to 1 (watchdog manages reconnection)
- All reconnect events have structured log fields

### Key Decisions
- Used `receiver as unknown as { on?: ... }` type assertion for socket events (Bolt types don't expose EventEmitter interface directly)
- `process.exit(1)` chosen as terminal action — assumes systemd/launchd restart policy
- Bolt retries set to 1 (not 0) to allow one SDK-level retry before watchdog takes over

### Testing Note
- Skill tests cannot run in undeployed mode (@slack/web-api not installed)
- Tests will be validated after deployed switch (T6)
- reconnect-policy.ts is a pure function module — testable independently