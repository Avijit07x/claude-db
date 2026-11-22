export const ENV_HELPER = 'src/util/env.ts';

export function readsProcessEnv(file, line) {
  return file !== ENV_HELPER && /\bprocess\.env\b/.test(line);
}
