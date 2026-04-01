#!/usr/bin/env bun
/**
 * Channels SDK — Telegram MCP Server
 *
 * Replaces the official telegram plugin with expanded capabilities:
 * - Seamless QR/deep-link pairing
 * - Rich messages with inline keyboards
 * - Voice message handling
 * - File sending/receiving
 * - Command system
 * - Multi-device sessions
 * - Smart message splitting
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { TelegramAdapter } from './adapter/index.js';
import { PairingManager } from './core/pairing.js';
import { CommandRegistry, getBuiltinCommands } from './core/commands.js';
import { ContextManager } from './core/context.js';
import { prepareVoiceForInbox } from './core/voice.js';
import { Scheduler } from './core/scheduler.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Config ──────────────────────────────────────────────────────────

const STATE_DIR = process.env.CHANNELS_STATE_DIR
  ?? join(homedir(), '.claude', 'channels', 'telegram');
const ENV_FILE = join(STATE_DIR, '.env');
const INBOX_DIR = join(STATE_DIR, 'inbox');

mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(INBOX_DIR, { recursive: true });

// Load .env
try {
  chmodSync(ENV_FILE, 0o600);
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  process.stderr.write(
    `channels-sdk: TELEGRAM_BOT_TOKEN required\n` +
    `  set in ${ENV_FILE}\n` +
    `  format: TELEGRAM_BOT_TOKEN=123456789:AAH...\n`,
  );
  process.exit(1);
}

// ── Initialize ──────────────────────────────────────────────────────

const pairing = new PairingManager(STATE_DIR);
const telegram = new TelegramAdapter(TOKEN, STATE_DIR);
const commands = new CommandRegistry();
const context = new ContextManager(STATE_DIR);

// Scheduler — sends messages on a timer
const scheduler = new Scheduler(STATE_DIR, async (chatId, text, opts) => {
  await telegram.send({
    chatId, text,
    silent: opts?.silent,
    keyboard: opts?.keyboard,
  });
});

// Register built-in commands
commands.registerAll(getBuiltinCommands());

// Override /help to use registry
commands.register({
  name: 'help',
  description: 'Show available commands',
  handler: async () => commands.getHelpText(),
});

// Override /clear to use context manager
commands.register({
  name: 'clear',
  description: 'Clear conversation context',
  handler: async (ctx) => {
    context.clear(ctx.msg.chatId);
    return '🗑 Conversation context cleared.';
  },
});

process.on('unhandledRejection', err => {
  process.stderr.write(`channels-sdk: unhandled rejection: ${err}\n`);
});

// Graceful shutdown
async function shutdown() {
  process.stderr.write('channels-sdk: shutting down...\n');
  scheduler.stopAll();
  context.flush();
  await telegram.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Message Handling ────────────────────────────────────────────────

// Deep-link pairing tokens — generated per CLI session, expire in 10 minutes
const deepLinkTokens = new Map<string, number>(); // token → createdAt

/** Generate a one-time deep-link token for CLI-initiated pairing */
function createDeepLinkToken(): string {
  const token = randomBytes(16).toString('hex');
  deepLinkTokens.set(token, Date.now());
  // Clean expired tokens
  const now = Date.now();
  for (const [t, created] of deepLinkTokens) {
    if (now - created > 10 * 60 * 1000) deepLinkTokens.delete(t);
  }
  return token;
}

