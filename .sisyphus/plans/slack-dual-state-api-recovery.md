# Slack Dual-State API Recovery Plan

## TL;DR

> Quick Summary: Implement a Slack-focused dual-state recovery model so retry exhaustion discards only the currently failing workload window, then guarantees forward progress for future messages after upstream API recovery.
>
> Deliverables:
> - Deterministic NORMAL <-> EXHAUSTED_DROP state transitions in queue/orchestrator
> - Cursor policy that drops exhausted window without orphaning future traffic
> - Slack watchdog/queue decoupling and recovery bridge
> - Full test coverage for exhaustion, discard, and post-recovery new-message processing
>
> Estimated Effort: Medium
> Parallel Execution: YES - 3 waves
> Critical Path: 1 -> 2 -> 7 -> 8 -> 12 -> 15

---

## Context

### Original Request
Fix the resilience bug where API-quota/outage errors are expected, but after API recovery the Slack path can become unresponsive. Constraint update: after 5 retries are exhausted, do not permanently orphan a group; discard the just-failed workload window, and ensure future new messages are handled normally after recovery.

### Interview Summary

Key Discussions:
- Scope is Slack integration behavior (not WhatsApp reconnect analysis).
- Current retry budget is 5 attempts with 5/10/20/40/80s backoff.
- Desired behavior is explicit forward progress: stale exhausted workload is dropped, future traffic is not blocked.
- Plan must follow the dual-state development style used in `@.sisyphus/plans/slack-roadmap-next-phase.md`.

Research Findings:
- `src/group-queue.ts` (`scheduleRetry`, `drainGroup`, `pendingMessages`, `retryCount`) controls retry/exhaustion behavior.
- `src/index.ts` (`processGroupMessages`, `lastAgentTimestamp`, rollback logic) controls replay/drop semantics.
- `src/channels/slack.ts` watchdog (`startWatchdog`) can reconnect and eventually breaker-exit via `process.exit(1)`.
- Current tests cover retry/backoff and watchdog basics, but not full discard-window + post-recovery forward-progress semantics.

### Metis Review

Identified Gaps (addressed in this plan):
- Missing precise definition of discard granularity at retry exhaustion.
- Missing explicit guardrails for cursor advancement vs rollback in exhaustion path.
- Missing anti-replay-storm invariant when new messages arrive during/after exhaustion.
- Missing strong acceptance criteria around no-orphan recovery and Slack no-silent-failure.
- Missing rollout sequencing and observability requirements for production confidence.

---

## Work Objectives

### Core Objective
Implement a robust dual-state outage recovery flow that prevents permanent group orphaning, discards only exhausted stale workloads, and restores normal handling for new Slack messages once the upstream API is healthy.

### Concrete Deliverables
- Runtime dual-state model and transition guards implemented in queue/orchestrator.
- Exhaustion-time cursor discard policy implemented and persisted.
- Slack watchdog/queue recovery bridge implemented without tight coupling.
- Deterministic tests for retry exhaustion, discard, and post-recovery processing.
- Operator-facing observability and canary/rollback guidance.

### Definition of Done
- [ ] Retry exhaustion discards only frozen failing window and does not replay it.
- [ ] New messages after recovery are processed without manual restart.
- [ ] No group remains permanently orphaned after exhaustion.
- [ ] Slack reconnect/recovery does not create queue deadlock or replay storms.
- [ ] `npm test`, `npm run build`, and `npm run typecheck` pass.

### Must Have
- Explicit state transitions: NORMAL and EXHAUSTED_DROP.
- Exhaustion path persists cursor decision atomically.
- Queue behavior remains channel-agnostic while adding Slack-specific recovery hooks.
- Structured logs for exhaustion entry, drop commit, and recovery clear.

### Policy Defaults (Applied)
- Discard granularity: full frozen failing workload window (`windowStart` -> `windowEnd`).
- User-facing discard notice: disabled by default (log/telemetry only in this phase).
- Policy applicability: interactive message loop + IPC-triggered + scheduler-triggered runs share the same exhaustion/drop semantics unless explicitly exempted in tests.

### Must NOT Have (Guardrails)
- No permanent replay of exhausted stale workloads.
- No silent success marking when Slack delivery actually failed.
- No direct watchdog-to-queue hard coupling that can deadlock processing.
- No scope creep into unrelated WhatsApp/channel redesign.
- No unbounded retries or implicit infinite loops.

---

## Verification Strategy

> ZERO HUMAN INTERVENTION - ALL verification is agent-executed.

### Test Decision
- Infrastructure exists: YES
- Automated tests: YES (tests-after implementation per task)
- Framework: vitest + TypeScript build checks (`npm test`, `npm run build`, `npm run typecheck`)
- Agent-Executed QA: MANDATORY for every task

### QA Policy
Every task includes executable QA scenarios with explicit commands/selectors/assertions and evidence files under `.sisyphus/evidence/`.

- Frontend/UI: N/A for this scope
- CLI/TUI: `interactive_bash`/`Bash` where needed
- API/Backend/Module: `Bash` test/build commands and assertion checks
- Evidence naming: `task-{N}-{scenario-slug}.{ext}`

---

## Execution Strategy

### Dual-State Development Flow (Process Guardrail)

- undeployed (analysis/test design): define state model, contracts, and test vectors without rollout toggles enabled.
- deployed (implementation/verification): apply code changes, run full tests, execute failure-injection and recovery evidence capture.
- dirty-core (violation state): if changes drift outside planned scope, stop and reconcile before continuing.

### Runtime Dual-State Model (Feature Behavior)

- NORMAL: process frozen workload window with bounded retries.
- EXHAUSTED_DROP: on retry budget exhaustion, discard only current frozen window, commit cursor, clear retry metadata, and wait for recovery/new-work path.

### Parallel Execution Waves

