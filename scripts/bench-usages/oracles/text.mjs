import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { codeOnly } from './lexer.mjs';

export const withoutComments = (source) => codeOnly(source, { nested: true, tripleQuotes: true });

export const dirOf = (file) => (file.includes('/') ? dirname(file) : '.');

export function readAll(root, files) {
  const sources = new Map();
  for (const file of files) {
    try {
      sources.set(file, readFileSync(join(root, file), 'utf8'));
    } catch {
      continue;
    }
  }
  return sources;
}

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
