/**
 * Cooking: the five kitchen benches, the dish a basket makes and its grade,
 * the cutting board, the Cook's Book and Cook's Notes, and eating food (now,
 * or queued after a fight or a knockout). Port of old `systems/cooking.ts`,
 * `cookbook.ts`, `eating.ts` and the food half of `consumables.ts`. Dish
 * slots are the `meals` system. See README.md in this folder.
 */
import {
  answer,
  defineCommand,
  defineEvent,
  defineRequest,
  defineSystem,
  handle,
  OK,
  PLAYER,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type RequestDef,
  type SystemDef,
} from '../../kernel';
import {
  benchCrafted,
  consumedParts,
  DISCIPLINES,
  nextSlot,
  openSlots,
  placed,
  recipeKey,
  registerBench,
  type BenchReads,
  type DisciplineDef,
  type GradedStack,
  type Placement,
} from '../benches';
import benches from '../benches';
import combat from '../combat';
import consumables, {
  applyRestore,
  canUse,
  canUseOutOfFight,
  registerEater,
  useNow,
  type MealWait,
} from '../consumables';
import counters, { bumpCounter, counterValue } from '../counters';
import { fillText, logLine, repeatLine } from '../log';
import materials, {
  craftTagsOf,
  grantGraded,
  gradesHeld,
  MATERIAL_LIST,
  MATERIALS,
  QUALITY_TIERS,
  qualityMult,
  qualityRank,
  rollQuality,
  takeGraded,
  type QualityTier,
} from '../materials';
import meals, { handOffRequest, isNourishing, mealToReplace, recordMealRequest, type MealLanding } from '../meals';
import prestige from '../prestige';
import skills, { checkDiscovery, grantDiscoveryXp, grantSkillXp, skillLevel } from '../skills';
import { statBlockOf } from '../stats';
import statuses, { applyStatus, fireStatusEvent, heldOf, isHarmful, STATUSES, type StatusApplication, type StatusInstance } from '../statuses';
import { checkTitles } from '../titles';
import world, { SPOTS } from '../world';
import { previewCook, prepParts, rollDishQuality } from './cook';
import {
  carriedCookbook,
  cookbookRank,
  cookedCount,
  cookedGradeKey,
  cookedKey,
  cookTimeKnown,
  dishHasCookTime,
  signatureEarned,
  type BookReads,
} from './cookbook';
import { COOK_TIME_COOKS, COOKING_BENCH_IDS, COOKING_BENCHES, cookingText, PREPS, preppedIdOf, preps, SIGNATURE_COOKS, TEXT } from './defs';
import { eatenApplication, doseTicks, foodScale, isSpoiledFood, NO_FOOD_SCALE, SPOILED, SPOILED_EATEN_KEY } from './food';
import { migrations } from './migrations';

export * from './defs';
export * from './cook';
export * from './cookbook';
export * from './food';
export * from './heatTrack';
export * from './gradeLedger';
export * from './mealsView';
export * from './bookView';

const say = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

export type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- slice ----

/** The old `cooked` event: what a cook made, at what grade, in what range. */
export interface CookedPayload {
  discipline: string;
  outcome: string;
  dish: string;
  quality: QualityTier;
  low: QualityTier;
  high: QualityTier;
  qty: number;
}

/** Where one dish stood in the Book. */
export interface DishMark {
  made: number;
  best: QualityTier | null;
  timeKnown: boolean;
  signature: boolean;
}

export interface QueuedMeal {
  dish: string;
  quality: QualityTier;
  why: MealWait;
}

export interface CookingState {
  /** The dish waiting for the fight or the knockout to end. The old `state.queuedMeal`. */
  queued: QueuedMeal | null;
  /** What Cook's Notes carried from earlier runs. The old `state.prestige.cookbook`. */
  carried: { timed: string[]; signed: string[] };
  /** The last cook and the dish's mark just before it, for the plate card. */
  plate: { cooked: CookedPayload; before: DishMark } | null;
}

// ---- reads ----

