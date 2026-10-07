import { fileURLToPath } from 'node:url';
import { hasTool, runTool } from './tools.mjs';

const ORACLE = fileURLToPath(new URL('./python.py', import.meta.url));

export const requires = () => (hasTool('python3') ? null : 'python3 is not installed');

export function expected({ root }) {
  const { defs, hits } = JSON.parse(runTool('python3', ['-I', ORACLE, root]));
  const topLevel = new Set();
  for (const [file, names] of Object.entries(defs)) {
    for (const name of Object.keys(names)) topLevel.add(`${file}\0${name}`);
  }
  const entries = hits.map(([bucket, file, line, targetFile, name]) => ({
    bucket,
    file,
    line,
    target: `${targetFile}\0${name}`,
    name,
  }));
  return {
    entries,
    inScope: (symbol) => topLevel.has(`${symbol.file}\0${symbol.name}`),
    note: 'Python ast',
  };
}
