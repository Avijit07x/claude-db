import type { Pool } from './driver.js';
import { SCHEMA_VERSION, TSV_EXPRESSION } from './schema.js';

export async function readMeta(pool: Pool): Promise<{
  version: number;
  vectorEnabled: boolean;
  vectorDims: number | null;
} | null> {
  try {
    const res = await pool.query(
      'SELECT version, vector_enabled, vector_dims FROM claude_db_meta WHERE id = 1',
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      version: Number(row['version']),
      vectorEnabled: row['vector_enabled'] === true,
      vectorDims: row['vector_dims'] == null ? null : Number(row['vector_dims']),
    };
  } catch {
    return null;
  }
}

export async function ensureTagsIndexed(pool: Pool): Promise<void> {
  const res = await pool.query(
    `SELECT pg_get_expr(d.adbin, d.adrelid) AS expr
       FROM pg_attrdef d
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'observations'::regclass AND a.attname = 'tsv'`,
  );
  const expr = String(res.rows[0]?.['expr'] ?? '');
  if (expr.length === 0 || expr.includes('tags')) return;

  await pool.query('ALTER TABLE observations DROP COLUMN tsv');
  await pool.query(
    `ALTER TABLE observations
         ADD COLUMN tsv TSVECTOR GENERATED ALWAYS AS (${TSV_EXPRESSION}) STORED`,
  );
  await pool.query('CREATE INDEX IF NOT EXISTS idx_obs_tsv ON observations USING GIN(tsv)');
}

export async function readVectorDims(pool: Pool): Promise<number | null> {
  const res = await pool.query(
    `SELECT atttypmod AS dims FROM pg_attribute
       WHERE attrelid = 'observations'::regclass
         AND attname = 'embedding' AND NOT attisdropped`,
  );
  const dims = Number(res.rows[0]?.['dims'] ?? -1);
  return dims > 0 ? dims : null;
}

export async function tryEnableVector(pool: Pool): Promise<boolean> {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    return true;
  } catch {
    return false;
  }
}

export async function writeMeta(
  pool: Pool,
  vectorEnabled: boolean,
  vectorDims: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO claude_db_meta (id, version, vector_enabled, vector_dims)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         version        = EXCLUDED.version,
         vector_enabled = EXCLUDED.vector_enabled,
         vector_dims    = EXCLUDED.vector_dims`,
    [SCHEMA_VERSION, vectorEnabled, vectorDims],
  );
}
