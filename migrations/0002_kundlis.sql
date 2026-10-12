-- Saved birth charts ("Kundlis") a customer can pick for a consultation or a single question.
CREATE TABLE kundlis (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  full_name TEXT NOT NULL,
  is_newborn INTEGER NOT NULL DEFAULT 0,
  gender TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  time_of_birth TEXT NOT NULL,
  place_of_birth TEXT NOT NULL,
  timezone TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX kundlis_user ON kundlis(user_id, deleted_at);
ALTER TABLE threads ADD COLUMN kundli_id TEXT;
