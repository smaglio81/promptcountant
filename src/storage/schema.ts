export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  hash             TEXT PRIMARY KEY,
  display_name     TEXT NOT NULL,
  workspace_path   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id         TEXT PRIMARY KEY,
  workspace_hash     TEXT NOT NULL REFERENCES workspaces(hash),
  display_name       TEXT NOT NULL,
  created_at         INTEGER,
  updated_at         INTEGER,
  chat_sessions_path TEXT NOT NULL DEFAULT '',
  telemetry_disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turns (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id              TEXT    NOT NULL REFERENCES sessions(session_id),
  request_id              TEXT    NOT NULL,
  timestamp               INTEGER,
  model_id                TEXT,
  resolved_model          TEXT,
  completion_tokens       INTEGER,
  estimated_prompt_tokens INTEGER,
  cache_eligible_tokens   INTEGER NOT NULL DEFAULT 0,
  elapsed_ms              INTEGER,
  message_text            TEXT,
  estimated_cost          REAL,
  is_completed            INTEGER NOT NULL DEFAULT 0,
  UNIQUE(session_id, request_id)
);

CREATE TABLE IF NOT EXISTS pricing_cache (
  model              TEXT    PRIMARY KEY,
  input_per_m        REAL    NOT NULL,
  cached_input_per_m REAL    NOT NULL,
  output_per_m       REAL    NOT NULL,
  cache_write_per_m  REAL,
  fetched_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_files (
  file_path     TEXT    PRIMARY KEY,
  last_modified INTEGER NOT NULL,
  processed_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_hash);
CREATE INDEX IF NOT EXISTS idx_turns_session      ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_timestamp    ON turns(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_updated   ON sessions(updated_at DESC);
`;
