# Intent: src/index.ts modifications

## What changed

Refactored from single WhatsApp channel to multi-channel architecture using the `Channel` interface (same pattern as add-telegram skill).

## Key sections

### Imports (top of file)

- Added: `SlackChannel` from `./channels/slack.js`
- Added: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_FILTER_BOT_MESSAGES`, `SLACK_ONLY` from `./config.js`
- Added: `findChannel` from `./router.js`
- Added: `Channel` type from `./types.js`

### Module-level state

- Added: `const channels: Channel[] = []` — array of all active channels
- Kept: `let whatsapp: WhatsAppChannel` — still needed for `syncGroupMetadata` reference

### processGroupMessages()

- Added: `findChannel(channels, chatJid)` lookup at the start
- Changed: `whatsapp.setTyping()` → `channel.setTyping?.()` (optional chaining)
- Changed: `whatsapp.sendMessage()` → `channel.sendMessage()` in output callback

### startMessageLoop()

- Added: `findChannel(channels, chatJid)` lookup per group in message processing
- Changed: `whatsapp.setTyping()` → `channel.setTyping?.()` for typing indicators

### main()

- Changed: shutdown disconnects all channels via `for (const ch of channels)`
- Added: shared `channelOpts` object for channel callbacks
- Added: conditional WhatsApp creation (`if (!SLACK_ONLY)`)
- Added: conditional Slack creation (`if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN)`) — both tokens required for Socket Mode
- Changed: scheduler `sendMessage` uses `findChannel()` → `channel.sendMessage()`
- Changed: IPC `sendMessage` uses `findChannel()` → `channel.sendMessage()`
- Changed: IPC `syncGroupMetadata` calls both `whatsapp.syncGroupMetadata()` and `slackCh.syncChannelMetadata()` when Slack channel is active

### SLACK_ONLY fail-fast

- When `SLACK_ONLY=true` and either `SLACK_BOT_TOKEN` or `SLACK_APP_TOKEN` is missing, log an error and exit. This prevents a state where WhatsApp is disabled but Slack cannot start.

## Invariants

- All existing message processing logic (triggers, cursors, idle timers) is preserved
- The `runAgent` function is completely unchanged
- State management (loadState/saveState) is unchanged
- Recovery logic is unchanged
- Container runtime check is unchanged (ensureContainerSystemRunning)

## Must-keep

- The `escapeXml` and `formatMessages` re-exports
- The `_setRegisteredGroups` test helper
- The `isDirectRun` guard at bottom
- All error handling and cursor rollback logic in processGroupMessages
- The outgoing queue flush and reconnection logic (in WhatsAppChannel, not here)
