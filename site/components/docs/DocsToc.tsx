'use client';

import { useEffect, useState } from 'react';
import { slugify } from './prose';

export function DocsToc({ toc }: { toc: string[] }) {
  const [active, setActive] = useState('');

  useEffect(() => {
    const headings = toc
      .map((item) => document.getElementById(slugify(item)))
      .filter((node): node is HTMLElement => node !== null);
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) setActive(visible[0]!.target.id);
      },
      { rootMargin: '-90px 0px -70% 0px' },
    );

    headings.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [toc]);

  if (!toc.length) return null;

  return (
    <div className="sticky top-[98px]">
      <p className="m-0 mb-3 font-mono text-[10px] font-semibold tracking-[0.09em] text-cold uppercase">
        On this page
      </p>
      <ul className="m-0 flex list-none flex-col p-0">
        {toc.map((item) => {
          const id = slugify(item);
          return (
            <li key={item}>
              <a
                href={`#${id}`}
                className={`block border-l py-[5px] pl-3.5 text-[13px] leading-[1.45] no-underline transition-colors ${
                  active === id
                    ? 'border-accent font-medium text-accent'
                    : 'border-rule text-ink-2 hover:border-cold hover:text-ink'
                }`}
              >
                {item}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
