import { BLOCK_START, INSTRUCTIONS, writeInstructions } from './instructions.js';
import { Scope, instructionsPathFor, skillPathFor } from './paths.js';
import { readText, writeAtomic } from './files.js';
import { resolve } from 'node:path';

export function refreshInstalled(distDir: string, project: string): string[] {
  const refreshed: string[] = [];

  for (const scope of ['project', 'global'] as Scope[]) {
    const skillPath = skillPathFor(scope, project);
    const current = readText(skillPath);
    if (current.length > 0) {
      const packaged = readText(resolve(distDir, '..', 'skills', 'cdb-scan', 'SKILL.md'));
      if (packaged.length > 0 && packaged !== current) {
        writeAtomic(skillPath, packaged);
        refreshed.push(skillPath);
      }
    }

    const instructionsPath = instructionsPathFor(scope, project);
    const existing = readText(instructionsPath);
    if (existing.includes(BLOCK_START) && !existing.includes(INSTRUCTIONS)) {
      writeInstructions(instructionsPath);
      refreshed.push(instructionsPath);
    }
  }

  return refreshed;
}
