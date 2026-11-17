/**
 * The world system, cases new in this repository: determinism, the pace it
 * states to the pools, the office block of floor 1, the hunt activity, a
 * forced spot, the reason of every refused command, and the derived-value
 * cache after a long run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Command, Kernel, Modifier } from '../src/kernel';
import type { GoldState } from '../src/systems/gold';
import type { ResourcesState } from '../src/systems/resources';
import {
  cancelPlan,
  canStartActivity,
  climb,
  fastTravel,
  goAndDoCommand,
  OFFICE_PROGRESS,
  searchSpent,
  selectActivity,
  setIntent,
  travelTo,
  type SpotDef,
} from '../src/systems/world';
import { combatOf } from './combatHelpers';
import { equip, makeGame, patch, reads, setMods, slice } from './helpers';
import { counterOf, discover, gameAt, hop, mountSpots, patchWorld, sent, setCounters, walkUntilStill, worldOf } from './worldHelpers';

/** A body that wins the fights of floors 1 to 3. Stands in for the gear and training of a real climb. */
const WALKER: Modifier[] = [
  { stat: 'stats/maxHp', kind: 'add', value: 4000 },
  { stat: 'stats/damage', kind: 'add', value: 160 },
  { stat: 'stats/armor', kind: 'add', value: 30 },
];

function walker(seed: number, spot: string): Kernel {
  const k = gameAt(seed, spot);
  equip(k, 1); // the rusty sword of a new character
  setMods(k, WALKER);
  return k;
}

const paceOf = (k: Kernel) => slice<ResourcesState>(k, 'resources').pace;

/** The refusal of a command: its reason. Fails when the command ran. */
function refusal(k: Kernel, command: Command): string {
  const result = k.dispatch(command);
  expect(result.ok, `${command.type} ${JSON.stringify(command.payload)} ran`).toBe(false);
  const reason = result.ok ? '' : result.reason;
  expect(reason.length, `${command.type} gave no reason`).toBeGreaterThan(0);
  return reason;
}

// A search that can be spent: no search in scope has every reward under a limit.
const POCKET: Record<string, SpotDef> = {
  tw_cache: {
    id: 'tw_cache', name: 'Test Cache', icon: '📦', areaId: 'ascent_f0_area', desc: '',
    activities: [
      {
        id: 'search', kind: 'search', name: 'Search', icon: '🔎', ticksPer: 5,
        rewards: [{ id: 'only', weight: 1, limit: 1, gold: { min: 2, max: 2 } }],
      },
    ],
    connections: [],
  },
  // A waypoint pair for the caravan, 60 + 70 ticks apart: the Foot is the one waypoint in scope.
  tw_post_a: {
    id: 'tw_post_a', name: 'Test Post A', icon: '⚡', areaId: 'ascent_f0_area', desc: '', waypoint: true,
    activities: [{ id: 'rest', kind: 'rest', name: 'Rest', icon: '🏕️' }],
    connections: [{ to: 'tw_mid', ticks: 60 }],
  },
  tw_mid: {
    id: 'tw_mid', name: 'Test Halfway', icon: '🛤️', areaId: 'ascent_f0_area', desc: '',
    activities: [],
    connections: [{ to: 'tw_post_b', ticks: 70 }],
  },
  tw_post_b: {
    id: 'tw_post_b', name: 'Test Post B', icon: '⚡', areaId: 'ascent_f0_area', desc: '', waypoint: true,
    activities: [{ id: 'drill', kind: 'train', name: 'Drill', icon: '🏋️', attr: 'str' }],
    connections: [],
  },
};

let unmount = () => {};
beforeAll(() => {
  unmount = mountSpots(POCKET);
});
afterAll(() => unmount());

// ---- (a) determinism ----

type Step = Command | number;

/** A journey with a plan and an intent, a hunt, a job, a climb and a second hunt. */
const SCRIPT: Step[] = [
  goAndDoCommand({ spot: 'the_sand', activity: 'hunt' }),
  6, // the split point: on the first of two legs
  400,
  goAndDoCommand({ spot: 'the_weighbridge', activity: 'job_hauling' }),
  500,
  travelTo({ to: 'ascent_foot' }),
  100,
  climb({ floor: 'ascent_f1' }),
  100,
  goAndDoCommand({ spot: 'f1_storerooms', activity: 'hunt' }),
  400,
  selectActivity({ activity: null }),
  20,
];

