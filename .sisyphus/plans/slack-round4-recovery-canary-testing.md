# Slack Round 4 Recovery Canary Testing Plan

## TL;DR

> **Quick Summary**: Execute a recovery-focused Round-4 canary by extending W4 canary workflow with dual-state recovery checks, fixing canary tooling defects, and closing critical recovery test coverage gaps before promotion.
>
> **Deliverables**:
> - Corrected canary tooling (`scripts/slack/canary-checkpoint.sh`, `scripts/slack/soak-monitor.sh`)
> - Recovery-focused test coverage additions for index-level behaviors
> - Round-4 canary evidence bundle and go/no-go verdict
> - W4 addendum documenting Round-4 deltas and updated thresholds
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: 2 -> 6 -> 11 -> 12

---

## Context

### Original Request
Formalize the next-step testing plan based on `docs/slack/W4-canary-testing-runbook.md` and complete review.

### Interview Summary
**Key Discussions**:
- Current repo is already in deployed validation state and recovery changes are landed.
- W4 remains the baseline process, but Round-4 must add recovery-specific validation.
- Plan scope should focus on testing/canary execution and tooling correctness, not new feature expansion.

**Research Findings**:
- Current baseline: 31 test files, 413 passing tests.
- Existing canary infra exists (`canary-checkpoint.sh`, `soak-monitor.sh`) but has known correctness risks.
- Recovery events now available in runtime logs: `exhaustion_drop`, `cursor_commit_on_exhaustion`, `send_failed_non_delivery`, `slack_recovery_resume`, `recovery_callback_error`.
- Recovery integration test exists, but index-level branches are still under-tested.

### Metis Review
**Identified Gaps (addressed in this plan)**:
- Canary script PID/log parsing may be mismatched with actual pino-pretty output.
- C3 (rate-limit) logic can invert healthy behavior into false FAIL.
- C4 does not enforce W4 message-count/idempotency gate strongly enough.
- `soak-monitor.sh` PID staleness and dependency robustness (`bc`) need correction.
- `r3-` evidence naming and script path assumptions must be normalized for Round-4.

---

## Work Objectives

### Core Objective
Ship a trustworthy Round-4 canary process for dual-state API recovery by ensuring tooling correctness, closing recovery test blind spots, and producing auditable promotion/rollback evidence.

### Concrete Deliverables
- Updated canary scripts with validated gate logic and Round-4 evidence naming.
- Added recovery-focused tests for index-level non-delivery, cursor gate, and slack-only recovery re-enqueue wiring.
- Executed dry-run + short canary evidence bundle.
- Round-4 verdict pack and W4 addendum.

### Definition of Done
- [ ] Updated canary scripts produce non-vacuous, auditable gate outputs.
- [ ] Recovery-specific tests added and passing in deployed mode.
- [ ] Round-4 short canary evidence generated with corrected scripts.
- [ ] Go/no-go decision table completed with explicit rollback triggers.

### Must Have
- Fixes for canary tool correctness defects before any Round-4 verdict use.
- Recovery behavior observability in final evidence.
- Explicit numeric pass/fail thresholds.

### Must NOT Have (Guardrails)
- No rewrite of unrelated architecture or channel features.
- No broad `src/index.ts` refactor beyond minimal testability-oriented changes.
- No direct manual bypass of dual-state workflow (`clean.sh` + apply-skill path where required).
- No vacuous canary PASS due to broken grep/parser logic.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after implementation)
- **Framework**: vitest + tsc
- **Mode**: deployed validation for runtime behavior checks

### QA Policy
Every task includes executable QA scenarios with evidence paths under `.sisyphus/evidence/`.

- **Script/tooling tasks**: Bash execution + deterministic output assertions
- **Runtime test tasks**: `npx vitest run <target>` + assertion counts
- **Canary tasks**: checkpoint JSON output + log query output + verdict table

---

## Execution Strategy

### Parallel Execution Waves

```text
Wave 1 (Tooling correctness + baseline, 6 tasks):
- T1 Baseline assumption verification pack
- T2 Fix canary-checkpoint log parsing/PID matching
- T3 Fix canary-checkpoint C3 rate-limit recovery logic
- T4 Fix canary-checkpoint C4 message-count/idempotency gate
- T5 Fix soak-monitor PID refresh + bc fallback
- T6 Normalize Round-4 naming + script path references

Wave 2 (Recovery coverage + execution, 6 tasks):
- T7 Add test for send_failed_non_delivery rollback path
- T8 Add test for cursor_commit_on_exhaustion gate branch
- T9 Add test for real slack-only onRecovery wiring
- T10 Implement synthetic outage drill runner + evidence format
- T11 Execute short Round-4 canary (2h) with corrected scripts
- T12 Produce Round-4 verdict pack + W4 addendum + go/no-go table
```

