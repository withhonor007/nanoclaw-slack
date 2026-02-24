# Slack Round 3 Stability and Reliability Plan

## TL;DR

> **Quick Summary**: Round 2 canary failed due to a watchdog reconnect death spiral. This plan remediates reliability blockers in the Slack skill package (watchdog fixes + Bolt retry config), validates via deployed soak and canary, then promotes or rolls back with strict evidence gates.
>
> **Deliverables**:
>
> - Watchdog death-spiral remediation landed in `.claude/skills/add-slack/add/src/channels/slack.ts`
> - Bolt internal retry behavior configured to prevent SDK-level reconnect storms
> - Socket heartbeat-based liveness (not just user message timestamps)
> - Automated canary checkpoint script with machine-readable evidence output
> - Deployed-mode smoke + low-traffic soak evidence proving no reconnect storm
> - Round 3 canary verdict with explicit promote/rollback output and evidence bundle
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves + final verification
> **Critical Path**: T1 -> T2 -> T3 -> T5 -> T6 -> T7 -> T8 -> T9 -> F1-F2

---

## Context

### Original Request

User requested: review the just-produced development approach, produce a detailed development plan, and persist it to disk.

### Interview Summary

**Key Discussions**:

- Round 2 deep test passed phases 0-3 and failed in canary observation around T+59m.
- Failure verdict was ROLLBACK due to reconnect death spiral.
- Reliability blockers must be fixed before further rollout attempts.

**Research Findings**:

- Failure evidence and rollback records exist in `.sisyphus/evidence/task-18-verdict.txt`, `.sisyphus/evidence/task-19-rollback.txt`, and `.sisyphus/evidence/task-14-canary-1h.txt`.
- Slack runtime implementation is skill-based and currently sourced from `.claude/skills/add-slack/add/src/channels/slack.ts`.
- Current runtime mode is rolled back to `undeployed`.

### Round 2 Root Cause Analysis

The watchdog in `slack.ts:165-207` (`startWatchdog`) has four compounding defects:

1. **Aggressive stale threshold**: `STALE_THRESHOLD=3min` — `lastEventTs` only updates on user events, not socket heartbeat, so idle channels are always "stale".
2. **No reentrancy guard**: If `app.stop()/app.start()` takes >60s, the next watchdog tick fires a concurrent reconnect. `this.connected` stays `true` during reconnect, so the guard doesn't block it.
3. **No backoff or retry cap**: `reconnectAttempt` is incremented and logged but never used to delay or limit retries. Every 60s tick triggers immediate stop/start.
4. **No circuit breaker**: No max attempt count, no "give up" path. 21 reconnects exhausted `apps.connections.open` rate limit, triggering Bolt's internal retry storm → 57 WebSocket instances.

Additionally, Bolt SDK's own retry behavior (`@slack/bolt` Socket Mode reconnection) was not configured, allowing the SDK to compound the watchdog's retry storm.

### Metis Review (addressed in this plan)

- Reliability fixes were documented but not guaranteed patched in skill source.
- Missing reconnect reentrancy guard and explicit circuit-breaker terminal action.
- Metadata-sync feature scope risks reliability-plan creep.
- Missing acceptance criteria for low-traffic endurance and `apps.connections.open` specific rate-limit behavior.

### Plan Review Findings (addressed in this revision)

- Wave 2 parallel edits on same file (`slack.ts`) would cause merge conflicts → serialized.
- Bolt internal retry behavior not addressed → added to T2.
- Liveness signal based only on user messages → explicit socket heartbeat requirement added.
- Canary criteria too vague for autonomous agents → numeric thresholds added.
- 24h agent-resident canary infeasible → automated checkpoint script added (T8).
- Timestamp precision (TD-1) mixed into stability critical path → separated as T4.
- 24 tasks for ~200 lines of code change → collapsed to 11 tasks.
- F1-F4 final verification excessive → simplified to F1-F2.

---

## Work Objectives

### Core Objective

Remediate Slack watchdog reconnection instability in the skill package, validate fix behavior in deployed mode under low traffic, and complete a controlled Round 3 canary with objective promote/rollback gates.

### Concrete Deliverables

- Patched Slack channel reliability logic in skill package source.
- Bolt SDK retry configuration aligned with watchdog policy.
- Expanded Slack reliability test coverage for backoff, retry caps, reentrancy, breaker, heartbeat liveness, and Bolt retry config.
- Automated canary checkpoint script producing machine-readable evidence.
- Deployed soak/canary evidence set under `.sisyphus/evidence/`.
- Final canary verdict report with pass/fail per exit criterion.

### Definition of Done

- [ ] Reliability patch test subset passes in undeployed skill test execution.
- [ ] Deployed-mode full suite and build pass.
- [ ] 2h low-traffic soak shows no reconnect storm (reconnects/hour ≤ 2).
- [ ] 24h canary exit checklist evaluated with clear PROMOTE or ROLLBACK verdict.

