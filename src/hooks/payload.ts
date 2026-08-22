export interface HookPayload {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  prompt?: string;
}

export function capturingDisabled(scripted: boolean): boolean {
  if (process.env['CLAUDE_DB_CAPTURE'] === 'off') return true;
  return process.env['CLAUDE_CODE_ENTRYPOINT'] === 'sdk-cli' && !scripted;
}

export async function readPayload(): Promise<HookPayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return {};
  }
}

export async function runHook(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    process.stderr.write(`[claude-db] ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(0);
}

export function emitContext(text: string): void {
  if (text.trim().length > 0) process.stdout.write(text);
}
