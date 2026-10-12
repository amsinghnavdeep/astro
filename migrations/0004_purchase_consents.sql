-- Record of the customer ticking the purchase disclaimer (evidence for payment disputes).
CREATE TABLE purchase_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  thread_id TEXT,
  stripe_session_id TEXT,
  disclaimer TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX purchase_consents_user_idx ON purchase_consents(user_id, created_at);
CREATE INDEX purchase_consents_session_idx ON purchase_consents(stripe_session_id);
