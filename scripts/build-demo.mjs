import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'site', 'data', 'demo.json');
const CHARS_PER_TOKEN = 4;
const CODE_ONLY = [':!*.md', ':!docs/', ':!site/'];

const tok = (chars) => Math.round(chars / CHARS_PER_TOKEN);

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    if (error.status === 1) return '';
    throw error;
  }
}

const cli = (args) => sh(process.execPath, [join(ROOT, 'dist', 'cli', 'index.js'), ...args]);
const grep = (symbol) =>
  sh('git', ['grep', '-n', '-w', '-I', '--untracked', '-e', symbol, '--', ...CODE_ONLY]);
const filesFor = (symbol) =>
  sh('git', ['grep', '-l', '-w', '-I', '--untracked', '-e', symbol, '--', ...CODE_ONLY])
    .split('\n')
    .filter((file) => file.startsWith('src/'));

const bytes = (file) => {
  try {
    return statSync(join(ROOT, file)).size;
  } catch {
    return 0;
  }
};

function explainScenario(symbol) {
  const output = cli(['usages', '--mode', 'explain', symbol]);
  if (!output.includes(symbol)) throw new Error(`no graph output for ${symbol}`);

  const lines = output.split('\n');
  const refIndex = lines.findIndex((line) => line.trim().startsWith('Referenced by'));
  if (refIndex < 0) throw new Error(`no "Referenced by" block for ${symbol}`);

  const withLines = [lines[0] ?? '', lines[1] ?? ''];
  for (let i = refIndex; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim().startsWith('Reaches')) break;
    withLines.push(line.replace(/\s+\[EXTRACTED\]|\s+\[INFERRED[^\]]*\]/g, ''));
  }

  const hits = grep(symbol);
  const files = filesFor(symbol);
  const reads = files.slice(0, 4);
  const source = /Source: (\S+):/.exec(output)?.[1];

  return {
    id: 'explain',
    label: 'What breaks if I change this',
    question: `what breaks if I change ${symbol}?`,
    without: {
      tokens: tok(hits.length + (source ? bytes(source) : 0)),
      foot: `${reads.length} files opened to work out which hits were definitions.`,
      lines: [
        { text: `grep -rn "${symbol}" src/`, tone: 'cmd' },
        {
          text: `${hits.split('\n').filter(Boolean).length} hits across ${files.length} files`,
          tone: 'dim',
        },
        ...reads.map((file) => ({ text: `read ${file}`, tone: 'file' })),
        { text: '', tone: 'dim' },
        {
          text: 'Three adapters define it. Something in capture/ calls it,\nlet me open the tests as well to be sure.',
          tone: 'answer',
        },
      ],
    },
    with: {
      tokens: tok(output.length),
      foot: 'One call. Every reference already labelled.',
      lines: [
        { text: 'find_usages  mode: explain', tone: 'cmd' },
        ...withLines.map((line) => ({
          text: line,
          tone: line.trim().startsWith('Source:')
            ? 'file'
            : line.trim().startsWith('Referenced')
              ? 'dim'
              : 'plain',
        })),
        { text: '', tone: 'dim' },
        {
          text: 'Three store adapters implement it, and closeLandedWork\nis the only caller. Renaming it touches all four.',
          tone: 'answer',
        },
      ],
    },
  };
}

function pathScenario(from, to) {
  const output = cli(['usages', '--mode', 'path', from, to]);
  const chain = /\n\s+(\S+(?: --> \S+)+)/.exec(output)?.[1];
  if (!chain) throw new Error(`no path between ${from} and ${to}`);

  const hops = chain.split(' --> ');
  const opened = [...new Set(hops.flatMap((hop) => filesFor(hop).slice(0, 1)))];
  const hand =
    hops.reduce((n, hop) => n + grep(hop).length, 0) + opened.reduce((n, f) => n + bytes(f), 0);

  return {
    id: 'path',
    label: 'How do these two connect',
    question: `how does ${from} reach ${to}?`,
    without: {
      tokens: tok(hand),
      foot: `${opened.length} files read to follow the chain by hand.`,
      lines: [
        { text: `grep -rn "${from}" src/`, tone: 'cmd' },
        { text: `then follow each call site outward`, tone: 'dim' },
        ...opened.slice(0, 5).map((file) => ({ text: `read ${file}`, tone: 'file' })),
        { text: '', tone: 'dim' },
        {
          text: `${from} calls into the scan path, but I need to open\neach hop to be sure nothing in between is indirect.`,
          tone: 'answer',
        },
      ],
    },
    with: {
      tokens: tok(output.length),
      foot: 'The whole chain, in one query.',
      lines: [
        { text: `find_usages  mode: path`, tone: 'cmd' },
        { text: `Shortest path (${hops.length - 1} hops):`, tone: 'dim' },
        ...hops.map((hop, i) => ({
          text: `${'  '.repeat(1)}${i === 0 ? '' : '--> '}${hop}`,
          tone: i === 0 || i === hops.length - 1 ? 'file' : 'plain',
        })),
        { text: '', tone: 'dim' },
        {
          text: `${hops.length - 1} hops, every edge read out of the syntax tree.\nNo file was opened to answer it.`,
          tone: 'answer',
        },
      ],
    },
  };
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const data = {
  generated: new Date().toISOString().slice(0, 10),
  version: pkg.version,
  scenarios: [pathScenario('cmdScan', 'observationId'), explainScenario('closeObservations')],
};

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

console.log(`wrote ${OUT}`);
for (const scenario of data.scenarios) {
  console.log(
    `  ${scenario.id}: ${scenario.without.tokens} by hand, ${scenario.with.tokens} with the graph`,
  );
}
