# Technical Debt: Cross-Channel Interaction Issues

> Document Version: 1.4
> Created: 2026-02-23
> Updated: 2026-02-25
> Related Development: Slack Channel Integration (slack-prd v1.1)
> Priority: See per-item priority below

### Development Decision Statement

> **Current development focus is Slack channel integration. All Part I items involve core project modifications (`src/index.ts`, `src/config.ts`, `src/types.ts`, `src/db.ts`) and are outside the scope of Slack channel development.**
>
> Slack channel integration uses `SLACK_ONLY` flag pattern, symmetric with Telegram, maintaining consistency across skill packages. Core-level unification (e.g., `CHANNEL_MODE` enum, multi-channel routing enhancements) deferred to a dedicated refactoring phase before multi-channel parallel deployment.
>
> Compatibility guarantees during Slack development:
> - When `SLACK_ONLY=true`, WhatsApp is skipped, only Slack starts — no conflicts in single-channel scenario
> - When `SLACK_ONLY` not configured, Slack and WhatsApp run in parallel — routing isolation via JID prefix (`slack:`)
> - No modifications to existing logic in `src/types.ts`, `src/router.ts`
>
> **⚠️ Post-Application Revision (2026-02-25)**: add-slack skill actually modified three core files: `src/db.ts` (new `hasBotResponseAfter()` function), `src/ipc.ts` (`register_group` name field auto-resolution), and `src/group-queue.ts` (new `onExhaustionDropFn` callback). These three changes are generic infrastructure improvements unrelated to Slack; the changes are already present in the main `src/` — see Skill Package debt item #5.

---

## Part I: Core Code Architecture Debt

> These items require modifications to `src/` main codebase. Deferred to dedicated refactoring phases before multi-channel parallel deployment.

---

### #1: `*_ONLY` Flag Mutual Exclusion Semantics Undefined

**Priority: Medium — Must resolve before second channel integration**

#### Problem

Each channel skill package introduces its own `*_ONLY` flag:

| Flag | Source | Semantics |
|------|------|------|
| `SLACK_ONLY=true` | add-slack skill | Disable WhatsApp channel creation |
| `TELEGRAM_ONLY=true` | add-telegram skill | Disable WhatsApp channel creation |

The following scenarios are completely undefined:

- `SLACK_ONLY=true` + `TELEGRAM_ONLY=true` — both channels claim "only this channel", which wins?
- `SLACK_ONLY=true` + Telegram token present — Slack disabled WhatsApp, should Telegram start?
- `TELEGRAM_ONLY=true` + Slack token present — reverse same
- All three channels configured simultaneously — no priority rules

**Current temporary solution**: During Slack development, default to `SLACK_ONLY=true` where Slack wins, no other channels configured. This is a hardcoded assumption, not a generic solution.

#### Code State (verified 2026-02-25, post-application)

- `src/index.ts:523` has `if (!SLACK_ONLY)` guard for WhatsApp creation — applied by add-slack skill
- `src/config.ts:89–94` exports `SLACK_ONLY`, `SLACK_FILTER_BOT_MESSAGES`; `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` also exported (lines 85–88)
- `SLACK_ONLY` read via `readEnvFile()` in main `src/config.ts` (line 16)
- add-telegram skill still uses its own `TELEGRAM_ONLY` flag in `modify/src/index.ts` — not yet in main codebase
- Core problem remains: if both skills applied with both `SLACK_ONLY=true` and `TELEGRAM_ONLY=true`, behavior is undefined

#### Recommended Fix: Unified `CHANNEL_MODE` Configuration

**`src/config.ts`** — Add new `CHANNEL_MODE` export:

```typescript
// Add 'CHANNEL_MODE' to readEnvFile call
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'CHANNEL_MODE',
]);

export type ChannelMode = 'whatsapp' | 'slack' | 'telegram' | 'multi';

function resolveChannelMode(): ChannelMode {
  const explicit = process.env.CHANNEL_MODE || envConfig.CHANNEL_MODE;
  if (explicit) return explicit as ChannelMode;
  // Backward compatibility with old *_ONLY flags
  if ((process.env.SLACK_ONLY || envConfig.SLACK_ONLY) === 'true') return 'slack';
  if ((process.env.TELEGRAM_ONLY || envConfig.TELEGRAM_ONLY) === 'true') return 'telegram';
  return 'whatsapp';
}
export const CHANNEL_MODE = resolveChannelMode();
```

**`src/index.ts` main()** — Replace `*_ONLY` conditionals with `CHANNEL_MODE`:

