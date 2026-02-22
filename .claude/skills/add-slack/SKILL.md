---
name: add-slack
description: Add Slack as a channel (Socket Mode via @slack/bolt). Can replace WhatsApp entirely or run alongside it. Ported from the claudecode-slackbot reference implementation.
---

# Add Slack Channel

This skill adds Slack support to NanoClaw using the skills engine for deterministic code changes, then walks through interactive setup.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `slack` is in `applied_skills`, skip to Phase 3 (Setup). The code changes are already in place.

### Ask the user

1. **Mode**: Replace WhatsApp or add alongside it?
   - Replace → will set `SLACK_ONLY=true`
   - Alongside → both channels active (default)

2. **Do they already have a Slack app configured?** If yes, collect tokens now. If no, we'll create one in Phase 3.

## Phase 2: Apply Code Changes

Run the skills engine to apply this skill's code package. The package files are in this directory alongside this SKILL.md.

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

Or call `initSkillsSystem()` from `skills-engine/migrate.ts`.

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-slack
```

This deterministically:
- Adds `src/channels/slack.ts` (SlackChannel class implementing Channel interface)
- Adds `src/channels/slack.test.ts` (unit tests)
- Three-way merges Slack support into `src/index.ts` (multi-channel support, findChannel routing)
- Three-way merges Slack config into `src/config.ts` (SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, SLACK_ONLY exports)
- Three-way merges updated routing tests into `src/routing.test.ts`
- Installs the `@slack/bolt` npm dependency
- Updates `.env.example` with Slack env vars
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/index.ts.intent.md` — what changed and invariants for index.ts
- `modify/src/config.ts.intent.md` — what changed for config.ts

### Validate code changes

```bash
npm test
npm run build
```

All tests must pass (including the new slack tests) and build must be clean before proceeding.

## Phase 3: Setup

### Create Slack App (if needed)

If the user doesn't have a Slack app, tell them:

> I need you to create a Slack app:
>
> 1. Go to https://api.slack.com/apps and click **Create New App**
> 2. Choose **From scratch**, give it a name (e.g., "Andy Assistant"), select your workspace
> 3. Under **Socket Mode**, enable it and create an app-level token with `connections:write` scope — save this as `SLACK_APP_TOKEN` (starts with `xapp-`)
> 4. Under **OAuth & Permissions**, add these Bot Token Scopes:
>    - `app_mentions:read`
>    - `channels:history`
>    - `channels:read`
>    - `chat:write`
>    - `groups:history`
>    - `groups:read`
>    - `im:history`
>    - `im:read`
>    - `im:write`
>    - `users:read`
> 5. Install the app to your workspace — save the **Bot User OAuth Token** as `SLACK_BOT_TOKEN` (starts with `xoxb-`)
> 6. Under **Basic Information**, copy the **Signing Secret** as `SLACK_SIGNING_SECRET`
> 7. Under **Event Subscriptions**, enable events and subscribe to:
>    - `app_mention`
>    - `message.channels`
>    - `message.groups`
>    - `message.im`

Wait for the user to provide the tokens.

### Configure environment

Add to `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
```

If they chose to replace WhatsApp:

```bash
SLACK_ONLY=true
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Registration

### Get Channel/DM ID

Tell the user:

> 1. Invite the bot to a Slack channel: `/invite @YourBotName`
> 2. Send a message mentioning the bot — it will reply with the channel ID
> 3. For DMs: just message the bot directly
>
> Channel IDs look like `slack:C0123456789` (channels) or `slack:D0123456789` (DMs).

Wait for the user to provide the channel ID.

### Register the channel

For a main channel (responds to all messages, uses the `main` folder):

```typescript
registerGroup("slack:<channel-id>", {
  name: "<channel-name>",
  folder: "main",
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: false,
});
```

For additional channels (trigger-only):

```typescript
registerGroup("slack:<channel-id>", {
  name: "<channel-name>",
  folder: "<folder-name>",
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: true,
});
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message in your registered Slack channel:
> - For main channel: Any message works
> - For non-main: `@Andy hello` or @mention the bot
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### Bot not responding

Check:
1. `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET` are set in `.env` AND synced to `data/env/env`
2. Socket Mode is enabled in the Slack app settings
3. Channel is registered in SQLite: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"` 
4. For non-main channels: message includes trigger pattern
5. Service is running: `launchctl list | grep nanoclaw` (macOS) or `systemctl --user status nanoclaw` (Linux)

### Bot only responds to @mentions

This is expected for non-main channels. For the main channel, set `requiresTrigger: false`.

### Token errors

- `SLACK_BOT_TOKEN` must start with `xoxb-`
- `SLACK_APP_TOKEN` must start with `xapp-`
- If tokens were rotated, update `.env` and sync to `data/env/env`

## Reference Implementation

The `claudecode-slackbot/` directory in this repo contains a full standalone Slack bot implementation. Key files to reference when filling in the channel implementation:

- `claudecode-slackbot/src/slack-handler.ts` — Slack event handling, command routing
- `claudecode-slackbot/src/claude-handler.ts` — Claude SDK session management
- `claudecode-slackbot/src/config.ts` — Environment variable patterns
- `claudecode-slackbot/src/session-queue.ts` — Concurrency control

The NanoClaw skill should be much simpler: just a `SlackChannel` class that implements the `Channel` interface (connect, sendMessage, ownsJid, disconnect, setTyping).

## Removal

To remove Slack integration:

1. Delete `src/channels/slack.ts` and `src/channels/slack.test.ts`
2. Remove `SlackChannel` import and creation from `src/index.ts`
3. Remove `channels` array and revert to using `whatsapp` directly (if no other channels)
4. Revert `getAvailableGroups()` filter if modified
5. Remove Slack config (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_ONLY`) from `src/config.ts`
6. Remove Slack registrations from SQLite: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'slack:%'"`
7. Uninstall: `npm uninstall @slack/bolt`
8. Rebuild: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `npm run build && systemctl --user restart nanoclaw` (Linux)