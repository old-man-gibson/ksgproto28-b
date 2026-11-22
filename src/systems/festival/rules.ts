/**
 * The Vermin Festival's dials and pure reads. Port of the run part of old
 * `data/festival.data.ts` and of `systems/festivalRules.ts`. No system import
 * but the ladder's and the world's registries, so `knockout` and the ladder's
 * rules can read a festival floor without the festival's state.
 */
import { MINUTES_PER_HOUR, TICKS_PER_DAY, TICKS_PER_GAME_MINUTE } from '../clock';
import { FLOOR_BY_AREA, TOWERS, type FloorDef } from '../ladder';
import { SPOTS } from '../world';

export const FESTIVAL_BAND = 'ascent_festival';
/** Floor 15: the dark room and the hub behind its door. */
export const DARK_FLOOR = 'ascent_f15';
/** Floor 16: the royale (step 4 port C5). */
export const ROYALE_FLOOR = 'ascent_f16';
/** Floor 15's landing, where every attempt starts. */
export const DARK_ROOM = 'f15_dark_room';
/** Floor 16's landing, the royale's field (step 4 port C5). */
export const ARENA = 'f16_arena';
/** The hub's stores: a search whose limits reset with every attempt. */
export const FESTIVAL_STORES = 'f15_stores';

const TICKS_PER_HOUR = TICKS_PER_GAME_MINUTE * MINUTES_PER_HOUR;

/** Ten festival days between the door opening and the royale. */
export const PREP_TICKS = 10 * TICKS_PER_DAY;
/** A lost attempt shuts floors 15 and 16 for three days of the world clock. */
export const LOCKOUT_TICKS = 3 * TICKS_PER_DAY;

/**
 * Counters the festival writes. `festival:door` is 1 while this attempt's
 * dark room door stands open (the hub's road reads it) and 0 from the start
 * of an attempt and from its end, won or lost. `festival:wins` counts royales
 * won this run. The floors' clears read the two boss lines instead
 * (`boss:f15_dark_room`, `boss:f16_arena`).
 */
export const FESTIVAL_DOOR_KEY = 'festival:door';
export const FESTIVAL_WINS_KEY = 'festival:wins';
/**
 * 1 while a lost attempt keeps floors 15 and 16 shut. The old build read the
 * lockout's end tick against the world clock in `festivalLocked`; the ladder
 * here reads counters, so the festival sets this at the loss and clears it on
 * the tick the clock reaches the end. A run counter: a prestige ends it.
 */
export const FESTIVAL_SHUT_KEY = 'festival:shut';

/** Ticks between one dark room wave falling and the next stepping up. */
export const WAVE_PAUSE_TICKS = 30;


// ---- rewards ----

/** A win pays this piece, the first win of a run only: reruns pay nothing. */
export const FESTIVAL_REWARD = 'festival_laurel';

/**
 * Every hundredth win in a run puts one festival token in the stronghold
 * stash (200 earns two); the count is a run counter and restarts each run.
 */
export const TOKEN_EVERY_WINS = 100;
export const FESTIVAL_TOKEN = { name: 'Festival Token', icon: '🎟️' };

/**
 * A token's three choices. The permanent bonus: `mods` per stack, stacking up
 * to `cap` stacks. The technique: one of `offer` drawn from `pool` with the
 * token's seed; the pool is a placeholder of existing techniques until the
 * festival's own are written. The equipment: `regalia`, above the normal
 * reward and keep-marked.
 */
export const TOKEN_BONUS: { cap: number; mods: { stat: string; op: 'add' | 'mult'; value: number }[] } = {
  cap: 5,
  mods: [
    { stat: 'damage', op: 'mult', value: 0.03 },
    { stat: 'maxHp', op: 'mult', value: 0.03 },
  ],
};
export const TOKEN_TECHNIQUES = { offer: 3, pool: ['riposte', 'sidestep', 'thrust', 'whirl_kick', 'taunt', 'ginga'] };
export const TOKEN_REGALIA = 'festival_regalia';

/**
 * The hidden title: enter floor 16 within twelve festival hours of the dark
 * room's door opening, then win. Written only by that win.
 */
export const SWIFT_ENTRY_TICKS = 12 * TICKS_PER_HOUR;
export const FESTIVAL_SWIFT_KEY = 'festival:swift_wins';

// ---- the royale's numbers the run reads (the field itself is step 4 port C5) ----

/** The others: ninety-nine survivors of the other rooms. */
export const SURVIVORS = 99;

/**
 * Survivor levels. The ninety-nine prepare too: over the ten days they gain
 * `growth` levels on a straight line, and the royale always opens at the end
 * of that line, waited out or jumped. Each duel a survivor wins on the field
 * adds `perWin`, up to `winCap`; the champion stands `champion` above.
 */
export const SURVIVOR_LEVELS = { base: 34, growth: 3, perWin: 1, winCap: 2, champion: 1 };

// ---- the hub's stock ----

