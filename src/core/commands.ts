/**
 * Command Registry
 *
 * Extensible command system for channel bots.
 * Commands are registered with handlers and can be triggered via /command in chat.
 */

import type { InboundMessage, ChannelAdapter, KeyboardRow } from '../types/index.js';

export interface CommandContext {
  msg: InboundMessage;
  args: string;
  adapter: ChannelAdapter;
}

export interface CommandDef {
  name: string;
  description: string;
  /** Keyboard shown after command executes (optional) */
  quickReplies?: KeyboardRow[];
  handler: (ctx: CommandContext) => Promise<string | void>;
}

export class CommandRegistry {
  private commands = new Map<string, CommandDef>();

  register(cmd: CommandDef): void {
    this.commands.set(`/${cmd.name}`, cmd);
  }

  registerAll(cmds: CommandDef[]): void {
    for (const cmd of cmds) this.register(cmd);
  }

  get(command: string): CommandDef | undefined {
    return this.commands.get(command);
  }

  /** Check if a message is a registered command */
  isCommand(text: string): boolean {
    const cmd = text.split(/\s+/)[0];
    return this.commands.has(cmd);
  }

  /** Execute a command, returns response text or undefined */
  async execute(msg: InboundMessage, adapter: ChannelAdapter): Promise<{ text: string; keyboard?: KeyboardRow[] } | null> {
    if (!msg.command) return null;
    const cmd = this.commands.get(msg.command);
    if (!cmd) return null;

    const result = await cmd.handler({
      msg,
      args: msg.commandArgs || '',
      adapter,
    });

    return {
      text: result || `✅ ${msg.command} executed`,
      keyboard: cmd.quickReplies,
    };
  }

  /** Get all commands for Telegram's BotFather /setcommands */
  listForBotFather(): { command: string; description: string }[] {
    return Array.from(this.commands.values()).map(cmd => ({
      command: cmd.name,
      description: cmd.description,
    }));
  }

  /** Get formatted help text */
  getHelpText(): string {
    const lines = Array.from(this.commands.values()).map(
      cmd => `/${cmd.name} — ${cmd.description}`
    );
    return `📋 *Available commands:*\n\n${lines.join('\n')}`;
  }
}

/**
 * Built-in commands that ship with every channel.
 * /help and /clear are NOT included here — they need access to
 * the registry and context manager, so they're registered in the server.
 */
export function getBuiltinCommands(): CommandDef[] {
  return [
    {
      name: 'status',
      description: 'Show agent status and active work',
      quickReplies: [
        [
          { text: '🔄 Refresh', callbackData: 'cmd:status' },
          { text: '📋 Tasks', callbackData: 'cmd:tasks' },
        ],
      ],
      handler: async () => '📊 Agent is online and ready. Send a message or use a command.',
    },
    {
      name: 'tasks',
      description: 'Show current task list',
      quickReplies: [
        [
          { text: '📊 Status', callbackData: 'cmd:status' },
          { text: '🔄 Refresh', callbackData: 'cmd:tasks' },
        ],
      ],
      handler: async () => '📋 No task integration configured. Agent can override this command.',
    },
  ];
}
