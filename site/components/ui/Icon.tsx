import type { ReactNode, SVGProps } from 'react';

const STROKE: SVGProps<SVGSVGElement> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const PATHS = {
  github: (
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  ),
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  npm: (
    <>
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  changelog: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  issues: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5M12 16h.01" />
    </>
  ),
  flow: (
    <>
      <circle cx="18" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <path d="M6 15.4V4M18 8.6a9 9 0 0 1-9 9" />
    </>
  ),
  chart: <path d="M6 20v-4M12 20V10M18 20V5" />,
  license: <path d="M12 3l7 4v5c0 4.4-3 8.3-7 9-4-.7-7-4.6-7-9V7l7-4Z" />,
  recall: (
    <>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  graph: (
    <>
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.2 8.8H10.6a1.9 1.9 0 0 0 0 3.8h2.8a1.9 1.9 0 0 1 0 3.8H8.8" />
      <path d="M12 7v10" />
    </>
  ),
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  star: (
    <path d="M12 2.6a.53.53 0 0 1 .48.3l2.3 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.62a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 10.4a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16l2.3-4.68a.53.53 0 0 1 .48-.3Z" />
  ),
  replay: (
    <>
      <path d="M3 12a9 9 0 1 0 2.6-6.4" />
      <path d="M3 4v5h5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const octicon = name === 'github';
  const filled = octicon || name === 'star';

  return (
    <svg
      viewBox={octicon ? '0 0 16 16' : '0 0 24 24'}
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      {...(filled ? { fill: 'currentColor' } : STROKE)}
    >
      {PATHS[name]}
    </svg>
  );
}
