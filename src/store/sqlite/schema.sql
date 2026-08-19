PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA recursive_triggers = ON;

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
  scope      TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  files      TEXT NOT NULL DEFAULT '[]',
  tags       TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  embedding  BLOB,
  embedder   TEXT,
  author     TEXT,
  status     TEXT NOT NULL DEFAULT 'done'
);

CREATE INDEX IF NOT EXISTS idx_obs_project_time
  ON observations(project, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_kind
  ON observations(project, kind, created_at DESC);
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

CREATE TABLE IF NOT EXISTS symbols (
  id        TEXT PRIMARY KEY,
  project   TEXT NOT NULL,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  file      TEXT NOT NULL,
  line      INTEGER NOT NULL,
  lang      TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_symbols_lookup ON symbols(project, name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(project, file);

CREATE TABLE IF NOT EXISTS symbol_edges (
  id         TEXT PRIMARY KEY,
  project    TEXT NOT NULL,
  src_id     TEXT NOT NULL,
  src_name   TEXT NOT NULL,
  dst_id     TEXT NOT NULL DEFAULT '',
  dst_name   TEXT NOT NULL,
  relation   TEXT NOT NULL,
  confidence TEXT NOT NULL,
  score      REAL NOT NULL DEFAULT 1.0,
  file       TEXT NOT NULL,
  line       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON symbol_edges(project, src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON symbol_edges(project, dst_id);
CREATE INDEX IF NOT EXISTS idx_edges_file ON symbol_edges(project, file);

CREATE TABLE IF NOT EXISTS scanned_files (
  project    TEXT NOT NULL,
  path       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  PRIMARY KEY (project, path)
);
