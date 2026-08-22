import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext } from '../../context.js';
import type { RecallContext } from '../../context.js';
import { resolveProject } from '../../util/project.js';
import { toShortId } from '../../util/shortid.js';
import { renderPage } from './view-page.js';

export interface ViewData {
  project: string;
  database: string;
  scannedFiles: number;
  kinds: Record<string, number>;
  rules: { id: string; when: number; title: string }[];
  sessions: { when: number; summary: string }[];
  observations: { id: string; kind: string; when: number; title: string; files: number }[];
}

async function collect(ctx: RecallContext, project: string): Promise<ViewData> {
  const all = (await ctx.store.list({ project, limit: 500 })).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  const kinds: Record<string, number> = {};
  for (const obs of all) kinds[obs.kind] = (kinds[obs.kind] ?? 0) + 1;

  const rules = all
    .filter((obs) => obs.kind === 'preference')
    .sort((a, b) => {
      const manual = Number(b.sessionId === 'manual') - Number(a.sessionId === 'manual');
      return manual !== 0 ? manual : b.createdAt - a.createdAt;
    })
    .slice(0, 10)
    .map((obs) => ({ id: toShortId(obs.id), when: obs.createdAt, title: obs.title }));

  const sessions = (await ctx.store.recentSessions(project, 8)).map((session) => ({
    when: session.startedAt,
    summary: session.summary ?? '',
  }));

  return {
    project,
    database: ctx.config.database,
    scannedFiles: (await ctx.store.scannedFiles(project)).length,
    kinds,
    rules,
    sessions,
    observations: all.slice(0, 80).map((obs) => ({
      id: toShortId(obs.id),
      kind: obs.kind,
      when: obs.createdAt,
      title: obs.title,
      files: obs.files.length,
    })),
  };
}

export async function cmdView(args: (string | undefined)[]): Promise<void> {
  const project = resolveProject(undefined);
  const ctx = await createContext();

  const exportAt = args.indexOf('--export');
  if (exportAt >= 0) {
    const target = resolve(args[exportAt + 1] ?? 'claude-db-memory.html');
    writeFileSync(target, renderPage(await collect(ctx, project), false));
    await ctx.close();
    console.log(`Wrote snapshot to ${target}`);
    return;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/data') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(await collect(ctx, project)));
        return;
      }
      if (url.pathname === '/api/search') {
        const query = url.searchParams.get('q') ?? '';
        const entries = await ctx.search.search({ text: query, project, limit: 20 });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            entries.map((entry) => ({
              id: toShortId(entry.id),
              kind: entry.kind,
              when: entry.createdAt,
              title: entry.title,
            })),
          ),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderPage(await collect(ctx, project), true));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;
    console.log(`Viewing ${project}`);
    console.log(`  ${url}  (Ctrl+C to stop — nothing keeps running afterwards)`);
    if (process.platform === 'darwin') execFile('open', [url], () => {});
    else if (process.platform === 'linux') execFile('xdg-open', [url], () => {});
  });

  const stop = async (): Promise<void> => {
    server.close();
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
