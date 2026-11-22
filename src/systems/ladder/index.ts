/**
 * The ladder: towers, bands and floors, what is cleared, open, gated or
 * sealed, and the clear of a floor. Port of the old `systems/ladder.ts`, the
 * stop and gate half of `systems/towers.ts`, and `checkFloorClears` and
 * `syncBandPositions` of `systems/levels.ts`. See README.md in this folder.
 *
 * This system moves nobody. `world` rides the ladder; this file says where
 * the stops are and whether the gate is open.
 */
import {
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  on,
  skipped,
  registry,
  s,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type RecordOf,
  type SystemDef,
} from '../../kernel';
import { enemyKilled, fightWon } from '../combat';
import counters, { conditionSchema, conditionsMet, counterValue, setCounter, type Condition, type ConditionReader } from '../counters';
import { floorXpKey, grantLevelXp, levelsLine } from '../levels';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { conditionReader } from '../skills';
import bandsData from './content/bands.json';
import floorsData from './content/floors.json';
import ladderTextData from './content/ladder_text.json';
import towersData from './content/towers.json';
import { migrations } from './migrations';

export * from './floorRules';

// ---- content ----

const towers = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    hubSpot: s.ref('spots', { help: 'The spot every entrance leads to.' }),
    direction: s.enum(['up', 'down']),
    foreknown: s.optional(s.boolean({ help: 'Floors ahead are shown before they open.' })),
    desc: s.string(),
  }),
  towersData,
  'Towers',
);

const bands = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    towerId: s.ref('towers'),
    index: s.number({ integer: true, min: 1 }),
    clearsToAdvance: s.number({ integer: true, min: 0, help: 'Not read: the ascent is sequential.' }),
    order: s.optional(s.enum(['sequence', 'any'])),
    gate: s.optional(s.array(conditionSchema)),
    hub: s.optional(s.ref('spots')),
    levelSteps: s.optional(s.array(s.number())),
    dynamicLevel: s.optional(s.object({ factor: s.number(), capShare: s.number() })),
    desc: s.optional(s.string()),
  }),
  bandsData,
  'Bands',
);

const floors = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    towerId: s.ref('towers'),
    bandId: s.optional(s.ref('bands', { help: 'Absent: the floor is off the ladder.' })),
    index: s.number({ integer: true, min: 0 }),
    areaId: s.ref('areas'),
    gate: s.optional(s.array(conditionSchema)),
    landing: s.optional(s.ref('spots')),
    clear: s.optional(s.array(conditionSchema)),
    clearXp: s.optional(s.number({ min: 0 })),
    seam: s.optional(s.object({ verb: s.optional(s.string()) })),
    personal: s.optional(s.boolean()),
    persists: s.optional(s.boolean()),
    desc: s.string(),
  }),
  floorsData,
  'Floors',
);

const ladderText = registry(textSchema, ladderTextData, 'Ladder text');
const TEXT = Object.fromEntries((ladderTextData as TextRecord[]).map((r) => [r.id, r.text]));

export type TowerDef = RecordOf<typeof towers>;
export type BandDef = Omit<RecordOf<typeof bands>, 'gate'> & { gate?: Condition[] };
export type FloorDef = Omit<RecordOf<typeof floors>, 'gate' | 'clear'> & { gate?: Condition[]; clear?: Condition[] };

export const TOWERS: Record<string, TowerDef> = Object.fromEntries((towersData as TowerDef[]).map((t) => [t.id, t]));
export const BANDS: Record<string, BandDef> = Object.fromEntries((bandsData as BandDef[]).map((b) => [b.id, b]));
export const FLOORS: Record<string, FloorDef> = Object.fromEntries((floorsData as FloorDef[]).map((f) => [f.id, f]));
/** The floor of an area. */
export const FLOOR_BY_AREA: ReadonlyMap<string, FloorDef> = new Map(Object.values(FLOORS).map((f) => [f.areaId, f]));

/** Base ticks to climb or descend past one rung. */
export const CLIMB_TICKS_PER_FLOOR = 45;

