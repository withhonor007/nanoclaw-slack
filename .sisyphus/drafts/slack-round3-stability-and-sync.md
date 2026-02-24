# Draft: Slack Round 3 Stability and Sync

## Requirements (confirmed)
- User request: review the just-produced development approach and write a detailed development plan document to disk.
- Primary objective: convert Round 2 canary failure analysis into an executable Round 3 plan.
- Must include root-cause-driven remediation before re-running canary.
- Must include clear next-step development path and verification gates.
- User refinement: normalize the Round 3 plan into a dual-state development workflow, referencing `.sisyphus/plans/slack-roadmap-next-phase.md`.

## Technical Decisions
- Plan file path: `.sisyphus/plans/slack-round3-stability-and-sync.md`.
- Keep one single unified plan (no split plans).
- Prioritize reliability blockers first (watchdog death spiral, timestamp precision), then canary validation.
- Explicitly defer metadata sync rollout from this reliability plan.
- Use tests-after strategy (existing Vitest infrastructure) plus agent-executed QA scenarios for every task.
- Normalize plan to dual-state flow:
  - T1-T13 in `undeployed`
  - T14-T20 in `deployed`
  - `dirty-core` triggers immediate stop + restore.

## Research Findings
- Round 2 verdict: rollback due to watchdog death spiral after ~59 minutes uptime.
- Root cause evidence points to Slack watchdog reconnect policy in skill Slack channel implementation.
- Current runtime state is rolled back to `undeployed`.
- Existing pending feature plan exists: Slack channel name auto-sync (`curious-soaring-petal.md`).

## Open Questions
- None blocking for plan generation.

## Metis Findings (gap analysis)
- Critical: watchdog death-spiral fixes are documented but not yet patched in the skill source `.claude/skills/add-slack/add/src/channels/slack.ts`.
- Missing guardrail: reconnect reentrancy protection is required to avoid overlapping reconnect attempts.
- Missing guardrail: define explicit circuit-breaker terminal action after max retries.
- Scope control: channel metadata sync feature should be deferred from reliability remediation scope.
- Missing acceptance checks: low-traffic endurance, concurrent reconnect prevention, apps.connections.open specific rate-limit recovery, active websocket count control.
- Assumption to validate in plan: deployment/state workflow fragility (prior accidental `src/index.ts` deletion incident).

## Scope Boundaries
- INCLUDE: plan-level review synthesis, blocker remediation tasks, test/canary waves, evidence and rollback gating.
- EXCLUDE: immediate source-code implementation in this planning step.
- EXCLUDE (for this plan): non-reliability feature expansion such as metadata sync rollout.
