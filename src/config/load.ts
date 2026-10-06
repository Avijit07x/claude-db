import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from './dir.js';
import type { Config } from './schema.js';
import { ConfigSchema } from './schema.js';

export { CONFIG_DIR };
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const DEFAULT_DB_PATH = join(CONFIG_DIR, 'memory.db');

const SUPERSEDED_INJECT: Record<string, unknown>[] = [
  { expandTop: 1, promptMaxChars: 500 },
  { promptResults: 4, minOverlap: 1 },
  { promptResults: 3, minOverlap: 2 },
];

export function dropSupersededDefaults(raw: unknown): unknown {
  const file = raw as { inject?: Record<string, unknown> } | null;
  const saved = file?.inject;
  if (!saved) return raw;

  let inject = saved;
  for (const superseded of SUPERSEDED_INJECT) {
    const untouched = Object.entries(superseded).every(([key, value]) => inject[key] === value);
    if (!untouched) continue;
    inject = Object.fromEntries(Object.entries(inject).filter(([key]) => !(key in superseded)));
  }
  return inject === saved ? raw : { ...file, inject };
}

export function loadConfig(): Config {
  let fileConfig: unknown = {};
  try {
    fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}

  const config = ConfigSchema.parse(dropSupersededDefaults(fileConfig));
  const envUrl = process.env['CLAUDE_DB_URL']?.trim();

  return {
    ...config,
    database: envUrl && envUrl.length > 0 ? envUrl : config.database || DEFAULT_DB_PATH,
  };
}

export function setConfigValue(section: string, key: string, value: unknown): void {
  let file: Record<string, unknown> = {};
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  } catch {}
  const current = file[section];
  const block = current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
  file[section] = { ...block, [key]: value };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
