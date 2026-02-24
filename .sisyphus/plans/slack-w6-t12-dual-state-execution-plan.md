# W6 Plan: Slack T12 Channel Name Auto-Sync (Dual-State Execution)

## TL;DR

> **Quick Summary**: Implement T12 Slack channel metadata auto-sync in deployed state, then backport validated changes to the Slack skill package following dual-state SOP.
>
> **Deliverables**:
> - `src/db.ts`, `src/index.ts`, `src/channels/slack.ts`, `src/channels/slack.test.ts`, `src/routing.test.ts` (T12 complete)
> - Skill backport targets under `.claude/skills/add-slack/`
> - Evidence and gate outputs under `.sisyphus/evidence/`
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves + FINAL verification wave
> **Critical Path**: T1 -> T7 -> T8 -> T13 -> T16 -> T19 -> F1-F4

---

## Context

### Original Request
继续编写详细可实施的开发计划文档并落盘；并按双态开发规范制定下一步计划。

### Interview Summary
- Round 3 consistency corrections are already applied to tracking and completion docs.
- Current runtime mode is `deployed` (`.nanoclaw/dev-mode`).
- T12 is currently 0/16 implemented and fully specified in `.sisyphus/plans/curious-soaring-petal.md`.
- T12 scope is channel name synchronization parity with WhatsApp metadata sync flow.

### Research Findings
- `src/db.ts:217` and `src/db.ts:228` are hardcoded to `__group_sync__` and need parameterization.
- `src/index.ts:107` excludes only `__group_sync__`; should generalize to `startsWith('__')`.
- `src/index.ts:487` wires only WhatsApp metadata sync.
- `src/channels/slack.ts` currently has watchdog but no metadata sync method/timer.
- `src/channels/slack.test.ts` has no metadata sync tests/mocks.
- `src/routing.test.ts` lacks `__slack_sync__` sentinel exclusion test.

### Metis Review (Applied)
- Add explicit guardrail: `disconnect()` must reset `syncTimerStarted = false`.
- Avoid sequencing hazard: implement `slack.syncChannelMetadata()` before `index.ts` IPC call site or gate both together.
- Add coverage gaps beyond baseline 5 tests: pagination, connect-triggered sync, timer cleanup, DB function behavior.
- Lock down scope: polling-only sync, no event-driven rename logic, no `src/types.ts` interface expansion.

---

## Work Objectives

### Core Objective
Complete T12 by implementing Slack channel metadata synchronization with 24h cache and IPC force-refresh path, while preserving dual-state safety and preventing scope creep.

### Concrete Deliverables
- T12 code implemented in `src/` (5 files) with passing tests.
- Skill backport prepared for `.claude/skills/add-slack/add/` and `.claude/skills/add-slack/modify/` targets.
- End-to-end validation evidence recorded for every task and final review.

### Definition of Done
- [x] `npm run build` passes with zero errors after T12 changes.
- [x] `npx vitest run` passes with expected test growth (baseline + new T12 tests).
- [x] `syncGroupMetadata(true)` triggers both WhatsApp and Slack metadata sync paths.
- [x] `syncChannelMetadata(true)` updates both `chats.name` and `registered_groups.name` for registered Slack channels.
- [x] Dual-state guardrails remain satisfied throughout execution.

### Must Have
- Parameterized sync sentinel in DB helpers with backward-compatible defaults.
- Slack sync sentinel support (`__slack_sync__`) without exposing sentinel rows in group listing.
- 24h cached auto-sync plus force mode.
- Pagination-safe Slack `conversations.list` handling.
- Persist display names using `channel.name` (not `name_normalized`) for UX parity with existing chat naming.
- Comprehensive tests including happy path and failure path.

### Must NOT Have (Guardrails)
- No event-driven `channel_rename`/`group_rename` feature expansion.
- No `src/types.ts` interface changes.
- No manual state switching during core T12 execution.
- No new dependencies in `package.json`.
- No in-memory `registeredGroups` mutation logic beyond current DB update scope.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD (RED -> GREEN -> REFACTOR)
- **Framework**: Vitest + TypeScript build
- **Primary commands**: `npm run build`, `npx vitest run`, focused test files per task

### QA Policy
- Every task includes at least one happy path and one failure/edge scenario.
- Evidence saved under `.sisyphus/evidence/task-{N}-{scenario}.txt`.
- Runtime/API behavior validated via CLI/test execution, not manual checklist claims.

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Foundation + red tests, parallel):
- T1 Dual-state preflight and baseline lock
- T2 DB `getLastGroupSync` parameterization
- T3 DB `setLastGroupSync` parameterization
- T4 DB `updateRegisteredGroupName` function + unit coverage
- T5 Slack test harness: db mock + conversations mock scaffolding
- T6 RED tests for `syncChannelMetadata` behavior

Wave 2 (Slack sync core, mixed dependency):
- T7 Slack sync imports/constants/fields
- T8 `syncChannelMetadata()` method (pagination + cache + DB updates)
- T9 `connect()` startup sync + daily timer
- T10 `disconnect()` timer cleanup + reset guard flag
- T11 `getAvailableGroups` sentinel filter generalization

Wave 3 (Integration touchpoints, parallel after Wave 2):
- T12 Routing sentinel exclusion test (`__slack_sync__`)
- T13 IPC `syncGroupMetadata` extension to include Slack path
- T14 Slack sync coverage expansion (pagination + connect-trigger + timer cleanup)
- T15 Regression stabilization and test refactor cleanup

