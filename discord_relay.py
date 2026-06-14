#!/usr/bin/env python3
"""
Discord ↔ lilak community relay bot.

This script is a small standalone process that:
  • watches a Discord channel for new messages
  • POSTs each new message to lilak's /community/incoming/{token} endpoint
  • ignores messages sent by webhooks (= what lilak posts into Discord),
    so we never loop back

Run alongside the lilak server. Edit `discord_relay.env` to set:
  LILAK_INCOMING_URL  – grab from lilak Settings → 커뮤니티 브리지 → copy
  DISCORD_BOT_TOKEN   – from Discord Developer Portal → Bot → Reset Token
Optional:
  DISCORD_CHANNEL_IDS – comma-separated channel IDs to relay (empty = all)

Usage:
  pip install "discord.py>=2.0" aiohttp
  python3 discord_relay.py
"""

import os
import sys
from pathlib import Path


# ── tiny .env loader (so we don't depend on python-dotenv) ────────────────────
def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env(Path(__file__).with_name("discord_relay.env"))

LILAK_INCOMING_URL = os.environ.get("LILAK_INCOMING_URL", "").strip()
DISCORD_BOT_TOKEN  = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
_channel_ids_raw   = os.environ.get("DISCORD_CHANNEL_IDS", "")
CHANNEL_IDS = {int(x) for x in _channel_ids_raw.split(",") if x.strip().isdigit()}

if not LILAK_INCOMING_URL or "(여기" in LILAK_INCOMING_URL:
    print("❌ LILAK_INCOMING_URL not set — edit discord_relay.env", file=sys.stderr)
    sys.exit(1)
if not DISCORD_BOT_TOKEN or "(여기" in DISCORD_BOT_TOKEN:
    print("❌ DISCORD_BOT_TOKEN not set — edit discord_relay.env", file=sys.stderr)
    sys.exit(1)

try:
    import aiohttp                # noqa: F401  — surface a clear error if missing
    import discord
except ImportError as e:
    print(f"❌ Missing dependency: {e}\n   Run:  pip install \"discord.py>=2.0\" aiohttp",
          file=sys.stderr)
    sys.exit(1)

intents = discord.Intents.default()
intents.message_content = True   # also requires MESSAGE CONTENT INTENT enabled in dev portal

client = discord.Client(intents=intents)


@client.event
async def on_ready():
    chans = f"channels filter = {CHANNEL_IDS}" if CHANNEL_IDS else "all channels the bot can see"
    print(f"✅ Bot logged in: {client.user}  ({chans})")


@client.event
async def on_message(message: "discord.Message"):
    # ── filters ──
    if message.author == client.user:
        return                                   # don't relay our own bot messages
    if message.webhook_id:
        return                                   # lilak → Discord posts come through a webhook; skip them (loop prevention)
    if CHANNEL_IDS and message.channel.id not in CHANNEL_IDS:
        return                                   # not a watched channel
    if not message.content:
        return                                   # empty (file-only / sticker-only) — skip

    payload = {
        "username": message.author.display_name or message.author.name,
        "content":  message.content,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(LILAK_INCOMING_URL, json=payload, timeout=10) as resp:
                body = await resp.text()
                if resp.status >= 300:
                    print(f"⚠ lilak POST {resp.status}: {body[:200]}")
                else:
                    print(f"→ lilak {resp.status}  ({payload['username']}: {payload['content'][:40]})")
    except Exception as e:
        print(f"⚠ relay error: {type(e).__name__}: {e}")


if __name__ == "__main__":
    print("Starting Discord ↔ lilak relay …")
    client.run(DISCORD_BOT_TOKEN)
