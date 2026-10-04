-- Schema snapshot obtained with SELECT sqlite_schema; this is documentation.
-- Do not apply this file or any migrations/seeds to remote chart_db.

CREATE UNIQUE INDEX idx_candles_unique
  ON candles (symbol, timeframe, open_time);

CREATE INDEX idx_ingest_runs_created ON ingest_runs (id DESC);

CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      ) WITHOUT ROWID;

CREATE TABLE candle_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_candles INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE candles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  open_time   INTEGER NOT NULL,
  open        REAL NOT NULL,
  high        REAL NOT NULL,
  low         REAL NOT NULL,
  close       REAL NOT NULL,
  volume      REAL NOT NULL,
  created_at  INTEGER DEFAULT (unixepoch())
, source TEXT NOT NULL DEFAULT 'bybit', is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)));

CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ok_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
, errors TEXT);

CREATE TABLE pair_ingest_state (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  last_success_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, timeframe)
);

CREATE TRIGGER candles_stats_after_delete
AFTER DELETE ON candles
BEGIN
  UPDATE candle_stats SET total_candles = MAX(total_candles - 1, 0) WHERE id = 1;
END;

CREATE TRIGGER candles_stats_after_insert
AFTER INSERT ON candles
BEGIN
  UPDATE candle_stats SET total_candles = total_candles + 1 WHERE id = 1;
END;

