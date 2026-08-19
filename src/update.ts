import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from './config/index.js';

const STATE_PATH = join(CONFIG_DIR, 'update.json');
const REGISTRY = 'https://registry.npmjs.org/claude-db/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateState {
  checkedAt?: number;
  latest?: string;
  installed?: string;
}

export function packageVersion(): string {
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function readState(): UpdateState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as UpdateState;
  } catch {
    return {};
  }
}

function writeState(state: UpdateState): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {}
}

export function isDue(state: UpdateState, now = Date.now()): boolean {
  return now - (state.checkedAt ?? 0) > CHECK_INTERVAL_MS;
}

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isCompatible(current: string, candidate: string): boolean {
  const [curMajor = 0, curMinor = 0] = current.split('.').map(Number);
  const [newMajor = 0, newMinor = 0] = candidate.split('.').map(Number);
  return curMajor === 0 ? curMajor === newMajor && curMinor === newMinor : curMajor === newMajor;
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

export interface UpdateResult {
  current: string;
  latest: string | null;
  installed: boolean;
  reason?: string;
}

export async function checkForUpdate(mode: 'auto' | 'notify' | 'off'): Promise<UpdateResult> {
  const current = packageVersion();
  if (mode === 'off') return { current, latest: null, installed: false, reason: 'disabled' };

  const latest = await fetchLatest();
  const state: UpdateState = { ...readState(), checkedAt: Date.now() };
  if (latest) state.latest = latest;

  if (!latest) {
    writeState(state);
    return { current, latest: null, installed: false, reason: 'could not reach the registry' };
  }
  if (compareVersions(latest, current) <= 0) {
    writeState(state);
    return { current, latest, installed: false, reason: 'up to date' };
  }
  if (mode === 'notify') {
    writeState(state);
    return { current, latest, installed: false, reason: 'notify only' };
  }
  if (!isCompatible(current, latest)) {
    writeState(state);
    return { current, latest, installed: false, reason: 'not a compatible release' };
  }

  try {
    execFileSync('npm', ['install', '-g', `claude-db@${latest}`], {
      stdio: 'ignore',
      timeout: 120_000,
    });
    writeState({ ...state, installed: latest });
    return { current, latest, installed: true };
  } catch (error) {
    writeState(state);
    return {
      current,
      latest,
      installed: false,
      reason:
        error instanceof Error
          ? (error.message.split('\n')[0] ?? 'install failed')
          : 'install failed',
    };
  }
}

export function updateNotice(): string | null {
  const state = readState();
  const current = packageVersion();

  if (state.installed && compareVersions(state.installed, current) <= 0) {
    const { installed: _done, ...rest } = state;
    writeState(rest);
    return `claude-db updated to ${current}.`;
  }
  if (state.latest && compareVersions(state.latest, current) > 0) {
    return `claude-db ${state.latest} is available (running ${current}): npm i -g claude-db`;
  }
  return null;
}
