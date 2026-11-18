/**
 * No stale stats after the catch-up work (docs/KERNEL.md decision 32). For
 * each source of change a stat reads, the cache is filled first, then the
 * change goes through the command, request, event or tick that makes it in
 * play, and the next read returns the new value. `staleStats()` recomputes
 * every stat of every entity with every source collected again; it must be
 * empty after each change.
 *
 * Decision 32 keeps a resolver's output while the modifiers under its prefix
 * are unchanged. The cases also check the other side: a change outside
 * `stats/` gives a new table but keeps the stat block object.
 *
 * Every case has a step where the touched source returns as many modifiers
 * as before, with other values: a comparison that looked at the length of a
 * list and not at its content would keep a stale block there, and the case
 * fails. Checked by breaking `sameList` in `src/kernel/derived.ts` that way.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { attrXpNeeded, grantAttrXp } from '../src/systems/attributes';
import { hook } from '../src/systems/combat';
import { grantLevelXp, xpToNext, type LevelsState } from '../src/systems/levels';
import { buyBoon, type PrestigeState } from '../src/systems/prestige';
import { acceptQuest, turnInQuest } from '../src/systems/quests';
import { poolHooks } from '../src/systems/resources';
import { attrValue, computeBlock, factValue, STAT_KEYS, statBlockOf, statOf } from '../src/systems/stats';
import { applyStatus } from '../src/systems/statuses';
import { darknessFactor } from '../src/systems/weather';
import { ask, emit, equip, giveItem, makeGame, patch, reads, slice, unequip } from './helpers';

/** Nothing is stale, and the cached block equals a compute from the collected modifiers. */
function sound(k: Kernel): void {
  expect(k.staleStats()).toEqual([]);
  const fresh = computeBlock(k.modifiers()).stats;
  const cached = statBlockOf(k);
  for (const key of STAT_KEYS) expect(cached[key], key).toBe(fresh[key]);
}

/** Read everything once, so the next read comes from the cache unless a source was touched. */
function fill(k: Kernel): void {
  statBlockOf(k);
  k.stats();
  poolHooks(k);
}

