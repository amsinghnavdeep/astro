-- Owner emails sent from admin or the owner email API (one row per send).
CREATE TABLE email_broadcasts (
  id TEXT PRIMARY KEY,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'promo')),
  audience TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  via TEXT NOT NULL DEFAULT 'admin',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX email_broadcasts_created ON email_broadcasts (created_at);