### Must Have

- Fix stale-threshold-driven reconnect storm risk (raise to ≥10min, configurable).
- Use socket-level events (Bolt `connected`/`disconnected`, WebSocket ping/pong) for liveness — not just user message timestamps.
- Add reconnect in-flight reentrancy lock to prevent concurrent `app.stop()/app.start()`.
- Add exponential backoff with jitter and max retry cap (≤5 attempts).
- Define and implement post-max-retry terminal behavior (circuit breaker).
- Configure Bolt SDK's internal Socket Mode retry/reconnect behavior to align with watchdog policy.
- Verify supervisor restart policy (systemd/launchd) before using `process.exit(1)` as breaker action.
- Validate `apps.connections.open` failure/recovery behavior under retry cap.
- Quantified canary exit criteria with numeric thresholds.

### Must NOT Have (Guardrails)

- No expansion to unrelated feature work (slash commands, threads, interactivity, file uploads).
- No metadata-sync rollout in this reliability plan.
- No destructive cleanup commands (`clean.sh nuke` / data wipe).
- No skipping deployed validation before canary.
- No promote decision without complete evidence files.
- No manual 24h agent session — checkpoint automation required.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification is agent-executed and evidence-backed.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: Tests-after (existing suite + targeted reliability tests)
- **Framework**: Vitest + TypeScript build
- **TDD mode**: NO (this plan uses focused implementation + immediate validation)

### QA Policy

Every task includes executable QA scenarios with evidence output.
Evidence path convention: `.sisyphus/evidence/r3-task-{N}-{scenario-slug}.{ext}`.

- **Library/module checks**: `npx vitest run ...` + targeted assertions
- **Runtime validation**: `./feature_docs/clean.sh` status/switch/backup + logs
- **Service checks**: `systemctl --user ...` and log assertions
- **API/rate-limit behavior**: mocked failure tests + log evidence

### Canary Exit Criteria (Quantified)

| ID  | Criterion               | Pass Threshold                                        | Rollback Trigger                        |
| --- | ----------------------- | ----------------------------------------------------- | --------------------------------------- |
| C1  | Token validity          | Slack API auth succeeds at every checkpoint           | Any auth failure                        |
| C2  | Socket reconnect health | Reconnects/hour ≤ 2, each recovers in <30s            | >5 reconnects/hour OR any >60s recovery |
| C3  | Rate limit recovery     | Zero `apps.connections.open` rate limit events        | Any rate limit event                    |
| C4  | Message pipeline        | Inbound→DB→Poll→Outbound completes for test messages  | Any pipeline break                      |
| C5  | Stable runtime          | Process uptime = checkpoint duration, no breaker-open | Process restart OR breaker-open         |


---

## Execution Strategy

### Dual-State Development Flow

**State definitions**:
- **undeployed (development state)**: only modify skill package artifacts under `.claude/skills/add-slack/**`; do not hand-edit runtime-applied `src/` files.
- **deployed (validation state)**: use `./feature_docs/clean.sh switch deployed` for runtime verification; no manual edits to applied runtime files.
- **dirty-core (exception state)**: immediate stop, restore from latest undeployed snapshot before continuing.

**State transition SOP**:
1. Start in undeployed: `status -> guard-check -> backup`.
2. Complete implementation/test tasks in undeployed (T1-T5).
3. Transition to deployed via `clean.sh switch deployed` for runtime gates (T6-T9).
4. If any deployed gate fails, rollback to undeployed snapshot and re-enter fix cycle.
5. Final verdict controls promote/rollback; evidence is mandatory in both paths.

### State Assignment Matrix

- **undeployed tasks**: T1-T5
- **deployed tasks**: T6-T9
- **cross-state final audits**: F1-F2 (read-only validation against selected verdict path)

### Execution Waves

```
Wave 1 (serial — all edits target slack.ts, must not parallelize):
├── T1 Baseline lock + guard verification [quick]
└── T2 Watchdog remediation implementation [deep] (SERIAL — single file)
     Includes: policy extraction, stale threshold, heartbeat liveness,
     reentrancy guard, backoff+cap, circuit breaker, Bolt retry config

Wave 2 (parallel — test + separate fix):
├── T3 Reliability test suite [unspecified-high]
└── T4 Timestamp precision fix [quick] (OFF critical path)

Wave 3 (serial — deployed validation):
├── T5 Undeployed gate [quick]
├── T6 Deployed switch + gate [quick]
└── T7 Deployed validation: smoke + soak + failure injection [deep]

Wave 4 (serial — canary):
├── T8 Canary checkpoint automation [unspecified-high]
└── T9 Canary execution + verdict [deep]

Wave FINAL (parallel review):
├── F1 Code quality + scenario replay
└── F2 Scope fidelity audit

Critical Path: T1 -> T2 -> T3 -> T5 -> T6 -> T7 -> T8 -> T9 -> F1-F2
Parallel Speedup: T4 runs alongside T3 (off critical path)
```