/**
 * Authored edges allowed across a banded floor's boundary (old
 * `towers.data.ts` 466-483). The ladder is the only door into a floor
 * (`tests/worldContent.test.ts`); each pair here is a decision, both
 * directions listed.
 *
 * - The hold's door on floor 11. Both edges are one-way and gated on
 *   `legacy:stronghold`, and the hold's only other exit is one-way out to the
 *   Foot, so nothing reaches floor 11 through the hold without having climbed
 *   there first.
 */
export const OFF_LADDER_DOORS: readonly (readonly [from: string, to: string])[] = [
  ['f11_gatehouse', 'base_entrance'],
  ['base_entrance', 'f11_gatehouse'],
];

/** True for an authored edge listed in `OFF_LADDER_DOORS`. */
export function offLadderDoor(from: string, to: string): boolean {
  return OFF_LADDER_DOORS.some(([f, t]) => f === from && t === to);
}

/** The floors of a band, in ladder order. */
export function floorsInBand(bandId: string): FloorDef[] {
  return BAND_FLOORS.get(bandId) ?? [];
}

/** The floors of each band in ladder order, built once: the clear check reads them on every kill. */
const BAND_FLOORS: ReadonlyMap<string, FloorDef[]> = new Map(
  Object.keys(BANDS).map((id) => [
    id,
    Object.values(FLOORS)
      .filter((f) => f.bandId === id)
      .sort((a, b) => a.index - b.index),
  ]),
);

// ---- reads (old `ladder.ts`) ----

type R = ConditionReader;

/** The banded floors of one tower in ladder order. */
export function ladderFloors(towerId: string): FloorDef[] {
  return Object.values(FLOORS)
    .filter((f) => f.towerId === towerId && f.bandId !== undefined)
    .sort((a, b) => a.index - b.index);
}

/** The clear of the floor holds. A floor with no `clear` is never finished. */
export function clearMet(r: R, floor: FloorDef): boolean {
  return !!floor.clear?.length && conditionsMet(r, floor.clear);
}

/**
 * Whether an owned band pass covers a band. Prestige (port 7) states it; until
 * then no band is passed.
 */
let bandPass: (r: R, bandId: string) => boolean = () => false;

/** The prestige system registers the read of its band-pass boons. */
export function registerBandPass(read: (r: R, bandId: string) => boolean): void {
  bandPass = read;
}

export function bandPassed(r: R, bandId: string): boolean {
  return bandPass(r, bandId);
}

/**
 * Whether a floor was cleared by a ward window running out, not by a kill.
 * The `wards` system states it (`registerLapse`); until then no floor lapses.
 */
let lapse: (r: R, floorId: string) => boolean = () => false;

/** The wards system registers the read of its lapsed windows. */
export function registerLapse(read: (r: R, floorId: string) => boolean): void {
  lapse = read;
}

/**
 * Whether a floor is shut whatever else holds: a lost festival attempt shuts
 * floors 15 and 16 (old `festivalLocked`). The `festival` system states it
 * (`registerFloorShut`); until then no floor is shut.
 */
let floorShut: (r: R, floor: FloorDef) => boolean = () => false;

/** The festival system registers the read of its lockout. */
export function registerFloorShut(read: (r: R, floor: FloorDef) => boolean): void {
  floorShut = read;
}

/**
 * Words for a counter the ladder card cannot name from its key, by key: the
 * system that owns the counter registers them at module load (`sea`: crates
 * won, the side's mission). The function gets the term's value.
 */
const TERM_TEXTS = new Map<string, (value: number) => string>();

export function registerTermText(key: string, text: (value: number) => string): void {
  TERM_TEXTS.set(key, text);
}

/**
 * Floors whose clear names no spot, so the floor standard's spine rules
 * (`floorRules.ts`) cannot run on them. Each entry is a decision with its
 * reason. Old `SPINE_EXEMPT` (`towers.data.ts`); `tests/worldContent.test.ts`
 * pins the list.
 */
export const SPINE_EXEMPT: Readonly<Record<string, string>> = {
  ascent_f14:
    'cleared by any one of four side wings, stamped as flag:sea:14:done by the side’s boss kill (sea); an AND-only clear cannot name four spots of which one is enough',
};

/**
 * The floor was cleared by a ward window running out (old `clearLapsed`,
 * bands-2-3.md Q24): the way up opens, but it pays no clear XP and no
 * harvest floor.
 */
