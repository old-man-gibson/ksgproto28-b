/**
 * Port of the old `tests/approach.test.ts`: approach bonuses, surprised's
 * teeth, and finite fights. Pocket world, mounted into the spot registries
 * for this file:
 *
 *   ap_camp (haven) <-> ap_gate (explore + lever find) <-> ap_nest (forced)
 *                          \-> ap_lair (forced, once-boss, fightLimit 1)
 *
 * The road gate -> nest carries an approach: enemies surprised, self
 * flat-footed. The camp -> gate road carries one gated on the lever flag.
 *
 * Call shape changes:
 * - The old file wrote the roads into `ADJACENCY` by hand, with the
 *   approaches on them; here the approaches are on the spots' connections
 *   and `buildAdjacency` mirrors the roads (a mirror never carries an
 *   approach).
 * - `state.pendingApproach` is the combat slice's `approach`: the world
 *   stamps it on arrival through the request `combat/approach`, combat
 *   spends it when the first fight at the spot starts.
 * - `Game.travelTo` is the command `world/travel-to`; `walkTo` ticks until
 *   the journey is over. `selectActivity` is the command.
 * - `statusIncomingDamageMult(bearer)` takes the held list;
 *   `applyStatus(state, bearer, app)` is the request `statuses/apply`.
 * - `g.state.lastFight.transcript` is the combat slice's `lastFight`.
 * - `eligibleEncounters(state, spot)` is `eligibleAt(reads, spot)`;
 *   `spawnMonster` is the combat helper `spawn`.
 * - The migration case: a combat slice saved at version 2 (before the
 *   approach) loads with none pending. The old case loaded a version 38 save.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { fightsKey, slainKey, type EncounterSite } from '../src/systems/combat';
import type { FeedEntry, LogState } from '../src/systems/log';
import { applyStatus, heldOf, statusIncomingDamageMult, type StatusesState } from '../src/systems/statuses';
import { statOf } from '../src/systems/stats';
import { eligibleAt, selectActivity, spotCleared, SPOTS, travelTo, type SpotDef } from '../src/systems/world';
import { combatOf, spawn } from './combatHelpers';
import { ask, makeGame, patch, reads, readJson, slice } from './helpers';
import { counterOf, mountSpots, patchWorld, sent, setCounters, worldOf } from './worldHelpers';

const ARENA: Record<string, SpotDef> = {
  ap_camp: {
    id: 'ap_camp', name: 'Approach Camp', icon: '🏕️', areaId: 'ascent_f0_area', desc: '',
    activities: [{ id: 'rest', kind: 'rest', name: 'Camp', icon: '🏕️' }],
    // Gated approach: tells only once the lever flag is set. The gate itself
    // has nothing to fight: the stamp is what this road exists to test.
    connections: [
      {
        to: 'ap_gate', ticks: 5,
        approach: { requires: [{ type: 'stat', key: 'flag:test_lever', value: 1 }], enemies: [{ id: 'surprised' }] },
      },
    ],
  },
  ap_gate: {
    id: 'ap_gate', name: 'Approach Gate', icon: '🚪', areaId: 'ascent_f0_area', desc: '',
    activities: [{ id: 'explore', kind: 'explore', name: 'Explore', icon: '🧭' }],
    exploreTicks: 10,
    finds: [{ id: 'lever', at: 0.5, desc: '🎚️ A lever, and you pull it.', stat: { key: 'flag:test_lever' } }],
    connections: [
      { to: 'ap_nest', ticks: 5, approach: { enemies: [{ id: 'surprised' }], self: [{ id: 'flat_footed' }] } },
      { to: 'ap_lair', ticks: 5 },
    ],
  },
  ap_nest: {
    id: 'ap_nest', name: 'Approach Nest', icon: '🕸️', areaId: 'ascent_f0_area', desc: '', forced: true,
    activities: [],
    encounters: [
      { monsterId: 'forest_rat', weight: 100, level: [1, 1] },
      // Only prowls once the lever elsewhere has been pulled.
      { monsterId: 'young_wolf', weight: 100, level: [2, 2], requires: [{ type: 'stat', key: 'flag:test_lever', value: 1 }] },
    ],
    groupWeights: [{ size: 1, weight: 100 }],
    connections: [],
  },
  ap_lair: {
    id: 'ap_lair', name: 'Approach Lair', icon: '🕳️', areaId: 'ascent_f0_area', desc: '', forced: true,
    fightLimit: 1,
    activities: [{ id: 'hunt', kind: 'hunt', name: 'Hunt', icon: '🏹' }],
    encounters: [{ monsterId: 'forest_rat', weight: 100, level: [1, 1], once: true }],
    groupWeights: [{ size: 1, weight: 100 }],
    connections: [],
  },
};

let unmount = () => {};
beforeAll(() => {
  unmount = mountSpots(ARENA);
});
afterAll(() => unmount());

function arenaGame(seed: number, spot: string): Kernel {
  const k = makeGame({ seed });
  patchWorld(k, (w) => {
    w.spot = spot;
    for (const id of Object.keys(ARENA)) if (!w.discovered.includes(id)) w.discovered.push(id);
    w.safeSpots = { nearest: 'ap_camp', unconditional: 'ap_camp' };
  });
  return k;
}

function walkTo(k: Kernel, to: string): void {
  expect(sent(k, travelTo({ to })), `travel to ${to} should start`).toBe(true);
  for (let i = 0; i < 200 && worldOf(k).travel; i++) k.tick();
}

const held = (k: Kernel, entity: string): string[] => heldOf(slice<StatusesState>(k, 'statuses'), entity).map((s) => s.id);

/** Fight until the fight closes. */
function fightOut(k: Kernel): void {
  for (let i = 0; i < 3000 && combatOf(k).fight; i++) k.tick();
}

