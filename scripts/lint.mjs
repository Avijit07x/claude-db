import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MAX_LINES = 250;
const HOOK_STDOUT_OWNERS = new Set(['payload.ts']);

const problems = [];
const fail = (file, line, rule, detail) => problems.push({ file, line, rule, detail });

function tracked(pattern) {
  return execFileSync('git', ['ls-files', pattern], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function withoutStrings(text) {
  return text
    .replace(/\\./g, '..')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``');
}

function checkComments(file, lines) {
  let inBlock = false;
  lines.forEach((raw, index) => {
    const number = index + 1;
    if (number === 1 && raw.startsWith('#!')) return;
    const line = withoutStrings(raw);

    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      else fail(file, number, 'no-comments', raw.trim().slice(0, 60));
      return;
    }
    const block = line.indexOf('/*');
    if (block >= 0) {
      fail(file, number, 'no-comments', raw.trim().slice(0, 60));
      if (!line.includes('*/', block)) inBlock = true;
      return;
    }
    const slashes = line.indexOf('//');
    if (slashes >= 0 && line[slashes - 1] !== ':') {
      fail(file, number, 'no-comments', raw.trim().slice(0, 60));
    }
  });
}

function checkFile(file) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  checkComments(file, lines);

  if (lines.length > MAX_LINES) {
    fail(file, lines.length, 'file-too-long', `${lines.length} lines, split it under ${MAX_LINES}`);
  }

  lines.forEach((raw, index) => {
    const number = index + 1;
    const line = withoutStrings(raw);

    if (/:\s*any\b|as any\b|<any>/.test(line)) {
      fail(file, number, 'no-any', raw.trim().slice(0, 60));
    }
    if (/\b(TODO|FIXME|XXX)\b/.test(line)) {
      fail(file, number, 'no-leftover-markers', raw.trim().slice(0, 60));
    }
    const relative = /from\s+'(\.[^']*)'/.exec(raw);
    if (relative && relative[1] && !relative[1].endsWith('.js') && !relative[1].endsWith('.json')) {
      fail(file, number, 'import-extension', `${relative[1]} must end in .js`);
    }
    if (
      file.startsWith('src/hooks/') &&
      !HOOK_STDOUT_OWNERS.has(file.split('/').pop()) &&
      /\bconsole\.(log|info|warn)\b/.test(line)
    ) {
      fail(file, number, 'hook-stdout', 'hooks speak JSON on stdout; use emitContext');
    }
  });
}

for (const file of tracked('src/**/*.ts')) checkFile(file);

if (problems.length > 0) {
  for (const { file, line, rule, detail } of problems) {
    console.log(`${file}:${line}  ${rule}  ${detail}`);
  }
  console.error(`\n${problems.length} lint problem(s).`);
  process.exit(1);
}
console.log(`All lint checks passed (${tracked('src/**/*.ts').length} files).`);
