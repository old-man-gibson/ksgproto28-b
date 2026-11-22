/**
 * The harbor band's rules with no state of their own: the schedule, a leg's
 * roll, the four formulas, the battery, the port price, and the cargo of a
 * convoy as the counters hold it. Port of the pure half of old
 * `systems/sea.ts` and of the constants of `data/sea.data.ts`.
 *
 * Every function here is a function of its arguments. The system
 * (`index.ts`) reads the slices and calls these.
 */
import type { DeepReadonly } from '../../kernel';
import type { CountersState } from '../counters';
import { heldOf, type MaterialsState } from '../materials';

// ---- types ----

/**
 * Which end of the convoy's flow a side stands on. Each value is one formula
 * in `resolveLeg`:
 *
 * - `convoy` (merchants): crates lost = clamp(raiders + monsters - kills - battery, 0, crates); the rest are sold at port.
 * - `escort` (navy): crates lost = clamp(monsters - kills - battery, 0, crates); the rest are kept.
 * - `raid` (pirates): crates seized = clamp(battery - (guard - kills), 0, crates).
 * - `recover` (privateers): crates recovered = clamp(battery - (raiders - kills), 0, carried), from the pirate ships' prize.
 */
export type SeaFlow = 'convoy' | 'escort' | 'raid' | 'recover';

export const SEA_FLOWS: readonly SeaFlow[] = ['convoy', 'escort', 'raid', 'recover'];

export interface SeaSideDef {
  id: string;
  name: string;
  icon: string;
  /** The recruiter at a floor 11 berth who gives `joinQuest`. */
  giver: string;
  /**
   * Accepting it picks the side for the run: its accept stamp
   * (`flag:quest:<id>:accepted`) is the side record. Every join quest
   * requires the other sides' stamps at 0, so one side per run.
   */
  joinQuest: string;
  flow: SeaFlow;
  /** Monsters whose kills on a water count against the leg. */
  prey: string[];
  /** Floor 14's wing: killing `monsterId` at `spot` stamps `SEA_MISSION_DONE`. */
  mission: { spot: string; monsterId: string };
  desc: string;
}

/**
 * One water's convoy. Every `SEA.convoyTicks` a convoy of `SEA.crates` sails
 * past; each of its `SEA.legs` legs rolls these three numbers (inclusive
 * ranges, a hash of water, convoy and leg), so a preview of the leg in
 * progress is the number the resolver uses.
 */
export interface ConvoyDef {
  /** The water spot. */
  id: string;
  /** Pirate raiders on the lane: the merchants' threat, the privateers' pirate crew. */
  raiders: [number, number];
  /** Sea monsters: threat for merchants and the navy. */
  monsters: [number, number];
  /** The convoy's own guard: what the pirates' raid has to beat. */
  guard: [number, number];
  /** Each crate won pays one material from this row (merchants are paid gold, `SEA_DEAL`). */
  cargo: string[];
}

/** The cargo a convoy carries between legs. */
export interface ConvoyCargo {
  /** Crates still in the convoy's holds. */
  crates: number;
  /** Crates aboard the pirate ships (the privateers' prize). */
  carried: number;
}

/** One leg's roll. */
export interface LegRoll {
  raiders: number;
  monsters: number;
  guard: number;
}

export interface LegOutcome {
  cargo: ConvoyCargo;
  /** Crates this leg moved: lost (convoy, escort), seized (raid) or recovered (recover). */
  moved: number;
  /** Crates credited to the player by this leg itself: raid and recover only. */
  credited: number;
}

/** Where the schedule stands at a tick. `leg` is null while the convoy is in port. */
export interface SeaClock {
  convoy: number;
  /** Ticks into the convoy's hour. */
  offset: number;
  leg: number | null;
}

// ---- constants ----

/** The schedule, the battery and offline credit. All integers. */
export const SEA = {
  /** A convoy sails every 3,600 ticks: 6 minutes. */
  convoyTicks: 3600,
  /** Each leg runs 30 seconds; the legs fill the first 1,200 ticks of the hour, then the convoy is in port. */
  legTicks: 300,
  legs: 4,
  crates: 8,
  /** Catching up, one cargo is paid per this many crates credited (25%), and none reach `sea:crates:won`. */
  offlineShare: 4,
  /** The battery: rating = volleys x hit + morale (`batteryOf`). */
  cannon: 'ship_cannon',
  /** Cannons held past this many add nothing. */
  maxCannons: 4,
  /** One spent per leg; loads every fitted cannon. Without it the fitted cannons are dry. */
  shot: 'cannonball',
  /** One spent per leg; +1 hit. */
  powder: 'powder_charge',
  /** One spent per leg, lowest grade first; +1 morale. */
  ration: 'travelers_ration',
} as const;

