import { randomUUID } from 'node:crypto';

const RUN_ID = randomUUID().replace(/\D/g, '').slice(0, 8);

export const BASE_TIME = 1_700_000_000_000;
export const EMBEDDER = 'contract-model';

export const uniqueWord = (stem) => `${stem}${RUN_ID}`;

export const makeRow = (project, over = {}) => ({
  id: randomUUID(),
  sessionId: 'contract-chat',
  project,
  kind: 'context',
  title: 'contract row',
  body: 'contract body',
  files: [],
  tags: [],
  createdAt: BASE_TIME,
  ...over,
});

export const idsOf = (rows) => rows.map((row) => row.id);

export const sameIds = (actual, expected) =>
  actual.length === expected.length && expected.every((id) => actual.includes(id));

export const near = (actual = [], expected = []) =>
  actual.length === expected.length &&
  expected.every((value, index) => Math.abs(value - actual[index]) < 1e-6);

export async function inFreshProjects(store, label, count, run) {
  const projects = Array.from(
    { length: count },
    (_, index) => `/tmp/contract-${label}-${index}-${RUN_ID}`,
  );
  try {
    await run(...projects);
  } finally {
    for (const project of projects) await store.remove({ project });
  }
}

export async function hasAtlasVectorIndex(store) {
  return typeof store.hasAtlasVectorIndex === 'function' && (await store.hasAtlasVectorIndex());
}