function play(k: Kernel, steps: Step[]): void {
  for (const step of steps) {
    if (typeof step === 'number') k.tick(step);
    else k.dispatch(step);
  }
}

function startOfScript(seed: number): Kernel {
  const k = gameAt(seed, 'ascent_foot');
  equip(k, 1);
  discover(k, 'ironyard_gate', 'the_sand', 'granary_gate', 'the_weighbridge');
  return k;
}

describe('determinism', () => {
  it('the same seed and commands give the same world slice', () => {
    const a = startOfScript(21);
    const b = startOfScript(21);
    play(a, SCRIPT);
    play(b, SCRIPT);
    expect(worldOf(a)).toEqual(worldOf(b));
    expect(a.snapshot()).toEqual(b.snapshot());
    // The script moved the character: the comparison is not of two idle games.
    expect(worldOf(a).discovered).toContain('f1_storerooms');
    expect(counterOf(a, 'gold:earned')).toBeGreaterThan(0);

    const other = startOfScript(22);
    play(other, SCRIPT);
    expect(other.snapshot()).not.toEqual(a.snapshot());
  });

  it('a run split by a save and a load in the middle of a journey with a plan and an intent equals the whole run', () => {
    const whole = startOfScript(21);
    play(whole, SCRIPT);

    const first = startOfScript(21);
    play(first, SCRIPT.slice(0, 2));
    // The split is where it is meant to be.
    expect(worldOf(first).travel?.to).toBe('ironyard_gate');
    expect(worldOf(first).travelPlan).toEqual(['the_sand']);
    expect(worldOf(first).travelIntent).toEqual({ spot: 'the_sand', activity: 'hunt' });

    const second = makeGame({ seed: 999 });
    expect(second.load(JSON.parse(JSON.stringify(first.save(0)))).ok).toBe(true);
    play(second, SCRIPT.slice(2));

    expect(worldOf(second)).toEqual(worldOf(whole));
    expect(second.snapshot()).toEqual(whole.snapshot());
  });
});

// ---- (b) the pace ----

describe('the pace stated to the pools (old `RECOVERY_MULT`)', () => {
  it('is halted while travelling and not after the arrival', () => {
    const k = gameAt(31, 'ironyard_gate');
    expect(sent(k, travelTo({ to: 'the_sand' }))).toBe(true);
    expect(paceOf(k).halted).toBe(true);
    k.tick(3);
    expect(paceOf(k).halted).toBe(true);
    walkUntilStill(k);
    expect(worldOf(k).spot).toBe('the_sand');
    expect(paceOf(k)).toMatchObject({ halted: false, resting: false, hpMult: 1, healKind: 'idle' });
  });

  it('is resting with hpMult 15 at a rest activity', () => {
    const k = gameAt(32, 'ascent_foot');
    expect(sent(k, selectActivity({ activity: 'rest_foot' }))).toBe(true);
    expect(paceOf(k)).toMatchObject({ halted: false, resting: true, hpMult: 15, healKind: 'rest' });
  });

  it('has hpMult 4 at a job, 2 at training, 1 at a hunt and 1 with no activity', () => {
    const job = gameAt(33, 'the_weighbridge');
    expect(sent(job, selectActivity({ activity: 'job_hauling' }))).toBe(true);
    expect(paceOf(job)).toMatchObject({ halted: false, resting: false, hpMult: 4, healKind: 'idle' });
    expect(sent(job, selectActivity({ activity: 'train_str_haul' }))).toBe(true);
    expect(paceOf(job)).toMatchObject({ halted: false, resting: false, hpMult: 2, healKind: 'idle' });
    expect(sent(job, selectActivity({ activity: null }))).toBe(true);
    expect(paceOf(job)).toMatchObject({ halted: false, resting: false, hpMult: 1, healKind: 'idle' });

    const hunt = gameAt(34, 'the_sand');
    expect(sent(hunt, selectActivity({ activity: 'train_dex_sand' }))).toBe(true);
    expect(paceOf(hunt).hpMult).toBe(2);
    expect(sent(hunt, selectActivity({ activity: 'hunt' }))).toBe(true);
    expect(paceOf(hunt)).toMatchObject({ halted: false, resting: false, hpMult: 1, healKind: 'idle' });
  });
});

// ---- (c) the office block of floor 1 ----

