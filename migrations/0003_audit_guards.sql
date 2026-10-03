CREATE INDEX cases_source_day ON cases(source,created_at);
CREATE INDEX cases_mode_day ON cases(mode,created_at);
CREATE TRIGGER config_no_delete BEFORE DELETE ON trading_config_versions BEGIN SELECT RAISE(ABORT,'immutable config'); END;
CREATE TRIGGER prompt_no_delete BEFORE DELETE ON prompt_versions BEGIN SELECT RAISE(ABORT,'immutable prompt'); END;
