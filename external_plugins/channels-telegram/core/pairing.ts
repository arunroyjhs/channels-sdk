/**
 * Pairing & Session Manager
 *
 * Handles device pairing, session tokens, multi-device, and access control.
 * State persisted to JSON file.
 */

import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { PairedDevice, AccessPolicy } from '../types/index.js';

const DEFAULT_SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_LENGTH = 6;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I/L)
const CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes

interface PendingPair {
  code: string;
  chatId: string;
  userId: string;
  username?: string;
  displayName?: string;
  createdAt: number;
}

interface PairingStore {
  devices: PairedDevice[];
  policy: AccessPolicy;
}

export class PairingManager {
  private stateDir: string;
  private stateFile: string;
  private store: PairingStore;
  private pendingPairs: Map<string, PendingPair> = new Map();

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.stateFile = join(stateDir, 'devices.json');
    mkdirSync(stateDir, { recursive: true });
    this.store = this.load();
  }

  // ── Pairing Flow ──────────────────────────────────────────────────

  /** Generate a pairing code for a new device request */
  generatePairCode(chatId: string, userId: string, username?: string, displayName?: string): string {
    // Clean expired pending codes
    const now = Date.now();
    for (const [code, pending] of this.pendingPairs) {
      if (now - pending.createdAt > CODE_EXPIRY) this.pendingPairs.delete(code);
    }

    // Check if already paired
    const existing = this.store.devices.find(d => d.chatId === chatId && d.userId === userId);
    if (existing && existing.expiresAt > now) {
      return 'ALREADY_PAIRED';
    }

    // Generate code
    let code = '';
    const bytes = randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    }

    this.pendingPairs.set(code, { code, chatId, userId, username, displayName, createdAt: now });
    return code;
  }

  /** Verify a pairing code and create a device session */
  verifyPairCode(code: string): PairedDevice | null {
    const normalized = code.toUpperCase().trim();
    const pending = this.pendingPairs.get(normalized);

    if (!pending) return null;
    if (Date.now() - pending.createdAt > CODE_EXPIRY) {
      this.pendingPairs.delete(normalized);
      return null;
    }

    // Check max devices
    const activeDevices = this.store.devices.filter(d => d.expiresAt > Date.now());
    if (activeDevices.length >= this.store.policy.maxDevices) {
      return null; // too many devices
    }

    // Create device
    const device: PairedDevice = {
      id: randomBytes(16).toString('hex'),
      userId: pending.userId,
      chatId: pending.chatId,
      username: pending.username,
      displayName: pending.displayName,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      sessionToken: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + (this.store.policy.sessionTtlMs || DEFAULT_SESSION_TTL),
    };

    // Remove any existing device for same chat
    this.store.devices = this.store.devices.filter(
      d => !(d.chatId === device.chatId && d.userId === device.userId),
    );
    this.store.devices.push(device);
    this.pendingPairs.delete(normalized);
    this.save();

    return device;
  }

  /** Auto-pair via deep link token (no code entry needed) */
  autoApproveDeepLink(chatId: string, userId: string, username?: string, displayName?: string): PairedDevice {
    // Remove existing
    this.store.devices = this.store.devices.filter(
      d => !(d.chatId === chatId && d.userId === userId),
    );

    const device: PairedDevice = {
      id: randomBytes(16).toString('hex'),
      userId,
      chatId,
      username,
      displayName,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      sessionToken: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + (this.store.policy.sessionTtlMs || DEFAULT_SESSION_TTL),
    };

    this.store.devices.push(device);
    this.save();
    return device;
  }

  // ── Access Control ────────────────────────────────────────────────

  /** Check if a chat/user is authorized to interact */
  isAuthorized(chatId: string, userId: string): boolean {
    const policy = this.store.policy;

    // Open mode — everyone allowed
    if (policy.mode === 'open') return true;

    // Allowlist mode — check username/userId
    if (policy.mode === 'allowlist') {
      return policy.allowedUserIds.includes(userId);
    }

    // Pairing mode — check active device sessions
    const device = this.store.devices.find(
      d => d.chatId === chatId && d.userId === userId,
    );
    if (!device) return false;
    if (device.expiresAt < Date.now()) return false;

    // Update last seen
    device.lastSeen = Date.now();
    this.save();
    return true;
  }

  /** Get all paired devices */
  getDevices(): PairedDevice[] {
    return this.store.devices.filter(d => d.expiresAt > Date.now());
  }

  /** Revoke a device by ID */
  revokeDevice(deviceId: string): boolean {
    const before = this.store.devices.length;
    this.store.devices = this.store.devices.filter(d => d.id !== deviceId);
    if (this.store.devices.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Revoke all devices (emergency lock) */
  revokeAll(): number {
    const count = this.store.devices.length;
    this.store.devices = [];
    this.pendingPairs.clear();
    this.save();
    return count;
  }

  /** Get access policy */
  getPolicy(): AccessPolicy {
    return this.store.policy;
  }

  /** Update access policy */
  updatePolicy(update: Partial<AccessPolicy>): void {
    this.store.policy = { ...this.store.policy, ...update };
    this.save();
  }

  // ── Persistence ───────────────────────────────────────────────────

  private load(): PairingStore {
    try {
      const raw = readFileSync(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        devices: parsed.devices || [],
        policy: {
          mode: parsed.policy?.mode || 'pairing',
          allowedUserIds: parsed.policy?.allowedUserIds || [],
          allowedUsernames: parsed.policy?.allowedUsernames || [],
          sessionTtlMs: parsed.policy?.sessionTtlMs || DEFAULT_SESSION_TTL,
          maxDevices: parsed.policy?.maxDevices || 5,
        },
      };
    } catch {
      return {
        devices: [],
        policy: {
          mode: 'pairing',
          allowedUserIds: [],
          allowedUsernames: [],
          sessionTtlMs: DEFAULT_SESSION_TTL,
          maxDevices: 5,
        },
      };
    }
  }

  private save(): void {
    writeFileSync(this.stateFile, JSON.stringify(this.store, null, 2));
  }
}
