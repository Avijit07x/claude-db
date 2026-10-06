const PRIVATE_BLOCK = /<private>[\s\S]*?(?:<\/private>|$)/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const SECRET_NAME =
  '[A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*';
const UNQUOTED_SECRET = new RegExp(
  `\\b(${SECRET_NAME})(\\s*[:=]\\s*)(?=[^\\s"'\`,;]*[A-Za-z])[^\\s"'\`,;\\[]{8,}`,
  'gi',
);

export function redact(text: string): string {
  return text
    .replace(PRIVATE_BLOCK, '[redacted]')
    .replace(PRIVATE_KEY, '[redacted-private-key]')
    .replace(/\/\/[^\s:/@]+:[^\s@]+@/g, '//[redacted]@')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '[redacted-token]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-key]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted-token]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]')
    .replace(/(?<=(password|secret|token|api[_-]?key)"?\s*[:=]\s*)"[^"]+"/gi, '"[redacted]"')
    .replace(UNQUOTED_SECRET, '$1$2[redacted]');
}
