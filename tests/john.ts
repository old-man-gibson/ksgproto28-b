/**
 * JOHN: the headless climb driver of the old build (`tests/john.ts` of
 * `D:\ksgproto28` at `7c1267b`), ported to the kernel for floors 0 to 6.
 *
 * John is the most plain build there is: Skip tutorial (the rusty sword stays
 * in the pack, no stance, no spell), no optional system. He walks the floors
 * in order, hunts where a floor says to hunt, searches where it says to
 * search, works a job in Threshold when a gate wants gold, and when he is
 * knocked out he rests at the haven he woke in and walks straight back. He
 * never shops, crafts or takes a quest.
 *
 * Every move is a command (`world/*`, `tutorial/*`, `prestige/*`). Nothing
 * is written into a slice. Reads go through a live system context taken
 * once from the probe (`run`), so a tick costs no snapshot.
 *
 * Floor 2's tutor teaches John Gather and Lunge (`martial/learn-technique`,
 * the old `learnFromTeacher`), since the martial port.
 *
 * A rack pick plays the floor 0 tutorial: the stance as the old John did,
 * and the spell (`tutorial/choose-spell`) at the Field, since the arcane
 * port.
 *
 * Past floor 6 (step 4 port C1): the first prestige buys the Key to the
 * City, run 2 climbs floors 1 to 6 again (`reclimb2`, one segment) and plays
 * band 3's four wards in the order `wards` gives (`floor7` to `floor10`).
 * Every floor past 6 has a cap of game time (`floorCap`); a floor open at
 * the cap is a wall: the report records it in `stuck` and John sends the
 * DEBUG SKIP (`ladder/debug-skip-wall`, not a player action) and measures
 * on, with `skipBefore` marking every later segment.
 *
 * Floor 11 on the first climb (step 4 port C2, `through` 11): the siege.
 * John takes the steward's two repairs (`quests/accept`, `quests/turn-in`),
 * gathers timber in the yard and scrap on the road, smelts four iron ingots
 * at the Forges in Threshold, and holds the wall. The eighth fight won there
 * ends the run: the prestige system's tick prestiges, and John closes the
 * review. The segment records the level and gold the run ended with. Its
 * debug skip is `prestige/debug-hold-wall`.
 *
 * Run 3 (step 4 port C3, `through` 11 to 14): the siege's prestige starts
 * it at the Foot. `reclimb3` climbs floors 1 to 6 again and replays band 3's
 * wards (a ward that was a wall in run 2 is skipped without playing; the
 * replayed wards record nothing of their own). Then the harbor: on floor 11
 * John signs with the side `side` names (`quests/accept` at its berth, by
 * way of the quay) and works the roadstead; on floors 12 and 13 he works the
 * floor's last water (the far water by the strait and the isle; the blockade
 * by the picket line, not the pilot's channel); on floor 14 his side's wing,
 * the approach water as the den and the mission boss as the keeper. He fires
 * what the hold has (nothing: he crafts and buys nothing) and fights what the
 * water sends.
 *
 * Floors 15 and 16 (step 4 ports C4 and C5, `through` 15 and 16): the
 * festival. One attempt runs from the dark room to the end of the royale.
 * John waits out a lockout, rides to floor 15 (the climb is his: the
 * festival's ladder rules are its own) and lets the dark room's four waves
 * come; the room emptied clears floor 15. For floor 16 he climbs from the
 * dark room the moment its door opens (no preparation in the hall, no hub
 * activity), walks the field by the default plan and lets the field's
 * fights come until the champion falls or the attempt is lost.
 *
 * Floor 17 (step 4 port C6, `through` 17): the Malgeri Crossing, the old
 * `desertFloors[17]`. John walks the cave and the east slope to the peak,
 * tries the peak's guardian with the roofed west peak as his den, walks the
 * descent to the hamlet's gates after the guardian's first kill, and tries the
 * regent with the mountain base as his den. With `calmAtMalgeri` the world
 * clock jumps once to the range's next calm as he sets out (the DEBUG command
 * `clock/debug-advance`; the old driver wrote the clock), and his den at the
 * peak is the open east ridge.
 *
 * Differences from the old driver, each from a port not done yet:
 * - Floors 18 to 20 are port C7. `through` stops at 17.
 * - The prestige takes no seed: the old `Game.prestige(seed)` reseeded the
 *   generator; the kernel's generator runs on.
 *
 * He reports; he never tunes. Deterministic: everything rides the kernel's
 * seeded generator.
 */
import { TPS, type Command, type Ctx, type Kernel } from '../src/kernel';
import combat, { type CombatState } from '../src/systems/combat';
import clockSystem, { debugAdvanceClock, TICKS_PER_GAME_MINUTE, totalTicksOf } from '../src/systems/clock';
import counters, { counterValue } from '../src/systems/counters';
import festival, { ARENA, DARK_FLOOR, DARK_ROOM, lockoutLeft, ROYALE_FLOOR } from '../src/systems/festival';
import gold from '../src/systems/gold';
import materials, { heldOf } from '../src/systems/materials';
import { NPCS } from '../src/systems/npcs';
import quests, { acceptedKey, acceptQuest, objectiveProgress, QUESTS, turnInQuest } from '../src/systems/quests';
import { clearMet, debugSkipWall, FLOORS, ladderReader, type FloorDef } from '../src/systems/ladder';
import levels from '../src/systems/levels';
import prestige, {
  buyBoon,
  debugHoldWall,
  leaveReview,
  prestigeNow,
  STRONGHOLD_KEY,
  STRONGHOLD_WALL_KEY,
  STRONGHOLD_WAVE,
} from '../src/systems/prestige';
import resources from '../src/systems/resources';
import { SEA_SIDE_LIST, SEA_SIDES } from '../src/systems/sea';
import { statOf } from '../src/systems/stats';
import { learnFromTeacher, lessonsOf } from '../src/systems/martial';
import { chooseSpell, chooseStance, chooseWeapon, skipTutorial } from '../src/systems/tutorial';
import weather, { isCalmAt, skyKindAt, weatherAt } from '../src/systems/weather';
import world, { climb, selectActivity, skyRegionOf, SPOTS, travelTo, type WorldState } from '../src/systems/world';
import { makeGame, run } from './helpers';

