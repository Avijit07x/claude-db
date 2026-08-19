export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  group: string;
}

export const GROUPS = ['Getting started', 'Guides', 'Reference'] as const;

export const DOCS: DocMeta[] = [
  {
    slug: '',
    title: 'Introduction',
    description: 'Persistent memory and a real code graph for Claude Code.',
    group: 'Getting started',
  },
  {
    slug: 'installation',
    title: 'Installation',
    description: 'Install the package, wire it to a repo, and confirm it is running.',
    group: 'Getting started',
  },
  {
    slug: 'quick-start',
    title: 'Quick start',
    description: 'From a cold install to answers grounded in your own repo.',
    group: 'Getting started',
  },
  {
    slug: 'how-it-works',
    title: 'How it works',
    description: 'What gets captured on every turn, and what gets injected back.',
    group: 'Guides',
  },
  {
    slug: 'code-graph',
    title: 'Code graph',
    description: 'Every symbol and every relationship, parsed locally.',
    group: 'Guides',
  },
  {
    slug: 'databases',
    title: 'Databases',
    description: 'SQLite by default. Point it at Postgres or Mongo to sync across machines.',
    group: 'Guides',
  },
  {
    slug: 'cdb-scan',
    title: 'The cdb-scan skill',
    description: 'Map an existing codebase into memory in one pass, from inside Claude Code.',
    group: 'Guides',
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    description: 'What never leaves your machine, and what is never written down.',
    group: 'Guides',
  },
  {
    slug: 'cli',
    title: 'CLI reference',
    description: 'Every command, what it does, and when you need it.',
    group: 'Reference',
  },
  {
    slug: 'mcp-tools',
    title: 'MCP tools',
    description: 'The six tools Claude gets, and the layered way to use them.',
    group: 'Reference',
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    description: 'What to run when capture, search, the graph or the database is not behaving.',
    group: 'Reference',
  },
  {
    slug: 'benchmarks',
    title: 'Benchmarks',
    description: 'What recall costs, what a lookup refunds, and where it does not pay off.',
    group: 'Reference',
  },
];

export const href = (slug: string) => (slug ? `/docs/${slug}` : '/docs');

export function findDoc(slug: string) {
  const i = DOCS.findIndex((doc) => doc.slug === slug);
  if (i < 0) return null;
  return { doc: DOCS[i]!, prev: DOCS[i - 1] ?? null, next: DOCS[i + 1] ?? null };
}