### Dependency Matrix (Full)
- **T1**: blocked by none; blocks T11, T12
- **T2**: blocked by none; blocks T11
- **T3**: blocked by none; blocks T11
- **T4**: blocked by none; blocks T11
- **T5**: blocked by none; blocks T11
- **T6**: blocked by T2; blocks T11, T12
- **T7**: blocked by T1; blocks T11
- **T8**: blocked by T1; blocks T11
- **T9**: blocked by T1; blocks T11
- **T10**: blocked by T2, T3, T4; blocks T11
- **T11**: blocked by T1, T2, T3, T4, T5, T6, T7, T8, T9, T10; blocks T12
- **T12**: blocked by T1, T6, T11; blocks Final Verification

### Agent Dispatch Summary
- **Wave 1**: 6 agents — T1 quick, T2 unspecified-high, T3 quick, T4 deep, T5 quick, T6 writing
- **Wave 2**: 6 agents — T7 deep, T8 deep, T9 deep, T10 unspecified-high, T11 deep, T12 writing
- **Final**: 4 agents — oracle + quality + qa + scope

---

## TODOs

- [x] 1. Baseline Assumption Verification Pack

  **What to do**:
  - Verify current mode, snapshot availability, and test/build baseline before Round-4 work.
  - Validate assumptions A1-A5 from Metis: mode, test count, log format, env gate value, event-key consistency.
  - Record baseline results in a single evidence file.

  **Must NOT do**:
  - Do not start canary execution before baseline assumptions are verified.
  - Do not rely on stale expected test-count values from older runbooks.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: command-driven baseline verification with low implementation complexity.
  - **Skills**: [`debug`]
    - `debug`: log, runtime-state, and environment validation workflows.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: no feature coding required for this task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2-T6)
  - **Blocks**: T7, T8, T9, T11, T12
  - **Blocked By**: None

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - baseline preflight expectations and canary flow.
  - `feature_docs/clean.sh` - authoritative mode/snapshot workflow (`status`, `snapshots`, `switch`).
  - `src/config.ts` - `RECOVERY_EXHAUSTED_GATE_MS` default/parse behavior to validate env assumptions.
  - `.sisyphus/evidence/r3-task-9-canary-verdict.txt` - prior canary verdict baseline.

  **Acceptance Criteria**:
  - [ ] Baseline evidence captures mode, snapshots, typecheck/test/build outputs.
  - [ ] Actual current test count recorded (no stale hard-coded expectation).
  - [ ] Assumption validation table (A1-A5) recorded with PASS/FAIL.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Baseline gate pack generation
    Tool: Bash
    Preconditions: repository available, scripts executable
    Steps:
      1. Run `./feature_docs/clean.sh status` and capture mode output.
      2. Run `./feature_docs/clean.sh snapshots` and verify at least one undeployed/deployed snapshot exists.
      3. Run `npm run typecheck && npm test && npm run build`.
    Expected Result: All commands succeed and baseline file includes state + test count + gate outputs.
    Failure Indicators: missing snapshot, command failures, mismatched mode lock.
    Evidence: .sisyphus/evidence/task-1-baseline-assumptions.txt

  Scenario: Config gate value validation
    Tool: Bash
    Preconditions: config file present
    Steps:
      1. Query `RECOVERY_EXHAUSTED_GATE_MS` presence in `src/config.ts`.
      2. Validate default fallback is `0` when env is missing/invalid.
    Expected Result: Default/fallback logic is explicit and documented in evidence.
    Evidence: .sisyphus/evidence/task-1-gate-config.txt
  ```

  **Commit**: NO

- [x] 2. Fix `canary-checkpoint.sh` Log Parsing and PID Correlation

  **What to do**:
  - Replace brittle PID grep assumptions so metrics match actual pino-pretty output.
  - Ensure event counting logic works with real production log line format.
  - Add script-level regression checks for parser behavior.

  **Must NOT do**:
  - Do not keep `pid_log_count` logic that always returns zero under pino-pretty.
  - Do not change gate semantics in this task (only parsing/correlation correctness).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: script internals + log-format reasoning under production constraints.
  - **Skills**: [`debug`]
    - `debug`: structured log interpretation and parsing diagnostics.
  - **Skills Evaluated but Omitted**:
    - `writing`: this is implementation/script correctness, not doc-first.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3-T6)
  - **Blocks**: T6, T10, T11
  - **Blocked By**: None

  **References**:
  - `scripts/slack/canary-checkpoint.sh` - parser/counter implementation to fix.
  - `src/logger.ts` - actual output formatting behavior that parser must match.
  - `.sisyphus/evidence/r3-canary-*.json` - expected JSON output shape for checkpoint artifacts.

  **Acceptance Criteria**:
  - [ ] Parser/counter returns non-vacuous counts on real logs.
  - [ ] `--dry-run` output includes meaningful metrics (not always zero).
  - [ ] No regression to JSON schema consumed by existing canary evidence workflow.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Checkpoint parser dry-run sanity
    Tool: Bash
    Preconditions: script updated
    Steps:
      1. Run `bash scripts/slack/canary-checkpoint.sh --dry-run`.
      2. Validate JSON output exists and includes C1-C5 details with non-empty metrics fields.
    Expected Result: Script exits deterministically with valid JSON and real parser outputs.
    Failure Indicators: empty metrics, malformed JSON, hardcoded-zero counts.
    Evidence: .sisyphus/evidence/task-2-checkpoint-parser-dryrun.txt

  Scenario: Real-log format compatibility
    Tool: Bash
    Preconditions: at least one real log line with `event` exists
    Steps:
      1. Run script against current logs.
      2. Compare counted events with manual grep count for at least one event key.
    Expected Result: Automated counts and manual counts align within exact match.
    Evidence: .sisyphus/evidence/task-2-parser-compatibility.txt
  ```

  **Commit**: YES (group with T3-T6)
  - Message: `chore(canary): fix checkpoint parsing, gate logic, and soak monitor robustness`

