import { removeInstructions } from './instructions.js';
import { refreshHooks } from './install.js';
import { Scope, instructionsPathFor, settingsPathFor } from './paths.js';
import { refreshSkills } from './skills.js';

export function refreshInstalled(distDir: string, project: string): string[] {
  const refreshed: string[] = [];

  for (const scope of ['project', 'global'] as Scope[]) {
    const settingsPath = settingsPathFor(scope, project);
    if (refreshHooks(distDir, settingsPath)) refreshed.push(settingsPath);

    refreshed.push(...refreshSkills(distDir, scope, project));

    const instructionsPath = instructionsPathFor(scope, project);
    if (removeInstructions(instructionsPath)) refreshed.push(instructionsPath);
  }

  return refreshed;
}
