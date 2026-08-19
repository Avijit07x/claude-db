import Link from 'next/link';
import { TopBar } from '@/components/layout/TopBar';

export default function NotFound() {
  return (
    <>
      <TopBar stars={null} />
      <main className="mx-auto max-w-[1140px] px-[22px] py-24">
        <p className="m-0 mb-3 font-mono text-[10.5px] tracking-[0.08em] text-accent uppercase">
          404
        </p>
        <h1 className="display m-0 mb-3 text-[clamp(1.7rem,3.4vw,2.2rem)] font-bold tracking-[-0.02em]">
          That page does not exist
        </h1>
        <p className="m-0 mb-8 max-w-[52ch] text-[15px] leading-[1.7] text-ink-2">
          The link may be out of date, or the page may have been renamed. The docs index lists
          everything that does exist.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/docs"
            className="inline-flex items-center rounded-[10px] border border-rule bg-panel px-[18px] py-3 text-sm font-medium text-ink no-underline transition-colors hover:border-accent hover:text-accent"
          >
            Read the docs
          </Link>
          <Link
            href="/"
            className="inline-flex items-center rounded-[10px] border border-rule bg-panel px-[18px] py-3 text-sm font-medium text-ink no-underline transition-colors hover:border-accent hover:text-accent"
          >
            Back home
          </Link>
        </div>
      </main>
    </>
  );
}