describe('the office block of floor 1 (old `officeArrival`)', () => {
  const DROPS = ['f1_auditor', 'f1_break_room', 'f1_registry', 'f1_dispatch', 'f1_supplies', 'f1_records'];

  /** At reception with the daybook and the office key. */
  function atReception(seed: number): Kernel {
    const k = walker(seed, 'f1_reception');
    setCounters(k, { 'flag:key_item:toll_clerk_book': 1, 'flag:key_item:toll_office_key': 1 });
    return k;
  }

  /** Take one door and return where it let out. */
  function door(k: Kernel, to: string): string {
    expect(hop(k, to), `the door to ${to} from ${worldOf(k).spot}`).toBe(true);
    walkUntilStill(k);
    return worldOf(k).spot;
  }

  it('the right door sequence reaches f1_toll_hall', () => {
    const k = atReception(41);
    const order = ['f1_scribe', 'f1_auditor', 'f1_break_room', 'f1_scribe'];
    order.forEach((room, i) => {
      expect(door(k, room)).toBe(room);
      expect(counterOf(k, OFFICE_PROGRESS)).toBe(i + 1);
    });
    expect(door(k, 'f1_toll_hall')).toBe('f1_toll_hall');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(5);
    // The collector's hall is a forced spot.
    expect(combatOf(k).fight?.forced).toBe(true);
  });

  it('a wrong door drops the character in another office and resets the sequence', () => {
    for (let seed = 42; seed < 48; seed++) {
      const k = atReception(seed);
      expect(door(k, 'f1_scribe')).toBe('f1_scribe');
      expect(counterOf(k, OFFICE_PROGRESS)).toBe(1);
      // The auditor is next. The registry is a wrong door.
      const landed = door(k, 'f1_registry');
      expect(landed).not.toBe('f1_registry');
      expect(DROPS).toContain(landed);
      expect(counterOf(k, OFFICE_PROGRESS)).toBe(0);
      expect(worldOf(k).discovered).toContain(landed);
      expect(worldOf(k).discovered).not.toContain('f1_registry');
    }
  });

  it('a wrong door ends the journey it was a leg of', () => {
    const k = atReception(48);
    discover(k, 'f1_registry', 'f1_dispatch');
    patchWorld(k, (w) => {
      w.resumeActivity = {};
    });
    expect(hop(k, 'f1_registry')).toBe(true);
    patchWorld(k, (w) => {
      w.travelPlan = ['f1_dispatch'];
      w.travelIntent = { spot: 'f1_dispatch', activity: '' };
    });
    walkUntilStill(k);
    expect(worldOf(k).spot).not.toBe('f1_registry');
    expect(worldOf(k).travelPlan).toEqual([]);
    expect(worldOf(k).travelIntent).toBeNull();
    expect(worldOf(k).travel).toBeNull();
  });

  it("the collector's door taken out of order leads to reception", () => {
    const k = atReception(49);
    expect(door(k, 'f1_scribe')).toBe('f1_scribe');
    expect(door(k, 'f1_toll_hall')).toBe('f1_reception');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(0);
    expect(combatOf(k).fight).toBeNull();

    // And straight from reception.
    expect(door(k, 'f1_toll_hall')).toBe('f1_reception');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(0);
  });

  it("the scribe's door restarts the sequence at 1", () => {
    const k = atReception(50);
    expect(door(k, 'f1_scribe')).toBe('f1_scribe');
    expect(door(k, 'f1_auditor')).toBe('f1_auditor');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(2);
    // The break room is next. The scribe's door is wrong, and it opens where it says.
    expect(door(k, 'f1_scribe')).toBe('f1_scribe');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(1);
    // The sequence goes on from there.
    expect(door(k, 'f1_auditor')).toBe('f1_auditor');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(2);
  });

  it('leaving the block resets the sequence', () => {
    const k = atReception(51);
    expect(door(k, 'f1_scribe')).toBe('f1_scribe');
    expect(door(k, 'f1_reception')).toBe('f1_reception');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(0);
    setCounters(k, { [OFFICE_PROGRESS]: 3 });
    expect(door(k, 'f1_forms')).toBe('f1_forms');
    expect(counterOf(k, OFFICE_PROGRESS)).toBe(0);
  });

  it('after boss:f1_toll_hall is set every door leads where it says', () => {
    const k = atReception(52);
    // As the win leaves the counters: the boss down, the fight budget spent.
    setCounters(k, { 'boss:f1_toll_hall': 1, 'fights:f1_toll_hall': 1 });
    for (const room of ['f1_registry', 'f1_records', 'f1_scribe', 'f1_supplies', 'f1_toll_hall']) {
      expect(door(k, room)).toBe(room);
    }
    expect(combatOf(k).fight).toBeNull();
    expect(door(k, 'f1_reception')).toBe('f1_reception');
    expect(door(k, 'f1_toll_hall')).toBe('f1_toll_hall');
  });
});

