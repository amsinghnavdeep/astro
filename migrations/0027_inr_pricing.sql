ALTER TABLE users ADD COLUMN currency TEXT CHECK (currency IN ('usd', 'inr'));
ALTER TABLE subscriptions ADD COLUMN currency TEXT NOT NULL DEFAULT 'usd';

UPDATE users SET currency = 'usd' WHERE id IN (SELECT user_id FROM payments);
