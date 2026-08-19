import type { MDXComponents } from 'mdx/types';
import type { ReactElement } from 'react';
import { Cards } from '@/components/docs/Cards';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { Flow } from '@/components/docs/Flow';
import { Path } from '@/components/docs/Path';
import { A, C, Callout, H2, H3, LI, P, Step, Steps } from '@/components/docs/prose';

type PreProps = { children?: ReactElement<{ children?: string; className?: string }> };

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: ({ children }) => <H2>{String(children)}</H2>,
    h3: ({ children }) => <H3>{String(children)}</H3>,
    p: ({ children }) => <P>{children}</P>,
    a: ({ href, children }) => <A href={href ?? '#'}>{children}</A>,
    ul: ({ children }) => (
      <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0 text-[14.5px] leading-[1.7] text-ink-2">
        {children}
      </ul>
    ),
    li: ({ children }) => <LI>{children}</LI>,
    strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
    code: ({ children, className }) =>
      className ? <code className={className}>{children}</code> : <C>{children}</C>,
    pre: ({ children }: PreProps) => {
      const lang = children?.props?.className?.replace('language-', '');
      return <CodeBlock code={String(children?.props?.children ?? '').trimEnd()} lang={lang} />;
    },
    table: ({ children }) => (
      <div className="mt-5 overflow-x-auto rounded-xl border border-rule">
        <table className="w-full border-collapse text-left text-[13.5px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-panel">{children}</thead>,
    tr: ({ children }) => <tr className="border-b border-rule last:border-0">{children}</tr>,
    th: ({ children }) => (
      <th className="border-b border-rule px-4 py-3 font-mono text-[10.5px] font-semibold tracking-[0.07em] text-cold uppercase">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-4 py-3 align-top leading-[1.65] text-ink-2">{children}</td>
    ),
    blockquote: ({ children }) => (
      <div className="mt-5 rounded-xl border border-rule bg-panel p-4 text-[13.5px] leading-[1.7] text-ink-2">
        {children}
      </div>
    ),
    Callout,
    Cards,
    Flow,
    Path,
    Steps,
    Step,
    ...components,
  };
}
