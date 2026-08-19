import type { ObservationKind } from '../types.js';

export interface CommandClassification {
  kind: ObservationKind;
  label: string;
}

export function classifyCommand(command: string): CommandClassification | null {
  for (const segment of splitSegments(command)) {
    for (const rule of RULES) {
      if (rule.pattern.test(segment)) {
        return { kind: rule.kind, label: `${rule.prefix}: ${truncate(segment, 64)}` };
      }
    }
  }
  return null;
}

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

const PM = '(?:npm|pnpm|yarn|bun|npx)';

const RULES: Rule[] = [
  {
    pattern: new RegExp(`^${PM} (?:install|add|remove|uninstall|ci)\\b`, 'i'),
    kind: 'decision',
    prefix: 'Dependency change',
  },
  {
    pattern: new RegExp(
      `^(?:${PM} (?:run )?)?(?:test|jest|vitest|pytest|playwright)(?:\\s|$)`,
      'i',
    ),
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
    pattern:
      /^(?:docker|docker-compose|kubectl|terraform|vercel|wrangler|fly)\s+(?!(?:ps|logs|status|get|describe|version|list|ls)\b)\S+/i,
    kind: 'context',
    prefix: 'Infra',
  },
];

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}...`;
}