Wave 4 (Dual-state delivery + backport):
- T16 Full regression gate (`build` + full vitest)
- T17 Runtime smoke and forced metadata refresh evidence
- T18 Skill backport (`add/` + `modify/` targets)
- T19 Dual-state roundtrip validation (`apply-skill`/state safety checks)

Wave FINAL (Independent review, 4 parallel):
- F1 Plan Compliance Audit (`oracle`)
- F2 Code Quality Review (`unspecified-high`)
- F3 Real QA Scenario Replay (`unspecified-high`)
- F4 Scope Fidelity Check (`deep`)

### Dependency Matrix
- T1: none -> blocks T16,T19
- T2: none -> blocks T8
- T3: none -> blocks T8
- T4: none -> blocks T8,T15
- T5: none -> blocks T6,T14
- T6: T5 -> blocks T14
- T7: T2,T3 -> blocks T8
- T8: T2,T3,T4,T7 -> blocks T9,T10,T13,T14
- T9: T8 -> blocks T17
- T10: T8 -> blocks T17
- T11: none -> blocks T12,T16
- T12: T11 -> blocks T16
- T13: T8 -> blocks T16,T17
- T14: T6,T8 -> blocks T15,T16
- T15: T4,T14 -> blocks T16
- T16: T1,T11,T12,T13,T14,T15 -> blocks T17,T18,T19
- T17: T9,T10,T13,T16 -> blocks F1,F3
- T18: T16 -> blocks T19,F4
- T19: T1,T16,T18 -> blocks F1,F4

### Agent Dispatch Summary
- Wave 1: T1 `unspecified-high`; T2-T4 `quick`; T5-T6 `quick`
- Wave 2: T7-T8 `deep`; T9-T10 `unspecified-high`; T11 `quick`
- Wave 3: T12 `quick`; T13 `deep`; T14 `deep`; T15 `unspecified-high`
- Wave 4: T16 `unspecified-high`; T17 `deep`; T18 `quick`; T19 `unspecified-high`
- FINAL: F1 `oracle`; F2 `unspecified-high`; F3 `unspecified-high`; F4 `deep`

---

## TODOs

- [x] 1. Dual-state preflight and baseline lock

  **What to do**:
  - Confirm mode is `deployed`; record guard status and baseline test/build outputs.
  - Create evidence snapshot for pre-change state.

  **Must NOT do**:
  - No source changes in this task.
  - No mode switch (`clean.sh switch`) in this task.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: environment/guard validation and failure triage.
  - **Skills**: [`debug`]
    - `debug`: interpret state and guard signals safely.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: no code change yet.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2,T3,T4,T5)
  - **Blocks**: T16, T19
  - **Blocked By**: None

  **References**:
  - `.nanoclaw/dev-mode` - authoritative mode state.
  - `feature_docs/clean.sh:39` - dual-state SOP and guard commands.
  - `.sisyphus/plans/slack-roadmap-next-phase.md:29` - state definitions and guardrails.

  **Acceptance Criteria**:
  - [ ] Evidence file records mode=`deployed`, guard-check pass, baseline build/test outputs.
  - [ ] Slack token scope precheck confirms `conversations.list` callable (no `missing_scope`).

  **QA Scenarios**:
  ```
  Scenario: Happy path — preflight passes
    Tool: Bash
    Preconditions: repo clean enough to run checks
    Steps:
      1. Run `./feature_docs/clean.sh status`
      2. Run `./feature_docs/clean.sh guard-check`
      3. Run `npm run build && npx vitest run`
      4. Run Slack scope probe via API (`conversations.list` limit=1)
    Expected Result: mode=deployed, guard-check pass, build/test pass, no `missing_scope`
    Failure Indicators: dirty-core, guard-check fail, build/test fail
    Evidence: .sisyphus/evidence/task-1-preflight-pass.txt

  Scenario: Failure path — dirty-core detected
    Tool: Bash
    Preconditions: simulated dirty-core state or guard failure output
    Steps:
      1. Run `./feature_docs/clean.sh status`
      2. Capture failure and stop task flow
    Expected Result: task blocked with explicit stop reason
    Evidence: .sisyphus/evidence/task-1-preflight-fail.txt
  ```

  **Commit**: NO

- [x] 2. Parameterize `getLastGroupSync` sentinel

  **What to do**:
  - Change `getLastGroupSync()` to `getLastGroupSync(sentinel = '__group_sync__')`.
  - Replace hardcoded SQL sentinel with parameterized query placeholder.

  **Must NOT do**:
  - No behavior change for WhatsApp callers without args.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: isolated function-level refactor in one file.
  - **Skills**: [`add-slack`]
    - `add-slack`: aligns with Slack skill contract.
  - **Skills Evaluated but Omitted**:
    - `debug`: no runtime issue expected.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T8
  - **Blocked By**: None

  **References**:
  - `src/db.ts:217` - existing hardcoded implementation to replace.
  - `src/channels/whatsapp.ts:256` - current caller expects default behavior.

  **Acceptance Criteria**:
  - [ ] Function accepts optional sentinel and preserves legacy default behavior.
  - [ ] TypeScript build passes.

  **QA Scenarios**:
  ```
  Scenario: Happy path — default sentinel unchanged
    Tool: Bash
    Preconditions: db test env initialized
    Steps:
      1. Run focused tests for db/metadata paths
      2. Call function without args via test
    Expected Result: returns value for `__group_sync__` as before
    Evidence: .sisyphus/evidence/task-2-default-sentinel.txt

  Scenario: Edge path — custom sentinel read
    Tool: Bash
    Preconditions: test inserts `__slack_sync__` row
    Steps:
      1. Call `getLastGroupSync('__slack_sync__')`
      2. Assert returned timestamp equals inserted value
    Expected Result: custom sentinel works
    Evidence: .sisyphus/evidence/task-2-custom-sentinel.txt
  ```

  **Commit**: NO

