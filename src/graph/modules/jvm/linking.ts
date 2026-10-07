import type { AstNode } from '../../parser.js';
import type { ModuleLink, Reference } from '../../types.js';
import { addNamed } from '../binding.js';
import type { ImportFacts, Target } from '../binding.js';

export const CLASS_LIKE = /^[A-Z]/;

export interface Chain {
  segments: string[];
  at: number;
}

export interface ImportPath {
  segments: string[];
  at: AstNode;
  span: AstNode;
  wildcard: boolean;
  member: boolean;
  alias?: string;
}

export const here = (own: string, opens: string[]): ModuleLink => ({
  specifier: own,
  strict: true,
  opens,
});

export function addImport(facts: ImportFacts, path: ImportPath): void {
  const { wildcard, member: hasMember, alias, at, span } = path;
  const segments = [...path.segments];
  if (wildcard) facts.opens.push(segments.join('.'));

  const member = hasMember && !wildcard ? segments.pop() : undefined;
  const first = segments.findIndex((segment) => CLASS_LIKE.test(segment));
  if (wildcard && first < 0) return;
  const cut = first < 0 ? segments.length - 1 : first;
  const specifier = segments.slice(0, cut).join('.');
  const classes = segments.slice(cut);
  const innermost = classes.at(-1);
  if (!innermost) return;

  classes.forEach((name, index) => {
    const via = index === 0 ? {} : { via: [classes[index - 1] ?? ''] };
    const imported = { name, link: { specifier, ...via } };
    facts.sites.push({ at, span, imported });
    if (!hasMember && !wildcard && index === classes.length - 1) {
      addNamed(facts, alias ?? name, imported);
    }
  });

  if (!member) return;
  const imported = { name: member, link: { specifier, via: [innermost] } };
  addNamed(facts, alias ?? member, imported);
  facts.sites.push({ at, span, imported });
}

export function qualifiedTarget(own: string, chain: Chain, facts: ImportFacts): Target | undefined {
  const { segments, at } = chain;
  const first = segments.findIndex((segment) => CLASS_LIKE.test(segment));
  const name = segments[at];
  if (!name || first < 0 || at < first) return undefined;

  const imported = first === 0 ? facts.named.get(segments[0] ?? '')?.[0] : undefined;
  const specifier =
    imported?.link.specifier ?? (first === 0 ? own : segments.slice(0, first).join('.'));
  if (at > first) return { name, link: { specifier, via: [segments[at - 1] ?? ''], strict: true } };
  if (imported) return undefined;
  return { name, link: first === 0 ? here(own, facts.opens) : { specifier, strict: true } };
}

export function referenceTarget(
  own: string,
  given: Reference,
  facts: ImportFacts,
): Target | undefined {
  const segments = given.name.split('.');
  const first = segments.findIndex((segment) => CLASS_LIKE.test(segment));
  if (first < 0) return undefined;

  const specifier = first === 0 ? own : segments.slice(0, first).join('.');
  const owner = segments.slice(first).at(-2);
  const constructs = given.relation === 'calls' && CLASS_LIKE.test(segments.at(-1) ?? '');
  if (given.relation === 'calls' && !constructs) {
    return owner ? { name: given.name, link: { specifier, via: [owner] } } : undefined;
  }
  const alone = first === 0 ? here(own, facts.opens) : { specifier, strict: true };
  return { name: given.name, link: owner ? { specifier, via: [owner], strict: true } : alone };
}
