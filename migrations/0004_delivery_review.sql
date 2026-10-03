ALTER TABLE discord_deliveries ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE discord_deliveries ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discord_deliveries ADD COLUMN review_id TEXT;
CREATE TABLE discord_delivery_reviews (id TEXT PRIMARY KEY, delivery_key TEXT NOT NULL REFERENCES discord_deliveries(key), action TEXT NOT NULL CHECK(action IN ('MARK_SENT','DISMISS','RETRY')), created_at INTEGER NOT NULL);
CREATE INDEX discord_due ON discord_deliveries(status,next_attempt_at);
UPDATE discord_deliveries SET status='FAILED',last_error='Retry limit reached' WHERE status='PENDING' AND attempts>=4;
