/**
 * Spine port 5: the player side of the registered kinds, with a rotation the
 * test writes. Nothing in the running game gives the player a technique, a
 * spell or a miracle yet; these cases show the extension points run.
 *
 * - `technique:` (martial): a strike on the action bar, a defensive form in
 *   the buff slot, the position the exchange leaves, the position effects.
 * - The interception of the incoming blow (a counter technique).
 * - `grimoire:` (spellcraft): an arcane sentence and a miracle through the
 *   same door a monster's cast goes through; a working on the caster; a
 *   skip with a reason for a spell that cannot be paid for.
 * - The blow rider hook, with a rider the test registers.
 * - The player's own trigger on a rotation id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import {
  hook,
  registerBlowRider,
  setRotation,
  setTrigger,
  unregisterHook,
} from '../src/systems/combat';
import { MIRACLES } from '../src/systems/divine';
import { TECHNIQUES } from '../src/systems/martial';
import type { ResourcesState } from '../src/systems/resources';
import { specForSource } from '../src/systems/spellcraft';
import { statBlockOf } from '../src/systems/stats';
import { heldOf, type StatusesState } from '../src/systems/statuses';
import {
  combatOf,
  feedOf,
  hardenFoes,
  inscribe,
  learn,
  patchFight,
  playerStats,
  setHp,
  setPool,
  skipsOf,
  stage,
} from './combatHelpers';
import { equip, makeGame, patch, reads, setMods, slice } from './helpers';

const texts = (kernel: Kernel): string[] => feedOf(kernel).map((entry) => entry.text);
const mana = (kernel: Kernel): number => slice<ResourcesState>(kernel, 'resources').values.mana;

/** A character who cannot fall, facing one training-proof enemy. */
function arena(seed: number, monsterId = 'goblin', level = 3): Kernel {
  const kernel = makeGame({ seed });
  equip(kernel, 1); // rusty sword
  setMods(kernel, [{ stat: 'stats/maxHp', kind: 'add', value: 1e6 }]);
  setHp(kernel, 1e6);
  stage(kernel, [{ monsterId, level }]);
  hardenFoes(kernel);
  return kernel;
}

function runUntil(kernel: Kernel, done: () => boolean, limit = 3000): boolean {
  for (let i = 0; i < limit && !done(); i++) kernel.tick();
  return done();
}

