import { execFile } from 'node:child_process';

const MAX_BUFFER = 1024 * 1024;

const OPTIONAL_FLAGS: readonly (readonly string[])[] = [
  ['--effort', 'low'],
  ['--no-session-persistence'],
];

const UNKNOWN_OPTION = /unknown option '(--[\w-]+)'/i;

export interface HeadlessOptions {
  flags?: readonly (readonly string[])[];
  env?: Readonly<Record<string, string>>;
}

interface CallResult {
  stdout: string | null;
  stderr: string;
}

export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAUDE_CODE_EXECPATH'] || 'claude';
}

export async function runHeadless(
  prompt: string,
  model: string,
  timeoutMs: number,
  options: HeadlessOptions = {},
): Promise<string | null> {
  let optional = [...OPTIONAL_FLAGS, ...(options.flags ?? [])];
  for (;;) {
    const result = await call(
      ['-p', prompt, '--model', model, ...optional.flat()],
      timeoutMs,
      options.env ?? {},
    );
    if (result.stdout !== null) return result.stdout;

    const rejected = UNKNOWN_OPTION.exec(result.stderr)?.[1];
    const remaining = optional.filter((flags) => flags[0] !== rejected);
    if (remaining.length === optional.length) return null;
    optional = remaining;
  }
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
        (error, stdout, stderr) => done({ stdout: error ? null : stdout, stderr: String(stderr) }),
      );
      child.stdin?.end();
    } catch {
      done({ stdout: null, stderr: '' });
    }
  });
}
