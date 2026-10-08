const THIS_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const OTHER_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function formatDayTime(at: number, now = Date.now()): string {
  return `${formatDay(at, now)}, ${CLOCK.format(new Date(at))}`;
}

export function formatDay(at: number, now = Date.now()): string {
  const date = new Date(at);
  const format = date.getFullYear() === new Date(now).getFullYear() ? THIS_YEAR : OTHER_YEAR;
  return format.format(date);
}
