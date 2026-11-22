/**
 * Port of the old `tests/john.test.ts` (completability, band 1) and of the
 * two John cases of the old `tests/band2.test.ts` (band 2). The driver is
 * `tests/john.ts`.
 *
 * The rack climbs take the floor 0 spell 'fire', as the old ones did (since
 * the arcane port); every climb learns floor 2's techniques from the tutor
 * (since the martial port). Old bounds a climb here misses would be an
 * `it.todo` with the measured value and the reason; none is left.
 *
 * Not ported: "the archive's club and the cut strings both answer the
 * bureaucrat" (a duel harness over forced fights with pinned attributes,
 * left for the next John work).
 *
 * "The road past band 2" (the old smoke case at floor 20) is ported at
 * floor 10 since step 4 port C1: run 2 ends after band 3's wards; the siege
 * and run 3 arrive with ports C2 to C7.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { TPS } from '../src/kernel';
import { counterValue } from '../src/systems/counters';
import { runJohn, secs, SEGMENTS, type ClimbReport } from './john';

const RACK = ['sword', 'spear', 'dagger', 'hammer', 'unarmed'];
const SEEDS = [42, 7];
const MINUTE = 60 * TPS;

const label = (r: ClimbReport) => `${r.opts.weapon === 'skip' ? 'john' : r.opts.weapon} / seed ${r.opts.seed}${r.opts.attentive ? ' / attentive' : ''}`;

const john: ClimbReport[] = [];
const rack: ClimbReport[] = [];
/**
 * The loss-rate sample of "the toll collector is a fight": seeds 1 to 8,
 * every rack weapon, 40 climbs of band 1. Added 2026-11-20 (step 4 port L).
 * The old bound counted first attempts lost over the 10 rack climbs of
 * seeds 42 and 7 (at least 1, at most half). A port that draws the
 * generator on every kill shifts every later roll of a climb, and 10 climbs
 * flipped the bound with no change of rate: port L lost 0 of 10 (`main` 5,
 * old build 1) and 16 of 100 on seeds 1 to 6 and 8 to 21 (`main` 15, old
 * 20). Measured on this sample: old build `7c1267b` 13 of 40, `main`
 * `e7bb9a7` 9, `step4-L` 9. Over seeds 1 to 40 (200 climbs): old 34,
 * `main` 41, `step4-L` 31, a rate of 15 to 21%. Bounds from the old rate,
 * about 20% (8 of 40): at least 2 and at most 16 (40%). At a 20% rate a
 * sample under 2 has a chance of about 0.2%; at 15%, about 1%. The 40
 * climbs take this file from 3.7 s to 12.1 s on an idle machine.
 */
const lossSample: ClimbReport[] = [];
const LOSS_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
beforeAll(() => {
  for (const seed of SEEDS) {
    john.push(runJohn({ seed, weapon: 'skip' }));
    for (const weapon of RACK) rack.push(runJohn({ seed, weapon, spell: 'fire' }));
  }
  for (const seed of LOSS_SEEDS) for (const weapon of RACK) lossSample.push(runJohn({ seed, weapon, spell: 'fire' }));
}, 180_000);

describe('John — the floor build clears band 1', () => {
  it('skips the tutorial, swings a rusty sword, and still reaches the top of band 1', () => {
    for (const r of john) {
      expect(r.done.floor3, `${label(r)}: never cleared floor 3`).not.toBeNull();
      expect(r.done.floor3!, `${label(r)}: band 1 took ${secs(r.done.floor3)} s`).toBeLessThanOrEqual(40 * MINUTE);
    }
  });
});

