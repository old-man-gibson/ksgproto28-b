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
  defineEvent,
  defineSystem,
  on,
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

/** The floors of a band, in ladder order. */
export function floorsInBand(bandId: string): FloorDef[] {
  return Object.values(FLOORS)
    .filter((f) => f.bandId === bandId)
    .sort((a, b) => a.index - b.index);
}

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
 * floor off the ladder is never unlocked. A passed band waives its gates.
 */
export function floorUnlocked(r: R, floor: FloorDef): boolean {
  if (floor.bandId === undefined) return false;
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

/** The terms of the stop itself: its floor unlocked, its band open. The festival verdicts of the old gate are step 4. */
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
  for (const floor of Object.values(FLOORS)) {
    if (!floor.clearXp) continue;
    const key = floorXpKey(floor.id);
    if (counterValue(counts, key) >= 1 || !clearMet(r, floor)) continue;
    ctx.emit(setCounter, { key, value: 1 });
    ctx.emit(logLine, { msg: levelsLine('floor', { name: floor.name, xp: floor.clearXp }), kind: 'info' });
    ctx.emit(grantLevelXp, { xp: floor.clearXp });
    if (topRung(floor.towerId)?.id === floor.id) ctx.emit(logLine, { msg: endNotice(floor), kind: 'info' });
    ctx.emit(floorClearedEvent, { floor: floor.id });
  }
  for (const band of Object.values(BANDS)) {
    const key = bandClearedKey(band.id);
    if (counterValue(counts, key) >= 1 || !bandCleared(r, band)) continue;
    ctx.emit(setCounter, { key, value: 1 });
    if (band.order === 'any') ctx.emit(logLine, { msg: levelsLine('band', { name: band.name }), kind: 'info' });
  }
  // The old `syncBandPositions`.
  for (const band of Object.values(BANDS)) {
    if (band.order !== 'any') continue;
    const list = floorsInBand(band.id);
    const uncleared = list.filter((f) => !floorCleared(r, f));
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

export interface RungView {
  id: string;
  name: string;
  index: number;
  band: string;
  status: RungStatus;
  landing: string | null;
  /** The gate of the band and of the floor. Empty for a floor with none. */
  gate: TermView[];
  clear: TermView[];
  desc: string;
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
    const term = (cond: Condition): TermView => {
      const met = conditionsMet(r, [cond]);
      if (cond.type === 'stat') {
        const current = Math.min(cond.value, r.counter(cond.key));
        return { text: `${cond.value.toLocaleString('en-US')} ${subject(cond.key)}`, current, needed: cond.value, met };
      }
      const text =
        cond.type === 'skill'
          ? `Skill ${cond.id} at level ${cond.level}`
          : cond.type === 'attr'
            ? `Attribute ${cond.attr} at ${cond.level}`
            : cond.type === 'statMax'
              ? `${subject(cond.key)} at most ${cond.value}`
              : cond.type === 'equippedTag'
                ? `Wielding: ${cond.tag}`
                : cond.type === 'quest'
                  ? `Quest done: ${cond.id}`
                  : `Boon owned: ${cond.id}`;
      return { text, current: met ? 1 : 0, needed: 1, met };
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
            landing: floor.landing ?? null,
            gate: [...(BANDS[floor.bandId!]?.gate ?? []), ...(floor.gate ?? [])].map(term),
            clear: (floor.clear ?? []).map(term),
            desc: floor.desc,
          })),
        };
      }),
    };
  },
});

export default ladder;