export function clearLapsed(r: R, floor: Pick<FloorDef, 'id'>): boolean {
  return lapse(r, floor.id);
}

/** Cleared for the ladder: the clear holds, or a pass covers the band. */
export function floorCleared(r: R, floor: FloorDef): boolean {
  if (floor.bandId !== undefined && bandPassed(r, floor.bandId)) return true;
  return clearMet(r, floor);
}

/** The highest banded floor of the tower. */
export function topRung(towerId: string): FloorDef | undefined {
  const all = ladderFloors(towerId);
  return all[all.length - 1];
}

/** The top rung is cleared: nothing is left to climb to. */
export function ladderEnded(r: R, towerId: string): boolean {
  const top = topRung(towerId);
  return !!top && floorCleared(r, top);
}

/** The notice for a tower whose cleared top rung is `top`. */
export function endNotice(top: FloorDef): string {
  return fillText(TEXT.end, { floor: top.index + 1 });
}

function bandIndexOf(floor: FloorDef): number {
  return floor.bandId === undefined ? 0 : (BANDS[floor.bandId]?.index ?? 0);
}

function belowBand(band: BandDef): FloorDef[] {
  return ladderFloors(band.towerId).filter((f) => bandIndexOf(f) < band.index);
}

/** The rungs a floor waits on. */
export function floorsBelow(floor: FloorDef): FloorDef[] {
  const band = floor.bandId === undefined ? undefined : BANDS[floor.bandId];
  if (band?.order === 'any') return belowBand(band);
  return ladderFloors(floor.towerId).filter((f) => f.index < floor.index);
}

/**
 * Every rung below cleared, and the gate of the band and of the floor met. A
 * floor off the ladder is never unlocked. A passed band waives its gates. A
 * shut floor (a lost festival attempt) is not unlocked, whatever else holds;
 * the floors above stay as they were.
 */
export function floorUnlocked(r: R, floor: FloorDef): boolean {
  if (floor.bandId === undefined) return false;
  if (floorShut(r, floor)) return false;
  if (!floorsBelow(floor).every((f) => floorCleared(r, f))) return false;
  if (bandPassed(r, floor.bandId)) return true;
  const band = BANDS[floor.bandId];
  if (band?.gate && !conditionsMet(r, band.gate)) return false;
  return !floor.gate || conditionsMet(r, floor.gate);
}

/** How a rung reads. `sealed` outranks `gated`. */
export type RungStatus = 'cleared' | 'open' | 'gated' | 'sealed';

export function rungStatus(r: R, floor: FloorDef): RungStatus {
  if (floorCleared(r, floor)) return 'cleared';
  if (floorUnlocked(r, floor)) return 'open';
  return floorsBelow(floor).every((f) => floorCleared(r, f)) ? 'gated' : 'sealed';
}

/** The band whose hub is this spot. */
export function bandHubAt(spotId: string): BandDef | undefined {
  return Object.values(BANDS).find((b) => b.hub === spotId);
}

export function hubStatus(r: R, band: BandDef): Exclude<RungStatus, 'cleared'> {
  if (!belowBand(band).every((f) => floorCleared(r, f))) return 'sealed';
  return !band.gate || conditionsMet(r, band.gate) ? 'open' : 'gated';
}

/**
 * The counter that says an earlier run reached a floor. The legacy block
 * keeps the list (old `prestige.floorsSeen`); prestige sets one counter per
 * floor at the start of every run.
 */
export const floorSeenKey = (floorId: string): string => `legacy:floor_seen:${floorId}`;

/**
 * The door of the rung was reached this run, or in a run that ended in a
 * prestige. The old `floorReached`.
 */
export function floorReached(r: R, floor: FloorDef): boolean {
  return r.counter(floorSeenKey(floor.id)) >= 1 || rungStatus(r, floor) !== 'sealed';
}

export function bandKnown(r: R, band: BandDef): boolean {
  if (band.hub && hubStatus(r, band) !== 'sealed') return true;
  return floorsInBand(band.id).some((f) => floorReached(r, f));
}

