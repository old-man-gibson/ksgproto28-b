/**
 * Meals: dish slots and claims. Port of old `systems/meals.ts`. At most
 * `dishLimit` dishes are active; each dish is one slot holding one claim per
 * condition it gave, each claim a dose with a clock of its own. See README.md.
 *
 * The old `Game.advance` ran two steps here: the hand-off before anything
 * moved (`meals/hand-off`, asked by `cooking`'s early tick, which also states
 * the clock rate of the tick) and the claim clocks after the conditions ticked
 * (this system's tick, order 50).
 */
import {
  answer,
  defineRequest,
  defineSystem,
  on,
  PLAYER,
  registry,
  type Ctx,
  type DeepReadonly,
} from '../../kernel';
import { flaskUsed } from '../alchemy';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { MATERIAL_LIST, MATERIALS, QUALITY_TIERS, qualityMult, qualityRank, type QualityTier } from '../materials';
import statuses, {
  heldOf,
  isHarmful,
  removeStatus,
  setDose,
  STATUSES,
  type StatusApplication,
  type StatusInstance,
} from '../statuses';
import textData from './content/meals_text.json';
import { migrations } from './migrations';

const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const mealsText = registry(textSchema, textData, 'Meals text');
const say = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

// ---- slice ----

/** One dose of one condition, with its own clock. */
export interface MealClaim {
  id: string;
  dose: number;
  /** Ticks left; null: no clock. */
  left: number | null;
  /** The grade of the helping that gave it. */
  grade?: QualityTier;
}

export interface MealSlot {
  dish: string;
  /** The best grade among its live claims when it was last eaten. */
  quality: QualityTier;
  claims: MealClaim[];
}

export interface MealsState {
  /** The dish slots, oldest first. The old `state.meals`. */
  slots: MealSlot[];
  /** Claims of sources that are not dishes. The old `state.foreignClaims`. */
  foreign: MealClaim[];
  /** How far the conditions' clocks advance this tick, read before anything moved. */
  rate: number;
}

type State = DeepReadonly<MealsState>;
type Held = readonly DeepReadonly<StatusInstance>[];

/** How many dishes can be active at once. */
export const MAX_ACTIVE_DISHES = 3;

/** The dish limit. A constant; the one function a later rule would raise. */
export function dishLimit(): number {
  return MAX_ACTIVE_DISHES;
}

export function isNourishing(id: string): boolean {
  const def = STATUSES[id];
  return !!def && !isHarmful(def);
}

/** The condition ids some food gives that do not hurt: the ones a dish slot can hold. */
let dishIds: Set<string> | null = null;
function dishConditionIds(): Set<string> {
  if (dishIds) return dishIds;
  const ids = new Set<string>();
  for (const def of MATERIAL_LIST) {
    const spec = def.consumable;
    if (!spec?.food) continue;
    for (const app of [...(spec.grants ?? []), ...(spec.signature ?? [])]) {
      if (isNourishing(app.id)) ids.add(app.id);
    }
  }
  dishIds = ids;
  return ids;
}

// ---- claims ----

const live = (c: DeepReadonly<MealClaim>): boolean => c.left === null || c.left > 0;

function heldStatus(held: Held, id: string): DeepReadonly<StatusInstance> | undefined {
  for (let i = 0; i < held.length; i++) if (held[i].id === id) return held[i];
  return undefined;
}

const longerThan = (a: number | null, b: number | null): boolean => (a === null ? b !== null : b !== null && a > b);

function lead(best: DeepReadonly<MealClaim> | undefined, c: DeepReadonly<MealClaim>): DeepReadonly<MealClaim> {
  if (!best || c.dose > best.dose || (c.dose === best.dose && longerThan(c.left, best.left))) return c;
  return best;
}

/**
 * The leading live claim on a condition, the dishes' and the other sources',
 * or undefined. `exclude` leaves one claim out; `survive` counts only claims
 * still live after that many more ticks.
 */
function leadOn(
  state: State,
  id: string,
  exclude?: DeepReadonly<MealClaim>,
  survive = 0,
): DeepReadonly<MealClaim> | undefined {
  let best: DeepReadonly<MealClaim> | undefined;
  for (let i = 0; i < state.slots.length; i++) {
    const claims = state.slots[i].claims;
    for (let j = 0; j < claims.length; j++) {
      const c = claims[j];
      if (c.id === id && c !== exclude && (c.left === null || c.left > survive)) best = lead(best, c);
    }
  }
  for (let j = 0; j < state.foreign.length; j++) {
    const c = state.foreign[j];
    if (c.id === id && c !== exclude && (c.left === null || c.left > survive)) best = lead(best, c);
  }
  return best;
}

const longer = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.max(a, b));

