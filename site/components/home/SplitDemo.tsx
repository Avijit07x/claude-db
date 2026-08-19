'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { Demo, Line, Pane, Tone } from '@/lib/demo';

const PAUSE: Record<Tone, number> = {
  cmd: 280,
  dim: 300,
  file: 290,
  plain: 90,
  answer: 140,
};

const TONE: Record<Tone, string> = {
  cmd: 'text-accent',
  dim: 'text-term-dim',
  file: 'text-term-file',
  plain: '',
  answer: 'text-white whitespace-pre-wrap',
};

function Feed({ lines, shown }: { lines: Line[]; shown: number }) {
  return (
    <div className="min-h-[258px] flex-1 overflow-x-auto bg-term px-[15px] py-3.5 font-mono text-[11px] leading-[1.85] tracking-[-0.03em] text-term-ink">
      {lines.slice(0, shown).map((line, i) => (
        <span key={i} className={`block whitespace-pre ${TONE[line.tone]}`}>
          {line.text || ' '}
        </span>
      ))}
    </div>
  );
}

function Side({
  label,
  win,
  pane,
  shown,
  tokens,
}: {
  label: string;
  win: boolean;
  pane: Pane;
  shown: number;
  tokens: number;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-panel ${
        win ? 'border-accent' : 'border-rule'
      }`}
    >
      <div className="flex items-center gap-2.5 border-b border-rule px-[15px] py-3">
        <span
          className={`font-mono text-[10px] font-semibold tracking-[0.06em] uppercase ${
            win ? 'text-accent' : 'text-cold'
          }`}
        >
          {label}
        </span>
        <span className="ml-auto flex items-baseline gap-1.5">
          <span
            className={`font-mono text-[15px] font-bold tracking-[-0.05em] tabular-nums ${
              win ? 'text-accent' : 'text-cold'
            }`}
          >
            {tokens.toLocaleString()}
          </span>
          <span className="font-mono text-[9.5px] text-ink-2">tokens</span>
        </span>
      </div>
      <Feed lines={pane.lines} shown={shown} />
      <p className={`border-t border-rule px-[15px] py-3 text-[12.5px] ${win ? 'text-ink' : 'text-ink-2'}`}>
        {pane.foot}
      </p>
    </div>
  );
}

export function SplitDemo({ demo }: { demo: Demo }) {
  const [active, setActive] = useState(0);
  const scenario = demo.scenarios[active]!;

  const [shown, setShown] = useState({
    without: scenario.without.lines.length,
    with: scenario.with.lines.length,
  });
  const [tokens, setTokens] = useState({
    without: scenario.without.tokens,
    with: scenario.with.tokens,
  });
  const box = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const lanes = useMemo(
    () => ({ without: scenario.without, with: scenario.with }),
    [scenario.with, scenario.without],
  );

  const finish = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setShown({ without: lanes.without.lines.length, with: lanes.with.lines.length });
    setTokens({ without: lanes.without.tokens, with: lanes.with.tokens });
  }, [lanes]);

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setShown({ without: 0, with: 0 });
    setTokens({ without: 0, with: 0 });

    (['without', 'with'] as const).forEach((lane) => {
      const pane = lanes[lane];
      let elapsed = 0;
      pane.lines.forEach((line, i) => {
        elapsed += PAUSE[line.tone];
        timers.current.push(
          setTimeout(() => {
            setShown((state) => ({ ...state, [lane]: i + 1 }));
            if (i === pane.lines.length - 1) {
              setTokens((state) => ({ ...state, [lane]: pane.tokens }));
            }
          }, elapsed),
        );
      });
    });
  }, [lanes]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    const node = box.current;
    if (!node) return;
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started) {
            started = true;
            play();
          }
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      timers.current.forEach(clearTimeout);
    };
  }, [finish, play]);

  return (
    <section className="mx-auto max-w-[1140px] px-[22px] pt-10 pb-[76px]">
      <div className="mb-4 flex flex-wrap items-baseline gap-3.5 border-t border-rule pt-[26px]">
        <h2 className="display m-0 text-[clamp(1rem,2.2vw,1.32rem)] font-semibold">
          Same question, one of them has memory
        </h2>
        <span className="rounded-md bg-accent-wash px-2.5 py-1 font-mono text-[12px] text-accent">
          &ldquo;{scenario.question}&rdquo;
        </span>
        <button
          type="button"
          onClick={play}
          className="ml-auto flex cursor-pointer items-center gap-2 rounded-[7px] border border-rule px-3 py-[5px] font-mono text-[10.5px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          <Icon name="replay" size={13} />
          REPLAY
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {demo.scenarios.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActive(i)}
            aria-pressed={i === active}
            className={`cursor-pointer rounded-lg border px-3 py-[7px] text-[12.5px] transition-colors ${
              i === active
                ? 'border-accent bg-accent-wash text-accent'
                : 'border-rule bg-panel text-ink-2 hover:border-cold hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div ref={box} className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Side
          label="Plain Claude Code"
          win={false}
          pane={scenario.without}
          shown={shown.without}
          tokens={tokens.without}
        />
        <Side
          label="With claude-db"
          win
          pane={scenario.with}
          shown={shown.with}
          tokens={tokens.with}
        />
      </div>
    </section>
  );
}
