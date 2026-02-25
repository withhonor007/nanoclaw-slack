# Learnings

## 2026-02-25 Task: Initial Context Gathering

- Skill-first constraint: all code changes go in `.claude/skills/add-slack/**`, runtime `src/` only modified by skill apply
- `manifest.yaml` currently does NOT list `src/group-queue.ts` in modifies — must be added
- `scheduleRetry` in group-queue.ts (line 249): after MAX_RETRIES=5, resets retryCount=0 and returns silently — this is the orphan bug
- `processGroupMessages` in index.ts: if `outputSentToUser && hadError`, returns `true` — cursor advances past error (false delivery)
- Existing skill-side modify files: index.ts, config.ts, db.ts, ipc.ts (no group-queue.ts yet)
- Existing skill-side add files: slack.ts, slack.test.ts, reconnect-policy.ts
- Test patterns: vitest, vi.mock for config/logger/db/fs, vi.useFakeTimers for async timing
- GroupQueue test mocks: config.js (DATA_DIR, MAX_CONCURRENT_CONTAINERS), fs (mkdirSync, writeFileSync, renameSync)
- Slack test mocks: @slack/bolt App class, @slack/web-api, config.js, logger.js, db.js
- `hasBotResponseAfter` exists in skill-side db.ts but NOT in runtime db.ts — skill adds it
- Skill-side index.ts already has `hasBotResponseAfter` import and piped-message dedup logic


## 2026-02-25 Task: Dual-State Exhaustion Drop Implementation

- Added skill-side `group-queue.ts` mirror and introduced exhaustion callback plumbing via `setOnExhaustionDropFn`.
- Changed retry exhaustion path from silent reset to structured `exhaustion_drop` event, clearing `pendingMessages` and invoking orchestrator callback.
- Wired skill-side `index.ts` to commit cursor on exhaustion (`cursor_commit_on_exhaustion`) and persist state immediately.
- Added `RECOVERY_EXHAUSTED_GATE_MS` in skill-side config with safe parse/fallback to `0` for invalid env values.
- Added `getLatestUserMessageTimestamp(chatJid)` helper in skill-side DB module for bounded cursor commit source.
- Updated Slack skill manifest modifies list to include `src/group-queue.ts` so skill apply captures new core patch file.
- Extended `src/group-queue.test.ts` with exhaustion-drop tests; used dynamic transpile/load of skill `group-queue.ts` to validate skill-side behavior without touching runtime source.
- Verified with `npx vitest run src/group-queue.test.ts`, `npx vitest run`, and `npm run build`.

## 2026-02-25 Task: GroupQueue Skill-Side Exhaustion Tests

- Keep  focused on runtime behavior; avoid dynamic skill-file transpile/import in runtime tests
- Put skill-specific queue tests beside  and mock  +  locally
- Run the skill test with  because root vitest include globs only target , , and 

## 2026-02-25 Task: GroupQueue Skill-Side Exhaustion Tests

- Keep src/group-queue.test.ts focused on runtime behavior; avoid dynamic skill-file transpile/import in runtime tests
- Put skill-specific queue tests beside .claude/skills/add-slack/modify/src/group-queue.ts and mock ./config.js + ./logger.js locally
- Run the skill test with vitest --root .claude/skills/add-slack/modify src/group-queue.test.ts because root vitest include globs only target src/, setup/, and skills-engine/

## 2026-02-25 Task: Learnings Errata

- Placeholder-only bullets in the prior section were from a failed shell-quoted append and are superseded by the fully populated section below them

## Task 2: Recovery Callback + Delivery Truthfulness (2026-02-25)

### onRecovery callback pattern
- Added `onRecovery?: () => void` to `SlackChannelOpts` interface (line 28 in slack.ts)
- Called in watchdog's successful reconnect path after `this.reconnectAttempt = 0`
- Wrapped in try/catch to prevent callback errors from crashing the watchdog loop
- Logs `event: 'recovery_callback_error'` if callback throws

### sendMessage delivery truthfulness
- Changed `sendMessage` to re-throw after logging — caller now knows delivery failed
- The existing test `'logs structured error on send failure'` was updated to expect a throw
- Added dedicated test `'sendMessage throws on failure so caller knows delivery failed'`

### index.ts wiring
- `onRecovery` callback iterates `registeredGroups` and calls `queue.enqueueMessageCheck(jid)` for all `slack:` prefixed JIDs only
- Logs `event: 'slack_recovery_resume'` on recovery
- `processGroupMessages` streaming callback now wraps `channel.sendMessage` in try/catch
- On send failure: logs `event: 'send_failed_non_delivery'`, `outputSentToUser` stays false → cursor rolls back for retry

### Test patterns for watchdog callbacks
- Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(13 * 60 * 1000)` to trigger stale threshold
- Then `vi.advanceTimersByTimeAsync(10_000)` to let backoff delay pass
- `createOpts({ onRecovery })` pattern works since `createOpts` accepts `Partial<SlackChannelOpts>`

### Skill test execution
- Skill tests in `.claude/skills/add-slack/add/src/` are NOT in the runtime vitest include pattern
- Runtime vitest only covers `src/`, `setup/`, `skills-engine/`
- Skill tests must be run separately or via a custom vitest config when the skill is applied

## 2026-02-25 Task: Recovery Integration Outage Test
- Added src/recovery.integration.test.ts with three runtime-focused scenarios for exhaustion drop and post-outage recovery behavior.
- Used fake timers to drive full backoff chain (5s, 10s, 20s, 40s, 80s) through MAX_RETRIES=5 and assert callback + state reset semantics.
- Verified exhaustion does not orphan groups by enqueueing fresh work after drop and asserting processing resumes for same JID.
- Captured index onRecovery intent conceptually: only slack:-prefixed registered group JIDs are re-enqueued on reconnect.
- Validation commands: npx vitest run src/recovery.integration.test.ts and npm run typecheck both pass.
