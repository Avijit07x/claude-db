import { closeSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../util/project.js';

/** One exchange: what was asked, what was reasoned, what was done. */
export interface Turn {
  prompt: string;
  /** The assistant's prose for this turn. This is where the reasoning lives. */
  reasoning: string;
  /** Files created or modified during the turn. */
  files: string[];
  /** Shell commands run during the turn. */
  commands: string[];
  timestamp: number;
  /** Byte offset in the transcript where this turn began. */
  offset: number;
}

export interface TranscriptRead {
  turns: Turn[];
  /**
   * Where the next read should resume: the start of the final turn, which may
   * still be growing. Reprocessing that turn is harmless because observation
   * ids are content-derived.
   */
  nextOffset: number;
}

interface RawEntry {
  type?: string;
  timestamp?: string;
  message?: {
    content?: unknown;
  };
}

/**
 * Claude Code already writes a complete record of every session to disk:
 * prompts, replies, and tool calls, appended as JSONL.
 *
 * Reconstructing that from `PostToolUse` hooks produces a strictly worse copy.
 * A hook sees a file path and nothing else; it never sees what the user asked
 * for or why the agent did what it did. Intent and reasoning are the entire
 * value of a memory, and they exist only here.
 */
export function readTranscript(path: string, fromOffset = 0): TranscriptRead {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return { turns: [], nextOffset: fromOffset };
  }

  try {
    const size = fstatSync(fd).size;

    // A rotated or replaced transcript is shorter than where we left off.
    // Restarting from zero is correct and cheap: ids are content-derived, so
    // anything already stored is simply rewritten in place.
    const start = fromOffset > size ? 0 : fromOffset;
    const length = size - start;
    if (length <= 0) return { turns: [], nextOffset: size };

    // Reading only the unseen tail is what keeps this viable: these files reach
    // 90MB+ on long-running sessions, and a full read on every prompt would
    // dominate hook latency and memory.
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    const raw = buffer.subarray(0, bytesRead).toString('utf8');

    const entries: { entry: RawEntry; offset: number }[] = [];
    let cursor = start;
    for (const line of raw.split('\n')) {
      const lineStart = cursor;
      cursor += Buffer.byteLength(line, 'utf8') + 1;
      if (line.trim().length === 0) continue;
      try {
        entries.push({ entry: JSON.parse(line) as RawEntry, offset: lineStart });
      } catch {
        // A torn final line is normal on a file being appended to right now.
      }
    }

    const turns = groupIntoTurns(entries);
    // Hold the cursor at the last turn's start: it is still open and more
    // assistant output may yet be appended to it.
    const nextOffset = turns.length > 0 ? (turns[turns.length - 1]?.offset ?? size) : size;

    return { turns, nextOffset };
  } finally {
    closeSync(fd);
  }
}

/**
 * A turn opens at a user prompt and absorbs everything until the next one.
 *
 * This grouping is what lets an observation carry intent: the files written
 * after "can you create one icon" belong to that request, and saying so is the
 * difference between "wrote mouse-scroll-icon.tsx" and "created the first
 * Gestures-batch icon because you asked for one".
 */
function groupIntoTurns(entries: { entry: RawEntry; offset: number }[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const { entry, offset } of entries) {
    const timestamp = Date.parse(entry.timestamp ?? '') || Date.now();

    if (entry.type === 'user') {
      const text = extractText(entry.message?.content);
      // Tool results arrive as `user` entries too; only real prose is a prompt.
      if (!text || isSyntheticPrompt(text)) continue;

      if (current) turns.push(current);
      current = { prompt: text, reasoning: '', files: [], commands: [], timestamp, offset };
      continue;
    }

    if (entry.type === 'assistant' && current) {
      const text = extractText(entry.message?.content);
      if (text) current.reasoning = current.reasoning ? `${current.reasoning}\n${text}` : text;

      for (const call of extractToolCalls(entry.message?.content)) {
        if (call.file) current.files.push(call.file);
        if (call.command) current.commands.push(call.command);
      }
    }
  }

  if (current) turns.push(current);
  return turns;
}

/** Content is either a plain string or an array of typed blocks. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'text',
    )
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractToolCalls(content: unknown): { file?: string; command?: string }[] {
  if (!Array.isArray(content)) return [];

  const calls: { file?: string; command?: string }[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const typed = block as { type?: string; name?: string; input?: Record<string, unknown> };
    if (typed.type !== 'tool_use') continue;

    const input = typed.input ?? {};
    if (typed.name === 'Write' || typed.name === 'Edit' || typed.name === 'MultiEdit') {
      const file = input['file_path'];
      if (typeof file === 'string') calls.push({ file });
    } else if (typed.name === 'Bash') {
      const command = input['command'];
      if (typeof command === 'string') calls.push({ command });
    }
  }
  return calls;
}

/**
 * Filters entries that are structurally user messages but not things a person
 * typed: injected reminders, hook output, interruption notices.
 */
function isSyntheticPrompt(text: string): boolean {
  return (
    text.includes('<system-reminder>') ||
    text.includes('<project-memory>') ||
    text.includes('<recalled-memory>') ||
    text.startsWith('Caveat:') ||
    text.startsWith('[Request interrupted') ||
    text.startsWith('<local-command')
  );
}

/**
 * Locates the transcript for a session.
 *
 * Claude Code passes `transcript_path` in the hook payload, which is
 * authoritative. The derived path is a fallback for other agents and for
 * backfilling sessions recorded before this existed: the project directory is
 * the absolute path with separators and dots replaced by dashes.
 */
export function transcriptPathFor(project: string, sessionId: string): string {
  const slug = project.replace(/[/.]/g, '-');
  return join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

/**
 * Every transcript belonging to a project, including sessions started from one
 * of its subdirectories.
 *
 * Claude Code files transcripts under the directory the agent was launched in,
 * while memory is keyed on the repository root, and those differ the moment
 * anyone runs the agent from `repo/frontend`. Candidate directories are found
 * by prefix and then confirmed by the `cwd` each transcript records: the slug
 * maps both `/` and `.` to `-`, so it cannot tell `~/app` from `~/app-extra`,
 * and without the second step a flush would ingest a neighbour's history.
 */
export function transcriptsFor(project: string): string[] {
  const root = join(homedir(), '.claude', 'projects');
  const slug = project.replace(/[/.]/g, '-');

  let candidates: string[];
  try {
    candidates = readdirSync(root).filter(
      (name) => name === slug || name.startsWith(`${slug}-`),
    );
  } catch {
    return [];
  }

  const transcripts: string[] = [];
  for (const dir of candidates) {
    let files: string[];
    try {
      files = readdirSync(join(root, dir)).filter((name) => name.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(root, dir, file);
      const cwd = transcriptCwd(path);
      if (cwd === null || resolveProject(cwd) === project) transcripts.push(path);
    }
  }
  return transcripts.sort();
}

/** First cwd recorded in a transcript, without reading a 90MB file. */
function transcriptCwd(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.allocUnsafe(65_536);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, read).toString('utf8').split('\n')) {
      try {
        const cwd = (JSON.parse(line) as { cwd?: string }).cwd;
        if (typeof cwd === 'string' && cwd.length > 0) return cwd;
      } catch {
        // Entry without a cwd, or the torn last line of the window.
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