telegram.onMessage(async (msg) => {
  // Handle /start with deep link pairing — validate token
  if (msg.command === '/start' && msg.commandArgs?.startsWith('pair_')) {
    const token = msg.commandArgs.slice(5); // strip "pair_"
    const created = deepLinkTokens.get(token);
    if (!created || Date.now() - created > 10 * 60 * 1000) {
      await telegram.send({
        chatId: msg.chatId,
        text: '❌ Pairing link expired or invalid. Run `claude channels pair` in your terminal for a fresh link.',
      });
      return;
    }
    deepLinkTokens.delete(token); // one-time use
    const device = pairing.autoApproveDeepLink(
      msg.chatId, msg.userId, msg.username, msg.username,
    );
    await telegram.send({
      chatId: msg.chatId,
      text: `✅ *Paired successfully!*\n\nDevice: ${msg.username || msg.userId}\nExpires: ${new Date(device.expiresAt).toLocaleDateString()}\n\nTry sending a message — your Claude Code agent will respond.`,
      format: 'markdown',
      keyboard: [[
        { text: '📊 Status', callbackData: 'cmd:status' },
        { text: '⚙️ Settings', callbackData: 'cmd:settings' },
      ]],
    });
    return;
  }

  // Handle /start without deep link — regular pairing flow
  if (msg.command === '/start') {
    const code = pairing.generatePairCode(msg.chatId, msg.userId, msg.username);
    if (code === 'ALREADY_PAIRED') {
      await telegram.send({
        chatId: msg.chatId,
        text: '✅ Already paired! Send a message and your agent will respond.',
      });
      return;
    }
    await telegram.send({
      chatId: msg.chatId,
      text: `🔗 *Pairing Code:*\n\n\`${code}\`\n\nEnter this code in your Claude Code terminal to complete pairing.\nCode expires in 5 minutes.`,
      format: 'markdown',
      keyboard: [[{ text: '🔄 New Code', callbackData: 'pair:refresh' }]],
    });
    return;
  }

  // Handle /pair command
  if (msg.command === '/pair') {
    const code = pairing.generatePairCode(msg.chatId, msg.userId, msg.username);
    if (code === 'ALREADY_PAIRED') {
      await telegram.send({ chatId: msg.chatId, text: '✅ Already paired.' });
      return;
    }
    await telegram.send({
      chatId: msg.chatId,
      text: `🔗 Pairing code: \`${code}\` (expires in 5 min)`,
      format: 'markdown',
    });
    return;
  }

  // Handle /devices command
  if (msg.command === '/devices') {
    const devices = pairing.getDevices();
    if (devices.length === 0) {
      await telegram.send({ chatId: msg.chatId, text: 'No paired devices.' });
      return;
    }
    const list = devices.map((d, i) =>
      `${i + 1}. ${d.username || d.userId} — paired ${new Date(d.pairedAt).toLocaleDateString()}`
    ).join('\n');
    await telegram.send({
      chatId: msg.chatId,
      text: `📱 *Paired devices:*\n\n${list}`,
      format: 'markdown',
    });
    return;
  }

  // Handle /lock command — only authorized users can lock
  if (msg.command === '/lock') {
    if (!pairing.isAuthorized(msg.chatId, msg.userId)) {
      await telegram.send({ chatId: msg.chatId, text: '🔒 Not authorized.' });
      return;
    }
    const count = pairing.revokeAll();
    await telegram.send({
      chatId: msg.chatId,
      text: `🔒 Emergency lock — ${count} devices revoked. Re-pair to reconnect.`,
    });
    return;
  }

  // Check authorization for non-command messages
  if (!pairing.isAuthorized(msg.chatId, msg.userId)) {
    await telegram.send({
      chatId: msg.chatId,
      text: '🔒 Not paired. Send /start to begin pairing.',
      keyboard: [[{ text: '🔗 Pair Now', callbackData: 'pair:start' }]],
    });
    return;
  }

  // Voice messages: download and pass file path to Claude Code via inbox
  // Claude Code reads the audio file natively — no API key needed
  if (msg.voicePath) {
    const voiceInfo = prepareVoiceForInbox(msg.voicePath);
    if (voiceInfo.exists) {
      await telegram.react(msg.chatId, msg.messageId, '🎙');
    }
  }

  // Track all user messages in context (including commands)
  if (msg.text) {
    context.addUserMessage(msg.chatId, msg.text);
  }

  // Handle registered commands (authorized users only)
  if (msg.command) {
    const result = await commands.execute(msg, telegram);
    if (result) {
      context.addAssistantMessage(msg.chatId, result.text);
      await telegram.send({
        chatId: msg.chatId,
        text: result.text,
        format: 'markdown',
        keyboard: result.keyboard,
      });
      return;
    }
  }

  // Authorized message — write to inbox for Claude Code to pick up
  // Include recent context so the agent has conversation history
  const recentContext = context.getContext(msg.chatId, 10);
  const enrichedMsg = { ...msg, context: recentContext };
  const inboxFile = join(INBOX_DIR, `${Date.now()}-${msg.messageId}.json`);
  try {
    writeFileSync(inboxFile, JSON.stringify(enrichedMsg, null, 2));
  } catch (err) {
    process.stderr.write(`channels-sdk: failed to write inbox: ${err}\n`);
  }
});

