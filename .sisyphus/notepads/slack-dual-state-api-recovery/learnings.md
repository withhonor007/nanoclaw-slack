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
