import { check } from '../lib/check.mjs';
import { createStore } from '../../dist/store/index.js';

export default async function run() {
  {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const home = mkdtempSync(join(tmpdir(), 'sweep-'));
    mkdirSync(join(home, '.claude-memory', 'cursors'), { recursive: true });
    mkdirSync(join(home, '.claude', 'projects', 'proj'), { recursive: true });
    writeFileSync(join(home, '.claude', 'projects', 'proj', 'live.jsonl'), '{}\n');
    for (const name of ['live', 'dead']) {
      writeFileSync(join(home, '.claude-memory', 'cursors', `${name}.offset`), '42');
    }

    const probe = join(home, 'probe.mjs');
    writeFileSync(
      probe,
      `
    import { sweepCursors } from ${JSON.stringify(new URL('../../dist/capture/index.js', import.meta.url).href)};
    process.stdout.write(String(sweepCursors()));
  `,
    );
    const removed = execFileSync(process.execPath, [probe], {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    });

    const left = readdirSync(join(home, '.claude-memory', 'cursors'));
    check(
      'a cursor whose transcript is gone is swept',
      removed === '1' && !left.includes('dead.offset'),
      left.join(','),
    );
    check(
      'a cursor with a transcript still on disk survives',
      left.includes('live.offset'),
      left.join(','),
    );

    const custom = join(home, 'custom-claude');
    mkdirSync(join(custom, 'projects', 'proj'), { recursive: true });
    writeFileSync(join(custom, 'projects', 'proj', 'live.jsonl'), '{}\n');
    rmSync(join(home, '.claude'), { recursive: true, force: true });
    for (const name of ['live', 'dead']) {
      writeFileSync(join(home, '.claude-memory', 'cursors', `${name}.offset`), '42');
    }
    const sweepWith = (configDir) =>
      execFileSync(process.execPath, [probe], {
        env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: configDir },
        encoding: 'utf8',
      });
    const customRemoved = sweepWith(custom);
    const customLeft = readdirSync(join(home, '.claude-memory', 'cursors'));
    check(
      'with CLAUDE_CONFIG_DIR set, a chat under that folder keeps its cursor',
      customRemoved === '1' &&
        customLeft.includes('live.offset') &&
        !customLeft.includes('dead.offset'),
      customLeft.join(','),
    );

    writeFileSync(join(home, '.claude-memory', 'cursors', 'dead.offset'), '42');
    const notAFolder = join(home, 'not-a-folder');
    writeFileSync(notAFolder, '');
    const unreadableRemoved = sweepWith(join(notAFolder, 'inside'));
    check(
      'a chat folder that cannot be read sweeps nothing',
      unreadableRemoved === '0' &&
        readdirSync(join(home, '.claude-memory', 'cursors')).includes('live.offset'),
      unreadableRemoved,
    );

    rmSync(home, { recursive: true, force: true });

    const cases = [
      ['mongodb://localhost:27017/recall', 'mongodb'],
      ['mongodb+srv://u:p@c.mongodb.net/recall', 'mongodb'],
      ['postgres://u:p@localhost:5432/recall', 'postgres'],
      ['postgresql://u:p@localhost:5432/recall', 'postgres'],
    ];
    for (const [uri, expected] of cases) {
      let outcome;
      try {
        const store = await createStore(uri);
        outcome = store.kind;
        await store.close();
      } catch (err) {
        outcome = /unsupported database scheme/i.test(err.message) ? 'unrouted' : expected;
      }
      check(`scheme routing: ${uri.split('://')[0]}`, outcome === expected, String(outcome));
    }

    let rejected = false;
    try {
      await createStore('redis://localhost:6379');
    } catch (err) {
      rejected = /unsupported database scheme/i.test(err.message);
    }
    check('unknown scheme is rejected with a clear error', rejected);
  }
}