describe('a stat reads the new value on the next read', () => {
  it('equipment: equip and unequip the rusty sword', () => {
    const k = makeGame();
    fill(k);
    const bare = statOf(k, 'damage');
    expect(equip(k, 1).ok).toBe(true);
    expect(statOf(k, 'damage')).toBe(bare + 3);
    sound(k);
    expect(unequip(k, 'weapon').ok).toBe(true);
    expect(statOf(k, 'damage')).toBe(bare);
    sound(k);
  });

  it('equipment: one weapon for another with as many modifiers', () => {
    const k = makeGame();
    const hammer = giveItem(k, 'old_hammer');
    const club = giveItem(k, 'oak_club');
    expect(equip(k, hammer.uid).ok).toBe(true);
    fill(k);
    const speed = statOf(k, 'attackSpeed');
    // Damage +5 both; attack speed -12% against -10%.
    expect(equip(k, club.uid).ok).toBe(true);
    expect(statOf(k, 'attackSpeed')).toBeGreaterThan(speed);
    sound(k);
  });

  it('statuses: a condition with stat modifiers lands', () => {
    const k = makeGame();
    fill(k);
    const before = statOf(k, 'maxHp');
    ask(k, applyStatus, { entity: PLAYER, app: { id: 'well_fed', intensity: 1 } });
    expect(statOf(k, 'maxHp')).toBeGreaterThan(before);
    sound(k);
  });

  it('statuses: a second dose raises the intensity, the same modifiers with other values', () => {
    const k = makeGame();
    ask(k, applyStatus, { entity: PLAYER, app: { id: 'rootbound', intensity: 1 } });
    fill(k);
    const speed = statOf(k, 'speed');
    ask(k, applyStatus, { entity: PLAYER, app: { id: 'rootbound', intensity: 1 } });
    expect(statOf(k, 'speed')).toBeLessThan(speed);
    sound(k);
  });

  it('statuses: a condition that only seals a pool changes the pool hook and keeps the stat block', () => {
    const k = makeGame();
    fill(k);
    const block = statBlockOf(k);
    const table = k.stats();
    expect(poolHooks(k).ceiling('stamina')).toBe(1);
    ask(k, applyStatus, { entity: PLAYER, app: { id: 'sweltering', intensity: 2 } });
    expect(poolHooks(k).ceiling('stamina')).toBeCloseTo(0.9, 12);
    expect(k.stats()).not.toBe(table);
    // Nothing under `stats/` changed: the resolver output, and the block keyed on it, are kept.
    expect(statBlockOf(k)).toBe(block);
    sound(k);
    // A second dose: one ceiling modifier as before, with another value.
    ask(k, applyStatus, { entity: PLAYER, app: { id: 'sweltering', intensity: 2 } });
    expect(poolHooks(k).ceiling('stamina')).toBeCloseTo(0.8, 12);
    expect(statBlockOf(k)).toBe(block);
    sound(k);
  });

  it('weather and darkness: night falls at an open spot of floor 4', () => {
    const k = makeGame();
    // Day 3, 18:58 at the Deep Woods, with a weather seed.
    patch(k, (s) => {
      s.world.spot = 'f4_deep_woods';
      if (!s.world.discovered.includes('f4_deep_woods')) s.world.discovered.push('f4_deep_woods');
      s.clock.totalTicks = (3 * 1440 + 18 * 60 + 58) * 10;
      s.weather.seed = 12345;
    });
    fill(k);
    const block = statBlockOf(k);
    expect(k.derived(hook.darkness)).toBe(0);
    // Through the evening into the night: the tick of each game minute stores the darkness.
    k.tick(60 * 10 * 6);
    const dark = darknessFactor(reads(k));
    expect(dark).toBeGreaterThan(0);
    expect(k.derived(hook.darkness)).toBe(dark);
    // `combat/darkness` is a stat with a base, outside `stats/`.
    expect(statBlockOf(k)).toBe(block);
    sound(k);
  });

  it('levels: a level-up adds to every attribute', () => {
    const k = makeGame();
    fill(k);
    const lv = slice<LevelsState>(k, 'levels');
    const str = attrValue(k, 'str');
    emit(k, grantLevelXp, { xp: xpToNext(lv.level) - lv.levelXp });
    expect(slice<LevelsState>(k, 'levels').level).toBe(lv.level + 1);
    expect(attrValue(k, 'str')).toBeGreaterThan(str);
    sound(k);
    // The next level: the same six modifiers, each one larger.
    const at = slice<LevelsState>(k, 'levels');
    const then = attrValue(k, 'str');
    emit(k, grantLevelXp, { xp: xpToNext(at.level) - at.levelXp });
    expect(slice<LevelsState>(k, 'levels').level).toBe(at.level + 1);
    expect(attrValue(k, 'str')).toBeGreaterThan(then);
    sound(k);
  });

  it('attributes: an attribute level-up raises damage', () => {
    const k = makeGame();
    fill(k);
    const damage = statOf(k, 'damage');
    emit(k, grantAttrXp, { attr: 'str', amount: attrXpNeeded(1) });
    expect(statOf(k, 'damage')).toBeGreaterThan(damage);
    sound(k);
  });

  it('prestige legacy: a bought rank of endowment scales the attribute', () => {
    const k = makeGame();
    patch(k, (s) => {
      s.attributes.attrs.str.level = 20;
      const p = s.prestige as PrestigeState;
      p.count = 3;
      p.purchases = { endowment: 1 };
      p.peakAttrs = { str: 50 };
      p.points = 100;
    });
    fill(k);
    const str = attrValue(k, 'str');
    expect(k.dispatch(buyBoon({ boon: 'endowment' })).ok).toBe(true);
    expect(attrValue(k, 'str')).toBeGreaterThan(str);
    sound(k);
  });

  it('quests done: the turn-in states the fact quest:<id>', () => {
    const k = makeGame();
    patch(k, (s) => {
      s.world.spot = 'ascent_foot';
      s.counters.counts['boss:f1_toll_hall'] = 1;
    });
    expect(k.dispatch(acceptQuest({ quest: 'the_first_ascent' })).ok).toBe(true);
    fill(k);
    expect(factValue(k, 'quest:the_first_ascent')).toBe(0);
    expect(k.dispatch(turnInQuest({ quest: 'the_first_ascent' })).ok).toBe(true);
    expect(factValue(k, 'quest:the_first_ascent')).toBe(1);
    sound(k);
  });
});
