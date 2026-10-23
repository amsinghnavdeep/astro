-- Quick answers: one question pays for two quick answers; the unused half is banked on the thread.
-- renewed_at throttles replacing a stopped Kaal session.
ALTER TABLE threads ADD COLUMN quick_credit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN renewed_at INTEGER NOT NULL DEFAULT 0;
