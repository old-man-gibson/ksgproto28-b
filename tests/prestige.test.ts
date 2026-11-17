/**
 * Port of the old `tests/prestige.test.ts`: the harvest, the reset, boons,
 * the review, talent and endowment. The cases keep their old names.
 *
 * Call shape changes:
 * - `prestigeNow(state, now)` returned the next state. Here it is the command
 *   `prestige/now`; the kernel replaces every slice and each system's
 *   `newRun` carries what it keeps. The case reads the slices after it.
 * - "A run that can prestige" (`clearFloors`) sets the counters each floor's
 *   `clear` reads, floors 1 to 6, the warchief counter among them.
 * - `buyBoon(state, bus, id)` and `leaveReview(state)` are commands.
 * - `canPrestige`, `prestigeVisible`, `harvest` and `forecast` take a read
 *   context or its condition reader, and the prestige slice.
 * - `skillCap(state, id)` is `skillCap(ctx, id)` of `skills`.
 * - `getDerivedStats(state).damage` is the stat `damage`; `attrValue` is the
 *   stats read; `attrBreakdown(state, a)` is `attrBreakdown(modifiers, a)`;
 *   `collectBaseMods` is `computeBlock(modifiers).mods`. A rank change goes
 *   through `prestige/buy-boon`, and `kernel.staleStats()` is checked empty.
 * - `state.createdAt` and `state.lastSaved` are not in this save; the
 *   weather seed is what carries (old `next.createdAt = state.createdAt`).
 * - The achievements source pays 0 until achievements are ported (step 3):
 *   the old harvest of 16 is 14 here, with `achievements: 0`.
 * - "through the Game: the state object keeps its identity" has no meaning
 *   here (the UI holds no state). It is replaced by "a save after a prestige
 *   loads and runs".
 * - The stronghold door (`base_entrance`) is step 4; that line of the
 *   `prestige:count` case is left out.
 *
 * `it.todo`:
 * - the prepared-page half of "ceilings and pages": `preparedCap` arrives
 *   with the grimoire, step 3.
 * - the two save migrations: there is no importer of the old save.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import type { CountersState } from '../src/systems/counters';
import type { GoldState } from '../src/systems/gold';
import type { ItemsState } from '../src/systems/items';
import { FLOORS } from '../src/systems/ladder';
import {
  buyBoon,
  canPrestige,
  endowmentBonus,
  forecast,
  harvest,
  leaveReview,
  nextBoonCost,
  nextThreshold,
  pointsFor,
  PRESTIGE_BOON_LIST,
  PRESTIGE_BOONS,
  PRESTIGE_SOURCE_LIST,
  prestigeNow,
  prestigeVisible,
  talentBonus,
  type PrestigeState,
} from '../src/systems/prestige';
import { conditionReader, skillCap, SKILLS, type SkillsState } from '../src/systems/skills';
import { attrBreakdown, attrValue, computeBlock, statOf } from '../src/systems/stats';
import { TUTORIAL_EXIT } from '../src/systems/tutorial';
import { CALM_SEEN_KEY, type WeatherState } from '../src/systems/weather';
import { AREAS, SPOTS, STARTING_SPOT } from '../src/systems/world';
import { makeGame, patch, reads, slice } from './helpers';
import { counterOf, setCounters, worldOf } from './worldHelpers';

const PRESTIGE_SOURCES = Object.fromEntries(PRESTIGE_SOURCE_LIST.map((s) => [s.id, s]));
const TO_PRESTIGE = ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'];

const fresh = (seed = 0): Kernel => makeGame({ seed });
const prestigeOf = (k: Kernel): PrestigeState => slice<PrestigeState>(k, 'prestige');
const countsOf = (k: Kernel): Record<string, number> => slice<CountersState>(k, 'counters').counts;
const goldOf = (k: Kernel): number => slice<GoldState>(k, 'gold').gold;
const reader = (k: Kernel) => conditionReader(reads(k));
const harvestOf = (k: Kernel) => harvest(reads(k), prestigeOf(k));

/** Set the counters each floor's `clear` reads, as if the player had cleared it. The old `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[] = TO_PRESTIGE): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
}

/** A run that can prestige: floors 1 to 6 cleared, the warchief down. */
function bandOneCleared(seed = 0): Kernel {
  const k = fresh(seed);
  clearFloors(k);
  return k;
}

