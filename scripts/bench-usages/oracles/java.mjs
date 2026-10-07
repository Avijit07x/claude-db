import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTool, runTool } from './tools.mjs';

const SOURCE = fileURLToPath(new URL('./Oracle.java', import.meta.url));
const JAVA_KINDS = new Set(['class', 'interface', 'enum', 'method']);

export const requires = () =>
  hasTool('javac', ['-version']) && hasTool('java', ['-version'])
    ? null
    : 'a JDK (java and javac) is not installed';

function compiled(cacheDir) {
  const out = join(cacheDir, 'java-oracle');
  const built = join(out, 'Oracle.class');
  if (!existsSync(built) || statSync(built).mtimeMs < statSync(SOURCE).mtimeMs) {
    mkdirSync(out, { recursive: true });
    runTool('javac', ['-d', out, SOURCE]);
  }
  return out;
}

const bucketOf = (kind, what) => (kind === 'import' ? 'import' : what);

export function expected({ root, cacheDir }) {
  const output = runTool('java', ['-cp', compiled(cacheDir), 'Oracle', root]);
  const entries = [];
  for (const row of output.split('\n')) {
    if (!row) continue;
    const [kind, file, line, targetFile, name, what] = row.split('\t');
    entries.push({
      bucket: bucketOf(kind, what),
      file,
      line: Number(line),
      target: `${targetFile}\0${name}`,
      name,
    });
  }
  return {
    entries,
    inScope: (symbol) => symbol.file.endsWith('.java') && JAVA_KINDS.has(symbol.kind),
    note: 'JDK compiler API',
  };
}
