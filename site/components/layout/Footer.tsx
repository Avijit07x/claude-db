import { Icon, type IconName } from '@/components/ui/Icon';
import { AUTHOR, LINKS } from '@/lib/site';

const GROUPS: { head: string; links: { label: string; href: string; icon: IconName }[] }[] = [
  {
    head: 'Project',
    links: [
      { label: 'GitHub', href: LINKS.github, icon: 'github' },
      { label: 'npm', href: LINKS.npm, icon: 'npm' },
      { label: 'Changelog', href: LINKS.changelog, icon: 'changelog' },
      { label: 'Issues', href: LINKS.issues, icon: 'issues' },
    ],
  },
  {
    head: 'Reference',
    links: [
      { label: 'Readme', href: LINKS.docs, icon: 'book' },
      { label: 'How it works', href: LINKS.howItWorks, icon: 'flow' },
      { label: 'Benchmarks', href: LINKS.benchmarks, icon: 'chart' },
      { label: 'License', href: LINKS.license, icon: 'license' },
    ],
  },
];

export function Footer({ version, wide = false }: { version: string | null; wide?: boolean }) {
  return (
    <footer className="mt-10 border-t border-rule bg-panel">
      <div
        className={`mx-auto px-[22px] pt-12 pb-10 ${wide ? 'max-w-[1216px]' : 'max-w-[1140px]'}`}
      >
        <div className="flex flex-wrap justify-between gap-x-16 gap-y-10">
          <div className="max-w-[34ch]">
            <div className="mb-3 flex items-center gap-2.5">
              <img
                src="/logo.svg"
                alt=""
                width={26}
                height={26}
                className="block size-[26px] rounded-[7px]"
              />
              <span className="display text-[15px] font-bold">claude-db</span>
              {version && (
                <span className="rounded-md bg-accent-wash px-2 py-[3px] font-mono text-[10.5px] text-accent tabular-nums">
                  v{version}
                </span>
              )}
            </div>
            <p className="m-0 text-[13px] leading-[1.6] text-ink-2">
              Persistent memory and a real code graph for Claude Code. Local, free, and nothing to
              sign up for.
            </p>
          </div>

          {GROUPS.map((group) => (
            <nav key={group.head} className="min-w-[150px]">
              <p className="m-0 mb-3.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-cold uppercase">
                {group.head}
              </p>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="group inline-flex items-center gap-2.5 text-[13px] text-ink-2 no-underline transition-colors hover:text-accent"
                    >
                      <Icon
                        name={link.icon}
                        size={15}
                        className="shrink-0 text-cold transition-colors group-hover:text-accent"
                      />
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-11 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-6 text-[12px] text-ink-2">
          <span>Apache-2.0</span>
          <span className="text-cold">© 2026 {AUTHOR}</span>
          <a
            href="#top"
            className="group ml-auto inline-flex items-center gap-2 text-ink-2 no-underline transition-colors hover:text-accent"
          >
            Back to top
            <Icon
              name="arrowUp"
              size={14}
              className="shrink-0 text-cold transition-colors group-hover:text-accent"
            />
          </a>
        </div>
      </div>
    </footer>
  );
}
