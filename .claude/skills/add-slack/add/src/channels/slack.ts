import { App } from '@slack/bolt';
import { WebClientEvent } from '@slack/web-api';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface SlackChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  filterBotMessages?: boolean; // default true
}

export class SlackChannel implements Channel {
  name = 'slack';
  private app: App | null = null;
  private connected = false;
  private opts: SlackChannelOpts;
  private botToken: string;
  private appToken: string;
  private botUserId = '';
  private safeMode = false;
  private seenEvents = new Map<string, number>(); // key → expiry timestamp
  private lastEventTs = Date.now();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;

  constructor(botToken: string, appToken: string, opts: SlackChannelOpts) {
    this.botToken = botToken;
    this.appToken = appToken;
    this.opts = opts;
  }
  async connect(): Promise<void> {
    this.app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
      clientOptions: {
        retryConfig: {
          retries: 3,
          factor: 2,
          randomize: true,
        },
        rejectRateLimitedCalls: false,
      },
    });

    this.app.event('app_mention', async ({ event }: { event: unknown }) => {
      this.lastEventTs = Date.now();
      await this.handleInboundEvent(event as Record<string, unknown>, true);
    });
    this.app.event('message', async ({ event }: { event: unknown }) => {
      this.lastEventTs = Date.now();
      await this.handleInboundEvent(event as Record<string, unknown>, false);
    });
    this.app.event('tokens_revoked', async () => {
      this.lastEventTs = Date.now();
      logger.warn(
        { event: 'token_revoked' },
        'Slack tokens revoked — disconnecting',
      );
      await this.disconnect();
    });
    this.app.event('app_uninstalled', async () => {
      this.lastEventTs = Date.now();
      logger.warn(
        { event: 'app_uninstalled' },
        'Slack app uninstalled — disconnecting',
      );
      await this.disconnect();
    });

    await this.app.start();

    this.app.client.on(
      WebClientEvent.RATE_LIMITED,
      (retryAfter: number, { url }: { url: string }) => {
        logger.warn(
          { event: 'slack_rate_limited', retry_after_s: retryAfter, url },
          'Slack rate limited',
        );
      },
    );

    try {
      const auth = await this.app.client.auth.test({});
      this.botUserId = (auth.user_id as string | undefined) || '';
    } catch (err) {
      logger.error({ err }, 'Slack auth.test failed; entering safe mode');
      this.safeMode = true;
    }

    this.connected = true;
    logger.info('Slack bot connected via Socket Mode');
    this.startWatchdog();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.app || !this.connected) {
      logger.warn({ jid }, 'Slack app not initialized');
      return;
    }

    const channelId = jid.replace(/^slack:/, '');
    const MAX_LENGTH = 40_000;

    try {
      if (text.length <= MAX_LENGTH) {
        await this.app.client.chat.postMessage({ channel: channelId, text });
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: text.slice(i, i + MAX_LENGTH),
          });
        }
      }
      logger.info({ jid, length: text.length }, 'Slack message sent');
    } catch (err: unknown) {
      const statusCode = (err as { code?: number })?.code;
      logger.error(
        {
          event: 'slack_send_failed',
          jid,
          status_code: statusCode,
          length: text.length,
          err,
        },
        'Failed to send Slack message after retries',
      );
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('slack:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (!this.app) return;
    await this.app.stop();
    this.app = null;
    logger.info('Slack bot stopped');
  }

  async setTyping(jid: string, _isTyping: boolean): Promise<void> {
    // Note: Slack doesn't have a direct 'typing' indicator API for bots.
    // This is a no-op or could post a temporary status message.
    void jid;
  }
  private startWatchdog(): void {
    this.watchdogTimer = setInterval(async () => {
      if (!this.connected || !this.app) return;
      const staleDuration = Date.now() - this.lastEventTs;
      const STALE_THRESHOLD = 3 * 60 * 1000; // 3 minutes
      if (staleDuration > STALE_THRESHOLD) {
        this.reconnectAttempt++;
        const startTime = Date.now();
        logger.warn(
          {
            event: 'socket_stale',
            last_event_ts: this.lastEventTs,
            reconnect_attempt: this.reconnectAttempt,
            stale_duration_ms: staleDuration,
          },
          'Socket stale — triggering reconnect',
        );
        try {
          await this.app.stop();
          await this.app.start();
          this.lastEventTs = Date.now();
          logger.info(
            {
              event: 'socket_reconnect',
              reconnect_attempt: this.reconnectAttempt,
              duration_ms: Date.now() - startTime,
            },
            'Socket reconnected successfully',
          );
        } catch (err) {
          logger.error(
            {
              event: 'socket_reconnect',
              reconnect_attempt: this.reconnectAttempt,
              duration_ms: Date.now() - startTime,
              err,
            },
            'Socket reconnect failed',
          );
        }
      }
    }, 60_000); // Check every 60 seconds
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now();
    // Cleanup expired entries periodically
    if (this.seenEvents.size > 1000) {
      for (const [k, expiry] of this.seenEvents) {
        if (expiry < now) this.seenEvents.delete(k);
      }
    }
    if (this.seenEvents.has(key) && this.seenEvents.get(key)! > now)
      return true;
    this.seenEvents.set(key, now + 5 * 60 * 1000); // 5 min TTL
    return false;
  }

  private async handleInboundEvent(
    event: Record<string, unknown>,
    fromMentionEvent: boolean,
  ): Promise<void> {
    // Filter ALL messages with any subtype — only process plain user messages
    if (event.subtype !== undefined) return;

    // Filter bot's own messages to prevent self-loop
    const sender = (event.user as string | undefined) || '';
    if (sender === this.botUserId && this.botUserId !== '') return;

    // Filter bot messages based on filterBotMessages option (default: true)
    if (event.bot_id) {
      if (!this.safeMode && this.opts.filterBotMessages === false) {
        // Allow other bot messages only when explicitly opted out and not in safe mode
      } else {
        return; // default: filter all bots (or safe mode: always filter)
      }
    }

    const channelId = (event.channel as string | undefined) || '';
    if (!channelId) return;

    const chatJid = `slack:${channelId}`;

    // TTL deduplication
    const dedupKey = `${channelId}:${event.ts as string}`;
    if (this.isDuplicate(dedupKey)) return;

    const timestamp = this.toIsoTimestamp(event.ts as string | undefined);
    const isGroup = channelId.startsWith('C') || channelId.startsWith('G');
    this.opts.onChatMetadata(chatJid, timestamp, undefined, 'slack', isGroup);

    const senderName = sender || 'Unknown';
    const msgId =
      (event.client_msg_id as string | undefined) ||
      (event.ts as string | undefined) ||
      `${Date.now()}`;

    let content = this.extractContent(event);
    if (!content) return;

    // !chatid command — must work before group registration check (bootstrap)
    if (content === '!chatid') {
      await this.sendMessage(chatJid, `Chat ID: ${chatJid}`);
      return;
    }

    const group = this.opts.registeredGroups()[chatJid];
    if (!group) {
      logger.debug({ chatJid }, 'Message from unregistered Slack chat');
      return;
    }

    const mentionsBot =
      fromMentionEvent ||
      (this.botUserId && !this.safeMode
        ? content.includes(`<@${this.botUserId}>`)
        : false);
    if (mentionsBot && !TRIGGER_PATTERN.test(content)) {
      content = `@${ASSISTANT_NAME} ${content}`;
    }

    this.opts.onMessage(chatJid, {
      id: msgId,
      chat_jid: chatJid,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
    });
  }

  private extractContent(event: Record<string, unknown>): string {
    const text = (event.text as string | undefined)?.trim();
    if (text) return text;

    const files = event.files as Array<{ name?: string }> | undefined;
    if (files && files.length > 0) {
      const names = files.map((f) => f.name || 'file').join(', ');
      return `[File: ${names}]`;
    }

    return '[Non-text message]';
  }

  private toIsoTimestamp(ts: string | undefined): string {
    if (!ts) return new Date().toISOString();
    const seconds = parseFloat(ts);
    if (Number.isNaN(seconds)) return new Date().toISOString();
    return new Date(seconds * 1000).toISOString();
  }
}
