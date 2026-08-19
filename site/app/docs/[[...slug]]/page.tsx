import { notFound } from 'next/navigation';
import Link from 'next/link';
import { DocsToc } from '@/components/docs/DocsToc';
import { Pager } from '@/components/docs/Pager';
import { Icon } from '@/components/ui/Icon';
import { BODIES } from '@/content/docs';
import { DOCS, findDoc } from '@/lib/docs';
import { GITHUB } from '@/lib/site';
import { readToc } from '@/lib/toc';

export const dynamicParams = true;

export function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug ? [doc.slug] : [] }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const found = findDoc(slug?.[0] ?? '');
  if (!found) return {};
  return { title: `${found.doc.title} | claude-db`, description: found.doc.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const found = slug && slug.length > 1 ? null : findDoc(slug?.[0] ?? '');
  if (!found) notFound();

  const { doc, prev, next } = found;
  const Body = BODIES[doc.slug];
  if (!Body) notFound();

  return (
    <div className="flex gap-12 py-9">
      <article className="min-w-0 max-w-[40rem] flex-1 pb-20">
        <nav className="mb-3 flex items-center gap-1.5 font-mono text-[10.5px] text-cold">
          <Link href="/docs" className="no-underline transition-colors hover:text-accent">
            Docs
          </Link>
          <span>/</span>
          <span className="text-ink-2">{doc.group}</span>
          <span>/</span>
          <span className="text-ink-2">{doc.title}</span>
        </nav>

        <h1 className="display m-0 text-[clamp(1.65rem,3.2vw,2.05rem)] leading-[1.12] font-bold tracking-[-0.02em]">
          {doc.title}
        </h1>

        <div className="[&>p:first-of-type]:pt-1 [&>p:first-of-type]:text-[16.5px] [&>p:first-of-type]:leading-[1.65]">
          <Body />
        </div>

        <a
          href={`${GITHUB}/blob/main/site/content/docs/${doc.slug || 'introduction'}.mdx`}
          className="mt-12 inline-flex items-center gap-2 text-[13px] text-cold no-underline transition-colors hover:text-accent"
        >
          <Icon name="book" size={14} />
          Edit this page on GitHub
        </a>

        <Pager prev={prev} next={next} />
      </article>

      <aside className="hidden w-[176px] shrink-0 py-1 xl:block">
        <DocsToc toc={readToc(doc.slug)} />
      </aside>
    </div>
  );
}
