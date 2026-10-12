-- AI support agent per ticket: adds 'forwarded' status and agent session tracking.
PRAGMA defer_foreign_keys = true;
CREATE TABLE tickets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  email TEXT NOT NULL,
  name TEXT,
  topic TEXT NOT NULL CHECK (topic IN ('prediction', 'payment', 'account', 'api', 'other')),
  subject TEXT NOT NULL,
  thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'forwarded', 'closed')),
  devin_session_id TEXT,
  devin_cursor TEXT,
  ai_replies INTEGER NOT NULL DEFAULT 0,
  last_synced_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO tickets_new (id, user_id, email, name, topic, subject, thread_id, status, created_at, updated_at)
  SELECT id, user_id, email, name, topic, subject, thread_id, status, created_at, updated_at FROM tickets;
DROP TABLE tickets;
ALTER TABLE tickets_new RENAME TO tickets;
CREATE INDEX tickets_status_idx ON tickets(status, updated_at);
CREATE INDEX tickets_email_idx ON tickets(email, created_at);
ALTER TABLE ticket_messages ADD COLUMN devin_event_id TEXT;
CREATE UNIQUE INDEX ticket_messages_event_idx ON ticket_messages(devin_event_id);
