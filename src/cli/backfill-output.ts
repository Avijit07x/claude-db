import type { BackfillResult, BackfillStep } from '../facts/distill.js';
import type { BudgetUsage } from '../util/daily-budget.js';
import { describePause } from '../util/daily-budget.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 120;
const CLEAR_LINE = '\r\u001b[K';

type DoneStep = Extract<BackfillStep, { kind: 'done' }>;

export interface BackfillPrinterOptions {
  write: (text: string) => void;
  tty: boolean;
  every?: (tick: () => void, ms: number) => () => void;
}

export interface BackfillPrinter {
  step: (step: BackfillStep) => void;
  finish: (result: BackfillResult, usage: BudgetUsage, dailyLimit: number) => void;
}

function everyInterval(tick: () => void, ms: number): () => void {
  const timer = setInterval(tick, ms);
  timer.unref();
  return () => clearInterval(timer);
}

export function stopLine(result: BackfillResult, usage: BudgetUsage, dailyLimit: number): string {
  const left = `${result.remaining} chat(s) still waiting`;
  if (result.stopped === 'failed') {
    const reason = usage.lastFailure?.reason ?? 'the call failed';
    return `stopped  : a Haiku call failed (${reason}), ${left}`;
  }
  const pause = describePause(usage);
  const why = pause ? `paused ${pause}` : `the daily limit of ${dailyLimit} calls is used up`;
  return `stopped  : ${why}, ${left}`;
}

function factsMade(count: number): string {
  return `${count} ${count === 1 ? 'fact' : 'facts'} made`;
}

function headerLine(total: number): string {
  if (total === 0) return 'nothing waiting: every recent chat is already turned into facts\n';
  return `${total} chat(s) waiting. This can take a few minutes, each chat needs one or more Haiku calls.\n`;
}

function progressLine(step: DoneStep): string {
  return `${step.index} of ${step.total} chats, ${factsMade(step.facts)}\n`;
}

function closingLine(result: BackfillResult, usage: BudgetUsage, dailyLimit: number): string {
  if (result.stopped !== 'done') return `${stopLine(result, usage, dailyLimit)}\n`;
  if (result.distilled === 0) return '';
  return `done     : ${result.distilled} chat(s) turned into ${result.facts} fact(s)\n`;
}

export function createBackfillPrinter(options: BackfillPrinterOptions): BackfillPrinter {
  const { write, tty, every = everyInterval } = options;
  let stopSpinner: (() => void) | null = null;

  const clearSpinner = (): void => {
    if (!stopSpinner) return;
    stopSpinner();
    stopSpinner = null;
    write(CLEAR_LINE);
  };

  const startSpinner = (label: string): void => {
    let frame = 0;
    const draw = (): void => {
      write(`${CLEAR_LINE}${FRAMES[frame % FRAMES.length]} ${label}`);
      frame += 1;
    };
    draw();
    stopSpinner = every(draw, FRAME_MS);
  };

  return {
    step(step) {
      switch (step.kind) {
        case 'begin':
          write(headerLine(step.total));
          return;
        case 'start':
          if (tty) startSpinner(`chat ${step.index} of ${step.total}`);
          return;
        case 'done':
          clearSpinner();
          write(progressLine(step));
          return;
      }
    },
    finish(result, usage, dailyLimit) {
      clearSpinner();
      write(closingLine(result, usage, dailyLimit));
    },
  };
}
