export default async function run(
  { store, search, project, observations, now, sessionId, expected, uri, dir },
  check,
) {
  const hits = await search.search({ text: 'websocket reconnect', project, limit: 5 });
  check('layer 1 returns hits', hits.length > 0, `${hits.length} hits`);
  check(
    'layer 1 omits bodies',
    hits.every((h) => !('body' in h)),
  );
  const topics = hits.map((h) => h.title.toLowerCase());
  check(
    'layer 1 surfaces both websocket records',
    topics.some((t) => t.includes('websocket')) && topics.some((t) => t.includes('reconnect')),
    topics.join(' | '),
  );
  check('layer 1 excludes unrelated records', !topics.some((t) => t.includes('virtualized')));

  const withSnippet = hits.filter((h) => h.snippet);
  check(
    'keyword hits carry a snippet',
    withSnippet.length > 0,
    `${withSnippet.length}/${hits.length}`,
  );
  check(
    'a snippet is one line and bounded',
    withSnippet.every((h) => !h.snippet.includes('\n') && h.snippet.length <= 120),
    withSnippet[0]?.snippet,
  );
  check(
    'a snippet shows body text the title does not',
    withSnippet.some((h) => !h.title.includes(h.snippet.replace(/…/g, '').trim().slice(0, 20))),
    withSnippet[0]?.snippet,
  );

  const byTag = await search.search({ text: 'performance', project, limit: 5 });
  check(
    'tags are searchable, not just titles and bodies',
    byTag.length === 2,
    `${byTag.length} hits`,
  );

  const scoped = await search.search({ text: 'websocket', project, tag: 'auth', limit: 5 });
  check(
    'tag filter narrows to one area',
    scoped.length === 1 && scoped[0].title.includes('reconnect storm'),
    scoped.map((h) => h.title).join(' | '),
  );
  check(
    'tag filter matches whole tags, not prefixes',
    (await search.search({ text: 'websocket', project, tag: 'real', limit: 5 })).length === 0,
  );

  const onlyDeadends = await search.search({ text: 'redux', project, kind: 'deadend', limit: 5 });
  check('kind filter works', onlyDeadends.length === 1 && onlyDeadends[0].kind === 'deadend');

  const otherProject = await search.search({ text: 'websocket', project: '/tmp/nope', limit: 5 });
  check('project scoping isolates memory', otherProject.length === 0);

  const { toShortId } = await import('../../dist/util/shortid.js');
  const tl = await search.timeline({
    observationId: toShortId(observations[2].id),
    before: 2,
    after: 2,
  });
  check('layer 2 returns neighbours', tl.length >= 3, `${tl.length} entries`);
  check(
    'layer 2 is chronological',
    tl.every((e, i) => i === 0 || tl[i - 1].createdAt <= e.createdAt),
  );

  const full = await search.getObservations([observations[0].id, observations[1].id]);
  check('layer 3 batches ids', full.length === 2);
  check(
    'layer 3 returns bodies',
    full.every((o) => o.body.length > 0),
  );

  const indexChars = hits.map((h) => `${h.id} [${h.kind}] ${h.title}`).join('\n').length;
  const fullChars = (await search.getObservations(hits.map((h) => h.id)))
    .map((o) => o.body)
    .join('\n').length;
  check(
    'index is materially cheaper than bodies',
    indexChars < fullChars,
    `${indexChars} vs ${fullChars} chars`,
  );
}
