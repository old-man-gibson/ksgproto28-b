/**
 * The arcane school: the lexicon and the grammar that composes a sentence
 * into a spell. Port of the grammar half of the old `systems/arcane.ts` and
 * of `ARCANE_WORDS`. See README.md in this folder for the cut: legality,
 * word mastery, word skills and inscription are step 3.
 *
 * The school registers itself with `spellcraft` at module load. This system
 * holds no state.
 */
import { defineSystem } from '../../kernel';
import { registerSchool } from '../spellcraft';
import { ARCANE_WORDS, arcaneWords } from './defs';
import { composeArcane, splitWordId } from './grammar';
import { migrations } from './migrations';

export * from './defs';
export * from './grammar';

/**
 * A sentence's identity: its tokens in order, in collapsed form, so `fire
 * fire pierce` and a mastered `fire:2 pierce` are one spell. The arcane case
 * of the old `spellKey`.
 */
export function sentenceKey(words: readonly string[]): string {
  const tokens: { id: string; n: number }[] = [];
  for (const raw of words) {
    const { id, tier } = splitWordId(raw);
    const last = tokens[tokens.length - 1];
    if (last && last.id === id && ARCANE_WORDS[id]?.kind !== 'target') last.n += tier;
    else tokens.push({ id, n: tier });
  }
  return tokens.map((t) => (t.n > 1 ? `${t.id}${t.n}` : t.id)).join(',');
}

registerSchool('arcane', {
  key: (source) => sentenceKey(source.words),
  spec: (source) => composeArcane([...source.words]),
});

export default defineSystem<Record<string, never>>({
  id: 'arcane',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { arcane_words: arcaneWords },
});
