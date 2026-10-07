const HEADER = '=== ';
const EXPECTED = `${HEADER}expected`;

const contentOf = (lines) => (lines.length > 0 ? `${lines.join('\n')}\n` : '');

export function parseFixture(text) {
  const files = {};
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith(HEADER)) {
      current = { name: line, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  let expected = [];
  for (const section of sections) {
    if (section.name === EXPECTED) expected = section.lines.filter((line) => line.length > 0);
    else files[section.name.slice(HEADER.length)] = contentOf(section.lines);
  }
  return { files, expected };
}

export function writeFixture(files, expected) {
  const sources = Object.entries(files).map(([path, text]) => `${HEADER}${path}\n${text}`);
  return `${sources.join('')}${EXPECTED}\n${expected.map((line) => `${line}\n`).join('')}`;
}

const placeOf = (symbol) => `${symbol.file}:${symbol.line} ${symbol.name}`;

const byPlace = (a, b) =>
  a.group - b.group ||
  a.file.localeCompare(b.file) ||
  a.line - b.line ||
  a.text.localeCompare(b.text);

export function describeGraph(symbols, edges) {
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const target = (edge) => {
    const symbol = byId.get(edge.dstId);
    return symbol ? placeOf(symbol) : 'nothing';
  };
  const symbolLines = symbols.map((symbol) => ({
    group: 0,
    file: symbol.file,
    line: symbol.line,
    text: `symbol ${placeOf(symbol)} ${symbol.kind}`,
  }));
  const edgeLines = edges.map((edge) => ({
    group: 1,
    file: edge.file,
    line: edge.line,
    text:
      `edge ${edge.file}:${edge.line} ${edge.srcName} ${edge.relation} ${edge.dstName} -> ` +
      `${target(edge)} ${edge.confidence} ${edge.score}`,
  }));
  return [...symbolLines, ...edgeLines].sort(byPlace).map((entry) => entry.text);
}

export function differences(expected, actual) {
  const counts = new Map();
  for (const line of actual) counts.set(line, (counts.get(line) ?? 0) + 1);
  const missing = [];
  for (const line of expected) {
    const left = counts.get(line) ?? 0;
    if (left === 0) missing.push(`- ${line}`);
    else counts.set(line, left - 1);
  }
  const extra = [...counts].flatMap(([line, left]) => Array(left).fill(`+ ${line}`));
  return [...missing, ...extra];
}