/** The conditions some dish slot holds a claim on. */
function dishConditions(state: State): string[] {
  const ids: string[] = [];
  for (const slot of state.slots) for (const c of slot.claims) if (!ids.includes(c.id)) ids.push(c.id);
  return ids;
}

const modelled = (id: string): boolean => STATUSES[id]?.stacking.mode === 'highest';

type M = Ctx<MealsState>;

const playerHeld = (ctx: M): Held => heldOf(ctx.read(statuses), PLAYER);

/** Put a held condition at its leading claim's dose and remaining time. The old `reconcile`. */
function reconcile(ctx: M, id: string, ids: readonly string[] | null): void {
  if (!modelled(id) || (ids !== null && !ids.includes(id))) return;
  const inst = heldStatus(playerHeld(ctx), id);
  const top = inst ? leadOn(ctx.state, id) : undefined;
  if (!inst || !top) return;
  if (inst.intensity !== top.dose || inst.ticksLeft !== top.left) {
    ctx.request(setDose, { entity: PLAYER, id, intensity: top.dose, ticksLeft: top.left });
  }
}

/** A dish in a slot, with the time it has left. */
export interface ActiveMeal {
  slot: DeepReadonly<MealSlot>;
  /** Ticks until its last claim runs out; null when one has no clock. */
  ticksLeft: number | null;
  /** The best grade among its live claims: the grade still in effect. */
  quality: QualityTier;
}

/** The slots with a live claim on a condition still held, oldest first. The old `activeMeals`. */
export function activeMeals(state: State, held: Held): ActiveMeal[] {
  const out: ActiveMeal[] = [];
  for (const slot of state.slots) {
    let any = false;
    let left: number | null = 0;
    let quality: QualityTier | undefined;
    for (const c of slot.claims) {
      if (!live(c) || !heldStatus(held, c.id)) continue;
      any = true;
      if (c.left === null) left = null;
      else if (left !== null) left = Math.max(left, c.left);
      const grade = c.grade ?? slot.quality;
      if (!quality || qualityRank(grade) > qualityRank(quality)) quality = grade;
    }
    if (any) out.push({ slot, ticksLeft: left, quality: quality ?? slot.quality });
  }
  return out;
}

function leastTimeLeft(meals: ActiveMeal[]): ActiveMeal | undefined {
  let pick: ActiveMeal | undefined;
  for (const m of meals) {
    const left = m.ticksLeft ?? Infinity;
    if (!pick || left < (pick.ticksLeft ?? Infinity)) pick = m;
  }
  return pick;
}

/** The dish eating `dish` would push out, or undefined. The old `mealToReplace`. */
export function mealToReplace(state: State, held: Held, dish: string): ActiveMeal | undefined {
  const meals = activeMeals(state, held);
  if (meals.some((m) => m.slot.dish === dish)) return undefined;
  if (meals.length < dishLimit()) return undefined;
  return leastTimeLeft(meals);
}

function anyLapsed(state: State, held: Held): boolean {
  for (const slot of state.slots) {
    for (const c of slot.claims) if (!live(c) || !heldStatus(held, c.id)) return true;
  }
  for (const c of state.foreign) if (!live(c) || !heldStatus(held, c.id)) return true;
  return false;
}

/** Drop claims that ran out or whose condition is gone, then empty slots. The old `pruneClaims`. */
function pruneClaims(ctx: M): void {
  const held = playerHeld(ctx);
  if (!anyLapsed(ctx.state, held)) return;
  const kept: MealSlot[] = [];
  for (const slot of ctx.state.slots) {
    const still = slot.claims.filter((c) => live(c) && heldStatus(held, c.id) !== undefined);
    if (still.length > 0) kept.push(still.length === slot.claims.length ? slot : { ...slot, claims: still });
  }
  ctx.state.slots = kept;
  if (ctx.state.foreign.length > 0) {
    ctx.state.foreign = ctx.state.foreign.filter((c) => live(c) && heldStatus(held, c.id) !== undefined);
  }
}

/** Record what a flask gave, as claims of a source that is not a dish. The old `noteForeignDoses`. */
function noteForeignDoses(ctx: M, doses: readonly DeepReadonly<StatusApplication>[]): void {
  const ours = dishConditionIds();
  for (const app of doses) {
    const def = STATUSES[app.id];
    if (!def || !ours.has(app.id) || !heldStatus(playerHeld(ctx), app.id)) continue;
    const span = app.duration === 'permanent' ? null : (app.duration ?? def.duration ?? null);
    ctx.state.foreign.push({ id: app.id, dose: app.intensity ?? 1, left: span as number | null });
    reconcile(ctx, app.id, dishConditions(ctx.state));
  }
}