// ---- (d) the hunt activity ----

describe('the hunt activity', () => {
  it('selecting hunt at f1_storerooms turns the hunt of combat on with the site of the spot', () => {
    const k = walker(61, 'f1_storerooms');
    expect(combatOf(k).hunting).toBe(false);
    expect(sent(k, selectActivity({ activity: 'hunt' }))).toBe(true);
    k.tick();
    expect(combatOf(k).hunting).toBe(true);
    expect(combatOf(k).site?.id).toBe('f1_storerooms');
    expect(combatOf(k).site?.fightLimit).toBe(6);
  });

  it('stopping turns it off and abandons the fight', () => {
    const k = walker(62, 'f1_storerooms');
    expect(sent(k, selectActivity({ activity: 'hunt' }))).toBe(true);
    for (let i = 0; i < 2000 && !combatOf(k).fight; i++) k.tick();
    expect(combatOf(k).fight).not.toBeNull();
    const fights = counterOf(k, 'fights:f1_storerooms');
    expect(sent(k, selectActivity({ activity: null }))).toBe(true);
    expect(combatOf(k).hunting).toBe(false);
    expect(combatOf(k).fight).toBeNull();
    k.tick(200);
    expect(combatOf(k).fight).toBeNull();
    // A fight walked away from is not a win.
    expect(counterOf(k, 'fights:f1_storerooms')).toBe(fights);
  });

  it('travelling away turns it off and abandons the fight', () => {
    const k = walker(63, 'f1_storerooms');
    expect(sent(k, selectActivity({ activity: 'hunt' }))).toBe(true);
    for (let i = 0; i < 2000 && !combatOf(k).fight; i++) k.tick();
    expect(sent(k, travelTo({ to: 'f1_landing' }))).toBe(true);
    expect(combatOf(k).hunting).toBe(false);
    expect(combatOf(k).fight).toBeNull();
    expect(worldOf(k).activity).toBeNull();
    walkUntilStill(k);
    expect(worldOf(k).spot).toBe('f1_landing');
    expect(combatOf(k).fight).toBeNull();
  });

  it('six wins clear the spot and the hunt rolls nothing more', () => {
    const k = walker(64, 'f1_storerooms');
    expect(sent(k, selectActivity({ activity: 'hunt' }))).toBe(true);
    for (let i = 0; i < 60_000 && counterOf(k, 'fights:f1_storerooms') < 6; i++) k.tick();
    expect(counterOf(k, 'fights:f1_storerooms')).toBe(6);
    for (let i = 0; i < 2000 && combatOf(k).fight; i++) k.tick();
    const kills = counterOf(k, 'kills');
    k.tick(1500);
    expect(combatOf(k).fight).toBeNull();
    expect(counterOf(k, 'fights:f1_storerooms')).toBe(6);
    expect(counterOf(k, 'kills')).toBe(kills);
    // The road onward shows and opens.
    expect(sent(k, travelTo({ to: 'f1_bonded_deep' }))).toBe(true);
  });
});

// ---- (e) a forced spot ----

