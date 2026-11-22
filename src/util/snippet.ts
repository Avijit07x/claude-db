const SNIPPET_MAX = 110;
const GAP = '\n…\n';

export function toSnippet(text: unknown, max = SNIPPET_MAX): string | undefined {
  if (typeof text !== 'string') return undefined;

  const flat = text
    .replace(/<\/?b>/g, '')
    .replace(/[|`*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length === 0) return undefined;
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > max * 0.6 ? word : max)}…`;
}

export function clipBody(body: string, max: number): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max)}\n… ${body.length - max} more characters (raise \`chars\` to read them)`;
}

export function keepEnds(text: string, max: number): string {
  if (text.length <= max) return text;
  const lineEnd = text.indexOf('\n');
  const head = text.slice(0, Math.min(lineEnd < 0 ? text.length : lineEnd, Math.floor(max / 2)));
  const tail = Math.max(0, max - head.length - GAP.length);
  return `${head}${GAP}${text.slice(text.length - tail)}`;
}
