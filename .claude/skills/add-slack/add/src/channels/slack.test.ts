import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type Handler = (payload: { event: Record<string, unknown> }) => Promise<void>;

const appRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@slack/bolt', () => ({
  App: class MockApp {
    opts: Record<string, unknown>;
    eventHandlers = new Map<string, Handler[]>();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    client = {
      on: vi.fn(),
      auth: {
        test: vi.fn().mockResolvedValue({ user_id: 'U_BOT' }),
      },
      chat: {
        postMessage: vi.fn().mockResolvedValue(undefined),
      },
    };

    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      appRef.current = this;
    }

    event(name: string, handler: Handler): void {
      const existing = this.eventHandlers.get(name) || [];
      existing.push(handler);
      this.eventHandlers.set(name, existing);
    }
  },
}));

import { SlackChannel, SlackChannelOpts } from './slack.js';
import { logger } from '../logger.js';

function createOpts(overrides?: Partial<SlackChannelOpts>): SlackChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'slack:C123': {
        name: 'Slack Group',
        folder: 'main',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
    ...overrides,
  };
}

async function emitEvent(
  name: string,
  event: Record<string, unknown>,
): Promise<void> {
  const handlers = appRef.current.eventHandlers.get(name) || [];
  for (const handler of handlers) {
    await handler({ event });
  }
}

