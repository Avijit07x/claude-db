import type { CodeSymbol } from '../../types.js';

export interface Span {
  start: number;
  end: number;
  symbol: CodeSymbol;
}

export interface Extent extends Span {
  from: number;
  to: number;
}

const CALLABLE = new Set(['function', 'method', 'class']);

export function nearestAbove(line: number, spans: Span[]): CodeSymbol | null {
  let best: Span | null = null;
  for (const span of spans) {
    if (span.start > line) continue;
    if (!best || span.start > best.start) best = span;
  }
  return best?.symbol ?? null;
}

export function enclosing(line: number, spans: Span[]): CodeSymbol | null {
  let best: Span | null = null;
  let fallback: Span | null = null;
  for (const span of spans) {
    if (line < span.start || line > span.end) continue;
    const width = span.end - span.start;
    if (CALLABLE.has(span.symbol.kind)) {
      if (!best || width < best.end - best.start) best = span;
      continue;
    }
    if (span.start === line) continue;
    if (!fallback || width < fallback.end - fallback.start) fallback = span;
  }
  return (best ?? fallback)?.symbol ?? null;
}

export function container(inner: Extent, spans: Extent[]): CodeSymbol | null {
  let best: Extent | null = null;
  for (const span of spans) {
    if (span === inner || span.from > inner.from || span.to < inner.to) continue;
    if (span.from === inner.from && span.to === inner.to) continue;
    if (!best || span.to - span.from < best.to - best.from) best = span;
  }
  return best?.symbol ?? null;
}
