-- Apply only to trading_office_db. Never apply to chart_db.
CREATE TABLE api_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  reset_at INTEGER NOT NULL
);
CREATE INDEX api_limits_expiry ON api_limits(reset_at);
