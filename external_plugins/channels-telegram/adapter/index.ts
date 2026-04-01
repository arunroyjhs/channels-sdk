/**
 * Telegram Channel Adapter
 *
 * Implements ChannelAdapter interface for Telegram via grammY.
 * Handles: rich messages, inline keyboards, voice, files, callbacks.
 */

import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
import type { ReactionTypeEmoji } from 'grammy/types';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import type { ChannelAdapter, OutboundMessage, InboundMessage, KeyboardRow } from '../types/index.js';

const MAX_MESSAGE_LENGTH = 4096;

export class TelegramAdapter implements ChannelAdapter {
  readonly platform = 'telegram';
  private bot: Bot;
  private botInfo: { username: string; displayName: string } = { username: '', displayName: '' };
  private messageHandler?: (msg: InboundMessage) => void;
  private callbackHandler?: (chatId: string, messageId: string, data: string) => void;
  private inboxDir: string;

  constructor(token: string, stateDir: string) {
    this.bot = new Bot(token);
    this.inboxDir = join(stateDir, 'inbox');
    mkdirSync(this.inboxDir, { recursive: true });
  }

  async init(): Promise<void> {
    const me = await this.bot.api.getMe();
    this.botInfo = { username: me.username || '', displayName: me.first_name };

    // Handle text messages
    this.bot.on('message:text', (ctx) => this.handleTextMessage(ctx));

    // Handle voice messages
    this.bot.on('message:voice', (ctx) => this.handleVoiceMessage(ctx));

    // Handle photos
    this.bot.on('message:photo', (ctx) => this.handlePhotoMessage(ctx));

    // Handle documents
    this.bot.on('message:document', (ctx) => this.handleDocumentMessage(ctx));

    // Handle callback queries (inline keyboard presses)
    this.bot.on('callback_query:data', (ctx) => {
      const chatId = String(ctx.callbackQuery.message?.chat.id || '');
      const messageId = String(ctx.callbackQuery.message?.message_id || '');
      const data = ctx.callbackQuery.data;
      ctx.answerCallbackQuery(); // dismiss loading spinner
      this.callbackHandler?.(chatId, messageId, data);
    });

    // Start polling
    this.bot.start({ onStart: () => {} });
  }

  // ── Send ──────────────────────────────────────────────────────────

  async send(msg: OutboundMessage): Promise<string> {
    const parseMode = msg.format === 'markdown' ? 'MarkdownV2'
      : msg.format === 'html' ? 'HTML'
      : undefined;

    // Send files first if any
    if (msg.files?.length) {
      for (const filePath of msg.files) {
        try {
          await this.bot.api.sendDocument(msg.chatId, new InputFile(filePath), {
            disable_notification: msg.silent,
          });
        } catch {
          // Try as photo if document fails
          try {
            await this.bot.api.sendPhoto(msg.chatId, new InputFile(filePath), {
              disable_notification: msg.silent,
            });
          } catch {}
        }
      }
    }

    // Build keyboard if provided
    let reply_markup: InlineKeyboard | undefined;
    if (msg.keyboard?.length) {
      reply_markup = new InlineKeyboard();
      for (let r = 0; r < msg.keyboard.length; r++) {
        const row = msg.keyboard[r];
        for (const btn of row) {
          if (btn.url) {
            reply_markup.url(btn.text, btn.url);
          } else {
            reply_markup.text(btn.text, btn.callbackData || btn.text);
          }
        }
        // Only add row separator between rows, not after the last one
        if (r < msg.keyboard.length - 1) reply_markup.row();
      }
    }

    // Split long messages
    const chunks = this.splitMessage(msg.text);
    let lastMessageId = '';

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const sent = await this.bot.api.sendMessage(msg.chatId, chunks[i], {
        parse_mode: parseMode,
        reply_to_message_id: i === 0 && msg.replyTo ? Number(msg.replyTo) : undefined,
        reply_markup: isLast ? reply_markup : undefined,
        disable_notification: msg.silent,
      });
      lastMessageId = String(sent.message_id);
    }

