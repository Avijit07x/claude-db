import { Icon, type IconName } from './Icon';

export function ButtonLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] border border-rule bg-panel px-[18px] py-3 text-sm font-medium text-ink no-underline transition-colors hover:border-accent hover:text-accent max-sm:w-full sm:py-0"
    >
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </a>
  );
}