- [x] 3. Parameterize `setLastGroupSync` sentinel

  **What to do**:
  - Change `setLastGroupSync()` to `setLastGroupSync(sentinel = '__group_sync__')`.
  - Parameterize insert SQL for jid/name/timestamp.

  **Must NOT do**:
  - No schema changes.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: local SQL update in one function.
  - **Skills**: [`add-slack`]
    - `add-slack`: keeps sentinel contract aligned with Slack sync plan.
  - **Skills Evaluated but Omitted**:
    - `debug`: unnecessary for deterministic SQL refactor.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T8
  - **Blocked By**: None

  **References**:
  - `src/db.ts:228` - existing hardcoded writer.
  - `.sisyphus/plans/curious-soaring-petal.md:57` - target API signature.

  **Acceptance Criteria**:
  - [ ] Default call writes `__group_sync__` row.
  - [ ] Custom sentinel call writes custom row.

  **QA Scenarios**:
  ```
  Scenario: Happy path — default write
    Tool: Bash
    Preconditions: clean test DB
    Steps:
      1. Invoke `setLastGroupSync()`
      2. Query chats table for `__group_sync__`
    Expected Result: row exists and timestamp updated
    Evidence: .sisyphus/evidence/task-3-default-write.txt

  Scenario: Edge path — custom write
    Tool: Bash
    Preconditions: clean test DB
    Steps:
      1. Invoke `setLastGroupSync('__slack_sync__')`
      2. Query chats table for `__slack_sync__`
    Expected Result: row exists for custom sentinel
    Evidence: .sisyphus/evidence/task-3-custom-write.txt
  ```

  **Commit**: NO

- [x] 4. Add `updateRegisteredGroupName` DB function + direct DB test

  **What to do**:
  - Add `updateRegisteredGroupName(jid, name)` in `src/db.ts`.
  - Add/extend DB test to verify update and no-op when JID absent.

  **Must NOT do**:
  - No extra side effects outside `registered_groups.name`.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: one helper + one focused test.
  - **Skills**: [`add-slack`]
    - `add-slack`: matches T12 contract requirement.
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: overkill.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T8, T15
  - **Blocked By**: None

  **References**:
  - `src/db.ts` - helper placement after sync functions.
  - `src/db.ts` registered group helpers - style for SQL updates.

  **Acceptance Criteria**:
  - [ ] Registered group name updates when jid exists.
  - [ ] No crash/no-op when jid not present.

  **QA Scenarios**:
  ```
  Scenario: Happy path — registered group renamed
    Tool: Bash
    Preconditions: test row exists in `registered_groups`
    Steps:
      1. Call `updateRegisteredGroupName('slack:C123', 'general')`
      2. Query row by jid
    Expected Result: `name='general'`
    Evidence: .sisyphus/evidence/task-4-update-name.txt

  Scenario: Edge path — unknown jid
    Tool: Bash
    Preconditions: jid does not exist
    Steps:
      1. Call helper with unknown jid
      2. Verify no exception, no unrelated row mutation
    Expected Result: safe no-op
    Evidence: .sisyphus/evidence/task-4-noop.txt
  ```

  **Commit**: YES
  - Message: `feat(slack): prepare db sync primitives for channel metadata`
  - Files: `src/db.ts`, related db test file
  - Pre-commit: `npm run build && npx vitest run`

- [x] 5. Add Slack test mocks for DB + `conversations.list`

  **What to do**:
  - Add `vi.mock('../db.js')` with `getLastGroupSync`, `setLastGroupSync`, `updateChatName`, `updateRegisteredGroupName`.
  - Extend MockApp client with `conversations.list` paginated response stub.

  **Must NOT do**:
  - Do not break existing 43 Slack tests.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: test fixture extension in one file.
  - **Skills**: [`add-slack`]
    - `add-slack`: existing test style and mocks are from this domain.
  - **Skills Evaluated but Omitted**:
    - `debug`: not needed for deterministic mocks.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T6, T14
  - **Blocked By**: None

  **References**:
  - `src/channels/slack.test.ts:21` - existing mock app structure.
  - `.sisyphus/plans/curious-soaring-petal.md:294` - target db mock contract.

  **Acceptance Criteria**:
  - [ ] All pre-existing Slack tests still pass.
  - [ ] New mocks are available for sync tests.

  **QA Scenarios**:
  ```
  Scenario: Happy path — mocks compile and existing tests stay green
    Tool: Bash
    Preconditions: updated slack.test.ts
    Steps:
      1. Run `npx vitest run src/channels/slack.test.ts`
      2. Inspect summary for zero failures
    Expected Result: 43 existing tests pass, 0 regressions
    Evidence: .sisyphus/evidence/task-5-mocks-regression.txt

  Scenario: Failure path — malformed mock response
    Tool: Bash
    Preconditions: temporarily set missing fields in mock
    Steps:
      1. Run test file
      2. Capture failing assertion and restore valid mock
    Expected Result: failure is deterministic and fixed by proper mock shape
    Evidence: .sisyphus/evidence/task-5-mock-shape-fail.txt
  ```

  **Commit**: NO

