export function Path({ hops, nodes }: { hops: number; nodes: string[] }) {
  return (
    <figure className="m-0 mt-6 rounded-xl border border-rule bg-panel p-5">
      <figcaption className="mb-4 font-mono text-[10.5px] tracking-[0.07em] text-cold uppercase">
        Shortest path · {hops} hops
      </figcaption>
      <div className="flex flex-wrap items-center gap-y-2.5">
        {nodes.map((node, i) => (
          <span key={node} className="flex items-center">
            {i > 0 && (
              <svg
                viewBox="0 0 24 24"
                width={13}
                height={13}
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-1 shrink-0 text-cold"
              >
                <path d="M4 12h15M13.5 6.5 20 12l-6.5 5.5" />
              </svg>
            )}
            <span
              className={`rounded-lg border px-2 py-[5px] font-mono text-[11.5px] whitespace-nowrap ${
                i === 0 || i === nodes.length - 1
                  ? 'border-accent/25 bg-accent-wash text-accent'
                  : 'border-rule bg-term text-term-ink'
              }`}
            >
              {node}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}
