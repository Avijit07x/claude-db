import { Closing } from '@/components/home/Closing';
import { Features } from '@/components/home/Features';
import { Hero } from '@/components/home/Hero';
import { SplitDemo } from '@/components/home/SplitDemo';
import { Steps } from '@/components/home/Steps';
import { Footer } from '@/components/layout/Footer';
import { TopBar } from '@/components/layout/TopBar';
import { demo } from '@/lib/demo';
import { fetchStats } from '@/lib/stats';

export const revalidate = 3600;

export default async function Home() {
  const stats = await fetchStats();

  return (
    <>
      <TopBar stars={stats.stars} />
      <Hero stats={stats} />
      <SplitDemo demo={demo} />
      <Steps />
      <Features />
      <Closing saved={demo.scenarios[0]!.without.tokens - demo.scenarios[0]!.with.tokens} />
      <Footer version={stats.version} />
    </>
  );
}