/** The banded floors this run has reached. */
export function floorsReachedThisRun(r: R): string[] {
  return Object.values(FLOORS)
    .filter((f) => f.bandId !== undefined && rungStatus(r, f) !== 'sealed')
    .map((f) => f.id);
}

export function bandOpen(r: R, band: BandDef): boolean {
  return hubStatus(r, band) === 'open';
}

/** The lowest floor index of a band. */
export function bandBaseIndex(band: BandDef): number {
  const list = floorsInBand(band.id);
  return list.length ? list[0].index : 0;
}

/** Where a rung sits for pricing a climb. */
export function rungIndex(floor: FloorDef): number {
  const band = floor.bandId === undefined ? undefined : BANDS[floor.bandId];
  return band?.order === 'any' ? bandBaseIndex(band) : floor.index;
}

/** Levels the band adds to a monster spawned in this area. The old `bandLevelStep`. */
export function bandLevelStep(r: R, areaId: string): number {
  const floor = FLOOR_BY_AREA.get(areaId);
  const band = floor?.bandId === undefined ? undefined : BANDS[floor.bandId];
  const steps = band?.levelSteps;
  if (!band || !steps?.length) return 0;
  const cleared = floorsInBand(band.id).filter((f) => floorCleared(r, f)).length;
  return steps[Math.min(cleared, steps.length - 1)];
}

/** The dynamic-level rule of the band this area is in. */
export function bandDynamicLevel(areaId: string): { factor: number; capShare: number } | undefined {
  const floor = FLOOR_BY_AREA.get(areaId);
  return floor?.bandId === undefined ? undefined : BANDS[floor.bandId]?.dynamicLevel;
}

export function bandCleared(r: R, band: BandDef): boolean {
  const list = floorsInBand(band.id);
  return list.length > 0 && list.every((f) => floorCleared(r, f));
}

/** The counter set once a run when every floor of a band is cleared. */
export function bandClearedKey(bandId: string): string {
  return `cleared:band:${bandId}`;
}

/** The counter holding the position of a floor in an `any` band. */
export function bandPosKey(floorId: string): string {
  return `band:pos:${floorId}`;
}

/** "other floors of The City" for a position key (`band:pos:<floor>`). The old `otherFloorsOf`. */
export function otherFloorsOf(key: string): string {
  const floor = FLOORS[key.slice('band:pos:'.length)];
  const band = floor?.bandId === undefined ? undefined : BANDS[floor.bandId];
  return band ? `other floors of ${band.name}` : 'other floors';
}

// ---- stops and the gate (old `towers.ts`, without the ride) ----

/**
 * The tower whose ladder answers at a spot: its hub, a band hub, or any spot
 * of one of its banded floors. `areaId` is the area of the spot. Null on a
 * floor off the ladder (floor 0) and anywhere else.
 */
export function towerAtSpot(spotId: string, areaId: string): TowerDef | null {
  const here = FLOOR_BY_AREA.get(areaId);
  if (here) return here.bandId === undefined ? null : (TOWERS[here.towerId] ?? null);
  const band = bandHubAt(spotId);
  if (band) return TOWERS[band.towerId] ?? null;
  return Object.values(TOWERS).find((t) => t.hubSpot === spotId) ?? null;
}

/** Where a spot sits on the stack: the rung of its floor, the base of a band hub, or 0. */
export function spotIndex(spotId: string, areaId: string): number {
  const here = FLOOR_BY_AREA.get(areaId);
  if (here) return rungIndex(here);
  const band = bandHubAt(spotId);
  return band ? bandBaseIndex(band) : 0;
}

/** The word for a move along the stack. */
export function climbVerb(tower: TowerDef, fromIndex: number, toIndex: number): 'Climbing' | 'Descending' | 'Crossing' {
  if (toIndex === fromIndex) return 'Crossing';
  return (tower.direction === 'down') === toIndex > fromIndex ? 'Descending' : 'Climbing';
}

/** A place the ladder answers: a landing, a band hub or the tower hub. */
export interface RideStop {
  spot: string;
  tower: string;
  /** The rung the stop sits at. */
  index: number;
  floor?: FloorDef;
  band?: BandDef;
}