/** One dose of a dish that landed. */
export interface MealLanding {
  id: string;
  dose: number;
  /** The dose's full lifetime in ticks; null when it has none. */
  ticks: number | null;
  /** The condition as it stood before the dish's first dose; null when not held. */
  before: { intensity: number; ticksLeft: number | null } | null;
}

function dominates(b: MealClaim, a: MealClaim, bLater: boolean): boolean {
  if (b.id !== a.id || b.dose < a.dose || longerThan(a.left, b.left)) return false;
  return b.dose > a.dose || longerThan(b.left, a.left) || bLater;
}

/** Put a dish just eaten into its slot and make room. The old `recordMeal`. */
function recordMeal(
  ctx: M,
  dish: string,
  quality: QualityTier,
  landings: readonly DeepReadonly<MealLanding>[],
  victim?: string,
): void {
  const nourishing = landings.filter((l) => isNourishing(l.id));
  if (nourishing.length === 0) return;
  pruneClaims(ctx);
  const state = ctx.state;
  const held = playerHeld(ctx);

  const prior = state.slots.find((s) => s.dish === dish);
  const fresh: MealClaim[] = [];
  for (const l of nourishing) {
    const have = fresh.find((c) => c.id === l.id);
    if (have) {
      have.dose = Math.max(have.dose, l.dose);
      have.left = longer(have.left, l.ticks);
    } else {
      fresh.push({ id: l.id, dose: l.dose, left: l.ticks, grade: quality });
    }
  }
  // A condition held before the dish that no claim accounts for is some other source's.
  for (const l of nourishing) {
    if (!l.before || leadOn(state, l.id)) continue;
    state.foreign.push({ id: l.id, dose: l.before.intensity, left: l.before.ticksLeft });
  }
  const merged: MealClaim[] = [];
  for (const c of prior?.claims ?? []) {
    if (live(c) && heldStatus(held, c.id)) merged.push({ ...c, grade: c.grade ?? prior!.quality });
  }
  for (const c of fresh) merged.push(c);
  const claims = merged.filter((a, i) => !merged.some((b, j) => j !== i && dominates(b, a, j > i)));
  let best = claims[0].grade ?? quality;
  for (const c of claims) if (qualityRank(c.grade ?? quality) > qualityRank(best)) best = c.grade ?? quality;
  const slot: MealSlot = { dish, quality: best, claims };
  state.slots = [...state.slots.filter((s) => s.dish !== dish), slot];

  // Make room. The dish just eaten is never the one that goes.
  const by = `${QUALITY_TIERS[quality].name} ${MATERIALS[dish]?.name ?? dish}`;
  let named = victim;
  for (;;) {
    const meals = activeMeals(state, playerHeld(ctx));
    if (meals.length <= dishLimit()) break;
    const rest = meals.filter((m) => m.slot.dish !== dish);
    const chosen = rest.find((m) => m.slot.dish === named) ?? leastTimeLeft(rest);
    named = undefined;
    if (!chosen) break;
    release(ctx, chosen, by);
  }
  const ids = dishConditions(state);
  for (const c of claims) reconcile(ctx, c.id, ids);
}

/** Take a dish out of its slot. The old `release`. */
function release(ctx: M, meal: ActiveMeal, by: string): void {
  const slot = meal.slot;
  ctx.state.slots = ctx.state.slots.filter((s) => s.dish !== slot.dish);
  const ended: string[] = [];
  const kept: string[] = [];
  const seen: string[] = [];
  for (const claim of slot.claims) {
    if (seen.includes(claim.id) || !heldStatus(playerHeld(ctx), claim.id)) continue;
    seen.push(claim.id);
    const name = STATUSES[claim.id]?.name ?? claim.id;
    if (leadOn(ctx.state, claim.id)) {
      reconcile(ctx, claim.id, null);
      kept.push(name);
    } else {
      ctx.request(removeStatus, { entity: PLAYER, id: claim.id });
      ended.push(name);
    }
  }
  const detail = [ended.length ? say('ended', { list: ended.join(', ') }) : '', kept.length ? say('kept', { list: kept.join(', ') }) : '']
    .filter(Boolean)
    .join(' ');
  ctx.emit(logLine, {
    msg: say('replaced', {
      grade: QUALITY_TIERS[meal.quality].name,
      name: MATERIALS[slot.dish]?.name ?? slot.dish,
      by,
      limit: dishLimit(),
      detail,
    }),
    kind: 'action',
  });
}

function anyDue(state: State, rate: number): boolean {
  for (const slot of state.slots) {
    for (const c of slot.claims) if (c.left !== null && c.left <= rate) return true;
  }
  for (const c of state.foreign) if (c.left !== null && c.left <= rate) return true;
  return false;
}

