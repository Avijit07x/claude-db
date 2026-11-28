import type { Observation } from '../../types.js';
import type { Client, Statement, Value } from './driver.js';
import { run } from './driver.js';
import { packVector } from '../../util/vector.js';
import { scopeToken } from '../../util/scope.js';

const COLUMNS = [
  'id',
  'session_id',
  'project',
  'scope',
  'kind',
  'title',
  'body',
  'files',
  'tags',
  'created_at',
  'author',
  'status',
  'embedding',
  'embedder',
];

const ROWS_PER_STATEMENT = 200;

const KEEP_CLOSED = `CASE
    WHEN observations.status = 'done' AND excluded.status = 'open'
         AND observations.files = excluded.files THEN observations.status
    ELSE excluded.status END`;

function updateClause(keepVector: boolean): string {
  const columns = COLUMNS.slice(1).filter(
    (column) => !(keepVector && (column === 'embedding' || column === 'embedder')),
  );
  const sets = columns.map((column) =>
    column === 'status' ? `status = ${KEEP_CLOSED}` : `${column} = excluded.${column}`,
  );
  const changed = columns
    .map((column) => `observations.${column} IS NOT excluded.${column}`)
    .join(' OR ');
  return `ON CONFLICT (id) DO UPDATE SET ${sets.join(', ')} WHERE ${changed}`;
}

function rowValues(obs: Observation): Value[] {
  const vector = obs.embedding?.length ? packVector(obs.embedding) : null;
  return [
    obs.id,
    obs.sessionId,
    obs.project,
    scopeToken(obs.project),
    obs.kind,
    obs.title,
    obs.body,
    JSON.stringify(obs.files),
    JSON.stringify(obs.tags),
    obs.createdAt,
    obs.author ?? null,
    obs.status ?? 'done',
    vector,
    vector ? (obs.embedder ?? null) : null,
  ];
}

function statement(rows: Observation[], keepVector: boolean): Statement {
  const tuple = `(${COLUMNS.map(() => '?').join(', ')})`;
  return {
    sql: `INSERT INTO observations (${COLUMNS.join(', ')})
          VALUES ${rows.map(() => tuple).join(', ')}
          ${updateClause(keepVector)}`,
    args: rows.flatMap(rowValues),
  };
}

function lastPerId(observations: Observation[]): Observation[] {
  return [...new Map(observations.map((obs) => [obs.id, obs])).values()];
}

export function insertStatements(observations: Observation[]): Statement[] {
  const kept: Observation[] = [];
  const written: Observation[] = [];
  for (const obs of lastPerId(observations)) {
    (!obs.embedding?.length && obs.embedder != null ? kept : written).push(obs);
  }
  const statements: Statement[] = [];
  for (const [rows, keepVector] of [
    [written, false],
    [kept, true],
  ] as const) {
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      statements.push(statement(rows.slice(i, i + ROWS_PER_STATEMENT), keepVector));
    }
  }
  return statements;
}

export async function insertObservations(
  client: Client,
  observations: Observation[],
): Promise<void> {
  if (observations.length === 0) return;
  await run(client, insertStatements(observations));
}
