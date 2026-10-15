CREATE TABLE history_deletions (case_uuid TEXT PRIMARY KEY REFERENCES cases(uuid), deleted_at INTEGER NOT NULL);