/** Before the conditions tick: hand a lapsing lead to the next claim. The old `handOffMeals`. */
function handOffMeals(ctx: M, rate: number): void {
  const state = ctx.state;
  if (rate <= 0 || state.slots.length === 0 || !anyDue(state, rate)) return;
  for (const id of dishConditions(state)) {
    if (!modelled(id)) continue;
    const inst = heldStatus(playerHeld(ctx), id);
    const top = inst ? leadOn(state, id) : undefined;
    if (!inst || !top || top.left === null || top.left - rate > 0) continue;
    const next = leadOn(state, id, top, rate);
    if (!next) continue;
    ctx.request(setDose, { entity: PLAYER, id, intensity: next.dose, ticksLeft: next.left, alwaysPeak: true });
  }
}

/** After the conditions ticked: run the claim clocks, prune, re-derive. The old `tickMealClaims`. */
function tickMealClaims(ctx: M, rate: number): void {
  const state = ctx.state;
  if (state.slots.length === 0 && state.foreign.length === 0) return;
  if (rate > 0) {
    for (const slot of state.slots) for (const c of slot.claims) if (c.left !== null) c.left -= rate;
    for (const c of state.foreign) if (c.left !== null) c.left -= rate;
  }
  pruneClaims(ctx);
  if (state.slots.length === 0) return;
  for (const id of dishConditions(state)) {
    if (!modelled(id)) continue;
    const inst = heldStatus(playerHeld(ctx), id);
    const top = inst ? leadOn(state, id) : undefined;
    if (!inst || !top) continue;
    if (inst.intensity > top.dose || (inst.ticksLeft !== null && top.left !== null && inst.ticksLeft > top.left)) {
      // Nobody recorded this: take the instance as it stands as a claim of its own.
      state.foreign.push({ id, dose: inst.intensity, left: inst.ticksLeft });
      continue;
    }
    if (inst.intensity !== top.dose || inst.ticksLeft !== top.left) {
      ctx.request(setDose, { entity: PLAYER, id, intensity: top.dose, ticksLeft: top.left });
    }
  }
}

// ---- requests ----

/** Record a dish just eaten. Asked by the eater of `cooking`. */
export const recordMealRequest = defineRequest<
  { dish: string; quality: QualityTier; landings: MealLanding[]; victim?: string },
  void
>('meals/record');
/** The hand-off before anything moves, and the clock rate of this tick. Asked by `cooking`'s tick. */
export const handOffRequest = defineRequest<{ rate: number }, void>('meals/hand-off');
/** Record doses of a source that is not a dish. */
export const noteForeignRequest = defineRequest<{ doses: StatusApplication[] }, void>('meals/note-foreign');

// ---- view ----

export interface MealView {
  /** The slot in the shape the dish list reads (`cooking` `MealInput`). */
  slot: { dish: string; quality: QualityTier; claims: { id: string; left: number | null }[] };
  dish: string;
  name: string;
  icon: string;
  quality: QualityTier;
  grade: string;
  ticksLeft: number | null;
}

export interface MealsView {
  limit: number;
  active: MealView[];
}

const meals = defineSystem<MealsState, MealsView>({
  id: 'meals',
  version: 1,
  migrations,
  initial: () => ({ slots: [], foreign: [], rate: 1 }),
  order: 50,
  content: { meals_text: mealsText },

  tick: (ctx) => tickMealClaims(ctx, ctx.state.rate),

  requests: [
    answer(recordMealRequest, (ctx, p) => recordMeal(ctx, p.dish, p.quality, p.landings, p.victim)),
    answer(handOffRequest, (ctx, { rate }) => {
      ctx.state.rate = rate;
      handOffMeals(ctx, rate);
    }),
    answer(noteForeignRequest, (ctx, { doses }) => noteForeignDoses(ctx, doses)),
  ],

  events: [on(flaskUsed, (ctx, { payload }) => noteForeignDoses(ctx, payload.grants))],

  view: (ctx): MealsView => ({
    limit: dishLimit(),
    active: activeMeals(ctx.state, heldOf(ctx.read(statuses), PLAYER)).map((m) => ({
      slot: { dish: m.slot.dish, quality: m.slot.quality, claims: m.slot.claims.map((c) => ({ id: c.id, left: c.left })) },
      dish: m.slot.dish,
      name: MATERIALS[m.slot.dish]?.name ?? m.slot.dish,
      icon: MATERIALS[m.slot.dish]?.icon ?? '',
      quality: m.quality,
      grade: QUALITY_TIERS[m.quality].name,
      ticksLeft: m.ticksLeft,
    })),
  }),
});

/** Whether a grade is spoiled (a negative multiplier). */
export const spoiledGrade = (q: QualityTier): boolean => qualityMult(q) <= 0;

export default meals;