```text
Wave 1 (Foundation contracts + scaffolding):
- T1 Runtime state contracts + config knobs
- T2 Group queue state fields and transition primitives
- T3 Orchestrator processing outcome contract in index
- T4 DB bounded-window helpers for retry/discard semantics
- T5 Slack recovery hook contract and callback surface
- T6 Structured observability schema/events baseline

Wave 2 (Core behavior implementation):
- T7 Queue admission gate + exhaustion transition logic
- T8 Cursor rollback/advance/discard commit logic in process pipeline
- T9 Slack watchdog-recovery -> queue clear bridge
- T10 Startup/periodic recovery scan to prevent orphaned groups
- T11 Slack delivery truthfulness and no-silent-success handling

Wave 3 (Validation + rollout readiness):
- T12 Queue tests: exhaustion, drop, forward-progress
- T13 Index tests: cursor policy and outcome matrix
- T14 Slack tests: reconnect/delivery/recovery coupling
- T15 Failure-injection integration test: outage -> exhaust -> recover -> new message
- T16 Ops docs + canary + rollback checklist update

Wave FINAL (Independent verification in parallel):
- F1 Plan compliance audit
- F2 Code quality and build/test hygiene review
- F3 Real QA replay of all task scenarios
- F4 Scope fidelity and contamination check
```

### Dependency Matrix (All Tasks)

- T1: blocked by none; blocks T2, T3, T5, T7, T8
- T2: blocked by T1; blocks T7, T9, T12
- T3: blocked by T1; blocks T8, T10, T11, T13
- T4: blocked by none; blocks T8, T13, T15
- T5: blocked by T1; blocks T9, T11, T14
- T6: blocked by none; blocks T7, T8, T9, T10, T11, T16
- T7: blocked by T2, T6; blocks T8, T9, T10, T12, T15
- T8: blocked by T3, T4, T6, T7; blocks T13, T15
- T9: blocked by T2, T5, T6, T7; blocks T14, T15
- T10: blocked by T3, T6, T7; blocks T15
- T11: blocked by T3, T5, T6; blocks T14, T15
- T12: blocked by T7; blocks T15
- T13: blocked by T4, T8; blocks T15
- T14: blocked by T9, T11; blocks T15
- T15: blocked by T7, T8, T9, T10, T11, T12, T13, T14; blocks T16, FINAL
- T16: blocked by T6, T15; blocks FINAL

### Agent Dispatch Summary

- Wave 1: T1 quick, T2 unspecified-high, T3 deep, T4 quick, T5 unspecified-high, T6 writing
- Wave 2: T7 deep, T8 deep, T9 unspecified-high, T10 quick, T11 unspecified-high
- Wave 3: T12 quick, T13 deep, T14 unspecified-high, T15 deep, T16 writing
- FINAL: F1 oracle, F2 unspecified-high, F3 unspecified-high, F4 deep

---

## TODOs

- [ ] 1. Define Dual-State Contracts and Recovery Config

  **What to do**:
  - Add explicit runtime contract types for recovery state and delivery outcome in `src/types.ts`.
  - Add recovery knobs in `src/config.ts` (exhaustion gate window, optional periodic recovery interval) with safe defaults and env parsing.
  - Add/extend config tests to prove invalid env values fall back to defaults.

  **Must NOT do**:
  - Do not change queue runtime behavior in this task.
  - Do not introduce channel-specific logic into shared type definitions.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: small, bounded contract/config changes across 2-3 files.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: aligns naming/contracts with existing Slack integration style.
    - `debug`: avoids subtle env parsing regressions.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: no UI scope.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2-T6)
  - **Blocks**: T2, T3, T5, T7, T8
  - **Blocked By**: None

  **References**:
  - `src/types.ts` - shared channel/queue contracts to extend without breaking interface shape.
  - `src/config.ts` - existing timeout/backoff parsing style to mirror for new recovery knobs.
  - `src/channels/slack.ts` - consumer of channel contracts; validate compatibility.

  **Acceptance Criteria**:
  - [ ] Recovery state/outcome contract types are exported and compile.
  - [ ] Recovery config values parse from env with deterministic defaults.
  - [ ] Invalid env values are normalized to defaults (tested).
  - [ ] `npm run typecheck` passes.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Recovery contracts compile and are consumable
    Tool: Bash
    Preconditions: Task implementation complete
    Steps:
      1. Run `npm run typecheck`.
      2. Run `npm test -- src/config.test.ts -t "recovery config defaults"`.
      3. Confirm test output includes PASS for fallback/default assertions.
    Expected Result: Typecheck succeeds and config fallback test passes.
    Failure Indicators: Type errors in type exports; config test fails on invalid env fallback.
    Evidence: .sisyphus/evidence/task-1-contracts-config.txt

  Scenario: Invalid env input is safely rejected
    Tool: Bash
    Preconditions: Config tests include invalid numeric env case
    Steps:
      1. Run `RECOVERY_EXHAUSTED_GATE_MS=bad npm test -- src/config.test.ts -t "falls back on invalid"`.
      2. Verify reported parsed value equals default in assertion output.
    Expected Result: Invalid value does not crash and default is applied.
    Evidence: .sisyphus/evidence/task-1-invalid-env.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-1-contracts-config.txt`
  - [ ] `.sisyphus/evidence/task-1-invalid-env.txt`

  **Commit**: NO

- [ ] 2. Add Queue State Primitives for NORMAL and EXHAUSTED_DROP

  **What to do**:
  - Extend `GroupState` in `src/group-queue.ts` with dual-state metadata (state marker, frozen window metadata, exhaustion marker).
  - Add internal helper primitives for entering/exiting exhausted-drop state, without changing retry semantics yet.
  - Add unit tests validating state primitive transitions and initialization defaults.

  **Must NOT do**:
  - Do not implement cursor advancement/rollback policy in this task.
  - Do not wire Slack watchdog callbacks yet.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: core queue state model change with invariants.
  - **Skills**: [`debug`]
    - `debug`: critical for state-machine correctness and race avoidance.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: queue is channel-agnostic core logic.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3-T6)
  - **Blocks**: T7, T9, T12
  - **Blocked By**: T1

  **References**:
  - `src/group-queue.ts` - source of `GroupState`, `enqueueMessageCheck`, `scheduleRetry`, `drainGroup` transitions.
  - `src/group-queue.test.ts` - current retry/backoff expectations to preserve while adding new primitives.

  **Acceptance Criteria**:
  - [ ] `GroupState` contains explicit dual-state metadata with sane defaults.
  - [ ] Primitive transition helpers exist and are unit tested.
  - [ ] Existing queue tests remain green.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: State primitives transition correctly
    Tool: Bash
    Preconditions: New queue primitive tests added
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "state primitives"`.
      2. Run `npm test -- src/group-queue.test.ts -t "initial state defaults"`.
      3. Verify both tests pass and no baseline queue tests regress.
    Expected Result: Transition and default tests pass; no regressions.
    Failure Indicators: stale state markers, failed assertions, or baseline retry tests breaking.
    Evidence: .sisyphus/evidence/task-2-state-primitives.txt

  Scenario: Invalid transition is rejected
    Tool: Bash
    Preconditions: Guard test for illegal transition exists
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "reject illegal exhausted transition"`.
      2. Confirm assertion verifies no mutation to active processing state.
    Expected Result: Illegal transition path does not mutate queue state.
    Evidence: .sisyphus/evidence/task-2-invalid-transition.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-2-state-primitives.txt`
  - [ ] `.sisyphus/evidence/task-2-invalid-transition.txt`

  **Commit**: NO

