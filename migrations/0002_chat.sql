-- "Ask Pandit ji" live astrology chat: one thread per saved birth profile,
-- backed by a dedicated Devin session, plus a per-user question-credit ledger.
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  time_of_birth TEXT NOT NULL,
  place_of_birth TEXT NOT NULL,
  timezone TEXT NOT NULL,
  pandit TEXT NOT NULL,
  chart_text TEXT NOT NULL,
  devin_session_id TEXT,
  devin_cursor TEXT,
  status TEXT NOT NULL CHECK (status IN ('starting', 'active', 'failed')),
  acus_consumed REAL NOT NULL DEFAULT 0,
  last_synced_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_threads_user_id_idx ON chat_threads(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'pandit')),
  body TEXT NOT NULL,
  devin_event_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(thread_id, created_at);

-- Append-only credit ledger; balance = SUM(delta). `ref` makes grants and
-- debits idempotent (Stripe session id, message id, ...).
CREATE TABLE IF NOT EXISTS chat_credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_credit_ledger_user_idx ON chat_credit_ledger(user_id);