function prestige(k: Kernel): void {
  const result = k.dispatch(prestigeNow());
  if (!result.ok) throw new Error(result.reason);
}

function setSkills(k: Kernel, levels: Record<string, number>): void {
  patch(k, (s) => {
    const skills = (s.skills as SkillsState).skills;
    for (const [id, level] of Object.entries(levels)) skills[id] = { level, xp: 0 };
  });
}

function patchPrestige(k: Kernel, change: (p: PrestigeState) => void): void {
  patch(k, (s) => change(s.prestige as PrestigeState));
}

describe('prestige data', () => {
  it("every boon costs something at every rank (an auto boon's first rank excepted), and cap boons name capped skills", () => {
    for (const boon of PRESTIGE_BOON_LIST) {
      expect(boon.cost.length, `${boon.id} has no ranks`).toBeGreaterThan(0);
      boon.cost.forEach((c, i) => {
        if (boon.auto && i === 0) expect(c, `${boon.id} is auto, so rank 1 must be free`).toBe(0);
        else expect(c, `${boon.id} has a free rank`).toBeGreaterThan(0);
      });
      if (boon.effect.kind === 'skillCap') {
        const def = SKILLS[boon.effect.skill!];
        expect(def, `${boon.id} names an unknown skill`).toBeTruthy();
        expect(def.maxLevel, `${boon.id} raises the ceiling of an uncapped skill`).toBeTruthy();
      }
    }
  });

  it('every source pays whole points from a positive divisor', () => {
    for (const src of PRESTIGE_SOURCE_LIST) {
      expect(src.per, `${src.id}`).toBeGreaterThan(0);
      if (src.measure === 'stat') expect(src.key, `${src.id} counts a stat but names none`).toBeTruthy();
    }
  });
});

describe('the gate and the tab', () => {
  it('a fresh save can neither prestige nor see the tab', () => {
    const k = fresh();
    expect(canPrestige(reader(k))).toBe(false);
    expect(prestigeVisible(prestigeOf(k), reader(k))).toBe(false);
    const result = k.dispatch(prestigeNow());
    expect(result.ok).toBe(false);
    expect(prestigeOf(k).count).toBe(0);
  });

  it('the brood queen opens both', () => {
    const k = bandOneCleared();
    expect(canPrestige(reader(k))).toBe(true);
    expect(prestigeVisible(prestigeOf(k), reader(k))).toBe(true);
  });

  it('once any run has prestiged the tab stays, even before the queen falls again', () => {
    const k = bandOneCleared();
    prestige(k);
    expect(canPrestige(reader(k))).toBe(false);
    expect(prestigeVisible(prestigeOf(k), reader(k))).toBe(true);
  });
});

describe('the harvest', () => {
  it('pays whole points per source and the preview is the harvest', () => {
    const k = bandOneCleared();
    setCounters(k, {
      'quests:completed': 5, // 2 per point → 2
      'bestiary:entries': 12, // 5 per point → 2
      'gold:earned': 999_999, // thresholds 10k, 100k, 1M → 2
    });
    setSkills(k, { fighting: 30, scouting: 20 });
    // Achievement tiers pay 0 until achievements are ported (step 3).
    const preview = harvestOf(k);
    const byId = Object.fromEntries(preview.lines.map((l) => [l.id, l.points]));
    expect(byId).toEqual({ floors: 6, quests: 2, bestiary: 2, skills: 2, achievements: 0, gold: 2 });
    expect(preview.total).toBe(14);
    expect(preview.ordinal).toBe(1);

    prestige(k);
    expect(prestigeOf(k).lastHarvest).toEqual(preview);
    expect(prestigeOf(k).points).toBe(14);
  });

  it('gold pays geometrically: each point ten times further than the last, from 10,000', () => {
    const gold = PRESTIGE_SOURCES.gold;
    expect(pointsFor(0, gold)).toBe(0);
    expect(pointsFor(9_999, gold)).toBe(0);
    expect(pointsFor(10_000, gold)).toBe(1);
    expect(pointsFor(99_999, gold)).toBe(1);
    expect(pointsFor(100_000, gold)).toBe(2);
    expect(pointsFor(1_000_000, gold)).toBe(3);
    expect(pointsFor(10_000_000_000, gold)).toBe(7);
    expect(nextThreshold(0, gold)).toBe(10_000);
    expect(nextThreshold(10_000, gold)).toBe(100_000);
    expect(nextThreshold(250_000, gold)).toBe(1_000_000);
    const k = fresh();
    setCounters(k, { 'gold:earned': 250_000 });
    const line = harvestOf(k).lines.find((l) => l.id === 'gold')!;
    expect(line.points).toBe(2);
    expect(line.detail).toBe('250000 gold (next at 1000000)');
    expect(forecast(reads(k)).find((f) => f.id === 'gold')!.need).toBe(750_000);
    // Linear sources are unchanged by the machinery.
    expect(pointsFor(5, PRESTIGE_SOURCES.quests)).toBe(2);
    expect(nextThreshold(5, PRESTIGE_SOURCES.quests)).toBe(6);
  });

  it('forecasts the distance to the next point with the same arithmetic', () => {
    const k = fresh();
    setCounters(k, { 'quests:completed': 5 });
    expect(forecast(reads(k)).find((f) => f.id === 'quests')!.need).toBe(1);
    setCounters(k, { 'quests:completed': 6 });
    expect(forecast(reads(k)).find((f) => f.id === 'quests')!.need).toBe(2);
  });
});

