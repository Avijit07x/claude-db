import { execFile } from 'node:child_process';

const MAX_BUFFER = 1024 * 1024;
const REASON_CHARS = 120;

const OPTIONAL_FLAGS: readonly (readonly string[])[] = [
  ['--effort', 'low'],
  ['--no-session-persistence'],
];

const UNKNOWN_OPTION = /unknown option '(--[\w-]+)'/i;

export interface HeadlessOptions {
  flags?: readonly (readonly string[])[];
  env?: Readonly<Record<string, string>>;
}

export type HeadlessResult = { ok: true; stdout: string } | { ok: false; reason: string };

type CallResult = { ok: true; stdout: string } | { ok: false; stderr: string; reason: string };

interface ProcessFailure {
  code?: unknown;
  killed?: unknown;
  signal?: unknown;
}

export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAUDE_CODE_EXECPATH'] || 'claude';
}

export async function runHeadlessResult(
  prompt: string,
  model: string,
  timeoutMs: number,
  options: HeadlessOptions = {},
): Promise<HeadlessResult> {
  let optional = [...OPTIONAL_FLAGS, ...(options.flags ?? [])];
  for (;;) {
    const result = await call(
      ['-p', prompt, '--model', model, ...optional.flat()],
      timeoutMs,
      options.env ?? {},
    );
    if (result.ok) return { ok: true, stdout: result.stdout };

    const rejected = UNKNOWN_OPTION.exec(result.stderr)?.[1];
    const remaining = optional.filter((flags) => flags[0] !== rejected);
    if (remaining.length === optional.length) return { ok: false, reason: result.reason };
    optional = remaining;
  }
}

export async function runHeadless(
  prompt: string,
  model: string,
  timeoutMs: number,
  options: HeadlessOptions = {},
): Promise<string | null> {
  const result = await runHeadlessResult(prompt, model, timeoutMs, options);
  return result.ok ? result.stdout : null;
}

export function describeFailure(error: unknown, stderr: string, timeoutMs: number): string {
  const failure: ProcessFailure = typeof error === 'object' && error !== null ? error : {};
  if (failure.code === 'ENOENT') {
    return 'claude was not found: set CLAUDE_CODE_EXECPATH or put it on PATH';
  }
  if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return 'the reply was larger than the 1 MB buffer';
  }
  if (failure.killed === true) return `timed out after ${formatDuration(timeoutMs)}`;

  const detail = firstLine(stderr);
  if (typeof failure.code === 'number') {
    return detail
      ? `exited with code ${failure.code}: ${detail}`
      : `exited with code ${failure.code}`;
  }
  if (typeof failure.signal === 'string') return `stopped by ${failure.signal}`;
  return detail || 'could not run claude';
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return '';
  return line.length > REASON_CHARS ? `${line.slice(0, REASON_CHARS - 1)}…` : line;
}

function call(
  args: string[],
  timeoutMs: number,
  env: Readonly<Record<string, string>>,
): Promise<CallResult> {
  return new Promise((done) => {
    try {
      const child = execFile(
        claudeBinary(),
        args,
        {
          timeout: timeoutMs,
          maxBuffer: MAX_BUFFER,
          env: { ...process.env, ...env, CLAUDE_DB_CAPTURE: 'off' },
        },
        (error, stdout, stderr) => {
          if (!error) {
            done({ ok: true, stdout });
            return;
          }
          const text = String(stderr);
          done({ ok: false, stderr: text, reason: describeFailure(error, text, timeoutMs) });
        },
      );
      child.stdin?.end();
    } catch (error) {
      done({ ok: false, stderr: '', reason: describeFailure(error, '', timeoutMs) });
    }
  });
}