/** What the bench rules read for a cooking bench. */
export function benchReadsOf(ctx: ReadCtx): BenchReads {
  const c = ctx.read(counters);
  return {
    level: skillLevel(ctx.read(skills), 'cooking'),
    materials: ctx.read(materials),
    knowsRecipe: (id) => counterValue(c, recipeKey(id)) > 0,
  };
}

/** What the Cook's Book reads. */
export function bookOf(ctx: ReadCtx, carried?: DeepReadonly<CookingState['carried']>): BookReads {
  return {
    counters: ctx.read(counters),
    carried: carried ?? ctx.read(cooking).carried,
    rank: cookbookRank(ctx.read(prestige)),
  };
}

/** Where a dish stands in the Book now. */
export function dishMark(book: BookReads, dishId: string): DishMark {
  let best: QualityTier | null = null;
  for (const tier of ['f', 'e', 'd', 'c', 'b', 'a', 's'] as QualityTier[]) {
    if (counterValue(book.counters, cookedGradeKey(dishId, tier)) > 0) best = tier;
  }
  return {
    made: cookedCount(book, dishId),
    best,
    timeKnown: cookTimeKnown(book, dishId),
    signature: signatureEarned(book, dishId),
  };
}

/**
 * Whether eating this dish at this grade would put it in a dish slot: food,
 * not spoiled, and gives (with its Signature earned, would give) a condition
 * that does not hurt. The old `dishHoldsSlot`.
 */
export function dishHoldsSlot(book: BookReads, id: string, quality: QualityTier): boolean {
  const spec = MATERIALS[id]?.consumable;
  if (!spec?.food || qualityMult(quality) <= 0) return false;
  const gives = [...(spec.grants ?? []), ...(signatureEarned(book, id) ? (spec.signature ?? []) : [])];
  return gives.some((app) => isNourishing(app.id));
}

/** What pressing Eat does now. The old `EatPlan`. */
export interface EatPlan {
  mode: 'eat' | 'queue' | 'blocked';
  reason?: string;
  wait?: MealWait;
  /** This exact dish and grade is the queued one. */
  queued: boolean;
  /** The dish eating it would push out of its slot. */
  replaces?: { dish: string; quality: QualityTier; ticksLeft: number | null };
}

function waitFor(ctx: ReadCtx, id: string): MealWait | undefined {
  if (!MATERIALS[id]?.consumable?.food) return undefined;
  if (ctx.read(combat).fight) return 'fight';
  if (ctx.read(world).recovering) return 'recovery';
  return undefined;
}

/** What pressing Eat on this dish would do. The old `eatPlan`. */
export function eatPlan(ctx: ReadCtx & { tick: number }, id: string, quality: QualityTier): EatPlan {
  const q = ctx.read(cooking).queued;
  const queued = q?.dish === id && q.quality === quality;
  const wait = waitFor(ctx, id);
  const cons = ctx.read(consumables);
  const check = wait ? canUseOutOfFight(ctx, cons, id, quality) : canUse(ctx, cons, id, quality);
  if (!check.ok) return { mode: 'blocked', reason: check.reason, queued };
  const victim = dishHoldsSlot(bookOf(ctx), id, quality)
    ? mealToReplace(ctx.read(meals), heldOf(ctx.read(statuses), PLAYER), id)
    : undefined;
  return {
    mode: wait ? 'queue' : 'eat',
    ...(wait ? { wait } : {}),
    queued,
    ...(victim ? { replaces: { dish: victim.slot.dish, quality: victim.quality, ticksLeft: victim.ticksLeft } } : {}),
  };
}

// ---- commands, requests, events ----

/** Press Eat: eat now, or queue a dish during a fight or a knockout. The old `eat`. */
export const eat = defineCommand<{ id: string; quality?: QualityTier }>('cooking/eat');
/** Take the queued dish off the queue. The old `cancelQueuedMeal`. */
export const cancelMeal = defineCommand<void>('cooking/cancel-meal');

/** What one cook made. */
export interface CookResult {
  dish: string;
  quality: QualityTier;
  qty: number;
}