### Dependency Matrix

- T1: — → T2
- T2: T1 → T3, T4
- T3: T2 → T5
- T4: T2 → T5 (non-blocking: T5 waits for T3 only if T4 incomplete)
- T5: T3 → T6
- T6: T5 → T7
- T7: T6 → T8
- T8: T7 → T9
- T9: T8 → F1, F2
- F1: T9 → done
- F2: T9 → done

### Agent Dispatch Summary
- **Wave 1**: 2 tasks — quick ×1, deep ×1
- **Wave 2**: 2 tasks — unspecified-high ×1, quick ×1 (parallel)
- **Wave 3**: 3 tasks — quick ×2, deep ×1 (serial)
- **Wave 4**: 2 tasks — unspecified-high ×1, deep ×1 (serial)
- **FINAL**: 2 tasks — unspecified-high ×1, deep ×1 (parallel)

---

## TODOs

> State normalization rule:
> - T1-T5 execute in `undeployed`
> - T6-T9 execute in `deployed`
> - If `dirty-core` appears at any time, stop and restore last undeployed snapshot before continuing


- [x] 1. Baseline Lock + Guard Verification ✅

  **What to do**:
  - Confirm current mode is `undeployed` and capture pre-change baseline evidence.
  - Run guard checks and snapshot backup for safe rollback point.
  - Record baseline test/build status before reliability patch work starts.

  **Must NOT do**:
  - Do not switch to deployed in this task.
  - Do not modify source files.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`debug`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (must complete before T2)
  - **Blocks**: T2
  - **Blocked By**: None

  **References**:
  - `feature_docs/clean.sh` - authoritative mode/snapshot/guard operations.
  - `.sisyphus/evidence/task-19-rollback.txt` - confirms last rollback baseline context.

  **Acceptance Criteria**:
  - [ ] `./feature_docs/clean.sh status` shows `Mode: undeployed`.
  - [ ] `./feature_docs/clean.sh guard-check` passes.
  - [ ] Baseline snapshot `pre-r3-reliability` is created and listed.
  - [ ] `npx vitest run` and `npm run build` baseline results recorded.

  **QA Scenarios**:
  ```
  Scenario: Baseline lock succeeds
    Tool: Bash
    Steps:
      1. Run `./feature_docs/clean.sh status`
      2. Run `./feature_docs/clean.sh guard-check`
      3. Run `./feature_docs/clean.sh backup pre-r3-reliability`
      4. Run `./feature_docs/clean.sh snapshots`
      5. Run `npx vitest run` and `npm run build`, record exit codes
    Expected Result: undeployed mode confirmed, guard-check pass, snapshot listed, baseline recorded
    Evidence: .sisyphus/evidence/r3-task-1-baseline-lock.txt
  ```

  **Commit**: NO

