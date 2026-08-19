export interface Stats {
  stars: number | null;
  weekly: number | null;
  version: string | null;
  unpackedKb: number | null;
}

const REPO = 'https://api.github.com/repos/Avijit07x/claude-db';
const WEEKLY = 'https://api.npmjs.org/downloads/point/last-week/claude-db';
const REGISTRY = 'https://registry.npmjs.org/claude-db/latest';

export const REVALIDATE = 3600;
const TIMEOUT = 5000;

async function get<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
      next: { revalidate: REVALIDATE },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function fetchStats(): Promise<Stats> {
  const [repo, weekly, registry] = await Promise.all([
    get<{ stargazers_count: number }>(REPO),
    get<{ downloads: number }>(WEEKLY),
    get<{ version: string; dist?: { unpackedSize?: number } }>(REGISTRY),
  ]);

  const unpacked = registry?.dist?.unpackedSize;

  return {
    stars: repo?.stargazers_count ?? null,
    weekly: weekly?.downloads ?? null,
    version: registry?.version ?? null,
    unpackedKb: typeof unpacked === 'number' ? Math.round(unpacked / 1024) : null,
  };
}
