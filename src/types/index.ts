// ── Channel SDK Types ────────────────────────────────────────────────

/** A paired device/user that can interact with the agent */
export interface PairedDevice {
  id: string;
  userId: string;
  chatId: string;
  username?: string;
  displayName?: string;
  pairedAt: number;
  lastSeen: number;
  sessionToken: string;
  expiresAt: number;
}

/** Inline keyboard button */
export interface KeyboardButton {
  text: string;
  /** Callback data sent when button is pressed */
  callbackData?: string;
  /** URL to open when button is pressed */
  url?: string;
}

/** A row of keyboard buttons */
export type KeyboardRow = KeyboardButton[];

/** Message to send through a channel */
export interface OutboundMessage {
  chatId: string;
  text: string;
  /** Markdown formatting */
  format?: 'text' | 'markdown' | 'html';
  /** Reply to a specific message */
  replyTo?: string;
  /** Inline keyboard rows */
  keyboard?: KeyboardRow[];
  /** File paths to attach */
  files?: string[];
  /** Send silently (no notification) */
  silent?: boolean;
}

/** Inbound message from user */
export interface InboundMessage {
  messageId: string;
  chatId: string;
  userId: string;
  username?: string;
  text?: string;
  /** Voice message audio file path (after download) */
  voicePath?: string;
  /** Voice message transcription */
  voiceTranscript?: string;
  /** Photo/file attachment paths */
  attachments?: string[];
  /** Callback data from inline keyboard press */
  callbackData?: string;
  /** Command if message starts with / */
  command?: string;
  commandArgs?: string;
  timestamp: number;
}

/** Channel adapter interface — implemented by each platform */
export interface ChannelAdapter {
  readonly platform: string;

  /** Initialize the adapter (connect to API, start polling/webhook) */
  init(): Promise<void>;

  /** Send a message */
  send(msg: OutboundMessage): Promise<string>; // returns message ID

  /** Edit a previously sent message */
  edit(chatId: string, messageId: string, text: string, format?: string): Promise<void>;

  /** React to a message with emoji */
  react(chatId: string, messageId: string, emoji: string): Promise<void>;

  /** Send inline keyboard */
  sendKeyboard(chatId: string, text: string, keyboard: KeyboardRow[]): Promise<string>;

  /** Download an attachment by file ID */
  downloadAttachment(fileId: string): Promise<string>; // returns local file path

  /** Register callback for inbound messages */
  onMessage(handler: (msg: InboundMessage) => void): void;

  /** Register callback for keyboard button presses */
  onCallback(handler: (chatId: string, messageId: string, data: string) => void): void;

  /** Get bot info (username, display name) */
  getBotInfo(): { username: string; displayName: string };

  /** Stop the adapter */
  stop(): Promise<void>;
}

/** Pairing state */
export interface PairingState {
  devices: PairedDevice[];
  pendingCodes: Map<string, { chatId: string; userId: string; username?: string; createdAt: number }>;
  groupChats: Map<string, { allowedUsers: string[] }>;
}

/** Access policy */
export interface AccessPolicy {
  mode: 'open' | 'pairing' | 'allowlist';
  allowedUserIds: string[];
  allowedUsernames: string[];
  sessionTtlMs: number; // default 30 days
  maxDevices: number; // default 5
}