- [x] 3. Correct C3 Rate-Limit Gate Logic in `canary-checkpoint.sh`

  **What to do**:
  - Update C3 to evaluate recovery outcome (rate-limit then successful continuation) rather than presence-only failure.
  - Ensure C3 fails only on unrecovered rate-limit patterns consistent with W4 semantics.
  - Add deterministic fixtures or shell checks for both pass and fail samples.

  **Must NOT do**:
  - Do not mark all `slack_rate_limited` occurrences as FAIL.
  - Do not introduce opaque logic without evidence-friendly output fields.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: constrained change to one gate condition and assertions.
  - **Skills**: [`debug`]
    - `debug`: failure-pattern classification and negative-path verification.
  - **Skills Evaluated but Omitted**:
    - `deep`: task remains narrow and script-local.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T4-T6)
  - **Blocks**: T10, T11
  - **Blocked By**: None

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - C3 expected semantics (`429` recovery is valid).
  - `docs/slack/T10-canary-ops-rollback.md` - rollback trigger linked to repeated send failures.
  - `scripts/slack/canary-checkpoint.sh` - C3 implementation lines and output fields.

  **Acceptance Criteria**:
  - [ ] C3 PASS for recovered rate-limit sequence.
  - [ ] C3 FAIL for repeated unrecovered send-failure sequence.
  - [ ] Evidence includes explicit why-pass/why-fail details.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: C3 recovered rate-limit path
    Tool: Bash
    Preconditions: sample log or synthetic sequence with `slack_rate_limited` then success
    Steps:
      1. Run checkpoint script against recovered-sequence sample.
      2. Verify C3 verdict is PASS.
    Expected Result: C3 marks recovered path as healthy.
    Failure Indicators: C3 incorrectly FAILs on healthy 429 recovery.
    Evidence: .sisyphus/evidence/task-3-c3-recovered-pass.txt

  Scenario: C3 unrecovered rate-limit path
    Tool: Bash
    Preconditions: sample sequence with repeated `slack_send_failed`
    Steps:
      1. Run checkpoint script against failure-sequence sample.
      2. Verify C3 verdict is FAIL.
    Expected Result: C3 flags unrecovered rate-limit as failure.
    Evidence: .sisyphus/evidence/task-3-c3-unrecovered-fail.txt
  ```

  **Commit**: YES (group with T2, T4-T6)

- [x] 4. Strengthen C4 Message-Count and Idempotency Gate

  **What to do**:
  - Implement explicit `>=50` processed-message check aligned with W4 criteria.
  - Add duplicate-detection signal check (no duplicate `channel:ts` processing evidence).
  - Emit machine-readable C4 details in checkpoint JSON.

  **Must NOT do**:
  - Do not keep C4 as only process-alive/socket-alive proxy.
  - Do not silently pass C4 when message volume is below threshold.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: combines metric derivation + idempotency semantics + evidence output.
  - **Skills**: [`debug`]
    - `debug`: log-query and signal correctness validation.
  - **Skills Evaluated but Omitted**:
    - `writing`: primary work is script logic, not documentation.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1-T3, T5-T6)
  - **Blocks**: T10, T11
  - **Blocked By**: None

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - C4 exit rule (`>=50` inbound messages, no duplicates).
  - `scripts/slack/canary-checkpoint.sh` - C4 gate logic and JSON output.
  - `src/channels/slack.ts` - inbound dedup model (`channel:ts`) to align diagnostics with implementation.

  **Acceptance Criteria**:
  - [ ] C4 includes numeric processed-message count and threshold evaluation.
  - [ ] C4 includes duplicate-signal check result.
  - [ ] C4 fails when volume below threshold or duplicate evidence appears.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: C4 below-threshold failure
    Tool: Bash
    Preconditions: sample/log window with <50 processed messages
    Steps:
      1. Run checkpoint script on below-threshold data.
      2. Verify C4 verdict is FAIL with explicit count in detail field.
    Expected Result: Threshold violation is explicit and deterministic.
    Failure Indicators: C4 PASS without meeting >=50 requirement.
    Evidence: .sisyphus/evidence/task-4-c4-below-threshold.txt

  Scenario: C4 threshold pass with clean idempotency
    Tool: Bash
    Preconditions: log/sample window with >=50 messages and no duplicate-key signal
    Steps:
      1. Run checkpoint script.
      2. Verify C4 PASS and count>=50 recorded.
    Expected Result: C4 passes only with both volume and idempotency conditions met.
    Evidence: .sisyphus/evidence/task-4-c4-threshold-pass.txt
  ```

  **Commit**: YES (group with T2, T3, T5, T6)