- [ ] 3. Introduce Orchestrator Outcome Contract for Success/Retry/Discard

  **What to do**:
  - Refactor `processGroupMessages` flow in `src/index.ts` to produce explicit outcome semantics needed by queue/exhaustion handling.
  - Keep backward compatibility with existing queue boolean API by adding a transitional adapter.
  - Add focused tests validating outcome mapping from agent run states (success, retryable error, discard candidate).

  **Must NOT do**:
  - Do not change final cursor behavior yet (that belongs to T8).
  - Do not modify Slack channel transport code in this task.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: central orchestrator control-flow change with high blast radius.
  - **Skills**: [`debug`]
    - `debug`: needed to preserve existing behavior while introducing explicit outcomes.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: task is orchestrator-level, not Slack-specific implementation.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T4-T6)
  - **Blocks**: T8, T10, T11, T13
  - **Blocked By**: T1

  **References**:
  - `src/index.ts` - `processGroupMessages`, `runAgent`, cursor rollback path, and queue handoff points.
  - `src/db.ts` - `getMessagesSince` and `hasBotResponseAfter` behavior that influences outcome mapping.

  **Acceptance Criteria**:
  - [ ] Outcome mapping is explicit and deterministic for success/retry/discard candidate paths.
  - [ ] Transitional adapter preserves current queue integration compatibility.
  - [ ] Existing message-loop behavior remains stable in baseline tests.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Outcome mapping works for success and retry
    Tool: Bash
    Preconditions: New orchestrator outcome tests added
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "maps success and retry outcomes"`.
      2. Verify test logs/assertions show expected outcome enum/value for each fixture.
    Expected Result: Success and retry paths map exactly to expected outcomes.
    Failure Indicators: ambiguous/incorrect outcome mapping, fallback to legacy bool without adapter coverage.
    Evidence: .sisyphus/evidence/task-3-outcome-mapping.txt

  Scenario: Discard-candidate path is detectable without cursor mutation
    Tool: Bash
    Preconditions: Dedicated discard-candidate test exists
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "detects discard candidate"`.
      2. Confirm assertion validates detection without applying cursor commit yet.
    Expected Result: Discard candidate is identified, but no drop commit is executed in this task.
    Evidence: .sisyphus/evidence/task-3-discard-candidate.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-3-outcome-mapping.txt`
  - [ ] `.sisyphus/evidence/task-3-discard-candidate.txt`

  **Commit**: NO

- [ ] 4. Add Bounded-Window DB Helpers for Retry and Drop Semantics

  **What to do**:
  - Add explicit DB helper(s) in `src/db.ts` to query/process a frozen window (`windowStart`, `windowEnd`) instead of open-ended replay only.
  - Add DB-level tests for window boundaries (`> windowStart` and `<= windowEnd`) and bot-message exclusion behavior.
  - Keep existing query helpers intact for backward compatibility.

  **Must NOT do**:
  - Do not remove existing `getMessagesSince` usages yet.
  - Do not alter scheduler/task tables in this task.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: isolated DB helper and deterministic boundary tests.
  - **Skills**: [`debug`]
    - `debug`: boundary inclusivity mistakes are high-risk and subtle.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: helper is storage-level, channel-agnostic.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1-T3, T5, T6)
  - **Blocks**: T8, T13, T15
  - **Blocked By**: None

  **References**:
  - `src/db.ts` - existing `getMessagesSince`/`getNewMessages` query style and filtering constraints.
  - `src/index.ts` - consumer path that needs bounded-window semantics for discard precision.

  **Acceptance Criteria**:
  - [ ] Window helper returns exactly the intended timestamp interval.
  - [ ] Bot messages remain excluded consistently.
  - [ ] Existing DB query behavior is not regressed.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Window query returns only frozen workload
    Tool: Bash
    Preconditions: DB helper tests include mixed timestamps around boundaries
    Steps:
      1. Run `npm test -- src/db.test.ts -t "window query boundaries"`.
      2. Verify assertions pass for inclusive upper bound and exclusive lower bound.
    Expected Result: Returned rows match only the frozen workload interval.
    Failure Indicators: rows outside window, off-by-one timestamp behavior.
    Evidence: .sisyphus/evidence/task-4-window-boundary.txt

  Scenario: Bot-message filtering remains intact in window mode
    Tool: Bash
    Preconditions: DB fixture includes bot and non-bot rows in same window
    Steps:
      1. Run `npm test -- src/db.test.ts -t "window excludes bot messages"`.
      2. Confirm only user rows are returned.
    Expected Result: Bot-tagged rows are excluded.
    Evidence: .sisyphus/evidence/task-4-window-bot-filter.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-4-window-boundary.txt`
  - [ ] `.sisyphus/evidence/task-4-window-bot-filter.txt`

  **Commit**: NO

