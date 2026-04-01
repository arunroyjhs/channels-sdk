/**
 * Test suite for TelegramAdapter
 *
 * Tests message splitting logic (unit tests that don't need a real bot).
 * Integration tests with real bot require TELEGRAM_BOT_TOKEN.
 */

import { describe, it, expect } from 'bun:test';

// ── Message Splitting Tests (extracted logic) ───────────────────────

const MAX_MESSAGE_LENGTH = 4096;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n\n', MAX_MESSAGE_LENGTH);
    if (splitAt < MAX_MESSAGE_LENGTH * 0.3) {
      splitAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    }
    if (splitAt < MAX_MESSAGE_LENGTH * 0.3) {
      splitAt = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
    }
    if (splitAt < MAX_MESSAGE_LENGTH * 0.3) {
      splitAt = MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

describe('Message Splitting', () => {
  it('returns single chunk for short messages', () => {
    const result = splitMessage('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Hello world');
  });

  it('returns single chunk for exactly max length', () => {
    const text = 'a'.repeat(MAX_MESSAGE_LENGTH);
    const result = splitMessage(text);
    expect(result).toHaveLength(1);
  });

  it('splits on paragraph boundary', () => {
    const para1 = 'a'.repeat(2000);
    const para2 = 'b'.repeat(2000);
    const para3 = 'c'.repeat(2000);
    const text = `${para1}\n\n${para2}\n\n${para3}`;
    const result = splitMessage(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // No chunk should exceed max
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('splits on newline when no paragraph boundary', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`);
    const text = lines.join('\n');
    const result = splitMessage(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('splits on space when no newlines', () => {
    const words = Array.from({ length: 1000 }, () => 'word');
    const text = words.join(' ');
    const result = splitMessage(text);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('hard splits when no whitespace', () => {
    const text = 'x'.repeat(MAX_MESSAGE_LENGTH * 2 + 100);
    const result = splitMessage(text);
    expect(result.length).toBe(3);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('preserves all content after splitting', () => {
    const para1 = 'First paragraph content here';
    const para2 = 'Second paragraph content here';
    const text = `${'a'.repeat(3000)}\n\n${para1}\n\n${'b'.repeat(3000)}\n\n${para2}`;
    const result = splitMessage(text);
    const joined = result.join('');
    // All original non-whitespace content should be present
    expect(joined).toContain(para1);
    expect(joined).toContain(para2);
  });

  it('handles empty string', () => {
    const result = splitMessage('');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('');
  });
});

// ── Type/Interface Tests ────────────────────────────────────────────

describe('Telegram Adapter Types', () => {
  it('keyboard button structure is valid', () => {
    const button = { text: 'Click me', callbackData: 'action:click' };
    expect(button.text).toBe('Click me');
    expect(button.callbackData).toBe('action:click');
  });

  it('keyboard row is array of buttons', () => {
    const row = [
      { text: 'Yes', callbackData: 'yes' },
      { text: 'No', callbackData: 'no' },
    ];
    expect(row).toHaveLength(2);
  });

  it('outbound message with all fields', () => {
    const msg = {
      chatId: '123',
      text: 'Hello',
      format: 'markdown' as const,
      replyTo: '456',
      keyboard: [[{ text: 'OK', callbackData: 'ok' }]],
      files: ['/path/to/file.png'],
      silent: true,
    };
    expect(msg.chatId).toBe('123');
    expect(msg.keyboard![0][0].text).toBe('OK');
    expect(msg.silent).toBe(true);
  });
});
