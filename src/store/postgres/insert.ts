import type { Pool, PoolClient } from './driver.js';
import type { Observation } from '../../types.js';

const COLUMNS = [
  'id',
  'session_id',
  'project',
  'kind',
  'title',
  'body',
  'files',
  'tags',
  'created_at',
  'embedder',
  'author',
  'status',
];

const ROWS_PER_STATEMENT = 400;

const KEEP_CLOSED = `status = CASE
    WHEN observations.status = 'done' AND EXCLUDED.status = 'open'
         AND observations.files = EXCLUDED.files THEN observations.status
    ELSE EXCLUDED.status END`;

interface Shape {
  vectorStored: boolean;
  vectorKept: boolean;
}

interface Statement {
  sql: string;
  values: unknown[];
}

function rowValues(obs: Observation, shape: Shape): unknown[] {
  const values: unknown[] = [
    obs.id,
    obs.sessionId,
    obs.project,
    obs.kind,
    obs.title,
    obs.body,
    JSON.stringify(obs.files),
    JSON.stringify(obs.tags),
    obs.createdAt,
    shape.vectorStored ? (obs.embedder ?? null) : null,
    obs.author ?? null,
    obs.status ?? 'done',
  ];
  if (shape.vectorStored && obs.embedding) values.push(`[${obs.embedding.join(',')}]`);
  return values;
}

function statement(rows: Observation[], shape: Shape, clearVector: boolean): Statement {
  const columns = shape.vectorStored ? [...COLUMNS, 'embedding'] : COLUMNS;
  const values: unknown[] = [];
  const tuples = rows.map((obs) => {
    const start = values.length;
    values.push(...rowValues(obs, shape));
    return `(${columns.map((_, i) => `$${start + i + 1}`).join(', ')})`;
  });
  const updates = columns
    .slice(1)
    .filter((column) => !(shape.vectorKept && column === 'embedder'))
    .map((column) => (column === 'status' ? KEEP_CLOSED : `${column} = EXCLUDED.${column}`))
    .concat(clearVector ? ['embedding = NULL'] : [])
    .join(', ');
  return {
    sql: `INSERT INTO observations (${columns.join(', ')}) VALUES ${tuples.join(', ')}
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values,
  };
}

function lastPerId(observations: Observation[]): Observation[] {
  return [...new Map(observations.map((obs) => [obs.id, obs])).values()];
}

function insertStatements(
  observations: Observation[],
  width: number | undefined,
  vectors: boolean,
  hasVectorColumn: boolean,
): Statement[] {
  const groups = new Map<string, { shape: Shape; rows: Observation[] }>();
  for (const obs of lastPerId(observations)) {
    const shape: Shape = {
      vectorStored: vectors && obs.embedding?.length === width,
      vectorKept: !obs.embedding?.length && obs.embedder != null,
    };
    const id = `${shape.vectorStored}:${shape.vectorKept}`;
    const group = groups.get(id) ?? { shape, rows: [] };
    group.rows.push(obs);
    groups.set(id, group);
  }

  const statements: Statement[] = [];
  for (const { shape, rows } of groups.values()) {
    const clearVector = !shape.vectorStored && !shape.vectorKept && (hasVectorColumn || vectors);
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      statements.push(statement(rows.slice(i, i + ROWS_PER_STATEMENT), shape, clearVector));
    }
  }
  return statements;
}

async function inTransaction(pool: Pool, statements: Statement[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { sql, values } of statements) await client.query(sql, values);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function insertObservations(
  pool: Pool,
  ensureVectorColumn: (dims: number) => Promise<boolean>,
  observations: Observation[],
  hasVectorColumn = false,
): Promise<void> {
  if (observations.length === 0) return;

  const width = observations.find((obs) => obs.embedding?.length)?.embedding?.length;
  const vectors = width !== undefined && (await ensureVectorColumn(width));
  const statements = insertStatements(observations, width, vectors, hasVectorColumn);

  const [only] = statements;
  if (statements.length === 1 && only) {
    await pool.query(only.sql, only.values);
    return;
  }
  await inTransaction(pool, statements);
}