/** Work a cooking bench once. The old `cook`. Null when nothing was made (the reason is logged). */
export const cookRequest = defineRequest<{ discipline: string; placement: Placement; duration?: number }, CookResult | null>(
  'cooking/cook',
);
/** Eat one dish already taken from stock. Registered with `consumables` as its eater. */
export const eatFoodRequest = defineRequest<{ id: string; quality: QualityTier; queued?: MealWait }, void>('cooking/eat-food');

/** A dish (not a cut) was cooked. The old bus event `cooked`, for the plate card. */
export const cooked = defineEvent<CookedPayload>('cooking/cooked');

/** One craft request per bench: `benches` hands the owner a placement and a duration only. */
const CRAFT: Record<string, RequestDef<{ placement: Placement; duration?: number; xpScale?: number }, boolean>> = Object.fromEntries(
  COOKING_BENCH_IDS.map((id) => [id, defineRequest<{ placement: Placement; duration?: number; xpScale?: number }, boolean>(`cooking/craft-${id}`)]),
);

for (const id of COOKING_BENCH_IDS) {
  registerBench(id, {
    preview: (ctx, placement, duration) => previewCook(benchReadsOf(ctx), placement, DISCIPLINES[id], duration),
    craft: CRAFT[id],
  });
}
registerEater(eatFoodRequest);

type K = Ctx<CookingState>;

/** Spend the layout; a take that fails puts back what was taken. The old `consumePlacement`. */
function spend(ctx: K, disc: DisciplineDef, placement: Placement): boolean {
  const taken: GradedStack[] = [];
  for (const part of consumedParts(disc, placement)) {
    if (ctx.request(takeGraded, { id: part.id, quality: part.quality })) taken.push(part);
    else {
      for (const back of taken) ctx.request(grantGraded, { id: back.id, quality: back.quality });
      return false;
    }
  }
  return true;
}