describe('the player kind technique:', () => {
  it('a known technique is in the rotation and strikes from its position', () => {
    const g = arena(3);
    learn(g, 'gather');
    learn(g, 'heavy_blow');
    // Gather fires from neutral and leaves the fighter coiled; Heavy Blow fires from coiled.
    expect(runUntil(g, () => texts(g).some((t) => t.includes('Heavy Blow strikes')))).toBe(true);
    const lines = texts(g);
    const gather = lines.findIndex((t) => t.includes('Gather strikes'));
    const heavy = lines.findIndex((t) => t.includes('Heavy Blow strikes'));
    expect(gather).toBeGreaterThanOrEqual(0);
    expect(heavy).toBeGreaterThan(gather);
    // Heavy Blow leaves the fighter off balance.
    expect(combatOf(g).fight!.position).toBe(TECHNIQUES.heavy_blow.to);
    expect(g.staleStats()).toEqual([]);
  });

  it('the damage report names the technique and its multiplier', () => {
    const g = arena(4);
    learn(g, 'gather');
    expect(runUntil(g, () => texts(g).some((t) => t.includes('Gather strikes')))).toBe(true);
    const entry = feedOf(g).find((f) => f.text.includes('Gather strikes'))!;
    expect(entry.damage?.label).toBe('Gather');
    expect(entry.damage?.steps.some((s) => s.label === 'Gather' && s.mult === TECHNIQUES.gather.move.damageMult)).toBe(true);
  });

  it('a technique that is not known is inert in the saved order', () => {
    const g = arena(5);
    g.dispatch(setRotation({ order: ['technique:gather'] }));
    for (let i = 0; i < 400; i++) g.tick();
    expect(texts(g).some((t) => t.includes('Gather strikes'))).toBe(false);
    // The old `activeRotation` left a stale id out; it is not a skip.
    expect(skipsOf(g, 'combat/rotation')).toEqual([]);
  });

  it('standing off balance raises incoming damage through the hook stat, and the plain swing returns to neutral', () => {
    const g = arena(6);
    learn(g, 'gather');
    learn(g, 'heavy_blow');
    expect(runUntil(g, () => combatOf(g).fight?.position === 'off_balance')).toBe(true);
    expect(reads(g).derived(hook.positionIncomingMult)).toBeCloseTo(1.15, 10);
    expect(g.staleStats()).toEqual([]);
    // Nothing fires from off balance: the next swing is plain and recovers.
    expect(runUntil(g, () => combatOf(g).fight?.position === 'neutral')).toBe(true);
    expect(reads(g).derived(hook.positionIncomingMult)).toBe(1);
    expect(g.staleStats()).toEqual([]);
  });

  it('the wrong weapon family keeps a technique out', () => {
    const g = arena(7);
    learn(g, 'thrust'); // a sword-family technique in the old data is fine with the rusty sword; a katana form is not
    learn(g, 'iai_draw');
    for (let i = 0; i < 600; i++) g.tick();
    expect(texts(g).some((t) => t.includes('Iai Draw'))).toBe(false);
  });

  it('a defensive form fires from the buff slot, moves the fighter and is clocked', () => {
    const g = arena(8);
    learn(g, 'sidestep');
    const def = TECHNIQUES.sidestep;
    // Sidestep answers a dodge: give the character the footwork to dodge.
    setMods(g, [
      { stat: 'stats/maxHp', kind: 'add', value: 1e6 },
      { stat: 'stats/dodge', kind: 'add', value: 0.6 },
    ]);
    expect(runUntil(g, () => texts(g).some((t) => t.includes(`${def.name} — you settle`)), 6000)).toBe(true);
    const fight = combatOf(g).fight!;
    expect(fight.cooldowns['technique:sidestep']).toBeGreaterThan(0);
    if (def.move.buff) expect(fight.buffs.some((b) => b.name === def.name) || fight.cooldowns['technique:sidestep'] < def.move.cooldown).toBe(true);
    expect(g.staleStats()).toEqual([]);
  });

  it("the player's own trigger switches a rotation id off", () => {
    const g = arena(9);
    learn(g, 'gather');
    g.dispatch(setTrigger({ id: 'technique:gather', trigger: { enabled: false } }));
    for (let i = 0; i < 400; i++) g.tick();
    expect(texts(g).some((t) => t.includes('Gather strikes'))).toBe(false);
    g.dispatch(setTrigger({ id: 'technique:gather', trigger: null }));
    expect(runUntil(g, () => texts(g).some((t) => t.includes('Gather strikes')))).toBe(true);
  });
});

