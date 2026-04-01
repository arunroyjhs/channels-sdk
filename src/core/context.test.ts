import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ContextManager } from './context.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `channels-ctx-test-${Date.now()}`);

let ctx: ContextManager;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  ctx = new ContextManager(TEST_DIR);
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch {}
});

describe('ContextManager', () => {
  it('adds and retrieves user messages', () => {
    ctx.addUserMessage('chat1', 'hello');
    ctx.addUserMessage('chat1', 'world');
    const messages = ctx.getContext('chat1');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('hello');
    expect(messages[1].text).toBe('world');
  });

  it('adds and retrieves assistant messages', () => {
    ctx.addAssistantMessage('chat1', 'hi there');
    const messages = ctx.getContext('chat1');
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
  });

  it('interleaves user and assistant messages', () => {
    ctx.addUserMessage('chat1', 'hello');
    ctx.addAssistantMessage('chat1', 'hi');
    ctx.addUserMessage('chat1', 'how are you');
    ctx.addAssistantMessage('chat1', 'good');
    const messages = ctx.getContext('chat1');
    expect(messages).toHaveLength(4);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('limits returned messages', () => {
    for (let i = 0; i < 20; i++) {
      ctx.addUserMessage('chat1', `msg ${i}`);
    }
    const limited = ctx.getContext('chat1', 5);
    expect(limited).toHaveLength(5);
    expect(limited[0].text).toBe('msg 15'); // last 5
  });

  it('keeps separate context per chat', () => {
    ctx.addUserMessage('chat1', 'from chat 1');
    ctx.addUserMessage('chat2', 'from chat 2');
    expect(ctx.getContext('chat1')).toHaveLength(1);
    expect(ctx.getContext('chat2')).toHaveLength(1);
    expect(ctx.getContext('chat1')[0].text).toBe('from chat 1');
  });

  it('returns empty array for unknown chat', () => {
    expect(ctx.getContext('nonexistent')).toHaveLength(0);
  });

  it('clears context for a specific chat', () => {
    ctx.addUserMessage('chat1', 'hello');
    ctx.addUserMessage('chat2', 'world');
    ctx.clear('chat1');
    expect(ctx.getContext('chat1')).toHaveLength(0);
    expect(ctx.getContext('chat2')).toHaveLength(1);
  });

  it('trims to max messages', () => {
    const small = new ContextManager(TEST_DIR, 5);
    for (let i = 0; i < 10; i++) {
      small.addUserMessage('chat1', `msg ${i}`);
    }
    const messages = small.getContext('chat1');
    expect(messages).toHaveLength(5);
    expect(messages[0].text).toBe('msg 5');
  });

  it('getFormattedContext returns readable string', () => {
    ctx.addUserMessage('chat1', 'hello');
    ctx.addAssistantMessage('chat1', 'hi there');
    const formatted = ctx.getFormattedContext('chat1');
    expect(formatted).toContain('[user] hello');
    expect(formatted).toContain('[assistant] hi there');
  });

  it('getFormattedContext returns empty string for no context', () => {
    expect(ctx.getFormattedContext('nonexistent')).toBe('');
  });

  it('persists across restarts', () => {
    ctx.addUserMessage('chat1', 'persisted message');
    ctx.flush(); // force write before new instance reads
    const ctx2 = new ContextManager(TEST_DIR);
    const messages = ctx2.getContext('chat1');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('persisted message');
  });

  it('handles timestamps', () => {
    const before = Date.now();
    ctx.addUserMessage('chat1', 'timed');
    const after = Date.now();
    const msg = ctx.getContext('chat1')[0];
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });
});