describe('a forced spot (f3_hearing_room)', () => {
  function atTheDoor(seed: number): Kernel {
    const k = walker(seed, 'f3_landing_3');
    setCounters(k, { 'flag:f3_stairs_3': 1 });
    return k;
  }

  it('starts its fight on arrival and refuses travel and activity switches until it ends', () => {
    const k = atTheDoor(71);
    expect(sent(k, travelTo({ to: 'f3_hearing_room' }))).toBe(true);
    expect(combatOf(k).fight).toBeNull();
    walkUntilStill(k);
    expect(worldOf(k).spot).toBe('f3_hearing_room');
    expect(worldOf(k).activity).toBeNull();
    expect(combatOf(k).fight?.forced).toBe(true);
    expect(combatOf(k).hunting).toBe(false);
    // An ambushed arrival records no haven.
    expect(worldOf(k).safeSpots.nearest).not.toBe('f3_hearing_room');

    expect(refusal(k, travelTo({ to: 'f3_landing_3' }))).toBe('the fight cannot be left');
    expect(refusal(k, selectActivity({ activity: 'hunt' }))).toBe('the fight cannot be left');
    expect(refusal(k, goAndDoCommand({ spot: 'f3_hearing_room', activity: 'hunt' }))).toBe('the fight cannot be left');
    expect(refusal(k, goAndDoCommand({ spot: 'f3_landing_3', activity: 'hunt' }))).toBe('the fight cannot be left');
    expect(refusal(k, climb({ floor: null }))).toBe('the fight cannot be left');
    expect(hop(k, 'f3_landing_3')).toBe(false);
    expect(worldOf(k).spot).toBe('f3_hearing_room');
    expect(worldOf(k).travel).toBeNull();
    expect(worldOf(k).activity).toBeNull();
    expect(combatOf(k).fight?.forced).toBe(true);
  });

  it('forces nothing once cleared', () => {
    const k = atTheDoor(72);
    expect(sent(k, travelTo({ to: 'f3_hearing_room' }))).toBe(true);
    walkUntilStill(k);
    for (let i = 0; i < 20_000 && combatOf(k).fight; i++) k.tick();
    expect(combatOf(k).lastFight?.outcome).toBe('won');
    expect(worldOf(k).spot).toBe('f3_hearing_room');
    expect(counterOf(k, 'fights:f3_hearing_room')).toBe(1);

    // Standing there: no second fight.
    k.tick(300);
    expect(combatOf(k).fight).toBeNull();
    // Leaving and coming back: no ambush, and the haven rule sees a peaceful arrival.
    expect(sent(k, travelTo({ to: 'f3_landing_3' }))).toBe(true);
    walkUntilStill(k);
    expect(worldOf(k).spot).toBe('f3_landing_3');
    expect(sent(k, travelTo({ to: 'f3_hearing_room' }))).toBe(true);
    walkUntilStill(k);
    expect(worldOf(k).spot).toBe('f3_hearing_room');
    k.tick(50);
    expect(combatOf(k).fight).toBeNull();
    expect(sent(k, selectActivity({ activity: null }))).toBe(true);
  });
});

// ---- (f) reasons ----

