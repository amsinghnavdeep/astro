-- Owner coupons: % off the next chat purchase, or free chats added on redeem. One redemption per person per code.
CREATE TABLE coupons (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'chats')),
  value INTEGER NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_on TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES coupons(code),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  value INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used')),
  created_at TEXT NOT NULL,
  used_at TEXT,
  UNIQUE (code, user_id)
);
CREATE INDEX coupon_redemptions_user ON coupon_redemptions (user_id, status);
