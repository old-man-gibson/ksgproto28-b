/**
 * Port of the old `tests/hunters.test.ts`. The cases keep their names.
 *
 * Tag hunters: kills are tallied per monster tag, and the bonuses they buy
 * are gated on the same tag, so they pay out against that quarry only.
 *
 * Call shape changes:
 * - the old test fired the `kill` bus event and the achievements listener
 *   bumped the counters. Here combat bumps them where it kills, so a kill
 *   is a real one: a staged fight against a specimen on 1 HP;
 * - the hunter bonuses came from two achievements, which are not ported.
 *   The probe states the same kind of modifier (`requiresMonsterTag`), as
 *   the tests of ports 1 to 3 did for unported sources.
 *
 * Left behind: the achievement tier a counter crosses (the achievements port).
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { monsterTagSet } from '../src/systems/monsters';
import { statBlockOf, statMod, vsVariant, type StatMod } from '../src/systems/stats';
import type { ResourcesState } from '../src/systems/resources';
import { combatOf, counterOf, stage } from './combatHelpers';
import { equip, makeGame, patch, reads, setMods } from './helpers';

/** Kill `times` specimens of a species, one staged fight each. */
function killed(g: Kernel, defId: string, times = 1): void {
  for (let i = 0; i < times; i++) {
    stage(g, [{ monsterId: defId, level: 1, hpShare: 0 }]);
    for (let t = 0; t < 2000 && combatOf(g).fight; t++) g.tick();
    expect(combatOf(g).lastFight?.outcome, `${defId} kill ${i + 1}`).toBe('won');
  }
}

function fighter(seed: number): Kernel {
  const g = makeGame({ seed });
  equip(g, 1);
  // The fights are scaffolding for the counters: the character cannot lose them.
  setMods(g, [statMod('maxHp', 'add', 1e6)]);
  patch(g, (slices) => {
    (slices.resources as ResourcesState).values.hp = 1e6;
  });
  return g;
}

describe('tag kill counters', () => {
  it('one kill tallies every tag the corpse carried', () => {
    const g = fighter(1);
    // A basic Slime is inorganic + slime + small, plus its derived tier tag.
    killed(g, 'slime_base_basic');

    expect(counterOf(g, 'kills')).toBe(1);
    expect(counterOf(g, 'kills:slime_base_basic')).toBe(1);
    expect(counterOf(g, 'kills:tag:slime')).toBe(1);
    expect(counterOf(g, 'kills:tag:inorganic')).toBe(1);
    // Derived tags count too.
    expect(counterOf(g, 'kills:tag:basic')).toBe(1);
    // Nothing it was not.
    expect(counterOf(g, 'kills:tag:living')).toBe(0);
  });

  it('a tag tally spans every species carrying it', () => {
    const g = fighter(2);
    killed(g, 'slime_base_basic', 3);
    killed(g, 'slime_fire', 2);

    expect(counterOf(g, 'kills:tag:slime')).toBe(5); // one counter, two species
    expect(counterOf(g, 'kills:slime_base_basic')).toBe(3);
  });

  it.todo('crossing a tier threshold grants the hunter achievement (the achievements port)');
});

describe('tag-gated bonuses', () => {
  const gated = (stat: 'damage' | 'penetration', kind: 'add' | 'mult', value: number, tag: string): StatMod => ({
    ...statMod(stat, kind, value, `${tag} hunter`),
    requiresMonsterTag: tag,
  });

  /** A hunter holding the bonuses the two old achievements gave at tier 3. */
  function hunter(seed: number): Kernel {
    const g = makeGame({ seed });
    setMods(g, [
      gated('damage', 'mult', 0.15, 'slime'),
      gated('damage', 'mult', 0.15, 'inorganic'),
      gated('penetration', 'add', 0.1, 'inorganic'),
    ]);
    return g;
  }

  const block = (g: Kernel, tags?: Iterable<string>) => statBlockOf(reads(g), 'player', tags ? vsVariant(tags) : '');

  it('never reaches the global stat block', () => {
    const g = hunter(4);
    const plain = makeGame({ seed: 4 });
    expect(block(g).damage).toBeCloseTo(block(plain).damage, 5);
    expect(block(g).penetration).toBeCloseTo(block(plain).penetration, 5);
  });

  it('pays out against its quarry and nothing else', () => {
    const g = hunter(5);
    const base = block(g).damage;
    expect(block(g, ['slime']).damage).toBeGreaterThan(base);
    // A wolf is living flesh: neither hunter bonus touches it.
    expect(block(g, monsterTagSet('wolf')).damage).toBeCloseTo(base, 5);
  });

  it('stacks when one monster carries several hunted tags', () => {
    const g = hunter(6);
    const base = block(g).damage;
    const slimeOnly = block(g, ['slime']).damage;
    const inorganicOnly = block(g, ['inorganic']).damage;
    // A basic Slime is both, so it takes both damage lines.
    const both = block(g, monsterTagSet('slime_base_basic')).damage;

    expect(slimeOnly).toBeGreaterThan(base);
    expect(inorganicOnly).toBeGreaterThan(base);
    expect(both).toBeGreaterThan(slimeOnly);
    expect(both).toBeGreaterThan(inorganicOnly);
    expect(both).toBeCloseTo(base * (slimeOnly / base) * (inorganicOnly / base), 5);
  });

  it('gates non-damage stats the same way', () => {
    const g = hunter(7);
    const base = block(g).penetration;
    expect(block(g, ['inorganic']).penetration).toBeGreaterThan(base);
    expect(block(g, ['slime']).penetration).toBeCloseTo(base, 5);
  });
});
