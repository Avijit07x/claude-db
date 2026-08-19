import { classifyCommand } from '../dist/capture/command.js';

const noise = [
  "sed -n '1,50p' npm/scripts/check-icon-naming.ts",
  'test.ts; echo "=== check-icon-naming ==="; sed -n \'1,50p\' npm/scripts/x.ts',
  'cat test.ts',
  'grep -rn "test" src/',
  'ls npm/scripts/ | grep test',
  'cd /Users/user/Personal/animateicons; echo "=== icons using times arrays ==="; grep -rl',
  'cd /Users/user/Personal/animateicons; for f in wifi heart trash-2 refresh-cw; do echo $f; done',
  'node docs/tools/icon-status.mjs 2>&1 | head -30',
  'head -60 docs/HUGE_ICON_SPECS.md && grep -n "^#"',
  'ls -la docs/ && wc -l docs/*.md',
  'cd /Users/user/Personal/animateicons; echo "=== em dashes ==="; grep -c "—" docs',
  'find . -maxdepth 3 -iname "*.md" -not -path "./node_modules/*"',
  'git status',
  'git log --oneline -10',
  'cat package.json',
];
const signal = [
  'pnpm lint 2>&1 | tail -15; echo "=== git status ==="; git status --short',
  'pnpm test 2>&1 | tail -25',
  'pnpm typecheck 2>&1 | tail -20',
  'cd /repo && pnpm build',
  'pnpm install framer-motion',
  'npm run test',
  'pnpm build',
  'git commit -m "add huge icon specs"',
  'npx prisma migrate dev',
  'npm run typecheck',
  'yarn add -D vitest',
  'git rebase main',
];

let bad = 0;
console.log('SHOULD BE DROPPED (exploration):');
for (const c of noise) {
  const r = classifyCommand(c);
  if (r) {
    bad++;
    console.log(`  KEPT (wrong): ${c.slice(0, 55)} -> ${r.label}`);
  }
}
if (bad === 0) console.log(`  all ${noise.length} correctly dropped`);

console.log('\nSHOULD BE KEPT (consequential):');
for (const c of signal) {
  const r = classifyCommand(c);
  if (!r) {
    bad++;
    console.log(`  DROPPED (wrong): ${c}`);
  } else console.log(`  ${r.kind.padEnd(9)} ${r.label}`);
}
console.log(bad === 0 ? '\nFilter correct.' : `\n${bad} misclassified.`);
process.exit(bad ? 1 : 0);