describe('every command returns a reason when it does not run', () => {
  it('an unknown spot', () => {
    const k = gameAt(81, 'ascent_foot');
    expect(refusal(k, travelTo({ to: 'nowhere' }))).toContain('nowhere');
    expect(refusal(k, goAndDoCommand({ spot: 'nowhere', activity: 'hunt' }))).toContain('nowhere');
    expect(refusal(k, fastTravel({ to: 'nowhere' }))).toContain('nowhere');
    expect(refusal(k, climb({ floor: 'no_floor' }))).toContain('no_floor');
  });

  it('no route, the spot underfoot, a shut floor, no ladder, no caravan', () => {
    const k = gameAt(82, 'f0_cell');
    expect(refusal(k, travelTo({ to: 'f6_great_hall' }))).toContain('no known route');
    expect(refusal(k, goAndDoCommand({ spot: 'the_sand', activity: 'hunt' }))).toContain('no known route');
    expect(refusal(k, travelTo({ to: 'f0_cell' }))).toBe('the character stands there');
    // Floor 0 is off the ladder.
    expect(refusal(k, climb({ floor: null }))).toBe('no ladder answers here');
    expect(refusal(k, climb({ floor: 'ascent_f1' }))).toContain('ascent_f1');
    expect(refusal(k, fastTravel({ to: 'f0_cellblock' })).length).toBeGreaterThan(0);

    const foot = gameAt(82, 'ascent_foot');
    expect(refusal(foot, climb({ floor: 'ascent_f2' }))).toContain('ascent_f2');
    expect(worldOf(foot).travel).toBeNull();
  });

  it('travelling', () => {
    const k = gameAt(83, 'ironyard_gate');
    discover(k, 'the_sand', 'long_gallery');
    expect(sent(k, travelTo({ to: 'the_sand' }))).toBe(true);
    const before = worldOf(k);
    expect(refusal(k, travelTo({ to: 'long_gallery' }))).toBe('a journey is under way');
    expect(refusal(k, goAndDoCommand({ spot: 'long_gallery', activity: 'train_dex_gallery' }))).toBe('a journey is under way');
    expect(refusal(k, selectActivity({ activity: 'train_str_muster' }))).toBe('a journey is under way');
    expect(refusal(k, selectActivity({ activity: null }))).toBe('a journey is under way');
    expect(refusal(k, climb({ floor: 'ascent_f1' }))).toBe('a journey is under way');
    expect(refusal(k, fastTravel({ to: 'long_gallery' })).length).toBeGreaterThan(0);
    // One leg: nothing to cancel.
    expect(refusal(k, cancelPlan())).toBe('no further leg is planned');
    expect(worldOf(k)).toEqual(before);
  });

  it('knocked out', () => {
    const k = gameAt(84, 'ascent_foot');
    discover(k, 'ironyard_gate');
    patchWorld(k, (w) => {
      w.recovering = true;
    });
    const before = worldOf(k);
    expect(refusal(k, travelTo({ to: 'ironyard_gate' }))).toBe('the character is knocked out');
    expect(refusal(k, goAndDoCommand({ spot: 'ironyard_gate', activity: 'train_str_muster' }))).toBe('the character is knocked out');
    expect(refusal(k, climb({ floor: 'ascent_f1' }))).toBe('the character is knocked out');
    expect(refusal(k, fastTravel({ to: 'ironyard_gate' })).length).toBeGreaterThan(0);
    expect(worldOf(k)).toEqual(before);

    // A pick at the spot is not refused: the old `selectActivity` and the old
    // `goAndDo` standing there took one during the recovery.
    expect(sent(k, selectActivity({ activity: 'rest_foot' }))).toBe(true);
    expect(worldOf(k).activity).toBe('rest_foot');
    expect(sent(k, selectActivity({ activity: null }))).toBe(true);
    expect(sent(k, goAndDoCommand({ spot: 'ascent_foot', activity: 'rest_foot' }))).toBe(true);
    expect(worldOf(k).activity).toBe('rest_foot');
    expect(worldOf(k).recovering).toBe(true);
    // The pace of the recovery, not of the pick.
    expect(paceOf(k)).toMatchObject({ halted: false, resting: true, hpMult: 15, healKind: 'rest' });
  });

  it('an unknown activity', () => {
    const k = gameAt(85, 'ironyard_gate');
    discover(k, 'long_gallery');
    expect(refusal(k, selectActivity({ activity: 'nope' }))).toContain('nope');
    expect(refusal(k, goAndDoCommand({ spot: 'long_gallery', activity: 'nope' }))).toContain('nope');
    expect(refusal(k, goAndDoCommand({ spot: 'ironyard_gate', activity: 'nope' }))).toContain('nope');
    expect(worldOf(k).travel).toBeNull();
    expect(worldOf(k).activity).toBeNull();

    // No journey: no intent to set, no plan to cancel.
    expect(refusal(k, setIntent({ activity: 'train_dex_gallery' }))).toBe('no journey is under way');
    expect(refusal(k, cancelPlan())).toBe('no further leg is planned');

    expect(sent(k, travelTo({ to: 'long_gallery' }))).toBe(true);
    expect(refusal(k, setIntent({ activity: 'nope' }))).toContain('nope');
    expect(worldOf(k).travelIntent).toBeNull();
  });

  it('a spent search', () => {
    const k = gameAt(86, 'tw_cache');
    const act = POCKET.tw_cache.activities[0];
    expect(searchSpent(reads(k), 'tw_cache', act)).toBe(false);
    expect(sent(k, selectActivity({ activity: 'search' }))).toBe(true);
    // The first cycle pays the one reward. The second finds nothing and stops.
    for (let i = 0; i < 200 && worldOf(k).activity; i++) k.tick();
    expect(worldOf(k).activity).toBeNull();
    expect(slice<GoldState>(k, 'gold').gold).toBe(2);
    expect(counterOf(k, 'flag:search:tw_cache:search')).toBe(2);
    expect(counterOf(k, 'flag:search:tw_cache:search:only')).toBe(1);
    // The resume entry stays.
    expect(worldOf(k).resumeActivity.tw_cache).toBe('search');

    expect(searchSpent(reads(k), 'tw_cache', act)).toBe(true);
    expect(canStartActivity(reads(k), 'tw_cache', 'search')).toBe(false);
    expect(refusal(k, selectActivity({ activity: 'search' }))).toContain('nothing left to pay');
    expect(refusal(k, goAndDoCommand({ spot: 'tw_cache', activity: 'search' }))).toContain('nothing left to pay');
    expect(worldOf(k).activity).toBeNull();
  });

  it('the caravan: not a waypoint, not discovered, and the fee', () => {
    const foot = gameAt(87, 'ascent_foot');
    discover(foot, 'ironyard_gate');
    // The Foot is a waypoint; the gate is not.
    expect(refusal(foot, fastTravel({ to: 'ironyard_gate' })).length).toBeGreaterThan(0);
    expect(worldOf(foot).spot).toBe('ascent_foot');

    const k = gameAt(87, 'tw_post_a');
    const goldOf = () => slice<GoldState>(k, 'gold').gold;
    const setGold = (gold: number) =>
      patch(k, (slices) => {
        (slices.gold as GoldState).gold = gold;
      });
    setGold(5000);
    // Not discovered: the caravan does not go there.
    expect(refusal(k, fastTravel({ to: 'tw_post_b' })).length).toBeGreaterThan(0);
    discover(k, 'tw_mid', 'tw_post_b');
    expect(refusal(k, fastTravel({ to: 'tw_mid' })).length).toBeGreaterThan(0);
    expect(goldOf()).toBe(5000);

    // The fee: twice the base ticks of the route, 100 at least. (60 + 70) * 2 = 260.
    setGold(259);
    expect(refusal(k, fastTravel({ to: 'tw_post_b' }))).toContain('260');
    expect(goldOf()).toBe(259);
    expect(worldOf(k).spot).toBe('tw_post_a');
  });
});

