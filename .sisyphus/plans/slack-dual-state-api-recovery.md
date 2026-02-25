# Slack Dual-State API Recovery Plan (Compact)

## TL;DR

> Quick Summary: Fix retry-exhaustion no-response behavior with a dual-state runtime model while enforcing skill-first delivery rules from the Slack roadmap.
>
> Deliverables:
> - `NORMAL` -> `EXHAUSTED_DROP` runtime transitions
> - Exhaustion-time stale-window discard commit (no replay storm)
> - Slack reconnect recovery signal clears gate and resumes new traffic
> - Skill-first implementation path (`.claude/skills/add-slack/**` + deployed validation)
>
> Estimated Effort: Medium
> Parallel Execution: YES (2 waves)
> Critical Path: 1 -> 2 -> 3 -> 4

---

## Context

### Original Request
- Retry耗尽后不应永久遗弃 group。
- 应丢弃“刚刚失败的工作窗口”，等待恢复后正常响应新消息。
- 当前问题聚焦 Slack 通道，不是 WhatsApp。
- 参考 `.sisyphus/plans/slack-roadmap-next-phase.md` 的双态开发规范。

### Audit Findings Incorporated
- Previous 16-task plan over-split relative to change size.
- Must enforce skill-first constraints from roadmap:
  - code changes authored in `.claude/skills/add-slack/**`
  - deployed validation via skill application flow
  - avoid ad-hoc direct-core editing workflow in plan design

### Root-Cause Summary
- `src/group-queue.ts`: retry exhaustion resets counter but lacks explicit persistent exhausted-drop semantics.
- `src/index.ts`: cursor rollback/advance behavior needs explicit exhaustion discard branch.
- `src/channels/slack.ts`: reconnect exists, but queue recovery bridge and delivery-truthfulness need explicit policy wiring.

---

## Work Objectives

### Core Objective
Implement a low-complexity, high-confidence fix that discards only exhausted stale workload windows and guarantees forward progress for new messages after recovery.

### Definition of Done
- [ ] Exhausted stale window is dropped exactly once.
- [ ] New messages after recovery are processed normally.
- [ ] No permanent group orphaning after retry exhaustion.
- [ ] Skill-first workflow and dual-state development constraints are followed.
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass in deployed validation state.

### Policy Defaults (Applied)
- Discard granularity: frozen failing window (`windowStart` -> `windowEnd`).
- User-facing discard notice: disabled by default (structured logs only).
- Same exhaustion/drop semantics across interactive + IPC + scheduler paths unless tests explicitly mark exception.

### Must NOT Have
- No infinite stale replay loop.
- No false "delivered" success when Slack send failed.
- No tight watchdog-to-queue coupling that can deadlock.
- No scope creep into unrelated channel redesign.

---

## Verification Strategy

- Infrastructure exists: YES (vitest + TypeScript build)
- Automated tests: YES (tests-after implementation)
- Agent-executed QA: mandatory for each task
- Evidence path: `.sisyphus/evidence/task-{N}-{scenario}.{ext}`

---

## Execution Strategy

### Dual-State Development (Process)
- **undeployed**: author changes in `.claude/skills/add-slack/**` only.
- **deployed**: apply skill into runtime, run full verification.
- **dirty-core**: if manual out-of-flow core drift appears, stop and reconcile before proceeding.

### Runtime Dual-State (Feature)
- **NORMAL**: bounded retries process frozen workload window.
- **EXHAUSTED_DROP**: on retry exhaustion, drop frozen stale window, commit cursor, clear retry metadata, wait for recovery/new traffic.

### Scope Coverage Map (Old 16-task coverage -> New 4-task plan)
- Contracts/config/state scaffolding -> Task 1
- Core queue/cursor/recovery behavior -> Tasks 1-2
- Slack callback + delivery-truthfulness -> Task 2
- Queue/index/slack/failure-injection testing -> Task 3
- Canary/rollback/ops docs -> Task 4

### Waves

```text
Wave 1 (Implementation):
- Task 1: Skill-first core dual-state patch
- Task 2: Slack recovery bridge + delivery truthfulness

Wave 2 (Validation + rollout readiness):
- Task 3: Deployed validation + integrated outage tests
- Task 4: Canary gates + rollback + runbook update
```

