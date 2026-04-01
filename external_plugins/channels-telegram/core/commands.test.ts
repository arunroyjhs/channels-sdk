import { describe, it, expect } from 'bun:test';
import { CommandRegistry, getBuiltinCommands } from './commands.js';
import type { InboundMessage, ChannelAdapter } from '../types/index.js';

const mockAdapter = {} as ChannelAdapter;

function makeMsg(command: string, args = ''): InboundMessage {
  return {
    messageId: '1', chatId: 'c1', userId: 'u1',
    text: `${command} ${args}`.trim(),
    command, commandArgs: args, timestamp: Date.now(),
  };
}

describe('CommandRegistry', () => {
  it('registers and retrieves a command', () => {
    const reg = new CommandRegistry();
    reg.register({ name: 'test', description: 'Test cmd', handler: async () => 'ok' });
    expect(reg.get('/test')).toBeDefined();
    expect(reg.get('/test')!.name).toBe('test');
  });

  it('isCommand returns true for registered commands', () => {
    const reg = new CommandRegistry();
    reg.register({ name: 'foo', description: 'Foo', handler: async () => 'ok' });
    expect(reg.isCommand('/foo')).toBe(true);
    expect(reg.isCommand('/bar')).toBe(false);
    expect(reg.isCommand('hello')).toBe(false);
  });

  it('executes a command and returns result', async () => {
    const reg = new CommandRegistry();
    reg.register({ name: 'ping', description: 'Ping', handler: async () => 'pong' });
    const result = await reg.execute(makeMsg('/ping'), mockAdapter);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('pong');
  });

  it('returns null for unregistered command', async () => {
    const reg = new CommandRegistry();
    const result = await reg.execute(makeMsg('/unknown'), mockAdapter);
    expect(result).toBeNull();
  });

  it('returns null when message has no command', async () => {
    const reg = new CommandRegistry();
    const msg: InboundMessage = {
      messageId: '1', chatId: 'c1', userId: 'u1',
      text: 'hello', timestamp: Date.now(),
    };
    const result = await reg.execute(msg, mockAdapter);
    expect(result).toBeNull();
  });

  it('includes quick replies in result', async () => {
    const reg = new CommandRegistry();
    reg.register({
      name: 'test', description: 'Test',
      quickReplies: [[{ text: 'OK', callbackData: 'ok' }]],
      handler: async () => 'done',
    });
    const result = await reg.execute(makeMsg('/test'), mockAdapter);
    expect(result!.keyboard).toHaveLength(1);
    expect(result!.keyboard![0][0].text).toBe('OK');
  });

  it('passes args to handler', async () => {
    const reg = new CommandRegistry();
    reg.register({
      name: 'echo', description: 'Echo',
      handler: async (ctx) => `echo: ${ctx.args}`,
    });
    const result = await reg.execute(makeMsg('/echo', 'hello world'), mockAdapter);
    expect(result!.text).toBe('echo: hello world');
  });

  it('getHelpText lists all commands', () => {
    const reg = new CommandRegistry();
    reg.registerAll(getBuiltinCommands());
    const help = reg.getHelpText();
    expect(help).toContain('/status');
    expect(help).toContain('/tasks');
  });

  it('listForBotFather returns correct format', () => {
    const reg = new CommandRegistry();
    reg.registerAll(getBuiltinCommands());
    const list = reg.listForBotFather();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty('command');
    expect(list[0]).toHaveProperty('description');
  });
});
