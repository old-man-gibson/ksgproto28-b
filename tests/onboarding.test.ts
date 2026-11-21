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
 * Step 4 port L: the Warden's two quests, Ilex (`psionic_shaper`) and the
 * bestiary. Call shape:
 * - `talkTo(state, bus, npc)` is the command `npcs/talk`; its old false is a
 *   result that is not `ok`. `hasMet` and `metKey` read the counters.
 * - `objectiveProgress(state, quest, i)` takes the reads and the quests slice.
 * - `state.quests.<id> = ...` is written through `patch`; the old
 *   `game.bus.emit({ type: 'craft', ... })` is the event `benches/crafted`.
 * - `recordKill(state, bus, id)` at `the_cages` is a `combat/kill` event
 *   with the player at `the_cages`; `state.bestiary` is the bestiary slice.
 *
 * `it.todo`, with what it waits for:
 * - "migration v47 → v48": the save starts at version 1 here.
 */
import { describe, expect, it } from 'vitest';
import { checkInscription, checkSentence, STARTER_LEXICON, wordUnlocked } from '../src/systems/arcane';
import { inscribe } from '../src/systems/arcane';
import type { CountersState } from '../src/systems/counters';
import { DEITY_LIST, deityKnown, favorWith, grantFavorAll, type DivineState } from '../src/systems/divine';
import type { SpellcraftState } from '../src/systems/spellcraft';
import { chooseSpell } from '../src/systems/tutorial';
import { benchCrafted } from '../src/systems/benches';
import { BESTIARY_FACTS, type BestiaryState } from '../src/systems/bestiary';
import { enemyKilled } from '../src/systems/combat';
import { hasMet, metKey, talkTo } from '../src/systems/npcs';
import { objectiveProgress, QUESTS, type QuestsState } from '../src/systems/quests';
import { SPOTS } from '../src/systems/world';
import { ask, emit, makeGame, patch, reads, slice } from './helpers';
import { patchWorld } from './worldHelpers';

const fresh = () => makeGame({ seed: 0 });
const counts = (g: ReturnType<typeof fresh>) => slice<CountersState>(g, 'counters').counts;
const questsOf = (g: ReturnType<typeof fresh>) => slice<QuestsState>(g, 'quests');

function at(g: ReturnType<typeof fresh>, spot: string): void {
  patchWorld(g, (w) => {
    w.spot = spot;
    if (!w.discovered.includes(spot)) w.discovered.push(spot);
  });
}

/** The kill a fight sends, of one specimen. */
function killOf(g: ReturnType<typeof fresh>, defId: string): void {
  emit(g, enemyKilled, {
    entity: 'm:test',
    defId,
    name: defId,
    level: 1,
    rewardLevel: 1,
    xp: 1,
    tags: [],
    lastHit: null,
    site: 'the_cages',
    boss: false,
    once: false,
  });
}

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

  it('the Nine Chapels, where the quest sends you, can teach a miracle', () => {
    // The objective, the prior and the spot all say miracles are learned
    // there; the Divine tab lives on the spellcrafting table.
    expect(SPOTS.the_nine_chapels.benches ?? []).toContain('spelltable');
    const i = QUESTS.a_taste_of_everything.objectives.findIndex((o) => o.type === 'stat' && o.key === 'miracles:learned');
    expect(QUESTS.a_taste_of_everything.objectives[i].desc).toContain('Nine Chapels');
  });
});

describe('meeting people (talk objectives)', () => {
  it('a greeting stamps met:* once, at the right spot only', () => {
    const g = fresh();
    expect(g.dispatch(talkTo({ npc: 'master_smith' })).ok).toBe(false); // she is at the Forges, you are not
    at(g, 'the_forges');
    expect(g.dispatch(talkTo({ npc: 'master_smith' })).ok).toBe(true);
    expect(hasMet(slice<CountersState>(g, 'counters'), 'master_smith')).toBe(true);
    expect(counts(g)[metKey('master_smith')]).toBe(1);
    expect(g.dispatch(talkTo({ npc: 'master_smith' })).ok).toBe(false); // already acquainted
    expect(counts(g)[metKey('master_smith')]).toBe(1);
  });

  it('talk objectives read greetings live — met before accepting still counts', () => {
    const g = fresh();
    at(g, 'the_sand');
    expect(g.dispatch(talkTo({ npc: 'dojo_master' })).ok).toBe(true);
    const quest = QUESTS.faces_of_threshold;
    // Not even accepted, and the dojo master's line is already satisfied.
    const i = quest.objectives.findIndex((o) => o.type === 'talk' && o.npcId === 'dojo_master');
    expect(objectiveProgress(reads(g), questsOf(g), quest, i)).toEqual({ current: 1, target: 1 });
  });

  it('stat objectives read their counters live', () => {
    const g = fresh();
    const quest = QUESTS.a_taste_of_everything;
    const i = quest.objectives.findIndex((o) => o.type === 'stat' && o.key === 'spells:inscribed');
    expect(objectiveProgress(reads(g), questsOf(g), quest, i).current).toBe(0);
    patch(g, (slices) => {
      slices.counters.counts['spells:inscribed'] = 1;
    });
    expect(objectiveProgress(reads(g), questsOf(g), quest, i)).toEqual({ current: 1, target: 1 });
  });

  it('bench work advances discipline craft objectives through the bus', () => {
    const g = fresh();
    const quest = QUESTS.a_taste_of_everything;
    patch(g, (slices) => {
      (slices.quests as QuestsState).quests.a_taste_of_everything = {
        status: 'active',
        progress: quest.objectives.map(() => 0),
      };
    });
    const i = quest.objectives.findIndex((o) => o.type === 'craft' && o.discipline === 'cooking');
    emit(g, benchCrafted, { discipline: 'cooking' });
    expect(questsOf(g).quests.a_taste_of_everything.progress[i]).toBe(1);
    // The alchemy line is untouched by a smelted ingot.
    const j = quest.objectives.findIndex((o) => o.type === 'craft' && o.discipline === 'alchemy');
    emit(g, benchCrafted, { discipline: 'craft', recipe: 'iron_ingot' });
    expect(questsOf(g).quests.a_taste_of_everything.progress[j]).toBe(0);
  });
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

  it("quest 1's favor makes the cheapest miracle exactly affordable", () => {
    const g = fresh();
    // Turn-in pays 1 + the quest's own favor reward.
    ask(g, grantFavorAll, { amount: 1 + (QUESTS.faces_of_threshold.rewards.favor ?? 0) });
    expect(favorWith(slice<DivineState>(g, 'divine'), 'usvylgr')).toBeGreaterThanOrEqual(5);
  });
});

describe('the cages (defined bestiary rates)', () => {
  it('caged kills unlock every fact exactly at its minKills, no rolls', () => {
    const g = fresh();
    at(g, 'the_cages');
    const kills = Math.max(...BESTIARY_FACTS.map((f) => f.minKills));
    for (let k = 1; k <= kills; k++) {
      killOf(g, 'forest_rat');
      const facts = slice<BestiaryState>(g, 'bestiary').entries.forest_rat.facts;
      for (const fact of BESTIARY_FACTS) {
        expect(facts.includes(fact.id), `${fact.id} at ${k} kills (minKills ${fact.minKills})`).toBe(k >= fact.minKills);
      }
    }
    expect(counts(g)['bestiary:entries']).toBe(1);
  });
});

describe('migration v47 → v48', () => {
  it.todo('an older save keeps the whole lexicon and pantheon (no importer of the old save; the save starts at version 1)');
});