- [x] 5. Fix `soak-monitor.sh` PID Refresh and Dependency Robustness

  **What to do**:
  - Re-discover service PID per checkpoint to survive restarts during soak window.
  - Add resilient fallback for environments without `bc`.
  - Preserve existing output format while adding PID-change trace lines.

  **Must NOT do**:
  - Do not keep static PID capture for entire soak duration.
  - Do not hard-fail when `bc` is missing if integer-safe fallback is possible.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: bounded shell-script corrections.
  - **Skills**: [`debug`]
    - `debug`: restart-path and script portability troubleshooting.
  - **Skills Evaluated but Omitted**:
    - `deep`: not required for this focused patch.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1-T4, T6)
  - **Blocks**: T11
  - **Blocked By**: None

  **References**:
  - `scripts/slack/soak-monitor.sh` - PID capture and metric computation logic.
  - `.sisyphus/evidence/r3-task-7-soak.txt` - prior false-negative pattern and expected output shape.
  - `docs/slack/W4-canary-testing-runbook.md` - soak/observation intent and runtime stability requirements.

  **Acceptance Criteria**:
  - [ ] Soak monitor detects PID changes and continues monitoring new PID.
  - [ ] Script runs without `bc`-related failure.
  - [ ] Output clearly separates per-interval metrics and final verdict.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: PID rollover handling
    Tool: Bash
    Preconditions: service restart simulated during soak run
    Steps:
      1. Start soak monitor with short interval/window.
      2. Restart service mid-run.
      3. Verify script logs PID change and continues counting events.
    Expected Result: No stale-PID blind spot after restart.
    Failure Indicators: post-restart metrics stay frozen or empty.
    Evidence: .sisyphus/evidence/task-5-soak-pid-rollover.txt

  Scenario: No-bc fallback path
    Tool: Bash
    Preconditions: `bc` unavailable or intentionally masked
    Steps:
      1. Execute soak monitor in fallback environment.
      2. Verify script completes and prints deterministic numeric fields.
    Expected Result: Script remains functional without hard dependency on `bc`.
    Evidence: .sisyphus/evidence/task-5-soak-bc-fallback.txt
  ```

  **Commit**: YES (group with T2-T4, T6)

- [x] 6. Normalize Round-4 Naming and Script Path References

  **What to do**:
  - Replace `r3-` evidence prefixes with Round-4 naming convention.
  - Correct script path references to `scripts/slack/canary-checkpoint.sh` wherever required.
  - Align generated evidence locations with current plan and runbook.

  **Must NOT do**:
  - Do not leave mixed round prefixes that confuse evidence lineage.
  - Do not keep stale script path aliases that create no-such-file failures.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: naming/protocol consistency across scripts and operational references.
  - **Skills**: [`debug`]
    - `debug`: verify path correctness and invocation consistency.
  - **Skills Evaluated but Omitted**:
    - `add-slack`: no feature integration required.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1-T5)
  - **Blocks**: T11, T12
  - **Blocked By**: T2

  **References**:
  - `scripts/slack/canary-checkpoint.sh` - evidence filename prefix and output path.
  - `scripts/slack/soak-monitor.sh` - evidence filename prefix and references.
  - `.sisyphus/evidence/r3-task-9-canary-log.txt` - observed path failure pattern.

  **Acceptance Criteria**:
  - [ ] Round-4 evidence file names are consistent and traceable.
  - [ ] All script references resolve to existing file paths.
  - [ ] No remaining `r3-` hardcoded values in active canary scripts.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Naming and path consistency scan
    Tool: Bash
    Preconditions: scripts updated
    Steps:
      1. Search scripts for `r3-` and stale canary path strings.
      2. Execute both scripts once and inspect generated evidence file names.
    Expected Result: Only Round-4 naming appears; all paths resolve.
    Failure Indicators: stale prefix/path remains or execution fails on missing file.
    Evidence: .sisyphus/evidence/task-6-naming-path-consistency.txt

  Scenario: End-to-end script invocation sanity
    Tool: Bash
    Preconditions: canary scripts executable
    Steps:
      1. Run checkpoint script and soak script with short windows.
      2. Verify both write evidence to expected directory.
    Expected Result: Script outputs are generated with consistent naming convention.
    Evidence: .sisyphus/evidence/task-6-script-sanity.txt
  ```

  **Commit**: YES (group with T2-T5)

