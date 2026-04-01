# Channels SDK

Universal messaging layer for Claude Code. Connect your AI agent to Telegram, Discord, Slack, WhatsApp — same interface, different transport.

## Install

```bash
claude plugins marketplace add arunroyjhs/channels-sdk
claude plugins install channels-telegram
```

## Setup

After installing, run the setup skill in Claude Code:

```
/channels-telegram:setup
```

It walks you through everything:
1. Create a bot on @BotFather (60 seconds)
2. Paste the token — saved automatically
3. Restart Claude Code
4. DM your bot `/start` on Telegram — paired

One skill, one paste, done.

## Pairing Your Phone

### Deep Link (fastest)
Your Claude Code agent generates a one-time link:
```
create_deep_link tool → https://t.me/YourBot?start=pair_abc123
```
Tap on phone → instant pairing. Link expires in 10 minutes.

### Code Pairing
1. Send `/start` to the bot on Telegram
2. Bot shows a 6-character code (e.g., `XHWN4K`)
3. Claude Code verifies it via `verify_pair_code` tool
4. Bot confirms: "Paired!"

### Telegram Commands
| Command | What it does |
|---------|-------------|
| `/start` | Begin pairing |
| `/pair` | Get a new pairing code |
| `/devices` | List paired devices |
| `/lock` | Emergency: revoke all devices |
| `/help` | Show all commands |
| `/status` | Agent status |
| `/tasks` | Task list |
| `/clear` | Clear conversation context |

## Features

### 16 MCP Tools

**Layer 1 — Communication**
| Tool | Description |
|------|-------------|
| `reply` | Send message (markdown, HTML, files, inline keyboard) |
| `react` | Emoji reaction |
| `edit_message` | Edit a sent message |
| `send_keyboard` | Inline keyboard buttons |
| `download_attachment` | Download file by Telegram file_id |
| `get_devices` | List paired devices |
| `verify_pair_code` | Verify pairing code |
| `create_deep_link` | Generate one-time pairing URL |

**Layer 2 — Interaction**
| Tool | Description |
|------|-------------|
| `send_poll` | Native Telegram poll (2-10 options) |
| `get_context` | Recent conversation history |
| `track_response` | Log assistant message to context |

**Layer 3 — Intelligence**
| Tool | Description |
|------|-------------|
| `transcribe_voice` | Voice file path for Claude to read |
| `schedule_message` | Schedule recurring/one-time messages |
| `list_schedules` | List active schedules |
| `remove_schedule` | Remove a schedule |
| `send_alert` | Proactive alert with severity |

### Voice Messages
Voice messages are handled by Claude Code natively — no API keys needed.

1. User sends voice message on Telegram
2. Plugin downloads audio, reacts with 🎙
3. File path passed to Claude Code
4. Claude reads and transcribes using your existing plan

Zero config. Zero cost.

### Scheduled Messages
```
"daily:18:00"              → every day at 6pm
"hourly"                   → top of each hour
"interval:30"              → every 30 minutes
"once:2026-04-02T10:00:00Z" → one-time
```

### Proactive Alerts
Severity levels: ℹ️ info, ⚠️ warning, 🚨 error. Optional action buttons.

### Conversation Context
Rolling 50-message window per chat. Persisted to disk. 24-hour TTL. Auto-prune. Debounced writes.

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
│  └── Voice (Claude Code native transcription)     │
├─────────────────────────────────────────────────┤
│  Channel Adapters                                │
│  ├── TelegramAdapter (grammY) ← implemented      │
│  ├── DiscordAdapter           ← planned           │
│  ├── SlackAdapter             ← planned           │
│  └── WhatsAppAdapter          ← planned           │
└─────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather |
| `CHANNELS_STATE_DIR` | No | `~/.claude/channels/telegram` | State directory |

## Testing

```bash
bun test           # 83 tests, ~700ms
bun test --watch   # watch mode
```

## Uninstall

```bash
claude plugins uninstall channels-telegram
claude plugins marketplace remove channels-sdk
```

## License

MIT
