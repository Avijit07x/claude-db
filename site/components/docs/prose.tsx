import type { ReactNode } from 'react';

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function H2({ children }: { children: string }) {
  const code = IDENTIFIER.test(children);

  return (
    <h2
      id={slugify(children)}
      className={`m-0 scroll-mt-28 pt-12 pb-1 font-semibold first:pt-6 ${
        code
          ? 'font-mono text-[1.12rem] tracking-[-0.02em] text-accent'
          : 'display text-[1.28rem] tracking-[-0.01em]'
      }`}
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: string }) {
  return (
    <h3 id={slugify(children)} className="m-0 scroll-mt-28 pt-8 pb-1 text-[1rem] font-semibold">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="m-0 pt-4 text-[14.5px] leading-[1.72] text-ink-2">{children}</p>;
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-[22px] before:absolute before:top-[9px] before:left-[3px] before:size-[5px] before:rounded-full before:bg-accent/70">
      {children}
    </li>
  );
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[5px] border border-white/[0.06] bg-term px-[6px] py-[2px] font-mono text-[12.5px] whitespace-nowrap text-term-ink">
      {children}
    </code>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-medium text-accent underline decoration-accent/30 underline-offset-[3px] transition-colors hover:decoration-accent"
    >
      {children}
    </a>
  );
}

export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 flex gap-3.5 rounded-xl border border-rule bg-accent-wash/40 p-4">
      <svg
        viewBox="0 0 24 24"
        width={16}
        height={16}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        className="mt-[3px] shrink-0 text-accent"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4.5M12 8h.01" />
      </svg>
      <div className="min-w-0">
        <p className="m-0 mb-1 text-[13.5px] font-semibold text-ink">{title}</p>
        <div className="text-[13.5px] leading-[1.7] text-ink-2 [&>p]:m-0 [&>p]:pt-0">{children}</div>
      </div>
    </div>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <div className="mt-7 flex flex-col gap-8 border-l border-rule pl-8">{children}</div>;
}

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="absolute top-0 -left-[45px] flex size-[26px] items-center justify-center rounded-full border border-rule bg-panel font-mono text-[11px] font-bold text-accent tabular-nums">
        {n}
      </span>
      <h3 className="m-0 text-[0.97rem] font-semibold">{title}</h3>
      <div className="text-[14.5px] leading-[1.72] text-ink-2 [&>p:first-of-type]:pt-2">
        {children}
      </div>
    </div>
  );
}