describe('the surprised condition', () => {
  it('amplifies incoming damage by 30% per intensity, on either side', () => {
    const k = arenaGame(1, 'ap_camp');
    const site: EncounterSite = { id: 'ap_nest', name: 'Approach Nest', encounters: [{ monsterId: 'forest_rat', weight: 100, level: [1, 1] }] };
    const bearer = spawn(k, site);
    const list = () => heldOf(slice<StatusesState>(k, 'statuses'), bearer.entity);
    expect(statusIncomingDamageMult(list())).toBe(1);
    ask(k, applyStatus, { entity: bearer.entity, app: { id: 'surprised' } });
    expect(statusIncomingDamageMult(list())).toBeCloseTo(1.3);

    ask(k, applyStatus, { entity: PLAYER, app: { id: 'surprised', intensity: 2 } });
    expect(statusIncomingDamageMult(heldOf(slice<StatusesState>(k, 'statuses'), PLAYER))).toBeCloseTo(1.6);
  });
});

describe('approach bonuses', () => {
  /**
   * Changed: the old advance ticked no fight on a tick of travel, so the old
   * case read the formation on the arrival tick, before any swing. Here
   * combat ticks after the world in the same kernel tick, so the forced
   * fight's first combat tick is the arrival tick. With the opening tempo the
   * player swings on it, and that blow spends the surprise. The case reads
   * the same facts from the fight's transcript: the approach line, the
   * player's first blow on the arrival tick, carrying the bite.
   */
  it('the road in surprises the nest and leaves you flat-footed, before anyone swings', () => {
    const k = arenaGame(2, 'ap_gate');
    walkTo(k, 'ap_nest');

    expect(combatOf(k).fight?.forced).toBe(true);
    expect(held(k, PLAYER)).toContain('flat_footed');
    expect(combatOf(k).approach).toBeNull(); // spent on this first meeting
    const transcript = slice<LogState>(k, 'log').transcript ?? [];
    const lines = transcript.map((e) => e.text);
    expect(lines).toContain('🥷 Your approach applied conditions to the enemies.');
    expect(lines).toContain('😦 You arrive flat-footed!');

    // Opening tempo: the bar started one tick short of full, so the first
    // blow is the player's, on the arrival tick, and it carries the bite.
    const blows = transcript.filter((e) => e.damage);
    expect(blows.length).toBe(1);
    expect(blows[0].damage!.label).toBe('Your attack');
    expect(blows[0].damage!.steps.some((s) => s.label === 'Conditions on the target')).toBe(true);
    expect(combatOf(k).fight!.playerBar).toBeLessThan(statOf(reads(k), 'actionBar') * 0.5);
  });

  /**
   * Changed: the saved `lastFight` transcript drops the damage reports (the
   * new log keeps them only while the fight is open), so the blows are read
   * from the open transcript on the last tick before the fight closes.
   */
  it('the bite lands in the books: a blow on the surprised rat carries the step, once', () => {
    const k = arenaGame(3, 'ap_gate');
    walkTo(k, 'ap_nest');
    let open: FeedEntry[] = [];
    for (let i = 0; i < 3000 && combatOf(k).fight; i++) {
      open = slice<LogState>(k, 'log').transcript ?? open;
      k.tick();
    }
    expect(combatOf(k).lastFight?.outcome).toBe('won');

    // The transcript keeps every blow's breakdown; the ambush names itself
    // there, and only on the blow that spent it.
    const bitten = open.filter((e) => e.damage?.steps.some((s) => s.label === 'Conditions on the target'));
    expect(bitten.length).toBe(1);
  });

  it('a gated approach does not tell until the lever is pulled', () => {
    const k = arenaGame(4, 'ap_camp');
    walkTo(k, 'ap_gate');
    expect(combatOf(k).approach).toBeNull(); // flag unset: the stamp never lands

    walkTo(k, 'ap_camp');
    setCounters(k, { 'flag:test_lever': 1 });
    walkTo(k, 'ap_gate');
    expect(combatOf(k).approach?.spot).toBe('ap_gate'); // now it tells
  });

  it('any arrival without an approach wipes the stamp', () => {
    // New: the old rule's other half ("an opening never outlives the road
    // that bought it"), stated on its own.
    const k = arenaGame(4, 'ap_camp');
    setCounters(k, { 'flag:test_lever': 1 });
    walkTo(k, 'ap_gate');
    expect(combatOf(k).approach?.spot).toBe('ap_gate');
    walkTo(k, 'ap_camp');
    expect(combatOf(k).approach).toBeNull();
  });

  it('pulling the lever is a find like any other', () => {
    const k = arenaGame(5, 'ap_gate');
    expect(sent(k, selectActivity({ activity: 'explore' }))).toBe(true);
    for (let i = 0; i < 40 && counterOf(k, 'flag:test_lever') < 1; i++) k.tick();
    expect(counterOf(k, 'flag:test_lever')).toBe(1);
  });

  it('a gated encounter joins the table when its flag is set', () => {
    const k = arenaGame(6, 'ap_nest');
    expect(eligibleAt(reads(k), SPOTS.ap_nest).map((e) => e.monsterId)).toEqual(['forest_rat']);
    setCounters(k, { 'flag:test_lever': 1 });
    expect(eligibleAt(reads(k), SPOTS.ap_nest).map((e) => e.monsterId)).toEqual(['forest_rat', 'young_wolf']);
    // ...and the spawner reads the same list.
    const site: EncounterSite = { id: 'ap_nest', name: 'Approach Nest', encounters: ARENA.ap_nest.encounters as never };
    expect(['forest_rat', 'young_wolf']).toContain(spawn(k, site).defId);
  });
});