describe('the reset', () => {
  it('starts a fresh run at the Foot carrying only the legacy block and the world seed', () => {
    const k = bandOneCleared();
    const landing = FLOORS.ascent_f3.landing!;
    patch(k, (s) => {
      (s.gold as GoldState).gold = 9999;
      const w = s.world;
      w.spot = landing;
      w.discovered.push(landing);
      (s.weather as WeatherState).seed = 4242;
    });
    setCounters(k, { 'gold:earned': 500 });
    const blank = fresh().snapshot().slices;
    prestige(k);
    const after = k.snapshot().slices;

    // A second life skips the tutorial cell: it opens at the Foot, done-flag stamped.
    const w = worldOf(k);
    expect(w.spot).toBe(TUTORIAL_EXIT);
    // The Foot, then the rest of Threshold: the city has no fog.
    expect(w.discovered[0]).toBe(TUTORIAL_EXIT);
    expect(w.discovered.every((id) => AREAS[SPOTS[id].areaId].regionId === 'threshold')).toBe(true);
    expect(w.discovered).toContain('the_cages');
    expect(w.travel).toBeNull();
    expect(w.activity).toBeNull();
    expect(counterOf(k, 'flag:tutorial_done')).toBe(1);
    expect(counterOf(k, 'prestige:count')).toBe(1);
    expect(STARTING_SPOT).not.toBe(TUTORIAL_EXIT);
    expect(goldOf(k)).toBe(0);
    expect(countsOf(k)['gold:earned']).toBeUndefined();
    for (const id of TO_PRESTIGE) {
      for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') expect(countsOf(k)[c.key], c.key).toBeUndefined();
    }
    // The weather seed carries (the old `createdAt`).
    expect((after.weather as WeatherState).seed).toBe(4242);
    expect(prestigeOf(k).count).toBe(1);
    expect(prestigeOf(k).review).toBe(true);
    expect(prestigeOf(k).spentThisReview).toBe(0);

    // Every other slice is new: equal to a fresh game's, but for what the
    // start of a run writes (the world, the counters, the weather seed, the
    // log) and the legacy itself.
    const own = new Set(['prestige', 'world', 'counters', 'weather', 'log', 'probe']);
    for (const id of Object.keys(blank)) {
      if (own.has(id)) continue;
      expect(after[id], id).toEqual(blank[id]);
    }
  });

  it('carries keep-marked items into the stash and nothing else', () => {
    const k = bandOneCleared();
    patch(k, (s) => {
      const items = s.items as ItemsState;
      items.uidCounter += 2;
      items.inventory.push({ uid: items.uidCounter - 1, defId: 'festival_regalia', slots: 0, runes: [] });
      items.inventory.push({ uid: items.uidCounter, defId: 'iron_sword', slots: 0, runes: [] });
    });
    prestige(k);
    const items = slice<ItemsState>(k, 'items');
    expect(items.stash.map((i) => i.defId)).toEqual(['festival_regalia']);
    expect(items.inventory.some((i) => i.defId === 'iron_sword')).toBe(false);
  });

  it('stamps prestige:count; the hold door is not at the Foot any more', () => {
    // The hold door (`base_entrance`) is the stronghold, step 4.
    const k = bandOneCleared();
    prestige(k);
    expect(counterOf(k, 'prestige:count')).toBe(1);
    expect(countsOf(k)['legacy:stronghold']).toBeUndefined();
  });

  it('keeps every opened alpha shutter and leaves shut ones shut', () => {
    const k = bandOneCleared();
    setCounters(k, { 'flag:unlock_martial': 1, 'flag:unlock_music': 1 });
    prestige(k);
    expect(counterOf(k, 'flag:unlock_martial')).toBe(1);
    expect(counterOf(k, 'flag:unlock_music')).toBe(1);
    const open = Object.keys(countsOf(k)).filter((key) => key.startsWith('flag:unlock_'));
    expect(open.sort()).toEqual(['flag:unlock_martial', 'flag:unlock_music']);
  });

  it('keeps the first-calm stamp, so that disclosure fires once per save', () => {
    const k = bandOneCleared();
    setCounters(k, { [CALM_SEEN_KEY]: 1 });
    prestige(k);
    expect(counterOf(k, CALM_SEEN_KEY)).toBe(1);
    // A run that never met a calm carries nothing.
    const other = bandOneCleared();
    prestige(other);
    expect(countsOf(other)[CALM_SEEN_KEY]).toBeUndefined();
  });

  it('counts up across runs and keeps unspent points', () => {
    const k = bandOneCleared();
    prestige(k);
    const firstPoints = prestigeOf(k).points;
    clearFloors(k);
    prestige(k);
    expect(prestigeOf(k).count).toBe(2);
    expect(prestigeOf(k).points).toBe(firstPoints + 6);
    expect(prestigeOf(k).lastHarvest?.ordinal).toBe(2);
  });

  it('a save after a prestige loads and runs', () => {
    const k = bandOneCleared();
    prestige(k);
    const saved = k.save(0);
    const k2 = makeGame({ seed: 0 });
    expect(k2.load(saved).ok).toBe(true);
    expect(k2.snapshot()).toEqual(k.snapshot());
    expect(prestigeOf(k2).count).toBe(1);
    expect(worldOf(k2).spot).toBe(TUTORIAL_EXIT);
    k2.tick(50);
    expect(k2.staleStats()).toEqual([]);
    // A second prestige refuses: the new run has not cleared band 2.
    expect(k2.dispatch(prestigeNow()).ok).toBe(false);
  });
});

