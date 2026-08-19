import { Icon, type IconName } from '@/components/ui/Icon';

const TAG = 'rounded bg-term px-1.5 py-[3px] font-mono text-[11.5px] text-term-ink';
const LANGS = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust'];

type Tile = { term: string; icon: IconName; span: string; detail: React.ReactNode };

const TILES: Tile[] = [
  {
    term: 'Recall',
    icon: 'recall',
    span: 'md:col-span-1',
    detail: (
      <>Automatic. Past decisions arrive on the next prompt. You never run a search command.</>
    ),
  },
  {
    term: 'Code graph',
    icon: 'graph',
    span: 'md:col-span-2',
    detail: (
      <>
        Real relationships: calls, imports, inherits, each labelled.
        <span className="mt-3 flex flex-wrap gap-1.5">
          {LANGS.map((lang) => (
            <code key={lang} className={TAG}>
              {lang}
            </code>
          ))}
        </span>
      </>
    ),
  },
  {
    term: 'Storage',
    icon: 'database',
    span: 'md:col-span-2',
    detail: (
      <>
        Your database. <code className={TAG}>SQLite</code> by default with zero setup, or point it
        at <code className={TAG}>Postgres</code> or <code className={TAG}>Mongo</code> to sync
        across machines.
      </>
    ),
  },
  {
    term: 'Privacy',
    icon: 'lock',
    span: 'md:col-span-1',
    detail: (
      <>
        Local. No account, no telemetry. Secrets and <code className={TAG}>.env</code> are never
        stored.
      </>
    ),
  },
  {
    term: 'Cost',
    icon: 'coin',
    span: 'md:col-span-3',
    detail: (
      <span className="flex flex-wrap items-baseline gap-x-9 gap-y-3">
        <span className="flex items-baseline gap-2.5">
          <span className="font-mono text-[27px] leading-none font-semibold text-ink tabular-nums">
            180
          </span>
          tokens a prompt
        </span>
        <span className="flex items-baseline gap-2.5">
          <span className="font-mono text-[27px] leading-none font-semibold text-accent tabular-nums">
            597
          </span>
          saved on a lookup
        </span>
        <span className="flex items-baseline gap-2">
          Measured, and reproducible with <code className={TAG}>npm run bench:ab</code>
        </span>
      </span>
    ),
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-[1140px] border-t border-rule px-[22px] py-[46px]">
      <h2 className="display m-0 mb-2 text-[1.15rem] font-semibold">What you actually get</h2>
      <p className="m-0 mb-7 max-w-[58ch] text-[13.5px] text-ink-2">
        Everything it does, and where your data lives.
      </p>
      <dl className="m-0 grid grid-cols-1 gap-3 md:grid-cols-3">
        {TILES.map(({ term, icon, span, detail }) => (
          <div key={term} className={`rounded-2xl bg-panel p-6 ${span}`}>
            <div className="mb-3 flex items-center gap-2.5">
              <Icon name={icon} size={17} className="shrink-0 text-accent" />
              <dt className="font-mono text-[10.5px] font-semibold tracking-[0.07em] text-ink uppercase">
                {term}
              </dt>
            </div>
            <dd className="m-0 text-[13.5px] leading-[1.65] text-ink-2">{detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
