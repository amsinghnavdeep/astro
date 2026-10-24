PRAGMA defer_foreign_keys = true;

CREATE TABLE coupons_new (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'chats', 'plan')),
  value INTEGER NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_on TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO coupons_new (code, kind, value, max_uses, uses, expires_on, enabled, note, created_by, created_at)
SELECT code, kind, value, max_uses, uses, expires_on, enabled, note, created_by, created_at FROM coupons;

CREATE TABLE coupon_redemptions_new (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES coupons_new(code),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  value INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'pending')),
  created_at TEXT NOT NULL,
  used_at TEXT,
  UNIQUE (code, user_id)
);
INSERT INTO coupon_redemptions_new (id, code, user_id, kind, value, status, created_at, used_at)
SELECT id, code, user_id, kind, value, status, created_at, used_at FROM coupon_redemptions;

DROP TABLE coupon_redemptions;
ALTER TABLE coupon_redemptions_new RENAME TO coupon_redemptions;
DROP TABLE coupons;
ALTER TABLE coupons_new RENAME TO coupons;
CREATE INDEX coupon_redemptions_user ON coupon_redemptions (user_id, status);

CREATE TRIGGER coupon_plan_redemption_finalize
AFTER UPDATE OF status ON coupon_redemptions
WHEN OLD.kind = 'plan' AND NEW.kind = 'plan' AND OLD.status = 'pending' AND NEW.status = 'used'
BEGIN
  UPDATE coupons SET uses = uses + 1
  WHERE code = NEW.code AND (max_uses IS NULL OR uses < max_uses);
END;