```typescript
import { CHANNEL_MODE } from './config.js';

const shouldCreateWhatsApp = CHANNEL_MODE === 'whatsapp' || CHANNEL_MODE === 'multi';
const shouldCreateSlack    = CHANNEL_MODE === 'slack'    || CHANNEL_MODE === 'multi';
const shouldCreateTelegram = CHANNEL_MODE === 'telegram' || CHANNEL_MODE === 'multi';

if (shouldCreateWhatsApp) { /* existing WhatsApp creation */ }
if (shouldCreateSlack && SLACK_BOT_TOKEN && SLACK_APP_TOKEN) { /* Slack creation */ }
if (shouldCreateTelegram && TELEGRAM_BOT_TOKEN) { /* Telegram creation */ }

if (channels.length === 0) {
  logger.fatal({ CHANNEL_MODE }, 'No channels created — check CHANNEL_MODE and token config');
  process.exit(1);
}
```

**Skill package updates**: Both skill packages' `intent.md` need to remove their own `*_ONLY` exports and rely on the unified `CHANNEL_MODE` instead.

#### Impact Scope

- `src/index.ts` — channel creation logic in `main()`
- `src/config.ts` — new `CHANNEL_MODE` export
- `.claude/skills/add-slack/` and `.claude/skills/add-telegram/` — update intent.md and conditional creation logic

---

### #4: Multi-Channel Message Routing Conflicts

**Priority: High — Depends on #1, must resolve before multi-channel parallel deployment**

#### Problem

Current `findChannel(channels, chatJid)` matches channels by JID prefix (`slack:*` → SlackChannel, `telegram:*` → TelegramChannel). The following scenarios are unhandled:

- Same user registers same group folder in multiple channels — message may be processed multiple times
- Scheduled tasks' `sendMessage` needs to specify target channel — currently uses `findChannel` by JID lookup, but what if the channel that created the task disconnects?
- IPC callback channel lookup — channel may reconnect during container runtime, `channels` array reference may be stale

**Current temporary solution**: Assume `SLACK_ONLY=true` during Slack development, so multi-channel parallel scenario doesn't exist.

#### Code State (verified 2026-02-25)

- `findChannel` (`router.ts:39–43`) scans linearly via `channels.find(c => c.ownsJid(jid))`, purely relies on each channel's `ownsJid()` implementation
- `findChannel` has 4 call sites (`index.ts`); 3 silently discard unmatched messages, only IPC path throws exception
- `channels` array populated once in `main()`, passed to scheduler and IPC via closure — correct but opaque
- DB `chats.channel` column stores channel type string (`'whatsapp'`/`'telegram'`/`'discord'`), but runtime routing never reads this column
- `registered_groups` keyed by JID, contains no channel type information
- Scheduled tasks store only `chat_jid`, not target channel identifier

#### Recommended Fix: Routing Configuration Enhancement

1. **Add channel binding to `registered_groups`** — Add `channel` field to `RegisteredGroup` type:

```typescript
// src/types.ts
export interface RegisteredGroup {
  name: string;
  folder: string;
  requiresTrigger?: boolean;
  channel: string;  // 'whatsapp' | 'slack' | 'telegram' — recorded at registration time
}
```

2. **Scheduled tasks store channel identifier** — Add `channel_type` column to `tasks` table:

```sql
ALTER TABLE tasks ADD COLUMN channel_type TEXT DEFAULT 'whatsapp';
```

3. **`findChannel` degradation logging** — Change 3 silent discard points to `logger.warn`:

```typescript
if (!channel) {
  logger.warn({ jid }, 'No connected channel for JID, message dropped');
  return;
}
```

4. **Leverage DB `chats.channel` column** — When `findChannel` returns `undefined`, query DB to confirm which channel the JID belongs to, providing a meaningful error (e.g., "Slack channel disconnected" instead of "no channel matched").

#### Impact Scope

- `src/types.ts` — `RegisteredGroup` interface
- `src/db.ts` — DB schema migration, query helper
- `src/index.ts` — `findChannel` call sites
- `src/task-scheduler.ts` — store and use `channel_type`

---

## Part II: Skill Package & Tooling Debt

> These items only affect `.claude/skills/` files. No `src/` modifications required. Can be resolved independently of Part I.

---

### #5: Generic Infrastructure Improvements Mixed into add-slack Skill

**Priority: Immediate — Skill package cleanup (core changes already applied)**

#### Problem

add-slack skill's `manifest.yaml` declares modifications to 6 core source files, compared to add-telegram's 3, adding 3 extra:

| File | Change Content | Slack-Specific? |
|------|---------|------------|
| `src/db.ts` | New `hasBotResponseAfter(chatJid, sinceTimestamp)` | ❌ Generic pipeline dedup helper |
| `src/ipc.ts` | `register_group`: auto-resolve `name` from `chats` table when missing | ❌ Generic IPC error handling improvement |
| `src/group-queue.ts` | New `onExhaustionDropFn` callback + retry logic | ❌ Generic queue reliability improvement |

These changes were implemented during Slack development but don't depend on Slack and provide value for all channels.

