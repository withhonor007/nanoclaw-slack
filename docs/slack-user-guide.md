# NanoClaw Slack User Guide

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Creating a Slack App](#creating-a-slack-app)
5. [Configuring Tokens](#configuring-tokens)
6. [Registering Channels](#registering-channels)
7. [Daily Usage](#daily-usage)
8. [Main Channel Admin Features](#main-channel-admin-features)
9. [Message Format and Limits](#message-format-and-limits)
10. [API Recovery and Resilience](#api-recovery-and-resilience)
11. [Operations and Monitoring](#operations-and-monitoring)
12. [Troubleshooting](#troubleshooting)
13. [Known Limitations](#known-limitations)
14. [Uninstallation](#uninstallation)

---

## Overview

NanoClaw supports Slack as a message channel, running in parallel with WhatsApp or completely replacing it. The Slack integration uses Socket Mode (outbound WebSocket), requiring no public IP or HTTP endpoint.

Core features:
- Activate AI Agent via @mention or trigger words
- Support for main channel (admin) and regular channel modes
- Each channel has isolated file system and memory (`CLAUDE.md`)
- Messages exceeding 40,000 characters are automatically split
- Built-in bot self-loop protection, event deduplication, Socket reconnection
- Automatic API recovery — if AI API goes down, failed messages are discarded, new messages are processed when API recovers
- Channel name auto-resolution — no need to manually enter channel names during registration

---

## Prerequisites

| Requirement | Description |
|------|------|
| NanoClaw Installed | `/setup` completed, services running |
| Claude Code | Installed and available |
| Slack Workspace | You have admin permissions (to create apps) |
| Node.js 20+ | Runtime environment |

---

## Installation

In Claude Code, run:

```
/add-slack
```

The skill will ask two questions:

1. **Mode**: Replace WhatsApp or run in parallel?
   - Replace → Set `SLACK_ONLY=true`, WhatsApp channel won't start
   - Parallel → Both channels active (default)

2. **Already have a Slack app?**: If yes, provide tokens directly; if no, create one next.

The skill engine automatically handles code changes, dependency installation, and test verification.

---

## Creating a Slack App

If you don't have a Slack app yet:

### Step 1: Generate App Manifest

```bash
npx tsx .claude/skills/add-slack/scripts/generate-manifest.ts "Your Bot Name"
```

This outputs a one-click creation URL.

### Step 2: Create App

Click the generated link. Slack automatically configures all required scopes and event subscriptions:

- `app_mentions:read` — Receive @mentions
- `channels:history` / `groups:history` / `im:history` / `mpim:history` — Read messages
- `channels:read` / `groups:read` — Resolve channel names and metadata
- `chat:write` — Send messages
- `users:read` — Query user information
- Socket Mode enabled
- Event subscriptions configured (`app_mention`, `message.channels`, `message.groups`, `message.im`, `message.mpim`)

### Step 3: Get Tokens

| Token | Location | Format |
|------|------|------|
| Bot Token | **Install App** → Install to Workspace → Bot User OAuth Token | `xoxb-...` |
| App Token | **Socket Mode** → App-Level Tokens → Create (scope: `connections:write`) | `xapp-...` |

---

## Configuring Tokens

Add tokens to `.env`:

```bash
# .env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# Optional: Slack only, skip WhatsApp
# SLACK_ONLY=true

# Optional: API recovery — discard last N milliseconds of messages before exhaustion
# Default 0 (disabled). Set to e.g. 60000 to discard messages within 60 seconds after API failure.
# RECOVERY_EXHAUSTED_GATE_MS=0
```

Sync to container environment (container reads `data/env/env`, not `.env` directly):

```bash
mkdir -p data/env && cp .env data/env/env
```

Restart services:

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user restart nanoclaw
```

---

## Registering Channels

After the bot starts, you need to register channels for it to respond.

### Get Channel ID

1. Invite bot to channel: `/invite @YourBotName`
2. @mention bot in channel, or send `!chatid`
3. Bot replies with channel ID and name, e.g. `Chat ID: slack:C0123456789 (general)`
4. For DMs: Send message directly to bot, send `!chatid` to get ID (shows `dm-{user_id}`)

Channel ID prefixes:

| Prefix | Type |
|------|------|
| `C` | Public channel |
| `G` | Private channel / Group DM |
| `D` | 1:1 Direct message |

### Register as Main Channel (Admin)

Main channel is your private admin channel with full permissions. Use DM or private channel.

In Claude Code, tell the Agent:
```
Register slack:D0123456789 as main channel
```

Channel name is automatically resolved from Slack API — you don't need to provide it manually. If name cannot be resolved (e.g., bot just joined and metadata not yet synced), raw JID is used as fallback.

Main channel permissions:
- No trigger word needed — all messages routed to Agent
- Agent container can access entire project root directory
- Can view and manage all registered channels
- Can view and manage all scheduled tasks
- Can send messages to any channel (cross-group IPC)

### Register Regular Channel

```
Register slack:C0123456789 as regular channel
```

You can optionally provide a name to override auto-resolved name:
```
Register slack:C0123456789 as regular channel, name "Custom Name"
```

Regular channel behavior:
- Requires @mention or trigger word (default `@Andy`) to activate Agent
- Agent container can only access its own `groups/{folder}/` directory
- Cannot see data from other channels
- Has its own isolated `CLAUDE.md` memory file

---

## Daily Usage

### In Main Channel

Send any message directly — no trigger word needed:
```
Any new emails today?
List all scheduled tasks
Send a reminder to the Team Chat channel
```

### In Regular Channels

Use @mention to trigger:
```
@Andy summarize today's discussion
@Andy how do I fix this bug?
```

Or use trigger word (default `@Andy`):
```
@Andy check the latest sales data
```

### Built-in Commands

| Command | Function | Scope |
|------|------|------|
| `!chatid` | Return channel's JID and resolved name (e.g. `Chat ID: slack:C123 (general)`) | All channels (including unregistered) |

### File Attachments

Files sent in Slack are passed to Agent as placeholders:
- Regular files: `[File: report.pdf]`
- Images: `[File: screenshot.png]`

Agent can see file names but cannot download file contents.

---

## Main Channel Admin Features

Main channel (`folder: 'main'`) is NanoClaw's control center with exclusive features:

| Feature | Description |
|------|------|
| No trigger word needed | All messages processed directly, no `@Andy` prefix required |
| Full project access | Container mounts entire project root directory (`/workspace/project`) |
| Cross-group visibility | Can view all registered channel list |
| Global task management | Can view, create, pause, delete tasks across all channels |
| Cross-group messaging | Can send messages to any registered channel via IPC |

Usage examples:
```
List all scheduled tasks across channels
Pause the Monday briefing task in Team Chat
Send a message to slack:C0123456789: Meeting tomorrow at 3pm
Every weekday at 9am, send sales overview to Team Chat
```

Regular channel agents can only see their own tasks and files. They cannot access data from other channels. This is enforced by OS-level container isolation.

---

## Message Format and Limits

| Item | Limit |
|------|------|
| Max message length | 40,000 characters (auto-split when exceeded) |
| Message format | Agent outputs Markdown, displayed as-is in Slack (no mrkdwn conversion) |
| Code blocks | ` ``` ` syntax renders correctly in Slack |
| Quotes | `> ` syntax renders correctly in Slack |
| Bold/Italic | Markdown `**bold**` and `*italic*` may display differently in Slack, but still readable |
| Links | Markdown `[text](url)` not auto-converted to Slack format, but URLs still clickable |

---

## API Recovery and Resilience

NanoClaw gracefully handles API outages. When AI API (Claude) becomes unavailable:

### What Happens During Outage

1. Message queue retries up to 5 times with exponential backoff
2. After all retries exhausted, system enters **exhaustion drop** mode:
   - Failed messages are discarded (not entire channel)
   - Cursor advances past stale message window, preventing replay storm when API returns
   - Channel remains registered and active — it **will not** be permanently abandoned
3. New messages arriving during outage are queued normally

### What Happens When API Recovers

1. Slack watchdog detects recovery (via successful `auth.test()` call)
2. `onRecovery` callback triggers, where:
   - Iterates all registered Slack groups
   - Re-queues for processing
   - Logs `slack_recovery_resume` for each group
3. New messages sent after recovery are processed normally
4. Messages that failed during outage window are discarded (already discarded during exhaustion)

### Key Behaviors

| Behavior | Description |
|------|------|
| Retry exhaustion | 5 retries → discard message, **do not** discard channel |
| Cursor commit | Advance past failure window to prevent replay storm |
| Recovery detection | Slack watchdog `auth.test()` success triggers recovery |
| Recovery action | All Slack groups re-queued for processing |
| Idempotency | Multiple recovery signals don't cause duplicate processing |
| Send failure authenticity | `sendMessage` throws exception on failure (doesn't silently swallow) |

### Configuration

| Variable | Default | Description |
|------|--------|------|
| `RECOVERY_EXHAUSTED_GATE_MS` | `0` (disabled) | Time window (milliseconds) before exhaustion to discard messages. Set to e.g. `60000` to discard messages within 60 seconds after API failure. |

### Monitoring Recovery Events

Search logs for recovery-related events:

```bash
grep -E 'exhaustion_drop|cursor_commit_on_exhaustion|slack_recovery_resume|send_failed_non_delivery' logs/nanoclaw.log
```

| Log Event | Meaning |
|---------|------|
| `exhaustion_drop` | Queue retries exhausted, message discarded |
| `cursor_commit_on_exhaustion` | Cursor advanced past stale window |
| `slack_recovery_resume` | API recovered, group re-queued |
| `send_failed_non_delivery` | Message send failed, will retry with backoff |

---

## Operations and Monitoring

### View Logs

```bash
tail -f logs/nanoclaw.log
```

Key log events:

| Event | Meaning |
|------|------|
| `Slack bot connected via Socket Mode` | Connection successful |
| `slack_rate_limited` | Slack API rate limit triggered, auto-wait and retry |
| `slack_send_failed` | Message send failed (retries exhausted) |
| `send_failed_non_delivery` | Message send failed, will retry with backoff |
| `socket_stale` | No events in 12 minutes, trigger reconnect |
| `socket_reconnect` | Reconnect result (success/failure) |
| `token_revoked` | Token revoked, bot disconnected |
| `app_uninstalled` | App uninstalled, bot disconnected |
| `exhaustion_drop` | Queue retries exhausted, message discarded (not channel) |
| `cursor_commit_on_exhaustion` | Cursor advanced past stale message window |
| `slack_recovery_resume` | API recovered, Slack groups re-queued for processing |

### Database Queries

```bash
# View registered Slack channels
sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"

# View recent Slack messages
sqlite3 store/messages.db "SELECT * FROM messages WHERE chat_jid LIKE 'slack:%' ORDER BY timestamp DESC LIMIT 10"
```

### Safety Mechanisms

Slack integration includes automatic protections:

| Mechanism | Description |
|------|------|
| Bot self-loop protection | Triple filter: subtype + botUserId + bot_id |
| Event deduplication | `channel:ts` key + 5-minute TTL in-memory Map |
| Rate limiting | Bolt handles 429 Retry-After, 1 retry; watchdog manages reconnection |
| Socket watchdog | Checks every 60 seconds, auto-reconnect if no events in 12 minutes |
| Reconnection strategy | Exponential backoff (5s base, 2x factor, ±20% jitter), circuit breaker after 5 failures |
| Channel metadata sync | Auto-sync channel names from Slack API every 30 minutes |
| Token lifecycle | Listen for `tokens_revoked` and `app_uninstalled` events |
| Safe mode | If `auth.test()` fails, enter safe mode — force filter all bot messages |
| API recovery | Exhaustion drop failed messages (not channel); auto-recover when API returns |

---

## Troubleshooting

### Bot Not Responding

Check in order:

1. Tokens configured: `.env` has `SLACK_BOT_TOKEN` (`xoxb-`) and `SLACK_APP_TOKEN` (`xapp-`)
2. Synced to container: `data/env/env` matches `.env`
3. Socket Mode enabled: Confirm in Slack app settings
4. Channel registered:
   ```bash
   sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"
   ```
5. Not main channel: Message must contain trigger word or @mention bot
6. Service running:
   ```bash
   # macOS
   launchctl list | grep nanoclaw
   # Linux
   systemctl --user status nanoclaw
   ```
7. Check logs: `grep -E 'token_revoked|socket_stale|slack_send_failed' logs/nanoclaw.log`

### Duplicate Responses

- Should not happen under normal conditions (event deduplication prevents this)
- If it occurs, check logs for duplicate events with same `ts` value
- After restart, in-memory dedup Map is cleared, but SQLite unique constraint still prevents duplicate writes

### Socket Disconnection

- Search logs: `grep -E 'socket_stale|socket_reconnect' logs/nanoclaw.log`
- `socket_stale` means no events in 12+ minutes — normal during quiet periods
- `socket_reconnect` error means reconnect failed — check if `SLACK_APP_TOKEN` is valid
- If `reconnect_attempt` reaches 5, circuit breaker triggers `process.exit(1)` — systemd/launchd will restart service

### Rate Limiting

- Search logs: `grep slack_rate_limited logs/nanoclaw.log`
- `retry_after_s` field shows wait duration
- If triggered frequently, reduce message sending frequency
- Send failures logged as `slack_send_failed` after Bolt's built-in retries exhausted

### API Quota Exhaustion

If AI API (Claude) quota exhausted or down:
- Messages fail after 5 retries and are discarded (log `exhaustion_drop`)
- Channel remains registered — it **will not** be permanently abandoned
- When API recovers, Slack watchdog detects and re-queues all groups (`slack_recovery_resume`)
- No manual intervention needed — just wait for API recovery
- Check recovery status: `grep -E 'exhaustion_drop|slack_recovery_resume' logs/nanoclaw.log`
- Messages sent during outage window are lost (by design — prevent replay storm)

---

## Known Limitations

| Limitation | Description | Status |
|------|------|------|
| No typing indicator | Slack doesn't provide bot typing status API | Platform limitation |
| No processing status | Won't send "thinking..." status messages | Design choice |
| Files not downloadable | Only file name placeholders passed | Planned |
| No mrkdwn conversion | Markdown bold/italic/links may display differently | Design choice |
| No thread-level isolation | All messages processed at channel level, threads not distinguished | Design choice |
| No interactive mode | No support for `!open`/`!close` trigger-less mode | Deferred |
| No Slack Connect users | Doesn't handle cross-organization user messages | Deferred |
| No archived channel detection | Send failures logged but not pre-detected | Low priority |
| Outage message loss | Messages during API outage discarded after retry exhaustion (by design) | Design choice |

---

## Uninstallation

1. Delete source files: `src/channels/slack.ts`, `src/channels/slack.test.ts`, and `src/channels/reconnect-policy.ts`
2. From `src/index.ts`, remove `SlackChannel` import/creation, `onRecovery` callback, and `if (!SLACK_ONLY)` guard (restore unconditional WhatsApp creation)
3. From `src/config.ts`, remove Slack config exports (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_ONLY`, `SLACK_FILTER_BOT_MESSAGES`) and their `readEnvFile` entries
4. Clear Slack registrations from SQLite:
   ```bash
   sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'slack:%'"
   ```
5. Uninstall dependency: `npm uninstall @slack/bolt`
6. Rebuild and restart:
   ```bash
   npm run build
   # macOS
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw
   # Linux
   systemctl --user restart nanoclaw
   ```