// Handle callback queries (button presses)
telegram.onCallback(async (chatId, messageId, data) => {
  // Pairing callbacks
  if (data === 'pair:refresh' || data === 'pair:start') {
    const userId = chatId; // In DMs, chatId === userId
    const code = pairing.generatePairCode(chatId, userId);
    if (code === 'ALREADY_PAIRED') {
      await telegram.edit(chatId, messageId, '✅ Already paired!');
    } else {
      await telegram.edit(chatId, messageId, `🔗 New pairing code: ${code} (5 min)`);
    }
    return;
  }

  // Command callbacks (from quick reply buttons like "📊 Status")
  if (data.startsWith('cmd:')) {
    const cmdName = `/${data.slice(4)}`; // "cmd:status" → "/status"
    const fakeMsg = {
      messageId, chatId, userId: chatId,
      text: cmdName, command: cmdName, commandArgs: '',
      timestamp: Math.floor(Date.now() / 1000),
    };
    const result = await commands.execute(fakeMsg, telegram);
    if (result) {
      await telegram.send({
        chatId,
        text: result.text,
        format: 'markdown',
        keyboard: result.keyboard,
      });
    }
    return;
  }

  // Write other callbacks to inbox for Claude Code
  const inboxFile = join(INBOX_DIR, `${Date.now()}-cb-${messageId}.json`);
  try {
    writeFileSync(inboxFile, JSON.stringify({ type: 'callback', chatId, messageId, data }));
  } catch (err) {
    process.stderr.write(`channels-sdk: failed to write callback inbox: ${err}\n`);
  }
});

// ── MCP Server ──────────────────────────────────────────────────────

