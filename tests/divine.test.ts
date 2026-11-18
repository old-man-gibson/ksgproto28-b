/**
 * The divine port of step 3: receiving a miracle, floating favour, meeting a
 * god, and the panel's view. New file: the old build tested these inside
 * `spellcraft.test.ts` (ported there), `onboarding.test.ts` (ported there)
 * and `rarefinds.test.ts` (the votive token, below).
 *
 * The old "Temple: the first token is +2 with every god now and later;
 * later ones are floating favor" case is split. The token itself runs in
 * `tests/consumables.test.ts` since the alchemy port. Its divine half runs here: the counters the
 * token writes (`favor:floating`, `votive:baseline`) are set with `patch`,
 * `g.assignFloatingFavor(id)` is the command `divine/assign-favor`, and
 * `meetDeity(state, bus, id)` is the request `divine/meet`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { CountersState } from '../src/systems/counters';
import {
  assignFavor,
  deityKnown,
  floatingFavor,
  learnMiracle,
  meetDeity,
  MIRACLE_LIST,
  type DivineState,
  type DivineView,
} from '../src/systems/divine';
import type { LogState } from '../src/systems/log';
import { latentXp, type SkillsState } from '../src/systems/skills';
import type { SpellcraftState } from '../src/systems/spellcraft';
import { ask, makeGame, patch, reads, slice } from './helpers';

const fresh = (seed = 1): Kernel => makeGame({ seed });

const favorOf = (g: Kernel) => slice<DivineState>(g, 'divine').favor;
const counterOf = (g: Kernel, key: string) => slice<CountersState>(g, 'counters').counts[key] ?? 0;
const logOf = (g: Kernel) => slice<LogState>(g, 'log').log.map((l) => l.msg);

function giveFavor(g: Kernel, deity: string, amount: number): void {
  patch(g, (slices) => {
    const favor = (slices.divine as DivineState).favor;
    favor[deity] = (favor[deity] ?? 0) + amount;
  });
}

function setCounters(g: Kernel, values: Record<string, number>): void {
  patch(g, (slices) => Object.assign((slices.counters as CountersState).counts, values));
}

describe('receiving a miracle', () => {
  it('spends the favour, writes the book, counts it, logs it, and trains the divine skills', () => {
    const g = fresh();
    giveFavor(g, 'usvylgr', 5);
    const result = g.dispatch(learnMiracle({ miracle: 'artisans_cunning' }));
    expect(result.ok).toBe(true);
    expect(favorOf(g).usvylgr).toBe(0);
    const book = slice<SpellcraftState>(g, 'spellcraft').grimoire;
    expect(book.map((s) => s.source)).toEqual([{ school: 'divine', litany: 'artisans_cunning' }]);
    expect(book[0].prepared).toBeUndefined();
    expect(counterOf(g, 'miracles:learned')).toBe(1);
    expect(logOf(g).some((m) => /Received: .*\(Usvýlgr\)\.$/.test(m))).toBe(true);
    // A fresh life holds no Devotion: the receiving XP is banked for it.
    const skills = slice<SkillsState>(g, 'skills');
    expect(skills.skills.devotion?.level ?? latentXp(skills, 'devotion')).toBeGreaterThan(0);
  });

  it('each refusal returns its reason and logs it', () => {
    const g = fresh();
    const reason = (id: string) => {
      const r = g.dispatch(learnMiracle({ miracle: id }));
      return r.ok ? '' : r.reason;
    };
    expect(reason('no_such')).toBe('No such miracle');
    expect(reason('holy_fire')).toBe("Needs 6 favor with D'Enjalle (you have 0)");
    // Devotion before favour: the old order of the checks.
    expect(reason('litany_retribution')).toBe('Needs Devotion 5');
    giveFavor(g, 'denjalle', 6);
    expect(g.dispatch(learnMiracle({ miracle: 'holy_fire' })).ok).toBe(true);
    expect(reason('holy_fire')).toBe('Already received');
    expect(logOf(g)).toContain('🔒 Already received');
  });

  // Old data, ported as it is: the old `checkMiracle` does not ask whether
  // the god is known, and eight miracles cost 0 favour.
  it('a miracle of a god not yet met, at a cost of 0, is received by a fresh life', () => {
    const g = fresh();
    expect(deityKnown(reads(g), 'tuigamala')).toBe(false);
    expect(g.dispatch(learnMiracle({ miracle: 'sproutbringer' })).ok).toBe(true);
    expect(MIRACLE_LIST.filter((m) => m.favorCost === 0)).toHaveLength(8);
  });
});

describe('floating favour and meeting a god (the divine half of the votive token)', () => {
  // The token itself: tests/consumables.test.ts, "Temple: the first token is
  // +2 with every god now and later; later ones are floating favor".

  it('floating favour goes to a known god, one at a time, and never to an unknown one', () => {
    const g = fresh();
    setCounters(g, { 'favor:floating': 2 });
    expect(floatingFavor(reads(g))).toBe(2);
    expect(g.dispatch(assignFavor({ deity: 'usvylgr' })).ok).toBe(true);
    expect(favorOf(g).usvylgr).toBe(1);
    expect(floatingFavor(reads(g))).toBe(1);
    const refused = g.dispatch(assignFavor({ deity: 'ikthelthe' }));
    expect(refused.ok ? '' : refused.reason).toBe("Ik'Thel'the is not known yet");
    expect(floatingFavor(reads(g))).toBe(1);
    expect(g.dispatch(assignFavor({ deity: 'usvylgr' })).ok).toBe(true);
    const empty = g.dispatch(assignFavor({ deity: 'usvylgr' }));
    expect(empty.ok ? '' : empty.reason).toBe('No unassigned favor');
  });

  it('a god met later starts at the votive baseline, and is met once', () => {
    const g = fresh();
    setCounters(g, { 'votive:baseline': 2 });
    expect(deityKnown(reads(g), 'ikthelthe')).toBe(false);
    expect(ask(g, meetDeity, { deity: 'ikthelthe' })).toBe(true);
    expect(deityKnown(reads(g), 'ikthelthe')).toBe(true);
    expect(favorOf(g).ikthelthe).toBe(2);
    expect(ask(g, meetDeity, { deity: 'ikthelthe' })).toBe(false);
    expect(ask(g, meetDeity, { deity: 'denjalle' })).toBe(false);
    expect(favorOf(g).ikthelthe).toBe(2);
    // Old rule: an id no deity has is stamped met, paid nothing, and answers true.
    expect(ask(g, meetDeity, { deity: 'no_such_god' })).toBe(true);
    expect(counterOf(g, 'met:deity:no_such_god')).toBe(1);
    expect(favorOf(g).no_such_god).toBeUndefined();
  });
});

describe('the divine view', () => {
  it('lists the known gods with their favour, and a reason per miracle', () => {
    const g = fresh();
    giveFavor(g, 'xima', 9);
    const view = g.view().systems.divine as DivineView;
    expect(view.known).toEqual(['denjalle', 'usvylgr']);
    expect(view.favor).toEqual({ denjalle: 0, usvylgr: 0 });
    expect(view.checks.litany_mending).toBeNull();
    expect(view.checks.holy_fire).toMatch(/^Needs 6 favor/);
    expect(view.floating).toBe(0);
    expect(view.tables.length).toBeGreaterThan(0);
  });
});