describe('the interception of the incoming blow', () => {
  /** Unarmed, with the mana the Electric Cross is paid from, held in the guard it fires from. */
  function boxer(seed: number): Kernel {
    const kernel = makeGame({ seed });
    setMods(kernel, [
      { stat: 'stats/maxHp', kind: 'add', value: 1e6 },
      { stat: 'stats/maxMana', kind: 'add', value: 500 },
    ]);
    setHp(kernel, 1e6);
    setPool(kernel, 'mana', 500);
    learn(kernel, 'electric_cross');
    stage(kernel, [{ monsterId: 'goblin', level: 3 }]);
    hardenFoes(kernel);
    return kernel;
  }

  function guarded(kernel: Kernel, done: () => boolean, limit = 4000): boolean {
    for (let i = 0; i < limit && !done(); i++) {
      if (combatOf(kernel).fight && combatOf(kernel).fight!.position !== 'guarded') {
        patchFight(kernel, (state) => {
          state.fight!.position = 'guarded';
        });
      }
      kernel.tick();
    }
    return done();
  }

  it('a counter answers the blow that landed, is paid for in mana and is clocked', () => {
    const g = boxer(70);
    const before = mana(g);
    expect(guarded(g, () => texts(g).some((t) => t.includes('Electric Cross answers')))).toBe(true);
    expect(mana(g)).toBeLessThan(before);
    const fight = combatOf(g).fight!;
    // Spent on use: the block it answered cannot be cashed again.
    expect(fight.prevented?.onHit).toBeUndefined();
    expect(fight.cooldowns['technique:electric_cross']).toBeGreaterThan(0);
    expect(fight.position).toBe(TECHNIQUES.electric_cross.to);
  });

  it('names itself in the incoming breakdown, and answers in two slices', () => {
    const g = boxer(74);
    const intercepted = () => feedOf(g).some((f) => f.damage?.steps.some((s) => s.label === 'Electric Cross intercepts'));
    expect(guarded(g, intercepted)).toBe(true);
    const step = feedOf(g)
      .flatMap((f) => f.damage?.steps ?? [])
      .find((s) => s.label === 'Electric Cross intercepts')!;
    expect(step.mult).toBeCloseTo(1 - TECHNIQUES.electric_cross.move.counter!.reduce, 10);
    const answer = feedOf(g).find((f) => f.text.includes('Electric Cross answers'))!;
    const types = answer.damage!.slices.map((s) => s.type);
    expect(types).toContain('bludgeoning');
    expect(types).toContain(TECHNIQUES.electric_cross.move.damageType);
  });

  it('with no mana the reflex does not come', () => {
    const g = boxer(71);
    // The pool is emptied and the guard set before every tick; blows land in the run.
    for (let i = 0; i < 400; i++) {
      patch(g, (slices) => {
        slices.resources.values.mana = 0;
        if (slices.combat.fight) slices.combat.fight.position = 'guarded';
      });
      g.tick();
    }
    expect(texts(g).some((t) => /The Goblin (hits|CRITS) you for/.test(t))).toBe(true);
    expect(texts(g).some((t) => t.includes('Electric Cross'))).toBe(false);
  });
});