/**
 * The merchants' port sale: gold per crate sold, set by Speechcraft
 * thresholds, never dice. Each term met adds its gold to `base`.
 */
export const SEA_DEAL = {
  skill: 'speechcraft',
  base: 9,
  terms: [
    { id: 'duty', level: 5, gold: 1 },
    { id: 'buyer', level: 15, gold: 2 },
    { id: 'price', level: 30, gold: 3 },
  ],
} as const;

/** Every crate won while present, across every water. The harbor floors' clears read it. */
export const SEA_CRATES_WON = 'sea:crates:won';
/** Crates credited while catching up. Pays cargo at `SEA.offlineShare`; no clear reads it. */
export const SEA_CRATES_OFFLINE = 'sea:crates:offline';
/** Stamped when the run's side kills its mission boss on floor 14. Floor 14's clear reads it. */
export const SEA_MISSION_DONE = 'flag:sea:14:done';

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

// ---- the schedule ----

export function seaClock(totalTicks: number): SeaClock {
  const convoy = Math.floor(totalTicks / SEA.convoyTicks);
  const offset = totalTicks - convoy * SEA.convoyTicks;
  const leg = offset < SEA.legs * SEA.legTicks ? Math.floor(offset / SEA.legTicks) : null;
  return { convoy, offset, leg };
}

/** The leg that ends on this tick, if one does. The fourth ends as the convoy reaches port. */
export function legEnding(totalTicks: number): { convoy: number; leg: number } | null {
  // Every leg ends on a multiple of `legTicks`, and an hour holds a whole number of legs.
  if (totalTicks % SEA.legTicks !== 0) return null;
  const { convoy, offset } = seaClock(totalTicks);
  if (offset === 0 || offset > SEA.legs * SEA.legTicks) return null;
  return { convoy, leg: offset / SEA.legTicks - 1 };
}

/**
 * The leg a kill made on this tick counts toward: the leg that resolves on
 * this tick if one does (combat runs before the sea's tick, so a killing
 * blow on the last tick of a leg is that leg's), else the leg in progress;
 * null in port. Leg k takes kills at offsets (300k, 300k + 300], leg 0 from
 * offset 0.
 */
export function killLeg(totalTicks: number): { convoy: number; leg: number } | null {
  const ending = legEnding(totalTicks);
  if (ending) return ending;
  const { convoy, leg } = seaClock(totalTicks);
  return leg === null ? null : { convoy, leg };
}

/** FNV-1a with a murmur finaliser: a stable, well-mixed 32-bit hash of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const inRange = ([lo, hi]: readonly [number, number] | readonly number[], seed: number): number => lo + (seed % (hi - lo + 1));

/** A leg's raiders, monsters and guard. Pure: the same water, convoy and leg always roll the same. */
export function legRoll(row: DeepReadonly<ConvoyDef>, convoy: number, leg: number): LegRoll {
  const at = `${row.id}:${convoy}:${leg}`;
  return {
    raiders: inRange(row.raiders, hash(`${at}:raiders`)),
    monsters: inRange(row.monsters, hash(`${at}:monsters`)),
    guard: inRange(row.guard, hash(`${at}:guard`)),
  };
}

// ---- the formulas ----

/** What a convoy holds before its first leg. The privateers' pirates have already taken it. */
export function startingCargo(flow: SeaFlow): ConvoyCargo {
  return flow === 'recover' ? { crates: 0, carried: SEA.crates } : { crates: SEA.crates, carried: 0 };
}

/**
 * One leg, by the side's formula. `battery` is the rating fired this leg (0
 * for a leg sailed without the player); `kills` the side's prey killed at
 * this water during the leg. Integers in, integers out.
 */
export function resolveLeg(flow: SeaFlow, roll: LegRoll, cargo: ConvoyCargo, battery: number, kills: number): LegOutcome {
  switch (flow) {
    case 'convoy': {
      const lost = clamp(roll.raiders + roll.monsters - kills - battery, 0, cargo.crates);
      return { cargo: { ...cargo, crates: cargo.crates - lost }, moved: lost, credited: 0 };
    }
    case 'escort': {
      const lost = clamp(roll.monsters - kills - battery, 0, cargo.crates);
      return { cargo: { ...cargo, crates: cargo.crates - lost }, moved: lost, credited: 0 };
    }
    case 'raid': {
      const seized = clamp(battery - (roll.guard - kills), 0, cargo.crates);
      return { cargo: { ...cargo, crates: cargo.crates - seized }, moved: seized, credited: seized };
    }
    case 'recover': {
      const recovered = clamp(battery - (roll.raiders - kills), 0, cargo.carried);
      return { cargo: { ...cargo, carried: cargo.carried - recovered }, moved: recovered, credited: recovered };
    }
  }
}