export function hubStop(tower: TowerDef): RideStop {
  return { spot: tower.hubSpot, tower: tower.id, index: 0 };
}

export function bandStop(band: BandDef): RideStop {
  return { spot: band.hub!, tower: band.towerId, index: bandBaseIndex(band), band };
}

/** Null for a floor with no landing. */
export function floorStop(floor: FloorDef): RideStop | null {
  return floor.landing ? { spot: floor.landing, tower: floor.towerId, index: rungIndex(floor), floor } : null;
}

/** Every stop of a tower: hub, band hubs, landings by rung. */
export function rideStops(tower: TowerDef): RideStop[] {
  const stops: RideStop[] = [hubStop(tower)];
  for (const band of Object.values(BANDS)) {
    if (band.hub && band.towerId === tower.id) stops.push(bandStop(band));
  }
  for (const floor of ladderFloors(tower.id)) {
    const stop = floorStop(floor);
    if (stop) stops.push(stop);
  }
  return stops;
}

/**
 * The terms of the stop itself: its floor unlocked, its band open. The
 * festival's verdicts on a ride are the world's to act on (`FloorRule`).
 */
export function stopOpen(r: R, stop: RideStop): boolean {
  if (stop.floor && !floorUnlocked(r, stop.floor)) return false;
  if (stop.band && !bandOpen(r, stop.band)) return false;
  return true;
}

/** Base ticks for a ride between two rungs. */
export function rideTicks(fromIndex: number, toIndex: number): number {
  return Math.max(1, Math.abs(toIndex - fromIndex)) * CLIMB_TICKS_PER_FLOOR;
}

// ---- the clear ----

export interface LadderState {}

/** Request: check the floor clears now. `world` sends it on arrival; quests (port 7) on a turn-in. */
export const checkClears = defineEvent<void>('ladder/check');
/** A floor paid its clear this run. */
export const floorClearedEvent = defineEvent<{ floor: string }>('ladder/floor-cleared');

/**
 * DEBUG SKIP, not a player action (CONTENT.md Q5, the old John's
 * `debugSkipWall`): raise every counter the floor's gate and clear read to
 * the value asked, stamp its clear XP as paid, and check the clears. Used by
 * the John driver past a wall only. Refused in a production build.
 */
export const debugSkipWall = defineCommand<{ floor: string }>('ladder/debug-skip-wall');

/** A production build of the page: the debug skip is refused. Tests, scripts and the dev server run it. */
const PRODUCTION = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/** The condition reader of the player, for the reads above. */
export function ladderReader(ctx: ReadCtx): ConditionReader {
  return conditionReader(ctx);
}

/**
 * Pay the clear XP of every floor whose clear holds for the first time this
 * run, stamp cleared bands and bring the positions of `any` bands up to date.
 * The old `checkFloorClears`. A counter set in this handler is read as set by
 * the next call, not by this one: a floor and its band are stamped together
 * because both read the clear conditions, not the stamps.
 */
function checkFloorClears(ctx: Ctx<LadderState>): void {
  const r = ladderReader(ctx);
  const counts = ctx.read(counters);
  // `floorCleared` once per floor and call: the band stamps and the
  // positions below read the same floors. Counters set here are read as set
  // by the next call (see above), so the memo holds for the whole call.
  const memo = new Map<string, boolean>();
  const cleared = (f: FloorDef): boolean => {
    let v = memo.get(f.id);
    if (v === undefined) memo.set(f.id, (v = floorCleared(r, f)));
    return v;
  };
  for (const floor of Object.values(FLOORS)) {
    if (!floor.clearXp) continue;
    const key = floorXpKey(floor.id);
    if (counterValue(counts, key) >= 1 || !clearMet(r, floor)) continue;
    ctx.emit(setCounter, { key, value: 1 });
    // A clear by a lapsed ward window opens the way and pays nothing (Q24).
    if (clearLapsed(r, floor)) {
      ctx.emit(logLine, { msg: levelsLine('floor_lapsed', { name: floor.name }), kind: 'info' });
      ctx.emit(floorClearedEvent, { floor: floor.id });
      continue;
    }
    ctx.emit(logLine, { msg: levelsLine('floor', { name: floor.name, xp: floor.clearXp }), kind: 'info' });
    ctx.emit(grantLevelXp, { xp: floor.clearXp });
    if (topRung(floor.towerId)?.id === floor.id) ctx.emit(logLine, { msg: endNotice(floor), kind: 'info' });
    ctx.emit(floorClearedEvent, { floor: floor.id });
  }
  for (const band of Object.values(BANDS)) {
    const key = bandClearedKey(band.id);
    if (counterValue(counts, key) >= 1) continue;
    const list = floorsInBand(band.id);
    if (!(list.length > 0 && list.every(cleared))) continue;
    ctx.emit(setCounter, { key, value: 1 });
    if (band.order === 'any') ctx.emit(logLine, { msg: levelsLine('band', { name: band.name }), kind: 'info' });
  }
  // The old `syncBandPositions`.
  for (const band of Object.values(BANDS)) {
    if (band.order !== 'any') continue;
    const list = floorsInBand(band.id);
    const uncleared = list.filter((f) => !cleared(f));
    const position = list.length - uncleared.length;
    for (const floor of uncleared) {
      const key = bandPosKey(floor.id);
      if (counterValue(counts, key) !== position) ctx.emit(setCounter, { key, value: position });
    }
  }
}