- [ ] 5. Add Slack Recovery Hook Contract in Channel Layer

  **What to do**:
  - Extend Slack channel options/contract in `src/channels/slack.ts` to expose a recovery callback when reconnect succeeds.
  - Add unit tests asserting callback invocation on successful watchdog reconnect, and no invocation on failed reconnect.
  - Keep Slack reconnect logic ownership in channel layer.

  **Must NOT do**:
  - Do not clear queue state directly from inside `SlackChannel`.
  - Do not change queue retry/discard logic in this task.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: transport-layer recovery signal with race-sensitive behavior.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: follows existing Slack integration conventions.
    - `debug`: needed for reconnect edge-case correctness.
  - **Skills Evaluated but Omitted**:
    - `x-integration`: unrelated channel domain.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1-T4, T6)
  - **Blocks**: T9, T11, T14
  - **Blocked By**: T1

  **References**:
  - `src/channels/slack.ts` - `startWatchdog`, reconnect success/failure and breaker paths.
  - `src/channels/slack.test.ts` - existing watchdog and reconnect coverage to extend.
  - `src/types.ts` - channel callback contract consistency.

  **Acceptance Criteria**:
  - [ ] Recovery callback contract is defined and backward compatible.
  - [ ] Callback fires exactly on successful reconnect path.
  - [ ] Callback does not fire on failed reconnect attempts.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Successful watchdog reconnect emits recovery callback
    Tool: Bash
    Preconditions: Slack watchdog reconnect test updated with callback spy
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "invokes onHealthRecovered on reconnect"`.
      2. Verify callback invocation count equals 1 for success case.
    Expected Result: Recovery callback fires once on successful reconnect.
    Failure Indicators: callback never called or called multiple times per reconnect cycle.
    Evidence: .sisyphus/evidence/task-5-recovery-callback-success.txt

  Scenario: Failed reconnect does not emit recovery callback
    Tool: Bash
    Preconditions: Slack reconnect-failure fixture present
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "does not invoke onHealthRecovered on failure"`.
      2. Verify callback invocation count remains 0.
    Expected Result: No false recovery signal on reconnect failure.
    Evidence: .sisyphus/evidence/task-5-recovery-callback-failure.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-5-recovery-callback-success.txt`
  - [ ] `.sisyphus/evidence/task-5-recovery-callback-failure.txt`

  **Commit**: NO

- [ ] 6. Introduce Structured Recovery Observability Schema

  **What to do**:
  - Define and apply structured event fields for exhaustion/discard/recovery logs across `src/group-queue.ts`, `src/index.ts`, and `src/channels/slack.ts`.
  - Add tests that assert key log fields are present for critical transitions.
  - Ensure event naming is stable for canary alert rules.

  **Must NOT do**:
  - Do not add external metrics infrastructure in this task.
  - Do not alter retry algorithm behavior yet.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: taxonomy consistency and log contract clarity across modules.
  - **Skills**: [`debug`]
    - `debug`: validates event-field correctness and avoids misleading telemetry.
  - **Skills Evaluated but Omitted**:
    - `artistry`: not needed for structured logging contract.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1-T5)
  - **Blocks**: T7, T8, T9, T10, T11, T16
  - **Blocked By**: None

  **References**:
  - `src/group-queue.ts` - exhaustion/backoff transition log points.
  - `src/index.ts` - cursor rollback/advance decision logs.
  - `src/channels/slack.ts` - watchdog/reconnect/breaker events.

  **Acceptance Criteria**:
  - [ ] Event names and required fields are documented in code-level constants/comments.
  - [ ] Critical transitions emit structured logs with stable keys.
  - [ ] Log-schema tests pass.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Exhaustion/discard/recovery events emit required fields
    Tool: Bash
    Preconditions: Logging tests capture structured logger calls
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "emits exhaustion log schema"`.
      2. Run `npm test -- src/channels/slack.test.ts -t "emits reconnect log schema"`.
      3. Verify expected keys (`event`, `groupJid`, `retryCount`, timestamps) are asserted.
    Expected Result: Structured event schemas are stable and complete.
    Failure Indicators: missing keys, inconsistent event naming, schema assertion failures.
    Evidence: .sisyphus/evidence/task-6-log-schema.txt

  Scenario: Unknown/partial log payload is rejected by tests
    Tool: Bash
    Preconditions: Negative schema test exists
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "rejects incomplete recovery event"`.
      2. Confirm test fails when required fields are omitted (in fixture mutation path).
    Expected Result: Schema tests detect malformed event payloads.
    Evidence: .sisyphus/evidence/task-6-log-schema-negative.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-6-log-schema.txt`
  - [ ] `.sisyphus/evidence/task-6-log-schema-negative.txt`

  **Commit**: YES (group with T1-T6)
  - Message: `feat(recovery): add dual-state scaffolding and contracts`
  - Files: `src/types.ts`, `src/config.ts`, `src/group-queue.ts`, `src/index.ts`, `src/db.ts`, `src/channels/slack.ts`, related tests
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 7. Implement Queue Admission Gate and Exhaustion Transition

  **What to do**:
  - Implement dual-state runtime behavior in `src/group-queue.ts`: NORMAL processing, EXHAUSTED_DROP gating after retry budget exhaustion.
  - Ensure exhaustion transition resets retry metadata safely and does not permanently orphan the group.
  - Ensure messages arriving during gate are tracked for future drain instead of triggering replay storms.
  - Add/extend queue tests for admission gate behavior.

  **Must NOT do**:
  - Do not commit cursor decisions in this task (T8 owns cursor commit logic).
  - Do not add channel-specific conditionals inside queue state transitions.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: state-machine behavior with retry timing and race sensitivity.
  - **Skills**: [`debug`]
    - `debug`: required for race-condition and timer sequencing correctness.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: queue logic must remain generic.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8-T11)
  - **Blocks**: T8, T9, T10, T12, T15
  - **Blocked By**: T2, T6

  **References**:
  - `src/group-queue.ts` - `enqueueMessageCheck`, `runForGroup`, `scheduleRetry`, `drainGroup`.
  - `src/group-queue.test.ts` - baseline retry/backoff and exhaustion expectations.
  - `src/index.ts` - upstream outcome/cursor interaction constraints.

  **Acceptance Criteria**:
  - [ ] Retry exhaustion transitions group into EXHAUSTED_DROP deterministically.
  - [ ] Group is not permanently orphaned; post-gate flow can resume.
  - [ ] No immediate replay loop of stale workload while gate is active.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Exhaustion enters gate and blocks immediate replay
    Tool: Bash
    Preconditions: Queue admission tests include exhaustion fixture
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "enters exhausted drop gate after max retries"`.
      2. Run `npm test -- src/group-queue.test.ts -t "blocks stale replay while gated"`.
      3. Verify call counts stop increasing without new eligible drain event.
    Expected Result: State enters gate and stale replay is blocked.
    Failure Indicators: continuous process loop after exhaustion or missing gate transition.
    Evidence: .sisyphus/evidence/task-7-gate-transition.txt

  Scenario: New pending message is preserved for future processing
    Tool: Bash
    Preconditions: test injects new message while gate active
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "retains pending message during gate"`.
      2. Verify pending flag/queue path indicates deferred processing, not discard.
    Expected Result: New message path remains resumable post-gate.
    Evidence: .sisyphus/evidence/task-7-pending-preserved.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-7-gate-transition.txt`
  - [ ] `.sisyphus/evidence/task-7-pending-preserved.txt`

  **Commit**: NO

- [ ] 8. Implement Cursor Rollback/Advance/Discard Commit Policy

  **What to do**:
  - Implement exhaustion-time discard commit in `src/index.ts` using bounded-window semantics from `src/db.ts`.
  - Preserve existing rollback behavior for retryable failures, and existing no-rollback behavior when output was truly delivered.
  - Persist cursor decisions atomically via existing state persistence path.
  - Add focused tests for cursor decision matrix.

  **Must NOT do**:
  - Do not discard messages newer than the frozen exhausted window.
  - Do not break `outputSentToUser` duplicate-prevention semantics.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: highest-risk data-loss/duplication logic in orchestrator.
  - **Skills**: [`debug`]
    - `debug`: protects against off-by-one/drop/duplicate regressions.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: logic is core cursor policy and must remain generic.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7, T9-T11)
  - **Blocks**: T13, T15
  - **Blocked By**: T3, T4, T6, T7

  **References**:
  - `src/index.ts` - cursor advance (`lastAgentTimestamp`), rollback, and `outputSentToUser` handling.
  - `src/db.ts` - message window query behavior and bot-response shortcut checks.
  - `src/group-queue.ts` - exhaustion state transitions that trigger discard commit eligibility.

  **Acceptance Criteria**:
  - [ ] Retryable error path still rolls back cursor.
  - [ ] Exhaustion path commits discard cursor exactly to frozen window end.
  - [ ] New messages after exhausted window remain processable.
  - [ ] Cursor decisions survive restart via persisted state.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Cursor matrix (success/retry/discard) behaves exactly as defined
    Tool: Bash
    Preconditions: Cursor matrix tests added in orchestrator suite
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "cursor matrix"`.
      2. Verify assertions for (a) success advance, (b) retry rollback, (c) exhaustion discard commit.
    Expected Result: All three cursor paths match policy with deterministic timestamps.
    Failure Indicators: stale window replayed, wrong commit timestamp, or duplicate-prone rollback drift.
    Evidence: .sisyphus/evidence/task-8-cursor-matrix.txt

  Scenario: Exhausted window discard does not consume newer messages
    Tool: Bash
    Preconditions: fixture with older exhausted window + newer post-window messages
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "discard keeps post-window messages"`.
      2. Confirm post-window messages remain pending/processable.
    Expected Result: Only exhausted window is dropped.
    Evidence: .sisyphus/evidence/task-8-window-scope.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-8-cursor-matrix.txt`
  - [ ] `.sisyphus/evidence/task-8-window-scope.txt`

  **Commit**: NO

