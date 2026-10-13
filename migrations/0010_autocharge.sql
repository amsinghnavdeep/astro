-- Saved card + auto-charge (chat) / auto-recharge (API). Both on by default; agreement time stored as dispute evidence.
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_pm_id TEXT;
ALTER TABLE users ADD COLUMN card_last4 TEXT;
ALTER TABLE users ADD COLUMN chat_autocharge INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN chat_autocharge_ack_at TEXT;
ALTER TABLE users ADD COLUMN api_autorecharge INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN api_autorecharge_credits INTEGER NOT NULL DEFAULT 10;
ALTER TABLE users ADD COLUMN api_autorecharge_cap_cents INTEGER NOT NULL DEFAULT 50000;
ALTER TABLE users ADD COLUMN api_autorecharge_ack_at TEXT;
ALTER TABLE payments ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS payments_user_auto ON payments (user_id, auto, created_at);
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY, ip TEXT, email TEXT NOT NULL, topic TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contact_messages_ip ON contact_messages (ip, created_at);
