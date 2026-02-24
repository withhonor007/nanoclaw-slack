# Slack 频道名称自动同步 — 详细开发计划

## Context

Slack 频道注册后，`registered_groups.name` 和 `chats.name` 都不会从 Slack API 同步更新，导致显示名称与实际 Slack 频道名不一致（如显示 `slack-main` 而实际频道名不同）。WhatsApp 已有 `syncGroupMetadata()` 机制（`whatsapp.ts:256-285`），需要为 Slack 实现对等功能。

## 数据流对比

### WhatsApp（已有）
```
connect() → syncGroupMetadata() → sock.groupFetchAllParticipating()
  → updateChatName(jid, subject)  [更新 chats 表]
  → setLastGroupSync()            [记录同步时间到 __group_sync__ sentinel]
```

### Slack（待实现）
```
connect() → syncChannelMetadata() → app.client.conversations.list()
  → updateChatName(jid, name)              [更新 chats 表]
  → updateRegisteredGroupName(jid, name)   [更新 registered_groups 表]
  → setLastGroupSync('__slack_sync__')     [记录同步时间到 __slack_sync__ sentinel]
```

### 关键差异：Slack 额外更新 `registered_groups.name`
WhatsApp 的 sync 只更新 `chats.name`，因为 WhatsApp 群组名称变更频率低且注册时名称通常准确。Slack 频道注册时 agent 自行命名，容易与实际不一致，因此需要同时更新 `registered_groups.name`。

---

## 修改清单（按执行顺序）

### Step 1: `src/db.ts` — 参数化 sentinel + 新增函数

**1a. 参数化 `getLastGroupSync`（第 217-223 行）**

当前实现硬编码 `'__group_sync__'`：
```typescript
// 当前
export function getLastGroupSync(): string | null {
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}
```

改为参数化，默认值保持向后兼容：
```typescript
// 改后
export function getLastGroupSync(sentinel = '__group_sync__'): string | null {
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = ?`)
    .get(sentinel) as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}
```

**1b. 参数化 `setLastGroupSync`（第 228-233 行）**

当前实现硬编码 `'__group_sync__'`：
```typescript
// 当前
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}
```

改为参数化：
```typescript
// 改后
export function setLastGroupSync(sentinel = '__group_sync__'): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`,
  ).run(sentinel, sentinel, now);
}
```

**1c. 新增 `updateRegisteredGroupName` 函数（第 233 行之后插入）**

```typescript
/**
 * Update the display name of a registered group.
 * No-op if the JID is not registered.
 */
export function updateRegisteredGroupName(jid: string, name: string): void {
  db.prepare(`UPDATE registered_groups SET name = ? WHERE jid = ?`).run(name, jid);
}
```

**影响分析**：WhatsApp 调用 `getLastGroupSync()` / `setLastGroupSync()` 不传参，使用默认值 `'__group_sync__'`，行为完全不变。

---

### Step 2: `src/index.ts` — sentinel 过滤泛化 + IPC 接线

**2a. `getAvailableGroups()` sentinel 过滤（第 107 行）**

当前只排除 `__group_sync__`，新增 `__slack_sync__` 后需要泛化：
```typescript
// 当前（第 107 行）
.filter((c) => c.jid !== '__group_sync__' && c.is_group)

// 改为
.filter((c) => !c.jid.startsWith('__') && c.is_group)
```

**2b. IPC `syncGroupMetadata` dep 扩展（第 487 行）**

当前只调用 WhatsApp sync：
```typescript
// 当前（第 487 行）
syncGroupMetadata: (force) => whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
```

扩展为同时调用 Slack sync（`SlackChannel` 已在第 15 行 import）：
```typescript
// 改为
syncGroupMetadata: async (force) => {
  await (whatsapp?.syncGroupMetadata(force) ?? Promise.resolve());
  const slackCh = channels.find((ch) => ch.name === 'slack') as SlackChannel | undefined;
  if (slackCh) await slackCh.syncChannelMetadata(force);
},
```

**影响分析**：IPC `refresh_groups` 命令（`ipc.ts:326-348`）调用 `deps.syncGroupMetadata(true)` 后会同时刷新 WhatsApp 和 Slack 的频道名称。`IpcDeps` 接口签名不变。

---

### Step 3: `src/channels/slack.ts` — 核心实现

**3a. 新增 import（第 1-11 行区域）**

