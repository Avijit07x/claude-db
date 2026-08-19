'use client';

import { useState } from 'react';

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const runnable = Boolean(lang) && lang !== 'text';

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="group relative mt-5 overflow-hidden rounded-xl border border-rule bg-term">
      <pre className="m-0 overflow-x-auto px-4 py-3.5 pr-28 font-mono text-[12.5px] leading-[1.8] tracking-[-0.02em] text-term-ink">
        <code>{code}</code>
      </pre>
      <div className="absolute top-[11px] right-3 flex items-center gap-2.5">
        {runnable && (
          <span className="font-mono text-[9.5px] tracking-[0.08em] text-term-dim uppercase">
            {lang}
          </span>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className={`cursor-pointer rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 font-mono text-[9.5px] text-white transition-all hover:border-accent hover:bg-accent focus-visible:opacity-100 ${
            runnable ? '' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>
    </div>
  );
}
