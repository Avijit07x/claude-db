import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const home = realpathSync(mkdtempSync(join(tmpdir(), 'home-')));
    mkdirSync(join(home, '.git'));
    const repo = join(home, 'work', 'app');
    const extra = join(home, 'work', 'app-extra');
    mkdirSync(join(repo, 'frontend'), { recursive: true });
    mkdirSync(join(extra, '.git'), { recursive: true });
    mkdirSync(join(repo, '.git'), { recursive: true });

    const slug = (path) => path.replace(/[/.]/g, '-');
    const transcript = (dir, name, cwd) => {
      mkdirSync(join(home, '.claude', 'projects', dir), { recursive: true });
      writeFileSync(
        join(home, '.claude', 'projects', dir, name),
        `${JSON.stringify({ type: 'user', cwd })}\n`,
      );
    };
    transcript(slug(repo), 'a.jsonl', repo);
    transcript(`${slug(repo)}-frontend`, 'b.jsonl', join(repo, 'frontend'));
    transcript(slug(extra), 'c.jsonl', extra);

    const probe = join(home, 'probe.mjs');
    writeFileSync(
      probe,
      `
    import { basename } from 'node:path';
    import { resolveProject } from ${JSON.stringify(new URL('../../dist/util/project.js', import.meta.url).href)};
    import { transcriptsFor } from ${JSON.stringify(new URL('../../dist/capture/index.js', import.meta.url).href)};
    process.stdout.write(JSON.stringify({
      guarded: resolveProject(${JSON.stringify(join(repo, 'frontend'))}),
      found: transcriptsFor(${JSON.stringify(repo)}).map((p) => basename(p)),
    }));
  `,
    );

    const out = JSON.parse(
      execFileSync(process.execPath, [probe], {
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      }),
    );

    check(
      'a dotfiles repo in $HOME does not swallow every project',
      out.guarded === repo,
      out.guarded,
    );
    check(
      'flush finds transcripts recorded from a subdirectory',
      out.found.includes('a.jsonl') && out.found.includes('b.jsonl'),
      out.found.join(','),
    );
    check(
      'flush rejects a neighbour the lossy slug collides with',
      !out.found.includes('c.jsonl'),
      out.found.join(','),
    );

    rmSync(home, { recursive: true, force: true });
  }
}
