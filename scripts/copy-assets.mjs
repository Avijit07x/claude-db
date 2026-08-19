import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const assets = [['src/store/sqlite/schema.sql', 'dist/store/sqlite/schema.sql']];

for (const [from, to] of assets) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}
