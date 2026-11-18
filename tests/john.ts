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
 * Differences from the old driver, each from a port not done yet:
 * - A rack pick plays the floor 0 tutorial without the spell step (arcane,
 *   step 3). The stance step is played as the old John did.
 * - Runs 2 and 3 (floors 7 to 20) are step 4. `through` stops at 6; the
 *   climb ends with the first prestige.
 *
 * He reports; he never tunes. Deterministic: everything rides the kernel's
 * seeded generator.
 */
import { TPS, type Command, type Ctx, type Kernel } from '../src/kernel';
import combat, { type CombatState } from '../src/systems/combat';
import counters, { counterValue } from '../src/systems/counters';
import gold from '../src/systems/gold';
import { FLOORS, type FloorDef } from '../src/systems/ladder';
import levels from '../src/systems/levels';
import prestige, { buyBoon, leaveReview, prestigeNow } from '../src/systems/prestige';
import resources from '../src/systems/resources';
import { statOf } from '../src/systems/stats';
import { learnFromTeacher, lessonsOf } from '../src/systems/martial';
import { chooseStance, chooseWeapon, skipTutorial } from '../src/systems/tutorial';
import world, { climb, selectActivity, SPOTS, travelTo, type WorldState } from '../src/systems/world';
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
] as const;
export type ClimbSegment = (typeof SEGMENTS)[number];

/** Where a try at a floor's boss starts. */
const BOSSES: Partial<Record<ClimbSegment, string[]>> = {
  floor1: ['f1_toll_hall'],
  floor3: ['f3_hearing_room'],
  floor4: ['f4_ravine_floor'],
  floor5: ['f5_back_door'],
  floor6: ['f6_great_hall'],
};

export interface ClimbOptions {
  seed: number;
  /** A rack pick, or 'skip' for Skip tutorial (rusty sword in the pack, no stance, no spell). */
  weapon: string;
  attentive?: boolean;
  /** Give up after this many ticks of play. Default two hours. */
  budget?: number;
  /** The last floor: 3 (band 1, the default) to 6 (band 2). */
  through?: number;
  /** After floor 6, take the first prestige. Default true when `through` is 6. */
  prestige?: boolean;
  /** Called after every tick; the climb ends when it answers true. For tools that need a state mid-climb. */
  stopWhen?: (k: Kernel) => boolean;
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
  /** Ticks for one prestige command, none: kept for the table. */
  kernel: Kernel;
}

function gateValue(floor: FloorDef, key: string): number {
  const c = floor.gate?.find((x) => x.type === 'stat' && x.key === key);
  return c && c.type === 'stat' ? c.value : 0;
}