/** Convoy and escort are paid at port, for the crates still aboard after the last leg. */
export function paidAtPort(flow: SeaFlow): boolean {
  return flow === 'convoy' || flow === 'escort';
}

// ---- the battery ----

export interface Battery {
  /** Cannons held, up to `SEA.maxCannons`. */
  cannons: number;
  volleys: number;
  hit: number;
  morale: number;
  /** volleys x hit + morale. */
  rating: number;
  /** What a leg fired now would spend: one of each that is true. */
  shot: boolean;
  powder: boolean;
  ration: boolean;
}

/**
 * The battery a leg fired now would have. The ship supplies volleys 1, hit 1,
 * morale 0, so a player with an empty hold still fires 1. Cannons (kept, up
 * to `maxCannons`) add a volley each when a cannonball loads them; a powder
 * charge adds 1 hit; a ration adds 1 morale.
 */
export function batteryOf(held: DeepReadonly<MaterialsState>): Battery {
  const cannons = Math.min(heldOf(held, SEA.cannon), SEA.maxCannons);
  const shot = cannons > 0 && heldOf(held, SEA.shot) > 0;
  const powder = heldOf(held, SEA.powder) > 0;
  const ration = heldOf(held, SEA.ration) > 0;
  const volleys = 1 + (shot ? cannons : 0);
  const hit = 1 + (powder ? 1 : 0);
  const morale = ration ? 1 : 0;
  return { cannons, volleys, hit, morale, rating: volleys * hit + morale, shot, powder, ration };
}

// ---- the merchants' port sale ----

export interface DealTerm {
  id: string;
  level: number;
  gold: number;
  met: boolean;
}

/** Gold per crate sold: `SEA_DEAL.base` plus every term the Speechcraft level meets. */
export function dealPrice(level: number): { price: number; level: number; terms: DealTerm[] } {
  const terms = SEA_DEAL.terms.map((t) => ({ id: t.id, level: t.level, gold: t.gold, met: level >= t.level }));
  const price = SEA_DEAL.base + terms.reduce((n, t) => n + (t.met ? t.gold : 0), 0);
  return { price, level, terms };
}

// ---- the convoy in the counters ----

export type CargoPart = 'convoy' | 'leg' | 'crates' | 'carried';

/** `sea:<water>:convoy|leg|crates|carried`: the convoy the player sails with, after its last leg sailed. */
export const cargoKey = (spot: string, part: CargoPart): string => `sea:${spot}:${part}`;
/** `sea:<water>:kills` and `sea:<water>:kills:leg`: the side's prey killed in one leg, and that leg's id. */
export const killKey = (spot: string, part: 'kills' | 'leg'): string => `sea:${spot}:kills${part === 'leg' ? ':leg' : ''}`;

/** A leg's id in `killKey(spot, 'leg')`: never 0, so an unset counter matches no leg. */
export const legId = (convoy: number, leg: number): number => convoy * SEA.legs + leg + 1;

/**
 * The convoy's cargo as it stands before `leg` (0-based) of `convoy` at this
 * water: the stored cargo if the player has sailed with this convoy, else a
 * fresh convoy; then every leg since folded in without the player.
 */
export function cargoBefore(
  counts: DeepReadonly<CountersState>,
  flow: SeaFlow,
  row: DeepReadonly<ConvoyDef>,
  convoy: number,
  leg: number,
): ConvoyCargo {
  const c = counts.counts;
  let cargo = startingCargo(flow);
  let next = 0;
  if ((c[cargoKey(row.id, 'convoy')] ?? 0) === convoy + 1) {
    cargo = { crates: c[cargoKey(row.id, 'crates')] ?? 0, carried: c[cargoKey(row.id, 'carried')] ?? 0 };
    next = c[cargoKey(row.id, 'leg')] ?? 0;
  }
  for (let j = next; j < leg; j++) cargo = resolveLeg(flow, legRoll(row, convoy, j), cargo, 0, 0).cargo;
  return cargo;
}

/** The side's prey killed at this water during this leg. */
export function legKills(counts: DeepReadonly<CountersState>, spot: string, convoy: number, leg: number): number {
  const c = counts.counts;
  return c[killKey(spot, 'leg')] === legId(convoy, leg) ? (c[killKey(spot, 'kills')] ?? 0) : 0;
}
