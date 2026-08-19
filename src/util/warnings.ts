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
