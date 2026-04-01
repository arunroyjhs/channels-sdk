# Channels SDK

Universal messaging layer for Claude Code. Connect your AI agent to Telegram, Discord, Slack, WhatsApp — same interface, different transport.

## Quick Start (Telegram)

```bash
# 1. Create a bot via @BotFather on Telegram
# 2. Save the token
echo "TELEGRAM_BOT_TOKEN=123456789:AAH..." > ~/.claude/channels/telegram/.env

# 3. Install & run
cd plugins/channels-sdk
bun install
bun start
```

## Pairing

### Deep Link (recommended)
Your agent generates a one-time link:
```
> create_deep_link tool → https://t.me/YourBot?start=pair_abc123
```
Open on your phone → instant pairing. Link expires in 10 minutes.

### Code Pairing
1. Send `/start` to the bot on Telegram
2. Bot replies with a 6-character code (e.g., `XHWN4K`)
3. Agent verifies it via `verify_pair_code` tool
4. Done — bot confirms pairing

### Commands
- `/start` — Begin pairing
- `/pair` — Get a new pairing code
- `/devices` — List paired devices
- `/lock` — Emergency: revoke all devices
- `/help` — Show all commands
- `/status` — Agent status
- `/tasks` — Task list
- `/clear` — Clear conversation context

## MCP Tools (16 total)

### Layer 1 — Communication
| Tool | Description |
|------|-------------|
| `reply` | Send a message (markdown, HTML, files, inline keyboard) |
| `react` | Add emoji reaction |
| `edit_message` | Edit a sent message |
| `send_keyboard` | Send inline keyboard buttons |
| `download_attachment` | Download file by Telegram file_id |
| `get_devices` | List paired devices |
| `verify_pair_code` | Verify a 6-char pairing code |
| `create_deep_link` | Generate one-time pairing URL |

### Layer 2 — Interaction
| Tool | Description |
|------|-------------|
| `send_poll` | Native Telegram poll (2-10 options) |
| `get_context` | Get recent conversation history |
| `track_response` | Log assistant message to context |

### Layer 3 — Intelligence
| Tool | Description |
|------|-------------|
| `transcribe_voice` | Transcribe audio file (Deepgram/OpenAI) |
| `schedule_message` | Schedule recurring or one-time messages |
| `list_schedules` | List active schedules |
| `remove_schedule` | Remove a schedule by ID |
| `send_alert` | Proactive alert with severity level |

## Voice Transcription

Automatically transcribes Telegram voice messages and replies with text.

Voice messages are downloaded and passed to Claude Code, which reads and transcribes them natively using your existing Claude plan. **No API keys needed for voice transcription.**

How it works:
1. User sends voice message on Telegram
2. Plugin downloads the audio file, reacts with 🎙
3. File path is included in the inbox message
4. Claude Code reads the audio file and transcribes it

Zero config. Zero cost. Uses your Claude subscription.

## Scheduled Messages

```
# Daily digest at 6pm
schedule_message: { chat_id, text: "Daily summary...", schedule: "daily:18:00" }

# Every 30 minutes
schedule_message: { chat_id, text: "Status check", schedule: "interval:30" }

# One-time reminder
schedule_message: { chat_id, text: "Meeting in 5min", schedule: "once:2026-04-02T10:00:00Z" }

# Hourly
schedule_message: { chat_id, text: "Heartbeat", schedule: "hourly" }
```

## Proactive Alerts

```
send_alert: {
  chat_id: "123",
  title: "Build Failed",
  body: "CI pipeline failed on commit abc123",
  level: "error",        // info | warning | error
  keyboard: [[{ text: "View Logs", callback_data: "logs" }]]
}
```

Severity indicators: info = ℹ️, warning = ⚠️, error = 🚨

## Conversation Context

The SDK maintains a rolling 50-message window per chat, persisted to disk.

- Auto-tracks all user messages and command responses
- `get_context` tool retrieves recent history
- `track_response` logs agent replies
- `/clear` command resets context
- 24-hour TTL with auto-prune
- Debounced disk writes (3-second batch)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 MCP Server                       │
│  (16 tools, stdin/stdout transport)              │
├─────────────────────────────────────────────────┤
│  Core Modules                                    │
│  ├── PairingManager (auth, sessions, devices)    │
│  ├── CommandRegistry (extensible /commands)       │
│  ├── ContextManager (conversation history)        │
│  ├── Scheduler (recurring/one-time messages)      │
│  └── Voice (STT: Deepgram, OpenAI)               │
├─────────────────────────────────────────────────┤
│  Channel Adapters                                │
│  ├── TelegramAdapter (grammY) ← implemented      │
│  ├── DiscordAdapter           ← planned           │
│  ├── SlackAdapter             ← planned           │
│  └── WhatsAppAdapter          ← planned           │
└─────────────────────────────────────────────────┘
```

All core modules are channel-agnostic. Adding a new platform means implementing the `ChannelAdapter` interface (send, edit, react, keyboard, download, onMessage, onCallback).

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather |
| `CHANNELS_STATE_DIR` | No | `~/.claude/channels/telegram` | State directory |

## Testing

```bash
bun test           # 82 tests, ~700ms
bun test --watch   # watch mode
```

Test coverage:
- Pairing: 26 tests (codes, auth, multi-device, persistence)
- Messages: 12 tests (splitting, types)
- Commands: 9 tests (registry, execution, help)
- Context: 12 tests (add, retrieve, persist, prune)
- Scheduler: 14 tests (add, remove, delay, persist, execution)
- Voice: 9 tests (config, validation, providers)

## License

MIT
