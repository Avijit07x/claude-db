import type { TypeRef } from '../../types.js';
import type { ImportFacts } from '../binding.js';
import { targetOf } from '../rebind.js';
import { here, qualifiedTarget } from './linking.js';

export function typeRef(segments: string[], own: string, facts: ImportFacts): TypeRef | undefined {
  const [first] = segments;
  if (!first) return undefined;
  if (segments.length > 1)
    return qualifiedTarget(own, { segments, at: segments.length - 1 }, facts);
  const imported = facts.named.get(first)?.[0];
  return imported ? targetOf(imported, first) : { name: first, link: here(own, facts.opens) };
}
