import type { Session } from '../types.js';

export function summaryTime(session: Session): number | null {
  if (session.updatedAt !== undefined) return session.updatedAt;
  return session.summary !== undefined ? Date.now() : null;
}
