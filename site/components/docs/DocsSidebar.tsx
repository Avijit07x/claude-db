'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { DOCS, GROUPS, href } from '@/lib/docs';

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <div key={group}>
          <p className="m-0 mb-1.5 px-2.5 font-mono text-[10px] font-semibold tracking-[0.09em] text-cold uppercase">
            {group}
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {DOCS.filter((doc) => doc.group === group).map((doc) => {
              const active = pathname === href(doc.slug);
              return (
                <li key={doc.slug}>
                  <Link
                    href={href(doc.slug)}
                    aria-current={active ? 'page' : undefined}
                    className={`relative block rounded-md px-2.5 py-[6px] text-[13.5px] no-underline transition-colors ${
                      active
                        ? 'bg-accent-wash/60 font-medium text-accent'
                        : 'text-ink-2 hover:bg-white/[0.03] hover:text-ink'
                    }`}
                  >
                    {doc.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