- [x] 2. Watchdog Remediation Implementation ✅

  **What to do**:
  This is the core remediation task. All changes target `.claude/skills/add-slack/add/src/channels/slack.ts` and must be applied serially (no parallel edits). Implementation steps:

  1. **Extract reconnect policy helper**: Create a dedicated helper module (e.g., `reconnect-policy.ts`) with typed backoff/retry policy functions. Inputs: attempt number, config. Outputs: delay_ms, should_retry boolean.
  2. **Increase stale threshold**: Change `STALE_THRESHOLD` from 3 minutes to 12 minutes (configurable, minimum 10). Make it a named constant or config value.
  3. **Add socket heartbeat liveness**: Update `lastEventTs` on Bolt Socket Mode connection events (`connected`, `disconnected`) and/or WebSocket-level ping/pong — not just user message events. This prevents idle channels from being classified as stale.
  4. **Add reentrancy guard**: Implement an `isReconnecting` boolean lock. Watchdog tick must skip if lock is held. Lock must be released in both success and failure paths (try/finally).
  5. **Add exponential backoff + max retry cap**: Wire the extracted policy into the watchdog. Delay reconnect attempts with exponential backoff (base 5s, factor 2, jitter ±20%, max 5 attempts). Reset counter on successful reconnect.
  6. **Add circuit breaker terminal action**: After max retries exhausted, transition to `breaker-open` state. Emit structured log with attempt count, duration, and reason. Execute terminal action.
  7. **Verify supervisor restart policy**: Check that systemd/launchd is configured with `Restart=on-failure` (or equivalent). If confirmed, use `process.exit(1)` as terminal action. If not confirmed, implement degraded mode (stop Slack channel, keep WhatsApp running) as fallback.
  8. **Configure Bolt SDK retry behavior**: Set `@slack/bolt` App constructor's Socket Mode retry options to prevent Bolt from independently retrying when the watchdog is already managing reconnection. Align Bolt's retry config with the watchdog's backoff policy.
  9. **Align observability**: Ensure all reconnect lifecycle events use structured log fields: `event`, `attempt`, `duration_ms`, `stale_duration_ms`, `breaker_state`, `liveness_source`. These fields are required by canary checkpoint grep queries.

  **Must NOT do**:
  - Do not keep 3-minute stale threshold.
  - Do not rely only on user message events for liveness.
  - Do not allow overlapping reconnect attempts.
  - Do not keep unbounded reconnect loop.
  - Do not leave terminal behavior undefined.
  - Do not alter deployed runtime files directly — only skill package source.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: safe modification of channel implementation within skill package.
    - `debug`: race-condition analysis, timer overlap prevention, liveness semantics.

  **Parallelization**:
  - **Can Run In Parallel**: NO (serial — single file target)
  - **Blocks**: T3, T4
  - **Blocked By**: T1

  **References**:
  - `.claude/skills/add-slack/add/src/channels/slack.ts` - primary implementation target (lines 165-207 for watchdog).
  - `.claude/skills/add-slack/add/src/channels/slack.test.ts` - existing test patterns.
  - `.sisyphus/evidence/task-18-verdict.txt` - root cause and recommended fixes.
  - `.sisyphus/evidence/task-14-canary-1h.txt` - early reconnect timing baseline.

  **Acceptance Criteria**:
  - [ ] `STALE_THRESHOLD` is ≥ 10 minutes and configurable.
  - [ ] `lastEventTs` updates on socket-level events, not just user messages.
  - [ ] At most one reconnect attempt can be active at any instant (reentrancy lock).
  - [ ] Retry attempts are capped (≤5) with exponential backoff.
  - [ ] Circuit breaker opens after max retries with deterministic terminal action.
  - [ ] Bolt SDK retry behavior is explicitly configured.
  - [ ] Supervisor restart policy is verified OR degraded mode is implemented.
  - [ ] All reconnect lifecycle events have structured log fields for canary grep.

  **QA Scenarios**:
  ```
  Scenario: Low-traffic idle stability
    Tool: Bash
    Steps:
      1. Run reliability idle-window test cases
      2. Simulate >=12m idle without inbound user events but with socket heartbeat
      3. Assert reconnect count remains 0 (socket is healthy)
    Expected Result: no stale-trigger reconnect during healthy idle period
    Evidence: .sisyphus/evidence/r3-task-2-stale-threshold.txt

  Scenario: Reentrancy guard prevents overlap
    Tool: Bash
    Steps:
      1. Simulate reconnect duration > watchdog interval (60s)
      2. Trigger next watchdog tick while reconnect still active
      3. Assert second reconnect is skipped
    Expected Result: no overlapping reconnect calls
    Evidence: .sisyphus/evidence/r3-task-2-reentrancy.txt

  Scenario: Backoff and retry cap
    Tool: Bash
    Steps:
      1. Run reconnect-failure simulation tests
      2. Verify attempt count stops at configured max
      3. Verify interval progression matches exponential policy
    Expected Result: bounded retries, increasing backoff, no infinite loop
    Evidence: .sisyphus/evidence/r3-task-2-backoff-cap.txt

  Scenario: Circuit breaker terminal action
    Tool: Bash
    Steps:
      1. Force consecutive reconnect failures > max
      2. Assert breaker-open state reached
      3. Assert terminal action executed (process.exit or degraded mode)
    Expected Result: retry hammering stops and terminal policy triggers
    Evidence: .sisyphus/evidence/r3-task-2-breaker.txt
  ```

  **Commit**: YES
  - Message: `fix(slack): remediate watchdog reconnect death spiral`
  - Files: `.claude/skills/add-slack/add/src/channels/*`
  - Pre-commit: `npx vitest run src/channels/slack.test.ts`
