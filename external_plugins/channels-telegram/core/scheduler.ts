/**
 * Message Scheduler
 *
 * Schedule recurring or one-time messages to channels.
 * Used for: daily digests, proactive alerts, reminders.
 */

import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ScheduledMessage {
  id: string;
  chatId: string;
  text: string;
  /** Cron-like schedule: "daily:18:00", "hourly", "once:2026-04-02T10:00:00Z" */
  schedule: string;
  /** Whether to send silently */
  silent?: boolean;
  /** Keyboard to attach */
  keyboard?: Array<Array<{ text: string; callbackData?: string }>>;
  createdAt: number;
  lastRunAt?: number;
  enabled: boolean;
}

type SendFn = (chatId: string, text: string, opts?: {
  silent?: boolean;
  keyboard?: Array<Array<{ text: string; callbackData?: string }>>;
}) => Promise<void>;

export class Scheduler {
  private schedules: ScheduledMessage[] = [];
  private stateFile: string;
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private sendFn: SendFn;

  constructor(stateDir: string, sendFn: SendFn) {
    mkdirSync(stateDir, { recursive: true });
    this.stateFile = join(stateDir, 'schedules.json');
    this.sendFn = sendFn;
    this.load();
  }

  /** Add a new scheduled message */
  add(msg: Omit<ScheduledMessage, 'id' | 'createdAt' | 'enabled'>): ScheduledMessage {
    const scheduled: ScheduledMessage = {
      ...msg,
      id: randomBytes(8).toString('hex'),
      createdAt: Date.now(),
      enabled: true,
    };
    this.schedules.push(scheduled);
    this.save();
    this.scheduleNext(scheduled);
    return scheduled;
  }

  /** Remove a scheduled message */
  remove(id: string): boolean {
    const before = this.schedules.length;
    this.schedules = this.schedules.filter(s => s.id !== id);
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    if (this.schedules.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /** List all schedules */
  list(): ScheduledMessage[] {
    return this.schedules.filter(s => s.enabled);
  }

  /** Start all schedules (call on init) */
  startAll(): void {
    for (const s of this.schedules) {
      if (s.enabled) this.scheduleNext(s);
    }
  }

  /** Stop all timers */
  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private scheduleNext(msg: ScheduledMessage): void {
    const delay = this.getNextDelay(msg);
    if (delay === null) return; // one-time already executed

    const timer = setTimeout(async () => {
      this.timers.delete(msg.id);
      try {
        await this.sendFn(msg.chatId, msg.text, {
          silent: msg.silent,
          keyboard: msg.keyboard,
        });
        msg.lastRunAt = Date.now();
        this.save();
      } catch (err) {
        process.stderr.write(`channels-sdk: scheduled send failed: ${err}\n`);
      }
      // Reschedule if recurring, disable if one-time
      if (msg.schedule.startsWith('once:')) {
        msg.enabled = false;
        this.save();
      } else {
        this.scheduleNext(msg);
      }
    }, delay);

    this.timers.set(msg.id, timer);
  }

  private getNextDelay(msg: ScheduledMessage): number | null {
    const now = new Date();

    // "daily:HH:MM" — run at that time every day
    if (msg.schedule.startsWith('daily:')) {
      const [h, m] = msg.schedule.slice(6).split(':').map(Number);
      const next = new Date(now);
      next.setHours(h, m, 0, 0);
      if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime() - now.getTime();
    }

    // "hourly" — run at the top of each hour
    if (msg.schedule === 'hourly') {
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next.getTime() - now.getTime();
    }

    // "once:ISO_DATE" — run once at a specific time
    if (msg.schedule.startsWith('once:')) {
      const target = new Date(msg.schedule.slice(5)).getTime();
      if (target <= now.getTime()) return null; // past
      return target - now.getTime();
    }

    // "interval:MINUTES" — run every N minutes
    if (msg.schedule.startsWith('interval:')) {
      const minutes = parseInt(msg.schedule.slice(9), 10);
      return minutes * 60 * 1000;
    }

    return null;
  }

  private load(): void {
    try {
      const raw = readFileSync(this.stateFile, 'utf8');
      this.schedules = JSON.parse(raw);
    } catch {
      this.schedules = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(this.stateFile, JSON.stringify(this.schedules, null, 2));
    } catch (err) {
      process.stderr.write(`channels-sdk: failed to save schedules: ${err}\n`);
    }
  }
}
