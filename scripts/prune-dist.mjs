import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const COMPILED = /\.(?:d\.ts|js)$/;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const stale = walk('dist').filter((file) => {
  if (!COMPILED.test(file)) return false;
  const source = join('src', relative('dist', file).replace(COMPILED, '.ts'));
  return !existsSync(source);
});

for (const file of stale) {
  rmSync(file);
  console.log(`removed stale ${file}`);
}
