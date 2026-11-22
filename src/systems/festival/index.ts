/**
 * The Vermin Festival, floors 15 and 16. Port of old `systems/festival.ts`,
 * the run part of `data/festival.data.ts`, `systems/festivalRules.ts`,
 * `systems/festivalValidation.ts` and the token half of `systems/stash.ts`.
 * See README.md in this folder. The royale (floor 16's field) is step 4
 * port C5.
 *
 * One attempt runs from the dark room to the royale's end:
 *
 * - **The door.** Arriving in the dark room (floor 15's landing) starts an
 *   attempt: everything worn and carried is held, flasks and provisions too,
 *   and one plain weapon of the player's family is issued. It all comes back
 *   when the attempt ends, won or lost.
 * - **The dark room.** Nine others, in four waves; the last fights alone and
 *   is floor 15's boss line. The room emptied, its door opens onto the hub.
 * - **The hub.** Ten festival days to prepare. The festival keeps its own
 *   clock: it runs only while the game does with the player on its floors.
 * - **The royale.** Floor 16, entered by the ladder (a time jump to the end
 *   of the ten days) or on its own at day ten.
 * - **The loss.** A knockout on either floor, or the ladder to anywhere but
 *   the royale, lands the player outside the tower and shuts both floors for
 *   three days or until the next prestige.
 */