/** Cook it. The old `cook`. `xpScale`: a Shadow Clone's share of the skill XP. */
function cookOnce(ctx: K, disc: DisciplineDef, placement: Placement, duration?: number, xpScale?: number): CookResult | null {
  const scale = xpScale !== undefined ? { scale: xpScale } : {};
  const reads = benchReadsOf(ctx);
  const check = previewCook(reads, placement, disc, duration);
  if (!check.ok || !check.outcome || !check.quality) {
    if (check.reason) ctx.emit(logLine, { msg: say('locked', { reason: check.reason }), kind: 'danger' });
    return null;
  }

  // The cutting board rolls its cut before spending: the ingredient's grade caps it.
  if (check.outcome.result.kind === 'prepped') {
    const parts = prepParts(disc, placement)!;
    const prep = PREPS[parts.technique!.id]!;
    const cap = parts.ingredient!.quality;
    const rolled = rollQuality(ctx.rng, 1 + reads.level / 20);
    const cut = qualityRank(rolled) > qualityRank(cap) ? cap : rolled;
    if (!spend(ctx, disc, placement)) return null;
    const id = preppedIdOf(parts.ingredient!.id, prep.id);
    ctx.request(grantGraded, { id, quality: cut, qty: 1 });
    ctx.emit(checkDiscovery, { tags: [disc.tag] });
    // A cut is not a dish: no novelty key, the ordinary rate.
    ctx.emit(grantSkillXp, { tags: ['craft', disc.tag], amount: disc.xp * (1 + qualityRank(cut) * 0.15), ...scale });
    const made = MATERIALS[id];
    ctx.emit(benchCrafted, { discipline: disc.id });
    ctx.emit(
      logLine,
      repeatLine({
        group: `bench:${disc.id}`,
        prefix: TEXT.prepared_prefix,
        tally: [{ label: `${made?.icon ?? ''} ${QUALITY_TIERS[cut].name} ${made?.name ?? id}`.trim(), qty: 1 }],
        kind: 'item',
      }),
    );
    return { dish: id, quality: cut, qty: 1 };
  }

  if (!spend(ctx, disc, placement)) return null;
  const result = check.outcome.result;
  if (result.kind !== 'material' || !result.id) return null;
  const quality = rollDishQuality(reads, ctx.rng, placement, disc, duration);
  const qty = result.qty ?? 1;
  ctx.request(grantGraded, { id: result.id, quality, qty });
  ctx.emit(checkDiscovery, { tags: [disc.tag] });

  // The Book counts cooks. Counters are bumped by event, after this handler:
  // what the old code read after its bump is the count before plus one.
  const book = bookOf(ctx, ctx.state.carried);
  const before = dishMark(book, result.id);
  const count = before.made;
  const hadCookTime = cookTimeKnown(book, result.id, count);
  const hadSignature = signatureEarned(book, result.id, count);
  ctx.emit(bumpCounter, { key: cookedKey(result.id) });
  ctx.emit(bumpCounter, { key: cookedGradeKey(result.id, quality) });
  if (count === 0) ctx.emit(grantDiscoveryXp, { domain: 'cookery', ...scale });
  const noteCookTime = !hadCookTime && cookTimeKnown(book, result.id, count + 1) && dishHasCookTime(result.id);
  const noteSignature = !hadSignature && signatureEarned(book, result.id, count + 1);

  // Novelty is keyed by the dish, not the basket.
  ctx.emit(grantSkillXp, {
    tags: ['craft', disc.tag],
    amount: disc.xp * (1 + placed(placement).length * 0.2) * (1 + qualityRank(quality) * 0.15),
    sourceKey: result.id,
    ...scale,
  });

  const dish = MATERIALS[result.id];
  ctx.emit(benchCrafted, { discipline: disc.id });
  const payload: CookedPayload = {
    discipline: disc.id,
    outcome: check.outcome.id,
    dish: result.id,
    quality,
    low: check.quality,
    high: check.qualityHigh ?? check.quality,
    qty,
  };
  ctx.state.plate = { cooked: payload, before };
  ctx.emit(cooked, payload);
  const name = dish?.name ?? result.id;
  const tally = [{ label: `${QUALITY_TIERS[quality].name} ${name}`, qty }];
  if (noteCookTime) tally.push({ label: say('book_time', { name, cooks: COOK_TIME_COOKS }), qty: 1 });
  if (noteSignature) {
    const status = (dish?.consumable?.signature ?? []).map((sig) => STATUSES[sig.id]?.name ?? sig.id).join(' and ');
    tally.push({ label: say('book_signature', { name, status, cooks: SIGNATURE_COOKS }), qty: 1 });
  }
  ctx.emit(
    logLine,
    repeatLine({ group: `bench:${disc.id}`, prefix: say('cooked_prefix', { icon: dish?.icon ?? '🍽️' }), tally, kind: 'item' }),
  );
  return { dish: result.id, quality, qty };
}

