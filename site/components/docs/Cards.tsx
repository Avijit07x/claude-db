import { Icon, type IconName } from '@/components/ui/Icon';

export function Cards({
  items,
}: {
  items: { icon: IconName; title: string; body: string }[];
}) {
  return (
    <div className="mt-6 flex flex-col gap-2.5">
      {items.map((item) => (
        <div key={item.title} className="flex gap-4 rounded-xl border border-rule bg-panel p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-wash">
            <Icon name={item.icon} size={17} className="text-accent" />
          </span>
          <div className="min-w-0">
            <p className="m-0 mb-1 text-[14px] font-semibold text-ink">{item.title}</p>
            <p className="m-0 text-[13.5px] leading-[1.65] text-ink-2">{item.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