import {
  answer,
  defineCommand,
  defineRequest,
  defineSystem,
  handle,
  on,
  OK,
  PLAYER,
  registry,
  s,
  skipped,
  type Command,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import { holdAlchemy, returnAlchemy, type HeldAlchemy } from '../alchemy';
import { bankTicks } from '../bonus';
import clock, { MINUTES_PER_HOUR, TICKS_PER_DAY, TICKS_PER_GAME_MINUTE, totalTicksOf } from '../clock';
import combat, { enemyKilled, fightWon, startStaged } from '../combat';
import { isCard } from '../consumables';
import counters, { bumpCounter, counterValue, setCounter } from '../counters';
import items, {
  equipNow,
  FESTIVAL_HOLDS_FACT,
  festivalLentFact,
  grantItem,
  holdItems,
  itemDefOf,
  ITEMS,
  keepMarked,
  returnItems,
  stashItem,
  takeFromStash,
  type Equipment,
  type ItemInstance,
} from '../items';
import { registerFloorShut, type FloorDef } from '../ladder';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { holdSheathed, learnRequest, returnSheathed, TECHNIQUES } from '../martial';
import { holdMaterials, MATERIALS, returnMaterials, type HeldMaterials } from '../materials';
import skills, { skillLevel } from '../skills';
import { contentMod, namedFact, type StatMod } from '../stats';
import { checkTitles } from '../titles';
import world, { arrived, registerFloorRule, rideNow, siteOf, spotActivities, SPOTS, type RideVerdict } from '../world';
import darkRoomWavesData from './content/dark_room_waves.json';
import festivalTextData from './content/festival_text.json';
import issuedWeaponsData from './content/issued_weapons.json';
import { migrations } from './migrations';
import {
  bonusStacks,
  DARK_ROOM,
  ejectionSpotOf,
  FESTIVAL_BAND,
  FESTIVAL_DOOR_KEY,
  FESTIVAL_RESTOCK,
  FESTIVAL_REWARD,
  FESTIVAL_SHUT_KEY,
  FESTIVAL_SWIFT_KEY,
  FESTIVAL_TOKEN,
  FESTIVAL_WINS_KEY,
  festivalFloorOf,
  festivalLadder,
  LOCKOUT_TICKS,
  PREP_TICKS,
  prepLeft,
  ROYALE_FLOOR,
  ROYALE_SECTION_IDS,
  scoutedKey,
  SURVIVORS,
  SWIFT_ENTRY_TICKS,
  TOKEN_BONUS,
  TOKEN_EVERY_WINS,
  TOKEN_REGALIA,
  tokenTechniques,
  WAVE_PAUSE_TICKS,
  type FestivalFoe,
  type FestivalPhase,
} from './rules';

export * from './rules';
export * from './validation';

// ---- content ----

const darkRoomWaves = registry(
  s.object({
    id: s.id(),
    foes: s.array(
      s.object({
        monsterId: s.ref('monsters'),
        level: s.number({ integer: true, min: 1, help: 'Pinned: no rolled modifier or rarity.' }),
      }),
      { help: 'Fought together. The last wave is one fighter, fought alone: the dark room’s boss line.' },
    ),
  }),
  darkRoomWavesData,
  'Dark room waves',
);

const issuedWeapons = registry(
  s.object({
    id: s.id({ help: 'The weapon family: the item tag the family’s skill reads.' }),
    skill: s.ref('skills'),
    item: s.optional(s.ref('items', { help: 'The family’s starter, issued plain. None: bare hands.' })),
  }),
  issuedWeaponsData,
  'Issued weapons',
);

const festivalText = registry(textSchema, festivalTextData, 'Festival text');
const TEXT = Object.fromEntries((festivalTextData as TextRecord[]).map((r) => [r.id, r.text]));

export interface IssuedWeaponDef {
  id: string;
  skill: string;
  item?: string;
}

/** The dark room's nine, as four waves. */
export const DARK_ROOM_WAVES: FestivalFoe[][] = (darkRoomWavesData as { foes: FestivalFoe[] }[]).map((w) => w.foes);
/**
 * The issued weapon's table, in tie-break order: the family whose skill is
 * highest, ties broken by kills with that family, then by this order.
 */
export const ISSUED_WEAPONS = issuedWeaponsData as IssuedWeaponDef[];

// ---- slice ----

/** What the door holds while an attempt runs. Plain copies. */
export interface HeldGear {
  equipment: Equipment;
  inventory: ItemInstance[];
  sheathed: ItemInstance | null;
  coating: HeldAlchemy['coating'];
  flasks: HeldAlchemy['flasks'];
  provisions: HeldMaterials;
}

export interface FestivalRun {
  phase: FestivalPhase;
  /** The dark room's next wave, 0-based. */
  wave: number;
  /** The world-clock tick the next dark room wave steps up at. */
  nextAt: number;
  /** The festival's own clock: 0 at the door's opening; runs only on the festival's floors. */
  clock: number;
  /** The festival clock when the climb into the royale began, before the jump. */
  enteredAt?: number;
  held: HeldGear;
  /** The uid of the issued weapon. Absent for bare hands. */
  issued?: number;
  /** Uids the royale lends for the attempt (step 4 port C5). */
  lent?: number[];
  /** This attempt's royale field, drawn at the door. */
  fieldSeed: number;
}

/** What a prestige keeps of the festival: the stronghold stash's tokens and what they bought. */
export interface FestivalLegacy {
  /** Tokens not yet spent. `seed` fixes a token's technique offer. */
  tokens: { seed: number }[];
  /** Stacks of the permanent bonus bought. */
  bonus: number;
  /** Techniques bought, learned canonical at every run's start. */
  techniques: string[];
}

export interface FestivalState {
  run: FestivalRun | null;
  /**
   * Kills this run by the weapon family in hand (`unarmed` with none): the
   * issued weapon's tie-break. Run state. The old build kept them in the run
   * counters `kills:weapon:<family>`; only the door reads them.
   */
  weaponKills: Record<string, number>;
  /** The world-clock tick a lost attempt's lockout ends at; null when floors 15 and 16 are open. */
  lockedUntil: number | null;
  legacy: FestivalLegacy;
}

type F = Ctx<FestivalState>;
type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/** The modifier source of the festival: the attempt's facts and the legacy bonus. */
export const FESTIVAL_SOURCE = 'festival/player';

// ---- the catch-up hold (kernel decision 35) ----

/**
 * Whether the festival holds the player, for one festival slice object:
 * memory, never saved, as the sea's leg end. `catchUp` asks it before every
 * tick, so it does not read the slices. Written when it can change: an
 * attempt starting or ending, and every arrival (`noteHold`). A load and a
 * new run replace the slice object; the first ask after either is a miss and
 * reads the state once.
 */
let holdFor: object | null = null;
let holdNow = false;

type HoldCtx = ReadCtx & { state: DeepReadonly<FestivalState> };

/** Read the hold from the state and keep it for this slice object. */
function noteHold(ctx: HoldCtx): boolean {
  holdFor = ctx.state;
  holdNow = ctx.state.run !== null && onFestivalFloor(ctx);
  return holdNow;
}

/** The kept hold; a miss (another slice object) reads the state once. */
function holdsNow(ctx: HoldCtx): boolean {
  return ctx.state === holdFor ? holdNow : noteHold(ctx);
}

// ---- reads ----

const nowOf = (ctx: ReadCtx): number => totalTicksOf(ctx.read(clock));

/** The attempt in progress, if any. */
export function festivalRun(state: DeepReadonly<FestivalState>): DeepReadonly<FestivalRun> | null {
  return state.run;
}

/** The player stands on floor 15 or 16. */
export function onFestivalFloor(ctx: ReadCtx): boolean {
  return festivalFloorOf(ctx.read(world).spot) !== null;
}

/**
 * The attempt holds the player: an attempt is live and they stand on its
 * floors. While this holds the festival keeps its own clock.
 */
export function festivalHolds(ctx: ReadCtx): boolean {
  return !!ctx.read(system).run && onFestivalFloor(ctx);
}

/** World ticks left on the lockout after a lost attempt; 0 when the floors are open. */
export function lockoutLeft(state: DeepReadonly<FestivalState>, now: number): number {
  return state.lockedUntil === null ? 0 : Math.max(0, state.lockedUntil - now);
}

/**
 * The weapon family the door issues: the family whose skill level is
 * highest, ties broken by kills with that family, then by table order. A
 * save with no weapon skill gets the table's first.
 */
export function issuedWeapon(ctx: ReadCtx): IssuedWeaponDef {
  const held = ctx.read(skills);
  const kills = ctx.read(system).weaponKills;
  let best = ISSUED_WEAPONS[0];
  let bestLevel = -1;
  let bestKills = -1;
  for (const w of ISSUED_WEAPONS) {
    const level = skillLevel(held, w.skill);
    const n = kills[w.id] ?? 0;
    if (level > bestLevel || (level === bestLevel && n > bestKills)) {
      best = w;
      bestLevel = level;
      bestKills = n;
    }
  }
  return best;
}

/** The family of the weapon in hand, as the table names it: `unarmed` with none, '' for a family it does not list. */
export function weaponFamilyInHand(ctx: ReadCtx): string {
  const weapon = ctx.read(items).equipment.weapon;
  if (!weapon) return 'unarmed';
  const tags = itemDefOf(weapon)?.tags ?? [];
  return ISSUED_WEAPONS.find((w) => tags.includes(w.id))?.id ?? '';
}

/** A technique id the registry knows. */
const knownTechnique = (id: string): boolean => !!TECHNIQUES[id];

/** The techniques a token offers now. */
export function offersOf(legacy: DeepReadonly<FestivalLegacy>, seed: number): string[] {
  return tokenTechniques(seed, legacy.techniques, knownTechnique);
}

export type TokenChoice = { kind: 'bonus' } | { kind: 'technique'; id: string } | { kind: 'regalia' };

/** Whether a choice can be made with this token now. */
export function tokenChoiceOpen(legacy: DeepReadonly<FestivalLegacy>, seed: number, choice: TokenChoice): boolean {
  switch (choice.kind) {
    case 'bonus':
      return bonusStacks(legacy.bonus) < TOKEN_BONUS.cap;
    case 'technique':
      return offersOf(legacy, seed).includes(choice.id);
    case 'regalia':
      return !!ITEMS[TOKEN_REGALIA]?.keep;
  }
}

/** Food and potions: a consumable that is eaten or drunk. Cards are read, not carried into a fight. */
const PROVISION_IDS: string[] = Object.values(MATERIALS)
  .filter((def) => !!def.consumable && !isCard(def.consumable))
  .map((def) => def.id);

// The ladder reads the lockout through the counter it sets (old `festivalLocked`).
registerFloorShut((r, floor: FloorDef) => floor.bandId === FESTIVAL_BAND && r.counter(FESTIVAL_SHUT_KEY) >= 1);

// ---- commands and requests ----

/** Spend the token at `index` on one of its three choices. */
export const spendToken = defineCommand<{ index: number; choice: TokenChoice }>('festival/spend-token');

/**
 * DEBUG, not a player action: end the attempt in progress as a royale won.
 * Until port C5 brings the royale this is the only way to a win; the tests
 * of the rewards, the tokens and the hidden title use it. Refused in a
 * production build.
 */
export const debugWin = defineCommand<void>('festival/debug-win');

/** The climb into the royale begins (the world's ride, the `royale` verdict). */
export const beginRoyaleRequest = defineRequest<void, void>('festival/begin-royale');

/** A production build of the page: the debug win is refused. */
const PRODUCTION = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

// ---- the door: holding and returning gear ----

function say(ctx: F, id: string, params: Record<string, unknown> | undefined, kind: string): void {
  ctx.emit(logLine, { msg: fillText(TEXT[id], params), kind });
}

/** Take everything worn and carried off the player, as the door holds it. The old `holdGear`. */
function holdGear(ctx: F): HeldGear {
  const held = ctx.request(holdItems, undefined);
  const sheathed = ctx.request(holdSheathed, undefined);
  const alch = ctx.request(holdAlchemy, undefined);
  const provisions = ctx.request(holdMaterials, { ids: PROVISION_IDS });
  return {
    equipment: held.equipment,
    inventory: held.inventory,
    sheathed,
    coating: alch.coating,
    flasks: alch.flasks,
    provisions,
  };
}

/**
 * Give the held set back (ruling 2026-10-30). The issued weapon and the
 * royale's lent finds are taken back wherever they are. Whatever else the
 * attempt put in the player's hands stays where it is: a find from the hub
 * worn stays worn. Each held piece goes back into its slot if the slot is
 * empty and the piece fits, otherwise into the pack. Flasks and provisions
 * are added to what the attempt left. Returns how many held pieces went to
 * the pack for want of a slot. The old `returnGear`.
 */
function returnGear(ctx: F, run: FestivalRun): number {
  const lent = [...(run.lent ?? []), ...(run.issued !== undefined ? [run.issued] : [])];
  const held = run.held;
  const sheathBumped = ctx.request(returnSheathed, { held: held.sheathed, lent });
  const back = ctx.request(returnItems, {
    held: { equipment: held.equipment, inventory: held.inventory },
    lent,
    extra: sheathBumped ? [sheathBumped] : [],
  });
  ctx.request(returnAlchemy, { held: { flasks: held.flasks, coating: held.coating }, weaponUid: back.weaponUid });
  ctx.request(returnMaterials, held.provisions);
  return back.bumped;
}

/** The log line for held pieces that went to the pack because their slot was taken. */
function reportBumped(ctx: F, count: number): void {
  if (count > 0) say(ctx, 'bumped', { count, plural: count === 1 ? '' : 's' }, 'item');
}

/** Every attempt opens on a full store: the stores' search limits restart, and the scouted flags clear. */
function restockStores(ctx: F): void {
  const counts = ctx.read(counters);
  const reset = (key: string) => {
    if (counterValue(counts, key) !== 0) ctx.emit(setCounter, { key, value: 0 });
  };
  for (const spotId of FESTIVAL_RESTOCK) {
    const spot = SPOTS[spotId];
    if (!spot) continue;
    for (const act of spotActivities(spot)) {
      if (act.kind !== 'search') continue;
      const key = `flag:search:${spot.id}:${act.id}`;
      reset(key);
      for (const r of act.rewards ?? []) reset(`${key}:${r.id}`);
    }
  }
  // The last attempt's survey scouted the last attempt's field.
  for (const id of ROYALE_SECTION_IDS) reset(scoutedKey(id));
}

/**
 * An attempt begins: the door takes the gear, issues the weapon, shuts the
 * dark room's door and restocks the hub. Nothing while one is in progress.
 * The old `startFestival`.
 */
function startFestival(ctx: F): void {
  const state = ctx.state;
  if (state.run) return;
  const held = holdGear(ctx);
  const pick = issuedWeapon(ctx);
  const def = pick.item ? ITEMS[pick.item] : undefined;
  let issued: number | undefined;
  if (def) {
    // A plain issue: no affix, no rune slots, whatever the def could roll.
    const item = ctx.request(grantItem, { defId: def.id, plain: true });
    issued = item.uid;
    ctx.request(equipNow, { uid: item.uid });
  }
  ctx.emit(setCounter, { key: FESTIVAL_DOOR_KEY, value: 0 });
  restockStores(ctx);
  state.run = {
    phase: 'dark',
    wave: 0,
    nextAt: nowOf(ctx) + WAVE_PAUSE_TICKS,
    clock: 0,
    held,
    ...(issued !== undefined ? { issued } : {}),
    // This attempt's royale terrain, fixed now so the hub's survey scouts the field it will open on.
    fieldSeed: Math.floor(ctx.rng.next() * 0x100000000),
  };
  ctx.touch(FESTIVAL_SOURCE);
  noteHold(ctx);
  const pieces = held.inventory.length + Object.values(held.equipment).filter(Boolean).length + (held.sheathed ? 1 : 0);
  say(
    ctx,
    'door_held',
    { pieces, plural: pieces === 1 ? '' : 's', issued: def ? `${def.icon} ${def.name}` : TEXT.bare_hands },
    'danger',
  );
}

// ---- endings ----

function openDoor(ctx: F, run: FestivalRun): void {
  run.phase = 'prep';
  run.clock = 0;
  ctx.emit(setCounter, { key: FESTIVAL_DOOR_KEY, value: 1 });
  say(ctx, 'door_open', undefined, 'quest');
}

/** The gear comes back, the attempt is gone and floors 15 and 16 are shut. The old `loseFestival`. */
function loseFestival(ctx: F): void {
  const state = ctx.state;
  const run = state.run;
  if (!run) return;
  const bumped = returnGear(ctx, run);
  state.run = null;
  state.lockedUntil = nowOf(ctx) + LOCKOUT_TICKS;
  ctx.touch(FESTIVAL_SOURCE);
  noteHold(ctx);
  ctx.emit(setCounter, { key: FESTIVAL_SHUT_KEY, value: 1 });
  // The door shuts with the attempt, not with the next one.
  ctx.emit(setCounter, { key: FESTIVAL_DOOR_KEY, value: 0 });
  say(ctx, 'lost', undefined, 'danger');
  reportBumped(ctx, bumped);
}

/**
 * The royale is won: the gear comes back and the run's win is counted. The
 * first win of a run pays the festival's reward; every later one pays
 * nothing, except that each hundredth win of the run puts a token in the
 * stronghold stash. A win whose climb began within twelve festival hours of
 * the door opening also earns the hidden title; its counter is written here
 * and nowhere else. The old `winFestival`.
 */
export function winFestival(ctx: F): void {
  const state = ctx.state;
  const run = state.run;
  if (!run) return;
  const swift = run.enteredAt !== undefined && run.enteredAt <= SWIFT_ENTRY_TICKS;
  const bumped = returnGear(ctx, run);
  state.run = null;
  ctx.touch(FESTIVAL_SOURCE);
  noteHold(ctx);
  ctx.emit(setCounter, { key: FESTIVAL_DOOR_KEY, value: 0 });
  const before = counterValue(ctx.read(counters), FESTIVAL_WINS_KEY);
  const wins = before + 1;
  ctx.emit(bumpCounter, { key: FESTIVAL_WINS_KEY });
  say(ctx, 'won', undefined, 'quest');
  reportBumped(ctx, bumped);
  const reward = ITEMS[FESTIVAL_REWARD];
  if (before === 0 && reward) {
    ctx.request(grantItem, { defId: reward.id });
    say(ctx, 'reward', { icon: reward.icon, name: reward.name }, 'loot');
  }
  if (wins % TOKEN_EVERY_WINS === 0) {
    state.legacy.tokens.push({ seed: Math.floor(ctx.rng.next() * 0x100000000) >>> 0 });
    say(ctx, 'token', { icon: FESTIVAL_TOKEN.icon, name: FESTIVAL_TOKEN.name, wins }, 'achievement');
  }
  if (swift) {
    ctx.emit(bumpCounter, { key: FESTIVAL_SWIFT_KEY });
    ctx.emit(checkTitles, undefined);
  }
}

/**
 * A live attempt whose player is no longer on its floors is lost: a
 * knockout's ejection, the ladder's forfeit, or anything else that moved
 * them. The win ends the attempt on floor 16 before this can see it.
 */
function settleExit(ctx: F): void {
  if (!ctx.state.run || onFestivalFloor(ctx)) return;
  loseFestival(ctx);
}

/**
 * The climb into the royale begins. Entering before the ten days are out is
 * a time jump: the clock goes to the end of the preparation, and the
 * survivors with it. `enteredAt` keeps the clock as it read before the jump.
 * The old `beginRoyale`.
 */
function beginRoyale(run: FestivalRun): void {
  if (run.phase === 'royale') return;
  run.enteredAt = run.clock;
  run.clock = Math.max(run.clock, PREP_TICKS);
  run.phase = 'royale';
}

/** A won fight at a festival spot: the dark room's next wave (the royale's field is port C5). */
function festivalFightWon(ctx: F, site: string): void {
  const run = ctx.state.run;
  if (!run) return;
  if (run.phase === 'dark' && site === DARK_ROOM) {
    run.wave += 1;
    if (run.wave >= DARK_ROOM_WAVES.length) openDoor(ctx, run);
    else run.nextAt = nowOf(ctx) + WAVE_PAUSE_TICKS;
  }
}

// ---- the ladder and the retreat ----

registerFloorRule({
  ejection: ejectionSpotOf,
  unrouted: (floor) => floor.bandId === FESTIVAL_BAND,
  routesHeld: (reads) => reads.read(system).run !== null,
  ride: (reads, toFloorId): RideVerdict | null => {
    const verdict = festivalLadder(reads.read(system).run, reads.read(world).spot, toFloorId);
    switch (verdict) {
      case null:
        return null;
      case 'shut':
        return { kind: 'refuse', msg: TEXT.door_shut };
      case 'closed':
        return { kind: 'refuse', msg: TEXT.royale_closed };
      case 'forfeit':
        return { kind: 'forfeit', reason: TEXT.forfeit };
      case 'royale':
        return { kind: 'enter', enter: (ctx) => ctx.request(beginRoyaleRequest, undefined) };
    }
  },
});

// ---- the tick ----

/**
 * The next kernel tick on which the lockout can end, for one festival slice
 * object: a cache, never saved, as the sea's leg end. Exact because the
 * clock's tick adds 1 on every kernel tick; a load and a new run replace
 * the slice object and miss.
 */
let liftFor: object | null = null;
let liftAt = 0;

/** The lockout ends on the tick the world clock reaches its end: the floors open again. */
function liftLockout(ctx: F): void {
  const state = ctx.state;
  if (state.lockedUntil === null) return;
  if (state === liftFor && ctx.tick < liftAt) return;
  const now = nowOf(ctx);
  if (now < state.lockedUntil) {
    liftFor = state;
    liftAt = ctx.tick + (state.lockedUntil - now);
    return;
  }
  state.lockedUntil = null;
  ctx.emit(setCounter, { key: FESTIVAL_SHUT_KEY, value: 0 });
}

/**
 * Once per tick, after the activity and the fight. Ends an attempt the
 * player has left, runs the festival's clock, and starts what is due: the
 * next dark room wave, the climb to the royale at day ten. The old
 * `tickFestival`.
 */
function tickFestival(ctx: F): void {
  liftLockout(ctx);
  if (!ctx.state.run) return;
  settleExit(ctx);
  const run = ctx.state.run;
  if (!run) return;
  // The clock starts at the door's opening. `settleExit` has just checked the
  // player is on the festival's floors, the only place it runs.
  if (run.phase !== 'dark') run.clock += 1;
  const w = ctx.read(world);
  if (w.travel || w.recovering) return;
  const fighting = ctx.read(combat).fight !== null;
  if (run.phase === 'dark') {
    // The next wave steps up once the last has fallen and the pause is over.
    if (w.spot !== DARK_ROOM || fighting || nowOf(ctx) < run.nextAt) return;
    const wave = DARK_ROOM_WAVES[run.wave];
    if (wave) ctx.request(startStaged, { site: siteOf(ctx, SPOTS[DARK_ROOM]), members: wave.map((f) => ({ ...f })) });
  } else if (run.phase === 'prep') {
    // Day ten: the survivors are walked up to floor 16, ready or not.
    if (run.clock >= PREP_TICKS && !fighting) ctx.request(rideNow, { floor: ROYALE_FLOOR });
  }
  // The royale's field (`ARENA`) is step 4 port C5.
}

// ---- the source ----

function playerMods(state: DeepReadonly<FestivalState>): StatMod[] {
  const out: StatMod[] = [];
  const run = state.run;
  if (run) {
    out.push(namedFact(FESTIVAL_HOLDS_FACT, 1));
    if (run.issued !== undefined) out.push(namedFact(festivalLentFact(run.issued), 1));
    for (const uid of run.lent ?? []) out.push(namedFact(festivalLentFact(uid), 1));
  }
  // The permanent bonus: stacks taken from tokens, kept through prestige.
  const stacks = bonusStacks(state.legacy.bonus);
  if (stacks > 0) {
    for (const m of TOKEN_BONUS.mods) out.push(contentMod({ ...m, value: m.value * stacks }, `Festival bonus ×${stacks}`, { kind: 'legacy' }));
  }
  return out;
}

// ---- view ----

const TICKS_PER_HOUR = TICKS_PER_GAME_MINUTE * MINUTES_PER_HOUR;
const PREP_DAYS = PREP_TICKS / TICKS_PER_DAY;

export interface FestivalAttemptView {
  phase: FestivalPhase;
  /** The dark room: fighters still standing and waves left. */
  standing: number;
  wavesLeft: number;
  /** The hub: festival day (1-based), of how many, the hour, and the seconds of play to the royale. */
  day: number;
  days: number;
  hour: number;
  secondsLeft: number;
  survivors: number;
  heldPieces: number;
}

/** A control of the stash: the command its button sends, and why it is disabled (null: it can be used). */
export interface StashAction {
  /** `bonus`, `technique:<id>`, `regalia` or `take`. */
  id: string;
  label: string;
  command: Command;
  blocked: string | null;
}

export interface StashTokenView {
  index: number;
  /** The bonus, each technique on offer, the regalia when it can be kept. */
  actions: StashAction[];
  /** No technique is left to offer. */
  noOffers: boolean;
}

export interface FestivalStashView {
  /** Anything to show: a token, a kept item, a bonus stack or a technique bought. */
  shown: boolean;
  token: { name: string; icon: string };
  bonus: { stacks: number; cap: number; text: string };
  techniques: { id: string; name: string; icon: string }[];
  tokens: StashTokenView[];
  /** One take-out control per kept item, in the stash's order (the items system's `stash` rows). */
  takeOut: StashAction[];
  /** Inside an attempt: take-out is shut. */
  holds: boolean;
}

export interface FestivalView {
  /** The attempt, while it holds the player; null otherwise. */
  attempt: FestivalAttemptView | null;
  /** World ticks left on the lockout. */
  lockoutLeft: number;
  stash: FestivalStashView;
}

const bonusText = (): string =>
  TOKEN_BONUS.mods.map((m) => `${m.value >= 0 ? '+' : '−'}${Math.round(Math.abs(m.value) * 100)}% ${m.stat === 'maxHp' ? 'Max HP' : 'Damage'}`).join(', ');

function festivalView(ctx: Ctx<FestivalState>): FestivalView {
  const state = ctx.state;
  const holds = !!state.run && onFestivalFloor(ctx);
  const run = holds ? state.run : null;
  let attempt: FestivalAttemptView | null = null;
  if (run) {
    const held = run.held;
    attempt = {
      phase: run.phase,
      standing: DARK_ROOM_WAVES.slice(run.wave).flat().length,
      wavesLeft: Math.max(0, DARK_ROOM_WAVES.length - run.wave),
      day: Math.min(PREP_DAYS, Math.floor(run.clock / TICKS_PER_DAY) + 1),
      days: PREP_DAYS,
      hour: Math.floor((run.clock % TICKS_PER_DAY) / TICKS_PER_HOUR),
      secondsLeft: Math.ceil(prepLeft(run) / 10),
      survivors: SURVIVORS,
      heldPieces: held.inventory.length + Object.values(held.equipment).filter(Boolean).length + (held.sheathed ? 1 : 0),
    };
  }
  const legacy = state.legacy;
  const stacks = bonusStacks(legacy.bonus);
  const regalia = ITEMS[TOKEN_REGALIA];
  const keptItems = ctx.read(items).stash.length;
  const techniqueRow = (id: string) => ({ id, name: TECHNIQUES[id]?.name ?? id, icon: TECHNIQUES[id]?.icon ?? '' });
  return {
    attempt,
    lockoutLeft: lockoutLeft(state, nowOf(ctx)),
    stash: {
      shown: legacy.tokens.length > 0 || keptItems > 0 || stacks > 0 || legacy.techniques.length > 0,
      token: { ...FESTIVAL_TOKEN },
      bonus: { stacks, cap: TOKEN_BONUS.cap, text: bonusText() },
      techniques: legacy.techniques.map(techniqueRow),
      tokens: legacy.tokens.map((t, index) => {
        const offers = offersOf(legacy, t.seed);
        const actions: StashAction[] = [
          {
            id: 'bonus',
            label: 'Permanent bonus',
            command: spendToken({ index, choice: { kind: 'bonus' } }),
            blocked: tokenChoiceOpen(legacy, t.seed, { kind: 'bonus' }) ? null : `The bonus is at its cap of ${TOKEN_BONUS.cap} stacks.`,
          },
          ...offers.map((id) => {
            const row = techniqueRow(id);
            return {
              id: `technique:${id}`,
              label: `${row.icon} ${row.name}`,
              command: spendToken({ index, choice: { kind: 'technique', id } }),
              blocked: null,
            };
          }),
        ];
        if (regalia && tokenChoiceOpen(legacy, t.seed, { kind: 'regalia' })) {
          actions.push({
            id: 'regalia',
            label: `${regalia.icon} ${regalia.name}`,
            command: spendToken({ index, choice: { kind: 'regalia' } }),
            blocked: null,
          });
        }
        return { index, actions, noOffers: offers.length === 0 };
      }),
      takeOut: Array.from({ length: keptItems }, (_, index) => ({
        id: 'take',
        label: 'Take out',
        command: takeFromStash({ index }),
        blocked: holds ? 'Shut inside a festival attempt: the door holds everything.' : null,
      })),
      holds,
    },
  };
}

// ---- the declaration ----

const system = defineSystem<FestivalState, FestivalView>({
  id: 'festival',
  version: 1,
  migrations,
  initial: () => ({ run: null, weaponKills: {}, lockedUntil: null, legacy: { tokens: [], bonus: 0, techniques: [] } }),
  content: { dark_room_waves: darkRoomWaves, issued_weapons: issuedWeapons, festival_text: festivalText },
  // After combat (10), benches (15), wards (16) and the sea (17): the old
  // `tickFestival` ran after the activity and the harbor's convoys.
  order: 18,

  modifiers: [
    {
      id: FESTIVAL_SOURCE,
      collect: (ctx) => (ctx.entity === PLAYER ? playerMods(ctx.state) : []),
    },
  ],

  tick: tickFestival,

  // The old offline catch-up stopped the moment the festival held the player
  // (an attempt live, the player on its floors) and banked the rest of the
  // absence as bonus time, 1:1 up to its cap. Kernel decision 35.
  catchUpHold: {
    holds: holdsNow,
    held: (ctx, ticksLeft) => ctx.emit(bankTicks, { ticks: ticksLeft }),
  },

  commands: [
    handle(spendToken, (ctx, { index, choice }) => {
      const legacy = ctx.state.legacy;
      const token = legacy.tokens[index];
      if (!token) return skipped(`the stash holds no token at index ${index}`);
      if (!tokenChoiceOpen(legacy, token.seed, choice)) {
        return skipped(
          choice.kind === 'bonus'
            ? `the festival bonus is at its cap of ${TOKEN_BONUS.cap} stacks`
            : choice.kind === 'technique'
              ? `this token does not offer "${choice.id}"`
              : 'the regalia cannot be kept in the stash',
        );
      }
      legacy.tokens.splice(index, 1);
      if (choice.kind === 'bonus') {
        legacy.bonus = bonusStacks(legacy.bonus) + 1;
        ctx.touch(FESTIVAL_SOURCE);
        say(ctx, 'stash_bonus', { stacks: legacy.bonus, cap: TOKEN_BONUS.cap }, 'achievement');
      } else if (choice.kind === 'technique') {
        const def = TECHNIQUES[choice.id];
        legacy.techniques.push(choice.id);
        say(ctx, 'stash_technique', { icon: def.icon, name: def.name }, 'achievement');
        ctx.request(learnRequest, { technique: choice.id, form: 'canonical' });
      } else {
        const def = ITEMS[TOKEN_REGALIA];
        ctx.request(grantItem, { defId: TOKEN_REGALIA, stash: true });
        say(ctx, 'stash_regalia', { icon: def.icon, name: def.name }, 'achievement');
      }
      return OK;
    }),

    handle(debugWin, (ctx) => {
      if (PRODUCTION) return skipped('the debug win is refused in a production build');
      if (!ctx.state.run) return skipped('no festival attempt is in progress');
      winFestival(ctx);
      return OK;
    }),
  ],

  requests: [
    answer(beginRoyaleRequest, (ctx) => {
      if (ctx.state.run) beginRoyale(ctx.state.run);
    }),
  ],

  events: [
    // Kills are counted by the weapon family in hand: the issued weapon's tie-break.
    on(enemyKilled, (ctx) => {
      const family = weaponFamilyInHand(ctx);
      if (family) ctx.state.weaponKills[family] = (ctx.state.weaponKills[family] ?? 0) + 1;
    }),
    on(fightWon, (ctx, { payload }) => festivalFightWon(ctx, payload.site)),
    // An attempt starts by arriving in the dark room; any other arrival off the floors ends one.
    on(arrived, (ctx, { payload }) => {
      if (payload.spot === DARK_ROOM && !ctx.state.run) startFestival(ctx);
      settleExit(ctx);
      // The floor stood on may have changed: the hold follows it.
      noteHold(ctx);
    }),
  ],

  // The legacy carries; the attempt and the lockout are run state. A
  // keep-marked piece held at the door goes back to the stash, after the
  // pieces the items system returned there; the techniques bought are known
  // from the first tick (old `carriedStash`, `applyFestivalLegacy`).
  newRun: (ctx, previous) => {
    const old = previous(system);
    ctx.state.legacy = JSON.parse(JSON.stringify(old.legacy)) as FestivalLegacy;
    const held = old.run?.held;
    if (held) {
      for (const item of [...held.inventory, ...Object.values(held.equipment), held.sheathed]) {
        if (item && keepMarked(item)) ctx.request(stashItem, { item: JSON.parse(JSON.stringify(item)) as ItemInstance });
      }
    }
    for (const id of ctx.state.legacy.techniques) {
      if (TECHNIQUES[id]) ctx.request(learnRequest, { technique: id, form: 'canonical' });
    }
    ctx.touch(FESTIVAL_SOURCE);
  },

  view: festivalView,
});

export default system;