describe('the caravan (old `fastTravelTo`)', () => {
  it('moves at once for the fee and settles the arrival', () => {
    const k = gameAt(88, 'tw_post_a');
    discover(k, 'tw_mid', 'tw_post_b');
    patch(k, (slices) => {
      (slices.gold as GoldState).gold = 300;
    });
    patchWorld(k, (w) => {
      w.resumeActivity.tw_post_b = 'drill';
    });
    expect(sent(k, selectActivity({ activity: 'rest' }))).toBe(true);
    const tick = k.snapshot().kernel.tick;
    expect(sent(k, fastTravel({ to: 'tw_post_b' }))).toBe(true);
    expect(k.snapshot().kernel.tick).toBe(tick);
    expect(worldOf(k).spot).toBe('tw_post_b');
    expect(worldOf(k).travel).toBeNull();
    expect(slice<GoldState>(k, 'gold').gold).toBe(40);
    // What was last done at the post resumes, and the pace follows it.
    expect(worldOf(k).activity).toBe('drill');
    expect(paceOf(k)).toMatchObject({ halted: false, resting: false, hpMult: 2 });
    // A paid fee is not gold earned.
    expect(counterOf(k, 'gold:earned')).toBe(0);
  });
});

// ---- (g) the cache ----

describe('derived values', () => {
  it('kernel.staleStats() is empty after a long mixed run', () => {
    const k = walker(91, 'ascent_foot');
    const stale = () => expect(k.staleStats()).toEqual([]);
    // One step into Threshold maps the city.
    expect(sent(k, travelTo({ to: 'granary_gate' }))).toBe(true);
    walkUntilStill(k);
    expect(worldOf(k).discovered).toContain('the_weighbridge');
    expect(sent(k, goAndDoCommand({ spot: 'the_weighbridge', activity: 'job_hauling' }))).toBe(true);
    k.tick(800);
    stale();
    expect(worldOf(k).activity).toBe('job_hauling');
    expect(sent(k, goAndDoCommand({ spot: 'the_sand', activity: 'train_dex_sand' }))).toBe(true);
    k.tick(600);
    stale();
    expect(sent(k, selectActivity({ activity: 'hunt' }))).toBe(true);
    k.tick(800);
    stale();
    expect(sent(k, goAndDoCommand({ spot: 'the_undercrofts', activity: 'explore_undercrofts' }))).toBe(true);
    k.tick(700);
    stale();
    expect(sent(k, goAndDoCommand({ spot: 'ascent_foot', activity: 'rest_foot' }))).toBe(true);
    k.tick(200);
    stale();
    expect(sent(k, climb({ floor: 'ascent_f1' }))).toBe(true);
    k.tick(100);
    expect(worldOf(k).spot).toBe('f1_landing');
    expect(sent(k, goAndDoCommand({ spot: 'f1_storerooms', activity: 'hunt' }))).toBe(true);
    k.tick(1500);
    stale();
    expect(counterOf(k, 'kills')).toBeGreaterThan(0);
    expect(counterOf(k, 'gold:earned')).toBeGreaterThan(0);
  });
});