- [ ] 9. Wire Slack Watchdog Recovery to Queue Gate Clear

  **What to do**:
  - In `src/index.ts`, wire Slack recovery callback to clear EXHAUSTED_DROP gate for `slack:` groups only.
  - Ensure callback is idempotent and safe under repeated reconnect events.
  - Add tests proving gate clear after reconnect resumes queued/pending message processing.

  **Must NOT do**:
  - Do not allow Slack callback to mutate non-Slack groups.
  - Do not bypass queue primitives by mutating private queue internals directly.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: cross-module coordination with race and idempotency requirements.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: channel-specific filter behavior (`slack:` JID ownership).
    - `debug`: reconnect callback timing and repeated event safety.
  - **Skills Evaluated but Omitted**:
    - `x-integration`: not this channel stack.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7, T8, T10, T11)
  - **Blocks**: T14, T15
  - **Blocked By**: T2, T5, T6, T7

  **References**:
  - `src/channels/slack.ts` - reconnect success path for health signal.
  - `src/index.ts` - channel construction and queue wiring points.
  - `src/group-queue.ts` - gate clear API used for state transition.

  **Acceptance Criteria**:
  - [ ] Slack reconnect success triggers queue gate clear for Slack groups.
  - [ ] Multiple reconnect success events do not produce duplicate drain side effects.
  - [ ] Non-Slack groups are unaffected by Slack recovery callback.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Reconnect success clears Slack gate and resumes processing
    Tool: Bash
    Preconditions: integration-style test with gated slack group and pending message
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "reconnect clears exhausted gate"`.
      2. Verify pending message processing resumes after callback.
    Expected Result: Slack group exits gate and pending message is processed.
    Failure Indicators: gate remains set, no processing resume, or duplicate resume calls.
    Evidence: .sisyphus/evidence/task-9-gate-clear.txt

  Scenario: Reconnect callback is idempotent
    Tool: Bash
    Preconditions: test emits two consecutive recovery callbacks
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "recovery callback idempotent"`.
      2. Confirm drain path executes once per pending workload, not per duplicate callback.
    Expected Result: Idempotent clear behavior under duplicate recovery signals.
    Evidence: .sisyphus/evidence/task-9-idempotent-clear.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-9-gate-clear.txt`
  - [ ] `.sisyphus/evidence/task-9-idempotent-clear.txt`

  **Commit**: NO

- [ ] 10. Add Periodic Recovery Scan to Prevent Long-Lived Orphans

  **What to do**:
  - Extend `src/index.ts` with periodic recovery scan (in addition to startup `recoverPendingMessages`) so long-running processes can recover deferred groups.
  - Ensure scan respects group/channel ownership and does not flood queue with duplicate enqueue requests.
  - Add tests for scan idempotency and no-orphan guarantee.

  **Must NOT do**:
  - Do not reintroduce continuous enqueue loops for exhausted groups.
  - Do not run aggressive high-frequency scans that create unnecessary load.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: limited orchestrator loop extension with guard conditions.
  - **Skills**: [`debug`]
    - `debug`: needed to avoid duplicate enqueue storms.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: scan logic is mostly orchestrator-level.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7-T9, T11)
  - **Blocks**: T15
  - **Blocked By**: T3, T6, T7

  **References**:
  - `src/index.ts` - startup `recoverPendingMessages` and message loop scheduling.
  - `src/group-queue.ts` - enqueue semantics and active/pending guard behavior.
  - `src/db.ts` - pending-message detection queries.

  **Acceptance Criteria**:
  - [ ] Periodic recovery scan enqueues recoverable groups without duplication storms.
  - [ ] Long-lived process can recover deferred groups without restart.
  - [ ] Recovery scan is configurable and bounded.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Periodic recovery enqueues deferred group exactly once
    Tool: Bash
    Preconditions: test fixture with deferred group and pending messages
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "periodic recovery enqueues once"`.
      2. Verify enqueue call count is 1 for one scan cycle.
    Expected Result: Recoverable group is enqueued once, not spammed.
    Failure Indicators: repeated enqueue flood or no enqueue at all.
    Evidence: .sisyphus/evidence/task-10-periodic-recovery.txt

  Scenario: Recovery scan skips empty groups safely
    Tool: Bash
    Preconditions: test fixture with zero pending messages
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "periodic recovery skips empty"`.
      2. Confirm no enqueue for empty groups.
    Expected Result: Empty groups are ignored without side effects.
    Evidence: .sisyphus/evidence/task-10-recovery-skip-empty.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-10-periodic-recovery.txt`
  - [ ] `.sisyphus/evidence/task-10-recovery-skip-empty.txt`

  **Commit**: NO

