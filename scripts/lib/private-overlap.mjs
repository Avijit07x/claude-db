import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RUN = 6;
const GENERIC = [
  'another claude session',
  'image source tmp claude',
  'multiply coordinates by',
  'original image',
  'coordinates by 2 00',
  '2 00 to map',
  'to map to original',
  'base directory for this skill',
  'this session is being continued',
];

const words = (text) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

function runsOf(text) {
  const list = words(text);
  const runs = [];
  for (let i = 0; i + RUN <= list.length; i += 1) runs.push(list.slice(i, i + RUN).join(' '));
  return runs;
}

function userTexts(path) {
  const texts = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    const parts = typeof content === 'string' ? [content] : (content ?? []).map((p) => p?.text);
    for (const part of parts) {
      if (typeof part === 'string' && part.length < 3000 && !part.startsWith('<')) texts.push(part);
    }
  }
  return texts;
}

function transcriptFiles(root) {
  const found = [];
  let projects;
  try {
    projects = readdirSync(root);
  } catch {
    return found;
  }
  for (const project of projects) {
    const dir = join(root, project);
    try {
      if (!statSync(dir).isDirectory()) continue;
      for (const name of readdirSync(dir)) if (name.endsWith('.jsonl')) found.push(join(dir, name));
    } catch {
      continue;
    }
  }
  return found;
}

async function savedTexts() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(homedir(), '.claude-memory', 'memory.db'), { readOnly: true });
    return db
      .prepare('SELECT title, body FROM observations')
      .all()
      .map((row) => `${row.title}\n${row.body}`);
  } catch {
    return [];
  }
}

export async function findPrivateOverlap(texts) {
  const wanted = new Map();
  for (const [file, text] of texts) {
    for (const run of runsOf(text)) {
      if (GENERIC.some((phrase) => run.includes(phrase))) continue;
      if (!wanted.has(run)) wanted.set(run, new Set());
      wanted.get(run).add(file);
    }
  }
  const hits = new Map();
  const scan = (text) => {
    for (const run of runsOf(text)) {
      for (const file of wanted.get(run) ?? []) {
        const entry = hits.get(file) ?? { count: 0, example: run };
        entry.count += 1;
        hits.set(file, entry);
      }
    }
  };
  (await savedTexts()).forEach(scan);
  for (const path of transcriptFiles(join(homedir(), '.claude', 'projects'))) {
    userTexts(path).forEach(scan);
  }
  return [...hits].map(([file, { count, example }]) => ({ file, count, example }));
}
