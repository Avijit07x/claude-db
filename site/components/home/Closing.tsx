import { ButtonLink } from '@/components/ui/ButtonLink';
import { CommandBox } from '@/components/ui/CommandBox';
import { INSTALL } from '@/lib/site';

export function Closing({ saved }: { saved: number }) {
  return (
    <section className="mx-auto max-w-[1140px] border-t border-rule px-[22px] pt-[58px] pb-[26px]">
      <h2 className="display m-0 mb-2.5 text-[clamp(1.3rem,3.2vw,2rem)] font-bold text-balance">
        Your repo already told you this once.
      </h2>
      <p className="m-0 mb-6 max-w-[50ch] text-ink-2">
        Let Claude keep it. One lookup on this page saved {saved.toLocaleString()} tokens.
      </p>
      <div className="flex flex-wrap gap-3">
        <CommandBox command={INSTALL} />
        <ButtonLink href="/docs" icon="book">
          Docs
        </ButtonLink>
      </div>
    </section>
  );
}
