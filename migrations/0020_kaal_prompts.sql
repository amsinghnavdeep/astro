-- Owner-editable Kaal answer style (current text lives in settings; every save is kept here).
CREATE TABLE kaal_prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX idx_kaal_prompt_history_key ON kaal_prompt_history (key, id);
