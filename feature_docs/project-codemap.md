# Repository Atlas: NanoClaw

## Project Responsibility

Personal Claude assistant that connects WhatsApp to Claude Agent SDK running in isolated Linux containers. Single Node.js process: receives messages via Baileys WebSocket, persists to SQLite, dispatches to sandboxed containers, routes responses back. Each group gets its own filesystem, memory (`CLAUDE.md`), and container instance.

## System Entry Points

| File                                  | Purpose                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `src/index.ts`                        | Main orchestrator: startup, state, message polling loop, agent invocation |
| `src/channels/whatsapp.ts`            | WhatsApp WebSocket connection, auth, send/receive                         |
| `container/agent-runner/src/index.ts` | Container-side entrypoint: reads stdin, runs SDK query loop, IPC          |
| `setup/index.ts`                      | First-time setup CLI dispatcher                                           |
| `package.json`                        | Dependency manifest, npm scripts (`dev`, `build`, `start`)                |
| `tsconfig.json`                       | TypeScript config (ES2022, NodeNext)                                      |
| `vitest.config.ts`                    | Test configuration                                                        |

## Architecture Overview

```
WhatsApp (baileys) -> SQLite -> Polling loop (2s) -> Container (Claude Agent SDK) -> Response
                                                        <-> IPC (filesystem)
                                                   send_message / schedule_task / register_group
```

- **Message flow**: WhatsApp -> `onMessage` -> `storeMessage()` -> `startMessageLoop()` polls `getNewMessages()` -> `GroupQueue.enqueueMessageCheck()` -> `runContainerAgent()` -> container stdout -> `sendMessage()` -> WhatsApp
- **Scheduled tasks**: `startSchedulerLoop()` polls `getDueTasks()` every 60s -> `GroupQueue.enqueueTask()` -> `runContainerAgent()`
- **IPC**: Container writes JSON to `/workspace/ipc/` -> host `startIpcWatcher()` polls every 1s -> processes messages/tasks
- **Concurrency**: `GroupQueue` enforces `MAX_CONCURRENT_CONTAINERS` (default 5) with per-group queuing
- **Security**: Containers run as non-root, secrets passed via stdin (never env vars), `unset` hook strips API keys from Bash subprocesses, mounts validated against external allowlist

## Directory Map

| Directory                 | Responsibility                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/`                    | Core application layer: polling loop, container dispatch, SQLite persistence, message routing, IPC, scheduling        |
| `src/channels/`           | Channel adapters (WhatsApp via Baileys): connection lifecycle, auth, LID translation, message queue                   |
| `container/`              | Container image (Dockerfile), build script, agent-runner app, browser skill                                           |
| `container/agent-runner/` | In-container TypeScript app: SDK query loop, MCP server, IPC, conversation archiving                                  |
| `setup/`                  | First-time setup orchestration: platform detection, container build, WhatsApp auth, service install, verification     |
| `skills-engine/`          | Skill lifecycle management: three-way merge, backup/rollback, state tracking, conflict resolution, customize sessions |
| `scripts/`                | CLI utilities: skill apply/uninstall/rebase, core updates, CI matrix generation                                       |

## Non-Mapped Directories

| Directory           | Purpose                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `groups/`           | Per-group workspaces (runtime data, `CLAUDE.md` memory files)                        |
| `store/`            | SQLite database (`messages.db`), WhatsApp auth state                                 |
| `docs/`             | Architecture docs, security model, requirements                                      |
| `config-examples/`  | Example mount allowlist JSON                                                         |
| `.claude/skills/`   | Skill definitions (SKILL.md files for `/setup`, `/customize`, `/add-telegram`, etc.) |
| `container/skills/` | Container-injected skills (`agent-browser` for browser automation)                   |
| `launchd/`          | macOS launchd plist templates                                                        |

## Key Patterns

- **Skills over features**: New capabilities are contributed as Claude Code skills (`.claude/skills/`) that transform the codebase, not as merged features
- **Three-way merge**: Skills engine uses `git merge-file` with rerere for conflict resolution when applying/updating skills
- **Filesystem IPC**: Host <-> container communication via atomic JSON file writes (`.tmp` + rename)
- **Structured output protocol**: Setup steps emit `=== NANOCLAW SETUP: <STEP> ===` blocks; containers emit `---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` markers
- **MessageStream**: Push-based `AsyncIterable` keeps SDK query alive for multi-turn IPC conversations within a single container run

---


# src/

## Responsibility

Core application layer. Owns the full lifecycle: WhatsApp connection -> message persistence -> polling -> container dispatch -> response routing. Everything outside `src/channels/` lives here.

## Design

- **Polling loop** -- `startMessageLoop()` in `index.ts` polls SQLite every `POLL_INTERVAL` (2s) for new messages across all registered group JIDs.
- **Per-group container isolation** -- each group runs its own Docker container with only its own folder mounted. Main group gets the full project root.
- **Streaming output** -- containers emit `---NANOCLAW_OUTPUT_START---`/`---NANOCLAW_OUTPUT_END---` sentinel pairs; `runContainerAgent` parses them as they arrive and calls `onOutput` per chunk.
- **GroupQueue concurrency** -- `GroupQueue` enforces `MAX_CONCURRENT_CONTAINERS` (default 5), queues overflow, drains on completion. Tasks take priority over messages in the drain order.
- **IPC via filesystem** -- containers write JSON files to `data/ipc/{group}/messages/` and `data/ipc/{group}/tasks/`; `startIpcWatcher` polls every `IPC_POLL_INTERVAL` (1s) and processes them.
- **SQLite persistence** -- all messages, sessions, registered groups, scheduled tasks, and router state live in `store/messages.db` via `better-sqlite3`.
- **Secrets isolation** -- `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` are read from `.env` at spawn time and passed to the container via stdin only; never in `process.env`, never mounted.
- **Mount security** -- additional mounts validated against `~/.config/nanoclaw/mount-allowlist.json` (outside project root, never mounted into containers).

## Flow

```
WhatsApp (baileys)
  -> onMessage callback -> storeMessage() [SQLite]
  -> startMessageLoop() polls getNewMessages() every 2s
  -> TRIGGER_PATTERN check (non-main groups)
  -> GroupQueue.enqueueMessageCheck() / sendMessage() (pipe to active container)
  -> processGroupMessages() -> formatMessages() -> runAgent()
  -> runContainerAgent() spawns docker with mounts, writes input via stdin
  -> container emits OUTPUT_START...OUTPUT_END markers
  -> onOutput callback -> channel.sendMessage() -> WhatsApp
  -> session ID persisted via setSession()