export function runJohn(options: ClimbOptions): ClimbReport {
  const through = options.through ?? 3;
  const opts: Required<ClimbOptions> = {
    attentive: false,
    budget: 2 * 3600 * TPS,
    prestige: through >= 6,
    stopWhen: () => false,
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
    kernel: k,
  };

  let t = 0;
  let segment: ClimbSegment = 'tutorial';
  let knockouts = 0;
  let inFight = false;
  let fightBoss: ClimbSegment | null = null;
  let stopped = false;

  const tick = () => {
    const before = inFight;
    const wasDown = W().recovering;
    k.tick();
    t++;
    const down = W().recovering;
    if (!wasDown && down) {
      knockouts++;
      report.knockouts[segment]++;
    }
    const after = !!C().fight;
    inFight = after;
    if (!before && after) {
      const spots = BOSSES[segment];
      fightBoss = spots && spots.includes(W().spot) ? segment : null;
      if (fightBoss) report.bossTries[fightBoss]++;
    } else if (before && !after) {
      report.fights++;
      if (!wasDown && down && fightBoss) report.bossLost[fightBoss]++;
    }
    if (opts.stopWhen(k)) stopped = true;
  };
  const outOfTime = () => stopped || t >= opts.budget;
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
  const mark = (seg: ClimbSegment, next: ClimbSegment) => {
    report.done[seg] = t;
    report.levels[seg] = level();
    report.gold[seg] = purse();
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
    persist('f0_field', 'hunt', () => stat('fights:f0_field') >= (SPOTS.f0_field.fightLimit ?? 1));
    walk('f0_gate');
    walk('ascent_foot');
  }
  if (W().spot !== 'ascent_foot') return finish();
  mark('tutorial', 'vermin');

  // ---- Floor 1: vermin, records, the office key, the route, the collector. ----
  if (!climbTo('ascent_f1')) return finish();
  if (!persist('f1_storerooms', 'hunt', () => stat('fights:f1_storerooms') >= SPOTS.f1_storerooms.fightLimit!)) return finish();
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
  if (stat('boss:f1_toll_hall') < 1) return finish();
  mark('floor1', 'floor2');

  // ---- Floor 2: the Long Hall. The tutor's lessons wait for step 3. ----
  if (!climbTo('ascent_f2')) return finish();
  walk('f2_gym');
  // The tutor's door is the first off the hall; the lessons are free.
  for (const lesson of lessonsOf('hall_tutor')) {
    if (lesson.technique) send(learnFromTeacher({ npc: 'hall_tutor', technique: lesson.technique }));
  }
  for (const stretch of HALL) {
    if (!persist(stretch, 'hunt', () => stat(`fights:${stretch}`) >= SPOTS[stretch].fightLimit!)) return finish();
  }
  // The break room's cupboards, on the way out: most of the floor's coin.
  const breakFinds = SPOTS.f2_break_room.finds?.length ?? 0;
  persist('f2_break_room', 'explore_f2', () => finds('f2_break_room') >= breakFinds);
  mark('floor2', 'gate3');

  // ---- The third floor's gate, the descent and the Hearing Room. ----
  if (!climbTo('ascent_f3')) return finish();
  mark('gate3', 'descent');
  for (const { room, plan, below } of DESCENT) {
    if (!persist(room, 'search_room', () => stat(plan) >= 1)) return finish();
    if (opts.attentive) {
      const all = SPOTS[room].finds?.length ?? 0;
      persist(room, 'search_room', () => finds(room) >= all);
    }
    if (below && SPOTS[below].fightLimit) {
      if (!persist(below, 'hunt', () => stat(`fights:${below}`) >= SPOTS[below].fightLimit!)) return finish();
    }
  }
  mark('descent', 'floor3');
  // The Hearing Room forces its one fight on arrival.
  if (!persist('f3_hearing_room', 'hunt', () => stat('slain:f3_hearing_room:puppet_bureaucrat') >= 1)) return finish();
  mark('floor3', 'floor4');
  if (opts.through < 4) return finish();

  // ---- Band 2: grind where the goblins are until the next gate's kill count is met. ----
  const goblins = () => stat('kills:tag:goblin');
  const GATE5 = gateValue(FLOORS.ascent_f5, 'kills:tag:goblin');
  const GATE6 = gateValue(FLOORS.ascent_f6, 'kills:tag:goblin');
  if (!climbTo('ascent_f4')) return finish();
  if (!scout(['f4_woods_edge', 'f4_deep_woods'])) return finish();
  if (!persist('f4_deep_woods', 'hunt', () => goblins() >= GATE5)) return finish();
  if (!scout(['f4_ravine_rim', 'f4_ravine_floor'])) return finish();
  if (!persist('f4_ravine_floor', 'hunt', () => stat('slain:f4_ravine_floor:goblin_raid_leader') >= 1)) return finish();
  mark('floor4', 'gate5');

  if (!climbTo('ascent_f5')) return finish();
  mark('gate5', 'floor5');
  if (!scout(['f5_bog', 'f5_cave_mouth', 'f5_hollows'])) return finish();
  if (!persist('f5_hollows', 'explore', () => stat('flag:f5_back_door') >= 1)) return finish();
  if (!persist('f5_back_door', 'hunt', () => stat('slain:f5_back_door:hobgoblin_champion') >= 1)) return finish();
  mark('floor5', 'gate6');

  // Floor 6's gate: goblins at the drowned village.
  if (!scout(['f5_cave_mouth', 'f5_bog', 'f5_drowned_village'])) return finish();
  if (!persist('f5_drowned_village', 'hunt', () => goblins() >= GATE6)) return finish();
  if (!climbTo('ascent_f6')) return finish();
  mark('gate6', 'floor6');
  if (!scout(['f6_tunnels'])) return finish();
  if (opts.attentive) {
    for (const room of ['f6_pens', 'f6_kitchens', 'f6_shrine']) {
      const all = SPOTS[room].finds?.length ?? 0;
      if (!persist(room, 'explore', () => finds(room) >= all)) return finish();
    }
  }
  if (!scout(['f6_shrine', 'f6_drop'])) return finish();
  if (!persist('f6_great_hall', 'hunt', () => stat('slain:f6_great_hall:goblin_warchief') >= 1)) return finish();
  mark('floor6', 'floor6');
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
  return report;
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
};

/** The per-floor table of one climb, in the old pacing script's columns. */
export function climbTable(r: ClimbReport): string {
  const head = ['floor', 'cleared at', 'took', 'KO', 'boss tries/lost', 'level', 'gold'];
  let prev = 0;
  const body = SEGMENTS.filter((s) => r.done[s] !== null).map((s) => {
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
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const fmt = (c: string[]) => c.map((x, i) => (i === 0 ? x.padEnd(w[i]) : x.padStart(w[i]))).join('  ');
  return [
    `John ${r.opts.weapon}, seed ${r.opts.seed}: ${clock(r.ticks)} of play, ${r.fights} fights, ${r.goldEarned} gold earned` +
      (r.prestiged ? `, prestiged (harvest ${r.harvest} points)` : ''),
    fmt(head),
    ...body.map(fmt),
  ].join('\n');
}
