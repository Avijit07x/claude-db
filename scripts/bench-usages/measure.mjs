import { realpathSync } from 'node:fs';
import { extras, fileTarget, linkedUses, score } from './compare.mjs';
import { missingTool, oracleFor } from './oracles/index.mjs';
import { checkout, trackedFiles } from './repos.mjs';
import { hookTimes, refreshTimes, scanTimes } from './speed.mjs';

export async function measure(entry, settings) {
  const oracle = oracleFor(entry.language);
  const missing = missingTool(oracle);
  if (missing) return { name: entry.name, language: entry.language, skipped: missing };

  const root = realpathSync(checkout(entry, settings.dir));
  const runs = settings.speed ? settings.runs : 1;
  const { result, scanMs } = await scanTimes(root, runs);
  const files = trackedFiles(root);
  const truth = await oracle.expected({ root, files, result, entry, cacheDir: settings.dir });
  const linked = linkedUses(result, oracle.targetOf ?? fileTarget);
  const { buckets, expected, missed } = score({ root, entries: truth.entries, linked });
  const names = [...new Set(truth.entries.map((item) => item.name))];

  return {
    name: entry.name,
    language: entry.language,
    commit: entry.commit,
    files: result.files.length,
    note: truth.note,
    buckets,
    extra: extras(linked, expected, truth.inScope),
    scanMs: settings.speed ? scanMs : null,
    refreshMs: settings.speed ? await refreshTimes(root, result, runs) : null,
    hookMs: settings.speed ? await hookTimes(root, names, runs) : null,
    missed,
  };
}
