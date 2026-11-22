import { BASE_TIME, idsOf, inFreshProjects, makeRow, sameIds } from './contract-kit.mjs';

const WILDCARD_IDS = ['%', '_', '*', '?', '[0-9]', '.*', "a'b"];
const SHORT_ID_LENGTH = 8;
const CUTOFF = BASE_TIME;

const listIds = async (store, project) => idsOf(await store.list({ project, limit: 100 }));

async function checkBadIds(store, check) {
  await inFreshProjects(store, 'ids', 1, async (project) => {
    const row = makeRow(project);
    await store.insertObservations([row]);

    const found = [];
    for (const id of WILDCARD_IDS) {
      if ((await store.getObservations([id])).length > 0) found.push(id);
    }
    check(
      'contract: ids made of wildcard characters read nothing',
      found.length === 0,
      found.join(' '),
    );
    check(
      'contract: an unknown id reads nothing',
      (await store.getObservations([row.id.replace(/^./, 'g')])).length === 0,
    );

    const deleted = await store.remove({ ids: WILDCARD_IDS, project });
    check(
      'contract: ids made of wildcard characters delete nothing',
      deleted === 0 && sameIds(await listIds(store, project), [row.id]),
      String(deleted),
    );

    const [byPrefix] = await store.getObservations([row.id.slice(0, SHORT_ID_LENGTH)]);
    check('contract: a short id still finds its row', byPrefix?.id === row.id);
  });
}

async function checkRemoveFilters(store, check) {
  await inFreshProjects(store, 'remove', 2, async (project, other) => {
    const oldDecision = makeRow(project, { kind: 'decision', createdAt: CUTOFF - 1000 });
    const newDecision = makeRow(project, { kind: 'decision', createdAt: CUTOFF + 1000 });
    const oldBugfix = makeRow(project, { kind: 'bugfix', createdAt: CUTOFF - 1000 });
    const pattern = makeRow(project, { kind: 'pattern', createdAt: CUTOFF + 1000 });
    const context = makeRow(project, { kind: 'context' });
    const bystander = makeRow(other, { kind: 'bugfix', createdAt: CUTOFF - 1000 });
    await store.insertObservations([
      oldDecision,
      newDecision,
      oldBugfix,
      pattern,
      context,
      bystander,
    ]);
    await store.upsertSession({
      id: `chat-${project}`,
      project,
      startedAt: 1,
      summary: 'chat one',
    });
    await store.upsertSession({
      id: `chat-${other}`,
      project: other,
      startedAt: 1,
      summary: 'chat two',
    });

    check(
      'contract: an empty id list deletes nothing, even with a project',
      (await store.remove({ ids: [], project })) === 0 &&
        (await listIds(store, project)).length === 5,
    );
    check(
      'contract: removing by kind takes that kind in that project only',
      (await store.remove({ kind: 'bugfix', project })) === 1 &&
        (await listIds(store, other)).length === 1,
    );
    check(
      'contract: removing by cutoff and kind takes only rows that match both',
      (await store.remove({ kind: 'decision', before: CUTOFF, project })) === 1 &&
        sameIds(await listIds(store, project), [newDecision.id, pattern.id, context.id]),
    );
    check(
      'contract: removing by id takes that row alone',
      (await store.remove({ ids: [pattern.id], project })) === 1 &&
        sameIds(await listIds(store, project), [newDecision.id, context.id]),
    );

    const symbol = (name, owner) => ({
      id: `${name}-${owner}`,
      project: owner,
      name,
      kind: 'function',
      file: 'src/a.ts',
      line: 1,
      lang: 'typescript',
      signature: `function ${name}() {`,
    });
    await store.upsertGraph({
      symbols: [symbol('mine', project), symbol('theirs', other)],
      edges: [],
      files: [],
    });

    const wiped = await store.remove({ project });
    check(
      'contract: removing a whole project takes its rows, chats and code map, and no other project',
      wiped === 2 &&
        (await listIds(store, project)).length === 0 &&
        (await store.recentSessions(project, 10)).length === 0 &&
        (await store.findSymbols({ project })).length === 0 &&
        sameIds(await listIds(store, other), [bystander.id]) &&
        (await store.recentSessions(other, 10)).length === 1 &&
        (await store.findSymbols({ project: other })).length === 1,
      String(wiped),
    );
  });
}

export default async function run({ store }, check) {
  await checkBadIds(store, check);
  await checkRemoveFilters(store, check);
}
