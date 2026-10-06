import type { RecallContext } from '../context.js';
import { finishJob, jobMark } from '../util/job-lock.js';
import { pendingSessions } from './distill.js';

const NOTICE_JOB = 'notices';
const NOTICE_KEY = 'distill';
const NOTICE_VERSION = 1;

export async function distillNotice(ctx: RecallContext, project: string): Promise<string | null> {
  if (!ctx.config.distill.enabled || jobMark(NOTICE_JOB, NOTICE_KEY) >= NOTICE_VERSION) return null;
  finishJob(NOTICE_JOB, NOTICE_KEY, NOTICE_VERSION);

  const pending = (await pendingSessions(ctx, project)).length;
  return [
    'claude-db now turns your chats into short facts it can recall later, with one small',
    `Haiku call per chat (at most ${ctx.config.distill.dailyLimit} a day).`,
    pending > 0
      ? `${pending} earlier chat(s) in this project will be turned into facts in the background.`
      : '',
    "Claude Code's own memory files are imported too, so other machines and projects can use",
    'them. Turn it off any time: claude-db distill off',
  ]
    .filter(Boolean)
    .join(' ');
}
