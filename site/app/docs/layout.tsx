import { DocsSidebar } from '@/components/docs/DocsSidebar';
import { Footer } from '@/components/layout/Footer';
import { TopBar } from '@/components/layout/TopBar';
import { fetchStats } from '@/lib/stats';

export const revalidate = 3600;

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const stats = await fetchStats();

  return (
    <>
      <TopBar stars={stats.stars} wide />

      <details className="border-b border-rule bg-panel lg:hidden">
        <summary className="cursor-pointer list-none px-[22px] py-3.5 font-mono text-[11px] tracking-[0.07em] text-ink-2 uppercase marker:hidden">
          Menu
        </summary>
        <div className="px-[22px] pt-1 pb-6">
          <DocsSidebar />
        </div>
      </details>

      <div className="mx-auto flex max-w-[1216px] px-[22px]">
        <aside className="hidden w-[236px] shrink-0 pr-6 lg:block">
          <div className="sticky top-[66px] max-h-[calc(100vh-66px)] overflow-y-auto py-9">
            <DocsSidebar />
          </div>
        </aside>
        <div className="min-w-0 flex-1 lg:pl-12">{children}</div>
      </div>

      <Footer version={stats.version} wide />
    </>
  );
}