/** Floor 2's corridor, in walking order. */
const HALL = ['f2_hall_1', 'f2_hall_2', 'f2_hall_3', 'f2_hall_4'];

/** Floor 3's stairwell, top down: each side room's plan opens the flight to `below`. */
const DESCENT = [
  { room: 'f3_mail_room', plan: 'flag:f3_stairs_1', below: 'f3_landing_2' },
  { room: 'f3_archive', plan: 'flag:f3_stairs_2', below: 'f3_landing_3' },
  { room: 'f3_annex', plan: 'flag:f3_stairs_3', below: null },
];

/** The office route the clerk's daybook gives. */
const OFFICE_ROUTE = ['f1_scribe', 'f1_auditor', 'f1_break_room', 'f1_scribe', 'f1_toll_hall'];

/** Where John works for coin when a gate asks for more than he has. */
const JOB = { spot: 'the_rolls', via: 'chancery_arch', activity: 'job_copying' };

export const SEGMENTS = [
  'tutorial', 'vermin', 'floor1', 'floor2', 'gate3', 'descent', 'floor3',
  'floor4', 'gate5', 'floor5', 'gate6', 'floor6',
  // Run 2 (`through` 7 and up): floors 1 to 6 again, then band 3's four
  // wards in the order `wards` gives (the ids name floors, not places in
  // the order).
  'reclimb2', 'floor7', 'floor8', 'floor9', 'floor10',
  // Floor 11 on the first climb: the stronghold (`through` 11).
  'siege',
  // Run 3: floors 1 to 10 again, then the harbor (`through` 11 to 14) and
  // the festival's floors 15 and 16.
  'reclimb3', 'floor11', 'floor12', 'floor13', 'floor14', 'floor15', 'floor16',
  // Floor 17, the Malgeri Crossing (`through` 17).
  'floor17',
] as const;
export type ClimbSegment = (typeof SEGMENTS)[number];

/** Where a try at a floor's boss starts. */
const BOSSES: Partial<Record<ClimbSegment, string[]>> = {
  floor1: ['f1_toll_hall'],
  floor3: ['f3_hearing_room'],
  floor4: ['f4_ravine_floor'],
  floor5: ['f5_back_door'],
  floor6: ['f6_great_hall'],
  floor7: ['f7_chiefs_tent', 'f7_burnt_camp'],
  floor8: ['f8_lodge'],
  floor9: ['f9_ossuary'],
  floor10: ['f10_foundry'],
  siege: ['f11_wall'],
  floor14: SEA_SIDE_LIST.map((x) => x.mission.spot),
  floor15: [DARK_ROOM],
  floor16: [ARENA],
  // The peak's guardian (the gate down the west face) and the regent at the hamlet's gates (the clear).
  floor17: ['f17_peak', 'f17_keeper'],
};

/** Floor 17's calm lines (docs/CONTENT.md section 5.8). */
const CALM_TRIO = ['malgeri_ridge_wolf', 'malgeri_cairn_brute', 'malgeri_hollow_seer'];

/**
 * A try at a boss counts only when this foe is in the fight (the wall's
 * eighth fight, its captain; the dark room's last fighter; the royale's
 * champion, not its survivors or its dens).
 */
const BOSS_FOE: Partial<Record<ClimbSegment, string>> = {
  siege: 'ph_siege_captain',
  floor15: 'ph_room_last',
  floor16: 'ph_survivor_champion',
};

/** After a knockout at a keeper, John hunts the den this long before the next try. */
const GRIND = 6 * 60 * TPS;

export interface ClimbOptions {
  seed: number;
  /** A rack pick, or 'skip' for Skip tutorial (rusty sword in the pack, no stance, no spell). */
  weapon: string;
  /** The floor 0 one-word spell: 'fire', 'ice' or 'spark'. Default 'fire'. Unused on 'skip'. */
  spell?: string;
  attentive?: boolean;
  /** Give up after this many ticks of play. Default two hours, 80 past floor 6. */
  budget?: number;
  /**
   * The last floor: 3 (band 1, the default) to 6 (band 2), 7 to 10 (band 3,
   * run 2), 11 to 14 (the siege, which ends run 2, and run 3 to that floor of
   * the harbor), 15 (run 3 to the festival's dark room), 16 (its royale), 17
   * (the Malgeri Crossing).
   */
  through?: number;
  /** Ticks of play one floor past 6 may take before it is a wall. Default four hours. */
  floorCap?: number;
  /** After a wall, take the debug skip and measure on. False ends the climb at the first wall. Default true. */
  skipWalls?: boolean;
  /** The order of band 3's wards, by floor number. Default: ladder order. */
  wards?: number[];
  /** After floor 6, take the first prestige. Default true when `through` is 6. */
  prestige?: boolean;
  /** The harbor side John signs with: merchants, pirates, privateers or navy. Default: the first berth. */
  side?: string;
  /**
   * An arranged climb of floor 17 (old option of the same name): as John sets
   * out for the floor the world clock jumps once to the range's next calm
   * (`clock/debug-advance`, a DEBUG command), and his den between tries at the
   * peak is the open east ridge instead of the roofed west peak, so the calm
   * lines are what he fights. Default false.
   */
  calmAtMalgeri?: boolean;
  /** Called after every tick; the climb ends when it answers true. For tools that need a state mid-climb. */
  stopWhen?: (k: Kernel) => boolean;
  /** Called when a segment closes, before it is recorded: the segment, the tick, the climb's kernel. For tools that need the state at a floor clear (`tests/speedStates.ts`). */
  onRecord?: (seg: ClimbSegment, t: number, k: Kernel) => void;
}

