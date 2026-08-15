/** Shape of the JSON Claude Code writes to a hook's stdin. */
export interface HookPayload {
  session_id?: string;
  cwd?: string;
  /** Claude Code passes the session's JSONL transcript path directly. */
  transcript_path?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  prompt?: string;
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

/**
 * Hooks run on the critical path of the agent loop. A memory layer that breaks
 * the user's session is worse than one that forgets, so every failure is
 * swallowed and reported on stderr, never as a non-zero exit.
 */
export async function runHook(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    process.stderr.write(
      `[claude-db] ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exit(0);
}

/** Text written to stdout is injected into the agent's context. */
export function emitContext(text: string): void {
  if (text.trim().length > 0) process.stdout.write(text);
}
