const FAKE =
  /fake|example|dummy|sample|placeholder|redact|changeme|not.?real|test|xxxx|abcdef|0123456789|1234567890/i;
const CANDIDATE = /[A-Za-z0-9_+-]{24,}/g;
const PUBLIC_SAMPLES = ['dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'];
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----\s+[A-Za-z0-9+/=]{40,}/g;
const PREFIXES = [
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
const HOME_PATH =
  /\/(?:home|Users)\/(?!user\/|you\/|dev\/|name\/|runner\/|me\/)[A-Za-z][\w.-]{2,}\//;

function entropy(text) {
  const counts = new Map();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / text.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}

function looksRandom(text) {
  return /[a-z]/.test(text) && /[A-Z]/.test(text) && /\d/.test(text) && entropy(text) >= 3.8;
}

export function scanText(file, text) {
  const findings = [];
  for (const match of text.matchAll(PRIVATE_KEY)) {
    const line = text.slice(0, match.index).split('\n').length;
    findings.push({ file, line, rule: 'secret-prefix', text: '-----BEGIN' });
  }
  text.split('\n').forEach((line, index) => {
    const at = index + 1;
    if (PUBLIC_SAMPLES.some((sample) => line.includes(sample))) return;
    for (const pattern of PREFIXES) {
      for (const match of line.matchAll(pattern)) {
        if (FAKE.test(match[0])) continue;
        findings.push({ file, line: at, rule: 'secret-prefix', text: match[0].slice(0, 10) });
      }
    }
    for (const match of line.matchAll(CANDIDATE)) {
      if (FAKE.test(match[0]) || !looksRandom(match[0])) continue;
      findings.push({ file, line: at, rule: 'random-token', text: match[0].slice(0, 10) });
    }
    const path = HOME_PATH.exec(line);
    if (path) findings.push({ file, line: at, rule: 'personal-path', text: path[0] });
  });
  return findings;
}