export interface ClimbReport {
  opts: Required<ClimbOptions>;
  /** Tick each segment finished on; null when the budget ran out first. */
  done: Record<ClimbSegment, number | null>;
  knockouts: Record<ClimbSegment, number>;
  /** The first walk into the toll collector's office. */
  firstBoss: { ticks: number; won: boolean } | null;
  bossAttempts: number;
  bossTries: Record<ClimbSegment, number>;
  bossLost: Record<ClimbSegment, number>;
  goldEarned: number;
  ticks: number;
  levels: Record<ClimbSegment, number | null>;
  gold: Record<ClimbSegment, number | null>;
  fights: number;
  /** The first prestige was taken: the run after it stands at the Foot. */
  prestiged: boolean;
  /** Points the first harvest paid. */
  harvest: number | null;
  /** The run each segment closed in: 1; 2 after the first prestige; 3 after the stronghold. */
  runs: Record<ClimbSegment, number | null>;
  /** Floors past 6 that were walls (or the script stopped on), by segment. */
  stuck: Partial<Record<ClimbSegment, StuckRecord>>;
  /** The first segment closed by a debug skip; null while none was. */
  firstSkip: ClimbSegment | null;
  /** Per segment: the first skip before it closed, so a number measured past a wall reads as such. */
  skipBefore: Record<ClimbSegment, ClimbSegment | null>;
  /**
   * Floor 17 only (the old `malgeriCalm` and the fight records the old pacing
   * read): ticks of the floor's play inside a calm spell of the Malgeri Range,
   * and of those the ticks John stood under the open calm sky; fights that
   * ended with the peak's guardian in them, and how many were lost; fights
   * that ended with a calm line in them, and how many were lost.
   */
  malgeri: { inSpell: number; underOpenSky: number; peakFights: number; peakLost: number; calmFights: number; calmLost: number };
  kernel: Kernel;
}

/** What a wall looked like when the cap ran out (floors past 6). */
export interface StuckRecord {
  at: number;
  /** Ticks spent on the floor. */
  spent: number;
  /** Knockouts on the floor. */
  knockouts: number;
  level: number;
  /** True when the cap ran out; false when the script stopped with the floor open. */
  wall: boolean;
  why: string;
}

function gateValue(floor: FloorDef, key: string): number {
  const c = floor.gate?.find((x) => x.type === 'stat' && x.key === key);
  return c && c.type === 'stat' ? c.value : 0;
}

