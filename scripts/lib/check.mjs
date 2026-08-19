let failures = 0;

export const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

export function report(name) {
  if (failures > 0) {
    console.error(`\n${failures} ${name} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${name} checks passed.`);
}