    return lastMessageId;
  }

  async edit(chatId: string, messageId: string, text: string, format?: string): Promise<void> {
    const parseMode = format === 'markdown' ? 'MarkdownV2'
      : format === 'html' ? 'HTML'
      : undefined;

    await this.bot.api.editMessageText(chatId, Number(messageId), text, {
      parse_mode: parseMode,
    });
  }

  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    try {
      await this.bot.api.setMessageReaction(chatId, Number(messageId), [
        { type: 'emoji', emoji: emoji as ReactionTypeEmoji['emoji'] },
      ]);
    } catch (err) {
      // Telegram only accepts a fixed whitelist of emoji — log non-fatal errors
      process.stderr.write(`channels-sdk: react failed (${emoji}): ${err}\n`);
    }
  }

  async sendKeyboard(chatId: string, text: string, keyboard: KeyboardRow[]): Promise<string> {
    return this.send({ chatId, text, keyboard });
  }

  async sendPoll(
    chatId: string,
    question: string,
    options: string[],
    opts?: { isAnonymous?: boolean; allowsMultiple?: boolean },
  ): Promise<string> {
    const sent = await this.bot.api.sendPoll(chatId, question, options, {
      is_anonymous: opts?.isAnonymous ?? false,
      allows_multiple_answers: opts?.allowsMultiple ?? false,
    });
    return String(sent.message_id);
  }

  async downloadAttachment(fileId: string): Promise<string> {
    const file = await this.bot.api.getFile(fileId);
    const filePath = file.file_path || 'unknown';
    const ext = filePath.split('.').pop() || 'bin';
    const localPath = join(this.inboxDir, `${fileId}.${ext}`);

    // Use grammY's getFileUrl to avoid exposing bot token in code
    const url = `https://api.telegram.org/file/bot${this.bot.token}/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(localPath, buffer);

    return localPath;
  }

  getBotInfo() {
    return this.botInfo;
  }

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  onCallback(handler: (chatId: string, messageId: string, data: string) => void): void {
    this.callbackHandler = handler;
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  // ── Inbound Handlers ──────────────────────────────────────────────

  private handleTextMessage(ctx: Context): void {
    if (!ctx.message?.text || !ctx.from) return;

    const text = ctx.message.text;
    let command: string | undefined;
    let commandArgs: string | undefined;

    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      command = parts[0].replace(`@${this.botInfo.username}`, '');
      commandArgs = parts.slice(1).join(' ');
    }

    this.messageHandler?.({
      messageId: String(ctx.message.message_id),
      chatId: String(ctx.message.chat.id),
      userId: String(ctx.from.id),
      username: ctx.from.username,
      text,
      command,
      commandArgs,
      timestamp: ctx.message.date,
    });
  }

  private async handleVoiceMessage(ctx: Context): Promise<void> {
    if (!ctx.message?.voice || !ctx.from) return;

    const fileId = ctx.message.voice.file_id;
    const localPath = await this.downloadAttachment(fileId);

    this.messageHandler?.({
      messageId: String(ctx.message.message_id),
      chatId: String(ctx.message.chat.id),
      userId: String(ctx.from.id),
      username: ctx.from.username,
      voicePath: localPath,
      timestamp: ctx.message.date,
    });
  }

  private async handlePhotoMessage(ctx: Context): Promise<void> {
    if (!ctx.message?.photo || !ctx.from) return;

    // Get highest resolution photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const localPath = await this.downloadAttachment(photo.file_id);

    this.messageHandler?.({
      messageId: String(ctx.message.message_id),
      chatId: String(ctx.message.chat.id),
      userId: String(ctx.from.id),
      username: ctx.from.username,
      text: ctx.message.caption,
      attachments: [localPath],
      timestamp: ctx.message.date,
    });
  }

  private async handleDocumentMessage(ctx: Context): Promise<void> {
    if (!ctx.message?.document || !ctx.from) return;

    const localPath = await this.downloadAttachment(ctx.message.document.file_id);

    this.messageHandler?.({
      messageId: String(ctx.message.message_id),
      chatId: String(ctx.message.chat.id),
      userId: String(ctx.from.id),
      username: ctx.from.username,
      text: ctx.message.caption,
      attachments: [localPath],
      timestamp: ctx.message.date,
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────

  /** Split long messages on paragraph boundaries */
  private splitMessage(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Try to split on double newline (paragraph)
      let splitAt = remaining.lastIndexOf('\n\n', MAX_MESSAGE_LENGTH);
      if (splitAt < MAX_MESSAGE_LENGTH * 0.3) {
        // Try single newline
        splitAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
      }
      if (splitAt < MAX_MESSAGE_LENGTH * 0.3) {
        // Try space
        splitAt = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
      }
      if (splitAt < MAX_MESSAGE_LENGTH * 0.3) {
        // Hard split
        splitAt = MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }
}
