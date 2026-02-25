# Draft: Slack API Recovery Dual-State

> **Status**: Research complete. Final plan at `.sisyphus/plans/slack-dual-state-api-recovery.md` (4 tasks, 2 waves).
> Original 16-task plan was reviewed and consolidated — see plan document for rationale.

## Requirements (confirmed)
- Retry exhaustion must NOT permanently orphan a group.
- After retry budget is exhausted, the system should discard the currently failing just-received workload.
- After API recovery, NEW incoming messages must be processed normally without manual intervention.
- Scope is Slack channel integration behavior; WhatsApp reconnect hypotheses are out of scope.
- Deliverable requested: detailed "dual-state development" plan aligned with existing Slack roadmap style.
- Reference baseline style and guardrails: `.sisyphus/plans/slack-roadmap-next-phase.md`.

## Technical Decisions (current)
- Use a dual-state model at queue/orchestrator level (normal processing vs degraded/drop-on-exhaustion mode).
- Keep fix primarily in shared queue/orchestrator (`src/group-queue.ts`, `src/index.ts`) and only add Slack-specific resilience coupling tasks where required (`src/channels/slack.ts`).
- Prefer forward progress for future traffic over replaying stale exhausted workloads.
- Keep behavior testable with deterministic queue/unit tests first, then Slack integration/failure-path tests.

## Research Findings
- `src/group-queue.ts`
  - Has `MAX_RETRIES=5` and backoff (`BASE_RETRY_MS=5000`).
  - On retry exhaustion, it resets `retryCount` and returns; this path currently risks ambiguous pending-state behavior and policy mismatch with desired "drop current workload" semantics.
  - Core flags influencing behavior: `active`, `pendingMessages`, `retryCount`, `waitingGroups`.
- `src/index.ts`
  - `processGroupMessages` advances cursor before agent run, rolls back on error, but skips rollback if output already sent.
  - This behavior avoids duplicate outputs but needs explicit policy for retry-exhaustion discard semantics.
  - `recoverPendingMessages()` only runs at startup; no periodic recovery loop.
- `src/channels/slack.ts`
  - Watchdog stale detection + reconnect attempts + breaker (`process.exit(1)` on breaker open).
  - Slack event ingestion path can drop/ignore messages by filters (subtype, bot filtering, unregistered groups).
  - Connection resilience and queue recovery are currently loosely coupled.
- Reliability references (external)
  - DLQ / poison-message / retry-budget patterns emphasize bounded retries, explicit discard/quarantine semantics, and forward progress guarantees.
  - Slack/Bolt guidance emphasizes reconnect visibility, ack/error observability, and avoiding silent drop paths.

## Decisions Pending Specialist Confirmation
- Exact discard granularity for "just-received workload":
  - Option A: discard full frozen window (`windowStart` -> `windowEnd`) at exhaustion.
  - Option B: discard only latest attempted slice while retaining older backlog.
- Whether to emit explicit Slack user-facing notice when discard occurs (and format/rate-limit for that notice).
- Whether scheduled-task and IPC-triggered workloads follow identical exhaustion/drop policy or use separate policy.

## Specialist Findings (Oracle / Artistry / Explore)
- Oracle recommends a strict two-state runtime model (`NORMAL`, `EXHAUSTED_DROP`) with invariants:
  - retries target one frozen window only,
  - exhaustion commits cursor to `windowEnd`,
  - messages newer than `windowEnd` are never discarded.
- Artistry recommends practical gate-based behavior:
  - on exhaustion, enter temporary admission gate,
  - preserve new pending traffic for later drain,
  - clear gate on recovery callback or bounded timeout,
  - avoid replay storms by not re-running stale exhausted window.
- Explore test-gap analysis confirms missing coverage for:
  - "new message after exhaustion resumes processing",
  - race between retry timer and new enqueue,
  - end-to-end outage -> exhaust -> recover -> new-message flow.

## Planning Defaults Applied
- Default discard granularity: frozen failing workload window (not whole chat history).
- Default recovery behavior: gate-based defer/resume for new traffic during outage window; no permanent orphan state.
- Default test strategy: tests-after implementation (vitest), with mandatory agent-executed QA evidence per task.
- Default scope: include Slack delivery truthfulness fix because it directly affects cursor correctness and no-response symptom.

## User Review Feedback Incorporated
- Prior plan considered over-engineered (16 tasks + 4 final checks for ~300-500 LOC expected change scope).
- User requested compact plan while keeping coverage unchanged.
- User flagged skill-first compliance risk against `.sisyphus/plans/slack-roadmap-next-phase.md` constraints.

## Revised Plan Direction
- Collapsed to 4 implementation tasks in `.sisyphus/plans/slack-dual-state-api-recovery.md`.
- Enforced skill-first path:
  - author changes under `.claude/skills/add-slack/**`
  - validate in deployed state via skill application flow
- Kept scope coverage unchanged:
  - dual-state runtime behavior
  - cursor discard policy on exhaustion
  - Slack recovery callback + delivery truthfulness
  - integrated outage/recovery tests
  - canary/rollback runbook

## Scope Boundaries
- INCLUDE
  - Queue retry exhaustion semantics and state transitions.
  - Cursor policy at exhaustion and forward-progress guarantees.
  - Slack watchdog/connection coupling constraints relevant to no-response symptoms.
  - Observability and tests proving "drop current exhausted workload, process future new messages".
- EXCLUDE
  - WhatsApp reconnect logic changes.
  - Broad channel architecture rewrites not required for dual-state recovery.
  - Provider/auth redesign beyond resilience behavior.

## Specialist Consultations
- Completed
  - Explore: queue state machine and retry/drop behavior (`bg_412d0033`).
  - Explore: Slack failure/reconnect/message-ingestion map (`bg_1ac85aa6`).
  - Librarian: reliability retry/drop patterns (`bg_0e1b4f4b`).
  - Librarian: Slack reconnect and reliability guidance (`bg_1c5432cf`).
- In progress (re-dispatched)
  - Oracle: architecture-grade dual-state recommendation.
  - Artistry: non-conventional resilience strategy.
  - Explore: test-gap mapping for new policy.
