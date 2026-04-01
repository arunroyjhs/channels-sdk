/**
 * Conversation Context Manager
 *
 * Maintains rolling context of recent messages per chat.
 * Persisted to disk so context survives restarts.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ContextMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

interface ChatContext {
  messages: ContextMessage[];
  lastUpdated: number;
}

const DEFAULT_MAX_MESSAGES = 50;
const CONTEXT_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class ContextManager {
  private contexts = new Map<string, ChatContext>();
  private stateFile: string;
  private maxMessages: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(stateDir: string, maxMessages = DEFAULT_MAX_MESSAGES) {
    mkdirSync(stateDir, { recursive: true });
    this.stateFile = join(stateDir, 'context.json');
    this.maxMessages = maxMessages;
    this.load();
    // Prune expired contexts on startup
    this.prune();
  }

  /** Add a user message to context */
  addUserMessage(chatId: string, text: string): void {
    this.addMessage(chatId, { role: 'user', text, timestamp: Date.now() });
  }

  /** Add an assistant (bot) message to context */
  addAssistantMessage(chatId: string, text: string): void {
    this.addMessage(chatId, { role: 'assistant', text, timestamp: Date.now() });
  }

  /** Get recent context for a chat */
  getContext(chatId: string, limit?: number): ContextMessage[] {
    const ctx = this.contexts.get(chatId);
    if (!ctx) return [];
    const messages = ctx.messages;
    return limit ? messages.slice(-limit) : messages;
  }

  /** Get context formatted as a string for LLM consumption */
  getFormattedContext(chatId: string, limit = 10): string {
    const messages = this.getContext(chatId, limit);
    if (messages.length === 0) return '';
    return messages
      .map(m => `[${m.role}] ${m.text}`)
      .join('\n');
  }

  /** Clear context for a chat */
  clear(chatId: string): void {
    this.contexts.delete(chatId);
    this.saveNow();
  }

  /** Clear all expired contexts */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [chatId, ctx] of this.contexts) {
      if (now - ctx.lastUpdated > CONTEXT_TTL) {
        this.contexts.delete(chatId);
        pruned++;
      }
    }
    if (pruned > 0) this.saveNow();
    return pruned;
  }

  private addMessage(chatId: string, message: ContextMessage): void {
    let ctx = this.contexts.get(chatId);
    if (!ctx) {
      ctx = { messages: [], lastUpdated: Date.now() };
      this.contexts.set(chatId, ctx);
    }

    ctx.messages.push(message);
    ctx.lastUpdated = Date.now();

    // Trim to max
    if (ctx.messages.length > this.maxMessages) {
      ctx.messages = ctx.messages.slice(-this.maxMessages);
    }

    this.debouncedSave();
  }

  /** Debounced save — batches disk writes to max once per 3 seconds */
  private debouncedSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.save();
        this.dirty = false;
      }
    }, 3000);
  }

  /** Force immediate flush to disk. Call before shutdown or when another instance needs to read. */
  flush(): void {
    this.saveNow();
  }

  /** Force immediate save (for clear/prune operations) */
  private saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
    this.dirty = false;
  }

  private load(): void {
    try {
      const raw = readFileSync(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, ChatContext>;
      for (const [chatId, ctx] of Object.entries(parsed)) {
        this.contexts.set(chatId, ctx);
      }
    } catch {}
  }

  private save(): void {
    const obj: Record<string, ChatContext> = {};
    for (const [chatId, ctx] of this.contexts) {
      obj[chatId] = ctx;
    }
    try {
      writeFileSync(this.stateFile, JSON.stringify(obj));
    } catch (err) {
      process.stderr.write(`channels-sdk: failed to save context: ${err}\n`);
    }
  }
}
