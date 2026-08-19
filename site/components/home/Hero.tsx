import { GraphField } from './GraphField';
import { StatRow } from './StatRow';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { CommandBox } from '@/components/ui/CommandBox';
import { INSTALL } from '@/lib/site';
import type { Stats } from '@/lib/stats';

export function Hero({ stats }: { stats: Stats }) {
  return (
    <section className="relative isolate overflow-hidden">
      <GraphField />
      <div className="mx-auto max-w-[1140px] px-[22px] pt-11 pb-[34px] sm:pt-[68px]">
        <p className="mb-5 font-mono text-[10.5px] tracking-[0.14em] text-accent uppercase">
          Memory + code graph for Claude Code
        </p>
        <h1 className="display m-0 mb-[22px] max-w-[17ch] text-[clamp(1.85rem,4.6vw,3.35rem)] leading-[1.02] font-bold text-balance">
          Stop paying Claude
          <br />
          to relearn <span className="text-cold">your own repo.</span>
        </h1>
        <p className="m-0 mb-[30px] max-w-[54ch] text-[1.1rem] text-ink-2">
          It remembers the decisions you already explained, and answers &ldquo;what breaks if I
          change this&rdquo; from a real symbol graph. Local, free, nothing to sign up for.
        </p>

        <div className="mb-6 flex flex-wrap items-stretch gap-3 sm:mb-4">
          <CommandBox command={INSTALL} />
          <ButtonLink href="/docs" icon="book">
            Docs
          </ButtonLink>
        </div>

        <StatRow stats={stats} />
      </div>
    </section>
  );
}
