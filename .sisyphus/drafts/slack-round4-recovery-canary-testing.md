# Draft: Slack Round 4 Recovery Canary Testing

## Requirements (confirmed)
- User requested a formal next-step testing plan based on `docs/slack/W4-canary-testing-runbook.md`.
- Plan output must be written to `.sisyphus/plans/` and reviewed before handoff.
- Focus is the next canary testing phase after dual-state recovery implementation.

## Technical Decisions
- Planning target: Round-4 canary focused on dual-state recovery correctness and production safety.
- Reuse W4 workflow as baseline, but execute as a delta/addendum rather than rewriting W4 from scratch.
- Keep scope locked to testing and canary tooling/docs; avoid unrelated architecture refactors.
- Keep recovery C6+ metrics informational first where thresholds are unproven; keep hard gates on validated C1-C5 plus corrected criteria.

## Research Findings
- Current state: deployed validation path, 31 test files and 413 passing tests.
- Existing canary tooling:
  - `scripts/slack/canary-checkpoint.sh`
  - `scripts/slack/soak-monitor.sh`
- Existing docs:
  - `docs/slack/W4-canary-testing-runbook.md`
  - `docs/slack/T10-canary-ops-rollback.md`
  - `docs/slack/dual-state-recovery-runbook.md`
- Runtime recovery events discovered:
  - `src/group-queue.ts`: `exhaustion_drop`, `exhaustion_drop_callback_error`
  - `src/index.ts`: `send_failed_non_delivery`, `slack_recovery_resume`, `cursor_commit_on_exhaustion`
  - `src/channels/slack.ts`: `socket_*`, `slack_rate_limited`, `slack_send_failed`, `recovery_callback_error`, `breaker_open`
- Coverage gaps:
  - No `src/index.test.ts`
  - Some index-level recovery branches untested directly
- Metis critical findings:
  - `canary-checkpoint.sh` PID grep pattern likely mismatched to pino-pretty output
  - C3 rate-limit logic inversion risk
  - C4 does not currently enforce message-count/idempotency gate
  - `soak-monitor.sh` PID staleness risk on restart
  - hardcoded `r3-` evidence naming should be updated for Round-4

## Open Questions
- none blocking for planning

## Scope Boundaries
- INCLUDE:
  - Recovery-focused test additions and canary tool corrections
  - Round-4 canary execution plan and evidence protocol
  - Runbook addendum updates and go/no-go criteria
- EXCLUDE:
  - New product features outside testing/canary scope
  - Broad `src/index.ts` refactor beyond testability-related minimal changes
  - Rewriting entire W4 manual from scratch