describe('boons', () => {
  it('cost their rank, refuse without points, and stop at max rank', () => {
    const k = fresh();
    expect(k.dispatch(buyBoon({ boon: 'provisions' })).ok).toBe(false);
    patchPrestige(k, (p) => {
      p.points = 100;
    });
    const def = PRESTIGE_BOONS.provisions;
    for (let r = 0; r < def.cost.length; r++) {
      expect(nextBoonCost(prestigeOf(k), 'provisions')).toBe(def.cost[r]);
      expect(k.dispatch(buyBoon({ boon: 'provisions' })).ok).toBe(true);
    }
    expect(nextBoonCost(prestigeOf(k), 'provisions')).toBeNull();
    expect(k.dispatch(buyBoon({ boon: 'provisions' })).ok).toBe(false);
    expect(prestigeOf(k).points).toBe(100 - def.cost.reduce((a, b) => a + b, 0));
    expect(prestigeOf(k).purchases.provisions).toBe(def.cost.length);
  });

  it('provisions pay now and at the start of every later run', () => {
    const k = bandOneCleared();
    patch(k, (s) => {
      (s.prestige as PrestigeState).points = 5;
      (s.gold as GoldState).gold = 0;
    });
    k.dispatch(buyBoon({ boon: 'provisions' }));
    k.dispatch(buyBoon({ boon: 'provisions' }));
    expect(goldOf(k)).toBe(100);
    prestige(k);
    expect(goldOf(k)).toBe(100);
    expect(prestigeOf(k).purchases.provisions).toBe(2);
  });

  it('ceilings and pages are read at their use sites, manifested or not', () => {
    // The skill-cap half. The page half is `it.todo` below.
    const k = bandOneCleared();
    patchPrestige(k, (p) => {
      p.points = 20;
    });
    const base = skillCap(reads(k), 'chronosense');
    expect(k.dispatch(buyBoon({ boon: 'chronosense_ceiling' })).ok).toBe(true);
    expect(skillCap(reads(k), 'chronosense')).toBe(base + 5);
    expect(slice<SkillsState>(k, 'skills').skills.chronosense).toBeUndefined();
    // Carried into the next run without re-buying.
    prestige(k);
    expect(skillCap(reads(k), 'chronosense')).toBe(base + 5);
  });

  it.todo('ceilings and pages: a grimoire page raises preparedCap, and carries (step 3: the grimoire)');
});

