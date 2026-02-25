# Decisions

## 2026-02-25 Task: Plan Design

- Dual-state model: NORMAL (bounded retries) and EXHAUSTED_DROP (discard frozen window, commit cursor, clear metadata)
- Discard granularity: frozen failing window (windowStart -> windowEnd)
- User-facing discard notice: disabled by default (structured logs only)
- Same exhaustion/drop semantics across interactive + IPC + scheduler paths
