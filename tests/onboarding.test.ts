/**
 * Port of the old `tests/onboarding.test.ts`, the cases of the arcane port
 * (step 3): the floor 0 word at the Spellcrafting Table and the starter
 * lexicon; and of the divine port: the known gods. The cases keep their old
 * names.
 *
 * Call shape:
 * - `g.chooseTutorialSpell(word)` is the command `tutorial/choose-spell`.
 * - `checkInscription(state, words)` takes the reads of a kernel and the
 *   spellcraft slice; `checkSentence(state, words)` the reads.
 * - `g.inscribeArcane(words)` is the command `arcane/inscribe`; the old null
 *   is a result that is not `ok`.
 * - `state.stats[key]` is the `counters` slice.
 * - `wordUnlocked(state, id)` and `deityKnown(state, id)` take the reads.
 * - `grantFavorAll(state, bus, n)` is the request `divine/grant-favor-all`;
 *   `favorWith(state, id)` reads the divine slice.
 *
 * `it.todo`, each with what it waits for:
 * - "the Nine Chapels, where the quest sends you, can teach a miracle":
 *   `a_taste_of_everything` waits for the last of the six system people.
 * - "meeting people (talk objectives)": the old `talkTo` cases. The met
 *   counter is ported in `tests/quests.test.ts`; the objectives that read it
 *   belong to `faces_of_threshold`, which waits like the quest above. The
 *   bench case waits for crafting.
 * - "quest 1's favor makes the cheapest miracle exactly affordable": the
 *   record `faces_of_threshold` waits like the quest above.
 * - "the cages (defined bestiary rates)": the bestiary.
 * - "migration v47 → v48": the save starts at version 1 here.
 */
import { describe, expect, it } from 'vitest';
import { checkInscription, checkSentence, STARTER_LEXICON, wordUnlocked } from '../src/systems/arcane';
import { inscribe } from '../src/systems/arcane';
import type { CountersState } from '../src/systems/counters';
import { DEITY_LIST, deityKnown, favorWith, grantFavorAll, type DivineState } from '../src/systems/divine';
import type { SpellcraftState } from '../src/systems/spellcraft';
import { chooseSpell } from '../src/systems/tutorial';
import { ask, makeGame, patch, reads, slice } from './helpers';

const fresh = () => makeGame({ seed: 0 });
const counts = (g: ReturnType<typeof fresh>) => slice<CountersState>(g, 'counters').counts;

describe("the Warden's second quest, played from a tutorial save", () => {
  it('the floor 0 word is refused before Inscribe is pressed; a new sentence counts', () => {
    const g = fresh();
    expect(g.dispatch(chooseSpell({ word: 'fire' })).ok).toBe(true);
    // The first thing a newcomer types at the table is the word they hold.
    const book = () => slice<SpellcraftState>(g, 'spellcraft');
    const repeat = checkInscription(reads(g), book(), ['fire']);
    expect(repeat.ok).toBe(false);
    expect(repeat.reason).toBe('Already in your grimoire. Change or add a word to inscribe a new spell');
    expect(g.dispatch(inscribe({ words: ['fire'] })).ok).toBe(false);
    expect(counts(g)['spells:inscribed'] ?? 0).toBe(0);

    expect(checkInscription(reads(g), book(), ['ice']).ok).toBe(true);
    expect(g.dispatch(inscribe({ words: ['ice'] })).ok).toBe(true);
    expect(counts(g)['spells:inscribed']).toBe(1);
  });

  it.todo('the Nine Chapels, where the quest sends you, can teach a miracle (a_taste_of_everything: the last of the six system people)');
});

describe('meeting people (talk objectives)', () => {
  it.todo('a greeting stamps met:* once, at the right spot only (faces_of_threshold: the last of the six system people; the met counter is in tests/quests.test.ts)');
  it.todo('talk objectives read greetings live — met before accepting still counts (faces_of_threshold: the last of the six system people)');
  it.todo('stat objectives read their counters live (a_taste_of_everything: the last of the six system people)');
  it.todo('bench work advances discipline craft objectives through the bus (step 3: crafting)');
});

describe('the starter lexicon', () => {
  it('a fresh speaker holds eleven words and no more', () => {
    const g = fresh();
    for (const id of STARTER_LEXICON) expect(wordUnlocked(reads(g), id), id).toBe(true);
    expect(STARTER_LEXICON.size).toBe(11);
    expect(wordUnlocked(reads(g), 'stone')).toBe(false);
    expect(wordUnlocked(reads(g), 'gloom')).toBe(false);
  });

  it('checkSentence refuses a locked word as unknown, not as too advanced', () => {
    const g = fresh();
    const check = checkSentence(reads(g), ['stone']);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('Unknown word: "stone"');
    // Lift the latch and the refusal changes character (or disappears).
    patch(g, (slices) => {
      slices.counters.counts['flag:word:stone'] = 1;
    });
    const again = checkSentence(reads(g), ['stone']);
    expect(again.reason ?? '').not.toContain('Unknown word');
  });

  it('a starter word is never refused for being unknown', () => {
    const check = checkSentence(reads(fresh()), ['fire']);
    expect(check.reason ?? '').not.toContain('Unknown word');
  });
});

describe('the known gods', () => {
  it('a fresh life knows two, and favor accrues to them alone', () => {
    const g = fresh();
    expect(deityKnown(reads(g), 'denjalle')).toBe(true);
    expect(deityKnown(reads(g), 'usvylgr')).toBe(true);
    expect(deityKnown(reads(g), 'ikthelthe')).toBe(false);
    ask(g, grantFavorAll, { amount: 5 });
    const divine = slice<DivineState>(g, 'divine');
    expect(favorWith(divine, 'denjalle')).toBe(5);
    expect(favorWith(divine, 'usvylgr')).toBe(5);
    for (const d of DEITY_LIST) {
      if (d.id === 'denjalle' || d.id === 'usvylgr') continue;
      expect(favorWith(divine, d.id), d.id).toBe(0);
    }
  });

  it.todo(
    "quest 1's favor makes the cheapest miracle exactly affordable (faces_of_threshold: the last of the six system people. The turn-in favour is ported and tested in tests/divine.test.ts)",
  );
});

describe('the cages (defined bestiary rates)', () => {
  it.todo('caged kills unlock every fact exactly at its minKills, no rolls (the bestiary)');
});

describe('migration v47 → v48', () => {
  it.todo('an older save keeps the whole lexicon and pantheon (no importer of the old save; the save starts at version 1)');
});
