-- Aggregate funnel counts only: one row per event per day, no user identifiers.
CREATE TABLE event_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event)
);

-- Emails typed into the sign-in form; only marketing_opt_in = 1 rows may ever be emailed.
CREATE TABLE email_leads (
  email TEXT PRIMARY KEY,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  signed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
