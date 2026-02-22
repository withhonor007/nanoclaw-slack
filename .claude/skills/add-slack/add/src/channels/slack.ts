import { App } from '@slack/bolt';

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
}

export class SlackChannel implements Channel {
  name = 'slack';

  private app: App | null = null;
  private connected = false;
  private opts: SlackChannelOpts;
  private botToken: string;
  private appToken: string;
  private signingSecret: string;
  private botUserId = '';

  constructor(
    botToken: string,
    appToken: string,
    signingSecret: string,
    opts: SlackChannelOpts,
  ) {
    this.botToken = botToken;
    this.appToken = appToken;
    this.signingSecret = signingSecret;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.app = new App({
      token: this.botToken,
      appToken: this.appToken,
      signingSecret: this.signingSecret,
      socketMode: true,
    });

    this.app.event('app_mention', async ({ event }: { event: unknown }) => {
      await this.handleInboundEvent(event as Record<string, unknown>, true);
    });

    this.app.event('message', async ({ event }: { event: unknown }) => {
      await this.handleInboundEvent(event as Record<string, unknown>, false);
    });

    await this.app.start();

    try {
      const auth = await this.app.client.auth.test({});
      this.botUserId = auth.user_id || '';
    } catch (err) {
      logger.warn({ err }, 'Slack auth.test failed; mention translation may be limited');
    }

    this.connected = true;
    logger.info('Slack bot connected via Socket Mode');
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
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Slack message');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('slack:');
  }

  async disconnect(): Promise<void> {
    if (!this.app) return;
    await this.app.stop();
    this.app = null;
    this.connected = false;
    logger.info('Slack bot stopped');
  }

  async setTyping(jid: string, _isTyping: boolean): Promise<void> {
    // Note: Slack doesn't have a direct 'typing' indicator API for bots.
    // This is a no-op or could post a temporary status message.
    void jid;
  }

  private async handleInboundEvent(
    event: Record<string, unknown>,
    fromMentionEvent: boolean,
  ): Promise<void> {
    if ((event.subtype as string | undefined) === 'bot_message') return;

    const channelId = (event.channel as string | undefined) || '';
    if (!channelId) return;

    const chatJid = `slack:${channelId}`;
    const timestamp = this.toIsoTimestamp(event.ts as string | undefined);
    const isGroup = channelId.startsWith('C') || channelId.startsWith('G');
    this.opts.onChatMetadata(chatJid, timestamp, undefined, 'slack', isGroup);

    const group = this.opts.registeredGroups()[chatJid];
    if (!group) {
      logger.debug({ chatJid }, 'Message from unregistered Slack chat');
      return;
    }

    const sender = (event.user as string | undefined) || '';
    const senderName = sender || 'Unknown';
    const msgId =
      (event.client_msg_id as string | undefined) ||
      (event.ts as string | undefined) ||
      `${Date.now()}`;

    let content = this.extractContent(event);
    if (!content) return;

    const mentionsBot =
      fromMentionEvent ||
      (this.botUserId ? content.includes(`<@${this.botUserId}>`) : false);
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
    const seconds = Number(ts.split('.')[0]);
    if (Number.isNaN(seconds)) return new Date().toISOString();
    return new Date(seconds * 1000).toISOString();
  }
}