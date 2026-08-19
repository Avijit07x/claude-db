import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';

export function currentAuthor(): string | undefined {
  try {
    return userInfo().username || undefined;
  } catch {
    return undefined;
  }
}

export function observationId(sessionId: string, timestamp: number, seed: string): string {
  const digest = createHash('sha256').update(`${sessionId} ${timestamp} ${seed}`).digest('hex');

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}
