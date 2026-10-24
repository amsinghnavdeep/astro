PRAGMA defer_foreign_keys = true;

DROP TRIGGER IF EXISTS subscription_usage_decrement;
DROP INDEX IF EXISTS subscription_usages_user_idx;

CREATE TABLE subscription_usages_new (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  stripe_subscription_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO subscription_usages_new (id, thread_id, user_id, stripe_subscription_id, created_at)
SELECT 'thread:' || thread_id, thread_id, user_id, stripe_subscription_id, created_at
FROM subscription_usages;

DROP TABLE subscription_usages;
ALTER TABLE subscription_usages_new RENAME TO subscription_usages;

CREATE INDEX subscription_usages_user_idx ON subscription_usages(user_id, created_at);

CREATE TRIGGER subscription_usage_decrement
AFTER INSERT ON subscription_usages
BEGIN
  UPDATE subscriptions SET consults_left = consults_left - 1, updated_at = NEW.created_at
  WHERE user_id = NEW.user_id AND stripe_subscription_id = NEW.stripe_subscription_id AND consults_left > 0;
END;