- [ ] 11. Enforce Slack Delivery Truthfulness (No Silent Success)

  **What to do**:
  - Update Slack delivery contract so send failures are observable to orchestrator decision logic (no false success when transport failed).
  - Ensure `outputSentToUser` is only set when delivery is actually confirmed for Slack path.
  - Add tests for disconnected Slack and API send failure paths.

  **Must NOT do**:
  - Do not break existing successful send behavior.
  - Do not convert transient delivery failures into process crashes.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: transport semantics directly influence cursor correctness.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: channel-specific send semantics and edge cases.
    - `debug`: avoids false positives in delivery success tracking.
  - **Skills Evaluated but Omitted**:
    - `writing`: this is runtime behavior, not docs-only.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7-T10)
  - **Blocks**: T14, T15
  - **Blocked By**: T3, T5, T6

  **References**:
  - `src/channels/slack.ts` - `sendMessage` currently logs failures and returns without throwing.
  - `src/index.ts` - streaming callback sets `outputSentToUser`; needs truthful signal input.
  - `src/channels/slack.test.ts` - existing send failure and reconnect coverage to extend.

  **Acceptance Criteria**:
  - [ ] Slack disconnected/send-failure path is surfaced as non-delivery to orchestrator.
  - [ ] `outputSentToUser` is not marked true on failed delivery.
  - [ ] Successful send path remains unchanged and tested.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Failed Slack send does not mark output as delivered
    Tool: Bash
    Preconditions: test fixture mocks Slack send failure and observes orchestrator flag behavior
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "failed slack send is non-delivery"`.
      2. Verify `outputSentToUser` remains false in assertion.
    Expected Result: Failed send is treated as non-delivery.
    Failure Indicators: cursor path follows delivered-output branch after failed send.
    Evidence: .sisyphus/evidence/task-11-non-delivery.txt

  Scenario: Successful Slack send still marks delivered path
    Tool: Bash
    Preconditions: success send fixture exists
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "successful send remains delivered"`.
      2. Confirm orchestrator delivered path assertion passes.
    Expected Result: Successful send behavior remains intact.
    Evidence: .sisyphus/evidence/task-11-delivery-success.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-11-non-delivery.txt`
  - [ ] `.sisyphus/evidence/task-11-delivery-success.txt`

  **Commit**: YES (group with T7-T11)
  - Message: `fix(recovery): implement exhaustion drop and slack recovery bridge`
  - Files: `src/group-queue.ts`, `src/index.ts`, `src/channels/slack.ts`, `src/db.ts`, related tests
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 12. Add Queue Regression Suite for Exhaustion Forward-Progress

  **What to do**:
  - Extend `src/group-queue.test.ts` to cover:
    - exhaustion stops stale replay,
    - new message after exhaustion resumes processing,
    - pending message during gate survives and processes later.
  - Include race-oriented timer tests for backoff + new enqueue ordering.

  **Must NOT do**:
  - Do not weaken existing retry/backoff assertions.
  - Do not add flaky time-dependent tests without deterministic fake timers.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: targeted unit test additions in one module.
  - **Skills**: [`debug`]
    - `debug`: deterministic timer-based queue tests require careful control.
  - **Skills Evaluated but Omitted**:
    - `deep`: complexity is moderate and localized.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T13-T16)
  - **Blocks**: T15
  - **Blocked By**: T7

  **References**:
  - `src/group-queue.test.ts` - existing MAX_RETRIES and backoff tests to extend.
  - `src/group-queue.ts` - gate/exhaustion transition implementation under test.

  **Acceptance Criteria**:
  - [ ] New tests assert required policy: drop exhausted stale workload, process new messages later.
  - [ ] Timer-driven tests are deterministic with fake timers.
  - [ ] Entire queue test suite stays green.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Exhaustion then new-message recovery path is validated
    Tool: Bash
    Preconditions: new queue regression tests added
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "processes new message after exhaustion"`.
      2. Run `npm test -- src/group-queue.test.ts -t "blocks stale replay while gated"`.
      3. Verify both tests pass under fake timers.
    Expected Result: Required forward-progress semantics are asserted and passing.
    Failure Indicators: replay loops or inability to resume on new message.
    Evidence: .sisyphus/evidence/task-12-queue-regression.txt

  Scenario: Race between retry timer and new enqueue is handled safely
    Tool: Bash
    Preconditions: race test fixture exists
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "retry timer enqueue race"`.
      2. Confirm no duplicate processing storm in assertions.
    Expected Result: Race path remains bounded and deterministic.
    Evidence: .sisyphus/evidence/task-12-race-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-12-queue-regression.txt`
  - [ ] `.sisyphus/evidence/task-12-race-guard.txt`

  **Commit**: NO

