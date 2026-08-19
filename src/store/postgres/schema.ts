export const TSV_EXPRESSION = `
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(tags::text, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(body, '')), 'C')`;

export const SCHEMA_VERSION = 3;

export const DDL = `
      CREATE TABLE IF NOT EXISTS claude_db_meta (
        id             INT PRIMARY KEY,
        version        INT     NOT NULL,
        vector_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        vector_dims    INT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        project    TEXT   NOT NULL,
        started_at BIGINT NOT NULL,
        ended_at   BIGINT,
        summary    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_project
        ON sessions(project, started_at DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id         TEXT PRIMARY KEY,
        session_id TEXT   NOT NULL,
        project    TEXT   NOT NULL,
        kind       TEXT   NOT NULL,
        title      TEXT   NOT NULL,
        body       TEXT   NOT NULL,
        files      JSONB  NOT NULL DEFAULT '[]'::jsonb,
        tags       JSONB  NOT NULL DEFAULT '[]'::jsonb,
        created_at BIGINT NOT NULL,
        embedder   TEXT,
        author     TEXT,
        tsv        TSVECTOR GENERATED ALWAYS AS (${TSV_EXPRESSION}) STORED
      );
      CREATE INDEX IF NOT EXISTS idx_obs_tsv ON observations USING GIN(tsv);
      CREATE INDEX IF NOT EXISTS idx_obs_project_time
        ON observations(project, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_tags ON observations USING GIN(tags);

      ALTER TABLE observations ADD COLUMN IF NOT EXISTS embedder TEXT;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS author   TEXT;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS status   TEXT NOT NULL DEFAULT 'done';

      CREATE TABLE IF NOT EXISTS symbols (
        id        TEXT PRIMARY KEY,
        project   TEXT   NOT NULL,
        name      TEXT   NOT NULL,
        kind      TEXT   NOT NULL,
        file      TEXT   NOT NULL,
        line      INT    NOT NULL,
        lang      TEXT   NOT NULL,
        signature TEXT   NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_lookup ON symbols(project, name);
      CREATE INDEX IF NOT EXISTS idx_symbols_file   ON symbols(project, file);

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
        line       INT  NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edges_src  ON symbol_edges(project, src_id);
      CREATE INDEX IF NOT EXISTS idx_edges_dst  ON symbol_edges(project, dst_id);
      CREATE INDEX IF NOT EXISTS idx_edges_file ON symbol_edges(project, file);

      CREATE TABLE IF NOT EXISTS scanned_files (
        project    TEXT   NOT NULL,
        path       TEXT   NOT NULL,
        hash       TEXT   NOT NULL,
        scanned_at BIGINT NOT NULL,
        PRIMARY KEY (project, path)
      );
`;
