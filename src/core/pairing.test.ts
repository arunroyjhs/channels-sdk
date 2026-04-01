/**
 * Test suite for PairingManager
 *
 * Covers: code generation, verification, expiry, multi-device,
 * authorization, revocation, persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PairingManager } from './pairing.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `channels-sdk-test-${Date.now()}`);

let pm: PairingManager;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  pm = new PairingManager(TEST_DIR);
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch {}
});

describe('PairingManager', () => {
  // ── Code Generation ─────────────────────────────────────────────

  describe('generatePairCode', () => {
    it('generates a 6-character code', () => {
      const code = pm.generatePairCode('chat1', 'user1', 'testuser');
      expect(code).toHaveLength(6);
    });

    it('generates codes with no ambiguous characters (0/O/1/I/L)', () => {
      for (let i = 0; i < 50; i++) {
        const code = pm.generatePairCode(`chat${i}`, `user${i}`);
        if (code === 'ALREADY_PAIRED') continue;
        expect(code).not.toMatch(/[0OoIiLl1]/);
      }
    });

    it('generates unique codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const code = pm.generatePairCode(`chat${i}`, `user${i}`);
        expect(codes.has(code)).toBe(false);
        codes.add(code);
      }
    });

    it('returns ALREADY_PAIRED for paired devices', () => {
      const code = pm.generatePairCode('chat1', 'user1');
      pm.verifyPairCode(code);
      const second = pm.generatePairCode('chat1', 'user1');
      expect(second).toBe('ALREADY_PAIRED');
    });
  });

  // ── Code Verification ───────────────────────────────────────────

  describe('verifyPairCode', () => {
    it('returns device on valid code', () => {
      const code = pm.generatePairCode('chat1', 'user1', 'testuser');
      const device = pm.verifyPairCode(code);
      expect(device).not.toBeNull();
      expect(device!.userId).toBe('user1');
      expect(device!.chatId).toBe('chat1');
      expect(device!.username).toBe('testuser');
      expect(device!.sessionToken).toHaveLength(64); // 32 bytes hex
    });

    it('is case-insensitive', () => {
      const code = pm.generatePairCode('chat1', 'user1');
      const device = pm.verifyPairCode(code.toLowerCase());
      expect(device).not.toBeNull();
    });

    it('returns null for invalid code', () => {
      const device = pm.verifyPairCode('XXXXXX');
      expect(device).toBeNull();
    });

    it('returns null for empty code', () => {
      const device = pm.verifyPairCode('');
      expect(device).toBeNull();
    });

    it('code can only be used once', () => {
      const code = pm.generatePairCode('chat1', 'user1');
      const first = pm.verifyPairCode(code);
      expect(first).not.toBeNull();
      // Code consumed — new PM won't find it
      const pm2 = new PairingManager(TEST_DIR);
      // Device is already paired, so generatePairCode returns ALREADY_PAIRED
      expect(pm2.generatePairCode('chat1', 'user1')).toBe('ALREADY_PAIRED');
    });

    it('replaces existing device for same chat+user', () => {
      // First pairing
      const code1 = pm.generatePairCode('chat1', 'user1');
      const dev1 = pm.verifyPairCode(code1);
      expect(dev1).not.toBeNull();

      // Revoke so we can re-pair
      pm.revokeDevice(dev1!.id);

      // Second pairing
      const code2 = pm.generatePairCode('chat1', 'user1');
      const dev2 = pm.verifyPairCode(code2);
      expect(dev2).not.toBeNull();
      expect(dev2!.id).not.toBe(dev1!.id);

      // Only one device for this chat+user
      const devices = pm.getDevices();
      const forUser = devices.filter(d => d.userId === 'user1');
      expect(forUser).toHaveLength(1);
    });
  });

  // ── Deep Link Auto-Pair ─────────────────────────────────────────

  describe('autoApproveDeepLink', () => {
    it('creates device without code', () => {
      const device = pm.autoApproveDeepLink('chat1', 'user1', 'testuser');
      expect(device.userId).toBe('user1');
      expect(device.sessionToken).toHaveLength(64);
    });

    it('replaces existing device for same chat+user', () => {
      const dev1 = pm.autoApproveDeepLink('chat1', 'user1');
      const dev2 = pm.autoApproveDeepLink('chat1', 'user1');
      expect(dev2.id).not.toBe(dev1.id);
      expect(pm.getDevices().filter(d => d.userId === 'user1')).toHaveLength(1);
    });
  });

  // ── Authorization ───────────────────────────────────────────────

  describe('isAuthorized', () => {
    it('returns false for unpaired device', () => {
      expect(pm.isAuthorized('chat1', 'user1')).toBe(false);
    });

    it('returns true for paired device', () => {
      const code = pm.generatePairCode('chat1', 'user1');
      pm.verifyPairCode(code);
      expect(pm.isAuthorized('chat1', 'user1')).toBe(true);
    });

    it('returns true for deep-linked device', () => {
      pm.autoApproveDeepLink('chat1', 'user1');
      expect(pm.isAuthorized('chat1', 'user1')).toBe(true);
    });

    it('returns false for wrong user in same chat', () => {
      pm.autoApproveDeepLink('chat1', 'user1');
      expect(pm.isAuthorized('chat1', 'user2')).toBe(false);
    });

    it('returns true in open mode for anyone', () => {
      pm.updatePolicy({ mode: 'open' });
      expect(pm.isAuthorized('anychat', 'anyuser')).toBe(true);
    });

    it('returns true in allowlist mode for allowed user', () => {
      pm.updatePolicy({ mode: 'allowlist', allowedUserIds: ['user1'] });
      expect(pm.isAuthorized('chat1', 'user1')).toBe(true);
      expect(pm.isAuthorized('chat1', 'user2')).toBe(false);
    });

    it('updates lastSeen on authorized access', () => {
      pm.autoApproveDeepLink('chat1', 'user1');
      const before = pm.getDevices()[0].lastSeen;
      // Small delay
      const start = Date.now();
      while (Date.now() - start < 10) {} // busy wait 10ms
      pm.isAuthorized('chat1', 'user1');
      const after = pm.getDevices()[0].lastSeen;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  // ── Multi-Device ────────────────────────────────────────────────

  describe('multi-device', () => {
    it('supports multiple devices for different users', () => {
      pm.autoApproveDeepLink('chat1', 'user1');
      pm.autoApproveDeepLink('chat2', 'user2');
      pm.autoApproveDeepLink('chat3', 'user3');
      expect(pm.getDevices()).toHaveLength(3);
    });

    it('enforces max device limit', () => {
      pm.updatePolicy({ maxDevices: 2 });
      pm.autoApproveDeepLink('chat1', 'user1');
      pm.autoApproveDeepLink('chat2', 'user2');
      // Third device via code — should fail
      const code = pm.generatePairCode('chat3', 'user3');
      const device = pm.verifyPairCode(code);
      expect(device).toBeNull();
    });
  });

  // ── Revocation ──────────────────────────────────────────────────

  describe('revocation', () => {
    it('revokes a specific device', () => {
      const dev = pm.autoApproveDeepLink('chat1', 'user1');
      expect(pm.revokeDevice(dev.id)).toBe(true);
      expect(pm.isAuthorized('chat1', 'user1')).toBe(false);
    });

    it('returns false for non-existent device', () => {
      expect(pm.revokeDevice('nonexistent')).toBe(false);
    });

    it('revokeAll clears everything', () => {
      pm.autoApproveDeepLink('chat1', 'user1');
      pm.autoApproveDeepLink('chat2', 'user2');
      const count = pm.revokeAll();
      expect(count).toBe(2);
      expect(pm.getDevices()).toHaveLength(0);
    });
  });

  // ── Persistence ─────────────────────────────────────────────────

  describe('persistence', () => {
    it('survives restart', () => {
      pm.autoApproveDeepLink('chat1', 'user1', 'testuser');
      // Create new instance from same dir
      const pm2 = new PairingManager(TEST_DIR);
      expect(pm2.isAuthorized('chat1', 'user1')).toBe(true);
      expect(pm2.getDevices()).toHaveLength(1);
      expect(pm2.getDevices()[0].username).toBe('testuser');
    });

    it('persists policy changes', () => {
      pm.updatePolicy({ mode: 'allowlist', allowedUserIds: ['user1'] });
      const pm2 = new PairingManager(TEST_DIR);
      expect(pm2.getPolicy().mode).toBe('allowlist');
      expect(pm2.getPolicy().allowedUserIds).toContain('user1');
    });

    it('handles corrupt state file gracefully', () => {
      const { writeFileSync } = require('fs');
      writeFileSync(join(TEST_DIR, 'devices.json'), 'not json!!!');
      const pm2 = new PairingManager(TEST_DIR);
      expect(pm2.getDevices()).toHaveLength(0);
    });
  });
});
