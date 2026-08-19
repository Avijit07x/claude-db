'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { label: 'Install', href: '/#install' },
  { label: 'Docs', href: '/docs' },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="hidden shrink-0 items-center gap-1 sm:flex">
      {LINKS.map((link) => {
        const active = link.href !== '/#install' && pathname.startsWith(link.href);
        return (
          <Link
            key={link.label}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`px-2.5 py-1.5 text-[13.5px] transition-colors ${
              active
                ? 'font-medium text-ink underline decoration-accent decoration-2 underline-offset-[7px]'
                : 'text-ink-2 no-underline hover:text-ink'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
