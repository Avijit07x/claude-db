const RUST_RAW_STRING = /^b?r(#*)"/;
const RUST_CHAR = /^'(?:\\u\{[0-9a-fA-F]+\}|\\.|[^\\'\n])'/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;
const TRIPLE = '"""';
const LITERAL_START = new Set(['"', "'", 'r', 'b']);
const LOOKAHEAD = 64;

const blankOf = (text) => text.replace(/[^\n]/g, ' ');

function lineCommentEnd(source, at) {
  const end = source.indexOf('\n', at);
  return end < 0 ? source.length : end;
}

function blockCommentEnd(source, at, nested) {
  let depth = 1;
  let index = at + 2;
  while (index < source.length) {
    if (nested && source.startsWith('/*', index)) {
      depth += 1;
      index += 2;
    } else if (source.startsWith('*/', index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return source.length;
}

function quotedEnd(source, at, quote) {
  let index = at + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index] === quote) return index + 1;
    else index += 1;
  }
  return source.length;
}

function closingAfter(source, at, closing) {
  const end = source.indexOf(closing, at);
  return end < 0 ? source.length : end + closing.length;
}

function literalEnd(source, at, options) {
  const rest = source.slice(at, at + LOOKAHEAD);
  const startsWord = at === 0 || !IDENTIFIER_CHAR.test(source[at - 1]);
  if (options.rust && startsWord) {
    const raw = RUST_RAW_STRING.exec(rest);
    if (raw) return closingAfter(source, at + raw[0].length, `"${raw[1]}`);
  }
  if (options.tripleQuotes && source.startsWith(TRIPLE, at)) {
    return closingAfter(source, at + TRIPLE.length, TRIPLE);
  }
  if (source[at] === '"') return quotedEnd(source, at, '"');
  if (options.rust && source[at] === "'") {
    const char = RUST_CHAR.exec(rest);
    return char ? at + char[0].length : null;
  }
  return null;
}

function keepEnds(text) {
  if (text.length < 2) return blankOf(text);
  return `${text[0]}${blankOf(text.slice(1, -1))}${text.at(-1)}`;
}

export function codeOnly(source, options = {}) {
  const parts = [];
  let start = 0;
  let index = 0;
  const skip = (end, replace) => {
    parts.push(source.slice(start, index), replace(source.slice(index, end)));
    index = end;
    start = end;
  };
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      skip(lineCommentEnd(source, index), blankOf);
      continue;
    }
    if (source.startsWith('/*', index)) {
      skip(blockCommentEnd(source, index, options.nested === true), blankOf);
      continue;
    }
    const end = LITERAL_START.has(source[index]) ? literalEnd(source, index, options) : null;
    if (end !== null) skip(end, keepEnds);
    else index += 1;
  }
  parts.push(source.slice(start));
  return parts.join('');
}
