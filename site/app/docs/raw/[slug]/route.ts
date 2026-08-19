import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS } from '@/lib/docs';

export function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug || 'introduction' }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const known = DOCS.some((doc) => (doc.slug || 'introduction') === slug);
  if (!known) return new Response('Not found', { status: 404 });

  const source = readFileSync(join(process.cwd(), 'content', 'docs', `${slug}.mdx`), 'utf8');

  return new Response(source, {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
}