- [x] 6. Add RED tests for sync behavior (before implementation)

  **What to do**:
  - Add sync test skeletons that assert desired behavior (force sync, cache skip, registered-only update).
  - Run tests to confirm expected RED failures before implementing sync method.

  **Must NOT do**:
  - Do not implement production sync logic in this task.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: pure test authoring for TDD red phase.
  - **Skills**: [`add-slack`]
    - `add-slack`: ensures tests match channel conventions.
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: unnecessary.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after T5
  - **Blocks**: T14
  - **Blocked By**: T5

  **References**:
  - `.sisyphus/plans/curious-soaring-petal.md:310` - baseline 5-case sync suite.
  - `src/channels/slack.test.ts:482` - existing watchdog test structure for style.

  **Acceptance Criteria**:
  - [ ] New sync tests fail for the correct missing behavior.

  **QA Scenarios**:
  ```
  Scenario: Happy path — RED phase produces expected failures
    Tool: Bash
    Preconditions: sync tests added, no sync implementation yet
    Steps:
      1. Run `npx vitest run src/channels/slack.test.ts`
      2. Confirm failures are only in new sync tests
    Expected Result: RED failures match missing methods/behavior
    Evidence: .sisyphus/evidence/task-6-red-tests.txt

  Scenario: Failure path — unrelated legacy tests fail
    Tool: Bash
    Preconditions: same run
    Steps:
      1. Inspect failing test list
      2. If non-sync tests fail, stop and fix test scaffolding
    Expected Result: no unrelated regressions in RED phase
    Evidence: .sisyphus/evidence/task-6-red-regression-check.txt
  ```

  **Commit**: YES
  - Message: `test(slack): add red cases for channel metadata sync`
  - Files: `src/channels/slack.test.ts`
  - Pre-commit: `npx vitest run src/channels/slack.test.ts`

- [x] 7. Add Slack sync imports, constants, and fields

  **What to do**:
  - Import db helpers in `src/channels/slack.ts`.
  - Add `SLACK_SYNC_INTERVAL_MS`, `SLACK_SYNC_SENTINEL`.
  - Add `syncTimerStarted`, `syncTimer` class fields.

  **Must NOT do**:
  - Do not wire timers in connect/disconnect yet.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: core channel class contract extension.
  - **Skills**: [`add-slack`]
    - `add-slack`: keep file-level consistency with Slack channel conventions.
  - **Skills Evaluated but Omitted**:
    - `debug`: no runtime diagnosis yet.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 sequential start
  - **Blocks**: T8,T9,T10
  - **Blocked By**: T2,T3

  **References**:
  - `src/channels/slack.ts:1` - import area.
  - `src/channels/slack.ts:31` - current field block.

  **Acceptance Criteria**:
  - [ ] Build passes with added imports/constants/fields.

  **QA Scenarios**:
  ```
  Scenario: Happy path — compile passes after scaffolding
    Tool: Bash
    Preconditions: scaffolding edits applied
    Steps:
      1. Run `npm run build`
    Expected Result: 0 TypeScript errors
    Evidence: .sisyphus/evidence/task-7-build-pass.txt

  Scenario: Failure path — import mismatch
    Tool: Bash
    Preconditions: intentionally wrong import name (temporary)
    Steps:
      1. Run `npm run build`
      2. Restore correct import
    Expected Result: deterministic compile failure then fix
    Evidence: .sisyphus/evidence/task-7-import-fail.txt
  ```

  **Commit**: NO

- [x] 8. Implement `syncChannelMetadata()` core flow

  **What to do**:
  - Implement method with: connected/app guard, 24h cache check, pagination loop, `updateChatName`, conditional `updateRegisteredGroupName`, sentinel write, error logging.
  - Keep behavior polling-only and force override.

  **Must NOT do**:
  - No event-driven rename features.
  - No `conversations.info` fallback path.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: core business logic + paging + cache semantics.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: align with skill package semantics.
    - `debug`: verify edge path handling.
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: complexity moderate.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after T7
  - **Blocks**: T9,T10,T13,T14
  - **Blocked By**: T2,T3,T4,T7

  **References**:
  - `.sisyphus/plans/curious-soaring-petal.md:160` - target method skeleton.
  - `src/channels/whatsapp.ts:256` - sync pattern baseline.
  - Slack docs: `https://api.slack.com/methods/conversations.list` - pagination and scopes.

  **Acceptance Criteria**:
  - [ ] Force sync reads all pages and updates DB names.
  - [ ] Non-force sync skips within 24h window.
  - [ ] Failures log and resolve without throwing.

  **QA Scenarios**:
  ```
  Scenario: Happy path — force sync updates both tables
    Tool: Bash
    Preconditions: registeredGroups includes `slack:C123`
    Steps:
      1. Run focused Slack sync tests
      2. Assert calls to `updateChatName` and `updateRegisteredGroupName`
    Expected Result: both update calls observed; sentinel set
    Evidence: .sisyphus/evidence/task-8-force-sync.txt

  Scenario: Failure path — Slack API throws
    Tool: Bash
    Preconditions: mock `conversations.list` to reject
    Steps:
      1. Run failure-case test
      2. Assert method resolves and logs error
    Expected Result: no uncaught rejection, proper error log
    Evidence: .sisyphus/evidence/task-8-api-error.txt
  ```

  **Commit**: YES
  - Message: `feat(slack): add channel metadata sync core flow`
  - Files: `src/channels/slack.ts`
  - Pre-commit: `npm run build && npx vitest run src/channels/slack.test.ts`