const server = new Server(
  { name: 'channels-sdk-telegram', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message on Telegram. Supports markdown, inline keyboards, and file attachments.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string', description: 'Chat ID from the inbound message' },
          text: { type: 'string', description: 'Message text' },
          format: { type: 'string', enum: ['text', 'markdown', 'html'], description: 'Text formatting. Default: text' },
          reply_to: { type: 'string', description: 'Message ID to reply to (optional)' },
          files: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to attach' },
          silent: { type: 'boolean', description: 'Send without notification sound' },
          keyboard: {
            type: 'array',
            description: 'Inline keyboard rows. Each row is an array of buttons with text and callback_data or url.',
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  callback_data: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['text'],
              },
            },
          },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'react',
      description: 'Add an emoji reaction to a Telegram message.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          message_id: { type: 'string' },
          emoji: { type: 'string' },
        },
        required: ['chat_id', 'message_id', 'emoji'],
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a previously sent message.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          message_id: { type: 'string' },
          text: { type: 'string' },
          format: { type: 'string', enum: ['text', 'markdown', 'html'] },
        },
        required: ['chat_id', 'message_id', 'text'],
      },
    },
    {
      name: 'send_keyboard',
      description: 'Send a message with inline keyboard buttons for quick actions.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          text: { type: 'string' },
          keyboard: {
            type: 'array',
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  callback_data: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['text'],
              },
            },
          },
        },
        required: ['chat_id', 'text', 'keyboard'],
      },
    },
    {
      name: 'download_attachment',
      description: 'Download a Telegram file attachment by file_id.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          file_id: { type: 'string' },
        },
        required: ['file_id'],
      },
    },
    {
      name: 'get_devices',
      description: 'List all paired devices.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'verify_pair_code',
      description: 'Verify a pairing code entered by the user in the terminal.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          code: { type: 'string', description: 'The 6-character pairing code' },
        },
        required: ['code'],
      },
    },
    {
      name: 'create_deep_link',
      description: 'Generate a one-time deep link URL for pairing. User opens this link on their phone to instantly pair.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    // ── Layer 2 tools ──
    {
      name: 'send_poll',
      description: 'Send a poll/vote to a Telegram chat for multi-option decisions.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          question: { type: 'string', description: 'Poll question' },
          options: { type: 'array', items: { type: 'string' }, description: 'Answer options (2-10)' },
          is_anonymous: { type: 'boolean', description: 'Anonymous poll. Default: false' },
          allows_multiple: { type: 'boolean', description: 'Allow multiple answers. Default: false' },
        },
        required: ['chat_id', 'question', 'options'],
      },
    },
    {
      name: 'get_context',
      description: 'Get recent conversation context for a chat. Returns last N messages.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          limit: { type: 'number', description: 'Number of recent messages. Default: 10' },
        },
        required: ['chat_id'],
      },
    },
    {
      name: 'track_response',
      description: 'Track an outbound assistant message in conversation context. Call this after sending a reply so context stays complete.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['chat_id', 'text'],
      },
    },
    // ── Layer 3 tools ──
    {
      name: 'transcribe_voice',
      description: 'Get voice message file path for transcription. Use the Read tool on the returned path — Claude reads audio natively.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          audio_path: { type: 'string', description: 'Absolute path to audio file' },
        },
        required: ['audio_path'],
      },
    },
    {
      name: 'schedule_message',
      description: 'Schedule a recurring or one-time message. Schedules: "daily:18:00", "hourly", "once:2026-04-02T10:00:00Z", "interval:30" (minutes).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          text: { type: 'string' },
          schedule: { type: 'string', description: 'Schedule expression: daily:HH:MM, hourly, once:ISO_DATE, interval:MINUTES' },
          silent: { type: 'boolean' },
        },
        required: ['chat_id', 'text', 'schedule'],
      },
    },
    {
      name: 'list_schedules',
      description: 'List all active scheduled messages.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'remove_schedule',
      description: 'Remove a scheduled message by ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
    {
      name: 'send_alert',
      description: 'Send a proactive alert to a chat. Use for: build failures, PR merges, task blockers, urgent notifications.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string' },
          title: { type: 'string', description: 'Alert title (e.g., "Build Failed")' },
          body: { type: 'string', description: 'Alert details' },
          level: { type: 'string', enum: ['info', 'warning', 'error'], description: 'Alert severity. Default: info' },
          keyboard: {
            type: 'array',
            items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, callback_data: { type: 'string' } }, required: ['text'] } },
          },
        },
        required: ['chat_id', 'title', 'body'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'reply': {
        const keyboard = (args?.keyboard as any[])?.map((row: any[]) =>
          row.map(btn => ({
            text: btn.text,
            callbackData: btn.callback_data,
            url: btn.url,
          }))
        );
        const msgId = await telegram.send({
          chatId: String(args?.chat_id),
          text: String(args?.text),
          format: (args?.format as any) || 'text',
          replyTo: args?.reply_to ? String(args.reply_to) : undefined,
          files: args?.files as string[] | undefined,
          silent: args?.silent as boolean | undefined,
          keyboard,
        });
        return { content: [{ type: 'text', text: `sent (id: ${msgId})` }] };
      }

      case 'react': {
        await telegram.react(String(args?.chat_id), String(args?.message_id), String(args?.emoji));
        return { content: [{ type: 'text', text: 'reacted' }] };
      }

      case 'edit_message': {
        await telegram.edit(
          String(args?.chat_id), String(args?.message_id),
          String(args?.text), args?.format as string | undefined,
        );
        return { content: [{ type: 'text', text: 'edited' }] };
      }

      case 'send_keyboard': {
        const keyboard = (args?.keyboard as any[])?.map((row: any[]) =>
          row.map(btn => ({
            text: btn.text,
            callbackData: btn.callback_data,
            url: btn.url,
          }))
        );
        const msgId = await telegram.sendKeyboard(
          String(args?.chat_id), String(args?.text), keyboard || [],
        );
        return { content: [{ type: 'text', text: `sent keyboard (id: ${msgId})` }] };
      }

      case 'download_attachment': {
        const path = await telegram.downloadAttachment(String(args?.file_id));
        return { content: [{ type: 'text', text: path }] };
      }

      case 'get_devices': {
        const devices = pairing.getDevices();
        const list = devices.map(d => ({
          id: d.id,
          username: d.username,
          paired: new Date(d.pairedAt).toISOString(),
          lastSeen: new Date(d.lastSeen).toISOString(),
          expires: new Date(d.expiresAt).toISOString(),
        }));
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
      }

      case 'verify_pair_code': {
        const device = pairing.verifyPairCode(String(args?.code));
        if (!device) {
          return { content: [{ type: 'text', text: 'invalid or expired code' }] };
        }
        // Notify the user on Telegram
        await telegram.send({
          chatId: device.chatId,
          text: '✅ *Paired!* Your Claude Code agent is now connected.',
          format: 'markdown',
          keyboard: [[
            { text: '📊 Status', callbackData: 'cmd:status' },
            { text: '⚙️ Settings', callbackData: 'cmd:settings' },
          ]],
        });
        return { content: [{ type: 'text', text: `paired: ${device.username || device.userId}` }] };
      }

      case 'create_deep_link': {
        const token = createDeepLinkToken();
        const botInfo = telegram.getBotInfo();
        const link = `https://t.me/${botInfo.username}?start=pair_${token}`;
        return { content: [{ type: 'text', text: link }] };
      }

      // ── Layer 3 handlers ──

      case 'transcribe_voice': {
        const voiceInfo = prepareVoiceForInbox(String(args?.audio_path));
        if (!voiceInfo.exists) {
          return { content: [{ type: 'text', text: `file not found: ${args?.audio_path}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `Voice file ready at: ${voiceInfo.path} (${voiceInfo.mimeType}, ${Math.round(voiceInfo.sizeBytes / 1024)}KB). Use the Read tool to transcribe it.` }] };
      }

      case 'schedule_message': {
        const scheduled = scheduler.add({
          chatId: String(args?.chat_id),
          text: String(args?.text),
          schedule: String(args?.schedule),
          silent: args?.silent as boolean | undefined,
        });
        return { content: [{ type: 'text', text: `scheduled (id: ${scheduled.id}, next: ${args?.schedule})` }] };
      }

      case 'list_schedules': {
        const list = scheduler.list();
        if (list.length === 0) return { content: [{ type: 'text', text: 'no active schedules' }] };
        const formatted = list.map(s =>
          `${s.id} | ${s.schedule} | ${s.text.slice(0, 50)}${s.text.length > 50 ? '...' : ''}`
        ).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }

      case 'remove_schedule': {
        const removed = scheduler.remove(String(args?.id));
        return { content: [{ type: 'text', text: removed ? 'removed' : 'not found' }] };
      }

      case 'send_alert': {
        const level = (args?.level as string) || 'info';
        const emoji = level === 'error' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';
        const alertText = `${emoji} <b>${escapeHtml(String(args?.title))}</b>\n\n${escapeHtml(String(args?.body))}`;
        const keyboard = (args?.keyboard as any[])?.map((row: any[]) =>
          row.map(btn => ({ text: btn.text, callbackData: btn.callback_data }))
        );
        const msgId = await telegram.send({
          chatId: String(args?.chat_id),
          text: alertText,
          format: 'html',
          keyboard,
        });
        return { content: [{ type: 'text', text: `alert sent (id: ${msgId})` }] };
      }

      // ── Layer 2 handlers ──

      case 'send_poll': {
        const msg = await telegram.sendPoll(
          String(args?.chat_id),
          String(args?.question),
          args?.options as string[],
          { isAnonymous: args?.is_anonymous as boolean, allowsMultiple: args?.allows_multiple as boolean },
        );
        return { content: [{ type: 'text', text: `poll sent (id: ${msg})` }] };
      }

      case 'get_context': {
        const messages = context.getContext(String(args?.chat_id), (args?.limit as number) || 10);
        if (messages.length === 0) {
          return { content: [{ type: 'text', text: 'no context for this chat' }] };
        }
        const formatted = messages.map(m =>
          `[${m.role}] ${m.text}`
        ).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }

      case 'track_response': {
        context.addAssistantMessage(String(args?.chat_id), String(args?.text));
        return { content: [{ type: 'text', text: 'tracked' }] };
      }

      default:
        return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `error: ${err instanceof Error ? err.message : err}` }],
      isError: true,
    };
  }
});

// ── Start ───────────────────────────────────────────────────────────

async function main() {
  await telegram.init();
  scheduler.startAll();
  const botInfo = telegram.getBotInfo();
  process.stderr.write(`channels-sdk: telegram bot @${botInfo.username} started\n`);
  process.stderr.write(`channels-sdk: pair via t.me/${botInfo.username}?start=pair_auto\n`);
  process.stderr.write(`channels-sdk: ${scheduler.list().length} scheduled messages active\n`);
  process.stderr.write(`channels-sdk: voice messages → Claude Code native transcription\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`channels-sdk: fatal: ${err}\n`);
  process.exit(1);
});
