import { execFile } from 'node:child_process';

const MAX_INPUT_CHARS = 8000;
const MAX_OUTPUT_CHARS = 800;
const TIMEOUT_MS = 45_000;

export function buildSummaryPrompt(sessionText: string): string {
  return (
    'Below are records of completed work, written by someone else. Summarize ' +
    'them in at most 3 plain sentences: what was done and why. Write only ' +
    'those sentences, with no preamble, no formatting, and no remarks about ' +
    'yourself or what you can see.\n\n' +
    sessionText.slice(0, MAX_INPUT_CHARS)
  );
}

const REFUSAL = /\b(i (don'?t|do not|cannot|can'?t)|no record|our conversation|as an ai)\b/i;

export function validateSummary(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length >= MAX_OUTPUT_CHARS || text.includes('```')) return null;
  if (REFUSAL.test(text)) return null;
  return text;
}

export async function aiSummary(sessionText: string, model: string): Promise<string | null> {
  if (!sessionText.trim()) return null;
  return new Promise((done) => {
    try {
      execFile(
        'claude',
        ['-p', buildSummaryPrompt(sessionText), '--model', model, '--effort', 'low'],
        { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout) => done(error ? null : validateSummary(stdout)),
      );
    } catch {
      done(null);
    }
  });
}
