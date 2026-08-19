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
