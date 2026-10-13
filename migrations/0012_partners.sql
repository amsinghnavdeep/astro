-- Affiliates (friend referrals) and influencer codes with first-paid-consultation commission.
ALTER TABLE users ADD COLUMN ref_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN referred_code TEXT;
CREATE UNIQUE INDEX users_ref_code ON users (ref_code);
CREATE INDEX users_referred_by ON users (referred_by);
CREATE INDEX users_referred_code ON users (referred_code);

CREATE TABLE referral_rewards (
  friend_id TEXT PRIMARY KEY,
  referrer_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX referral_rewards_referrer ON referral_rewards (referrer_id, created_at);

CREATE TABLE influencers (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  percent INTEGER NOT NULL DEFAULT 10,
  stripe_account_id TEXT,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE partner_clicks (
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, day)
);

-- One row per referred customer: their first paid consultation only.
CREATE TABLE commissions (
  customer_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  base_cents INTEGER NOT NULL,
  commission_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  payout_id TEXT,
  created_at TEXT NOT NULL,
  available_at TEXT NOT NULL
);
CREATE INDEX commissions_code ON commissions (code, status, available_at);

CREATE TABLE payouts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  stripe_transfer_id TEXT,
  period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (code, period)
);
