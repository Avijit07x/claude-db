import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';

const REMEMBERED_FILE = join(CONFIG_DIR, 'claude-binary');
const MAX_ANCESTORS = 8;

export interface ProcessInfo {
  parent: number;
  exe: string;
}

export type InspectProcess = (pid: number) => ProcessInfo | null;

function inspectOnLinux(pid: number): ProcessInfo | null {
  try {
    const exe = readlinkSync(`/proc/${pid}/exe`);
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    return Number.isInteger(parent) ? { parent, exe } : null;
  } catch {
    return null;
  }
}

function inspectWithPs(pid: number): ProcessInfo | null {
  try {
    const line = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).trim();
    const match = /^(\d+)\s+(.+)$/.exec(line);
    return match?.[1] && match[2] ? { parent: Number(match[1]), exe: match[2] } : null;
  } catch {
    return null;
  }
}

function inspectProcess(pid: number): ProcessInfo | null {
  if (process.platform === 'win32') return null;
  return process.platform === 'linux' ? inspectOnLinux(pid) : inspectWithPs(pid);
}

function isClaude(exe: string): boolean {
  return basename(exe) === 'claude';
}

export function findClaudeAncestor(
  start: number = process.ppid,
  inspect: InspectProcess = inspectProcess,
): string | null {
  let pid = start;
  for (let depth = 0; depth < MAX_ANCESTORS && pid > 1; depth++) {
    const info = inspect(pid);
    if (!info) return null;
    if (isClaude(info.exe)) return info.exe;
    pid = info.parent;
  }
  return null;
}

export function rememberedBinary(file = REMEMBERED_FILE): string | null {
  try {
    const path = readFileSync(file, 'utf8').trim();
    return path !== '' && statSync(path, { throwIfNoEntry: false })?.isFile() ? path : null;
  } catch {
    return null;
  }
}

export function rememberClaudeBinary(
  env: NodeJS.ProcessEnv = process.env,
  file = REMEMBERED_FILE,
  find: () => string | null = findClaudeAncestor,
): void {
  const known = rememberedBinary(file);
  const path = env['CLAUDE_CODE_EXECPATH'] || (known === null ? find() : null);
  if (!path || path === known) return;
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(file, `${path}\n`, 'utf8');
  } catch {}
}

export function claudeBinary(
  env: NodeJS.ProcessEnv = process.env,
  remembered: () => string | null = rememberedBinary,
): string {
  return env['CLAUDE_CODE_EXECPATH'] || remembered() || 'claude';
}
