import type { MemoryStore } from '../../store/index.js';
import { createStore } from '../../store/index.js';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../../config/index.js';
import { redact } from '../../capture/index.js';

export async function cmdUse(argv: (string | undefined)[]): Promise<void> {
  const force = argv.includes('--force');
  const uri = argv.find((arg) => typeof arg === 'string' && !arg.startsWith('-'));

  if (!uri) {
    console.error('Usage: claude-db use [--force] <connection-string>');
    process.exit(1);
  }

  let kind = '';
  let foreign: string[] = [];
  let rows = 0;
  try {
    const store = await createStore(uri);
    try {
      if (!(await store.ping())) throw new Error('connected, but it did not answer a ping');
      kind = store.kind;
      foreign = await store.inventory();
      await store.init();
      rows = await countObservations(store);
    } finally {
      await store.close();
    }
  } catch (error) {
    console.error(`Could not reach that database: ${describe(error)}`);
    if (!force) {
      console.error('\nNothing was changed; memory still uses the previous database.');
      console.error('Re-run with --force to save it anyway.');
      process.exit(1);
    }
  }

  const config = loadConfig();
  const previous = config.database;
  config.database = uri;
  saveConfig(config);
  console.log(kind ? `Connected. Using ${kind}.` : 'Saved, unverified.');

  if (foreign.length > 0) {
    const shown = foreign.slice(0, 6).join(', ');
    console.log(
      `\nNote: this database already holds ${foreign.length} other table(s)/collection(s):`,
    );
    console.log(`  ${shown}${foreign.length > 6 ? ', ...' : ''}`);
    console.log('claude-db has added its own next to them. An application database is a');
    console.log('poor place to keep memory; point it elsewhere if that was not deliberate.');
  }
  if (kind && rows === 0) await warnAboutStranding(previous, uri);
}

async function countObservations(store: {
  listProjects: MemoryStore['listProjects'];
}): Promise<number> {
  return (await store.listProjects()).reduce((total, entry) => total + entry.observations, 0);
}

async function warnAboutStranding(previous: string, uri: string): Promise<void> {
  if (!previous || previous === uri) return;

  let stranded = 0;
  try {
    const store = await createStore(previous);
    try {
      await store.init();
      stranded = await countObservations(store);
    } finally {
      await store.close();
    }
  } catch {
    return;
  }
  if (stranded === 0) return;

  console.log(`\nThe database you just left (${redact(previous)})`);
  console.log(`still holds ${stranded} observation(s), and this one is empty. Nothing moves`);
  console.log('across on its own:');
  console.log('  claude-db use <the previous url> && claude-db export --all > memory.jsonl');
  console.log('  claude-db use <this url>         && claude-db import memory.jsonl');
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
    return `${message}\n(that host does not resolve — check the name, or whether the service still exists)`;
  }
  if (
    /self[- ]signed certificate|unable to verify the first certificate|SELF_SIGNED_CERT/i.test(
      message,
    )
  ) {
    return (
      `${message}\n(managed Postgres signs with its own CA, which node does not trust by ` +
      `default —\n append &sslmode=no-verify to the URL, or point &sslrootcert= at the CA ` +
      `file\n the provider gives you)`
    );
  }
  return message;
}
