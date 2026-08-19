import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from './schema.js';
import { ConfigSchema } from './schema.js';

export const CONFIG_DIR = join(homedir(), '.claude-memory');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const DEFAULT_DB_PATH = join(CONFIG_DIR, 'memory.db');

const SUPERSEDED_INJECT = { expandTop: 1, promptMaxChars: 500 };

function dropSupersededDefaults(raw: unknown): unknown {
  const file = raw as { inject?: Record<string, unknown> } | null;
  const inject = file?.inject;
  if (!inject) return raw;

  const untouched = Object.entries(SUPERSEDED_INJECT).every(
    ([key, value]) => inject[key] === value,
  );
  if (!untouched) return raw;

  const trimmed = { ...inject };
  for (const key of Object.keys(SUPERSEDED_INJECT)) delete trimmed[key];
  return { ...file, inject: trimmed };
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

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