describe('the player kind grimoire:', () => {
  function caster(seed: number, monsterId = 'goblin'): Kernel {
    const kernel = arena(seed, monsterId);
    setMods(kernel, [
      { stat: 'stats/maxHp', kind: 'add', value: 1e6 },
      { stat: 'stats/maxMana', kind: 'add', value: 1000 },
    ]);
    setPool(kernel, 'mana', 1000);
    return kernel;
  }

  it('a prepared arcane sentence is cast on the action bar and pays its mana', () => {
    const g = caster(21);
    const id = inscribe(g, { school: 'arcane', words: ['fire', 'pierce'] });
    const spec = specForSource({ school: 'arcane', words: ['fire', 'pierce'] });
    const before = mana(g);
    expect(runUntil(g, () => texts(g).some((t) => t.includes(`${spec.name} strikes the`)))).toBe(true);
    expect(before - mana(g)).toBeGreaterThanOrEqual(spec.manaCost * playerStats(g).manaEff - 1);
    expect(combatOf(g).fight!.cooldowns[id]).toBeGreaterThan(0);
    const entry = feedOf(g).find((f) => f.text.includes(`${spec.name} strikes the`))!;
    expect(entry.damage?.slices.some((s) => s.type === 'heat')).toBe(true);
  });

  it('the same sentence is the same spell for a monster and for the player', () => {
    const words = ['quickly', 'fire', 'pierce'];
    const monster = specForSource({ school: 'arcane', words });
    const g = caster(22);
    inscribe(g, { school: 'arcane', words });
    expect(runUntil(g, () => texts(g).some((t) => t.includes(`${monster.name} strikes the`)))).toBe(true);
  });

  it('a spell that is not prepared is not cast', () => {
    const g = caster(23);
    const spec = specForSource({ school: 'arcane', words: ['fire', 'pierce'] });
    inscribe(g, { school: 'arcane', words: ['fire', 'pierce'] }, { prepared: false });
    for (let i = 0; i < 400; i++) g.tick();
    expect(texts(g).some((t) => t.includes(spec.name))).toBe(false);
  });

  it('a spell that cannot be paid for is skipped with a reason, once per fight', () => {
    const g = arena(24);
    setPool(g, 'mana', 0);
    setMods(g, [
      { stat: 'stats/maxHp', kind: 'add', value: 1e6 },
      { stat: 'stats/maxMana', kind: 'mult', value: 0 },
    ]);
    inscribe(g, { school: 'arcane', words: ['fire', 'fire', 'fire', 'pierce'] });
    for (let i = 0; i < 400; i++) g.tick();
    const reasons = skipsOf(g, 'combat/rotation').filter((r) => r.includes('not enough mana'));
    expect(reasons).toHaveLength(1);
    // The character still fights: the plain swing takes the bar.
    expect(texts(g).some((t) => t.startsWith('⚔️ You hit'))).toBe(true);
  });

  it('a working on the caster fires from the buff slot: a ward is a buff of the fight', () => {
    const g = caster(25);
    inscribe(g, { school: 'arcane', words: ['fire', 'ward'] });
    const before = playerStats(g).resHeat;
    expect(runUntil(g, () => (combatOf(g).fight?.buffs.length ?? 0) > 0)).toBe(true);
    expect(combatOf(g).fight!.buffs[0].name).toBe('Ward');
    expect(statBlockOf(reads(g)).resHeat).toBeGreaterThan(before);
    expect(g.staleStats()).toEqual([]);
    // It burns down with the fight's clock.
    const left = combatOf(g).fight!.buffs[0].ticksLeft;
    g.tick();
    expect(combatOf(g).fight!.buffs[0].ticksLeft).toBe(left - 1);
  });

  it('a miracle resolves through the same door, and a second of the same deity resonates', () => {
    const g = caster(26);
    inscribe(g, { school: 'divine', litany: 'cinder_curse' });
    inscribe(g, { school: 'divine', litany: 'kindling' });
    expect(MIRACLES.cinder_curse.deity).toBe(MIRACLES.kindling.deity);
    expect(runUntil(g, () => texts(g).some((t) => t.includes('deity synergy with the previous miracle')), 4000)).toBe(true);
    expect(texts(g).some((t) => t.includes('Cinder Curse strikes the'))).toBe(true);
  });

  it('a strike leaves its condition on the target', () => {
    const g = caster(27);
    inscribe(g, { school: 'divine', litany: 'cinder_curse' });
    const foe = combatOf(g).fight!.enemies[0]!;
    const burning = () => heldOf(slice<StatusesState>(g, 'statuses'), foe.entity).some((h) => h.id === 'on_fire' || h.id === 'blazing');
    expect(runUntil(g, burning, 6000)).toBe(true);
  });
});

describe('the blow rider hook', () => {
  afterEach(() => unregisterHook('rider', 'test/oil'));

  it('a registered rider adds a typed slice per hit and leaves its condition after the blow', () => {
    let hits = 0;
    registerBlowRider('test/oil', {
      perHit: () => {
        hits += 1;
        return [{ type: 'poison', value: 5, source: 'Test Oil' }];
      },
      afterBlow: () => ({ inflicts: [{ id: 'poison', intensity: 1 }], source: 'Test Oil', line: '🛢️ Your Test Oil coating is used up.' }),
    });
    const g = arena(31);
    expect(runUntil(g, () => texts(g).some((t) => t.startsWith('⚔️ You hit')))).toBe(true);
    expect(hits).toBeGreaterThan(0);
    const entry = feedOf(g).find((f) => f.text.startsWith('⚔️ You hit'))!;
    expect(entry.damage?.slices.some((s) => s.type === 'poison' && s.source === 'Test Oil')).toBe(true);
    expect(texts(g)).toContain('🛢️ Your Test Oil coating is used up.');
    const foe = combatOf(g).fight!.enemies[0]!;
    expect(heldOf(slice<StatusesState>(g, 'statuses'), foe.entity).some((h) => h.id === 'poison')).toBe(true);
  });
});