- [ ] 13. Add Orchestrator Cursor Policy Regression Suite

  **What to do**:
  - Add dedicated orchestrator recovery tests (e.g., `src/index.recovery.test.ts`) covering success/retry/discard and restart persistence behavior.
  - Validate `outputSentToUser` interaction with rollback/no-rollback logic.
  - Validate bounded-window discard does not consume post-window messages.

  **Must NOT do**:
  - Do not rely only on happy-path tests.
  - Do not skip restart/persistence assertions for cursor state.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: high-risk cursor correctness and persistence behavior.
  - **Skills**: [`debug`]
    - `debug`: complex matrix of outcomes and state persistence.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: this suite targets orchestrator policy, not channel formatting.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T12, T14-T16)
  - **Blocks**: T15
  - **Blocked By**: T4, T8

  **References**:
  - `src/index.ts` - `processGroupMessages`, cursor updates, rollback branches.
  - `src/db.ts` - message retrieval semantics and bot-response shortcut.
  - `src/group-queue.ts` - exhaustion signal consumed by cursor policy.

  **Acceptance Criteria**:
  - [ ] Cursor decision matrix tests pass for success/retry/discard.
  - [ ] Restart persistence case validates cursor survives process restart simulation.
  - [ ] Post-window messages are provably not dropped.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Full cursor matrix and persistence behavior pass
    Tool: Bash
    Preconditions: `src/index.recovery.test.ts` includes matrix + persistence suites
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "cursor matrix"`.
      2. Run `npm test -- src/index.recovery.test.ts -t "cursor persistence after restart"`.
      3. Verify both suites pass.
    Expected Result: Matrix and restart behavior are deterministic and correct.
    Failure Indicators: wrong cursor after discard, rollback drift, or lost persisted state.
    Evidence: .sisyphus/evidence/task-13-cursor-regression.txt

  Scenario: Delivered-output path still prevents duplicate rollback
    Tool: Bash
    Preconditions: test fixture where output sent before terminal error
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "delivered output skips rollback"`.
      2. Confirm no duplicate reprocessing assertion failure.
    Expected Result: Existing duplicate-prevention guard remains valid.
    Evidence: .sisyphus/evidence/task-13-delivered-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-13-cursor-regression.txt`
  - [ ] `.sisyphus/evidence/task-13-delivered-guard.txt`

  **Commit**: NO

- [ ] 14. Add Slack Recovery and Delivery Regression Suite

  **What to do**:
  - Extend `src/channels/slack.test.ts` for:
    - reconnect success callback behavior,
    - callback idempotency,
    - send-failure non-delivery signaling,
    - no false recovery on reconnect failure.
  - Ensure watchdog breaker behavior remains unchanged unless explicitly required.

  **Must NOT do**:
  - Do not remove existing reconnect/breaker tests.
  - Do not introduce flaky real-time waits; keep fake timers/mocks deterministic.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: nuanced transport edge-case regression coverage.
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: Slack/Bolt-specific behavior knowledge.
    - `debug`: timing and callback race validation.
  - **Skills Evaluated but Omitted**:
    - `writing`: runtime tests, not docs.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T12, T13, T15, T16)
  - **Blocks**: T15
  - **Blocked By**: T9, T11

  **References**:
  - `src/channels/slack.ts` - watchdog, reconnect, and send paths.
  - `src/channels/slack.test.ts` - existing watchdog coverage and send-failure assertions.
  - `src/index.ts` - consumer of delivery signal semantics.

  **Acceptance Criteria**:
  - [ ] Slack recovery callback and delivery semantics are regression-covered.
  - [ ] Existing watchdog breaker expectations remain green.
  - [ ] Tests are deterministic under fake timers.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Slack recovery and delivery regression suite passes
    Tool: Bash
    Preconditions: new regression tests merged into slack test file
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "recovery callback"`.
      2. Run `npm test -- src/channels/slack.test.ts -t "non-delivery on send failure"`.
      3. Confirm both suites pass.
    Expected Result: Recovery and delivery semantics are verified without regressions.
    Failure Indicators: callback misfires, delivery false positives, flaky timer failures.
    Evidence: .sisyphus/evidence/task-14-slack-regression.txt

  Scenario: Breaker behavior remains unchanged
    Tool: Bash
    Preconditions: existing breaker test still present
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "circuit breaker opens after max retries"`.
      2. Verify expected `process.exit(1)` mock assertion still passes.
    Expected Result: Existing breaker contract stays intact.
    Evidence: .sisyphus/evidence/task-14-breaker-compat.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-14-slack-regression.txt`
  - [ ] `.sisyphus/evidence/task-14-breaker-compat.txt`

  **Commit**: NO

