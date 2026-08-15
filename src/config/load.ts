import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from './schema.js';
import { ConfigSchema } from './schema.js';

export const CONFIG_DIR = join(homedir(), '.claude-memory');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const DEFAULT_DB_PATH = join(CONFIG_DIR, 'memory.db');

/**
 * Precedence: CLAUDE_DB_URL env var, then config.json, then a local SQLite
 * file. The env var wins so CI and containers can point at a shared database
 * without rewriting config on disk.
 */
export function loadConfig(): Config {
  let fileConfig: unknown = {};
  try {
    fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // Missing or unreadable config is not an error; defaults apply.
  }

  const config = ConfigSchema.parse(fileConfig);
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