- [x] 9. Wire startup sync and periodic timer in `connect()`

  **What to do**:
  - Trigger `this.syncChannelMetadata().catch(...)` after watchdog startup.
  - Start daily timer only once using `syncTimerStarted` guard.

  **Must NOT do**:
  - Do not block `connect()` on sync completion.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: lifecycle wiring needs reliability-focused handling.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: channel lifecycle consistency.
    - `debug`: timer and async error path validation.
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: not required.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after T8
  - **Blocks**: T17
  - **Blocked By**: T8

  **References**:
  - `src/channels/slack.ts:115` - current connect tail.
  - `.sisyphus/plans/curious-soaring-petal.md:224` - intended connect wiring.

  **Acceptance Criteria**:
  - [ ] Connect triggers initial sync attempt.
  - [ ] Timer is created once.

  **QA Scenarios**:
  ```
  Scenario: Happy path — connect triggers sync
    Tool: Bash
    Preconditions: sync method implemented
    Steps:
      1. Run sync-connect test case
      2. Assert `conversations.list` called after connect
    Expected Result: initial sync attempt observed
    Evidence: .sisyphus/evidence/task-9-connect-sync.txt

  Scenario: Edge path — repeated connect does not duplicate timer
    Tool: Bash
    Preconditions: simulate connect/disconnect/connect in test
    Steps:
      1. Spy on `setInterval`
      2. Assert one active sync timer per connect cycle
    Expected Result: no timer duplication leak
    Evidence: .sisyphus/evidence/task-9-timer-once.txt
  ```

  **Commit**: NO

- [x] 10. Wire sync timer cleanup in `disconnect()` and reset guard flag

  **What to do**:
  - Clear `syncTimer` in disconnect.
  - Reset `syncTimerStarted = false` after cleanup.

  **Must NOT do**:
  - Do not remove watchdog cleanup logic.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: reconnect safety and timer lifecycle correctness.
  - **Skills**: [`debug`]
    - `debug`: ensure no reconnect/timer dead state.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: less critical than lifecycle debugging.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after T9
  - **Blocks**: T17
  - **Blocked By**: T8

  **References**:
  - `src/channels/slack.ts:164` - disconnect method.
  - Metis finding: timer re-create hazard after reconnect.

  **Acceptance Criteria**:
  - [ ] Disconnect clears sync timer and resets guard flag.
  - [ ] Reconnect can recreate timer.

  **QA Scenarios**:
  ```
  Scenario: Happy path — timer cleaned on disconnect
    Tool: Bash
    Preconditions: timer active after connect
    Steps:
      1. Call disconnect in test
      2. Assert `clearInterval` called for sync timer
    Expected Result: timer cleared, no residual interval
    Evidence: .sisyphus/evidence/task-10-timer-clear.txt

  Scenario: Failure path — reconnect dead timer regression
    Tool: Bash
    Preconditions: connect->disconnect->connect flow
    Steps:
      1. Simulate reconnect cycle
      2. Assert sync timer recreated
    Expected Result: timer recreated; no stale `syncTimerStarted` lock
    Evidence: .sisyphus/evidence/task-10-reconnect-timer.txt
  ```

  **Commit**: YES
  - Message: `fix(slack): stabilize sync timer lifecycle across reconnect`
  - Files: `src/channels/slack.ts`
  - Pre-commit: `npm run build && npx vitest run src/channels/slack.test.ts`

- [x] 11. Generalize sentinel filter in `getAvailableGroups`

  **What to do**:
  - Replace `c.jid !== '__group_sync__'` with `!c.jid.startsWith('__')`.

  **Must NOT do**:
  - No change to non-group filtering (`c.is_group`).

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: one-line behavior generalization.
  - **Skills**: [`add-slack`]
    - `add-slack`: aligns with new `__slack_sync__` sentinel behavior.
  - **Skills Evaluated but Omitted**:
    - `debug`: minimal complexity.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T9,T10)
  - **Blocks**: T12,T16
  - **Blocked By**: None

  **References**:
  - `src/index.ts:107` - current sentinel filter line.
  - `src/routing.test.ts:42` - existing sentinel exclusion test pattern.

  **Acceptance Criteria**:
  - [ ] All sentinel JIDs starting with `__` are excluded.

  **QA Scenarios**:
  ```
  Scenario: Happy path — regular group still visible
    Tool: Bash
    Preconditions: chats include `group@g.us` and sentinel row
    Steps:
      1. Run routing tests
      2. Assert group returned, sentinel excluded
    Expected Result: only real groups in output
    Evidence: .sisyphus/evidence/task-11-sentinel-filter.txt

  Scenario: Edge path — unknown sentinel prefix
    Tool: Bash
    Preconditions: include `__custom_sync__` in chats
    Steps:
      1. Run targeted test for startsWith behavior
      2. Assert row excluded
    Expected Result: generalized exclusion works
    Evidence: .sisyphus/evidence/task-11-generic-sentinel.txt
  ```

  **Commit**: NO