- [ ] 7. Add Recovery Test for `send_failed_non_delivery` Rollback Behavior

  **What to do**:
  - Add targeted runtime test coverage for the path where Slack send throws and orchestrator treats it as non-delivery.
  - Verify cursor handling follows rollback semantics (no false delivered state).
  - Store assertions in a focused recovery test file (extend existing recovery test suite).

  **Must NOT do**:
  - Do not mark failed send as delivered in assertions.
  - Do not add broad orchestrator refactor just to make tests pass.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: this path spans channel send behavior + orchestrator error semantics.
  - **Skills**: [`debug`]
    - `debug`: failure-path test design and deterministic assertions.
  - **Skills Evaluated but Omitted**:
    - `writing`: task is runtime test implementation.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8-T10)
  - **Blocks**: T11
  - **Blocked By**: T1

  **References**:
  - `src/index.ts` - `send_failed_non_delivery` branch and cursor decisioning.
  - `src/channels/slack.ts` - send failure re-throw behavior.
  - `src/recovery.integration.test.ts` - established integration-style recovery testing pattern.

  **Acceptance Criteria**:
  - [ ] New test explicitly covers thrown send path and asserts non-delivery semantics.
  - [ ] Test fails on old/incorrect behavior and passes on intended behavior.
  - [ ] Full suite remains green after test addition.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Failed Slack send treated as non-delivery
    Tool: Bash
    Preconditions: recovery test implemented
    Steps:
      1. Run `npx vitest run src/recovery.integration.test.ts -t "send_failed_non_delivery"` (or equivalent targeted test).
      2. Verify assertion confirms no false delivered state and rollback-compatible outcome.
    Expected Result: Targeted test passes with explicit non-delivery assertions.
    Failure Indicators: output marked delivered despite send failure.
    Evidence: .sisyphus/evidence/task-7-send-failed-non-delivery.txt

  Scenario: Regression safety
    Tool: Bash
    Preconditions: targeted test added
    Steps:
      1. Run full `npm test`.
      2. Confirm no unrelated regressions.
    Expected Result: Full suite passes with new test included.
    Evidence: .sisyphus/evidence/task-7-full-suite.txt
  ```

  **Commit**: YES (group with T8-T10)
  - Message: `test(recovery): add index-path recovery coverage and outage drill`

- [ ] 8. Add Recovery Test for `cursor_commit_on_exhaustion` Gate Branch

  **What to do**:
  - Add test coverage for `RECOVERY_EXHAUSTED_GATE_MS > 0` branch.
  - Verify cursor commit uses gated floor correctly and does not regress when gate is `0`.
  - Include both happy path and edge-value path.

  **Must NOT do**:
  - Do not only test default `0` gate path.
  - Do not leave branch behavior inferred from logs only.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: requires branch-specific state/time reasoning and deterministic tests.
  - **Skills**: [`debug`]
    - `debug`: boundary-value testing and temporal assertion design.
  - **Skills Evaluated but Omitted**:
    - `quick`: branch coverage here is logic-heavy, not trivial.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7, T9, T10)
  - **Blocks**: T11
  - **Blocked By**: T1

  **References**:
  - `src/index.ts` - `cursor_commit_on_exhaustion` branch and gate calculation.
  - `src/config.ts` - `RECOVERY_EXHAUSTED_GATE_MS` parsing/default behavior.
  - `src/recovery.integration.test.ts` - existing exhaustion/recovery harness.

  **Acceptance Criteria**:
  - [ ] Test covers non-zero gate branch explicitly.
  - [ ] Test verifies commit timestamp honors gate floor logic.
  - [ ] Existing zero-gate behavior remains validated.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Non-zero gate branch behavior
    Tool: Bash
    Preconditions: test case added with non-zero gate configuration
    Steps:
      1. Run targeted test for `cursor_commit_on_exhaustion` non-zero gate path.
      2. Verify assertions on computed commit timestamp/floor behavior.
    Expected Result: Branch executes and assertions pass for gated behavior.
    Failure Indicators: branch untested or timestamp logic mismatch.
    Evidence: .sisyphus/evidence/task-8-cursor-gate-nonzero.txt

  Scenario: Zero-gate compatibility
    Tool: Bash
    Preconditions: existing default path tests retained
    Steps:
      1. Run targeted default-gate test.
      2. Verify no regressions from non-zero branch additions.
    Expected Result: Default path still passes with expected semantics.
    Evidence: .sisyphus/evidence/task-8-cursor-gate-zero.txt
  ```

  **Commit**: YES (group with T7, T9-T10)