```

Scheduled tasks follow a parallel path:
```
startSchedulerLoop() polls getDueTasks() every 60s
  -> GroupQueue.enqueueTask()
  -> runTask() -> runContainerAgent() -> sendMessage() via IPC
```

IPC (agent-initiated actions):
```
container writes JSON to data/ipc/{group}/messages/ or tasks/
  -> startIpcWatcher() picks up files
  -> sendMessage / createTask / registerGroup / syncGroupMetadata
```

## Key Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `index.ts` | Orchestrator: startup, state, message loop, agent invocation | `main()`, `startMessageLoop()`, `processGroupMessages()`, `runAgent()`, `getAvailableGroups()`, `loadState()`, `saveState()`, `registerGroup()` |
| `config.ts` | All constants and paths; reads non-secret config from `.env` | `TRIGGER_PATTERN`, `POLL_INTERVAL`, `CONTAINER_TIMEOUT`, `IDLE_TIMEOUT`, `MAX_CONCURRENT_CONTAINERS`, `GROUPS_DIR`, `DATA_DIR`, `STORE_DIR`, `MOUNT_ALLOWLIST_PATH`, `TIMEZONE` |
| `container-runner.ts` | Spawns Docker containers, builds volume mounts, streams output | `runContainerAgent()`, `buildVolumeMounts()`, `writeTasksSnapshot()`, `writeGroupsSnapshot()`, `ContainerInput`, `ContainerOutput` |
| `container-runtime.ts` | Runtime abstraction (docker binary, mount args, orphan cleanup) | `CONTAINER_RUNTIME_BIN`, `readonlyMountArgs()`, `stopContainer()`, `ensureContainerRuntimeRunning()`, `cleanupOrphans()` |
| `db.ts` | All SQLite operations via `better-sqlite3` | `initDatabase()`, `storeMessage()`, `getNewMessages()`, `getMessagesSince()`, `createTask()`, `getDueTasks()`, `updateTaskAfterRun()`, `logTaskRun()`, `setSession()`, `getAllSessions()`, `setRegisteredGroup()`, `getAllRegisteredGroups()`, `getRouterState()`, `setRouterState()`, `storeChatMetadata()` |
| `group-queue.ts` | Per-group concurrency queue with retry/backoff | `GroupQueue` class: `enqueueMessageCheck()`, `enqueueTask()`, `sendMessage()`, `closeStdin()`, `notifyIdle()`, `registerProcess()`, `shutdown()` |
| `ipc.ts` | Filesystem IPC watcher; processes agent-written task/message files | `startIpcWatcher()`, `processTaskIpc()`, `IpcDeps` |
| `router.ts` | Message formatting and channel dispatch | `formatMessages()`, `formatOutbound()`, `stripInternalTags()`, `escapeXml()`, `findChannel()`, `routeOutbound()` |
| `task-scheduler.ts` | Scheduled task polling loop and execution | `startSchedulerLoop()`, `runTask()`, `SchedulerDependencies` |
| `types.ts` | Shared type definitions | `RegisteredGroup`, `NewMessage`, `ScheduledTask`, `TaskRunLog`, `Channel`, `ContainerConfig`, `AdditionalMount`, `MountAllowlist`, `AllowedRoot` |
| `mount-security.ts` | Validates additional container mounts against external allowlist | `validateMount()`, `validateAdditionalMounts()`, `loadMountAllowlist()`, `generateAllowlistTemplate()`, `MountValidationResult` |
| `env.ts` | Reads specific keys from `.env` without polluting `process.env` | `readEnvFile()` |
| `logger.ts` | Shared pino logger with uncaught exception handler | `logger` |
| `whatsapp-auth.ts` | Standalone auth script (QR + pairing code); not imported by main | `authenticate()`, `connectSocket()` (script entry point only) |

## Integration

**Depends on:**
- `src/channels/whatsapp.ts` -- `WhatsAppChannel` class for inbound/outbound WhatsApp messages
- `container/agent-runner/src` -- mounted read-only into containers; recompiled on container startup
- `container/skills/` -- synced into each group's `.claude/skills/` before container spawn
- `store/messages.db` -- SQLite database (created on first run)
- `data/ipc/{group}/` -- filesystem IPC directories (created on demand)
- `groups/{group}/` -- per-group workspace directories (created on `registerGroup`)
- `~/.config/nanoclaw/mount-allowlist.json` -- external mount security config (optional)
- Docker / container runtime -- must be running; checked at startup via `ensureContainerRuntimeRunning()`

**Depended on by:**
- `src/channels/whatsapp.ts` -- calls back into `index.ts` via `onMessage` / `onChatMetadata` callbacks
- Container agents -- read `data/ipc/{group}/current_tasks.json` and `available_groups.json` written by `writeTasksSnapshot()` / `writeGroupsSnapshot()`; write IPC files consumed by `startIpcWatcher()`

---

# src/channels/

## Responsibility

Channel adapters -- each file in this directory wraps a messaging platform into a uniform `Channel` interface. Currently only WhatsApp is implemented via `@whiskeysockets/baileys`.

## Design

`WhatsAppChannel` implements the `Channel` interface from `../types.ts` and owns the full lifecycle of a Baileys WebSocket connection:

- Auth state is persisted to `{STORE_DIR}/auth/` via `useMultiFileAuthState`. No QR code is rendered at runtime -- if auth is missing the process exits and fires a macOS notification directing the user to `/setup`.
- Reconnection is automatic on non-logout disconnects. First retry is immediate; a 5 s fallback retry fires if that fails. Logged-out state exits cleanly.
- Outgoing messages are buffered in `outgoingQueue: Array<{jid, text}>` while disconnected and flushed via `flushOutgoingQueue()` on reconnect. The flush is guarded by a `flushing` boolean to prevent concurrent drains.
- Group metadata (display names) is synced from WhatsApp on startup and every 24 h via `syncGroupMetadata()`, writing to SQLite via `updateChatName`. The last-sync timestamp is stored via `setLastGroupSync` / `getLastGroupSync`.
- LID JIDs (WhatsApp's privacy-preserving identifiers) are translated to phone JIDs via a local `lidToPhoneMap` cache, falling back to `sock.signalRepository.lidMapping.getPNForLID()`.
- Bot-message detection differs by deployment mode: when `ASSISTANT_HAS_OWN_NUMBER` is true, `msg.key.fromMe` is authoritative; otherwise the assistant-name prefix (`${ASSISTANT_NAME}:`) is checked on the content string.

## Flow

```
Baileys WebSocket
  -> sock.ev.on('messages.upsert')
       |-- translateJid()           -- LID -> phone JID
       |-- opts.onChatMetadata()    -- always fires (group discovery)
       +-- opts.onMessage()         -- fires only for registered groups
                                      (checked via opts.registeredGroups())

