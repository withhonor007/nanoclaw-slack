import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

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

async function emitEvent(name: string, event: Record<string, unknown>): Promise<void> {
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
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());
    expect(channel.name).toBe('slack');
  });

  it('isConnected returns false before connect', () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());
    expect(channel.isConnected()).toBe(false);
  });

  it('connect registers handlers and flips connected state', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());

    await channel.connect();

    expect(channel.isConnected()).toBe(true);
    expect(appRef.current.start).toHaveBeenCalledTimes(1);
    expect(appRef.current.eventHandlers.has('app_mention')).toBe(true);
    expect(appRef.current.eventHandlers.has('message')).toBe(true);
  });

  it('ownsJid returns true for slack: prefix', () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());
    expect(channel.ownsJid('slack:C123')).toBe(true);
  });

  it('ownsJid returns false for other prefixes', () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());
    expect(channel.ownsJid('tg:123')).toBe(false);
  });

  it('sendMessage strips slack: prefix', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());
    await channel.connect();

    await channel.sendMessage('slack:C123', 'hello');

    expect(appRef.current.client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'hello',
    });
  });

  it('sendMessage splits payload above 40000 chars', async () => {
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());
    await channel.connect();

    await channel.sendMessage('slack:C123', 'x'.repeat(41000));

    expect(appRef.current.client.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('stores inbound message for registered channel and translates mention trigger', async () => {
    const opts = createOpts();
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', opts);
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
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', opts);
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
    const channel = new SlackChannel('xoxb-token', 'xapp-token', 'secret', createOpts());
    await channel.connect();

    await channel.disconnect();

    expect(appRef.current.stop).toHaveBeenCalledTimes(1);
    expect(channel.isConnected()).toBe(false);
  });
});