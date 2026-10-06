const TRIVIAL = new Set([
  'ok',
  'okay',
  'yes',
  'no',
  'yep',
  'nope',
  'sure',
  'thanks',
  'thank you',
  'continue',
  'go on',
  'go ahead',
  'next',
  'stop',
  'wait',
  'done',
  'good',
  'nice',
  'perfect',
  'great',
  'do it',
  'proceed',
  'retry',
  'again',
  'fix it',
]);

const NOISE = new Set([
  'the',
  'and',
  'for',
  'this',
  'that',
  'with',
  'you',
  'can',
  'please',
  'now',
  'what',
  'why',
  'how',
  'when',
  'where',
  'are',
  'was',
  'were',
  'have',
  'has',
  'not',
  'let',
  'make',
  'get',
  'add',
  'use',
  'need',
  'want',
  'should',
]);

const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

const RELAYED_MESSAGE = /^(?:[^<\n]*\n)?<(?:agent-message|task-notification)\b/;

const COMMAND_MESSAGE = /^<(?:command-name|command-message|local-command-[a-z]+)\b/;

const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/;

const COMMAND_ARGS = /<command-args>([^<]*)<\/command-args>/;

const IMAGE_MARKER = /\[Image: (?:source: |original )[^\]\n]*\]/g;

const IDE_CONTEXT = /<(ide_[a-z_]+)>[\s\S]*?<\/\1>/g;

export function isRelayedMessage(text: string): boolean {
  return RELAYED_MESSAGE.test(text.trim());
}

export function withoutImageMarkers(text: string): string {
  return text
    .replace(IMAGE_MARKER, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function withoutIdeContext(text: string): string {
  return text.replace(IDE_CONTEXT, ' ');
}

export function typedPrompt(prompt: string): string | null {
  const text = prompt.trim();
  if (RELAYED_MESSAGE.test(text) || COMMAND_MESSAGE.test(text)) return null;
  return withoutImageMarkers(withoutIdeContext(text));
}

export function readablePrompt(prompt: string): string {
  const command = COMMAND_NAME.exec(prompt)?.[1]?.trim();
  if (!command) return withoutImageMarkers(withoutIdeContext(prompt));
  const args = COMMAND_ARGS.exec(prompt)?.[1]?.trim() ?? '';
  return args ? `${command} ${args}` : command;
}

export function isSearchable(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (TRIVIAL.has(normalized.replace(/[.!?]+$/, ''))) return false;

  if ((normalized.match(DENSE_SCRIPT)?.length ?? 0) >= 4) return true;
  if (normalized.length < 8) return false;

  const content = normalized
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((word) => word.length > 2 && !NOISE.has(word));

  return content.length >= 2;
}
