'use client';

import { useState } from 'react';

const LABELS: Record<string, string> = {
  bash: 'Terminal',
  sh: 'Terminal',
  shell: 'Terminal',
  json: 'JSON',
};

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const label = lang ? LABELS[lang] : undefined;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  const button = (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy code"
      className="cursor-pointer rounded-md px-2 py-1 font-mono text-[11px] text-term-dim transition-colors hover:bg-white/10 hover:text-term-ink focus-visible:text-term-ink"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );

  return (
    <div className="group relative mt-5 overflow-hidden rounded-xl border border-rule bg-term">
      {label ? (
        <div className="flex items-center justify-between border-b border-white/10 py-1.5 pr-2 pl-4">
          <span className="font-mono text-[11px] tracking-[0.04em] text-term-dim">{label}</span>
          {button}
        </div>
      ) : (
        <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {button}
        </div>
      )}
      <pre className="scroll-term m-0 overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.7] text-term-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}
