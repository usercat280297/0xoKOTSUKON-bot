# 0xoKOTSUKON Bot

Discord ticket bot built with `TypeScript + discord.js + Postgres`.

## Features

- Multiple dropdown ticket panels
- Per-option routing by required role, target category, and staff role
- One open ticket per user per guild
- Claim, close, add member, remove member
- HTML transcript logging
- Daily opening window
- Optional health endpoint for Render web service deploys

## Runtime modes

This repo now supports two practical modes:

1. Render web service
2. Local fallback on your own PC

The bot code is the same in both places. You only change environment variables.

## Environment

Create `.env` from `.env.example`.

Required:

```env
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME?sslmode=require
PG_SSL_REJECT_UNAUTHORIZED=false
TICKET_TIMEZONE=Asia/Bangkok
TICKET_HOURS_START=21
TICKET_HOURS_END=24
```

Optional for Render or health checks:

```env
PORT=
HEALTH_SERVER_ENABLED=false
HEALTH_HOST=0.0.0.0
HEALTH_CHECK_PATH=/healthz
```

Notes:

- `DATABASE_URL` can point to Neon or Supabase. No code change is required.
- If your provider returns a self-signed certificate chain in Node, set `PG_SSL_REJECT_UNAUTHORIZED=false`.
- Render sets `PORT` automatically.
- Local runs do not need `PORT`.

## Local setup

Install dependencies:

```bash
npm install
```

Apply schema to your Postgres database:

```bash
npm run db:init
```

Register slash commands:

```bash
npm run register:commands
```

Run the bot locally:

```bash
npm run dev
```

If you want to test the health endpoint locally:

```bash
$env:HEALTH_SERVER_ENABLED="true"
$env:PORT="3000"
npm run dev
```

Then open `http://localhost:3000/healthz`.

## Render deploy

This repo includes [`render.yaml`](/e:/0xoKITSU-ticket-bot/render.yaml) for a Node web service deploy.

Recommended Render settings:

- Service type: `Web Service`
- Plan: `Free`
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Health check path: `/healthz`

Set these environment variables in Render:

- `DISCORD_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DATABASE_URL`
- `TICKET_TIMEZONE`
- `TICKET_HOURS_START`
- `TICKET_HOURS_END`

You do not need to set `PORT` manually on Render.

## External Postgres

### Neon

Use the normal Postgres connection string from the Neon dashboard as `DATABASE_URL`.

Typical format:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DB_NAME?sslmode=require
```

### Supabase

Use the direct Postgres connection string from the Supabase project settings as `DATABASE_URL`.

Typical format:

```env
DATABASE_URL=postgresql://postgres:PASSWORD@HOST.supabase.co:5432/postgres?sslmode=require
```

For both Neon and Supabase:

1. Create the database first
2. Put the connection string into `.env` or Render env vars
3. Run `npm run db:init`

## Render plus local fallback

Render free web services can sleep when idle. Because of that, the simplest fallback is:

1. Keep Render connected for normal use
2. Keep the same `.env` values locally
3. If Render sleeps or becomes unreliable, stop the Render service and run:

```bash
npm run dev
```

Because both environments use the same external Postgres database, your panel config and ticket data stay in one place.

Important:

- Do not run local and Render at the same time against the same bot token unless you intentionally want two bot processes competing for gateway events.
- For fallback, only one runtime should be active at a time.

## Commands

- `/panel create`
- `/panel add-option`
- `/panel publish`
- `/panel list`
- `/panel disable`
- `/config set-log-channel`
- `/ticket claim`
- `/ticket close`
- `/ticket add-member`
- `/ticket remove-member`

## Close behavior

When a ticket is closed, the bot now:

1. Generates the transcript
2. Sends the transcript to the configured log channel
3. Deletes the ticket channel permanently

Because the channel is deleted, `reopen` is no longer supported in practice.

## Health endpoint

When the health server is enabled, the bot exposes:

- `GET /healthz`

It returns JSON with:

- Discord readiness
- Database connectivity
- Uptime

The endpoint returns:

- `200` when Discord and Postgres are both ready
- `503` when one of them is not ready yet

## Checks

```bash
npm run build
npm test
```
