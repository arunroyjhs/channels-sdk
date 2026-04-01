/**
 * Voice Message Handler
 *
 * No external API calls. Voice files are downloaded and passed to
 * Claude Code via the inbox — Claude reads and transcribes natively
 * using its multimodal capabilities (user's existing Claude plan).
 */

import { existsSync } from 'fs';

/**
 * Validates a voice file exists and returns metadata for inbox.
 * Actual transcription is done by Claude Code when it reads the file.
 */
export function prepareVoiceForInbox(audioPath: string): {
  path: string;
  exists: boolean;
  sizeBytes: number;
  mimeType: string;
} {
  const exists = existsSync(audioPath);
  const ext = audioPath.split('.').pop()?.toLowerCase() || 'ogg';
  const mimeMap: Record<string, string> = {
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    mp3: 'audio/mp3',
    wav: 'audio/wav',
    webm: 'audio/webm',
    m4a: 'audio/mp4',
  };

  let sizeBytes = 0;
  if (exists) {
    const { statSync } = require('fs');
    sizeBytes = statSync(audioPath).size;
  }

  return {
    path: audioPath,
    exists,
    sizeBytes,
    mimeType: mimeMap[ext] || 'audio/ogg',
  };
}