#### Post-Application Status (2026-02-25)

All three changes (`hasBotResponseAfter`, `register_group` name resolution, `onExhaustionDropFn`) are now present in main `src/` files — the skill has been applied. **Remaining debt**:

1. add-slack skill's `modify/` files still package these non-Slack changes, creating three-way merge risk for future skill applications
2. These improvements should be upstreamed as independent PRs so other branches benefit without installing Slack

#### Immediate Actions

Per `CONTRIBUTING.md` ("**Accepted**: Bug fixes, security fixes, simplifications, code reduction"), extract and submit as independent PRs:

1. `src/db.ts` — `hasBotResponseAfter()` → independent bugfix PR
2. `src/ipc.ts` — `register_group` name auto-resolution → independent bugfix PR (can merge with #1)
3. `src/group-queue.ts` — `onExhaustionDropFn` callback → independent bugfix PR

After extraction, add-slack skill's `manifest.yaml` should reduce to 3 `modifies` entries, matching add-telegram (`src/index.ts`, `src/config.ts`, `src/routing.test.ts`).

**CI note**: `skills-only.yml` is not triggered (changes are in `modify/`, not applied `src/`), but violates the rule's intent.

#### Impact Scope

- `.claude/skills/add-slack/manifest.yaml` — `modifies` list reduced
- `.claude/skills/add-slack/modify/src/db.ts` — keep only Slack-specific diffs (or delete)
- `.claude/skills/add-slack/modify/src/ipc.ts` — same
- `.claude/skills/add-slack/modify/src/group-queue.ts` — same

---

### #2 & #3: Telegram Skill config.ts Drift and HOME_DIR Hardcoding

**Priority: Low — Can fix immediately, two-line change**

#### Problem

add-telegram skill's `modify/src/config.ts` has diverged from the current project `src/config.ts`:

| Difference | Telegram Skill | Slack Skill / Main Project |
|------|---------------|-----------|
| `import` | `import path` only | `import os` + `import path` |
| `HOME_DIR` | `process.env.HOME \|\| '/Users/user'` (macOS hardcoded) | `process.env.HOME \|\| os.homedir()` |

The hardcoded `/Users/user` fallback is macOS-specific. On Linux without `HOME` set, this is incorrect. If add-telegram is applied after add-slack, the three-way merge may revert the `os.homedir()` improvement.

#### Code State (verified 2026-02-25)

- `src/config.ts` (main project): line 1 `import os from 'os'`, line 23 `os.homedir()` ✓
- `.claude/skills/add-slack/modify/src/config.ts`: line 1 `import os from 'os'`, line 27 `os.homedir()` ✓
- `.claude/skills/add-telegram/modify/src/config.ts`: line 1 missing `import os`, line 24 hardcoded `'/Users/user'` ✗
- No other `/Users/user` hardcoding in codebase

#### Fix (two-line change)

File: `.claude/skills/add-telegram/modify/src/config.ts`

```diff
- import path from 'path';
+ import os from 'os';
+ import path from 'path';
```

```diff
- const HOME_DIR = process.env.HOME || '/Users/user';
+ const HOME_DIR = process.env.HOME || os.homedir();
```

**Long-term recommendation**: Skill engine should store diffs/patches rather than complete file copies to prevent base file drift as `src/config.ts` continues to evolve.

#### Impact Scope

- `.claude/skills/add-telegram/modify/src/config.ts` — 2-line fix

---

## Resolution Timeline

| Debt Item | Part | Blocking Scenario | Recommended Time | Fix Complexity |
|--------|------|---------|------------|--------------|
| **#1** `*_ONLY` mutual exclusion | I — Core | Multi-channel parallel deployment | After Slack dev, before second channel | Medium — `config.ts` + `index.ts` + 2 skill packages |
| **#4** Multi-channel routing | I — Core | Multi-channel parallel deployment | Together with #1 (depends on it) | High — `types.ts` + `db.ts` + `index.ts` + `task-scheduler.ts` |
| **#5** Infrastructure mixed into skill | II — Skill | Future skill three-way merge conflicts | **Immediate** — upstream as independent bugfix PRs | Low — 3 extractions, skill manifest cleanup |
| **#2 & #3** Telegram config.ts drift + HOME_DIR | II — Skill | Linux deploy without `HOME`; Telegram+Slack applied together | Immediate — standalone 2-line fix | Low — 2 lines, single file |

```
Part II (Skill Package — act now):

  #5 Infrastructure mixed in ─────▶ Extract 3 independent bugfix PRs + clean add-slack modify/
  #2 & #3 Telegram config.ts ─────▶ 2-line fix in add-telegram modify/

Part I (Core — scheduled refactoring):

  #1 CHANNEL_MODE ────────────────▶ Core refactoring before multi-channel deployment
         │
         └──▶ #4 Multi-channel routing (depends on #1)
```
