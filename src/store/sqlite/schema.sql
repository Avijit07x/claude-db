PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  project    TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  summary    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project
  ON sessions(project, started_at DESC);

CREATE TABLE IF NOT EXISTS observations (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project    TEXT NOT NULL,
  -- Single opaque token identifying the project, indexed inside FTS so that
  -- scoping happens during the match rather than as a post-filter join.
  scope      TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  files      TEXT NOT NULL DEFAULT '[]',
  tags       TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  embedding  BLOB
);

CREATE INDEX IF NOT EXISTS idx_obs_project_time
  ON observations(project, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_kind
  ON observations(project, kind, created_at DESC);
-- Covers the vector candidate scan, which reads only these columns.
CREATE INDEX IF NOT EXISTS idx_obs_vector_scan
  ON observations(project, kind) WHERE embedding IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title, body, tags, scope,
  content='observations',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, body, tags, scope)
  VALUES (new.rowid, new.title, new.body, new.tags, new.scope);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, body, tags, scope)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.scope);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, body, tags, scope)
  VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.scope);
  INSERT INTO observations_fts(rowid, title, body, tags, scope)
  VALUES (new.rowid, new.title, new.body, new.tags, new.scope);
END;