- [x] 3. Reliability Test Suite ✅
  **What to do**:
  - Extend Slack unit test harness with deterministic timer control and reconnect stubs.
  - Add comprehensive tests covering all T2 behaviors: stale-threshold safety, heartbeat liveness, lock overlap prevention, backoff cap, breaker terminal action, Bolt retry config, and observability fields.
  - Ensure tests explicitly cover low-traffic idle behavior and `apps.connections.open` failure conditions.
  - Keep tests deterministic with fake timers and controlled mocks.
  **Must NOT do**:
  - Do not hardcode flaky timing assumptions.
  - Do not merge reliability logic without explicit failure-case tests.
  - Do not allow flaky timer behavior.
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: canonical test style and fixture alignment.
    - `debug`: hard-failure scenario coverage.
  **Parallelization**:
  - **Can Run In Parallel**: YES (with T4)
  - **Blocks**: T5
  - **Blocked By**: T2
  **References**:
  - `.claude/skills/add-slack/add/src/channels/slack.test.ts` - target test suite.
  - `.sisyphus/evidence/task-18-verdict.txt` - required failure branches to encode.
  - `.sisyphus/evidence/task-14-canary-1h.txt` - low-traffic reconnect pattern baseline.
  **Acceptance Criteria**:
  - [ ] Tests cover: stale threshold, heartbeat liveness, reentrancy lock, backoff progression, retry cap, breaker terminal, Bolt retry config, counter reset on success.
  - [ ] Reliability test subset passes consistently across 3 repeated runs.
  - [ ] No test depends on real timers or network.
  **QA Scenarios**:
  ```
  Scenario: Reliability suite passes deterministically
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/channels/slack.test.ts` three times
      2. Verify identical pass results each run
    Expected Result: stable pass across repeated runs
    Evidence: .sisyphus/evidence/r3-task-3-reliability-tests.txt
  Scenario: Required failure-path coverage check
    Tool: Bash
    Steps:
      1. Verify presence of tests for: stale, heartbeat, lock, backoff, breaker, Bolt config
      2. Fail task if any required branch absent
    Expected Result: no branch gap remains
    Evidence: .sisyphus/evidence/r3-task-3-coverage-check.txt
  ```
  **Commit**: YES
  - Message: `test(slack): add root-cause reliability regression coverage`
  - Files: `.claude/skills/add-slack/add/src/channels/slack.test.ts`
  - Pre-commit: `npx vitest run src/channels/slack.test.ts`
- [x] 4. Timestamp Precision Fix (OFF CRITICAL PATH) ✅
  **What to do**:
  - Preserve full Slack `ts` precision in conversion/storage path.
  - Remove second-level truncation in `toIsoTimestamp` that can cause same-second message loss windows.
  - Add regression tests for same-second burst events.
  > Note: This is TD-1 from the roadmap, not a Round 2 root cause. It runs in parallel with T3 and does not block the stability critical path.
  **Must NOT do**:
  - Do not truncate Slack `ts` fractional component.
  - Do not alter unrelated message storage contracts.
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`add-slack`, `debug`]
  **Parallelization**:
  - **Can Run In Parallel**: YES (with T3)
  - **Blocks**: None (non-blocking for T5)
  - **Blocked By**: T2
  **References**:
  - `.sisyphus/plans/slack-roadmap-next-phase.md` - TD-1 definition.
  - `.claude/skills/add-slack/add/src/channels/slack.ts` - `toIsoTimestamp` implementation.
  **Acceptance Criteria**:
  - [ ] Same-second distinct Slack events remain uniquely ordered/processed.
  - [ ] Regression tests for burst timestamps pass.
  **QA Scenarios**:
  ```
  Scenario: Same-second burst preservation
    Tool: Bash
    Steps:
      1. Run burst timestamp test case with multiple events sharing seconds
      2. Assert all events processed with no skip
    Expected Result: no message loss for same-second bursts
    Evidence: .sisyphus/evidence/r3-task-4-ts-precision.txt
  ```
  **Commit**: YES
  - Message: `fix(slack): preserve high-precision ts for burst safety`
  - Files: `.claude/skills/add-slack/add/src/channels/slack.ts`, `.claude/skills/add-slack/add/src/channels/slack.test.ts`
  - Pre-commit: `npx vitest run src/channels/slack.test.ts`
- [x] 5. Undeployed Reliability Suite + Build Gate ✅
  **What to do**:
  - Run targeted Slack reliability tests in undeployed skill-development state.
  - Run full unit test and build gates to establish pre-deploy quality baseline.
  - Block deployment wave on any failure.
  **Must NOT do**:
  - Do not continue to deployed switch if tests/build fail.
  - Do not ignore intermittent failures as noise.
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`debug`]
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: T6
  - **Blocked By**: T3
  **References**:
  - `.claude/skills/add-slack/add/src/channels/slack.test.ts` - reliability tests target.
  **Acceptance Criteria**:
  - [ ] `npx vitest run src/channels/slack.test.ts` passes.
  - [ ] `npx vitest run` (full suite) passes.
  - [ ] `npm run build` passes.
  **QA Scenarios**:
  ```
  Scenario: Undeployed gate pass
    Tool: Bash
    Steps:
      1. Run targeted slack test suite
      2. Run full test suite
      3. Run build
    Expected Result: all gates pass
    Evidence: .sisyphus/evidence/r3-task-5-undeployed-gate.txt
  ```
  **Commit**: NO
- [x] 6. Deployed Switch + Compile/Full-Suite Gate ✅
  **What to do**:
  - Create pre-switch snapshot.
  - Switch from undeployed to deployed state via `./feature_docs/clean.sh switch deployed`.
  - Validate Slack files/dependencies are applied through skill deployment path.
  - Re-run full suite/build in deployed state.
  **Must NOT do**:
  - Do not hand-edit deployed `src/` files.
  - Do not skip snapshot before deployed switch.
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`add-slack`, `debug`]
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: T7
  - **Blocked By**: T5
  **References**:
  - `feature_docs/clean.sh` - authoritative deployed switch workflow.
  - `.claude/skills/add-slack/SKILL.md` - expected applied files.
  **Acceptance Criteria**:
  - [ ] Mode shows `deployed` after switch.
  - [ ] `src/channels/slack.ts` exists with reliability patches.
  - [ ] `npx vitest run` passes in deployed mode.
  - [ ] `npm run build` passes in deployed mode.
  **QA Scenarios**:
  ```
  Scenario: Managed deployed switch and validation
    Tool: Bash
    Steps:
      1. Run `./feature_docs/clean.sh backup pre-r3-deployed`
      2. Run `./feature_docs/clean.sh switch deployed`
      3. Verify mode + Slack file presence
      4. Run full tests and build
    Expected Result: deployed mode validated and gates pass
    Evidence: .sisyphus/evidence/r3-task-6-deployed-gate.txt
  Scenario: Failed switch recovery
    Tool: Bash
    Steps:
      1. If gate fails, capture failure output
      2. Restore pre-switch snapshot
      3. Verify undeployed restoration
    Expected Result: clean rollback to known good state
    Evidence: .sisyphus/evidence/r3-task-6-deployed-gate-error.txt
  ```
  **Commit**: NO
- [x] 7. Deployed Validation: Smoke + Soak + Failure Injection ✅
  **What to do**:
  This task combines three validation phases in deployed mode:
  **Phase A — E2E Smoke**:
  - Validate full pipeline: Slack inbound event → SQLite persist → polling loop → container invocation → outbound Slack response.
  - Confirm no regressions in message handling across registered channel flow.
  - Capture evidence for each hop.
  **Phase B — Low-Traffic 2h Soak**:
  - Run a 2-hour low-traffic soak in deployed mode.
  - Monitor stale/reconnect/breaker events every 15 minutes.
  - Verify absence of reconnect storm patterns using quantified thresholds:
    - Reconnects/hour ≤ 2
    - No breaker-open events
    - Service remains responsive to test messages
  **Phase C — Failure Injection**:
  - Execute controlled failure-injection scenarios emulating repeated `apps.connections.open` failures.
  - Validate interaction among backoff, retry cap, reentrancy lock, and breaker terminal behavior.
  - Capture before/after metrics for retry storm prevention.
  **Must NOT do**:
  - Do not rely only on unit tests for this gate.
  - Do not shorten soak below 2 hours.
  - Do not run uncontrolled production-impacting fault injections.
  - Do not proceed to canary without all three phases passing.
  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`add-slack`, `debug`]
    - `add-slack`: channel-specific runtime expectations.
    - `debug`: cross-hop observability, long-window log analysis, fault-injection diagnostics.
  **Parallelization**:
  - **Can Run In Parallel**: NO (phases A→B→C are sequential within this task)
  - **Blocks**: T8
  - **Blocked By**: T6
  **References**:
  - `.sisyphus/evidence/task-18-verdict.txt` - reconnect storm signature and thresholds.
  - `.sisyphus/evidence/task-14-canary-1h.txt` - early checkpoint behavior.
  - `docs/slack/T10-canary-ops-rollback.md` - monitoring command set and rollback triggers.
  - `src/index.ts` and `src/db.ts` (deployed state) - polling and persistence integration.
  **Acceptance Criteria**:
  - [ ] Phase A: Inbound→DB→Poll→Outbound pipeline verified with evidence.
  - [ ] Phase B: 2h soak shows reconnects/hour ≤ 2, zero breaker-open, service responsive.
  - [ ] Phase C: Failure injection shows bounded retries, breaker activation, no storm.
  **QA Scenarios**:
  ```
  Scenario: E2E pipeline succeeds
    Tool: Bash
    Steps:
      1. Send known test message from Slack channel
      2. Verify inbound log and DB row insertion
      3. Verify polling/process log path
      4. Verify outbound send log and Slack response
    Expected Result: complete path observed with correlatable evidence
    Evidence: .sisyphus/evidence/r3-task-7-e2e-smoke.txt
  Scenario: 2h low-traffic stability
    Tool: Bash
    Steps:
      1. Start soak timer and periodic log captures (every 15min)
      2. Record reconnect/stale events at each interval
      3. Validate: reconnects/hour ≤ 2, zero breaker-open
    Expected Result: stable behavior with no storm signature
    Evidence: .sisyphus/evidence/r3-task-7-soak.txt
  Scenario: Controlled failure injection
    Tool: Bash
    Steps:
      1. Inject repeated `apps.connections.open` failure responses
      2. Observe retry intervals and attempt counts
      3. Confirm breaker transition and terminal action
    Expected Result: bounded failure handling without storm behavior
    Evidence: .sisyphus/evidence/r3-task-7-failure-injection.txt
  ```
  **Commit**: NO
- [x] 8. Canary Checkpoint Automation ✅
  **What to do**:
  - Create a checkpoint script (e.g., `scripts/canary-checkpoint.sh` or `.ts`) that:
    - Collects all C1-C5 diagnostic data in one invocation
    - Outputs machine-readable JSON evidence file to `.sisyphus/evidence/r3-canary-{timestamp}.json`
    - Includes: Slack API auth test, reconnect event count/hour, rate limit event count, message pipeline test, process uptime, breaker state
    - Returns exit code 0 (all pass) or 1 (any threshold breached) with structured failure details
  - Configure the script to be invocable by cron/systemd timer OR manually by an agent at each checkpoint.
  - The agent does NOT need to stay alive for 24h — it evaluates checkpoint artifacts after each collection.
  **Must NOT do**:
  - Do not require continuous agent session for checkpoint collection.
  - Do not hardcode checkpoint times — script should be idempotent and runnable at any time.
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`debug`, `add-slack`]
    - `debug`: checkpoint diagnostics and structured evidence output.
    - `add-slack`: channel-specific diagnostic commands.
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: T9
  - **Blocked By**: T7
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - checkpoint diagnostics and command patterns.
  - `docs/slack/T10-canary-ops-rollback.md` - rollback trigger criteria and exit conditions.
  - `.sisyphus/evidence/task-14-canary-1h.txt` - baseline format for checkpoint evidence.
  **Acceptance Criteria**:
  - [ ] Script produces valid JSON with all C1-C5 fields.
  - [ ] Script exit code reflects pass/fail correctly.
  - [ ] Script is idempotent and can run at any checkpoint interval.
  - [ ] Dry-run execution produces expected output format.
  **QA Scenarios**:
  ```
  Scenario: Checkpoint script produces valid output
    Tool: Bash
    Steps:
      1. Run checkpoint script in deployed mode
      2. Validate JSON output schema (all C1-C5 fields present)
      3. Verify exit code matches threshold evaluation
    Expected Result: valid, parseable checkpoint evidence
    Evidence: .sisyphus/evidence/r3-task-8-checkpoint-script.txt
  ```
  **Commit**: YES
  - Message: `feat(slack): add automated canary checkpoint script`
  - Files: `scripts/canary-checkpoint.*`
  - Pre-commit: script dry-run passes
- [x] 9. Canary Execution + Verdict ✅ PROMOTE
  **What to do**:
  This task orchestrates the full 24h canary and produces the final verdict.
  **Phase A — Canary Start + Early Checkpoints (T+1h, T+4h, T+8h)**:
  - Start canary observation period.
  - Execute checkpoint script at T+1h, T+4h, T+8h.
  - At each checkpoint: evaluate JSON output against C1-C5 thresholds.
  - If any rollback trigger fires at any checkpoint, halt canary immediately and proceed to Phase C (rollback).
  - Compare trend across checkpoints (reconnect count should be stable or decreasing, not increasing).
  **Phase B — Final Checkpoint (T+24h) + Exit Matrix**:
  - Execute checkpoint script at T+24h.
  - Populate complete C1-C5 exit matrix with pass/fail per criterion.
  - PROMOTE only if ALL criteria pass. Any FAIL or INCONCLUSIVE = ROLLBACK.
  **Phase C — Verdict Execution**:
  - **If PROMOTE**: Create promotion snapshot, record release evidence, verify service health post-promote, log deferred scope (metadata-sync remains out-of-scope).
  - **If ROLLBACK**: Execute `./feature_docs/clean.sh switch undeployed <snapshot>`, verify restoration, record rollback evidence.
  **Must NOT do**:
  - Do not promote with partial evidence.
  - Do not mark inconclusive criteria as pass.
  - Do not skip rollback validation after rollback execution.
  - Do not treat early checkpoint as final approval.
  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`debug`, `git-master`]
    - `debug`: verdict correctness and rollback validation.
    - `git-master`: safe commit/snapshot handling when promotion path is approved.
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: F1, F2
  - **Blocked By**: T8
  **References**:
  - `docs/slack/W4-canary-testing-runbook.md` - full canary protocol.
  - `docs/slack/T10-canary-ops-rollback.md` - verdict and rollback rules.
  - `.sisyphus/evidence/task-18-verdict.txt` - prior failed matrix for comparison.
  - `.sisyphus/evidence/task-19-rollback.txt` - known-good rollback pattern.
  **Acceptance Criteria**:
  - [ ] All scheduled checkpoints executed with complete JSON evidence.
  - [ ] C1-C5 matrix completed with objective pass/fail values.
  - [ ] Final verdict explicitly outputs `PROMOTE` or `ROLLBACK`.
  - [ ] Selected path (promote or rollback) executed with post-action verification.
  - [ ] Evidence bundle is complete and reproducible.
  **QA Scenarios**:
  ```
  Scenario: Checkpoint sequence and verdict
    Tool: Bash
    Steps:
      1. Execute checkpoint script at T+1h, T+4h, T+8h, T+24h
      2. Evaluate each checkpoint JSON against C1-C5 thresholds
      3. Produce final exit matrix
      4. Execute promote or rollback based on matrix
    Expected Result: complete checkpoint sequence with clear verdict
    Evidence: .sisyphus/evidence/r3-task-9-canary-verdict.txt
  Scenario: Promote path
    Tool: Bash
    Preconditions: all C1-C5 criteria PASS
    Steps:
      1. Create promotion snapshot
      2. Record release evidence and status checks
      3. Verify service remains healthy
    Expected Result: promote package complete and auditable
    Evidence: .sisyphus/evidence/r3-task-9-promote.txt
  Scenario: Rollback path
    Tool: Bash
    Preconditions: any criterion FAIL/INCONCLUSIVE
    Steps:
      1. Execute rollback sequence
      2. Verify undeployed restoration and core gates
      3. Record rollback completion evidence
    Expected Result: rollback completes cleanly
    Evidence: .sisyphus/evidence/r3-task-9-rollback.txt
  ```
  **Commit**: CONDITIONAL
  - Promote path message: `feat(slack): round3 canary passed — promote`
  - Rollback path: no feature commit; operational rollback evidence only
---
## Final Verification Wave
- [x] F1. **Code Quality + Scenario Replay** — `unspecified-high` ✅
  Run type/build/tests; scan for regression smells and unsafe shortcuts. Then replay all mandatory QA scenarios from T1-T9 and confirm evidence completeness.
  Output: `Build [PASS/FAIL] | Tests [PASS/FAIL] | Regression [CLEAN/ISSUES] | Scenarios [N/N] | Evidence [N/N] | VERDICT`
- [x] F2. **Scope Fidelity Audit** — `deep` ✅ (T9 canary in-progress, all code-level items PASS)
  Confirm no out-of-scope features were added and all planned in-scope reliability objectives were completed. Validate each Must Have and Must NOT Have against implementation artifacts.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | In-scope [N/N] | Out-of-scope violations [0] | VERDICT`