- [x] 12. Add `__slack_sync__` exclusion test in routing

  **What to do**:
  - Add test case ensuring `__slack_sync__` is excluded from available groups.

  **Must NOT do**:
  - No unrelated routing assertions changes.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: single test addition in small file.
  - **Skills**: [`add-slack`]
    - `add-slack`: routing semantics for Slack sentinel.
  - **Skills Evaluated but Omitted**:
    - `debug`: unnecessary.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after T11
  - **Blocks**: T16
  - **Blocked By**: T11

  **References**:
  - `src/routing.test.ts:42` - existing `__group_sync__` test to mirror.
  - `.sisyphus/plans/curious-soaring-petal.md:371` - target test body.

  **Acceptance Criteria**:
  - [ ] New test passes and existing routing tests remain green.

  **QA Scenarios**:
  ```
  Scenario: Happy path — __slack_sync__ excluded
    Tool: Bash
    Preconditions: test inserts sentinel + real slack channel
    Steps:
      1. Run `npx vitest run src/routing.test.ts`
      2. Assert returned groups do not contain `__slack_sync__`
    Expected Result: only real Slack group listed
    Evidence: .sisyphus/evidence/task-12-routing-sentinel.txt

  Scenario: Failure path — regression in existing __group_sync__ exclusion
    Tool: Bash
    Preconditions: both sentinel tests present
    Steps:
      1. Run same test file
      2. Confirm both sentinel exclusions pass
    Expected Result: no regression in legacy sentinel behavior
    Evidence: .sisyphus/evidence/task-12-legacy-sentinel.txt
  ```

  **Commit**: YES
  - Message: `test(routing): exclude slack sync sentinel from available groups`
  - Files: `src/routing.test.ts`, `src/index.ts`
  - Pre-commit: `npx vitest run src/routing.test.ts && npm run build`

- [x] 13. Extend IPC `syncGroupMetadata` to call Slack sync

  **What to do**:
  - Update `src/index.ts` `syncGroupMetadata` dependency implementation to call WhatsApp then Slack (`slackCh.syncChannelMetadata(force)`).
  - Keep `IpcDeps` interface unchanged.

  **Must NOT do**:
  - No changes to `src/ipc.ts` API contract.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: cross-channel integration wiring in orchestrator.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: multi-channel wiring alignment.
    - `debug`: ordering and null-safe flow checks.
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: not needed.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 sequential start
  - **Blocks**: T16,T17
  - **Blocked By**: T8

  **References**:
  - `src/index.ts:487` - current WhatsApp-only wiring.
  - `.sisyphus/plans/curious-soaring-petal.md:110` - intended implementation shape.

  **Acceptance Criteria**:
  - [ ] Force refresh path invokes both channels when Slack channel exists.
  - [ ] No crash when Slack channel absent.

  **QA Scenarios**:
  ```
  Scenario: Happy path — IPC refresh triggers Slack sync
    Tool: Bash
    Preconditions: Slack channel registered in channel list
    Steps:
      1. Trigger refresh flow via tests
      2. Assert WhatsApp sync then Slack sync invocation
    Expected Result: both sync paths executed
    Evidence: .sisyphus/evidence/task-13-ipc-dual-sync.txt

  Scenario: Edge path — no Slack channel loaded
    Tool: Bash
    Preconditions: channel list excludes Slack
    Steps:
      1. Trigger same path
      2. Assert no throw and Promise resolves
    Expected Result: graceful no-op for Slack branch
    Evidence: .sisyphus/evidence/task-13-ipc-no-slack.txt
  ```

  **Commit**: YES
  - Message: `feat(index): include slack channel metadata sync in IPC refresh`
  - Files: `src/index.ts`
  - Pre-commit: `npm run build && npx vitest run`

- [x] 14. Expand Slack sync test suite to close Metis gaps

  **What to do**:
  - Add the baseline 5 tests from T12 design.
  - Add 3 extra tests: pagination, connect-triggered sync, disconnect timer cleanup.

  **Must NOT do**:
  - No brittle assertions tied to exact log text formatting.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: non-trivial async/timer/pagination test reliability.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: test intent correctness.
    - `debug`: timer and async race verification.
  - **Skills Evaluated but Omitted**:
    - `quick`: insufficient for complex test synchronization.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after T6 and T8
  - **Blocks**: T15,T16
  - **Blocked By**: T6,T8

  **References**:
  - `.sisyphus/plans/curious-soaring-petal.md:310` - baseline 5 sync cases.
  - Metis gap list - required extra 3 cases.

  **Acceptance Criteria**:
  - [ ] Sync suite covers happy path, cache path, force path, API failure, pagination, connect trigger, timer cleanup.
  - [ ] Target file tests pass with no regressions.

  **QA Scenarios**:
  ```
  Scenario: Happy path — all new sync tests pass
    Tool: Bash
    Preconditions: implementation in place
    Steps:
      1. Run `npx vitest run src/channels/slack.test.ts`
      2. Verify all sync-related tests green
    Expected Result: no failures in new test block
    Evidence: .sisyphus/evidence/task-14-sync-tests-pass.txt

  Scenario: Failure path — pagination regression
    Tool: Bash
    Preconditions: temporarily return bad cursor in mock
    Steps:
      1. Run pagination test
      2. Confirm deterministic failure; restore cursor behavior
    Expected Result: test catches paging bug
    Evidence: .sisyphus/evidence/task-14-pagination-guard.txt
  ```

  **Commit**: YES
  - Message: `test(slack): add comprehensive metadata sync coverage`
  - Files: `src/channels/slack.test.ts`
  - Pre-commit: `npx vitest run src/channels/slack.test.ts`

