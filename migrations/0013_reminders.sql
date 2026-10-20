-- "Remind me" on prediction windows: one email when the window opens.
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  area TEXT NOT NULL,
  when_text TEXT NOT NULL,
  remind_on TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (thread_id, area, when_text)
);
CREATE INDEX reminders_due ON reminders (sent_at, remind_on);
