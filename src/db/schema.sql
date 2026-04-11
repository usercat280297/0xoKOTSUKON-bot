CREATE TABLE IF NOT EXISTS guild_configs (
  guild_id TEXT PRIMARY KEY,
  log_channel_id TEXT NULL,
  closed_category_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_panels (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NULL,
  placeholder TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'default',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ticket_panels
  ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'default';

CREATE TABLE IF NOT EXISTS ticket_options (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL REFERENCES ticket_panels(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT NULL,
  board_section TEXT NULL,
  stock_remaining INTEGER NULL,
  stock_total INTEGER NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required_role_id TEXT NOT NULL,
  redirect_channel_id TEXT NOT NULL,
  target_category_id TEXT NOT NULL,
  staff_role_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(panel_id, value)
);

ALTER TABLE ticket_options
  ADD COLUMN IF NOT EXISTS board_section TEXT NULL;

ALTER TABLE ticket_options
  ADD COLUMN IF NOT EXISTS stock_remaining INTEGER NULL;

ALTER TABLE ticket_options
  ADD COLUMN IF NOT EXISTS stock_total INTEGER NULL;

ALTER TABLE ticket_options
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ticket_options_panel_sort_idx
  ON ticket_options(panel_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  option_id TEXT NOT NULL REFERENCES ticket_options(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  original_category_id TEXT NULL,
  claimed_by TEXT NULL,
  closed_by TEXT NULL,
  closed_at TIMESTAMPTZ NULL,
  transcript_message_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_open_per_user_idx
  ON tickets(guild_id, user_id)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
