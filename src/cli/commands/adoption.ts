import { readFileSync } from 'node:fs';
import { createContext } from '../../context.js';
import { queryGraph } from '../../graph/index.js';
import { transcriptsFor } from '../../capture/transcript.js';
import { resolveProject } from '../../util/project.js';
import { DECLARED, isSymbol, symbolsGreppedIn } from '../../hooks/grep-symbols.js';

export async function cmdAdoption(): Promise<void> {
  const project = resolveProject(undefined);
  const files = transcriptsFor(project);
  if (files.length === 0) {
    console.log(`No transcripts found for ${project}.`);
    return;
  }

  const seen = new Set<string>();
  const bash: string[] = [];
  const memory = new Map<string, number>();
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      let entry: { message?: { content?: unknown } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const content = entry?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (item?.type !== 'tool_use' || typeof item.id !== 'string' || seen.has(item.id)) continue;
        seen.add(item.id);
        const name = typeof item.name === 'string' ? item.name : '';
        if (name === 'Bash' && typeof item.input?.command === 'string') {
          bash.push(item.input.command);
        }
        if (name.startsWith('mcp__memory__')) {
          const tool = name.slice('mcp__memory__'.length);
          memory.set(tool, (memory.get(tool) ?? 0) + 1);
        }
      }
    }
  }

  const greps = bash.filter((command) => /\b(?:grep|rg)\b/.test(command));
  const candidates = greps.map((command) => symbolsGreppedIn(command)).filter((s) => s.length > 0);

  const ctx = await createContext();
  let fires = 0;
  const cache = new Map<string, boolean>();
  try {
    for (const symbols of candidates) {
      let hit = false;
      for (const symbol of symbols.slice(0, 2)) {
        let fired = cache.get(symbol);
        if (fired === undefined) {
          const answer = await queryGraph(ctx.store, project, { mode: 'usages', symbol, limit: 20 });
          fired =
            !answer.empty &&
            (isSymbol(symbol) || answer.definitions.some((d) => DECLARED.has(d.kind)));
          cache.set(symbol, fired);
        }
        if (fired) hit = true;
      }
      if (hit) fires++;
    }
  } finally {
    await ctx.close();
  }

  const memoryTotal = [...memory.values()].reduce((a, b) => a + b, 0);
  const pct = (n: number, of: number) => (of === 0 ? '0.0%' : `${((n / of) * 100).toFixed(1)}%`);
  console.log(`Adoption for ${project}  (${files.length} transcripts)\n`);
  console.log(`  Bash commands           ${bash.length}`);
  console.log(`  containing grep/rg      ${greps.length}  (${pct(greps.length, bash.length)})`);
  console.log(`  usages-hook candidates  ${candidates.length}`);
  console.log(`  would fire today        ${fires}  (${pct(fires, bash.length)} of all commands)`);
  console.log(`\n  memory tool calls       ${memoryTotal}`);
  for (const [tool, count] of [...memory].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tool.padEnd(18)}  ${count}`);
  }
  if (greps.length > 0) {
    const ratio = memoryTotal === 0 ? 'no memory calls yet' : `${(greps.length / memoryTotal).toFixed(1)} greps per memory call`;
    console.log(`\n  ${ratio}`);
  }
}
