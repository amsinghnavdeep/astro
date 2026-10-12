-- Account-level chat question credits (bought in packs, expire CHAT_CREDIT_DAYS after purchase).
CREATE TABLE chat_credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  api_key_id TEXT,
  thread_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX chat_credit_ledger_user_idx ON chat_credit_ledger(user_id, created_at);
