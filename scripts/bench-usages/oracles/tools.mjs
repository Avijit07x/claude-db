import { execFileSync } from 'node:child_process';

const OUTPUT_LIMIT = 1 << 30;

export function hasTool(command, args = ['--version']) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export const runTool = (command, args, options = {}) =>
  execFileSync(command, args, {
    maxBuffer: OUTPUT_LIMIT,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
    ...options,
  });

export const isTopLevel = (symbol) => symbol.kind !== 'method';