describe('the post-prestige review', () => {
  it('is owed after a prestige, survives a save round-trip, and closes only through leaveReview', () => {
    const k = bandOneCleared();
    prestige(k);
    expect(prestigeOf(k).review).toBe(true);
    const loaded = makeGame({ seed: 0 });
    expect(loaded.load(k.save(0)).ok).toBe(true);
    expect(prestigeOf(loaded).review).toBe(true);
    expect(prestigeOf(loaded).lastHarvest?.total).toBe(6);
    expect(loaded.dispatch(leaveReview()).ok).toBe(true);
    expect(prestigeOf(loaded).review).toBe(false);
  });

  it('counts points spent while open, so the UI can waive the confirmation', () => {
    const k = bandOneCleared();
    prestige(k);
    expect(prestigeOf(k).spentThisReview).toBe(0);
    expect(k.dispatch(buyBoon({ boon: 'provisions' })).ok).toBe(true);
    expect(prestigeOf(k).spentThisReview).toBe(1);
    k.dispatch(leaveReview());
    expect(prestigeOf(k).spentThisReview).toBe(0);
    // Spending outside a review does not count toward one.
    patchPrestige(k, (p) => {
      p.points = 5;
    });
    k.dispatch(buyBoon({ boon: 'provisions' }));
    expect(prestigeOf(k).spentThisReview).toBe(0);
  });
});

describe('talent', () => {
  it("arrives free with the first prestige and records every skill's peak", () => {
    const k = bandOneCleared();
    setSkills(k, { fighting: 40, scouting: 12 });
    const held = Object.keys(slice<SkillsState>(k, 'skills').skills);
    prestige(k);
    expect(prestigeOf(k).purchases.talent).toBe(1);
    expect(prestigeOf(k).points).toBe(8); // 6 floors + 52 skill levels; the free rank cost nothing
    expect(Object.keys(prestigeOf(k).peakLevels).sort()).toEqual(held.sort());
    expect(prestigeOf(k).peakLevels.fighting).toBe(40);
    expect(prestigeOf(k).peakLevels.scouting).toBe(12);
    expect(nextBoonCost(prestigeOf(k), 'talent')).toBe(PRESTIGE_BOONS.talent.cost[1]);
  });

  it('peaks never lower, and a skill no finished run carried has none', () => {
    const k = bandOneCleared();
    setSkills(k, { fighting: 40 });
    prestige(k);
    clearFloors(k);
    setSkills(k, { fighting: 25, mining: 9 });
    prestige(k);
    expect(prestigeOf(k).peakLevels.fighting).toBe(40);
    expect(prestigeOf(k).peakLevels.mining).toBe(9);
    expect(talentBonus(prestigeOf(k), 'smithing')).toBe(0);
  });

  it('is rank × peak × prestiges × rate, and only ever grows with prestiges', () => {
    const rate = PRESTIGE_BOONS.talent.effect.rate!;
    const s = prestigeOf(fresh());
    expect(talentBonus(s, 'fighting')).toBe(0); // never prestiged
    const p: PrestigeState = { ...s, count: 1, purchases: { talent: 1 }, peakLevels: { fighting: 30 } };
    expect(talentBonus(p, 'fighting')).toBeCloseTo(rate * 1 * 30 * 1, 10);
    p.count = 5;
    expect(talentBonus(p, 'fighting')).toBeCloseTo(rate * 1 * 30 * 5, 10);
    p.purchases.talent = 3;
    p.peakLevels.fighting = 300;
    expect(talentBonus(p, 'fighting')).toBeCloseTo(rate * 3 * 300 * 5, 10);
    // The user's brackets: a modest run is a fraction of a percent, a
    // monumental one is a multiple.
    expect(rate * 1 * 30 * 1).toBeLessThan(0.01);
    expect(rate * 5 * 300 * 10).toBeGreaterThan(1);
  });

  it("scales the skill's effects in the stat block, and the cache sees a rank change", () => {
    const k = fresh();
    setSkills(k, { fighting: 20 });
    const base = statOf(reads(k), 'damage');
    patchPrestige(k, (p) => {
      p.count = 2;
      p.purchases = { talent: 1 };
      p.peakLevels = { fighting: 100 };
      p.points = 10;
    });
    const talented = statOf(reads(k), 'damage');
    expect(talented).toBeGreaterThan(base);
    // Buying another rank mid-run must not be served from the cache.
    expect(k.dispatch(buyBoon({ boon: 'talent' })).ok).toBe(true);
    expect(k.staleStats()).toEqual([]);
    expect(statOf(reads(k), 'damage')).toBeGreaterThan(talented);
    // What the skill contributes is scaled by exactly 1 + bonus.
    const contribution = (g: Kernel) =>
      computeBlock(g.modifiers())
        .mods.filter((m) => m.source?.startsWith('Fighting'))
        .reduce((n, m) => n + m.value, 0);
    const plain = fresh();
    setSkills(plain, { fighting: 20 });
    expect(contribution(plain)).not.toBe(0);
    expect(contribution(k)).toBeCloseTo(contribution(plain) * (1 + talentBonus(prestigeOf(k), 'fighting')), 10);
  });
});

