export interface StartFacts {
  block: string;
  ids: Set<string>;
}

export interface Entry {
  texts: string[];
  id: string | null;
  line: (texts: string[]) => string;
}

export type Section = [string, Entry[]];

const SUMMARY_JOIN = '; ';

export function entry(line: string, id: string | null, text: string): Entry {
  return { texts: [text], id, line: () => line };
}

export function summaryEntry(parts: string[]): Entry {
  return { texts: parts, id: null, line: (kept) => `- Summary: ${kept.join(SUMMARY_JOIN)}` };
}

const textKey = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

function unseen(texts: string[], seen: ReadonlySet<string>): string[] {
  const keys = texts.map(textKey);
  return texts.filter((_, index) => {
    const key = keys[index] ?? '';
    return !seen.has(key) && keys.indexOf(key) === index;
  });
}

export function render(
  sections: Section[],
  maxChars: number,
  earlier: ReadonlySet<string> = new Set(),
): StartFacts | null {
  const seen = new Set([...earlier].map(textKey));
  const ids = new Set<string>();
  const blocks: string[] = [];
  let budget = maxChars;

  for (const [heading, entries] of sections) {
    const lines: string[] = [];
    for (const item of entries) {
      const kept = unseen(item.texts, seen);
      if (kept.length > 0) {
        const line = item.line(kept);
        if (line.length > budget) break;
        budget -= line.length + 1;
        for (const text of kept) seen.add(textKey(text));
        lines.push(line);
      }
      if (item.id) ids.add(item.id);
    }
    if (lines.length > 0) blocks.push([heading, ...lines].join('\n'));
  }

  if (blocks.length === 0) return null;
  return { block: ['<memory>', blocks.join('\n\n'), '</memory>'].join('\n'), ids };
}
