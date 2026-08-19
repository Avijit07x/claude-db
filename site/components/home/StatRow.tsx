import type { Stats } from '@/lib/stats';

function facts(stats: Stats): [string, string][] {
  const rows: ([string, string] | null)[] = [
    stats.weekly ? [stats.weekly.toLocaleString(), 'installs a week'] : null,
    stats.stars ? [stats.stars.toLocaleString(), 'stars on GitHub'] : null,
    stats.unpackedKb ? [`${Math.round(stats.unpackedKb / 102.4) / 10} MB`, 'installed size'] : null,
    ['Node 22.5+', 'nothing compiles'],
    ['Apache-2.0', 'free forever'],
  ];
  return rows.filter(Boolean) as [string, string][];
}

export function StatRow({ stats }: { stats: Stats }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 p-0 sm:flex sm:flex-wrap sm:gap-x-7">
      {facts(stats).map(([value, label], i) => (
        <div
          key={label}
          className={`flex flex-col gap-1 ${i > 0 ? 'sm:border-l sm:border-rule sm:pl-7' : ''}`}
        >
          <dd className="m-0 font-mono text-[17px] leading-none font-medium tracking-[-0.02em] text-ink tabular-nums">
            {value}
          </dd>
          <dt className="text-[12.5px] leading-none text-ink-2">{label}</dt>
        </div>
      ))}
    </dl>
  );
}