- [ ] 9. Add Recovery Test for Real Slack-Only `onRecovery` Wiring

  **What to do**:
  - Add a test that exercises actual wiring path (not only inline simulation).
  - Verify `onRecovery` re-enqueues only `slack:` groups and skips non-slack JIDs.
  - Validate this behavior remains idempotent across repeated recovery signals.

  **Must NOT do**:
  - Do not rely solely on simplified mock-only pseudo-callback tests.
  - Do not enqueue WhatsApp/non-slack groups during recovery assertions.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: tests integration seam between channel callback and orchestrator queue behavior.
  - **Skills**: [`debug`]
    - `debug`: callback wiring verification and idempotency checks.
  - **Skills Evaluated but Omitted**:
    - `unspecified-high`: this remains focused integration testing.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7, T8, T10)
  - **Blocks**: T11
  - **Blocked By**: T1

  **References**:
  - `src/index.ts` - `onRecovery` callback wiring and slack-prefix filter.
  - `src/channels/slack.ts` - callback invocation point after successful reconnect.
  - `src/recovery.integration.test.ts` - current simulated test to upgrade toward real wiring coverage.

  **Acceptance Criteria**:
  - [ ] Test verifies only `slack:` groups are enqueued on recovery.
  - [ ] Test verifies repeated recovery signals are safe/idempotent.
  - [ ] Test binds to real wiring path used by runtime.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Slack-only recovery re-enqueue
    Tool: Bash
    Preconditions: integration-style wiring test added
    Steps:
      1. Run targeted `onRecovery` wiring test.
      2. Verify enqueues occur for slack JIDs only.
    Expected Result: No non-slack group re-enqueue side effect.
    Failure Indicators: any non-slack enqueue observed.
    Evidence: .sisyphus/evidence/task-9-onrecovery-slack-only.txt

  Scenario: Repeated recovery idempotency
    Tool: Bash
    Preconditions: repeated callback invocation test case
    Steps:
      1. Trigger recovery callback multiple times in test.
      2. Verify behavior remains bounded and deterministic.
    Expected Result: Safe repeated handling without spurious side effects.
    Evidence: .sisyphus/evidence/task-9-onrecovery-idempotent.txt
  ```

  **Commit**: YES (group with T7, T8, T10)

- [ ] 10. Implement Synthetic Outage Drill Runner and Evidence Template

  **What to do**:
  - Create a repeatable canary drill runner at `scripts/slack/recovery-outage-drill.sh` that exercises outage -> retry exhaustion -> recovery observation.
  - Standardize evidence capture format for drill outputs (timestamps, commands, verdict fields) in `.sisyphus/evidence/task-10-*.txt`.
  - Ensure drill output cleanly maps to W4 conditions and recovery informational metrics.

  **Must NOT do**:
  - Do not make drill steps non-deterministic or manual-only.
  - Do not mix production canary logs with drill logs without labels.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: combines scripting, execution protocol, and auditable output structure.
  - **Skills**: [`debug`]
    - `debug`: failure simulation sequencing and evidence validation.
  - **Skills Evaluated but Omitted**:
    - `artistry`: unconventional approach not needed for this operational workflow.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7-T9)
  - **Blocks**: T11
  - **Blocked By**: T2, T3, T4

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - observation and success-diagnostics flow.
  - `scripts/slack/canary-checkpoint.sh` - checkpoint output contract.
  - `docs/slack/dual-state-recovery-runbook.md` - recovery event taxonomy and expected signals.

  **Acceptance Criteria**:
  - [ ] Drill procedure is executable end-to-end with deterministic evidence output.
  - [ ] Drill evidence clearly separates gate verdicts from informational recovery metrics.
  - [ ] Drill can be replayed without editing procedure text.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Synthetic outage drill execution
    Tool: Bash
    Preconditions: scripts from T2-T4 updated
    Steps:
      1. Execute drill runner once in controlled environment.
      2. Collect checkpoint output and drill transcript.
      3. Verify evidence schema fields are present and populated.
    Expected Result: Drill produces deterministic, parseable artifacts.
    Failure Indicators: missing fields, ambiguous timestamps, non-reproducible outputs.
    Evidence: .sisyphus/evidence/task-10-outage-drill.txt

  Scenario: Drill replay consistency
    Tool: Bash
    Preconditions: first drill run complete
    Steps:
      1. Re-run drill with same inputs.
      2. Compare key verdict fields and event-count sections.
    Expected Result: Verdict semantics remain consistent across runs.
    Evidence: .sisyphus/evidence/task-10-outage-drill-replay.txt
  ```

  **Commit**: YES (group with T7-T9)

