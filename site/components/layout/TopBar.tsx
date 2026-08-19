import Link from 'next/link';
import { NavLinks } from './NavLinks';
import { Icon } from '@/components/ui/Icon';
import { LINKS } from '@/lib/site';

export function TopBar({ stars, wide = false }: { stars: number | null; wide?: boolean }) {
  return (
    <div className="sticky top-0 z-50 border-b border-rule bg-panel">
      <div
        className={`mx-auto flex h-[66px] items-center gap-2.5 px-[22px] ${
          wide ? 'max-w-[1216px]' : 'max-w-[1140px]'
        }`}
      >
        <Link
          href="/"
          aria-label="claude-db home"
          className="flex shrink-0 items-center gap-2.5 no-underline transition-opacity hover:opacity-80"
        >
          <img
            src="/logo.svg"
            alt=""
            width={32}
            height={32}
            className="block size-8 shrink-0 rounded-[8px]"
          />
          <span className="display text-[17px] font-bold whitespace-nowrap text-ink">claude-db</span>
        </Link>
        <span className="flex-1" />
        <NavLinks />
        <a
          href={LINKS.github}
          aria-label={stars === null ? 'GitHub' : `${stars.toLocaleString()} stars on GitHub`}
          className="ml-3 flex shrink-0 items-center gap-2.5 rounded-[8px] border border-rule bg-panel px-2.5 py-[6px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          <Icon name="github" size={15} />
          {stars === null ? (
            <span className="font-mono text-[12.5px] leading-none">GitHub</span>
          ) : (
            <span className="flex items-center gap-1.5 border-l border-rule pl-2.5">
              <Icon name="star" size={12} className="text-accent" />
              <span className="font-mono text-[12.5px] leading-none tabular-nums">
                {stars.toLocaleString()}
              </span>
            </span>
          )}
        </a>
      </div>
    </div>
  );
}