export function runJohn(options: ClimbOptions): ClimbReport {
  const through = options.through ?? 3;
  const opts: Required<ClimbOptions> = {
    attentive: false,
    spell: 'fire',
    budget: (through > 6 ? 80 : 2) * 3600 * TPS,
    prestige: through >= 6,
    floorCap: 4 * 3600 * TPS,
    skipWalls: true,
    wards: [7, 8, 9, 10],
    side: 'merchants',
    calmAtMalgeri: false,
    stopWhen: () => false,
    onRecord: () => {},
    ...options,
    through,
  };
  const k = makeGame({ seed: opts.seed });
  // A live context: its reads follow the state, with no copy.
  const eye = run(k, (ctx) => ctx) as Ctx<unknown>;
  const W = (): WorldState => eye.read(world) as WorldState;
  const C = (): CombatState => eye.read(combat) as CombatState;
  const stat = (key: string) => counterValue(eye.read(counters), key);
  const level = () => eye.read(levels).level;
  const purse = () => eye.read(gold).gold;
  const hp = () => eye.read(resources).values.hp;
  const maxHp = () => statOf(eye, 'maxHp');
  const send = (command: Command) => k.dispatch(command).ok;
  const held = (id: string) => heldOf(eye.read(materials), id);

  const blank = <T>(v: T) => Object.fromEntries(SEGMENTS.map((s) => [s, v])) as Record<ClimbSegment, T>;
  const report: ClimbReport = {
    opts,
    done: blank(null),
    knockouts: blank(0),
    firstBoss: null,
    bossAttempts: 0,
    bossTries: blank(0),
    bossLost: blank(0),
    goldEarned: 0,
    ticks: 0,
    levels: blank(null),
    gold: blank(null),
    fights: 0,
    prestiged: false,
    harvest: null,
    runs: blank(null),
    stuck: {},
    firstSkip: null,
    skipBefore: blank(null),
    malgeri: { inSpell: 0, underOpenSky: 0, peakFights: 0, peakLost: 0, calmFights: 0, calmLost: 0 },
    kernel: k,
  };

  let t = 0;
  /** 1 the first life; the prestige starts run 2. */
  let runNo = 1;
  let segment: ClimbSegment = 'tutorial';
  /** The tick the floor in play began, and the tick its cap ends. */
  let segStart = 0;
  let capEnd = Infinity;
  let knockouts = 0;
  let inFight = false;
  let fightBoss: ClimbSegment | null = null;
  /** Floor 17: the fight in progress has the peak's guardian, a calm line. */
  let fightGuardian = false;
  let fightCalm = false;
  let stopped = false;
  /** Level, gold and run when the stronghold ended the run: the siege segment records these. */
  let ended: { level: number; gold: number; run: number } | null = null;

  const tick = () => {
    const before = inFight;
    const wasDown = W().recovering;
    // The stronghold ends the run unasked on this tick (the prestige tick):
    // what the run ended with is read before it.
    const ending = stat(STRONGHOLD_WALL_KEY) >= STRONGHOLD_WAVE && stat(STRONGHOLD_KEY) < 1;
    if (ending) ended = { level: level(), gold: purse(), run: runNo };
    const count = eye.read(prestige).count;
    k.tick();
    t++;
    if (eye.read(prestige).count > count) {
      // The old John closed the review at once and counted the next run.
      runNo++;
      send(leaveReview());
      inFight = !!C().fight;
      if (opts.stopWhen(k)) stopped = true;
      return;
    }
    const down = W().recovering;
    if (segment === 'floor17') {
      // The old report's `malgeriCalm`: a tick of the floor inside a calm spell, and under the open calm sky.
      const seed = eye.read(weather).seed;
      if (seed !== null && isCalmAt(seed, 'malgeri_range', totalTicksOf(eye.read(clockSystem)))) {
        report.malgeri.inSpell++;
        if (skyKindAt(eye, W().spot) === 'calm') report.malgeri.underOpenSky++;
      }
    }
    if (!wasDown && down) {
      knockouts++;
      report.knockouts[segment]++;
    }
    const after = !!C().fight;
    inFight = after;
    if (!before && after) {
      const spots = BOSSES[segment];
      const foe = BOSS_FOE[segment];
      const foes = C().fight!.enemies.flatMap((e) => (e ? [e.defId] : []));
      const foeHere = !foe || foes.includes(foe);
      fightBoss = spots && spots.includes(W().spot) && foeHere ? segment : null;
      if (fightBoss) report.bossTries[fightBoss]++;
      fightGuardian = segment === 'floor17' && foes.includes('malgeri_guardian');
      fightCalm = segment === 'floor17' && foes.some((id) => CALM_TRIO.includes(id));
    } else if (before && !after) {
      report.fights++;
      const lost = !wasDown && down;
      if (lost && fightBoss) report.bossLost[fightBoss]++;
      // The old pacing's floor 17 line read the fights that ended: the peak's tries and the calm lines.
      if (fightBoss === 'floor17' && fightGuardian) {
        report.malgeri.peakFights++;
        if (lost) report.malgeri.peakLost++;
      }
      if (fightCalm) {
        report.malgeri.calmFights++;
        if (lost) report.malgeri.calmLost++;
      }
    }
    if (opts.stopWhen(k)) stopped = true;
  };
  const outOfTime = () => stopped || t >= opts.budget || t >= capEnd;
  const until = (done: () => boolean, max = opts.budget) => {
    for (let i = 0; !done() && i < max && !outOfTime(); i++) tick();
    return done();
  };
  const walk = (spot: string) => {
    // A forced arrival starts a fight that cannot be fled and cuts a route
    // short: fight it out, then set out again.
    for (let leg = 0; leg < 8 && W().spot !== spot && !outOfTime(); leg++) {
      if (C().fight?.forced) until(() => !C().fight, 5 * 60 * TPS);
      if (!send(travelTo({ to: spot }))) return false;
      until(() => !W().travel && W().travelPlan.length === 0, 10 * 60 * TPS);
    }
    return W().spot === spot;
  };
  /** Rest to full wherever John stands, if the spot offers a bed. */
  const restUp = () => {
    const bed = SPOTS[W().spot]?.activities.find((a) => a.kind === 'rest');
    if (!bed) return;
    send(selectActivity({ activity: bed.id }));
    until(() => !W().recovering && hp() >= maxHp() * 0.98, 10 * 60 * TPS);
  };
  /** Do `activity` at `spot` until `goal`, coming back after every knockout, rested first. */
  const persist = (spot: string, activity: string | null, goal: () => boolean) => {
    while (!goal() && !outOfTime()) {
      if (W().spot !== spot) {
        restUp();
        if (!walk(spot)) return false;
      }
      if (activity) send(selectActivity({ activity }));
      const k0 = knockouts;
      const t0 = t;
      until(() => goal() || knockouts > k0 || W().spot !== spot || (!!activity && t > t0 && !W().activity));
    }
    return goal();
  };
  const earned = () => stat('gold:earned');
  const hasKeyItem = (id: string) => stat(`flag:key_item:${id}`) >= 1;
  const finds = (spot: string) => (W().finds[spot] ?? []).length;
  /** Climb to a floor, working the job in Threshold first if its gate wants gold. */
  const climbTo = (floorId: string) => {
    if (!send(climb({ floor: floorId }))) {
      send(climb({ floor: null }));
      until(() => !W().travel, 60 * TPS);
      walk(JOB.via);
      persist(JOB.spot, JOB.activity, () => earned() >= gateValue(FLOORS[floorId], 'gold:earned'));
      walk('ascent_foot');
      if (!send(climb({ floor: floorId }))) return false;
    }
    until(() => !W().travel, 60 * TPS);
    return W().spot === FLOORS[floorId].landing;
  };
  /** Close a segment. */
  const record = (seg: ClimbSegment) => {
    opts.onRecord(seg, t, k);
    const at = seg === 'siege' && ended ? ended : { level: level(), gold: purse(), run: runNo };
    report.done[seg] = t;
    report.levels[seg] = at.level;
    report.gold[seg] = at.gold;
    report.runs[seg] = at.run;
    report.skipBefore[seg] = report.firstSkip;
  };
  const mark = (seg: ClimbSegment, next: ClimbSegment) => {
    // A replay (run 2 climbs floors 1 to 6 again) reports as one segment.
    if (runNo > 1) return;
    record(seg);
    segment = next;
  };
  // A floor starts fogged: the planner knows only rooms John has stood next to.
  const scout = (route: string[]) => route.every((spot) => walk(spot));

  const finish = (): ClimbReport => {
    report.goldEarned = earned();
    report.ticks = t;
    return report;
  };

  // ---- Floor 0: skipped outright, or the rack pick and the floor walked. ----
  if (opts.weapon === 'skip') {
    send(skipTutorial());
  } else {
    send(chooseWeapon({ weapon: opts.weapon, shield: false }));
    // The old John asked for 'neutral', which is no style id: it folds to
    // `balanced`, already held, and only the step is stamped.
    send(chooseStance({ style: 'neutral' }));
    walk('f0_cellblock');
    persist('f0_cellblock', 'hunt', () => stat('fights:f0_cellblock') >= (SPOTS.f0_cellblock.fightLimit ?? 1));
    walk('f0_field');
    send(chooseSpell({ word: opts.spell }));
    persist('f0_field', 'hunt', () => stat('fights:f0_field') >= (SPOTS.f0_field.fightLimit ?? 1));
    walk('f0_gate');
    walk('ascent_foot');
  }
  if (W().spot !== 'ascent_foot') return finish();
  mark('tutorial', 'vermin');

  /**
   * Floors 1 to 6, from the Foot. False when John ran out of time or the
   * climb is over (`through` reached on the first life). Runs again,
   * unmarked, after the prestige: the reset puts every floor back.
   */
  function lowerBands(): boolean {
    // ---- Floor 1: vermin, records, the office key, the route, the collector. ----
    if (!climbTo('ascent_f1')) return false;
    if (!persist('f1_storerooms', 'hunt', () => stat('fights:f1_storerooms') >= SPOTS.f1_storerooms.fightLimit!)) return false;
    mark('vermin', 'floor1');
    walk('f1_bonded_deep');
    persist('f1_archive', 'search', () => hasKeyItem('toll_clerk_book'));
    walk('f1_bonded_deep');
    walk('f1_forms');
    persist('f1_reception', 'explore_reception', () => hasKeyItem('toll_office_key'));
    for (let tries = 0; stat('boss:f1_toll_hall') < 1 && !outOfTime() && tries < 20; tries++) {
      // The office door is a fight that cannot be fled; John heals before it.
      walk('f1_landing');
      restUp();
      walk('f1_reception');
      for (const room of OFFICE_ROUTE) walk(room);
      report.bossAttempts++;
      const t0 = t;
      until(() => !C().fight);
      report.firstBoss ??= { ticks: t - t0, won: stat('boss:f1_toll_hall') >= 1 };
    }
    if (stat('boss:f1_toll_hall') < 1) return false;
    mark('floor1', 'floor2');

    // ---- Floor 2: the Long Hall. The tutor's lessons wait for step 3. ----
    if (!climbTo('ascent_f2')) return false;
    walk('f2_gym');
    // The tutor's door is the first off the hall; the lessons are free.
    for (const lesson of lessonsOf('hall_tutor')) {
      if (lesson.technique) send(learnFromTeacher({ npc: 'hall_tutor', technique: lesson.technique }));
    }
    for (const stretch of HALL) {
      if (!persist(stretch, 'hunt', () => stat(`fights:${stretch}`) >= SPOTS[stretch].fightLimit!)) return false;
    }
    // The break room's cupboards, on the way out: most of the floor's coin.
    const breakFinds = SPOTS.f2_break_room.finds?.length ?? 0;
    persist('f2_break_room', 'explore_f2', () => finds('f2_break_room') >= breakFinds);
    mark('floor2', 'gate3');

    // ---- The third floor's gate, the descent and the Hearing Room. ----
    if (!climbTo('ascent_f3')) return false;
    mark('gate3', 'descent');
    for (const { room, plan, below } of DESCENT) {
      if (!persist(room, 'search_room', () => stat(plan) >= 1)) return false;
      if (opts.attentive) {
        const all = SPOTS[room].finds?.length ?? 0;
        persist(room, 'search_room', () => finds(room) >= all);
      }
      if (below && SPOTS[below].fightLimit) {
        if (!persist(below, 'hunt', () => stat(`fights:${below}`) >= SPOTS[below].fightLimit!)) return false;
      }
    }
    mark('descent', 'floor3');
    // The Hearing Room forces its one fight on arrival.
    if (!persist('f3_hearing_room', 'hunt', () => stat('slain:f3_hearing_room:puppet_bureaucrat') >= 1)) return false;
    mark('floor3', 'floor4');
    if (runNo === 1 && opts.through < 4) return false;

    // ---- Band 2: grind where the goblins are until the next gate's kill count is met. ----
    const goblins = () => stat('kills:tag:goblin');
    const GATE5 = gateValue(FLOORS.ascent_f5, 'kills:tag:goblin');
    const GATE6 = gateValue(FLOORS.ascent_f6, 'kills:tag:goblin');
    if (!climbTo('ascent_f4')) return false;
    if (!scout(['f4_woods_edge', 'f4_deep_woods'])) return false;
    if (!persist('f4_deep_woods', 'hunt', () => goblins() >= GATE5)) return false;
    if (!scout(['f4_ravine_rim', 'f4_ravine_floor'])) return false;
    if (!persist('f4_ravine_floor', 'hunt', () => stat('slain:f4_ravine_floor:goblin_raid_leader') >= 1)) return false;
    mark('floor4', 'gate5');

    if (!climbTo('ascent_f5')) return false;
    mark('gate5', 'floor5');
    if (!scout(['f5_bog', 'f5_cave_mouth', 'f5_hollows'])) return false;
    if (!persist('f5_hollows', 'explore', () => stat('flag:f5_back_door') >= 1)) return false;
    if (!persist('f5_back_door', 'hunt', () => stat('slain:f5_back_door:hobgoblin_champion') >= 1)) return false;
    mark('floor5', 'gate6');

    // Floor 6's gate: goblins at the drowned village.
    if (!scout(['f5_cave_mouth', 'f5_bog', 'f5_drowned_village'])) return false;
    if (!persist('f5_drowned_village', 'hunt', () => goblins() >= GATE6)) return false;
    if (!climbTo('ascent_f6')) return false;
    mark('gate6', 'floor6');
    if (!scout(['f6_tunnels'])) return false;
    if (opts.attentive) {
      for (const room of ['f6_pens', 'f6_kitchens', 'f6_shrine']) {
        const all = SPOTS[room].finds?.length ?? 0;
        if (!persist(room, 'explore', () => finds(room) >= all)) return false;
      }
    }
    if (!scout(['f6_shrine', 'f6_drop'])) return false;
    if (!persist('f6_great_hall', 'hunt', () => stat('slain:f6_great_hall:goblin_warchief') >= 1)) return false;
    mark('floor6', 'floor6');
    return true;
  }

  if (!lowerBands()) return finish();
  finish();

  // ---- The first prestige: the warchief opened it. ----
  if (opts.prestige && !stopped) {
    until(() => !C().fight, 5 * 60 * TPS);
    if (send(prestigeNow())) {
      report.prestiged = true;
      report.harvest = eye.read(prestige).lastHarvest?.total ?? null;
      // The old John bought the Key to the City here, for floor 7.
      send(buyBoon({ boon: 'city_key' }));
      send(leaveReview());
    }
  }
  if (!report.prestiged || opts.through < 7) return report;

  // ---- Run 2: floors 1 to 6 again, one segment. ----
  runNo = 2;
  segment = 'reclimb2';
  segStart = t;
  if (!lowerBands()) return finish();
  record('reclimb2');

  // ---- Floor-level machinery for everything past floor 6. ----

  /**
   * Whether a floor's clear holds now. The reader is made per read: a reader
   * holds the counters slice it was made on, and a new run (the stronghold's
   * prestige) replaces every slice.
   */
  const clears = (floorId: string) => clearMet(ladderReader(eye), FLOORS[floorId]);
  /** Settle what the last floor left: a knockout slept off, a fight that cannot be fled finished. */
  const settle = () => {
    if (C().fight?.forced) until(() => !C().fight, 5 * 60 * TPS);
    if (W().recovering) {
      restUp();
      until(() => !W().recovering, 10 * 60 * TPS);
    }
  };
  /**
   * Run `step` until `goal` holds, the clock runs out, or a pass spends no
   * time at all (a walk that is refused would otherwise spin forever).
   */
  const repeat = (goal: () => boolean, step: () => void) => {
    while (!goal() && !outOfTime()) {
      const t0 = t;
      step();
      if (t === t0) break;
    }
  };
  /**
   * Play one floor of run 2 or 3 inside its cap: climb to it, `work` it, and
   * close the segment when its clear holds. A floor still open at the cap is
   * a wall: record it, send the debug skip and report whether the climb goes
   * on. `replay` is a floor John already played in run 2: no record, and a
   * floor that was a wall then is skipped without playing. `ride: false`
   * leaves the climb to `work` (the festival's ladder rules are its own).
   */
  const attempt = (
    seg: ClimbSegment,
    floorId: string,
    work: () => void,
    o: { goal?: () => boolean; skip?: () => void; prep?: () => void; replay?: boolean; ride?: boolean } = {},
  ): boolean => {
    const goal = o.goal ?? (() => clears(floorId));
    // DEBUG SKIP, not a player action: the floor's gate and clear counters
    // written, its clear XP stamped as paid.
    const skip = o.skip ?? (() => send(debugSkipWall({ floor: floorId })));
    if (o.replay && report.stuck[seg]) {
      skip();
      return true;
    }
    if (!o.replay) segment = seg;
    segStart = t;
    capEnd = t + opts.floorCap;
    const k0 = knockouts;
    const onFloor = () => SPOTS[W().spot]?.areaId === FLOORS[floorId].areaId;
    let entered = true;
    // A pass that ends early (a knockout moved him, a route was refused) is
    // taken up again until the floor opens, the cap runs out, or a pass does
    // nothing. Each pass settles first, does the floor's prep, and climbs if
    // he is not on the floor.
    repeat(goal, () => {
      settle();
      o.prep?.();
      entered = o.ride === false || onFloor() || climbTo(floorId);
      if (entered) work();
    });
    const capped = t >= capEnd;
    capEnd = Infinity;
    if (goal()) {
      if (!o.replay) record(seg);
      return true;
    }
    if (t >= opts.budget || stopped) return false;
    if (o.replay) {
      report.firstSkip ??= seg;
      skip();
      return true;
    }
    const why = capped
      ? `open at the ${Math.round(opts.floorCap / TPS / 60)} min cap` + (entered ? '' : ' (the climb was refused: the floor gate is unmet)')
      : !entered
        ? 'the climb was refused (the floor gate is unmet) and no rule could meet it'
        : 'the script stopped with the floor open (no rule left to try; not a measured wall)';
    report.stuck[seg] = { at: t, spent: t - segStart, knockouts: knockouts - k0, level: level(), wall: capped, why };
    if (!opts.skipWalls) return false;
    // Recorded as the floor stood, before the skip: the stronghold's skip
    // ends the run, and the prestige resets the level and the gold.
    record(seg);
    report.firstSkip ??= seg;
    skip();
    return true;
  };
  /**
   * Work a floor's keeper: walk in, fight, and after every knockout hunt the
   * den for a while before the next try, as a player who lost goes and levels.
   * The first try is made at once, with the level John arrived at.
   */
  const keeperLoop = (den: string, keeper: string, goal: () => boolean) =>
    repeat(goal, () => {
      const k0 = knockouts;
      persist(keeper, 'hunt', () => goal() || knockouts > k0);
      if (goal() || outOfTime()) return;
      restUp();
      const end = t + GRIND;
      persist(den, 'hunt', () => goal() || t >= end);
    });

  // ---- Band 3: the four wards (floors 7 to 10), in the order `wards` gives. ----
  // Each ward is worked as a floor of its own: the fights its form asks for,
  // then the keeper, with the district's patrol as the den. John reads the
  // ward's position (how many other wards are cleared) when he starts and
  // again each time a knockout sends him back.
  const wardWork: Record<number, () => void> = {
    7: () => {
      const done = () => clears('ascent_f7');
      const pos = () => stat('band:pos:ascent_f7');
      repeat(done, () => {
        const at = pos();
        const same = () => done() || pos() !== at;
        if (at === 0) {
          // The merchant road: twelve fights of two to four bandits.
          if (scout(['f7_merchant_road'])) persist('f7_merchant_road', 'hunt', same);
        } else if (at <= 2) {
          // The salt-flats camp: the stockade, the watchtowers, then the chief.
          // Another ward falling changes the form: the pass ends and the next one reads the position again.
          const fought = (spot: string, n: number) => persist(spot, 'hunt', () => same() || stat(`fights:${spot}`) >= n) && !same();
          if (!scout(['f7_stockade']) || !fought('f7_stockade', 4)) return;
          if (!scout(['f7_watchtowers']) || !fought('f7_watchtowers', 3)) return;
          if (scout(['f7_chiefs_tent'])) keeperLoop('f7_docks', 'f7_chiefs_tent', same);
        } else {
          // The demon in the burnt camp. Its window (24 in-game hours) runs
          // out on its own, so this ward cannot stay shut.
          if (scout(['f7_burnt_camp'])) keeperLoop('f7_docks', 'f7_burnt_camp', same);
        }
      });
    },
    8: () => {
      if (scout(['f8_old_forest', 'f8_lodge'])) keeperLoop('f8_old_forest', 'f8_lodge', () => clears('ascent_f8'));
    },
    9: () => {
      if (scout(['f9_barrow_fields', 'f9_ossuary'])) keeperLoop('f9_barrow_fields', 'f9_ossuary', () => clears('ascent_f9'));
    },
    10: () => {
      if (scout(['f10_quarry', 'f10_foundry'])) keeperLoop('f10_quarry', 'f10_foundry', () => clears('ascent_f10'));
    },
  };
  /** `through` 7 to 9 stops after those wards; 10 and up plays all four. */
  const wardsFor = opts.through >= 10 ? opts.wards : opts.wards.filter((n) => n <= opts.through);
  const playWards = (replay: boolean): boolean => {
    for (const n of wardsFor) {
      if (!attempt(`floor${n}` as ClimbSegment, `ascent_f${n}`, wardWork[n], { replay })) return false;
    }
    return true;
  };
  if (!playWards(false)) return finish();
  if (opts.through <= 10) return finish();

  // ---- Floor 11 on the first climb: the stronghold. The steward's two repairs
  // (timber and scrap for the gate; ten raiders and four iron ingots, smelted
  // at the Forges in Threshold, for the wall), then eight fights on the wall.
  // Holding the wave ends the run unasked. ----
  const strongholdHeld = () => eye.read(prestige).stronghold;
  const questState = () => eye.read(quests).quests;
  const siegeWork = () => {
    const toGatehouse = () => scout(['f11_gatehouse']);
    const take = (id: string) => {
      if (toGatehouse()) send(acceptQuest({ quest: id }));
    };
    const handIn = (id: string) => {
      if (toGatehouse()) send(turnInQuest({ quest: id }));
    };
    // The gate: twenty hardwood from the yard, fifteen iron scrap from the raiders on the road.
    take('f11_shore_up_the_gate');
    if (scout(['f11_yard'])) persist('f11_yard', 'gather_f11_timber', () => held('hardwood') >= 20);
    persist('f11_road', 'hunt', () => held('iron_scrap') >= 15);
    handIn('f11_shore_up_the_gate');
    // The wall: ten raiders, and the scrap for four ingots (three each).
    take('f11_arm_the_wall');
    const raiders = () =>
      questState().f11_arm_the_wall ? objectiveProgress(eye, eye.read(quests), QUESTS.f11_arm_the_wall, 0).current : 0;
    persist('f11_road', 'hunt', () => raiders() >= 10 && held('iron_scrap') + 3 * held('iron_ingot') >= 12);
    if (raiders() < 10) return;
    // The ingots are smelted at the Forges, down in Threshold.
    send(climb({ floor: null }));
    until(() => !W().travel, 60 * TPS);
    if (!walk('the_forges')) return;
    persist('the_forges', 'craft_iron_ingot', () => held('iron_ingot') >= 4);
    if (!climbTo('ascent_f11')) return;
    handIn('f11_arm_the_wall');
    if (questState().f11_arm_the_wall?.status !== 'done') return;
    if (scout(['f11_yard', 'f11_wall'])) persist('f11_wall', 'hunt', strongholdHeld);
  };
  // DEBUG SKIP: the wall's fight count written; the next tick ends the run.
  const siegeSkip = () => {
    send(debugHoldWall());
    tick();
  };
  if (!attempt('siege', 'ascent_f11', siegeWork, { goal: strongholdHeld, skip: siegeSkip })) return finish();
  if (runNo !== 3) return finish();

  // ---- Run 3: floors 1 to 10 again. A ward that was a wall in run 2 is skipped. ----
  segment = 'reclimb3';
  segStart = t;
  if (!lowerBands()) return finish();
  if (!playWards(true)) return finish();
  record('reclimb3');

  // ---- The harbor (floors 11 to 14). ----
  const side = SEA_SIDES[opts.side];
  if (!side) throw new Error(`no harbor side "${opts.side}"`);
  /** Sign with the side: accepting its join quest at its berth is the pick. */
  const sign = () => {
    if (stat(acceptedKey(side.joinQuest)) >= 1) return;
    if (scout(['f11_quay', NPCS[side.giver].spotId])) send(acceptQuest({ quest: side.joinQuest }));
  };
  /**
   * Floors 11 to 13 clear on crates won (any water, cumulative over the run)
   * and a fight won on the floor's last water, so John works that water: the
   * convoy sails past it and he is present. He fights what the water sends.
   */
  const water = (floorId: string, spot: string, route: string[]) => () => {
    if (scout(route)) persist(spot, 'hunt', () => clears(floorId));
  };
  const harbor: Record<number, () => void> = {
    11: () => {
      sign();
      water('ascent_f11', 'f11_roadstead', ['f11_quay', 'f11_roadstead'])();
    },
    12: water('ascent_f12', 'f12_far_water', ['f12_strait', 'f12_isle', 'f12_far_water']),
    // Through the picket line: the pilot's channel costs a purchase.
    13: water('ascent_f13', 'f13_blockade', ['f13_picket', 'f13_blockade']),
    // The side's wing: the approach is the den, the mission boss the keeper.
    14: () => {
      const boss = side.mission.spot;
      const approach = Object.values(SPOTS).find((x) => x.areaId === FLOORS.ascent_f14.areaId && x.connections.some((c) => c.to === boss))!;
      if (scout([approach.id, boss])) keeperLoop(approach.id, boss, () => clears('ascent_f14'));
    },
  };
  for (let n = 11; n <= 14 && n <= opts.through; n++) {
    if (!attempt(`floor${n}` as ClimbSegment, `ascent_f${n}`, harbor[n])) return finish();
  }
  if (opts.through <= 14) return finish();

  // ---- The festival (floors 15 and 16). One attempt runs from the dark room
  // to the end of the royale; a lost one shuts both floors for three world
  // days. John's rules: no preparation in the hall (he rides up to the
  // royale the day the door opens), the default strategy plan, no hub
  // activity. The old `attemptFestival(upTo)`. ----
  const festivalRun = () => eye.read(festival).run;
  const lockLeft = () => lockoutLeft(eye.read(festival), totalTicksOf(eye.read(clockSystem)));
  const attemptFestival = (upTo: 15 | 16) => {
    // An open door (the dark room won, the hall reached) is the way up to the royale.
    if (!(upTo === 16 && festivalRun()?.phase === 'prep')) {
      if (lockLeft() > 0) {
        settle();
        until(() => lockLeft() === 0);
      }
      if (!send(climb({ floor: DARK_FLOOR }))) return;
      until(() => !W().travel, 60 * TPS);
      until(() => !festivalRun() || festivalRun()!.phase !== 'dark');
    }
    if (upTo === 15 || !festivalRun()) return;
    if (!send(climb({ floor: ROYALE_FLOOR }))) return;
    until(() => !W().travel, 60 * TPS);
    until(() => !festivalRun());
  };
  for (const n of [15, 16] as const) {
    if (n > opts.through) return finish();
    const floorId = n === 15 ? DARK_FLOOR : ROYALE_FLOOR;
    const work = () => repeat(() => clears(floorId), () => attemptFestival(n));
    if (!attempt(`floor${n}`, floorId, work, { ride: false })) return finish();
  }
  if (opts.through <= 16) return finish();

  // ---- Floor 17, the Malgeri Crossing: four maps in order. The cave and the
  // east slope are walked through, not worked: the nest is optional and John
  // skips it. The peak's guardian opens the west face; the regent at the
  // hamlet's gates is the clear. The camps on the way are the dens (roofed,
  // so the sky does not reach him there); with `calmAtMalgeri` the peak's den
  // is the open east ridge, under a calm. The old `desertFloors[17]`. ----
  /** `calmAtMalgeri`: the clock has been jumped to the calm (once per climb). */
  let calmArranged = false;
  const floor17 = {
    prep: () => {
      if (!opts.calmAtMalgeri || calmArranged) return;
      calmArranged = true;
      // DEBUG jump: to the first minute of the next calm spell over the east
      // ridge (at most one 12-day window away), as the old John wrote the clock.
      const seed = eye.read(weather).seed;
      if (seed === null) return;
      const now = totalTicksOf(eye.read(clockSystem));
      let minutes = 0;
      for (; minutes < 12 * 24 * 60 && kindOverRidge(seed, now + minutes * TICKS_PER_GAME_MINUTE) !== 'calm'; minutes++);
      if (minutes > 0) send(debugAdvanceClock({ ticks: minutes * TICKS_PER_GAME_MINUTE }));
    },
    work: () => {
      const peakDown = () => stat('boss:f17_peak') >= 1;
      if (!peakDown()) {
        const route = ['f17_cave_hub', 'f17_central_caves', 'f17_east_mouth', 'f17_east_ascent', 'f17_east_peak', 'f17_east_ridge', 'f17_west_ridge', 'f17_west_peak', 'f17_peak'];
        if (!scout(route)) return;
        keeperLoop(opts.calmAtMalgeri ? 'f17_east_ridge' : 'f17_west_peak', 'f17_peak', peakDown);
      }
      if (!peakDown()) return;
      if (scout(['f17_base', 'f17_path', 'f17_old_path', 'f17_hamlet_square', 'f17_keeper'])) {
        keeperLoop('f17_base', 'f17_keeper', () => clears('ascent_f17'));
      }
    },
  };
  if (!attempt('floor17', 'ascent_f17', floor17.work, { prep: floor17.prep })) return finish();
  return finish();
}

