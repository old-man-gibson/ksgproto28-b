/**
 * The headless walk of spine port 6: from `f0_cell` through every gate to
 * `f6_great_hall`, by commands only.
 *
 * What stands in for port 7 content: the character is given health, damage
 * and armour by the test probe (`WALKER`), because the weapon rack, quests,
 * shops and the training a real climb does are not ported. Nothing else is
 * written into a slice: every move is a `world/*` command, every counter is
 * earned by play.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type Command, type Kernel, type Modifier } from '../src/kernel';
import type { CombatState } from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import type { KnockoutState } from '../src/systems/knockout';
import ladder, { type LadderView } from '../src/systems/ladder';
import { climb, goAndDoCommand, selectActivity, travelTo, type WorldState } from '../src/systems/world';
import { equip, makeGame, setMods, slice } from './helpers';

const WALKER: Modifier[] = [
  { stat: 'stats/maxHp', kind: 'add', value: 4000 },
  { stat: 'stats/damage', kind: 'add', value: 160 },
  { stat: 'stats/armor', kind: 'add', value: 30 },
];

const world = (k: Kernel) => slice<WorldState>(k, 'world');
const counter = (k: Kernel, key: string) => slice<CountersState>(k, 'counters').counts[key] ?? 0;

function send(k: Kernel, command: Command): void {
  const result = k.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} ${JSON.stringify(command.payload)}: ${result.reason} (at ${world(k).spot})`);
}

/** Run until `done` holds. Throws after `limit` ticks. */
function until(k: Kernel, done: () => boolean, what: string, limit = 60_000): void {
  for (let t = 0; t < limit; t += 10) {
    if (done()) return;
    runHeadless(k, { ticks: 10 });
  }
  if (!done()) throw new Error(`${what}: not reached in ${limit} ticks (at ${world(k).spot}, activity ${world(k).activity})`);
}

const standing = (k: Kernel) => !world(k).travel && !slice<CombatState>(k, 'combat').fight;

/** Walk a list of hops, one command per hop: the next spot may be undiscovered. */
function walk(k: Kernel, hops: string[]): void {
  for (const hop of hops) {
    send(k, travelTo({ to: hop }));
    until(k, () => !world(k).travel, `the walk to ${hop}`);
    expect(world(k).spot).toBe(hop);
  }
}

function hunt(k: Kernel, done: () => boolean, what: string): void {
  send(k, selectActivity({ activity: 'hunt' }));
  until(k, done, what);
  until(k, () => !slice<CombatState>(k, 'combat').fight, `${what}: the last fight`);
  send(k, selectActivity({ activity: null }));
}

function work(k: Kernel, activity: string, done: () => boolean, what: string): void {
  send(k, selectActivity({ activity }));
  until(k, done, what);
  send(k, selectActivity({ activity: null }));
}

function rung(k: Kernel, floor: string) {
  return (k.view().systems[ladder.id] as LadderView).towers[0].rungs.find((r) => r.id === floor)!;
}

function climbTo(k: Kernel, floor: string, landing: string): void {
  expect(rung(k, floor).status, `${floor} before the climb`).toBe('open');
  send(k, climb({ floor }));
  until(k, () => !world(k).travel, `the climb to ${floor}`);
  expect(world(k).spot).toBe(landing);
}

