import { closeSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../util/project.js';

export interface Turn {
  prompt: string;
  reasoning: string;
  files: string[];
  commands: string[];
  timestamp: number;
  offset: number;
}

export interface TranscriptRead {
  turns: Turn[];
  nextOffset: number;
}

interface RawEntry {
  type?: string;
  timestamp?: string;
  isCompactSummary?: boolean;
  message?: {
    content?: unknown;
  };
}

export function readTranscript(path: string, fromOffset = 0): TranscriptRead {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return { turns: [], nextOffset: fromOffset };
  }

  try {
    const size = fstatSync(fd).size;

    const start = fromOffset > size ? 0 : fromOffset;
    const length = size - start;
    if (length <= 0) return { turns: [], nextOffset: size };

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
      } catch {}
    }

    const turns = groupIntoTurns(entries);
    const nextOffset = turns.length > 0 ? (turns[turns.length - 1]?.offset ?? size) : size;

    return { turns, nextOffset };
  } finally {
    closeSync(fd);
  }
}

function groupIntoTurns(entries: { entry: RawEntry; offset: number }[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const { entry, offset } of entries) {
    const timestamp = Date.parse(entry.timestamp ?? '') || Date.now();

    if (entry.type === 'user') {
      const text = extractText(entry.message?.content);
      if (!text || entry.isCompactSummary || isSyntheticPrompt(text)) continue;

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

function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text',
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

export function transcriptPathFor(project: string, sessionId: string): string {
  const slug = project.replace(/[/.]/g, '-');
  return join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

export function transcriptsFor(project: string): string[] {
  const root = join(homedir(), '.claude', 'projects');
  const slug = project.replace(/[/.]/g, '-');

  let candidates: string[];
  try {
    candidates = readdirSync(root).filter((name) => name === slug || name.startsWith(`${slug}-`));
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

export function sessionIdsOnDisk(): string[] {
  const root = join(homedir(), '.claude', 'projects');
  const ids: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return ids;
  }

  for (const dir of dirs) {
    try {
      for (const name of readdirSync(join(root, dir))) {
        if (name.endsWith('.jsonl')) ids.push(name.slice(0, -'.jsonl'.length));
      }
    } catch {}
  }
  return ids;
}

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
      } catch {}
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
