# NanoClaw Slack User Guide

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Create Slack App](#create-slack-app)
5. [Configure Tokens](#configure-tokens)
6. [Register Channels](#register-channels)
7. [Daily Usage](#daily-usage)
8. [Main Channel Admin Features](#main-channel-admin-features)
9. [Message Format & Limits](#message-format--limits)
10. [Operations & Monitoring](#operations--monitoring)
11. [Troubleshooting](#troubleshooting)
12. [Known Limitations](#known-limitations)
13. [Removal](#removal)

---

## Overview

NanoClaw supports Slack as a messaging channel, running alongside WhatsApp or replacing it entirely. The Slack integration uses Socket Mode (outbound WebSocket), requiring no public IP or HTTP endpoint.

Core features:
- Trigger AI Agent via @mention or trigger word
- Supports Main Channel (admin) and regular channel modes
- Each channel has isolated filesystem and memory (`CLAUDE.md`)
- Messages over 40,000 characters are automatically split
- Built-in bot self-loop protection, event deduplication, socket reconnection

---

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| NanoClaw installed | `/setup` completed, service running |
| Claude Code | Installed and available |
| Slack workspace | You have admin access (to create App) |
| Node.js 20+ | Runtime environment |

---

## Installation

Run in Claude Code:

```
/add-slack
```

The skill asks two questions:

1. **Mode**: Replace WhatsApp or run alongside?
   - Replace → sets `SLACK_ONLY=true`, WhatsApp channel won't start
   - Alongside → both channels active (default)

2. **Existing Slack App?**: If yes, provide tokens directly; if no, create one next.

The skills engine handles code changes, dependency installation, and test validation automatically.

---

## Create Slack App

If you don't have a Slack App yet:

### Step 1: Generate App Manifest

```bash
npx tsx .claude/skills/add-slack/scripts/generate-manifest.ts "Your Bot Name"
```

This outputs a one-click creation URL.

### Step 2: Create the App

Click the generated link. Slack auto-configures all required scopes and event subscriptions:

- `app_mentions:read` — receive @mentions
- `channels:history` / `groups:history` / `im:history` — read messages
- `chat:write` — send messages
- `users:read` — query user info
- Socket Mode enabled
- Event subscriptions configured (`app_mention`, `message.channels`, `message.im`)

### Step 3: Get Tokens

| Token | Location | Format |
|-------|----------|--------|
| Bot Token | **Install App** → Install to Workspace → Bot User OAuth Token | `xoxb-...` |
| App Token | **Socket Mode** → App-Level Tokens → Create (scope: `connections:write`) | `xapp-...` |

---

## Configure Tokens

Add tokens to `.env`:

```bash
# .env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# Optional: Slack only, skip WhatsApp
# SLACK_ONLY=true
```

Sync to container environment (containers read `data/env/env`, not `.env` directly):

```bash
mkdir -p data/env && cp .env data/env/env
```

Restart the service:

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user restart nanoclaw
```

---

## Register Channels

After the bot starts, you need to register channels for it to respond.

### Get Channel ID

1. Invite the bot to a channel: `/invite @YourBotName`
2. Mention the bot in the channel, or send `!chatid`
3. Bot replies with the channel ID, e.g. `slack:C0123456789`
4. For DMs: message the bot directly, send `!chatid` to get the ID

Channel ID prefixes:

| Prefix | Type |
|--------|------|
| `C` | Public channel |
| `G` | Private channel / Group DM |
| `D` | 1:1 Direct Message |

### Register as Main Channel (Admin)

The Main Channel is your private admin channel with full privileges. Use a DM or private channel.

Tell the Agent in Claude Code:
```
Register slack:D0123456789 as main channel, name "My Admin"
```

Main Channel privileges:
- No trigger word needed — all messages route to Agent
- Agent container has access to the entire project root
- Can view and manage all registered channels
- Can view and manage all scheduled tasks
- Can send messages to any channel (cross-group IPC)

### Register Regular Channel

```
Register slack:C0123456789 as regular channel, name "Team Chat"
```

Regular channel behavior:
- Requires @mention or trigger word (default `@Andy`) to activate Agent
- Agent container only accesses its own `groups/{folder}/` directory
- Cannot see other channels' data
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

Or use the trigger word (default `@Andy`):
```
@Andy check the latest sales data
```

### Built-in Commands

| Command | Function | Scope |
|---------|----------|-------|
| `!chatid` | Returns the channel's registration ID | All channels (including unregistered) |

### File Attachments

Files sent in Slack are passed to the Agent as placeholders:
- Regular files: `[File: report.pdf]`
- Images: `[File: screenshot.png]`

The Agent can see filenames but cannot download file contents.

---

## Main Channel Admin Features

The Main Channel (`folder: 'main'`) is NanoClaw's control center with exclusive capabilities:

| Capability | Description |
|------------|-------------|
| No trigger needed | All messages processed directly, no `@Andy` prefix required |
| Full project access | Container mounts entire project root (`/workspace/project`) |
| Cross-group visibility | Can view all registered channel listings |
| Global task management | Can view, create, pause, delete tasks across all channels |
| Cross-group messaging | Can send messages to any registered channel via IPC |

Example usage:
```
List all scheduled tasks across channels
Pause the Monday briefing task in Team Chat
Send a message to slack:C0123456789: Meeting tomorrow at 3pm
Every weekday at 9am, send sales overview to Team Chat
```

Regular channel Agents can only see their own tasks and files. They cannot access other channels' data. This is container-level isolation enforced by the OS.

---

## Message Format & Limits

| Item | Limit |
|------|-------|
| Max message length | 40,000 characters (auto-split if longer) |
| Message format | Agent outputs Markdown, displayed as-is in Slack (no mrkdwn conversion) |
| Code blocks | ` ``` ` syntax renders correctly in Slack |
| Quotes | `> ` syntax renders correctly in Slack |
| Bold/Italic | Markdown `**bold**` and `*italic*` may display differently in Slack, but remain readable |
| Links | Markdown `[text](url)` won't auto-convert to Slack format, but URLs are still clickable |

---

## Operations & Monitoring

### View Logs

```bash
tail -f logs/nanoclaw.log
```

Key log events:

| Event | Meaning |
|-------|---------|
| `Slack bot connected via Socket Mode` | Connected successfully |
| `slack_rate_limited` | Slack API rate limit hit, auto-waiting and retrying |
| `slack_send_failed` | Message send failed (retries exhausted) |
| `socket_stale` | No events for 3 minutes, triggering reconnect |
| `socket_reconnect` | Reconnect result (success/failure) |
| `token_revoked` | Token revoked, bot disconnecting |
| `app_uninstalled` | App uninstalled, bot disconnecting |

### Database Queries

```bash
# View registered Slack channels
sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"

# View recent Slack messages
sqlite3 store/messages.db "SELECT * FROM messages WHERE chat_jid LIKE 'slack:%' ORDER BY timestamp DESC LIMIT 10"
```

### Security Mechanisms

The Slack integration includes automatic protections:

| Mechanism | Description |
|-----------|-------------|
| Bot self-loop protection | Triple filter: subtype + botUserId + bot_id |
| Event deduplication | `channel:ts` key + 5-minute TTL in-memory Map |
| Rate limiting | Bolt auto-handles 429 Retry-After, 3 retries with exponential backoff |
| Socket watchdog | Checks every 60s, auto-reconnects if no events for 3 minutes |
| Token lifecycle | Listens for `tokens_revoked` and `app_uninstalled` events |
| Safe Mode | If `auth.test()` fails, enters safe mode — forces all bot messages filtered |

---

## Troubleshooting

### Bot Not Responding

Check in order:

1. Tokens configured: `.env` has `SLACK_BOT_TOKEN` (`xoxb-`) and `SLACK_APP_TOKEN` (`xapp-`)
2. Synced to container: `data/env/env` matches `.env`
3. Socket Mode enabled: confirm in Slack App settings
4. Channel registered:
   ```bash
   sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"
   ```
5. Non-main channels: message must include trigger word or @mention the bot
6. Service running:
   ```bash
   # macOS
   launchctl list | grep nanoclaw
   # Linux
   systemctl --user status nanoclaw
   ```
7. Check logs: `grep -E 'token_revoked|socket_stale|slack_send_failed' logs/nanoclaw.log`

### Duplicate Responses

- Should not occur under normal conditions (event deduplication protects against this)
- If it happens, check logs for duplicate events with the same `ts` value
- After restart, the in-memory dedup Map is cleared, but SQLite unique constraints still prevent duplicate writes

### Socket Disconnects

- Search logs: `grep -E 'socket_stale|socket_reconnect' logs/nanoclaw.log`
- `socket_stale` means no events for 3+ minutes — normal during quiet periods
- `socket_reconnect` with error means reconnect failed — check if `SLACK_APP_TOKEN` is valid
- If `reconnect_attempt` keeps climbing, the App Token may be revoked — regenerate in Slack settings

### Rate Limiting

- Search logs: `grep slack_rate_limited logs/nanoclaw.log`
- `retry_after_s` field shows wait duration
- If triggered frequently, reduce message sending frequency
- 3 consecutive final failures log `slack_send_failed`

---

## Known Limitations

| Limitation | Description | Status |
|------------|-------------|--------|
| No typing indicator | Slack doesn't provide Bot typing status API | Platform limitation |
| No processing status | Won't send "Thinking..." status messages | Design choice |
| Files not downloadable | Only passes filename placeholders | Planned |
| No mrkdwn conversion | Markdown bold/italic/links may display differently | Design choice |
| No thread-level isolation | All messages processed at channel level, threads not distinguished | Design choice |
| No interactive mode | `!open`/`!close` trigger-free mode not supported | Deferred |
| No Slack Connect users | Cross-organization user messages not processed | Deferred |
| No archived channel detection | Send failures are logged but not pre-detected | Low priority |

---

## Removal

1. Delete source files: `src/channels/slack.ts` and `src/channels/slack.test.ts`
2. Remove `SlackChannel` import and creation from `src/index.ts`
3. Remove Slack config exports from `src/config.ts`
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