/** Eat one dish already taken from stock. The food half of the old `useConsumable`. */
function eatFood(ctx: K, id: string, quality: QualityTier, queued?: MealWait): void {
  const def = MATERIALS[id]!;
  const spec = def.consumable!;
  const stats = statBlockOf(ctx);
  const scale = qualityMult(quality);
  // The cook improves the benefit side only.
  const food = spec.food && scale > 0 ? foodScale(stats) : NO_FOOD_SCALE;
  const book = bookOf(ctx, ctx.state.carried);
  const heldNow = (): readonly DeepReadonly<StatusInstance>[] => heldOf(ctx.read(statuses), PLAYER);
  // Which dish a full set of slots drops is chosen now, before any dose lands.
  const victim = spec.food && dishHoldsSlot(book, id, quality) ? mealToReplace(ctx.read(meals), heldNow(), id)?.slot.dish : undefined;
  const before = new Map(heldNow().map((s) => [s.id, { intensity: s.intensity, ticksLeft: s.ticksLeft }] as const));
  const landings: MealLanding[] = [];
  const land = (dose: StatusApplication, resist: boolean): DeepReadonly<StatusInstance> | null => {
    const held = heldNow().find((s) => s.id === dose.id)?.intensity;
    const inst = ctx.request(applyStatus, { entity: PLAYER, app: dose, source: def.name, ...(resist ? { resist: true } : {}) });
    if (inst && spec.food) {
      const raised = held === undefined || inst.intensity > held;
      landings.push({
        id: inst.id,
        dose: raised ? inst.intensity : (dose.intensity ?? 1),
        ticks: doseTicks(dose),
        before: before.get(inst.id) ?? null,
      });
    }
    return inst;
  };

  // Instant: the whole restore, now.
  applyRestore(ctx, spec, scale * food.potency);

  const signatureText: string[] = [];
  if (scale < 0) {
    // Spoiled food makes you ill, resisted.
    ctx.request(applyStatus, { entity: PLAYER, app: { id: SPOILED, intensity: -scale }, source: def.name, resist: true });
  } else {
    for (const app of spec.grants ?? []) {
      const granted = STATUSES[app.id];
      land(eatenApplication(app as StatusApplication, scale, food), !!granted && isHarmful(granted));
    }
    if (signatureEarned(book, id)) {
      for (const app of spec.signature ?? []) {
        const dose = eatenApplication(app as StatusApplication, scale, food);
        const inst = land(dose, false);
        if (inst) signatureText.push(`${STATUSES[inst.id]?.name ?? inst.id} ×${+(dose.intensity ?? 1).toFixed(2)}`);
      }
    }
  }

  for (const tag of spec.cures ?? []) ctx.request(fireStatusEvent, { entity: PLAYER, on: 'cure', detail: { tag } });

  const params = {
    icon: def.icon,
    verb: spec.useVerb ?? 'Used',
    grade: QUALITY_TIERS[quality].name,
    name: def.name,
    note: say(queued === 'recovery' ? 'note_recovery' : 'note_fight'),
    status: signatureText.join(' and '),
  };
  const line = signatureText.length ? (queued ? 'used_signature_queued' : 'used_signature') : queued ? 'used_queued' : 'used';
  ctx.emit(logLine, { msg: say(line, params), kind: scale < 0 ? 'danger' : 'action' });

  if (isSpoiledFood(spec, scale)) {
    ctx.emit(bumpCounter, { key: SPOILED_EATEN_KEY });
    ctx.emit(checkTitles, undefined);
  }
  // After the eating line, so a dish pushed out reads as what eating caused.
  if (landings.length > 0) ctx.request(recordMealRequest, { dish: id, quality, landings, ...(victim ? { victim } : {}) });
}

function dishName(id: string, quality: QualityTier): string {
  return `${QUALITY_TIERS[quality].name} ${MATERIALS[id]?.name ?? id}`;
}

function queueMeal(ctx: K, id: string, quality: QualityTier, why: MealWait): void {
  const was = ctx.state.queued;
  if (was && was.dish === id && was.quality === quality) return;
  ctx.state.queued = { dish: id, quality, why };
  const grade = QUALITY_TIERS[quality].name;
  const name = MATERIALS[id]?.name ?? id;
  const when = say(why === 'recovery' ? 'when_recovery' : 'when_fight');
  ctx.emit(logLine, {
    msg: was ? say('queue_replaced', { grade, name, old: dishName(was.dish, was.quality), when }) : say('queued', { grade, name, when }),
    kind: 'action',
  });
}

/** At the start of a tick: eat the queued dish once the fight and any recovery are over. The old `tickMeals`. */
function tickQueue(ctx: K, fight: boolean, recovering: boolean): void {
  const q = ctx.state.queued;
  if (!q || fight || recovering) return;
  // Cleared first: eating must not fire the same dish twice.
  ctx.state.queued = null;
  const check = canUse(ctx, ctx.read(consumables), q.dish, q.quality);
  if (!check.ok) {
    ctx.emit(logLine, {
      msg: say('queue_dropped', { grade: QUALITY_TIERS[q.quality].name, name: MATERIALS[q.dish]?.name ?? q.dish, reason: check.reason ?? say('reason_not_usable') }),
      kind: 'danger',
    });
    return;
  }
  ctx.request(useNow, { id: q.dish, quality: q.quality, queued: q.why });
}

