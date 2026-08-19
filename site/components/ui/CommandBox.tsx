'use client';

import { useState } from 'react';

export function CommandBox({ command, compact = false }: { command: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div
      className={`flex items-center overflow-x-auto bg-term font-mono tracking-[-0.03em] text-white ${
        compact
          ? 'gap-2 rounded-lg px-3 py-2.5 text-[11.5px]'
          : 'flex-1 basis-[380px] gap-3 rounded-[10px] border border-rule px-4 py-[15px] text-[clamp(11px,2.1vw,14px)]'
      }`}
    >
      <span className="shrink-0 text-accent">$</span>
      <code className="whitespace-nowrap">{command}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy: ${command}`}
        className={`ml-auto shrink-0 cursor-pointer rounded-md bg-white/10 transition-colors hover:bg-accent ${
          compact ? 'px-2 py-1 text-[9.5px]' : 'px-3 py-1.5 text-[10.5px]'
        }`}
      >
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </div>
  );
}
