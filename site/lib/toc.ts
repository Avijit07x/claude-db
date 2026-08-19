import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = (slug: string) => join(process.cwd(), 'content', 'docs', `${slug || 'introduction'}.mdx`);

export function readToc(slug: string): string[] {
  const source = readFileSync(FILE(slug), 'utf8').replace(/```[\s\S]*?```/g, '');
  return [...source.matchAll(/^## +(.+?)\s*$/gm)].map((match) => match[1]!);
}