### Dependency Matrix
- T1: blocked by none; blocks T2, T3
- T2: blocked by T1; blocks T3
- T3: blocked by T1, T2; blocks T4
- T4: blocked by T3; blocks Final Verification

### Agent Dispatch Summary
- Wave 1: T1 -> `deep`, T2 -> `unspecified-high`
- Wave 2: T3 -> `deep`, T4 -> `writing`
- Final: combined 4-check verification gate (oracle + quality + qa + scope)

---

## TODOs

- [x] 1. Skill-First Core Dual-State Patch (Queue + Cursor + Config)

  **Execution State**: `undeployed`

  **What to do**:
  - Implement dual-state core behavior through skill package paths:
    - `.claude/skills/add-slack/modify/src/group-queue.ts`
    - `.claude/skills/add-slack/modify/src/index.ts`
    - `.claude/skills/add-slack/modify/src/db.ts`
    - `.claude/skills/add-slack/modify/src/config.ts`
  - Extend `manifest.yaml` modifies list for any newly covered core file(s) (notably `src/group-queue.ts`).
  - Implement frozen-window exhaustion semantics:
    - bounded retry window
    - exhaustion discard commit eligibility
    - no stale replay loop after exhaustion

  **Must NOT do**:
  - Do not hand-edit runtime `src/` as the implementation source of truth.
  - Do not add new subsystems (DLQ, new persistence layer, global breaker service).

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`add-slack`, `debug`]
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` (no UI scope)

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1
  - **Blocks**: T2, T3
  - **Blocked By**: None

  **References**:
  - `.claude/skills/add-slack/manifest.yaml` - skill apply contract and modified file allowlist.
  - `.claude/skills/add-slack/modify/src/index.ts` - existing modify workflow pattern.
  - `.claude/skills/add-slack/modify/src/db.ts` - existing skill-side DB modification pattern.
  - `src/group-queue.ts` - runtime target semantics for retries/exhaustion.
  - `src/index.ts` - runtime cursor and rollback behavior target.

  **Acceptance Criteria**:
  - [ ] Skill package contains all core changes required for dual-state semantics.
  - [ ] Exhaustion path has explicit stale-window discard semantics.
  - [ ] Retryable path still rolls back correctly when appropriate.
  - [ ] No stale replay loop under fake-timer tests.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Core dual-state semantics validated in undeployed test scope
    Tool: Bash
    Preconditions: Skill package changes authored under .claude/skills/add-slack/**
    Steps:
      1. Run `npm test -- src/group-queue.test.ts -t "exhaustion"`.
      2. Run `npm test -- src/index.recovery.test.ts -t "cursor matrix"`.
      3. Verify stale replay is blocked and discard path assertions pass.
    Expected Result: Exhaustion/discard semantics pass targeted tests.
    Failure Indicators: replay loop, wrong cursor commit, missing exhaustion transition.
    Evidence: .sisyphus/evidence/task-1-core-dual-state.txt

  Scenario: Invalid/missing recovery config falls back safely
    Tool: Bash
    Preconditions: Config fallback tests exist
    Steps:
      1. Run `RECOVERY_EXHAUSTED_GATE_MS=bad npm test -- src/config.test.ts -t "recovery config fallback"`.
      2. Verify assertions confirm default value usage.
    Expected Result: Invalid env input does not break behavior.
    Evidence: .sisyphus/evidence/task-1-config-fallback.txt
  ```

  **Commit**: NO

