import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readText, removeIfEmpty, writeAtomic } from './files.js';
import type { Scope } from './paths.js';
import { skillPathFor } from './paths.js';

export const SKILL_MARKER = 'Shipped with claude-db.';

export interface SkillSpec {
  name: string;
  claimsExisting: boolean;
}

export const SKILLS: readonly SkillSpec[] = [
  { name: 'cdb-scan', claimsExisting: true },
  { name: 'catchup', claimsExisting: false },
  { name: 'handoff', claimsExisting: false },
];

export type SkillInstallOutcome = 'written' | 'kept-yours' | 'missing-source';

export interface SkillInstallResult {
  name: string;
  path: string;
  outcome: SkillInstallOutcome;
}

function packagedBody(distDir: string, spec: SkillSpec): string {
  return readText(resolve(distDir, '..', 'skills', spec.name, 'SKILL.md'));
}

function isOurs(spec: SkillSpec, installedBody: string): boolean {
  return spec.claimsExisting || installedBody.includes(SKILL_MARKER);
}

export function installSkills(
  distDir: string,
  scope: Scope,
  project: string,
): SkillInstallResult[] {
  return SKILLS.map((spec) => {
    const path = skillPathFor(scope, project, spec.name);
    const body = packagedBody(distDir, spec);
    if (body.length === 0) return { name: spec.name, path, outcome: 'missing-source' };

    const installed = readText(path);
    if (installed.length > 0 && !isOurs(spec, installed)) {
      return { name: spec.name, path, outcome: 'kept-yours' };
    }
    writeAtomic(path, body);
    return { name: spec.name, path, outcome: 'written' };
  });
}

export function refreshSkills(distDir: string, scope: Scope, project: string): string[] {
  const installedHere = SKILLS.some(
    (spec) => readText(skillPathFor(scope, project, spec.name)).length > 0,
  );
  if (!installedHere) return [];

  const refreshed: string[] = [];
  for (const spec of SKILLS) {
    const path = skillPathFor(scope, project, spec.name);
    const installed = readText(path);
    const body = packagedBody(distDir, spec);
    const foreign = installed.length > 0 && !isOurs(spec, installed);
    if (body.length === 0 || foreign || body === installed) continue;
    writeAtomic(path, body);
    refreshed.push(path);
  }
  return refreshed;
}

export function removeSkills(scope: Scope, project: string): void {
  for (const spec of SKILLS) {
    const path = skillPathFor(scope, project, spec.name);
    if (!isOurs(spec, readText(path))) continue;
    rmSync(dirname(path), { recursive: true, force: true });
  }
  if (scope !== 'project') return;
  const skillsDir = dirname(dirname(skillPathFor(scope, project)));
  removeIfEmpty(skillsDir);
  removeIfEmpty(dirname(skillsDir));
}

export function describeSkills(project: string): string {
  const scopes: Scope[] = ['project', 'global'];
  const parts = SKILLS.map((spec) => {
    const found = scopes.some(
      (scope) => readText(skillPathFor(scope, project, spec.name)).length > 0,
    );
    return found ? `/${spec.name} ok` : `/${spec.name} MISSING`;
  });
  const missing = parts.some((part) => part.endsWith('MISSING'));
  const line = `skills   : ${parts.join(', ')}`;
  return missing ? `${line}\n           fix with: claude-db install` : line;
}
