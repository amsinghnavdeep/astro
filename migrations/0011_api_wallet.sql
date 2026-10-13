-- API balance becomes a USD wallet in cents (was 1 credit = $5).
UPDATE api_credit_ledger SET delta = delta * 500;
ALTER TABLE users ADD COLUMN api_autorecharge_cents INTEGER NOT NULL DEFAULT 10000;
