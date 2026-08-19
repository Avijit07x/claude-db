import { DOCS, href } from '@/lib/docs';
import { SITE } from '@/lib/site';

export function GET() {
  const body = [
    '# claude-db',
    '',
    '> Persistent memory and a real code graph for Claude Code. Local, free, bring your own database.',
    '',
    '## Docs',
    '',
    ...DOCS.map(
      (doc) =>
        `- [${doc.title}](${SITE}${href(doc.slug)}): ${doc.description} (source: ${SITE}/docs/raw/${doc.slug || 'introduction'})`,
    ),
    '',
    '## Source',
    '',
    `- [Repository](https://github.com/Avijit07x/claude-db)`,
    '',
  ].join('\n');

  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