Outbound path:
  sendMessage(jid, text)
    |-- prefixes text with ASSISTANT_NAME if shared number
    |-- if disconnected -> push to outgoingQueue
    +-- sock.sendMessage()  (or queue on error)

Typing indicators:
  setTyping(jid, true/false) -> sock.sendPresenceUpdate('composing'|'paused', jid)
```

## Key Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `whatsapp.ts` | WhatsApp channel adapter wrapping Baileys | `WhatsAppChannel` (class), `WhatsAppChannelOpts` (interface) |

## Integration

- Instantiated in `src/index.ts` with `onMessage`, `onChatMetadata`, and `registeredGroups` callbacks.
- Implements `Channel` from `src/types.ts` (`connect`, `sendMessage`, `isConnected`, `ownsJid`, `disconnect`, `setTyping`).
- Reads config from `src/config.ts`: `STORE_DIR`, `ASSISTANT_NAME`, `ASSISTANT_HAS_OWN_NUMBER`.
- Reads/writes SQLite via `src/db.ts`: `getLastGroupSync`, `setLastGroupSync`, `updateChatName`.
- Logs via `src/logger.ts`.
- Runtime dependency: `@whiskeysockets/baileys` (WebSocket transport, auth, signal protocol).

---
# container/
## Responsibility
Container image definition and sandboxed agent execution environment. Packages the Claude Agent SDK runner, browser automation tooling, and an MCP server into an isolated Linux image. Every agent invocation runs inside this container with only explicitly mounted directories visible.
## Design
**Dockerfile layers:**
1. `node:22-slim` base with Chromium and all its system dependencies installed via apt
2. `agent-browser` and `@anthropic-ai/claude-code` installed globally (available as CLI tools inside the container)
3. `agent-runner` app copied and compiled (`npm run build`)
4. `/workspace/{group,global,extra,ipc/{messages,tasks,input}}` directories created
5. Entrypoint script baked in: recompiles TypeScript to `/tmp/dist`, reads stdin JSON to `/tmp/input.json`, runs `node /tmp/dist/index.js`, then deletes the temp file (which may contain secrets)
6. Runs as non-root `node` user; working directory is `/workspace/group`
**Security model:**
- Non-root user required for `--dangerously-skip-permissions`
- Secrets passed via stdin JSON, deleted from `/tmp/input.json` immediately after Node reads them
- `createSanitizeBashHook` prepends `unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN` to every Bash command so subprocesses cannot inherit API credentials
- Filesystem isolation: only mounted directories are visible
**IPC mechanism (filesystem-based):**
- Host -> container: JSON files dropped into `/workspace/ipc/input/` (follow-up messages) or `_close` sentinel to end the session
- Container -> host: JSON files written atomically (write to `.tmp`, then `rename`) into `/workspace/ipc/messages/` (outbound messages) and `/workspace/ipc/tasks/` (task operations)
- The MCP server (`ipc-mcp-stdio.ts`) is the container-side writer; `src/ipc.ts` on the host is the reader
**Agent SDK integration:**
- `query()` from `@anthropic-ai/claude-agent-sdk` drives the agent loop
- `MessageStream` (push-based `AsyncIterable`) keeps `isSingleUserTurn=false`, which allows agent teams subagents to run to completion
- IPC input is polled at 500ms intervals and piped into the live `MessageStream` during an active query
- Session continuity: `sessionId` and `resumeAt` (last assistant UUID) are threaded across the query loop so follow-up messages resume the same conversation
**Conversation archiving:**
- `PreCompact` hook fires before Claude compacts the context window
- Hook reads the JSONL transcript, parses user/assistant turns, and writes a Markdown archive to `/workspace/group/conversations/`
- Filename: `YYYY-MM-DD-<summary-slug>.md` (summary sourced from `sessions-index.json`)
**Skills:**
- `skills/agent-browser/SKILL.md` is a Claude Code skill definition (not injected at build time)
- The `agent-browser` npm package is installed globally in the image, making the `agent-browser` CLI available to Bash tool calls
- `AGENT_BROWSER_EXECUTABLE_PATH` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` point to the system Chromium
## Flow
```
build.sh
  +-- docker/container build -> nanoclaw-agent:latest image
container-runner.ts (host)
  +-- spawns container with mounts:
       /workspace/group  <- groups/{name}/
       /workspace/global <- groups/global/
       /workspace/ipc    <- ipc/{groupName}/
       /workspace/extra/* <- optional extra dirs
  +-- writes ContainerInput JSON to container stdin
entrypoint.sh (inside container)
  +-- tsc recompile -> /tmp/dist
  +-- reads stdin -> /tmp/input.json
  +-- node /tmp/dist/index.js < /tmp/input.json
index.ts main()
  +-- parse ContainerInput from stdin, delete /tmp/input.json
  +-- build sdkEnv (process.env + secrets, never written to process.env)
  +-- query loop:
       runQuery(prompt, sessionId, mcpServerPath, ...)
         +-- MessageStream.push(prompt)
         +-- poll IPC input every 500ms -> push follow-up messages into stream
         +-- query() SDK -> streams assistant messages
         +-- on 'result' message -> writeOutput() to stdout
         +-- on _close sentinel -> stream.end(), exit loop
       writeOutput({ status:'success', result:null, newSessionId }) <- session update
       waitForIpcMessage() <- blocks until next message or _close
       loop with new prompt
ipc-mcp-stdio.ts (MCP server, spawned as child process by SDK)
  +-- registered as 'nanoclaw' MCP server in query() options
  +-- exposes tools: send_message, schedule_task, list_tasks,
                    pause_task, resume_task, cancel_task, register_group
  +-- writes IPC files to /workspace/ipc/messages/ and /workspace/ipc/tasks/
  +-- host src/ipc.ts polls and processes these files
```
## Key Files
| File | Purpose | Key exports / tools |
|------|---------|---------------------|
| `Dockerfile` | Image definition: Chromium, agent-browser, claude-code, agent-runner build, entrypoint | -- |
| `build.sh` | Builds `nanoclaw-agent:latest` (or tagged) via `$CONTAINER_RUNTIME` (default: docker) | -- |
| `agent-runner/src/index.ts` | Container entrypoint: reads stdin, runs SDK query loop, handles IPC polling, writes stdout | `ContainerInput`, `ContainerOutput`, `MessageStream`, `runQuery()`, `main()` |
| `agent-runner/src/ipc-mcp-stdio.ts` | Stdio MCP server exposing NanoClaw tools to the agent | `send_message`, `schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task`, `register_group` |
| `agent-runner/package.json` | ESM Node package; deps: `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, `cron-parser`, `zod` | -- |
| `agent-runner/tsconfig.json` | ES2022 target, NodeNext modules, strict mode | -- |
| `skills/agent-browser/SKILL.md` | Claude Code skill: teaches the agent how to use the `agent-browser` CLI for browser automation | -- |
## Integration
- **Spawned by** `src/container-runner.ts` -- mounts group/global/ipc/extra directories, passes `ContainerInput` via stdin, reads `ContainerOutput` JSON from stdout between `---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` markers
- **IPC read by** `src/ipc.ts` -- polls `/workspace/ipc/messages/` for outbound messages and `/workspace/ipc/tasks/` for task operations (schedule, pause, resume, cancel, register_group)
- **Session state** stored in `/workspace/group/.claude/` by the SDK; persisted across container runs via the mounted group directory
- **Global context** loaded from `/workspace/global/CLAUDE.md` and appended to the system prompt for non-main groups
- **Extra directories** mounted at `/workspace/extra/*` are passed to `additionalDirectories` in the SDK so their `CLAUDE.md` files are auto-loaded
---
# setup/
## Responsibility
First-time setup orchestration. Each file is a discrete, independently invokable step that replaces a legacy shell script. Steps detect platform, install dependencies, build the container image, authenticate WhatsApp, sync groups, register channels, configure mounts, install the system service, and run a final health check.
## Design
- **Step-per-file pattern**: `index.ts` is the CLI dispatcher; every other file exports a single `run(args: string[]): Promise<void>`. Steps are loaded lazily via dynamic `import()`.
- **Structured output protocol**: Every step calls `emitStatus(stepName, fields)` (from `status.ts`) to emit a `=== NANOCLAW SETUP: <STEP> ===` block that the `/setup` SKILL.md LLM parses to decide next actions.
- **Platform abstraction**: All OS/runtime detection is centralised in `platform.ts`; steps import from it rather than shelling out to `uname` or `which`.
- **No shell injection**: Args are parsed manually (no `minimist`/`yargs`), SQL uses parameterized queries (`better-sqlite3`), and JSON is parsed with `JSON.parse` rather than piped through shell.
- **Exit codes are semantic**: `0` = success, `1` = step failed, `2` = runtime not available, `3` = timeout, `4` = bad args.
## Flow
```
npx tsx setup/index.ts --step <name> [args]
        |
  index.ts: STEPS registry -> dynamic import -> mod.run(args)
        |
        |-- environment   -> detect platform/runtimes/existing config -> emitStatus CHECK_ENVIRONMENT
        |-- container     -> build nanoclaw-agent:latest, test run     -> emitStatus SETUP_CONTAINER
        |-- whatsapp-auth -> spawn src/whatsapp-auth.ts, poll store/auth-status.txt
        |                  |-- qr-browser:    generate QR HTML, open browser, poll 120s
        |                  |-- pairing-code:  emit PAIRING_CODE immediately, poll 120s
        |                  +-- qr-terminal:   manual (emits manual status, returns)
        |                                    -> emitStatus AUTH_WHATSAPP
        |-- groups        -> --list: query chats table from SQLite
        |                  (default): npm run build, inline ESM sync script via baileys
        |                             groupFetchAllParticipating() -> upsert chats table
        |                             -> emitStatus SYNC_GROUPS
        |-- register      -> INSERT OR REPLACE registered_groups, mkdir groups/<folder>/logs
        |                  optionally rewrite CLAUDE.md + .env for custom assistant name
        |                  -> emitStatus REGISTER_CHANNEL
        |-- mounts        -> write ~/.config/nanoclaw/mount-allowlist.json
        |                  (--empty | --json <json> | stdin)
        |                  -> emitStatus CONFIGURE_MOUNTS
        |-- service       -> npm run build, then:
        |                  macOS:  write ~/Library/LaunchAgents/com.nanoclaw.plist, launchctl load
        |                  Linux/systemd: write ~/.config/systemd/user/nanoclaw.service
        |                                killOrphanedProcesses, daemon-reload, enable, start
        |                  Linux/no-systemd: write start-nanoclaw.sh (nohup wrapper)
        |                  -> emitStatus SETUP_SERVICE
        +-- verify        -> check service status, container runtime, .env credentials,
                            store/auth dir, registered_groups count, mount-allowlist.json
                            -> emitStatus VERIFY (STATUS: success|failed)
```
## Key Files
| File | Purpose | Key Exports |
|------|---------|-------------|
| `index.ts` | CLI entry point; dispatches `--step <name>` to the matching module | `main()` (internal), `STEPS` registry |
| `status.ts` | Emits structured `=== NANOCLAW SETUP: <STEP> ===` blocks for SKILL.md parsing | `emitStatus(step, fields)` |
| `platform.ts` | Cross-platform detection utilities | `getPlatform()`, `getServiceManager()`, `isWSL()`, `isRoot()`, `isHeadless()`, `hasSystemd()`, `openBrowser()`, `commandExists()`, `getNodePath()`, `getNodeVersion()`, `getNodeMajorVersion()` |
| `environment.ts` | Detects OS, Node, Apple Container, Docker, existing `.env`/auth/groups | `run(args)` -> emits `CHECK_ENVIRONMENT` |
| `container.ts` | Builds `nanoclaw-agent:latest` and smoke-tests it | `run(args)` -> emits `SETUP_CONTAINER` |
| `whatsapp-auth.ts` | Spawns `src/whatsapp-auth.ts`, polls `store/auth-status.txt`, handles QR browser + pairing code flows | `run(args)`, `handleQrBrowser()`, `handlePairingCode()`, `pollAuthCompletion()`, `emitAuthStatus()` |
| `groups.ts` | Syncs WhatsApp group metadata into `chats` table; lists groups from DB | `run(args)`, `syncGroups()`, `listGroups()` |
| `register.ts` | Registers a channel in `registered_groups` table; creates group folder; patches CLAUDE.md + `.env` for assistant name | `run(args)` |
| `mounts.ts` | Writes `~/.config/nanoclaw/mount-allowlist.json` | `run(args)` |
| `service.ts` | Installs and starts the nanoclaw system service | `run(args)`, `setupLaunchd()`, `setupLinux()`, `setupSystemd()`, `setupNohupFallback()`, `killOrphanedProcesses()`, `checkDockerGroupStale()` |
| `verify.ts` | End-to-end health check: service, container runtime, credentials, WhatsApp auth, registered groups, mount allowlist | `run(args)` -> emits `VERIFY` |
## Integration
- **Invoked by**: `.claude/skills/setup/SKILL.md` -- the `/setup` skill runs each step via `npx tsx setup/index.ts --step <name>` and parses the `=== NANOCLAW SETUP ===` output blocks to drive the interactive setup flow.
- **Reads from**: `src/config.ts` (`STORE_DIR`), `src/logger.ts` (pino logger), `store/auth/` (WhatsApp credentials), `store/messages.db` (SQLite).
- **Writes to**: `store/messages.db` (groups/register steps), `store/auth-status.txt` + `store/qr-data.txt` (whatsapp-auth polling), `store/qr-auth.html` (QR browser page), `~/.config/nanoclaw/mount-allowlist.json` (mounts), service files (service), `groups/<folder>/logs/` (register), `.env` (register).
- **Runtime dependencies**: `better-sqlite3`, `@whiskeysockets/baileys`, `qrcode`, `pino`.
- **Container runtime**: `container` (Apple Container) or `docker` -- detected in `environment.ts`, passed as `--runtime` to `container.ts`.
---
# scripts/
## Responsibility
CLI utilities for skill lifecycle management (apply, uninstall, rebase), core updates, and CI overlap testing. Each script is a thin CLI wrapper over `skills-engine/` logic -- argument parsing, output formatting, and exit codes only.
## Design
- All scripts use `process.argv` for positional argument parsing -- no flag libraries.
- Output is either human-readable console logs or raw `JSON.stringify` for machine consumption.
- Non-zero `process.exit(1)` on any failure; zero on success.
- Scripts are invoked via `npx tsx` (shebang or direct) -- no compilation step needed.
- `generate-ci-matrix.ts` is dual-mode: importable as a module (exports `generateMatrix`, `computeOverlapMatrix`, etc.) and executable as a CLI when run directly (guarded by `import.meta.url` check).
- `run-ci-tests.ts` imports from `generate-ci-matrix.ts` directly -- the only inter-script dependency.
## Key Files
| File | Purpose | CLI Usage |
|------|---------|-----------|
| `apply-skill.ts` | Apply a skill directory to the project via `skills-engine/apply` | `tsx scripts/apply-skill.ts <skill-dir>` |
| `uninstall-skill.ts` | Remove an installed skill; warns on custom patches; prints replay test results | `npx tsx scripts/uninstall-skill.ts <skill-name>` |
| `rebase.ts` | Rebase current skill state, optionally against a new base path | `npx tsx scripts/rebase.ts [new-base-path]` |
| `update-core.ts` | Preview then apply a core update from a new core path; shows conflict/patch risk | `tsx scripts/update-core.ts <path-to-new-core>` |
| `generate-ci-matrix.ts` | Scan `.claude/skills/` manifests and compute overlapping skill pairs | `npx tsx scripts/generate-ci-matrix.ts` (outputs JSON) |
| `run-ci-tests.ts` | For each overlapping pair: copy project to tmpdir, apply skills in sequence, run `vitest` | `npx tsx scripts/run-ci-tests.ts` |
| `generate-resolutions.ts` | One-time generator: produce `git rerere`-compatible preimage/resolution files | `npx tsx scripts/generate-resolutions.ts` |
## Integration
- All skill lifecycle scripts delegate entirely to `skills-engine/` (`apply.js`, `uninstall.js`, `rebase.js`, `update.js`).
- `generate-ci-matrix.ts` reads `manifest.yaml` from each skill under `.claude/skills/` using `skills-engine/types.ts` (`SkillManifest`).
- `run-ci-tests.ts` calls `generate-ci-matrix.ts` as a module, then shells out to `scripts/apply-skill.ts` and `npx vitest run` inside isolated tmpdirs.
- `run-ci-tests.ts` is the intended entry point for CI pipelines; `apply-skill.ts` and `uninstall-skill.ts` are invoked by Claude Code skills.
---
# skills-engine/
## Responsibility
Skill lifecycle management: install, apply, update, uninstall, and conflict resolution for NanoClaw's code-transformation skill system. Skills are packages that add or modify project files via three-way merge, with full rollback support.
## Design
**Skill application model.** A skill package contains `manifest.yaml`, an `add/` directory (new files), and a `modify/` directory (patches to existing files). The engine applies `add/` files by copy and `modify/` files by three-way merge (`git merge-file`) against a stored base snapshot in `.nanoclaw/base/`.
**Merge strategy.** Every merge is three-way: `current <- base -> skill`. The base snapshot is the clean core at the time `initNanoclawDir()` was run. Drift (user edits to tracked files) is detected by comparing current hashes against base hashes before merging. On conflict, `git rerere` is attempted via `setupRerereAdapter` + `runRerere`; if rerere auto-resolves, the file is staged and cleaned up. Unresolved conflicts leave conflict markers in the working tree and return `backupPending: true`.
**State tracking.** `.nanoclaw/state.yaml` records `applied_skills` (name, version, `applied_at`, per-file SHA-256 hashes, structured outcomes), `custom_modifications` (patch file references), `path_remap` (renamed core files), and `rebased_at`. Writes are atomic via temp-file + rename.
**Backup/rollback.** Before any mutating operation, `createBackup()` copies all affected files into `.nanoclaw/backup/`. Files that don't exist yet get a `.tombstone` marker so `restoreBackup()` knows to delete them. `clearBackup()` removes the backup after success.
**Structured operations.** Skills can declare `npm_dependencies`, `env_additions`, and `docker_compose_services` in `manifest.yaml`. These are merged into `package.json`, `.env.example`, and `docker-compose.yml` respectively by `structured.ts`, with semver range compatibility checks and port-collision detection.
**Customize sessions.** `startCustomize()` snapshots current file hashes into `.nanoclaw/custom/pending.yaml`. `commitCustomize()` diffs changed files against base and saves a numbered `.patch` file in `.nanoclaw/custom/`. `applySkill` and `applyUpdate` block while a customize session is active.
**Resolution cache.** Pre-computed conflict resolutions are stored as `.preimage`/`.resolution` file pairs under `.nanoclaw/resolutions/<skill-combo-key>/`. `loadResolutions()` verifies input hashes before injecting pairs into git's `rr-cache`, enabling rerere to auto-resolve known conflicts.
**Uninstall via replay.** Uninstalling a skill resets all touched files to base, then replays the remaining skills in original order using `replaySkills()`. Uninstall is blocked after `rebase()` because the base no longer separates individual skill contributions.
**Rebase.** `rebase()` has two modes: (1) no argument -- flattens current working tree into base; (2) with `newBasePath` -- three-way merges the new base against the old base and saved working tree, enabling core version upgrades while preserving skill modifications.
**Path remap.** When core files are renamed across versions, `path_remap` in state maps old relative paths to new ones. `resolvePathRemap()` is called before every file access in apply, replay, and uninstall.
**Locking.** `acquireLock()` writes a PID + timestamp JSON to `.nanoclaw/lock` using `O_EXCL` (atomic). Stale locks (>5 min or dead PID) are overwritten. Returns a release function called in `finally` blocks.
## Key Files
| File | Purpose | Key Exports |
|------|---------|-------------|
| `index.ts` | Public API barrel -- re-exports everything | All public symbols |
| `types.ts` | All shared interfaces | `SkillManifest`, `SkillState`, `AppliedSkill`, `ApplyResult`, `MergeResult`, `FileOperation`, `FileOpsResult`, `CustomModification`, `FileInputHashes`, `ResolutionMeta`, `UpdatePreview`, `UpdateResult`, `UninstallResult`, `RebaseResult` |
| `apply.ts` | Core skill application orchestrator | `applySkill(skillDir): Promise<ApplyResult>` |
| `update.ts` | Core version upgrade | `previewUpdate(newCorePath): UpdatePreview`, `applyUpdate(newCorePath): Promise<UpdateResult>` |
| `uninstall.ts` | Skill removal via replay | `uninstallSkill(skillName): Promise<UninstallResult>` |
| `rebase.ts` | Flatten or rebase onto new core | `rebase(newBasePath?): Promise<RebaseResult>` |
| `replay.ts` | Replay skill stack from clean base | `replaySkills(options): Promise<ReplayResult>`, `findSkillDir(skillName, projectRoot?)` |
| `merge.ts` | git merge-file + rerere integration | `mergeFile(current, base, skill): MergeResult`, `setupRerereAdapter(...)`, `runRerere(filePath): boolean`, `cleanupMergeState(filePath?)`, `isGitRepo(): boolean` |
| `state.ts` | `.nanoclaw/state.yaml` read/write | `readState(): SkillState`, `writeState(state)`, `recordSkillApplication(...)`, `getAppliedSkills()`, `recordCustomModification(...)`, `getCustomModifications()`, `computeFileHash(filePath): string`, `compareSemver(a, b): number` |
| `manifest.ts` | Parse and validate `manifest.yaml` | `readManifest(skillDir): SkillManifest`, `checkCoreVersion(manifest)`, `checkDependencies(manifest)`, `checkSystemVersion(manifest)`, `checkConflicts(manifest)` |
| `backup.ts` | Pre-operation snapshot and rollback | `createBackup(filePaths)`, `restoreBackup()`, `clearBackup()` |
| `lock.ts` | PID-based filesystem lock | `acquireLock(): () => void`, `releaseLock()`, `isLocked(): boolean` |
| `customize.ts` | Track and commit user modifications as patches | `startCustomize(description)`, `commitCustomize()`, `abortCustomize()`, `isCustomizeActive(): boolean` |
| `structured.ts` | Merge structured manifest fields into project files | `mergeNpmDependencies(pkgPath, deps)`, `mergeEnvAdditions(envPath, additions)`, `mergeDockerComposeServices(composePath, services)`, `runNpmInstall()`, `areRangesCompatible(existing, requested)` |
| `resolution-cache.ts` | Pre-computed conflict resolution store | `loadResolutions(skills, projectRoot, skillDir): boolean`, `saveResolution(skills, files, meta, projectRoot)`, `findResolutionDir(skills, projectRoot)`, `clearAllResolutions(projectRoot)` |
| `path-remap.ts` | Translate old file paths to renamed paths | `resolvePathRemap(relPath, remap): string`, `loadPathRemap(): Record<string,string>`, `recordPathRemap(remap)` |
| `init.ts` | Bootstrap `.nanoclaw/` directory and base snapshot | `initNanoclawDir()` |
| `migrate.ts` | First-time setup and migration from pre-skills state | `initSkillsSystem()`, `migrateExisting()` |
| `file-ops.ts` | Execute `file_ops` from manifest (rename/delete/move) | `executeFileOps(ops, projectRoot): FileOpsResult` |
| `fs-utils.ts` | Recursive directory copy | `copyDir(src, dest)` |
| `constants.ts` | Path constants and schema version | `NANOCLAW_DIR`, `STATE_FILE`, `BASE_DIR`, `BACKUP_DIR`, `LOCK_FILE`, `CUSTOM_DIR`, `RESOLUTIONS_DIR`, `SHIPPED_RESOLUTIONS_DIR`, `SKILLS_SCHEMA_VERSION` |
## Integration
- **Entry scripts** (`scripts/` directory): `apply-skill.ts`, `update-core.ts`, `uninstall-skill.ts`, `rebase.ts`, `generate-resolutions.ts`, `run-ci-tests.ts`, `generate-ci-matrix.ts`
- **Skill packages** live in `.claude/skills/<name>/` and are discovered by `findSkillDir()` scanning for `manifest.yaml` files.
- **`/customize` skill** calls `startCustomize()` / `commitCustomize()` / `abortCustomize()` to record user modifications as numbered patch files.
- **`.nanoclaw/` directory** is managed entirely by this engine (state.yaml, lock, base/, backup/, custom/, resolutions/).