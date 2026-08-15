/**
 * Suppresses Node's ExperimentalWarning for `node:sqlite`.
 *
 * The warning is correct but useless here: the API is deliberate, not
 * accidental, and it fires on every hook invocation. Left alone it prints two
 * lines of noise before every prompt the user types, which makes real errors
 * from these hooks impossible to spot.
 *
 * Only that one warning is swallowed. Everything else is re-emitted to stderr
 * so genuine problems still surface.
 */
export function silenceSqliteWarning(): void {
  const original = process.listeners('warning');
  process.removeAllListeners('warning');

  process.on('warning', (warning: Error) => {
    const isSqliteExperimental =
      warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message);
    if (isSqliteExperimental) return;

    if (original.length > 0) {
      for (const listener of original) listener(warning);
    } else {
      process.stderr.write(`${warning.name}: ${warning.message}\n`);
    }
  });
}
