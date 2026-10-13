-- One free reading per device and a daily cap per connection (hashed keys only).
CREATE TABLE free_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('device', 'ip')),
  key_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX free_claims_device_uq ON free_claims(key_hash) WHERE kind = 'device';
CREATE INDEX free_claims_kind_key_idx ON free_claims(kind, key_hash, created_at);