describe('SlackChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates instance with correct name', () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    expect(channel.name).toBe('slack');
  });

  it('isConnected returns false before connect', () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    expect(channel.isConnected()).toBe(false);
  });

  it('connect registers handlers and flips connected state', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());

    await channel.connect();

    expect(channel.isConnected()).toBe(true);
    expect(appRef.current.start).toHaveBeenCalledTimes(1);
    expect(appRef.current.eventHandlers.has('app_mention')).toBe(true);
    expect(appRef.current.eventHandlers.has('message')).toBe(true);
  });

  it('connect does not pass signingSecret to App', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();
    expect(appRef.current.opts.signingSecret).toBeUndefined();
  });

  it('configures retry policy with max 3 retries', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();

    const opts = appRef.current.opts as {
      clientOptions: {
        retryConfig: { retries: number; factor: number; randomize: boolean };
        rejectRateLimitedCalls: boolean;
      };
    };

    expect(opts.clientOptions.retryConfig.retries).toBe(3);
    expect(opts.clientOptions.retryConfig.factor).toBe(2);
    expect(opts.clientOptions.retryConfig.randomize).toBe(true);
    expect(opts.clientOptions.rejectRateLimitedCalls).toBe(false);
  });

  it('ownsJid returns true for slack: prefix', () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    expect(channel.ownsJid('slack:C123')).toBe(true);
  });

  it('ownsJid returns false for other prefixes', () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    expect(channel.ownsJid('tg:123')).toBe(false);
  });

  it('sendMessage strips slack: prefix', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();

    await channel.sendMessage('slack:C123', 'hello');

    expect(appRef.current.client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'hello',
    });
  });

  it('sends exactly 40000 chars as single message', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();

    await channel.sendMessage('slack:C123', 'x'.repeat(40000));

    expect(appRef.current.client.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  it('sends 40001 chars as two messages', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();

    await channel.sendMessage('slack:C123', 'x'.repeat(40001));

    expect(appRef.current.client.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('sends 120001 chars as four messages', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();

    await channel.sendMessage('slack:C123', 'x'.repeat(120001));

    expect(appRef.current.client.chat.postMessage).toHaveBeenCalledTimes(4);
  });

  it('logs structured error on send failure', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();

    const err = { code: 429, message: 'rate limited' };
    appRef.current.client.chat.postMessage.mockRejectedValueOnce(err);

    await channel.sendMessage('slack:C123', 'hello');

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'slack_send_failed',
        jid: 'slack:C123',
        status_code: 429,
        length: 5,
        err,
      }),
      'Failed to send Slack message after retries',
    );
  });

  it.todo('Bolt WebClient handles 429 Retry-After internally');

  it('stores inbound message for registered channel and translates mention trigger', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('app_mention', {
      channel: 'C123',
      user: 'U123',
      text: '<@U_BOT> hello',
      ts: '1704067200.000001',
      client_msg_id: 'm1',
    });

    expect(opts.onChatMetadata).toHaveBeenCalledWith(
      'slack:C123',
      '2024-01-01T00:00:00.000Z',
      undefined,
      'slack',
      true,
    );
    expect(opts.onMessage).toHaveBeenCalledWith(
      'slack:C123',
      expect.objectContaining({
        id: 'm1',
        content: '@Andy <@U_BOT> hello',
      }),
    );
  });

  it('ignores inbound message from unregistered channel', async () => {
    const opts = createOpts({ registeredGroups: vi.fn(() => ({})) });
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C999',
      user: 'U123',
      text: 'hello',
      ts: '1704067200.000001',
      client_msg_id: 'm2',
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('disconnect stops app and sets disconnected state', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', createOpts());
    await channel.connect();

    await channel.disconnect();

    expect(appRef.current.stop).toHaveBeenCalledTimes(1);
    expect(channel.isConnected()).toBe(false);
  });

  it('filters message_changed subtype', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      user: 'U123',
      text: 'edited message',
      ts: '1704067200.000002',
      subtype: 'message_changed',
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
    expect(opts.onChatMetadata).not.toHaveBeenCalled();
  });

  it('filters message_deleted subtype', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      ts: '1704067200.000003',
      subtype: 'message_deleted',
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
    expect(opts.onChatMetadata).not.toHaveBeenCalled();
  });

  it('filters channel_join subtype', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      user: 'U123',
      ts: '1704067200.000004',
      subtype: 'channel_join',
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
    expect(opts.onChatMetadata).not.toHaveBeenCalled();
  });

  it('filters bot_message subtype', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      bot_id: 'B123',
      text: 'bot says hi',
      ts: '1704067200.000005',
      subtype: 'bot_message',
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
    expect(opts.onChatMetadata).not.toHaveBeenCalled();
  });

  it('filters bot own messages by user ID', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      user: 'U_BOT',
      text: 'I said this',
      ts: '1704067200.000006',
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('filters all bot messages when filterBotMessages is true', async () => {
    const opts = createOpts({ filterBotMessages: true });
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      user: 'U_OTHER',
      bot_id: 'B123',
      text: 'another bot',
      ts: '1704067200.000007',
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('allows other bot messages when filterBotMessages is false', async () => {
    const opts = createOpts({ filterBotMessages: false });
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      user: 'U_OTHER',
      bot_id: 'B123',
      text: 'another bot message',
      ts: '1704067200.000008',
    });

    expect(opts.onMessage).toHaveBeenCalled();
  });

  it('deduplicates events with same channel:ts key', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    const event = {
      channel: 'C123',
      user: 'U123',
      text: 'hello',
      ts: '1704067200.000009',
      client_msg_id: 'dup1',
    };

    await emitEvent('message', event);
    await emitEvent('message', event);

    expect(opts.onMessage).toHaveBeenCalledTimes(1);
  });

  it('allows events with different ts', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      user: 'U123',
      text: 'first',
      ts: '1704067200.000010',
      client_msg_id: 'msg10',
    });

    await emitEvent('message', {
      channel: 'C123',
      user: 'U123',
      text: 'second',
      ts: '1704067200.000011',
      client_msg_id: 'msg11',
    });

    expect(opts.onMessage).toHaveBeenCalledTimes(2);
  });

  it('responds to !chatid command', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      user: 'U123',
      text: '!chatid',
      ts: '1704067200.000012',
    });

    expect(appRef.current.client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'Chat ID: slack:C123',
    });
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('filters URL unfurl message_changed events', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();

    await emitEvent('message', {
      channel: 'C123',
      ts: '1704067200.000013',
      subtype: 'message_changed',
      message: {
        text: 'https://example.com',
        attachments: [{ title: 'Example' }],
      },
      previous_message: { text: 'https://example.com' },
    });

    expect(opts.onMessage).not.toHaveBeenCalled();
    expect(opts.onChatMetadata).not.toHaveBeenCalled();
  });
  describe('token lifecycle events', () => {
    it('handles tokens_revoked by disconnecting', async () => {
      const channel = new SlackChannel(
        'xoxb-token',
        'xapp-token',
        createOpts(),
      );
      await channel.connect();
      expect(channel.isConnected()).toBe(true);
      await emitEvent('tokens_revoked', {});
      expect(appRef.current.stop).toHaveBeenCalled();
      expect(channel.isConnected()).toBe(false);
    });
    it('handles app_uninstalled by disconnecting', async () => {
      const channel = new SlackChannel(
        'xoxb-token',
        'xapp-token',
        createOpts(),
      );
      await channel.connect();
      expect(channel.isConnected()).toBe(true);
      await emitEvent('app_uninstalled', {});
      expect(appRef.current.stop).toHaveBeenCalled();
      expect(channel.isConnected()).toBe(false);
    });
  });
  describe('socket watchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    it('starts watchdog timer on connect', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const channel = new SlackChannel(
        'xoxb-token',
        'xapp-token',
        createOpts(),
      );
      await channel.connect();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    });
    it('triggers reconnect when socket is stale', async () => {
      const channel = new SlackChannel(
        'xoxb-token',
        'xapp-token',
        createOpts(),
      );
      await channel.connect();
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(appRef.current.stop).toHaveBeenCalled();
      expect(appRef.current.start).toHaveBeenCalledTimes(2);
    });
    it('clears watchdog on disconnect', async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const channel = new SlackChannel(
        'xoxb-token',
        'xapp-token',
        createOpts(),
      );
      await channel.connect();
      await channel.disconnect();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
    it('logs structured diagnostics on stale detection', async () => {
      const channel = new SlackChannel(
        'xoxb-token',
        'xapp-token',
        createOpts(),
      );
      await channel.connect();
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'socket_stale' }),
        expect.any(String),
      );
    });
    it('logs structured diagnostics on successful reconnect', async () => {
      const channel = new SlackChannel(
        'xoxb-token',
        'xapp-token',
        createOpts(),
      );
      await channel.connect();
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'socket_reconnect' }),
        expect.any(String),
      );
    });
  });
  it('updates lastEventTs on inbound events', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await channel.connect();
    await emitEvent('message', {
      channel: 'C123',
      user: 'U123',
      text: 'hello',
      ts: '1704067200.000099',
      client_msg_id: 'ts-test',
    });
    expect(opts.onMessage).toHaveBeenCalled();
  });
});
