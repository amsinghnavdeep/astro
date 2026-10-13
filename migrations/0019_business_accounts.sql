-- Business accounts: switched on by a $100+ wallet payment; get API keys and 10% lower chat prices, paid from the wallet.
ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'personal' CHECK (account_type IN ('personal', 'business'));
ALTER TABLE users ADD COLUMN business_name TEXT;
ALTER TABLE users ADD COLUMN tax_id TEXT;
UPDATE users SET account_type = 'business'
WHERE id IN (SELECT user_id FROM payments WHERE kind = 'api_credits');
