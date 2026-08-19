import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { href, type DocMeta } from '@/lib/docs';

export function Pager({ prev, next }: { prev: DocMeta | null; next: DocMeta | null }) {
  return (
    <div className="mt-14 flex gap-3 border-t border-rule pt-7">
      {prev && (
        <Link
          href={href(prev.slug)}
          className="group flex flex-1 items-center gap-3 rounded-xl border border-rule bg-panel px-4 py-3.5 no-underline transition-colors hover:border-accent"
        >
          <Icon
            name="arrowUp"
            size={15}
            className="shrink-0 -rotate-90 text-cold transition-colors group-hover:text-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] tracking-[0.07em] text-cold uppercase">
              Previous
            </span>
            <span className="text-[13.5px] font-medium text-ink transition-colors group-hover:text-accent">
              {prev.title}
            </span>
          </span>
        </Link>
      )}
      {next && (
        <Link
          href={href(next.slug)}
          className="group ml-auto flex flex-1 items-center justify-end gap-3 rounded-xl border border-rule bg-panel px-4 py-3.5 text-right no-underline transition-colors hover:border-accent"
        >
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] tracking-[0.07em] text-cold uppercase">Next</span>
            <span className="text-[13.5px] font-medium text-ink transition-colors group-hover:text-accent">
              {next.title}
            </span>
          </span>
          <Icon
            name="arrowUp"
            size={15}
            className="shrink-0 rotate-90 text-cold transition-colors group-hover:text-accent"
          />
        </Link>
      )}
    </div>
  );
}