describe('endowment', () => {
  it("arrives free with the first prestige and records every attribute's trained peak", () => {
    const k = bandOneCleared();
    patch(k, (s) => {
      const attrs = (s.attributes as AttributesState).attrs;
      attrs.str.level = 12;
      attrs.wis.level = 4;
    });
    prestige(k);
    expect(prestigeOf(k).purchases.endowment).toBe(1);
    expect(prestigeOf(k).peakAttrs).toEqual({ str: 12, dex: 1, con: 1, int: 1, wis: 4, cha: 1 });
    // Peaks never lower.
    clearFloors(k);
    patch(k, (s) => {
      (s.attributes as AttributesState).attrs.str.level = 5;
    });
    prestige(k);
    expect(prestigeOf(k).peakAttrs.str).toBe(12);
  });

  it('scales the effective attribute as the last pass, rank × peak × prestiges × rate', () => {
    const rate = PRESTIGE_BOONS.endowment.effect.rate!;
    const k = fresh();
    patch(k, (s) => {
      (s.attributes as AttributesState).attrs.str.level = 20;
    });
    expect(endowmentBonus(prestigeOf(k), 'str')).toBe(0);
    const plain = attrValue(reads(k), 'str');
    const plainDex = attrValue(reads(k), 'dex');
    patchPrestige(k, (p) => {
      p.count = 3;
      p.purchases = { endowment: 2 };
      p.peakAttrs = { str: 50 };
      p.points = 10;
    });
    const bonus = rate * 2 * 50 * 3;
    expect(endowmentBonus(prestigeOf(k), 'str')).toBeCloseTo(bonus, 10);
    expect(attrValue(reads(k), 'str')).toBeCloseTo(plain * (1 + bonus), 10);
    // Only attributes with a peak move; the breakdown reports the factor.
    expect(attrValue(reads(k), 'dex')).toBe(plainDex);
    expect(attrBreakdown(k.modifiers(), 'str').endowment).toBeCloseTo(bonus, 10);
    expect(attrBreakdown(k.modifiers(), 'dex').endowment).toBeUndefined();
    // The stat block follows, and the cache sees a rank change.
    const before = statOf(reads(k), 'damage');
    expect(k.dispatch(buyBoon({ boon: 'endowment' })).ok).toBe(true);
    expect(k.staleStats()).toEqual([]);
    expect(statOf(reads(k), 'damage')).toBeGreaterThan(before);
  });
});

describe('migration', () => {
  it.todo('v49 → v51 gives an old save an empty legacy block (no importer of the old save)');
  it.todo('v50 → v51 adds peak levels to a legacy block that predates talent (no importer of the old save)');
});
