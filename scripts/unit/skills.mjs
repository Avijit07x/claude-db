import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { install, uninstall } from '../../dist/cli/install.js';
import { refreshInstalled } from '../../dist/cli/refresh.js';
import { skillPathFor } from '../../dist/cli/paths.js';
import { SKILLS, SKILL_MARKER, describeSkills } from '../../dist/cli/skills.js';

const dist = new URL('../../dist', import.meta.url).pathname;
const packaged = (name) => readFileSync(join(dist, '..', 'skills', name, 'SKILL.md'), 'utf8');
const frontmatter = (text) => /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text);

export default async function run() {
  for (const { name } of SKILLS) {
    const match = frontmatter(packaged(name));
    check(
      `the packaged ${name} skill has a name equal to its folder and a description`,
      match?.[1] === name && (match?.[2]?.length ?? 0) > 40,
    );
  }
  for (const name of ['catchup', 'handoff']) {
    check(`the ${name} skill carries the ownership marker`, packaged(name).includes(SKILL_MARKER));
  }
  check(
    '/catchup writes nothing and /handoff saves with the handoff key and tag',
    packaged('catchup').includes('claude-db catchup') &&
      packaged('catchup').includes('Do not save anything') &&
      packaged('handoff').includes('`key`: `handoff`') &&
      packaged('handoff').includes('`tags`: `["handoff"]`'),
  );

  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const first = install(dist, 'project', repo);
    check(
      'install writes every skill',
      first.skills.length === SKILLS.length &&
        first.skills.every(
          ({ name, outcome }) =>
            outcome === 'written' &&
            readFileSync(skillPathFor('project', repo, name), 'utf8') === packaged(name),
        ),
      first.skills.map((skill) => `${skill.name}:${skill.outcome}`).join(' '),
    );
    check(
      'install twice is harmless',
      install(dist, 'project', repo).skills.every((s) => s.outcome === 'written'),
    );
    check(
      'doctor lists every skill as ok',
      describeSkills(repo) === 'skills   : /cdb-scan ok, /catchup ok, /handoff ok',
    );

    uninstall(dist, 'project', repo);
    check(
      'uninstall removes every skill',
      SKILLS.every(({ name }) => !existsSync(skillPathFor('project', repo, name))),
    );

    const yours = join(dir, 'yours');
    mkdirSync(yours);
    const ownPath = skillPathFor('project', yours, 'catchup');
    mkdirSync(join(ownPath, '..'), { recursive: true });
    writeFileSync(ownPath, '---\nname: catchup\ndescription: my own\n---\nmine\n');
    const kept = install(dist, 'project', yours);
    check(
      'a skill of the same name that is not ours is kept and reported',
      readFileSync(ownPath, 'utf8').endsWith('mine\n') &&
        kept.skills.find((skill) => skill.name === 'catchup')?.outcome === 'kept-yours' &&
        kept.skills.find((skill) => skill.name === 'handoff')?.outcome === 'written',
    );
    check(
      'and a refresh does not overwrite it',
      (refreshInstalled(dist, yours), readFileSync(ownPath, 'utf8').endsWith('mine\n')),
    );
    uninstall(dist, 'project', yours);
    check(
      'and uninstall does not delete it, while it still removes ours',
      existsSync(ownPath) && !existsSync(skillPathFor('project', yours, 'handoff')),
    );

    const upgraded = join(dir, 'upgraded');
    mkdirSync(upgraded);
    install(dist, 'project', upgraded);
    rmSync(join(skillPathFor('project', upgraded, 'catchup'), '..'), { recursive: true });
    rmSync(join(skillPathFor('project', upgraded, 'handoff'), '..'), { recursive: true });
    const added = refreshInstalled(dist, upgraded);
    check(
      'a refresh adds the new skills where claude-db is already installed',
      added.includes(skillPathFor('project', upgraded, 'catchup')) &&
        added.includes(skillPathFor('project', upgraded, 'handoff')),
      added.join(','),
    );

    const stale = join(dir, 'stale');
    mkdirSync(stale);
    install(dist, 'project', stale);
    writeFileSync(skillPathFor('project', stale, 'handoff'), `old text\n${SKILL_MARKER}\n`);
    check(
      'a stale skill of ours is repaired',
      refreshInstalled(dist, stale).length === 1 &&
        readFileSync(skillPathFor('project', stale, 'handoff'), 'utf8') === packaged('handoff'),
    );

    const clean = join(dir, 'clean');
    mkdirSync(clean);
    check(
      'a refresh creates no skill where claude-db was never installed',
      refreshInstalled(dist, clean).length === 0 &&
        SKILLS.every(({ name }) => !existsSync(skillPathFor('project', clean, name))),
    );
    const home = process.env.HOME;
    process.env.HOME = clean;
    const described = describeSkills(clean);
    process.env.HOME = home;
    check(
      'doctor says what is missing and how to fix it',
      described.includes('/catchup MISSING') && described.includes('claude-db install'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