- [ ] 15. Add Failure-Injection Integration Scenario (Outage -> Exhaust -> Recover)

  **What to do**:
  - Add an integration-style test harness that simulates:
    - upstream API outage,
    - retry exhaustion and discard commit,
    - Slack recovery event,
    - processing of new post-recovery message.
  - Capture deterministic evidence proving no orphaning and no stale replay.

  **Must NOT do**:
  - Do not rely on external live Slack/API services for this scenario.
  - Do not skip negative assertions about stale workload replay.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: multi-module end-to-end failure choreography.
  - **Skills**: [`debug`, `add-slack`]
    - `debug`: orchestrates deterministic failure injection.
    - `add-slack`: validates Slack-path recovery semantics.
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: complexity is high but tractable with deterministic harness.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 sequential end-cap
  - **Blocks**: T16, Final Verification
  - **Blocked By**: T7, T8, T9, T10, T11, T12, T13, T14

  **References**:
  - `src/group-queue.ts` - exhaustion transition and pending handling.
  - `src/index.ts` - cursor decision and recovery scan behavior.
  - `src/channels/slack.ts` - reconnect/recovery signal behavior.
  - `src/db.ts` - windowed message retrieval correctness.

  **Acceptance Criteria**:
  - [ ] Integration scenario reproduces outage and proves stale workload drop at exhaustion.
  - [ ] Integration scenario proves new post-recovery message is processed.
  - [ ] Integration scenario proves no permanent orphan state.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Outage exhaustion and recovery integration passes
    Tool: Bash
    Preconditions: deterministic integration harness with mocked upstream failure/recovery
    Steps:
      1. Run `npm test -- src/recovery.integration.test.ts -t "outage exhaustion recovery"`.
      2. Verify assertions: stale window discarded, gate cleared on recovery, new message processed.
      3. Confirm no stale replay assertion failures.
    Expected Result: Full outage->recover lifecycle passes with forward progress.
    Failure Indicators: stale replay, missing recovery processing, or orphaned group state.
    Evidence: .sisyphus/evidence/task-15-integration-recovery.txt

  Scenario: No-recovery case remains gated and does not replay stale workload
    Tool: Bash
    Preconditions: integration fixture keeps recovery signal absent
    Steps:
      1. Run `npm test -- src/recovery.integration.test.ts -t "no recovery keeps gate without replay"`.
      2. Verify stale workload is not replayed while gate remains active.
    Expected Result: Safety behavior holds under prolonged outage.
    Evidence: .sisyphus/evidence/task-15-integration-no-recovery.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-15-integration-recovery.txt`
  - [ ] `.sisyphus/evidence/task-15-integration-no-recovery.txt`

  **Commit**: YES (group with T12-T15)
  - Message: `test(recovery): add outage exhaustion and recovery coverage`
  - Files: `src/group-queue.test.ts`, `src/index.recovery.test.ts`, `src/channels/slack.test.ts`, `src/recovery.integration.test.ts`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 16. Update Ops Playbook, Canary Gates, and Rollback Procedure

  **What to do**:
  - Update docs/runbooks with dual-state runtime semantics, log events, and operator actions.
  - Add canary acceptance gates specific to this fix (exhaustion event rate, recovery latency, stale replay count).
  - Add rollback checklist tied to commit groups and verification commands.

  **Must NOT do**:
  - Do not publish vague observability guidance without concrete event names/thresholds.
  - Do not mark rollout complete without explicit canary pass criteria.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: operational clarity and release safety documentation.
  - **Skills**: [`debug`]
    - `debug`: ensures docs align with actual runtime events and behavior.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: this task is mostly release operations and runbook fidelity.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T12-T14)
  - **Blocks**: Final Verification
  - **Blocked By**: T6, T15

  **References**:
  - `.sisyphus/plans/slack-roadmap-next-phase.md` - required dual-state development style and release gate framing.
  - `src/group-queue.ts`, `src/index.ts`, `src/channels/slack.ts` - runtime event names and transitions to document accurately.

  **Acceptance Criteria**:
  - [ ] Runbook explains NORMAL/EXHAUSTED_DROP transitions and operator actions.
  - [ ] Canary gates include measurable thresholds and clear pass/fail criteria.
  - [ ] Rollback steps map to commit groups and validated commands.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Runbook accuracy check against implementation
    Tool: Bash
    Preconditions: docs updated and event names finalized
    Steps:
      1. Run `npm test -- src/recovery.integration.test.ts -t "outage exhaustion recovery"` to generate known event flow.
      2. Compare emitted event names/fields with documented runbook checklist.
      3. Record alignment results.
    Expected Result: Documentation matches implementation event taxonomy and transitions.
    Failure Indicators: undocumented events, mismatched field names, or incorrect operator actions.
    Evidence: .sisyphus/evidence/task-16-runbook-alignment.txt

  Scenario: Canary gate checklist is executable
    Tool: Bash
    Preconditions: canary checklist includes command-based verification
    Steps:
      1. Execute listed verification commands (`npm run typecheck`, `npm test`, `npm run build`).
      2. Confirm checklist has explicit numeric thresholds and go/no-go rule.
    Expected Result: Canary checklist is actionable and testable.
    Evidence: .sisyphus/evidence/task-16-canary-checklist.txt
  ```

  **Evidence to Capture:**
  - [ ] `.sisyphus/evidence/task-16-runbook-alignment.txt`
  - [ ] `.sisyphus/evidence/task-16-canary-checklist.txt`

  **Commit**: YES (group D)
  - Message: `docs(recovery): add dual-state runbook and canary checklist`
  - Files: runbook/plan docs updated for this recovery feature
  - Pre-commit: `npm run build`

---

## Final Verification Wave

- [ ] F1. Plan Compliance Audit - oracle
  Validate every Must Have/Must NOT Have against implementation and evidence files.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. Code Quality Review - unspecified-high
  Run `npm run typecheck`, `npm test`, `npm run build`; inspect changed files for unsafe shortcuts and policy violations.
  Output: `Typecheck [PASS/FAIL] | Tests [PASS/FAIL] | Build [PASS/FAIL] | VERDICT`

- [ ] F3. Real QA Replay - unspecified-high
  Execute every task QA scenario and ensure evidence exists at `.sisyphus/evidence/`.
  Output: `Scenarios [N/N] | Evidence [N/N] | Integration [PASS/FAIL] | VERDICT`

- [ ] F4. Scope Fidelity Check - deep
  Compare task specs to changed files; detect scope creep and cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N] | VERDICT`

---

## Commit Strategy

- Group A (contracts/scaffolding): T1-T6
  - Message: `feat(recovery): add dual-state scaffolding and contracts`
  - Pre-commit: `npm run typecheck && npm test`

- Group B (core behavior): T7-T11
  - Message: `fix(recovery): implement exhaustion drop and slack recovery bridge`
  - Pre-commit: `npm run typecheck && npm test`

- Group C (validation): T12-T15
  - Message: `test(recovery): add outage exhaustion and recovery coverage`
  - Pre-commit: `npm run typecheck && npm test`

- Group D (ops/docs): T16
  - Message: `docs(recovery): add dual-state runbook and canary checklist`
  - Pre-commit: `npm run build`

---

## Success Criteria

### Verification Commands

```bash
npm run typecheck   # Expected: no errors
npm test            # Expected: all tests pass, including new recovery suites
npm run build       # Expected: successful TypeScript build
```

### Final Checklist

- [ ] Exhausted stale workload windows are discarded exactly once
- [ ] Future new messages are processable after API recovery
- [ ] No permanent group orphaning after retry exhaustion
- [ ] Observability events provide clear exhaustion/recovery timelines
- [ ] Canary and rollback guidance updated and actionable