describe('pacing — band 1 by the obvious road, every rack weapon', () => {
  it('every climb finishes band 1, inside half an hour of play', () => {
    for (const r of rack) {
      expect(r.done.floor3, `${label(r)}: never cleared floor 3`).not.toBeNull();
      expect(r.done.floor3!, `${label(r)}: band 1 took ${secs(r.done.floor3)} s`).toBeLessThanOrEqual(30 * MINUTE);
    }
  });

  it('the tutorial is a minute and a half at most, and never lost', () => {
    for (const r of rack) {
      expect(r.done.tutorial!, label(r)).toBeLessThanOrEqual(1.5 * MINUTE);
      expect(r.knockouts.tutorial, label(r)).toBe(0);
    }
  });

  it('the first real fights after the tutorial are survivable with whatever the rack gave', () => {
    // A slime shrugs off half a blade, so a lost fight here can happen, but
    // once at most, and rarely: the rats come first.
    const all = [...john, ...rack];
    for (const r of all) expect(r.knockouts.vermin, label(r)).toBeLessThanOrEqual(1);
    expect(all.filter((r) => r.knockouts.vermin > 0).length).toBeLessThanOrEqual(2);
  });

  it('the toll collector is a fight: it lasts, it can win, and it can be beaten', () => {
    for (const r of rack) {
      expect(r.firstBoss, label(r)).not.toBeNull();
      expect(r.firstBoss!.ticks, `${label(r)}: over in ${secs(r.firstBoss!.ticks)} s`).toBeGreaterThanOrEqual(10 * TPS);
      expect(r.bossAttempts, label(r)).toBeLessThanOrEqual(3);
    }
    const lengths = rack.map((r) => r.firstBoss!.ticks).sort((a, b) => a - b);
    expect(lengths[Math.floor(lengths.length / 2)], 'median first boss fight').toBeGreaterThanOrEqual(20 * TPS);
    // Neither a formality nor a wall: some first attempts lose, most win.
    // Counted over the 40-climb sample (see `lossSample`), not the 10 above.
    for (const r of lossSample) expect(r.firstBoss, label(r)).not.toBeNull();
    const lost = lossSample.filter((r) => !r.firstBoss!.won).length;
    expect(lost, 'the collector almost never won a first attempt').toBeGreaterThanOrEqual(2);
    expect(lost, 'the collector won too many first attempts').toBeLessThanOrEqual(16);
  });

  it('the long hall and the third floor knock a player down, not out of the game', () => {
    for (const r of [...john, ...rack]) {
      expect(r.knockouts.floor2, `${label(r)}: the long hall`).toBeLessThanOrEqual(6);
      expect(r.knockouts.descent + r.knockouts.floor3, `${label(r)}: floor 3`).toBeLessThanOrEqual(20);
    }
  });

  it('no floor pays a fortune: the climb ends holding hundreds, not tens of thousands', () => {
    for (const r of [...john, ...rack]) {
      expect(r.goldEarned, label(r)).toBeGreaterThanOrEqual(600);
      expect(r.goldEarned, label(r)).toBeLessThanOrEqual(3000);
    }
  });
});

describe('John through band 2', () => {
  // The old pair: seed 7 skipping, and seed 1234 with the spear, attentive.
  // The spear climb takes the floor 0 spell 'fire', as the old one did.
  let climbs: ClimbReport[] = [];
  beforeAll(() => {
    climbs = [
      runJohn({ seed: 7, weapon: 'skip', through: 6, budget: 3 * 3600 * TPS }),
      runJohn({ seed: 1234, weapon: 'spear', attentive: true, through: 6, budget: 3 * 3600 * TPS }),
    ];
  }, 120_000);

  it('clears floor 6 inside 45 minutes of play', () => {
    for (const r of climbs) {
      expect(r.done.floor6, `${label(r)}: never cleared floor 6`).not.toBeNull();
      expect(r.done.floor6!, `${label(r)}: took ${secs(r.done.floor6)} s`).toBeLessThanOrEqual(45 * MINUTE);
    }
  });

  it('knocks John down on the way, not out of the game', () => {
    for (const r of climbs) {
      const band = r.knockouts.floor4 + r.knockouts.gate5 + r.knockouts.floor5 + r.knockouts.gate6 + r.knockouts.floor6;
      expect(band, `${label(r)}: band 2 knockouts`).toBeLessThanOrEqual(30);
    }
  });

  it('reaches the first prestige from a fresh save: the next run stands at the Foot', () => {
    for (const r of climbs) {
      expect(r.prestiged, label(r)).toBe(true);
      const k = r.kernel;
      const legacy = k.snapshot().slices.prestige as { count: number };
      expect(legacy.count).toBe(1);
      expect((k.snapshot().slices.world as { spot: string }).spot).toBe('ascent_foot');
      const counts = k.snapshot().slices.counters as Parameters<typeof counterValue>[0];
      expect(counterValue(counts, 'prestige:count')).toBe(1);
      expect(counterValue(counts, 'slain:f6_great_hall:goblin_warchief')).toBe(0);
      expect(k.staleStats()).toEqual([]);
    }
  });
});

describe('John: the road past band 2 (smoke test, no bounds)', () => {
  /**
   * The driver's own health, not the game's pacing: `through: 15` plays three
   * runs (one prestige by choice, the siege's automatic one) and reports a
   * time for every floor. A floor that stays shut for the cap is a finding
   * (`stuck`, then a debug skip), so this does not fail on one; it fails when
   * John stops for want of a rule, or when a segment never closes. The
   * numbers are `npm run pacing -- --through 15`. The old case climbs to 20
   * (ports C5 to C7).
   */
  it('plays every floor to 15 and never stops for want of a rule', () => {
    const r = runJohn({ seed: 42, weapon: 'skip', through: 15 });
    for (const k of SEGMENTS) expect(r.done[k], `${k} never closed`).not.toBeNull();
    for (const [k, st] of Object.entries(r.stuck)) expect(st.wall, `${k}: ${st.why}`).toBe(true);
    expect(r.runs.floor10, 'floor 10 is played in the second run').toBe(2);
    expect(r.runs.siege, 'the siege ends the second run').toBe(2);
    expect(r.runs.floor14, 'floor 14 is played in the third run').toBe(3);
    expect(r.runs.floor15, 'floor 15 is played in the third run').toBe(3);
    const p = r.kernel.snapshot().slices.prestige as { count: number; stronghold: boolean };
    expect(p.count, 'the stronghold prestiged a second time').toBe(2);
    expect(p.stronghold).toBe(true);
  }, 120_000);
});
