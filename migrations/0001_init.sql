CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  free_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_tokens_email_idx ON login_tokens(email, created_at);

-- One consultation = one Devin session, open for a fixed window (default 7 days).
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  time_of_birth TEXT NOT NULL,
  place_of_birth TEXT NOT NULL,
  timezone TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'English',
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'api')),
  api_key_id TEXT,
  chart_text TEXT NOT NULL,
  first_question TEXT,
  devin_session_id TEXT,
  devin_cursor TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'starting', 'active', 'failed')),
  is_free INTEGER NOT NULL DEFAULT 0,
  questions_allowed INTEGER NOT NULL DEFAULT 0,
  questions_used INTEGER NOT NULL DEFAULT 0,
  acus_consumed REAL NOT NULL DEFAULT 0,
  last_synced_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at INTEGER
);
CREATE INDEX threads_user_idx ON threads(user_id, created_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'pandit')),
  body TEXT NOT NULL,
  devin_event_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX messages_thread_idx ON messages(thread_id, created_at);

-- Stripe Checkout sessions; primary key makes fulfillment idempotent.
CREATE TABLE payments (
  stripe_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  thread_id TEXT REFERENCES threads(id),
  kind TEXT NOT NULL CHECK (kind IN ('consultation', 'topup', 'api_credits')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Developer API: keys are stored hashed; only the prefix is kept for display.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_keys_user_idx ON api_keys(user_id);

-- Prepaid API credits (1 credit = 1 question). `ref` makes grants/spends idempotent.
CREATE TABLE api_credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  api_key_id TEXT,
  thread_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX api_credit_ledger_user_idx ON api_credit_ledger(user_id, created_at);
