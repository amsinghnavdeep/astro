-- Support tickets (customers raise, owner replies) and last-activity tracking for the admin dashboard.
ALTER TABLE users ADD COLUMN last_seen_at TEXT;

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  email TEXT NOT NULL,
  name TEXT,
  topic TEXT NOT NULL CHECK (topic IN ('prediction', 'payment', 'account', 'api', 'other')),
  subject TEXT NOT NULL,
  thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tickets_status_idx ON tickets(status, updated_at);
CREATE INDEX tickets_email_idx ON tickets(email, created_at);

CREATE TABLE ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  author TEXT NOT NULL CHECK (author IN ('customer', 'support')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages(ticket_id, created_at);
