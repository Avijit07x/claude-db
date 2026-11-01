import { rememberClaudeBinary } from '../util/claude-binary.js';

export interface HookPayload {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  hook_event_name?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  prompt?: string;
  last_assistant_message?: string;
  background_tasks?: { status?: string }[];
  session_crons?: unknown[];
}

export type HookEnv = Readonly<Record<string, string | undefined>>;

export type Write = (text: string) => void;

export const writeStdout: Write = (text) => {
  process.stdout.write(text);
};

export function capturingDisabled(scripted: boolean, env: HookEnv = process.env): boolean {
  if (env['CLAUDE_DB_CAPTURE'] === 'off') return true;
  return env['CLAUDE_CODE_ENTRYPOINT'] === 'sdk-cli' && !scripted;
}

export function parsePayload(raw: string): HookPayload {
  const text = raw.trim();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as HookPayload;
  } catch {
    return {};
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function readPayload(): Promise<HookPayload> {
  return parsePayload(await readStdin());
}

export async function runHook(fn: () => Promise<void>): Promise<void> {
  try {
    rememberClaudeBinary();
    await fn();
  } catch (error) {
    process.stderr.write(`[claude-db] ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(0);
}

export function emitContext(text: string, write: Write = writeStdout): void {
  if (text.trim().length > 0) write(text);
}

export function emitToolContext(text: string, write: Write = writeStdout): void {
  if (text.trim().length === 0) return;
  write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
    }),
  );
}

export function emitSessionStart(
  context: string,
  notice: string | null,
  write: Write = writeStdout,
): void {
  if (!notice) {
    emitContext(context, write);
    return;
  }
  write(
    JSON.stringify({
      systemMessage: notice,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
    }),
  );
}