- [x] 2. Slack Recovery Bridge + Delivery Truthfulness

  **Execution State**: `undeployed`

  **What to do**:
  - Implement Slack reconnect recovery callback in skill package Slack files:
    - `.claude/skills/add-slack/add/src/channels/slack.ts`
    - `.claude/skills/add-slack/add/src/channels/slack.test.ts`
  - Wire callback consumption in skill-side index modify path so only `slack:` groups clear exhausted gate.
  - Ensure failed Slack send is treated as non-delivery for cursor decisioning (no false delivered path).

  **Must NOT do**:
  - Do not let Slack callback mutate non-Slack groups.
  - Do not alter breaker exit contract unless required by tests.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`add-slack`, `debug`]
  - **Skills Evaluated but Omitted**: `x-integration` (different channel stack)

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1
  - **Blocks**: T3
  - **Blocked By**: T1

  **References**:
  - `.claude/skills/add-slack/add/src/channels/slack.ts` - source of Slack watchdog/send behavior in skill package.
  - `.claude/skills/add-slack/add/src/channels/slack.test.ts` - watchdog and send failure test baseline.
  - `.claude/skills/add-slack/modify/src/index.ts` - orchestration bridge point.
  - `src/channels/slack.ts` - runtime target behavior for reconnect/send semantics.

  **Acceptance Criteria**:
  - [ ] Reconnect success emits recovery signal and clears Slack exhausted gate.
  - [ ] Duplicate recovery signals are idempotent.
  - [ ] Slack send failure does not mark output as delivered.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Reconnect clears gate and resumes pending Slack traffic
    Tool: Bash
    Preconditions: Slack callback tests and queue bridge tests implemented
    Steps:
      1. Run `npm test -- src/channels/slack.test.ts -t "reconnect clears exhausted gate"`.
      2. Run `npm test -- src/channels/slack.test.ts -t "recovery callback idempotent"`.
      3. Verify pending message resumes exactly once.
    Expected Result: Recovery signal is correct and idempotent.
    Failure Indicators: no resume, duplicate resume, or non-Slack impact.
    Evidence: .sisyphus/evidence/task-2-recovery-bridge.txt

  Scenario: Slack send failure is non-delivery
    Tool: Bash
    Preconditions: orchestrator recovery test covers failed Slack send
    Steps:
      1. Run `npm test -- src/index.recovery.test.ts -t "failed slack send is non-delivery"`.
      2. Verify `outputSentToUser` remains false in assertions.
    Expected Result: No false delivered state on Slack transport failure.
    Evidence: .sisyphus/evidence/task-2-delivery-truthfulness.txt
  ```

  **Commit**: YES (group A/B compact)
  - Message: `fix(recovery): implement dual-state exhaustion drop and slack recovery bridge`
  - Pre-commit: `npm run typecheck && npm test`

- [ ] 3. Deployed Validation via Skill Application + Integrated Failure Injection

  **Execution State**: `deployed`

  **What to do**:
  - Apply skill to runtime using established skill deployment flow.
  - Execute full validation in deployed state:
    - `npm run typecheck`
    - `npm test`
    - `npm run build`
  - Run integrated outage scenario:
    - outage -> retries -> exhaustion drop
    - recovery signal
    - new message post-recovery processed
  - Capture evidence artifacts for go/no-go.

  **Must NOT do**:
  - Do not bypass skill apply flow with manual runtime patching.
  - Do not claim pass without integrated outage scenario evidence.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`add-slack`, `debug`]
  - **Skills Evaluated but Omitted**: `writing` (this task is execution verification)

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: T4
  - **Blocked By**: T1, T2

  **References**:
  - `.claude/skills/add-slack/manifest.yaml` - definitive apply map.
  - `.sisyphus/plans/slack-roadmap-next-phase.md` - dual-state undeployed/deployed operating model.
  - `src/group-queue.ts`, `src/index.ts`, `src/channels/slack.ts` - runtime behavior expected post-apply.

  **Acceptance Criteria**:
  - [ ] Runtime files reflect skill-applied changes.
  - [ ] All build/test gates pass in deployed validation.
  - [ ] Integrated outage scenario proves no orphan + no stale replay + post-recovery new-message success.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Full deployed validation passes
    Tool: Bash
    Preconditions: skill applied to runtime successfully
    Steps:
      1. Run `npm run typecheck`.
      2. Run `npm test`.
      3. Run `npm run build`.
    Expected Result: All three commands pass without errors.
    Failure Indicators: type/build failures or test regressions in queue/index/slack suites.
    Evidence: .sisyphus/evidence/task-3-deployed-gates.txt

  Scenario: Integrated outage lifecycle succeeds
    Tool: Bash
    Preconditions: integration test harness exists (`src/recovery.integration.test.ts`)
    Steps:
      1. Run `npm test -- src/recovery.integration.test.ts -t "outage exhaustion recovery"`.
      2. Verify assertions for stale-window drop, recovery clear, and post-recovery new-message processing.
    Expected Result: End-to-end resilience behavior passes.
    Evidence: .sisyphus/evidence/task-3-integration-outage.txt
  ```

  **Commit**: YES
  - Message: `test(recovery): validate deployed outage exhaustion and recovery flow`
  - Pre-commit: `npm run typecheck && npm test && npm run build`

