import type { CodeEdge, CodeSymbol, ScannedFile } from '../../types.js';
import type { GraphRows } from '../adapter.js';
import type { Statement, Value } from './driver.js';

const ROWS_PER_STATEMENT = 2000;
const LISTED = 'IN (SELECT value FROM json_each(?))';

interface Table<T> {
  name: string;
  key: string;
  idColumn: string;
  fileColumn: string;
  columns: string[];
  id: (row: T) => string;
  project: (row: T) => string;
  values: (row: T) => unknown[];
}

const SYMBOLS: Table<CodeSymbol> = {
  name: 'symbols',
  key: 'id',
  idColumn: 'id',
  fileColumn: 'file',
  columns: ['id', 'name', 'kind', 'file', 'line', 'lang', 'signature'],
  id: (s) => s.id,
  project: (s) => s.project,
  values: (s) => [s.id, s.name, s.kind, s.file, s.line, s.lang, s.signature],
};

const EDGES: Table<CodeEdge> = {
  name: 'symbol_edges',
  key: 'id',
  idColumn: 'id',
  fileColumn: 'file',
  columns: [
    'id',
    'src_id',
    'src_name',
    'dst_id',
    'dst_name',
    'relation',
    'confidence',
    'score',
    'file',
    'line',
  ],
  id: (e) => e.id,
  project: (e) => e.project,
  values: (e) => [
    e.id,
    e.srcId,
    e.srcName,
    e.dstId,
    e.dstName,
    e.relation,
    e.confidence,
    e.score,
    e.file,
    e.line,
  ],
};

const FILES: Table<ScannedFile> = {
  name: 'scanned_files',
  key: 'project, path',
  idColumn: 'path',
  fileColumn: 'path',
  columns: ['path', 'hash', 'scanned_at'],
  id: (f) => f.path,
  project: (f) => f.project,
  values: (f) => [f.path, f.hash, f.scannedAt],
};

function upsertSql<T>(table: Table<T>): string {
  const keys = new Set(table.key.split(', '));
  const updated = ['project', ...table.columns].filter((column) => !keys.has(column));
  const picks = table.columns.map((_, i) => `value->>${i}`).join(', ');
  return `INSERT INTO ${table.name} (project, ${table.columns.join(', ')})
          SELECT ?, ${picks} FROM json_each(?) WHERE true
          ON CONFLICT (${table.key}) DO UPDATE SET
            ${updated.map((column) => `${column} = excluded.${column}`).join(', ')}
          WHERE ${updated.map((column) => `${table.name}.${column} IS NOT excluded.${column}`).join(' OR ')}`;
}

function byProject<T>(table: Table<T>, rows: T[]): Map<string, T[]> {
  const groups = new Map<string, Map<string, T>>();
  for (const row of rows) {
    const project = table.project(row);
    const group = groups.get(project) ?? new Map<string, T>();
    group.set(table.id(row), row);
    groups.set(project, group);
  }
  return new Map([...groups].map(([project, group]) => [project, [...group.values()]]));
}

function upserts<T>(table: Table<T>, rows: T[]): Statement[] {
  const sql = upsertSql(table);
  const statements: Statement[] = [];
  for (const [project, group] of byProject(table, rows)) {
    const values = group.map(table.values);
    for (let i = 0; i < values.length; i += ROWS_PER_STATEMENT) {
      statements.push({
        sql,
        args: [project, JSON.stringify(values.slice(i, i + ROWS_PER_STATEMENT))],
      });
    }
  }
  return statements;
}

export function writeStatements(scan: GraphRows): Statement[] {
  return [
    ...upserts(SYMBOLS, scan.symbols),
    ...upserts(EDGES, scan.edges),
    ...upserts(FILES, scan.files),
  ];
}

function scoped<T>(table: Table<T>, project: string, files: string[] | null): Statement {
  const args: Value[] = files === null ? [project] : [project, JSON.stringify(files)];
  const where = files === null ? 'project = ?' : `project = ? AND ${table.fileColumn} ${LISTED}`;
  return { sql: `DELETE FROM ${table.name} WHERE ${where}`, args };
}

export function deleteStatements(project: string, files: string[] | null): Statement[] {
  return [
    scoped(SYMBOLS, project, files),
    scoped(EDGES, project, files),
    scoped(FILES, project, files),
  ];
}

function stale<T>(table: Table<T>, project: string, files: string[] | null, rows: T[]): Statement {
  const statement = scoped(table, project, files);
  const kept = rows.filter((row) => table.project(row) === project).map(table.id);
  return {
    sql: `${statement.sql} AND ${table.idColumn} NOT ${LISTED}`,
    args: [...statement.args, JSON.stringify(kept)],
  };
}

export function staleDeletes(
  project: string,
  files: string[] | null,
  scan: GraphRows,
): Statement[] {
  return [
    stale(SYMBOLS, project, files, scan.symbols),
    stale(EDGES, project, files, scan.edges),
    stale(FILES, project, files, scan.files),
  ];
}