describe('the walk from the cell to the Great Hall', () => {
  it('passes every gate of floors 0 to 6 by commands only', () => {
    const k = makeGame({ seed: 11 });
    equip(k, 1); // the rusty sword of a new character
    setMods(k, WALKER);
    expect(world(k).spot).toBe('f0_cell');

    // ---- floor 0: the cellblock, the field, the gate into Threshold ----
    walk(k, ['f0_cellblock', 'f0_field', 'f0_gate', 'ascent_foot']);
    // Threshold has no fog: the first step into it maps the city.
    expect(world(k).discovered).toContain('the_weighbridge');
    // The gate is one-way: no road leads back to floor 0.
    expect(k.dispatch(travelTo({ to: 'f0_gate' })).ok).toBe(false);

    // ---- floor 1: the vermin hall, the archive, the office block, the toll collector ----
    expect(rung(k, 'ascent_f2').status).toBe('sealed');
    climbTo(k, 'ascent_f1', 'f1_landing');
    walk(k, ['f1_storerooms']);
    hunt(k, () => counter(k, 'fights:f1_storerooms') >= 6, 'six wins in the vermin hall');
    walk(k, ['f1_bonded_deep', 'f1_archive']);
    work(k, 'search', () => counter(k, 'flag:key_item:toll_clerk_book') >= 1, 'the daybook');
    walk(k, ['f1_bonded_deep', 'f1_forms', 'f1_reception']);
    work(k, 'explore_reception', () => counter(k, 'flag:key_item:toll_office_key') >= 1, 'the office key');
    // The doors in the order the daybook gives. The last is the forced fight.
    walk(k, ['f1_scribe', 'f1_auditor', 'f1_break_room', 'f1_scribe']);
    send(k, travelTo({ to: 'f1_toll_hall' }));
    until(k, () => counter(k, 'boss:f1_toll_hall') >= 1, 'the toll collector');
    until(k, () => standing(k), 'the end of the toll fight');
    expect(world(k).spot).toBe('f1_toll_hall');
    expect(rung(k, 'ascent_f1').status).toBe('cleared');
    expect(counter(k, 'level:floor:ascent_f1')).toBe(1);

    // ---- floor 2: gate 150 gold earned ----
    if (counter(k, 'gold:earned') < 150) {
      expect(rung(k, 'ascent_f2').status).toBe('gated');
      expect(k.dispatch(climb({ floor: 'ascent_f2' })).ok).toBe(false);
      // Go and do: the walk out of the office block, the ladder down, the city, then the job.
      send(k, goAndDoCommand({ spot: 'the_weighbridge', activity: 'job_hauling' }));
      until(k, () => world(k).spot === 'the_weighbridge' && world(k).activity === 'job_hauling', 'the walk to the weighbridge');
      until(k, () => counter(k, 'gold:earned') >= 150, '150 gold earned');
      send(k, travelTo({ to: 'ascent_foot' }));
      until(k, () => !world(k).travel, 'the walk back to the Foot');
    }
    climbTo(k, 'ascent_f2', 'f2_stairhead');
    for (const hall of ['f2_hall_1', 'f2_hall_2', 'f2_hall_3', 'f2_hall_4']) {
      walk(k, [hall]);
      hunt(k, () => counter(k, `fights:${hall}`) >= 3, `three wins at ${hall}`);
    }
    expect(rung(k, 'ascent_f2').status).toBe('cleared');

    // ---- floor 3: gate 600 gold earned ----
    if (counter(k, 'gold:earned') < 600) {
      send(k, goAndDoCommand({ spot: 'the_weighbridge', activity: 'job_hauling' }));
      until(k, () => counter(k, 'gold:earned') >= 600, '600 gold earned', 400_000);
      send(k, travelTo({ to: 'ascent_foot' }));
      until(k, () => !world(k).travel && world(k).spot === 'ascent_foot', 'the walk back to the Foot');
    }
    climbTo(k, 'ascent_f3', 'f3_stairhead');
    walk(k, ['f3_mail_room']);
    work(k, 'search_room', () => counter(k, 'flag:f3_stairs_1') >= 1, 'the first stair plan');
    walk(k, ['f3_stairhead', 'f3_landing_2']);
    hunt(k, () => counter(k, 'fights:f3_landing_2') >= 2, 'two wins on the second landing');
    walk(k, ['f3_archive']);
    work(k, 'search_room', () => counter(k, 'flag:f3_stairs_2') >= 1, 'the second stair plan');
    walk(k, ['f3_landing_2', 'f3_landing_3']);
    hunt(k, () => counter(k, 'fights:f3_landing_3') >= 2, 'two wins on the third landing');
    walk(k, ['f3_annex']);
    work(k, 'search_room', () => counter(k, 'flag:f3_stairs_3') >= 1, 'the third stair plan');
    walk(k, ['f3_landing_3']);
    send(k, travelTo({ to: 'f3_hearing_room' }));
    until(k, () => counter(k, 'slain:f3_hearing_room:puppet_bureaucrat') >= 1, 'the puppet bureaucrat');
    until(k, () => standing(k), 'the end of the hearing');
    expect(rung(k, 'ascent_f3').status).toBe('cleared');

    // ---- floor 4: no gate; the raid leader on the ravine floor ----
    send(k, travelTo({ to: 'f3_stairhead' }));
    until(k, () => !world(k).travel && world(k).spot === 'f3_stairhead', 'the walk to the stairhead');
    climbTo(k, 'ascent_f4', 'f4_treeline');
    walk(k, ['f4_woods_edge', 'f4_hills', 'f4_ravine_rim', 'f4_ravine_floor']);
    hunt(k, () => counter(k, 'slain:f4_ravine_floor:goblin_raid_leader') >= 1, 'the raid leader');
    expect(rung(k, 'ascent_f4').status).toBe('cleared');

    // ---- floor 5: gate 12 goblin kills ----
    if (counter(k, 'kills:tag:goblin') < 12) {
      expect(rung(k, 'ascent_f5').status).toBe('gated');
      send(k, goAndDoCommand({ spot: 'f4_woods_edge', activity: 'hunt' }));
      until(k, () => counter(k, 'kills:tag:goblin') >= 12, '12 goblin kills', 400_000);
      until(k, () => !slice<CombatState>(k, 'combat').fight, 'the last fight at the woods edge');
      send(k, selectActivity({ activity: null }));
    }
    climbTo(k, 'ascent_f5', 'f5_causeway');
    walk(k, ['f5_bog', 'f5_cave_mouth', 'f5_hollows']);
    work(k, 'explore', () => counter(k, 'flag:f5_back_door') >= 1, 'the back door');
    walk(k, ['f5_back_door']);
    hunt(k, () => counter(k, 'slain:f5_back_door:hobgoblin_champion') >= 1, 'the hobgoblin champion');
    expect(rung(k, 'ascent_f5').status).toBe('cleared');

    // ---- floor 6: gate 40 goblin kills ----
    if (counter(k, 'kills:tag:goblin') < 40) {
      expect(rung(k, 'ascent_f6').status).toBe('gated');
      send(k, goAndDoCommand({ spot: 'f5_bog', activity: 'hunt' }));
      until(k, () => counter(k, 'kills:tag:goblin') >= 40, '40 goblin kills', 800_000);
      until(k, () => !slice<CombatState>(k, 'combat').fight, 'the last fight in the bog');
      send(k, selectActivity({ activity: null }));
    }
    send(k, travelTo({ to: 'f5_causeway' }));
    until(k, () => !world(k).travel && world(k).spot === 'f5_causeway', 'the walk to the causeway');
    climbTo(k, 'ascent_f6', 'f6_warren_mouth');
    walk(k, ['f6_tunnels', 'f6_shrine', 'f6_drop']);
    send(k, travelTo({ to: 'f6_great_hall' }));
    until(k, () => world(k).spot === 'f6_great_hall', 'the Great Hall');
    until(k, () => counter(k, 'slain:f6_great_hall:goblin_warchief') >= 1, 'the warchief', 200_000);
    until(k, () => standing(k), 'the end of the last fight');
    expect(rung(k, 'ascent_f6').status).toBe('cleared');

    // With this seed the character is knocked out once, hunting the Bog for
    // the floor 6 gate (the band's dynamic levels follow the boosted
    // character). The knockout return walks back and the hunt goes on; no
    // command of this test handles it.
    expect(world(k).spot).toBe('f6_great_hall');
    expect(slice<KnockoutState>(k, 'knockout').pendingReturn).toBeNull();
    expect(world(k).recovering).toBe(false);
    expect(k.staleStats()).toEqual([]);
    const ticks = k.snapshot().kernel.tick;
    console.log(`walk: ${ticks} ticks (${(ticks / 36000).toFixed(1)} h of game time), ${counter(k, 'kills')} kills, ${counter(k, 'gold:earned')} gold earned, ${counter(k, 'defeats')} defeats`);
  }, 120_000);
});
