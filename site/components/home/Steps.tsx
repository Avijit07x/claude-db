import { CommandBox } from '@/components/ui/CommandBox';

const STEPS = [
  {
    n: '01',
    title: 'Install it globally',
    body: 'One package, no native build, nothing to compile.',
    code: 'npm install -g claude-db',
  },
  {
    n: '02',
    title: 'Wire it to your repo',
    body: 'Run it inside the repo. Registers the hooks and MCP server, then restart Claude Code.',
    code: 'claude-db install --project',
  },
  {
    n: '03',
    title: 'Map the code once',
    body: 'Builds the symbol graph. Re-runs only re-parse what changed.',
    code: 'claude-db scan',
  },
];

export function Steps() {
  return (
    <section
      id="install"
      className="mx-auto max-w-[1140px] border-t border-rule px-[22px] py-[46px]"
    >
      <h2 className="display m-0 mb-[22px] text-[1.15rem] font-semibold">
        Running in about a minute
      </h2>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n} className="flex flex-col rounded-xl border border-rule bg-panel p-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-wash font-mono text-[11px] font-bold text-accent tabular-nums">
                {step.n}
              </span>
              <h3 className="m-0 text-[0.98rem] font-semibold">{step.title}</h3>
            </div>
            <p className="m-0 mb-4 text-[13.5px] leading-[1.6] text-ink-2">{step.body}</p>
            <div className="mt-auto">
              <CommandBox command={step.code} compact />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