在现有 import 之后添加 db 函数导入：
```typescript
import {
  getLastGroupSync,
  setLastGroupSync,
  updateChatName,
  updateRegisteredGroupName,
} from '../db.js';
```

**3b. 新增模块级常量（第 12 行区域，import 之后）**

```typescript
const SLACK_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SLACK_SYNC_SENTINEL = '__slack_sync__';
```

**3c. 新增类字段（第 32 行之后，现有字段区域）**

```typescript
private syncTimerStarted = false;
private syncTimer: ReturnType<typeof setInterval> | null = null;
```

**3d. 新增 `syncChannelMetadata` 方法（在 `disconnect()` 之后、`setTyping()` 之前插入，约第 159 行）**

完整方法体，对标 `whatsapp.ts:256-285` 的模式：
```typescript
/**
 * Sync channel metadata from Slack.
 * Fetches all channels the bot is in and stores their names.
 * Called on startup, daily, and on-demand via IPC.
 */
async syncChannelMetadata(force = false): Promise<void> {
  if (!this.app || !this.connected) return;

  if (!force) {
    const lastSync = getLastGroupSync(SLACK_SYNC_SENTINEL);
    if (lastSync) {
      const lastSyncTime = new Date(lastSync).getTime();
      if (Date.now() - lastSyncTime < SLACK_SYNC_INTERVAL_MS) {
        logger.debug({ lastSync }, 'Skipping Slack channel sync - synced recently');
        return;
      }
    }
  }

  try {
    logger.info('Syncing channel metadata from Slack...');
    const registeredGroups = this.opts.registeredGroups();
    let count = 0;
    let cursor: string | undefined;

    do {
      const result = await this.app.client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      for (const channel of result.channels || []) {
        if (!channel.id || !channel.name) continue;
        const jid = `slack:${channel.id}`;
        updateChatName(jid, channel.name);
        if (registeredGroups[jid]) {
          updateRegisteredGroupName(jid, channel.name);
        }
        count++;
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    setLastGroupSync(SLACK_SYNC_SENTINEL);
    logger.info({ count }, 'Slack channel metadata synced');
  } catch (err) {
    logger.error({ err }, 'Failed to sync Slack channel metadata');
  }
}
```

**设计要点**：
- 使用 `this.opts.registeredGroups()` 获取已注册频道（与 `handleInboundEvent` 第 271 行一致），不额外引入 `getAllRegisteredGroups`
- `conversations.list` 分页处理（`cursor`），`limit: 200` 减少请求次数
- `exclude_archived: true` 排除已归档频道
- 错误只 log 不抛出（与 WhatsApp 一致）

**3e. 在 `connect()` 末尾触发同步（第 101 行 `this.startWatchdog()` 之后）**

```typescript
this.connected = true;
logger.info('Slack bot connected via Socket Mode');
this.startWatchdog();

// ↓ 新增以下代码
// Sync channel metadata on startup (respects 24h cache)
this.syncChannelMetadata().catch((err) =>
  logger.error({ err }, 'Initial Slack channel sync failed'),
);
// Set up daily sync timer (only once)
if (!this.syncTimerStarted) {
  this.syncTimerStarted = true;
  this.syncTimer = setInterval(() => {
    this.syncChannelMetadata().catch((err) =>
      logger.error({ err }, 'Periodic Slack channel sync failed'),
    );
  }, SLACK_SYNC_INTERVAL_MS);
}
```

**3f. 在 `disconnect()` 中清理 sync 定时器（第 148-158 行）**

在现有 watchdog 清理之后、`this.app.stop()` 之前添加：
```typescript
async disconnect(): Promise<void> {
  this.connected = false;
  if (this.watchdogTimer) {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }
  // ↓ 新增
  if (this.syncTimer) {
    clearInterval(this.syncTimer);
    this.syncTimer = null;
  }
  if (!this.app) return;
  await this.app.stop();
  this.app = null;
  logger.info('Slack bot stopped');
}
```

---

### Step 4: `src/channels/slack.test.ts` — 新增 sync 测试

**4a. Mock 扩展（第 27-35 行，MockApp.client 对象）**