- [ ] 4. Canary Gates, Rollback Procedure, and Runbook Finalization

  **Execution State**: `deployed` then `undeployed` cleanup

  **What to do**:
  - Update Slack runbook and roadmap-linked notes with:
    - dual-state transitions and event taxonomy,
    - canary thresholds,
    - rollback commands aligned to commit groups.
  - Finalize a compact go/no-go checklist for production rollout.
  - Capture final evidence bundle paths.

  **Must NOT do**:
  - Do not leave canary criteria qualitative only.
  - Do not omit rollback trigger conditions.

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: [`debug`]
  - **Skills Evaluated but Omitted**: `artistry` (not needed for operator docs)

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Final Verification
  - **Blocked By**: T3

  **References**:
  - `.sisyphus/plans/slack-roadmap-next-phase.md` - governance and dual-state process style.
  - `.claude/skills/add-slack/SKILL.md` - operator-facing Slack skill behavior docs.
  - runtime event sources: `src/group-queue.ts`, `src/index.ts`, `src/channels/slack.ts`.

  **Acceptance Criteria**:
  - [ ] Runbook includes exact state transitions and operator actions.
  - [ ] Canary checklist has explicit numeric pass/fail thresholds.
  - [ ] Rollback sequence is command-complete and tested in dry run.

  **QA Scenarios (MANDATORY)**:

  ```text
  Scenario: Runbook aligns with emitted implementation events
    Tool: Bash
    Preconditions: integration scenario evidence available from Task 3
    Steps:
      1. Re-run `npm test -- src/recovery.integration.test.ts -t "outage exhaustion recovery"` to confirm event flow.
      2. Verify runbook event names/fields match observed assertions and logs.
    Expected Result: Docs and implementation event taxonomy match.
    Evidence: .sisyphus/evidence/task-4-runbook-alignment.txt

  Scenario: Canary + rollback checklist executable
    Tool: Bash
    Preconditions: checklist finalized
    Steps:
      1. Execute checklist commands (`npm run typecheck`, `npm test`, `npm run build`).
      2. Validate rollback command block syntax and trigger criteria completeness.
    Expected Result: Checklist is actionable and auditable.
    Evidence: .sisyphus/evidence/task-4-canary-rollback.txt
  ```

  **Commit**: YES
  - Message: `docs(recovery): finalize canary gates and rollback runbook`
  - Pre-commit: `npm run build`

---

## Final Verification Gate (Compact)

After T1-T4 complete, run these 4 checks in parallel and require all PASS:

- F1 (oracle): plan compliance against Must Have / Must NOT Have.
- F2 (quality): `npm run typecheck`, `npm test`, `npm run build` + changed-file hygiene.
- F3 (qa): replay all task QA scenarios and verify evidence files.
- F4 (scope): ensure no out-of-scope modifications and no cross-task contamination.

Output format:
`F1 [PASS/FAIL] | F2 [PASS/FAIL] | F3 [PASS/FAIL] | F4 [PASS/FAIL] | VERDICT`

---

## Commit Strategy

- Commit 1 (core behavior): after T2
  - `fix(recovery): implement dual-state exhaustion drop and slack recovery bridge`
- Commit 2 (validation): after T3
  - `test(recovery): validate deployed outage exhaustion and recovery flow`
- Commit 3 (ops/docs): after T4
  - `docs(recovery): finalize canary gates and rollback runbook`

---

## Success Criteria

```bash
npm run typecheck
npm test
npm run build
```

- [ ] Exhausted stale workload dropped exactly once
- [ ] Post-recovery new messages processed normally
- [ ] No permanent group orphaning
- [ ] Skill-first flow and dual-state development constraints respected
