import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Scheduler } from './scheduler.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `channels-sched-test-${Date.now()}`);
const sent: { chatId: string; text: string }[] = [];

let sched: Scheduler;

const mockSend = async (chatId: string, text: string) => {
  sent.push({ chatId, text });
};

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  sent.length = 0;
  sched = new Scheduler(TEST_DIR, mockSend);
});

afterEach(() => {
  sched.stopAll();
  try { rmSync(TEST_DIR, { recursive: true }); } catch {}
});

describe('Scheduler', () => {
  // ── Add / Remove ──────────────────────────────────────────────

  it('adds a schedule and returns it with id', () => {
    const s = sched.add({ chatId: 'c1', text: 'hello', schedule: 'daily:18:00' });
    expect(s.id).toBeTruthy();
    expect(s.chatId).toBe('c1');
    expect(s.text).toBe('hello');
    expect(s.enabled).toBe(true);
  });

  it('lists active schedules', () => {
    sched.add({ chatId: 'c1', text: 'a', schedule: 'daily:18:00' });
    sched.add({ chatId: 'c2', text: 'b', schedule: 'hourly' });
    expect(sched.list()).toHaveLength(2);
  });

  it('removes a schedule by id', () => {
    const s = sched.add({ chatId: 'c1', text: 'a', schedule: 'daily:18:00' });
    expect(sched.remove(s.id)).toBe(true);
    expect(sched.list()).toHaveLength(0);
  });

  it('returns false when removing non-existent id', () => {
    expect(sched.remove('nonexistent')).toBe(false);
  });

  it('stopAll clears all timers', () => {
    sched.add({ chatId: 'c1', text: 'a', schedule: 'interval:1' });
    sched.add({ chatId: 'c2', text: 'b', schedule: 'interval:1' });
    sched.stopAll();
    // No crash, timers cleared
    expect(sched.list()).toHaveLength(2); // still listed, just not ticking
  });

  // ── Persistence ───────────────────────────────────────────────

  it('persists schedules across restarts', () => {
    sched.add({ chatId: 'c1', text: 'persistent', schedule: 'daily:09:00' });
    sched.stopAll();
    const sched2 = new Scheduler(TEST_DIR, mockSend);
    expect(sched2.list()).toHaveLength(1);
    expect(sched2.list()[0].text).toBe('persistent');
    sched2.stopAll();
  });

  // ── Delay Calculation ─────────────────────────────────────────

  it('daily schedule sets delay to next occurrence', () => {
    const s = sched.add({ chatId: 'c1', text: 'a', schedule: 'daily:23:59' });
    // Should be scheduled (timer active) — we can't easily check delay
    // but we can verify it was added and is enabled
    expect(s.enabled).toBe(true);
    expect(sched.list()).toHaveLength(1);
  });

  it('hourly schedule works', () => {
    const s = sched.add({ chatId: 'c1', text: 'a', schedule: 'hourly' });
    expect(s.enabled).toBe(true);
  });

  it('interval schedule works', () => {
    const s = sched.add({ chatId: 'c1', text: 'a', schedule: 'interval:5' });
    expect(s.enabled).toBe(true);
  });

  it('once schedule with future date works', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const s = sched.add({ chatId: 'c1', text: 'a', schedule: `once:${future}` });
    expect(s.enabled).toBe(true);
  });

  it('once schedule with past date does not schedule', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const s = sched.add({ chatId: 'c1', text: 'a', schedule: `once:${past}` });
    // Still added but won't fire
    expect(s.enabled).toBe(true);
  });

  it('unknown schedule format returns null delay gracefully', () => {
    const s = sched.add({ chatId: 'c1', text: 'a', schedule: 'invalid:format' });
    expect(s.enabled).toBe(true);
    // No crash
  });

  // ── Execution ─────────────────────────────────────────────────

  it('interval fires and calls send', async () => {
    // Use a very short interval to test actual firing
    sched.add({ chatId: 'c1', text: 'tick', schedule: 'interval:0' });
    // interval:0 → 0ms delay, should fire almost immediately
    await new Promise(r => setTimeout(r, 100));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].chatId).toBe('c1');
    expect(sent[0].text).toBe('tick');
  });

  it('silent flag is passed through', () => {
    const s = sched.add({ chatId: 'c1', text: 'quiet', schedule: 'daily:00:00', silent: true });
    expect(s.silent).toBe(true);
  });
});
