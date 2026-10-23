ALTER TABLE users ADD COLUMN phone_e164 TEXT;
ALTER TABLE users ADD COLUMN phone_verified_at TEXT;
CREATE UNIQUE INDEX users_phone_e164_unique ON users(phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  pending_plan TEXT,
  status TEXT NOT NULL,
  trial_end TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  paused_until TEXT,
  pause_starts_at TEXT,
  consults_left INTEGER NOT NULL DEFAULT 0,
  last_invoice_id TEXT,
  had_trial INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE trial_marks (
  kind TEXT NOT NULL CHECK (kind IN ('phone', 'card')),
  value TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);

CREATE TABLE subscription_usages (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  stripe_subscription_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX subscription_usages_user_idx ON subscription_usages(user_id, created_at);

CREATE TABLE subscription_trial_claims (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE subscription_invoices (
  stripe_invoice_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE subscription_trial_emails (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER subscription_usage_decrement
AFTER INSERT ON subscription_usages
BEGIN
  UPDATE subscriptions SET consults_left = consults_left - 1, updated_at = NEW.created_at
  WHERE user_id = NEW.user_id AND stripe_subscription_id = NEW.stripe_subscription_id AND consults_left > 0;
END;

CREATE TABLE phone_otp_sends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX phone_otp_sends_user_idx ON phone_otp_sends(user_id, created_at);

CREATE TABLE subscription_cancellations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT,
  note TEXT,
  offer_taken TEXT NOT NULL CHECK (offer_taken IN ('pause', 'basic', 'cancel')),
  created_at TEXT NOT NULL
);
CREATE INDEX subscription_cancellations_user_idx ON subscription_cancellations(user_id, created_at);

CREATE TABLE payments_new (
  stripe_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  thread_id TEXT REFERENCES threads(id),
  kind TEXT NOT NULL CHECK (kind IN ('consultation', 'topup', 'api_credits', 'subscription')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0
);
INSERT INTO payments_new (stripe_session_id, user_id, thread_id, kind, amount_cents, currency, created_at, auto)
SELECT stripe_session_id, user_id, thread_id, kind, amount_cents, currency, created_at, auto FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX payments_user_auto ON payments (user_id, auto, created_at);