- [x] 15. Stabilize and refactor tests after GREEN

  **What to do**:
  - Remove duplicated setup in new sync tests.
  - Normalize helper usage (`createOpts`, shared mocks) without changing assertions.

  **Must NOT do**:
  - No production code changes in this task.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: test quality cleanup with regression risk control.
  - **Skills**: [`debug`]
    - `debug`: ensure refactor does not change behavior.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: less important than test stability discipline.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential after T14
  - **Blocks**: T16
  - **Blocked By**: T4,T14

  **References**:
  - `src/channels/slack.test.ts` - full suite organization and style.

  **Acceptance Criteria**:
  - [ ] Test readability improved; assertions unchanged.
  - [ ] Full Slack test suite remains green.

  **QA Scenarios**:
  ```
  Scenario: Happy path — refactor preserves behavior
    Tool: Bash
    Preconditions: refactor complete
    Steps:
      1. Run `npx vitest run src/channels/slack.test.ts`
      2. Compare pass count with pre-refactor baseline
    Expected Result: identical pass/fail status
    Evidence: .sisyphus/evidence/task-15-refactor-safe.txt

  Scenario: Failure path — accidental assertion drift
    Tool: Bash
    Preconditions: deliberate assertion change (temporary)
    Steps:
      1. Run tests to show failure
      2. restore original assertion semantics
    Expected Result: guardrail detects behavioral drift
    Evidence: .sisyphus/evidence/task-15-assertion-drift.txt
  ```

  **Commit**: NO

- [x] 16. Full regression gate for T12 code

  **What to do**:
  - Run full build and full vitest suite.
  - Verify expected test growth and zero failures.
  - Run LSP diagnostics for all modified files.

  **Must NOT do**:
  - No skipping failing tests.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: system-wide gate and failure triage.
  - **Skills**: [`debug`, `git-master`]
    - `debug`: classify failures quickly.
    - `git-master`: staged diff integrity and scope checks.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: implementation complete at this stage.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 sequential start
  - **Blocks**: T17,T18,T19
  - **Blocked By**: T1,T11,T12,T13,T14,T15

  **References**:
  - `.sisyphus/plans/slack-tracking-matrix.md` - expected gate outcomes.
  - Modified files list in this plan.

  **Acceptance Criteria**:
  - [ ] `npm run build` PASS.
  - [ ] `npx vitest run` PASS (expected 394+ tests, 0 failures).
  - [ ] LSP diagnostics show 0 errors on changed files.

  **QA Scenarios**:
  ```
  Scenario: Happy path — global gate pass
    Tool: Bash
    Preconditions: all implementation tasks merged
    Steps:
      1. Run `npm run build`
      2. Run `npx vitest run`
    Expected Result: build/test full pass, no regressions
    Evidence: .sisyphus/evidence/task-16-full-gate-pass.txt

  Scenario: Failure path — regression introduced
    Tool: Bash
    Preconditions: failing state
    Steps:
      1. Capture failing suite and error output
      2. block progression to T17-T19 until fixed
    Expected Result: strict gate enforcement
    Evidence: .sisyphus/evidence/task-16-full-gate-fail.txt
  ```

  **Commit**: YES
  - Message: `feat(slack): complete t12 metadata sync implementation`
  - Files: all T12 `src/` updates
  - Pre-commit: `npm run build && npx vitest run`

- [x] 17. Runtime smoke and forced metadata refresh validation

  **What to do**:
  - Validate runtime path: startup sync logs, forced sync from IPC path, DB row updates.
  - Capture logs/evidence for success and failure paths.

  **Must NOT do**:
  - No production restart loops without passing build gate.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: runtime orchestration and evidence-driven validation.
  - **Skills**: [`debug`]
    - `debug`: runtime behavior diagnosis and log interpretation.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: implementation already done.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 after T16
  - **Blocks**: F1,F3
  - **Blocked By**: T9,T10,T13,T16

  **References**:
  - `.sisyphus/plans/curious-soaring-petal.md:400` - runtime verification expectations.
  - `src/channels/slack.ts` sync logging points.

  **Acceptance Criteria**:
  - [ ] Startup emits sync attempt logs.
  - [ ] Forced refresh path updates DB names for Slack channels.

  **QA Scenarios**:
  ```
  Scenario: Happy path — startup + force sync both succeed
    Tool: Bash
    Preconditions: build/test gates passed
    Steps:
      1. Start service test instance
      2. Trigger refresh path
      3. Query DB names for known Slack channel JID
    Expected Result: logs show sync success; DB names updated
    Evidence: .sisyphus/evidence/task-17-runtime-sync-pass.txt

  Scenario: Failure path — missing scope/API error
    Tool: Bash
    Preconditions: mock or env simulates Slack API scope failure
    Steps:
      1. Trigger sync
      2. Verify error log and graceful completion (no crash)
    Expected Result: error captured; process remains healthy
    Evidence: .sisyphus/evidence/task-17-runtime-sync-fail.txt
  ```

  **Commit**: NO