// ---- view ----

export interface StockRow {
  id: string;
  name: string;
  icon: string;
  tags: string[];
  grades: { quality: QualityTier; qty: number }[];
}

export interface CookingBenchView {
  id: string;
  name: string;
  benchName: string;
  icon: string;
  verb: string;
  /** The player stands at a spot with this bench. */
  here: boolean;
  /** Spots that have this bench. */
  spots: string[];
  openSlots: string[];
  next: { slot: string; level: number } | null;
}

export interface EatPlanView extends EatPlan {
  id: string;
  quality: QualityTier;
}

export interface CookingView {
  level: number;
  benches: CookingBenchView[];
  /** Every held material some cooking slot accepts, best grade first. */
  stock: StockRow[];
  /** Recipes read. */
  known: string[];
  /** The Book's reads: the cook counters, the carried lists, the rank. */
  book: { counters: Record<string, number>; carried: { timed: string[]; signed: string[] }; rank: number };
  /** The kitchen run, if one is going at a cooking bench. */
  job: { discipline: string; progress: number; secondsLeft: number; done: number; remaining: number | null; duration: number | null } | null;
  plate: { cooked: CookedPayload; before: DishMark } | null;
  queued: QueuedMeal | null;
  /** The Eat plan of every held food stack, keyed `<id>:<quality>`. */
  plans: Record<string, EatPlanView>;
  /** A fight is open; the player is knocked out. For the queued line. */
  fight: boolean;
  recovering: boolean;
}

const ACCEPTED_TAGS = new Set(COOKING_BENCHES.flatMap((d) => d.slots.filter((s) => (s.picks ?? 'material') !== 'design').flatMap((s) => s.accepts)));
const KITCHEN_MATERIALS = MATERIAL_LIST.filter((m) => craftTagsOf(m.id).some((t) => ACCEPTED_TAGS.has(t)));
const FOOD = MATERIAL_LIST.filter((m) => m.consumable?.food);
const BENCH_SPOTS: Record<string, string[]> = Object.fromEntries(
  COOKING_BENCH_IDS.map((id) => [id, Object.values(SPOTS).filter((s) => s.benches?.includes(id)).map((s) => s.name)]),
);

function cookingView(ctx: ReadCtx & { tick: number; state: DeepReadonly<CookingState> }): CookingView {
  const level = skillLevel(ctx.read(skills), 'cooking');
  const mats = ctx.read(materials);
  const spot = ctx.read(world).spot;
  const here = new Set(SPOTS[spot]?.benches ?? []);
  const c = ctx.read(counters);
  const bookCounters: Record<string, number> = {};
  const known: string[] = [];
  for (const [key, value] of Object.entries(c.counts)) {
    if (key.startsWith('cooked:')) bookCounters[key] = value as number;
    if (key.startsWith('recipe:') && (value as number) > 0) known.push(key.slice('recipe:'.length));
  }
  const job = ctx.read(benches).job;
  const plans: Record<string, EatPlanView> = {};
  for (const def of FOOD) {
    for (const g of gradesHeld(mats, def.id)) plans[`${def.id}:${g.quality}`] = { id: def.id, quality: g.quality, ...eatPlan(ctx, def.id, g.quality) };
  }
  return {
    level,
    benches: COOKING_BENCHES.map((d) => {
      const nx = nextSlot(d, level);
      return {
        id: d.id,
        name: d.name,
        benchName: d.benchName ?? d.name,
        icon: d.icon,
        verb: d.verb ?? 'Cook',
        here: here.has(d.id),
        spots: BENCH_SPOTS[d.id],
        openSlots: openSlots(d, level).map((s) => s.id),
        next: nx ? { slot: nx.slot.id, level: nx.level } : null,
      };
    }),
    stock: KITCHEN_MATERIALS.flatMap((m) => {
      const grades = gradesHeld(mats, m.id);
      return grades.length ? [{ id: m.id, name: m.name, icon: m.icon, tags: craftTagsOf(m.id), grades: [...grades].reverse() }] : [];
    }),
    known,
    book: { counters: bookCounters, carried: { timed: [...ctx.state.carried.timed], signed: [...ctx.state.carried.signed] }, rank: cookbookRank(ctx.read(prestige)) },
    job:
      job && COOKING_BENCH_IDS.includes(job.discipline)
        ? {
            discipline: job.discipline,
            progress: job.ticksPer > 0 ? Math.min(1, Math.max(0, 1 - Math.max(0, job.ticksLeft) / job.ticksPer)) : 0,
            secondsLeft: Math.max(0, job.ticksLeft) / 10,
            done: job.done,
            remaining: job.remaining,
            duration: job.duration ?? null,
          }
        : null,
    plate: ctx.state.plate ? JSON.parse(JSON.stringify(ctx.state.plate)) : null,
    queued: ctx.state.queued ? { ...ctx.state.queued } : null,
    plans,
    fight: !!ctx.read(combat).fight,
    recovering: ctx.read(world).recovering,
  };
}

