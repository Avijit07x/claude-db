import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BATCH = 500;