/** The sky over the open east ridge of floor 17 at a clock tick: the old `skyKindAt(s, 'f17_east_ridge')`. */
function kindOverRidge(seed: number, totalTicks: number): string | null {
  return weatherAt(seed, skyRegionOf('f17_east_ridge')!, totalTicks)?.kind ?? null;
}

/** Seconds, for reading. */
export const secs = (ticks: number | null): number | null => (ticks === null ? null : Math.round(ticks / TPS));

/** Game time as h:mm:ss. */
export const clock = (ticks: number | null): string => {
  if (ticks === null) return '-';
  const sec = Math.round(ticks / TPS);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(sec / 3600)}:${two(Math.floor(sec / 60) % 60)}:${two(sec % 60)}`;
};

/** The floor each segment is, for the first column of the table (old `scripts/pacing.ts`). */
export const FLOOR_OF: Record<ClimbSegment, string> = {
  tutorial: 'f0', vermin: 'f1 vermin', floor1: 'f1', floor2: 'f2', gate3: 'f3 gate', descent: 'f3 stairs', floor3: 'f3',
  floor4: 'f4', gate5: 'f5 gate', floor5: 'f5', gate6: 'f6 gate', floor6: 'f6',
  reclimb2: 'f1-6 again', floor7: 'f7', floor8: 'f8', floor9: 'f9', floor10: 'f10',
  siege: 'f11 siege',
  reclimb3: 'f1-10 again', floor11: 'f11', floor12: 'f12', floor13: 'f13', floor14: 'f14',
  floor15: 'f15',
  floor16: 'f16',
  floor17: 'f17',
};

/** The per-floor table of one climb, in the old pacing script's columns. */
export function climbTable(r: ClimbReport): string {
  const head = ['floor', 'cleared at', 'took', 'KO', 'boss tries/lost', 'level', 'gold'];
  let prev = 0;
  // In play order: band 3's wards close in the order `wards` gave.
  const shown = SEGMENTS.filter((s) => r.done[s] !== null).sort((a, b) => r.done[a]! - r.done[b]!);
  const body = shown.map((s) => {
    const row = [
      FLOOR_OF[s],
      clock(r.done[s]),
      clock(r.done[s]! - prev),
      String(r.knockouts[s]),
      r.bossTries[s] ? `${r.bossTries[s]}/${r.bossLost[s]}` : '-',
      String(r.levels[s] ?? '-'),
      String(r.gold[s] ?? '-'),
    ];
    prev = r.done[s]!;
    return row;
  });
  const walls = SEGMENTS.filter((s) => r.stuck[s]).map((s) => {
    const st = r.stuck[s]!;
    return `${FLOOR_OF[s]}: ${st.why}; ${clock(st.spent)} on the floor, ${st.knockouts} KO, level ${st.level}; debug skip`;
  });
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const fmt = (c: string[]) => c.map((x, i) => (i === 0 ? x.padEnd(w[i]) : x.padStart(w[i]))).join('  ');
  return [
    `John ${r.opts.weapon}, seed ${r.opts.seed}: ${clock(r.ticks)} of play, ${r.fights} fights, ${r.goldEarned} gold earned` +
      (r.prestiged ? `, prestiged (harvest ${r.harvest} points)` : ''),
    fmt(head),
    ...body.map((row, i) => fmt(row) + (r.skipBefore[shown[i]] ? '  (measured after skip)' : '')),
    ...walls,
  ].join('\n');
}