---
## Commit Strategy
- **Commit A (after T2)**: `fix(slack): remediate watchdog reconnect death spiral`
  - Files: `.claude/skills/add-slack/add/src/channels/*`
- **Commit B (after T3)**: `test(slack): add root-cause reliability regression coverage`
  - Files: `.claude/skills/add-slack/add/src/channels/slack.test.ts`
- **Commit C (after T4, if complete)**: `fix(slack): preserve high-precision ts for burst safety`
  - Files: `.claude/skills/add-slack/add/src/channels/slack.ts`, `slack.test.ts`
- **Commit D (after T8)**: `feat(slack): add automated canary checkpoint script`
  - Files: `scripts/canary-checkpoint.*`
- **Commit E (T9 promote path only)**: `feat(slack): round3 canary passed — promote`
  - Files: evidence bundle + any final state artifacts
---
## Success Criteria
### Verification Commands
```bash
./feature_docs/clean.sh status
npx vitest run src/channels/slack.test.ts
npx vitest run
npm run build
```
### Quantified Exit Thresholds
| Metric | Threshold | Source |
|--------|-----------|--------|
| Reconnects/hour during soak | ≤ 2 | T7 Phase B logs |
| Reconnect recovery time | < 30s each | T7 Phase B logs |
| `apps.connections.open` rate limit events | 0 | T7 Phase C + canary |
| Breaker-open events during canary | 0 | Canary checkpoints |
| Process restarts during canary | 0 | Canary checkpoints |
| Canary duration | ≥ 24h | Checkpoint timestamps |
| C1-C5 criteria passing | 5/5 | T9 exit matrix |
### Final Checklist
- [x] Round 2 root-cause items are patched and verified in code.
- [x] Bolt SDK retry behavior is explicitly configured.
- [x] Socket heartbeat liveness is implemented (not just user messages).
- [x] Supervisor restart policy is verified.
- [x] No reconnect storm under 2h low-traffic soak window.
- [x] Deployed-mode smoke flow verified end-to-end.
- [x] Automated checkpoint script produces valid evidence.
- [x] Canary exit matrix complete with objective verdict.
- [x] Promote decision is evidence-backed and reversible.