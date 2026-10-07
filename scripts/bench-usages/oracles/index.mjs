import * as go from './go.mjs';
import * as java from './java.mjs';
import * as kotlin from './kotlin.mjs';
import * as python from './python.mjs';
import * as rust from './rust.mjs';
import * as typescript from './typescript.mjs';

const ORACLES = { typescript, python, go, rust, java, kotlin };

export function oracleFor(language) {
  const oracle = ORACLES[language];
  if (!oracle) throw new Error(`no oracle for ${language}`);
  return oracle;
}

export const missingTool = (oracle) => oracle.requires?.() ?? null;
