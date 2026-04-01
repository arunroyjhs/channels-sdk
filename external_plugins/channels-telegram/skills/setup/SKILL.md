---
name: setup
description: Set up Channels SDK Telegram — create bot, save token, pair device. Triggers automatically on first use or when user asks to configure Telegram. One command does everything.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(chmod *)
---

# /channels-telegram:setup — One-Step Telegram Setup

Handles the entire setup flow automatically. User only needs to paste a bot token.

Arguments passed: `$ARGUMENTS`

---

## If arguments contain a token (looks like `123456789:AAH...`)

1. `mkdir -p ~/.claude/channels/telegram`
2. Read existing `~/.claude/channels/telegram/.env` if present
3. Update/add the `TELEGRAM_BOT_TOKEN=` line, preserve other keys
4. Write back, no quotes around the value
5. `chmod 600 ~/.claude/channels/telegram/.env`
6. Tell the user: "Token saved. Restart Claude Code or run /reload-plugins, then DM your bot /start to pair."

## If no arguments — guide the user

Show this flow:

1. Check if token already exists in `~/.claude/channels/telegram/.env`
   - If yes: show status (token set, first 10 chars masked)
   - If no: continue to step 2

2. Tell the user:
   ```
   Let's set up Telegram in 60 seconds:

   1. Open Telegram → search @BotFather → send /newbot
   2. Pick a name and username for your bot
   3. BotFather gives you a token — paste it here
   ```

3. Wait for the user to paste the token

4. Once pasted: save it (same as the token flow above)

5. After saving, tell the user:
   ```
   Done! Restart Claude Code, then DM your bot /start on Telegram to pair.
   ```

## If arguments are "status"

Read `~/.claude/channels/telegram/.env` and `~/.claude/channels/telegram/devices.json`:
- Show token status (set/not set, masked)
- Show paired devices count and names
- Show if plugin is running

## If arguments are "clear"

Delete the `TELEGRAM_BOT_TOKEN=` line from `.env`.

---

## Notes

- The server reads `.env` at boot. Token changes need restart or `/reload-plugins`.
- `devices.json` is managed by the PairingManager at runtime.
- The plugin auto-creates `~/.claude/channels/telegram/` on first run.