在现有 `chat` mock 之后添加 `conversations` mock：
```typescript
client = {
  on: vi.fn(),
  auth: { test: vi.fn().mockResolvedValue({ user_id: 'U_BOT' }) },
  chat: { postMessage: vi.fn().mockResolvedValue(undefined) },
  // ↓ 新增
  conversations: {
    list: vi.fn().mockResolvedValue({
      channels: [
        { id: 'C123', name: 'general' },
        { id: 'C456', name: 'random' },
      ],
      response_metadata: { next_cursor: '' },
    }),
  },
};
```

**4b. Mock db 模块（文件顶部 vi.mock 区域）**

```typescript
vi.mock('../db.js', () => ({
  getLastGroupSync: vi.fn().mockReturnValue(null),
  setLastGroupSync: vi.fn(),
  updateChatName: vi.fn(),
  updateRegisteredGroupName: vi.fn(),
}));
```

并在 import 区域添加：
```typescript
import { getLastGroupSync, setLastGroupSync, updateChatName, updateRegisteredGroupName } from '../db.js';
```

**4c. 新增测试 describe 块**

```typescript
describe('syncChannelMetadata', () => {
  it('fetches channels and updates names', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();
    await channel.syncChannelMetadata(true);

    expect(appRef.current.client.conversations.list).toHaveBeenCalledWith(
      expect.objectContaining({
        types: 'public_channel,private_channel',
        exclude_archived: true,
      }),
    );
    // C123 is registered in createOpts(), C456 is not
    expect(updateChatName).toHaveBeenCalledWith('slack:C123', 'general');
    expect(updateChatName).toHaveBeenCalledWith('slack:C456', 'random');
    expect(updateRegisteredGroupName).toHaveBeenCalledWith('slack:C123', 'general');
    expect(updateRegisteredGroupName).not.toHaveBeenCalledWith('slack:C456', expect.any(String));
    expect(setLastGroupSync).toHaveBeenCalledWith('__slack_sync__');
  });

  it('skips when not connected', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.syncChannelMetadata(true);
    expect(appRef.current?.client?.conversations?.list).not.toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();
    appRef.current.client.conversations.list.mockRejectedValueOnce(new Error('rate limited'));
    await expect(channel.syncChannelMetadata(true)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to sync Slack channel metadata',
    );
  });

  it('respects 24h cache when force=false', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();
    // Simulate recent sync
    vi.mocked(getLastGroupSync).mockReturnValueOnce(new Date().toISOString());
    await channel.syncChannelMetadata(false);
    expect(appRef.current.client.conversations.list).not.toHaveBeenCalled();
  });

  it('bypasses cache when force=true', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();
    vi.mocked(getLastGroupSync).mockReturnValueOnce(new Date().toISOString());
    await channel.syncChannelMetadata(true);
    expect(appRef.current.client.conversations.list).toHaveBeenCalled();
  });
});
```

---

### Step 5: `src/routing.test.ts` — sentinel 排除测试

**在 `excludes __group_sync__ sentinel` 测试（第 50-57 行）之后添加**：

```typescript
it('excludes __slack_sync__ sentinel', () => {
  storeChatMetadata('__slack_sync__', '2024-01-01T00:00:00.000Z');
  storeChatMetadata('slack:C123', '2024-01-01T00:00:01.000Z', 'Slack Channel', 'slack', true);

  const groups = getAvailableGroups();
  expect(groups).toHaveLength(1);
  expect(groups[0].jid).toBe('slack:C123');
});
```

---

## 不修改的部分

- `src/types.ts` — `Channel` 接口不变，sync 方法保持为类特定方法（与 WhatsApp 一致）
- `src/ipc.ts` — `IpcDeps` 接口签名不变，`refresh_groups` handler 不变
- `src/channels/whatsapp.ts` — 调用 `getLastGroupSync()` / `setLastGroupSync()` 无参数，行为不变

## Slack OAuth Scopes 前置条件

`conversations.list` 需要以下 Bot Token Scopes（在 Slack App 管理页面配置）：
- `channels:read` — 读取公共频道信息
- `groups:read` — 读取私有频道信息

## 验证步骤

1. `npm run build` — 编译通过
2. `npx vitest run src/channels/slack.test.ts` — sync 测试通过
3. `npx vitest run src/routing.test.ts` — sentinel 排除测试通过
4. 启动服务后日志出现 `Syncing channel metadata from Slack...` → `Slack channel metadata synced`
5. 检查数据库：`chats` 表和 `registered_groups` 表中 Slack 频道名称与实际一致
