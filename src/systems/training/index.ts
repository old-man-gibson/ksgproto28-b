/**
 * Training spots: a keeper who looks after beginners (`SpotDef.healBetweenBouts`)
 * and, now and then, dares them (`SpotDef.dare`). The Cages are the first.
 * Port of the old `systems/training.ts`, its log lines and `DareModal.svelte`.
 * See README.md in this folder.
 *
 * Old note: a fresh character hunting the Cages was knocked out on the first
 * visit in 35 of 40 seeds with the rusty sword (playtest 2026-10-17), because
 * a hunt rolls the next bout with no recovery and a bleed rides along.
 * Healing between bouts removes the chain; each bout keeps its own risk.
 *
 * The dare's state is counters, as the old build kept it in stats: the
 * question waiting is `dare:<spot>:pending`, the wins toward the next dare
 * `dare:<spot>:wins`, the hold `hold:dare`, the keeper's patches
 * `training:patched`. So the slice is empty.
 *
 * The dare holds play (kernel decision 36): while it waits, `kernel.tick()`
 * runs no system and banks each tick as bonus time, and catch-up stops and
 * banks the rest (decision 35). Commands still run, so the answer gets
 * through and lifts the hold.
 */
import {
  defineCommand,
  defineSystem,
  handle,
  on,
  OK,
  PLAYER,
  registry,
  skipped,
  TPS,
  type Command,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import attributes, { ATTRIBUTE_LIST } from '../attributes';
import bonus, { bankTicks } from '../bonus';
import { fightWon, startStaged } from '../combat';
import counters, { bumpCounter, clearCounter, counterValue, setCounter } from '../counters';
import items, { SIZE_LADDER, wielderRank } from '../items';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { MONSTERS, monsterSizeRank } from '../monsters';
import resources, { healNow, resourceValue } from '../resources';
import { statOf } from '../stats';
import statuses, { heldOf, removeStatus, STATUSES } from '../statuses';
import world, { siteOf, SPOTS, type SpotDef } from '../world';
import textData from './content/training_text.json';
import { migrations } from './migrations';

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const trainingText = registry(textSchema, textData, 'Training text');

/** The one counter the hold reads: 1 while any dare waits for an answer. */
export const HOLD_KEY = 'hold:dare';
export const pendingKey = (spotId: string): string => `dare:${spotId}:pending`;
export const winsKey = (spotId: string): string => `dare:${spotId}:wins`;
/** How many times the keeper has healed you; the first time carries the line. */
export const PATCHED_KEY = 'training:patched';

/** The spots that carry a dare, in content order (the old loop over `SPOTS`). */
const DARE_SPOTS: readonly SpotDef[] = Object.values(SPOTS).filter((spot) => spot.dare);

export type TrainingState = Record<string, never>;

type T = Ctx<TrainingState>;
type ReadCtx = { read<S>(system: SystemDef<S, any>): DeepReadonly<S> };

const count = (ctx: ReadCtx, key: string): number => counterValue(ctx.read(counters), key);

/** The six attribute levels added up: the "level" a keeper judges you by. */
export function attrTotal(ctx: ReadCtx): number {
  const attrs = ctx.read(attributes).attrs;
  return ATTRIBUTE_LIST.reduce((sum, a) => sum + (attrs[a.id]?.level ?? 0), 0);
}

/** Whether this spot's keeper still treats the player as a beginner. */
export function keeperTends(ctx: ReadCtx, spot: DeepReadonly<SpotDef>): boolean {
  return !!spot.healBetweenBouts && attrTotal(ctx) <= spot.healBetweenBouts.maxAttrTotal;
}

/** Whether the dare's monster has been beaten (then the keeper stops asking). */
export function dareBeaten(ctx: ReadCtx, spot: DeepReadonly<SpotDef>): boolean {
  return !!spot.dare && count(ctx, `kills:${spot.dare.monsterId}`) >= 1;
}

// ---- the hold of play ----

type HoldCtx = Ctx<TrainingState>;

/**
 * Whether a dare holds play: the hold counter, with its dare still waiting.
 * The kernel keeps the answer (decision 36) and asks again when this system
 * says the hold changed (`ctx.holdChanged()`: a dare posed, a dare
 * answered), after the events of that step are delivered, and after a load
 * or a new run. A hold whose dare has vanished (content renamed under a
 * save) is dropped rather than left to freeze a game with no question on
 * screen: the old `dareHolds`.
 */
function dareHolds(ctx: HoldCtx): boolean {
  if (!holdingForDare(ctx)) return false;
  if (pendingDare(ctx)) return true;
  ctx.emit(clearCounter, { key: HOLD_KEY });
  return false;
}

/** True while a dare is waiting for an answer: play is held. */
export function holdingForDare(ctx: ReadCtx): boolean {
  return count(ctx, HOLD_KEY) > 0;
}

/** The spot whose dare is waiting, if any. */
export function pendingDare(ctx: ReadCtx): SpotDef | null {
  if (!holdingForDare(ctx)) return null;
  for (const spot of DARE_SPOTS) {
    if (count(ctx, pendingKey(spot.id)) > 0) return spot;
  }
  return null;
}

/** Wins left before the keeper dares you again (null when no dare is coming). */
export function winsUntilDare(ctx: ReadCtx, spot: DeepReadonly<SpotDef>): number | null {
  if (!spot.dare || dareBeaten(ctx, spot) || !keeperTends(ctx, spot)) return null;
  return Math.max(0, spot.dare.every - count(ctx, winsKey(spot.id)));
}

// ---- the keeper ----

/** Heal to full and drop every condition that deals damage over time. */
function patchUp(ctx: T, cap: number): void {
  const healed = ctx.request(healNow, { amount: statOf(ctx, 'maxHp') });
  let did = (healed?.healed ?? 0) > 0;
  for (const s of [...heldOf(ctx.read(statuses), PLAYER)]) {
    const def = STATUSES[s.id];
    if (!def?.dot || def.hidden) continue;
    ctx.request(removeStatus, { entity: PLAYER, id: s.id });
    did = true;
  }
  if (!did) return;
  const first = count(ctx, PATCHED_KEY) === 0;
  ctx.emit(bumpCounter, { key: PATCHED_KEY });
  ctx.emit(logLine, { msg: first ? fillText(TEXT.patched_first, { cap }) : TEXT.patched, kind: 'skill' });
}

function onWin(ctx: T, spotId: string, forced: boolean): void {
  const spot = SPOTS[spotId];
  if (!spot || !keeperTends(ctx, spot)) return;
  patchUp(ctx, spot.healBetweenBouts!.maxAttrTotal);
  // The dare's own fight is forced; it never counts toward the next dare.
  if (!spot.dare || forced || dareBeaten(ctx, spot)) return;
  const wins = count(ctx, winsKey(spot.id)) + 1;
  ctx.emit(bumpCounter, { key: winsKey(spot.id) });
  if (wins < spot.dare.every) return;
  ctx.emit(setCounter, { key: winsKey(spot.id), value: 0 });
  ctx.emit(setCounter, { key: pendingKey(spot.id), value: 1 });
  ctx.emit(setCounter, { key: HOLD_KEY, value: 1 });
  ctx.holdChanged();
  ctx.emit(logLine, {
    msg: fillText(TEXT.dare_held, { name: MONSTERS[spot.dare.monsterId]?.name ?? spot.dare.monsterId }),
    kind: 'danger',
  });
}

// ---- the answer ----

/**
 * Answer the waiting dare. Accepting starts the staged, unfleeable fight
 * where the player stands; declining lets the cages carry on as before.
 * Either way the hold lifts. The old `answerDare`.
 */
export const answerDare = defineCommand<{ accept: boolean }>('training/answer-dare');

function answer(ctx: T, accept: boolean) {
  const spot = pendingDare(ctx);
  // The hold lifts first, whatever follows (the old `delete stats[HOLD_KEY]`).
  ctx.holdChanged();
  if (count(ctx, HOLD_KEY) !== 0) ctx.emit(clearCounter, { key: HOLD_KEY });
  if (!spot?.dare) return skipped('no dare is waiting');
  ctx.emit(clearCounter, { key: pendingKey(spot.id) });
  const name = MONSTERS[spot.dare.monsterId]?.name ?? spot.dare.monsterId;
  if (accept && ctx.read(world).spot === spot.id) {
    ctx.emit(logLine, { msg: fillText(TEXT.dare_taken, { name }), kind: 'danger' });
    ctx.request(startStaged, {
      site: siteOf(ctx, spot),
      members: [{ monsterId: spot.dare.monsterId, level: spot.dare.level }],
    });
    return OK;
  }
  ctx.emit(logLine, { msg: fillText(TEXT.dare_declined, { name, every: spot.dare.every }), kind: 'info' });
  return OK;
}

// ---- view ----

/** One control of the dare window: the command it sends. */
export interface TrainingAction {
  /** `fight` (take the dare) or `flee` (pass on it). */
  id: 'fight' | 'flee';
  label: string;
  command: Command;
}

/** The waiting dare as the window shows it (old `DareModal.svelte`). */
export interface DareView {
  spot: { id: string; name: string; icon: string };
  /** The keeper's words (`SpotDef.dare.desc`). */
  desc: string;
  foe: { name: string; icon: string; level: number };
  /** The foe's size against the player's body. */
  sizeLine: string;
  /** Resistances as the bestiary reads them: what it shrugs off, what it takes extra. */
  takesLess: string[];
  takesMore: string[];
  hp: number;
  maxHp: number;
  /** Bonus time banked, as the old header read it. */
  banked: string;
  every: number;
}

export interface TrainingView {
  dare: DareView | null;
  actions: TrainingAction[];
}

/** The old `msToTime` of a tick count. */
function ticksToTime(ticks: number): string {
  const s = Math.floor(ticks / TPS);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function dareView(ctx: ReadCtx & DerivedReads, spot: SpotDef): DareView {
  const dare = spot.dare!;
  const def = MONSTERS[dare.monsterId];
  const rank = monsterSizeRank(dare.monsterId);
  const steps = rank - wielderRank(ctx.read(items));
  const size = SIZE_LADDER[rank] ?? 'medium';
  const sizeLine =
    steps > 0
      ? `${size}, ${steps} size step${steps === 1 ? '' : 's'} above you`
      : steps < 0
        ? `${size}, ${-steps} size step${steps === -1 ? '' : 's'} below you`
        : `${size}, your size`;
  const entries = Object.entries(def?.resistances ?? {}).filter(([, v]) => v);
  return {
    spot: { id: spot.id, name: spot.name, icon: spot.icon },
    desc: dare.desc,
    foe: { name: def?.name ?? dare.monsterId, icon: def?.icon ?? '', level: dare.level },
    sizeLine,
    takesLess: entries.filter(([, v]) => v! > 0).map(([t, v]) => `${t} ${Math.round(v! * 100)}%`),
    takesMore: entries.filter(([, v]) => v! < 0).map(([t, v]) => `${t} +${Math.round(-v! * 100)}%`),
    hp: Math.floor(resourceValue(ctx.read(resources), 'hp')),
    maxHp: Math.floor(statOf(ctx, 'maxHp')),
    banked: ticksToTime(ctx.read(bonus).banked),
    every: dare.every,
  };
}

// ---- the declaration ----

const training = defineSystem<TrainingState, TrainingView>({
  id: 'training',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { training_text: trainingText },

  // While a dare waits, a tick moves nothing and is banked as bonus time
  // (the old `Game.tick`: `bankTick` and return). Decision 36.
  playHold: {
    holds: dareHolds,
    held: (ctx) => ctx.emit(bankTicks, { ticks: 1 }),
  },
  // Offline, the old catch-up went through the same tick, banking each held
  // tick: stopping on the first held tick and banking the rest gives the same
  // bank. Decision 35. Catch-up asks only this, once per tick (decision 36).
  catchUpHold: {
    holds: dareHolds,
    held: (ctx, ticksLeft) => ctx.emit(bankTicks, { ticks: ticksLeft }),
  },

  commands: [handle(answerDare, (ctx, { accept }) => answer(ctx, accept))],

  events: [on(fightWon, (ctx, { payload }) => onWin(ctx, payload.site, payload.forced))],

  view: (ctx) => {
    const spot = pendingDare(ctx);
    if (!spot) return { dare: null, actions: [] };
    const view = dareView(ctx, spot);
    return {
      dare: view,
      actions: [
        { id: 'fight', label: `⚔️ Fight the ${view.foe.name}`, command: answerDare({ accept: true }) },
        { id: 'flee', label: '🏃 Flee: back to normal cages', command: answerDare({ accept: false }) },
      ],
    };
  },
});

export default training;