describe('finite fights', () => {
  it('a once-kill is recorded, the budget spends, and the lair goes quiet', () => {
    const k = arenaGame(7, 'ap_gate');
    walkTo(k, 'ap_lair');
    expect(combatOf(k).fight?.forced).toBe(true);
    fightOut(k);
    expect(combatOf(k).lastFight?.outcome).toBe('won');

    expect(counterOf(k, slainKey('ap_lair', 'forest_rat'))).toBe(1);
    expect(counterOf(k, fightsKey('ap_lair'))).toBe(1);
    expect(spotCleared(reads(k), SPOTS.ap_lair)).toBe(true);
    expect(eligibleAt(reads(k), SPOTS.ap_lair)).toEqual([]);

    // Cleared: re-entering is just arriving, and hunting finds no one.
    walkTo(k, 'ap_gate');
    walkTo(k, 'ap_lair');
    expect(combatOf(k).fight).toBeNull();
    sent(k, selectActivity({ activity: 'hunt' }));
    for (let i = 0; i < 100; i++) k.tick();
    expect(combatOf(k).fight).toBeNull();
  });

  it('resetting the counters repopulates the lair: the flag brings the boss back', () => {
    const k = arenaGame(8, 'ap_gate');
    walkTo(k, 'ap_lair');
    fightOut(k);
    expect(spotCleared(reads(k), SPOTS.ap_lair)).toBe(true);

    // What a reset find would write (stat: { key, set: 0 } on both counters).
    setCounters(k, { [slainKey('ap_lair', 'forest_rat')]: 0, [fightsKey('ap_lair')]: 0 });
    expect(spotCleared(reads(k), SPOTS.ap_lair)).toBe(false);

    walkTo(k, 'ap_gate');
    walkTo(k, 'ap_lair');
    expect(combatOf(k).fight?.forced).toBe(true); // forced again: the lair is restocked
  });
});

describe('migration', () => {
  it('a combat slice saved before the approach arrives with no approach pending', () => {
    const k = makeGame({ seed: 9 });
    const envelope = k.save(0);
    const v2 = readJson('tests/fixtures/combat/v2.json') as Record<string, unknown>;
    envelope.slices.combat = { version: 2, data: v2 as never };
    const back = makeGame({ seed: 9 });
    expect(back.load(envelope).ok).toBe(true);
    expect(combatOf(back).approach).toBeNull();
    expect(slice<{ approach: unknown }>(back, 'combat')).toHaveProperty('approach', null);
    patch(back, () => {});
  });
});