// ---- the declaration ----

const cooking: SystemDef<CookingState, CookingView> = defineSystem<CookingState, CookingView>({
  id: 'cooking',
  version: 1,
  migrations,
  initial: () => ({ queued: null, carried: { timed: [], signed: [] }, plate: null }),
  // Before anything moves (old `Game.advance`: `tickMeals`, then `handOffMeals`).
  order: -50,
  content: { preps, cooking_text: cookingText },

  tick: (ctx) => {
    // Nothing queued and no claim held: nothing to do (the common tick).
    const m = ctx.read(meals);
    if (ctx.state.queued === null && m.slots.length === 0 && m.foreign.length === 0) return;
    const w = ctx.read(world);
    if (ctx.state.queued !== null) tickQueue(ctx, !!ctx.read(combat).fight, w.recovering);
    if (m.slots.length === 0 && m.foreign.length === 0) return;
    // How far the conditions' clocks run this tick: none while travelling, faster while knocked out.
    const rate = w.travel ? 0 : w.recovering ? 5 : 1;
    ctx.request(handOffRequest, { rate });
  },

  commands: [
    handle(eat, (ctx, { id, quality = 'c' }) => {
      const plan = eatPlan(ctx, id, quality);
      if (plan.mode === 'queue') {
        queueMeal(ctx, id, quality, plan.wait ?? 'fight');
        return OK;
      }
      return ctx.request(useNow, { id, quality }) ? OK : skipped(plan.reason ?? say('reason_not_usable'));
    }),
    handle(cancelMeal, (ctx) => {
      const was = ctx.state.queued;
      if (!was) return skipped('no dish is queued');
      ctx.state.queued = null;
      ctx.emit(logLine, {
        msg: say('queue_cancelled', { grade: QUALITY_TIERS[was.quality].name, name: MATERIALS[was.dish]?.name ?? was.dish }),
        kind: 'action',
      });
      return OK;
    }),
  ],

  requests: [
    answer(cookRequest, (ctx, { discipline, placement, duration }) => {
      const disc = DISCIPLINES[discipline];
      if (!disc || disc.skill !== 'cooking') {
        ctx.skip('cooking/cook', `no cooking bench has the id "${discipline}"`);
        return null;
      }
      return cookOnce(ctx, disc, placement, duration);
    }),
    ...COOKING_BENCH_IDS.map((id) =>
      answer(CRAFT[id], (ctx: K, { placement, duration, xpScale }) => cookOnce(ctx, DISCIPLINES[id], placement, duration, xpScale) !== null),
    ),
    answer(eatFoodRequest, (ctx, { id, quality, queued }) => eatFood(ctx, id, quality, queued)),
  ],

  // Cook's Notes: carry what reached each threshold this run (old `prestigeNow`, `carriedCookbook`).
  newRun: (ctx, previous) => {
    const was = previous(cooking);
    ctx.state.carried = carriedCookbook({ counters: previous(counters), carried: was.carried });
  },

  view: (ctx) => cookingView(ctx),
});

export default cooking;
