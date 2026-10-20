-- Influencer payouts are requested by the influencer and paid by hand (PayPal / Interac), not Stripe Connect.
ALTER TABLE payouts ADD COLUMN status TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE payouts ADD COLUMN method TEXT;
ALTER TABLE payouts ADD COLUMN pay_to TEXT;
ALTER TABLE payouts ADD COLUMN paid_at TEXT;
UPDATE payouts SET paid_at = created_at WHERE paid_at IS NULL;
CREATE UNIQUE INDEX payouts_one_open ON payouts (code) WHERE status = 'requested';