// ---- view ----

/** One condition of a gate or a clear, as the panel shows it. */
export interface TermView {
  /** The condition as text: "150 gold earned". */
  text: string;
  current: number;
  needed: number;
  met: boolean;
}

/** A band's hub (band 3's castle), shown before the band's first rung. */
export interface HubView {
  band: string;
  spot: string;
  name: string;
  icon: string;
  status: Exclude<RungStatus, 'cleared'>;
  /** The gate of the band. */
  gate: TermView[];
}

export interface RungView {
  id: string;
  name: string;
  index: number;
  band: string;
  status: RungStatus;
  /** Shut whatever its status: a lost festival attempt (`registerFloorShut`). No ride goes there. */
  shut: boolean;
  landing: string | null;
  /** The gate of the band and of the floor. Empty for a floor with none. */
  gate: TermView[];
  clear: TermView[];
  desc: string;
  /** The hub of this rung's band, on the band's first rung only. */
  hub: HubView | null;
}

export interface LadderView {
  towers: { id: string; name: string; icon: string; hub: string; ended: boolean; endNotice: string | null; rungs: RungView[] }[];
}

const ladder = defineSystem<LadderState, LadderView>({
  id: 'ladder',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { towers, bands, floors, ladder_text: ladderText },

  commands: [
    handle(debugSkipWall, (ctx, { floor }) => {
      if (PRODUCTION) return skipped('the debug skip is refused in a production build');
      const def = FLOORS[floor];
      if (!def) return skipped(`no floor has the id "${floor}"`);
      const counts = ctx.read(counters);
      for (const c of [...(def.gate ?? []), ...(def.clear ?? [])]) {
        if (c.type === 'stat' && counterValue(counts, c.key) < c.value) ctx.emit(setCounter, { key: c.key, value: c.value });
      }
      ctx.emit(setCounter, { key: floorXpKey(floor), value: 1 });
      ctx.emit(checkClears, undefined);
      return OK;
    }),
  ],

  events: [
    // The clear counters of a kill are bumped by events of the same handler,
    // delivered before these.
    on(enemyKilled, (ctx) => checkFloorClears(ctx)),
    on(fightWon, (ctx) => checkFloorClears(ctx)),
    on(checkClears, (ctx) => checkFloorClears(ctx)),
  ],

  view: (ctx) => {
    const r = ladderReader(ctx);
    // Names of spots and monsters come from the content index: this folder imports neither registry.
    const nameOf = (registryName: string, id: string): string =>
      (ctx.content.get<{ id: string; name: string }>(registryName, id) as { name?: string } | undefined)?.name ?? id;
    const subject = (key: string): string => {
      const part = key.split(':');
      if (key === 'gold:earned') return 'gold earned';
      if (part[0] === 'kills' && part[1] === 'tag') return `${part[2]} kills`;
      if (part[0] === 'kills') return `${nameOf('monsters', part[1])} kills`;
      if (part[0] === 'fights') return `wins at ${nameOf('spots', part[1])}`;
      if (part[0] === 'slain') return `${nameOf('monsters', part[2])} slain at ${nameOf('spots', part[1])}`;
      if (part[0] === 'boss') return `keeper of ${nameOf('spots', part[1])} slain`;
      return key;
    };
    type SpotRow = {
      id: string;
      name: string;
      fightLimit?: number;
      stampOnClear?: string;
      encounters?: { requires?: Condition[] }[];
    };
    // The old `stampTerm`: the spots that write a stamp clear, live ones first.
    const stampText = (key: string): string | null => {
      const spots = ctx.content.all<SpotRow>('spots').filter((sp) => sp.stampOnClear === key);
      if (!spots.length) return null;
      const live = spots.filter(
        (sp) =>
          !(sp.fightLimit && r.counter(`fights:${sp.id}`) >= sp.fightLimit) &&
          (sp.encounters ?? []).some((e) => !e.requires || conditionsMet(r, e.requires)),
      );
      const names = (live.length ? live : spots).map((sp) => sp.name);
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
      return `Win ${list}`;
    };
    const term = (cond: Condition): TermView => {
      const met = conditionsMet(r, [cond]);
      if (cond.type === 'stat') {
        const current = Math.min(cond.value, r.counter(cond.key));
        const named = TERM_TEXTS.get(cond.key);
        if (named) return { text: named(cond.value), current, needed: cond.value, met };
        const stamp = stampText(cond.key);
        if (stamp) return { text: stamp, current, needed: cond.value, met };
        if (cond.key.startsWith('band:pos:'))
          return { text: `${cond.value}+ ${otherFloorsOf(cond.key)} cleared`, current, needed: cond.value, met };
        return { text: `${cond.value.toLocaleString('en-US')} ${subject(cond.key)}`, current, needed: cond.value, met };
      }
      const text =
        cond.type === 'skill'
          ? `Skill ${cond.id} at level ${cond.level}`
          : cond.type === 'attr'
            ? `Attribute ${cond.attr} at ${cond.level}`
            : cond.type === 'statMax'
              ? cond.key.startsWith('band:pos:')
                ? `at most ${cond.value} ${otherFloorsOf(cond.key)} cleared`
                : `${subject(cond.key)} at most ${cond.value}`
              : cond.type === 'equippedTag'
                ? `Wielding: ${cond.tag}`
                : cond.type === 'quest'
                  ? `Quest done: ${cond.id}`
                  : `Boon owned: ${nameOf('prestige_boons', cond.id)}`;
      return { text, current: met ? 1 : 0, needed: 1, met };
    };
    const hubOf = (floor: FloorDef): HubView | null => {
      const band = floor.bandId === undefined ? undefined : BANDS[floor.bandId];
      if (!band?.hub || floorsInBand(band.id)[0]?.id !== floor.id) return null;
      const spot = ctx.content.get<{ id: string; name: string; icon: string }>('spots', band.hub) as
        | { name?: string; icon?: string }
        | undefined;
      return {
        band: band.id,
        spot: band.hub,
        name: spot?.name ?? band.hub,
        icon: spot?.icon ?? '',
        status: hubStatus(r, band),
        gate: (band.gate ?? []).map(term),
      };
    };
    return {
      towers: Object.values(TOWERS).map((tower) => {
        const top = topRung(tower.id);
        const ended = ladderEnded(r, tower.id);
        return {
          id: tower.id,
          name: tower.name,
          icon: tower.icon,
          hub: tower.hubSpot,
          ended,
          endNotice: ended && top ? endNotice(top) : null,
          rungs: ladderFloors(tower.id).map((floor) => ({
            id: floor.id,
            name: floor.name,
            index: floor.index,
            band: BANDS[floor.bandId!]?.name ?? '',
            status: rungStatus(r, floor),
            shut: floorShut(r, floor),
            landing: floor.landing ?? null,
            gate: [...(BANDS[floor.bandId!]?.gate ?? []), ...(floor.gate ?? [])].map(term),
            clear: (floor.clear ?? []).map(term),
            desc: floor.desc,
            hub: hubOf(floor),
          })),
        };
      }),
    };
  },
});

export default ladder;