/**
 * Hub spots whose searches restock when an attempt starts. The survey
 * restocks too: every attempt generates its own field, so what was scouted
 * belongs to that attempt, and its flags are cleared with it. A listed spot
 * that does not exist is skipped.
 */
export const FESTIVAL_RESTOCK = ['f15_stores', 'f15_herb_yard', 'f15_workshop', 'f15_survey'];

/**
 * The royale field's sections, by id: the scouted flags a new attempt clears.
 * The old build read the keys of `ROYALE_SECTIONS`, the royale's registry,
 * which comes with port C5; the survey's eight finds set these eight flags.
 */
export const ROYALE_SECTION_IDS = ['cliff', 'waterfall', 'river', 'bank', 'cave', 'glade', 'forest', 'village'];

/** The flag a survey find sets for a section: the royale's map shows that section's caches and dens. */
export const scoutedKey = (section: string): string => `flag:festival:scouted:${section}`;

// ---- the run's shape ----

export type FestivalPhase = 'dark' | 'prep' | 'royale';

/** One member of a staged festival fight: pinned level, no rolled modifier or rarity. */
export interface FestivalFoe {
  monsterId: string;
  level: number;
}

// ---- pure reads (old `festivalRules.ts`) ----

/** The festival floor a spot stands on, or null. */
export function festivalFloorOf(spotId: string): FloorDef | null {
  const spot = SPOTS[spotId];
  if (!spot) return null;
  const floor = FLOOR_BY_AREA.get(spot.areaId);
  return floor?.bandId === FESTIVAL_BAND ? floor : null;
}

/**
 * Where a knockout on floors 15 and 16 lands: outside the tower, at its hub
 * (the exception to "every knockout retreats to the last haven"). Null
 * anywhere else.
 */
export function ejectionSpotOf(spotId: string): string | null {
  const floor = festivalFloorOf(spotId);
  return floor ? (TOWERS[floor.towerId]?.hubSpot ?? null) : null;
}

/** Share of the ten days of preparation done: 0 at the door, 1 at the royale. */
export function prepShare(clock: number): number {
  return Math.min(1, Math.max(0, clock / PREP_TICKS));
}

/** Festival ticks left before the royale opens on its own. */
export function prepLeft(run: { phase: FestivalPhase; clock: number }): number {
  return run.phase === 'prep' ? Math.max(0, PREP_TICKS - run.clock) : 0;
}

/**
 * A survivor's level when it meets the player: their preparation (the clock,
 * capped at the ten days), plus the duels it has won on the field, capped.
 * The champion stands `champion` levels above.
 */
export function survivorLevel(clock: number, wins: number, champion = false): number {
  const s = SURVIVOR_LEVELS;
  return (
    s.base +
    Math.round(s.growth * prepShare(clock)) +
    Math.min(s.winCap, Math.max(0, wins) * s.perWin) +
    (champion ? s.champion : 0)
  );
}

/**
 * What the ladder means for the festival, for a climb (old `festivalLadder`):
 * - `royale`: the climb from floor 15 into floor 16 once the dark room's
 *   door is open;
 * - `shut`: that climb while the room still fights;
 * - `closed`: floor 16 from anywhere else. The royale is entered only from an
 *   attempt's hall, so with no attempt the ladder does not go there, even
 *   when floor 15 reads cleared from an earlier attempt;
 * - `forfeit`: from inside an attempt, any other rung, the tower's hub or a
 *   band's hub; it counts as a loss.
 * Null for every other climb, and for a move within the floor the player
 * stands on. `toFloorId` null is a hub.
 */
export type FestivalLadder = 'royale' | 'shut' | 'closed' | 'forfeit';

export function festivalLadder(
  run: { phase: FestivalPhase } | null,
  spotId: string,
  toFloorId: string | null,
): FestivalLadder | null {
  const here = festivalFloorOf(spotId);
  if (toFloorId === ROYALE_FLOOR && here?.id !== ROYALE_FLOOR) {
    if (!run || here?.id !== DARK_FLOOR) return 'closed';
    return run.phase === 'dark' ? 'shut' : 'royale';
  }
  if (!run || !here) return null;
  if (toFloorId === here.id) return null;
  return 'forfeit';
}

// ---- tokens (old `stash.ts`) ----

/** A small seeded generator, so a token's offer is the same every time it is opened. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The techniques a token offers: the pool shuffled by the token's seed, less
 * those already taken from earlier tokens, the first `offer` of what is left.
 * Fewer when the pool runs short; none once every one is taken. `known` says
 * which pool ids exist in the technique registry.
 */
export function tokenTechniques(
  seed: number,
  taken: readonly string[],
  known: (id: string) => boolean,
): string[] {
  const rng = seeded(seed);
  const pool = TOKEN_TECHNIQUES.pool.filter(known);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const takenSet = new Set(taken);
  return pool.filter((id) => !takenSet.has(id)).slice(0, TOKEN_TECHNIQUES.offer);
}

/** The bonus stacks the legacy holds, capped. The old `festivalBonusStacks`. */
export function bonusStacks(bonus: number): number {
  return Math.min(TOKEN_BONUS.cap, Math.max(0, bonus));
}