- [ ] 11. Execute Short Round-4 Canary (2h) with Corrected Tooling

  **What to do**:
  - Run a short canary window using corrected checkpoint + soak scripts.
  - Capture C1-C5 gate outputs and C6+ recovery informational metrics.
  - Record explicit pass/fail outcomes and trigger state.

  **Must NOT do**:
  - Do not report verdict from stale/broken scripts.
  - Do not skip evidence capture for any gate.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: orchestrates multi-signal operational validation under realistic runtime conditions.
  - **Skills**: [`debug`]
    - `debug`: canary interpretation, anomaly triage, and evidence integrity.
  - **Skills Evaluated but Omitted**:
    - `quick`: canary execution and interpretation are not trivial command chaining.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential after T1-T10)
  - **Blocks**: T12
  - **Blocked By**: T1, T2, T3, T4, T5, T6, T7, T8, T9, T10

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - canary observation and exit-condition framework.
  - `scripts/slack/canary-checkpoint.sh` - checkpoint gate execution.
  - `scripts/slack/soak-monitor.sh` - stability trend monitoring during window.
  - `.sisyphus/evidence/task-3-deployed-gates.txt` - deployed baseline comparison point.

  **Acceptance Criteria**:
  - [ ] 2-hour canary run completes with full evidence bundle.
  - [ ] C1-C5 verdicts are explicit with supporting command/log outputs.
  - [ ] Recovery informational metrics (C6+) are recorded and interpretable.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: 2h canary gate execution
    Tool: Bash
    Preconditions: corrected scripts and tests in place
    Steps:
      1. Run checkpoint script at configured intervals during 2h window.
      2. Run soak monitor over same window.
      3. Aggregate outputs into canary evidence directory.
    Expected Result: Complete gate/evidence trace for short canary cycle.
    Failure Indicators: missing interval outputs, parser errors, unverifiable verdict states.
    Evidence: .sisyphus/evidence/task-11-short-canary.txt

  Scenario: Gate-to-log consistency audit
    Tool: Bash
    Preconditions: short canary evidence generated
    Steps:
      1. Cross-check reported gate values against manual grep counts.
      2. Verify no contradiction between verdict and raw logs.
    Expected Result: Gate outputs and raw logs agree.
    Evidence: .sisyphus/evidence/task-11-gate-log-consistency.txt
  ```

  **Commit**: NO

- [ ] 12. Publish Round-4 Verdict Pack, W4 Addendum, and Go/No-Go Table

  **What to do**:
  - Produce final Round-4 canary verdict document at `docs/slack/round4-canary-verdict.md` with pass/fail rationale.
  - Publish W4 addendum at `docs/slack/W4-round4-addendum.md` capturing Round-4 deltas: updated test-counts, corrected script behavior, recovery informational metrics.
  - Finalize go/no-go matrix with explicit rollback triggers and command sequence.

  **Must NOT do**:
  - Do not rewrite W4 from scratch; publish a delta/addendum.
  - Do not leave ambiguous thresholds or trigger wording.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: synthesis, operational clarity, and audit-grade documentation output.
  - **Skills**: [`debug`]
    - `debug`: ensure docs match observed runtime behavior and tooling output.
  - **Skills Evaluated but Omitted**:
    - `deep`: core challenge is documentation fidelity and decision clarity.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (final synthesis)
  - **Blocks**: Final Verification
  - **Blocked By**: T1, T6, T11

  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - baseline procedure.
  - `docs/slack/T10-canary-ops-rollback.md` - rollback protocol baseline.
  - `docs/slack/dual-state-recovery-runbook.md` - recovery event semantics and thresholds.
  - `.sisyphus/evidence/task-11-short-canary.txt` - canary outputs for final verdict.

  **Acceptance Criteria**:
  - [ ] `docs/slack/round4-canary-verdict.md` includes gate table + evidence links + final verdict.
  - [ ] `docs/slack/W4-round4-addendum.md` captures all Round-4 deltas without duplicating full W4 content.
  - [ ] Go/no-go + rollback matrix is command-complete and unambiguous.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Documentation-to-evidence alignment
    Tool: Bash
    Preconditions: verdict/addendum drafted
    Steps:
      1. Validate every stated threshold in docs has a matching evidence source.
      2. Validate every verdict claim has a referenced artifact path.
    Expected Result: No unsupported claims in final docs.
    Failure Indicators: orphaned claims, missing evidence references.
    Evidence: .sisyphus/evidence/task-12-doc-evidence-alignment.txt

  Scenario: Rollback decision drill
    Tool: Bash
    Preconditions: go/no-go table and rollback block drafted
    Steps:
      1. Run syntax checks on rollback command sequence.
      2. Validate commands align with latest commit hashes and mode workflow.
    Expected Result: Rollback block is executable and current.
    Evidence: .sisyphus/evidence/task-12-rollback-drill.txt
  ```

  **Commit**: YES
  - Message: `docs(slack): publish round4 canary addendum and verdict checklist`

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Validate all Must Have / Must NOT Have against actual outputs, scripts, tests, and evidence.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run typecheck`, `npm test`, `npm run build`; scan changed files for anti-patterns and scripting regressions.
  Output: `Build [PASS/FAIL] | Tests [N/N] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **QA Replay Audit** — `unspecified-high`
  Re-run all task QA scenarios and verify evidence files exist and match expected outputs.
  Output: `Scenarios [N/N pass] | Evidence [N/N found] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Ensure only planned files/concerns changed; detect scope creep or missing planned work.
  Output: `Tasks [N/N compliant] | Scope [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **1**: `chore(canary): fix checkpoint parsing, gate logic, and soak monitor robustness`
- **2**: `test(recovery): add index-path recovery coverage and outage drill`
- **3**: `docs(slack): publish round4 canary addendum and verdict checklist`

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck
npm test
npm run build
bash scripts/slack/canary-checkpoint.sh --dry-run
bash scripts/slack/soak-monitor.sh 15 120
```

### Final Checklist
- [ ] Tooling defects fixed and validated (no vacuous PASS)
- [ ] Recovery-critical branches have executable test coverage
- [ ] Round-4 canary evidence complete and auditable
- [ ] Go/no-go decision and rollback trigger matrix finalized