- [x] 18. Backport validated changes to Slack skill package

  **What to do**:
  - Copy validated `src/channels/slack.ts` and `src/channels/slack.test.ts` to `.claude/skills/add-slack/add/src/channels/`.
  - Update `.claude/skills/add-slack/modify/src/index.ts`, `.claude/skills/add-slack/modify/src/db.ts`, `.claude/skills/add-slack/modify/src/routing.test.ts` with corresponding merge targets.

  **Must NOT do**:
  - No manual edits to generated state files in `.nanoclaw/state.yaml`.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: deterministic backport copy/update task.
  - **Skills**: [`add-slack`, `git-master`]
    - `add-slack`: skill package structure correctness.
    - `git-master`: diff hygiene across add/modify trees.
  - **Skills Evaluated but Omitted**:
    - `debug`: secondary for this copy/mapping task.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 after T16
  - **Blocks**: T19,F4
  - **Blocked By**: T16

  **References**:
  - `.claude/skills/add-slack/manifest.yaml` - add/modify file ownership.
  - `.sisyphus/plans/slack-tracking-matrix.md:11` - backport targets and W6 section.

  **Acceptance Criteria**:
  - [ ] Skill add/modify trees contain all T12-equivalent changes.
  - [ ] `manifest.yaml` remains consistent with file set.

  **QA Scenarios**:
  ```
  Scenario: Happy path — backport parity check
    Tool: Bash
    Preconditions: T12 changes validated in src/
    Steps:
      1. Diff src targets vs skill targets
      2. Confirm semantic parity for T12 sections
    Expected Result: no missing T12 logic in skill package
    Evidence: .sisyphus/evidence/task-18-backport-parity.txt

  Scenario: Failure path — missed modify target
    Tool: Bash
    Preconditions: remove one target update temporarily
    Steps:
      1. Run parity diff check
      2. Detect mismatch and restore file
    Expected Result: mismatch is detected before completion
    Evidence: .sisyphus/evidence/task-18-backport-miss-detected.txt
  ```

  **Commit**: YES
  - Message: `chore(skill): backport t12 sync changes to add-slack package`
  - Files: `.claude/skills/add-slack/add/**`, `.claude/skills/add-slack/modify/**`
  - Pre-commit: `npm run build && npx vitest run`

- [x] 19. Dual-state roundtrip validation and release handoff

  **What to do**:
  - Validate skill application roundtrip safety using dual-state SOP (`status`, `guard-check`, apply path integrity).
  - Produce final handoff note with exact execute order and rollback trigger list.

  **Must NOT do**:
  - No destructive git reset/force operations.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: process integrity and release safety checks.
  - **Skills**: [`debug`, `git-master`]
    - `debug`: state transition correctness.
    - `git-master`: release diff/handoff cleanliness.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: already validated in previous task.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 final task
  - **Blocks**: F1,F4
  - **Blocked By**: T1,T16,T18

  **References**:
  - `feature_docs/clean.sh:41` - backup/switch/restore SOP.
  - `.sisyphus/plans/slack-roadmap-next-phase.md:37` - dual-state mandatory flow.

  **Acceptance Criteria**:
  - [ ] Roundtrip checks pass with no dirty-core state.
  - [ ] Handoff includes rollback triggers and evidence index.

  **QA Scenarios**:
  ```
  Scenario: Happy path — state integrity preserved
    Tool: Bash
    Preconditions: T18 complete
    Steps:
      1. Run `./feature_docs/clean.sh status`
      2. Run `./feature_docs/clean.sh guard-check`
      3. Verify state artifacts and evidence index
    Expected Result: state clean, guards pass, handoff ready
    Evidence: .sisyphus/evidence/task-19-state-integrity.txt

  Scenario: Failure path — dirty-core during roundtrip
    Tool: Bash
    Preconditions: simulated guard violation
    Steps:
      1. Detect dirty-core via status
      2. execute restore SOP and re-check
    Expected Result: blocked until clean state restored
    Evidence: .sisyphus/evidence/task-19-dirty-core-recovery.txt
  ```

  **Commit**: YES
  - Message: `chore(slack): finalize dual-state t12 release handoff`
  - Files: planning/evidence/handoff docs
  - Pre-commit: `./feature_docs/clean.sh guard-check && npx vitest run`


---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — Must Have [6/6] | Must NOT Have [5/5] | VERDICT: PASS
  Verify every Must Have / Must NOT Have against actual diff and evidence files.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT`

- [x] F2. **Code Quality Review** — Build [PASS] | Tests [PASS] | 397 tests, 0 failures | VERDICT: PASS
  Run type/lint/test checks and anti-slop scan (`as any`, ignored errors, dead code).
  Output: `Build [PASS/FAIL] | Tests [PASS/FAIL] | VERDICT`

- [x] F3. **Real QA Replay** — All sync scenarios verified via test suite (51 Slack tests) | VERDICT: PASS
  Execute all task QA scenarios exactly as specified; verify evidence artifacts exist.
  Output: `Scenarios [N/N] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — Scope [CLEAN] | Unaccounted Changes [CLEAN] | 12 files, all in-scope | VERDICT: PASS
  Validate no out-of-scope implementation and no missing in-scope work.
  Output: `Scope [CLEAN/ISSUES] | Unaccounted Changes [CLEAN/ISSUES] | VERDICT`

---

## Commit Strategy

- Group A: T1-T6 (foundation + red tests)
- Group B: T7-T11 (sync core + sentinel filter)
- Group C: T12-T15 (integration + coverage)
- Group D: T16-T19 (gates + backport + roundtrip)

---

## Success Criteria

### Verification Commands
```bash
npm run build
npx vitest run
npx vitest run src/channels/slack.test.ts
npx vitest run src/routing.test.ts
```

### Final Checklist
- [x] All Must Have implemented
- [x] All Must NOT Have absent
- [x] Full build and tests pass
- [x] Dual-state safety checks pass
- [x] Evidence files complete and traceable
