import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { prepareVoiceForInbox } from './voice.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `channels-voice-test-${Date.now()}`);

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => { try { rmSync(TEST_DIR, { recursive: true }); } catch {} });

describe('Voice (Claude Code native)', () => {
  it('returns exists:true for real file', () => {
    const path = join(TEST_DIR, 'test.ogg');
    writeFileSync(path, Buffer.from('fake audio'));
    const info = prepareVoiceForInbox(path);
    expect(info.exists).toBe(true);
    expect(info.sizeBytes).toBeGreaterThan(0);
    expect(info.mimeType).toBe('audio/ogg');
  });

  it('returns exists:false for missing file', () => {
    const info = prepareVoiceForInbox('/nonexistent.ogg');
    expect(info.exists).toBe(false);
    expect(info.sizeBytes).toBe(0);
  });

  it('detects ogg mime type', () => {
    const path = join(TEST_DIR, 'voice.ogg');
    writeFileSync(path, Buffer.from('x'));
    expect(prepareVoiceForInbox(path).mimeType).toBe('audio/ogg');
  });

  it('detects mp3 mime type', () => {
    const path = join(TEST_DIR, 'voice.mp3');
    writeFileSync(path, Buffer.from('x'));
    expect(prepareVoiceForInbox(path).mimeType).toBe('audio/mp3');
  });

  it('detects wav mime type', () => {
    const path = join(TEST_DIR, 'voice.wav');
    writeFileSync(path, Buffer.from('x'));
    expect(prepareVoiceForInbox(path).mimeType).toBe('audio/wav');
  });

  it('detects webm mime type', () => {
    const path = join(TEST_DIR, 'voice.webm');
    writeFileSync(path, Buffer.from('x'));
    expect(prepareVoiceForInbox(path).mimeType).toBe('audio/webm');
  });

  it('detects m4a mime type', () => {
    const path = join(TEST_DIR, 'voice.m4a');
    writeFileSync(path, Buffer.from('x'));
    expect(prepareVoiceForInbox(path).mimeType).toBe('audio/mp4');
  });

  it('falls back to audio/ogg for unknown extension', () => {
    const path = join(TEST_DIR, 'voice.xyz');
    writeFileSync(path, Buffer.from('x'));
    expect(prepareVoiceForInbox(path).mimeType).toBe('audio/ogg');
  });

  it('returns correct file size', () => {
    const path = join(TEST_DIR, 'sized.ogg');
    writeFileSync(path, Buffer.alloc(1024));
    expect(prepareVoiceForInbox(path).sizeBytes).toBe(1024);
  });

  it('returns the same path back', () => {
    const path = join(TEST_DIR, 'test.ogg');
    writeFileSync(path, Buffer.from('x'));
    expect(prepareVoiceForInbox(path).path).toBe(path);
  });
});
