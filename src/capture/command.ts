import type { ObservationKind } from '../types.js';

export interface CommandClassification {
  kind: ObservationKind;
  /** Short human label used as the observation title. */
  label: string;
}

/**
 * Decides whether a shell command is worth remembering.
 *
 * Agents run far more commands to *look* than to *change*, and the looking is
 * worthless later: nobody needs to recall that you grepped for easing curves
 * three weeks ago. Capturing it crowds out the handful that genuinely mattered.
 *
 * So this is an allowlist of consequential operations rather than a blocklist
 * of exploration. Exploration is unbounded in variety and impossible to
 * enumerate; the operations that change project state are a short, stable list.
 *
 * Returns null for anything unrecognised, which means "do not store".
 */
export function classifyCommand(command: string): CommandClassification | null {
  // Agents chain aggressively: `pnpm lint; echo "==="; git status`. Classifying
  // the raw string stores the whole chain as one title, most of which is
  // exploration. Split first, then label only the segment that qualified.
  for (const segment of splitSegments(command)) {
    for (const rule of RULES) {
      if (rule.pattern.test(segment)) {
        return { kind: rule.kind, label: `${rule.prefix}: ${truncate(segment, 64)}` };
      }
    }
  }
  return null;
}

/** Splits on shell separators, keeping each simple command intact. */
function splitSegments(command: string): string[] {
  return command
    .split(/(?:\|\||&&|[;\n|])/)
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .filter((segment) => segment.length > 0);
}

interface Rule {
  pattern: RegExp;
  kind: ObservationKind;
  prefix: string;
}

/** Optional leading `cd foo &&`-style noise is already stripped by splitting. */
const PM = '(?:npm|pnpm|yarn|bun|npx)';

/**
 * Every pattern is anchored to the start of a segment so a bare word inside a
 * filename cannot match. `sed -n '1,50p' test.ts` is exploration; `pnpm test`
 * is not, and only anchoring tells them apart.
 */
const RULES: Rule[] = [
  {
    pattern: new RegExp(`^${PM} (?:install|add|remove|uninstall|ci)\\b`, 'i'),
    kind: 'decision',
    prefix: 'Dependency change',
  },
  {
    pattern: new RegExp(`^(?:${PM} (?:run )?)?(?:test|jest|vitest|pytest|playwright)(?:\\s|$)`, 'i'),
    kind: 'bugfix',
    prefix: 'Test run',
  },
  {
    pattern: new RegExp(`^(?:${PM} (?:run )?)?(?:build|tsc|typecheck|lint)(?:\\s|$)`, 'i'),
    kind: 'context',
    prefix: 'Build',
  },
  {
    pattern: /^git (?:commit|merge|rebase|revert|cherry-pick|tag)\b/i,
    kind: 'decision',
    prefix: 'Git',
  },
  {
    pattern: /^git reset --hard\b/i,
    kind: 'decision',
    prefix: 'Git',
  },
  {
    pattern: /^(?:npx )?(?:prisma|drizzle-kit|knex|alembic|rails)\s+(?:migrate|db|migration)\b/i,
    kind: 'decision',
    prefix: 'Migration',
  },
  {
    pattern: /^(?:docker|docker-compose|kubectl|terraform|vercel|wrangler|fly)\s+(?!(?:ps|logs|status|get|describe|version|list|ls)\b)\S+/i,
    kind: 'context',
    prefix: 'Infra',
  },
];

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}...`;
}
