/**
 * The words and numbers for dish slots and the queued dish, rendered by
 * `DishSlots.svelte` (the sidebar list) and the Provisions window's Eat
 * button. Port of old `ui/lib/meals.ts`. Pure: the old functions read the
 * game state; these take what they read.
 *
 * - The dishes in slots are `activeMeals(meals slice, held statuses)` of the
 *   `meals` system, or anything of the same shape (`MealInput`).
 * - The Eat plan is `eatPlan(ctx, id, quality)` of this system (the cooking
 *   view's `plans`). Its `replaces` is `{ dish, quality, ticksLeft }` where the
 *   old one held the whole active meal.
 * - The cooldown is `cooldownLeft(consumables slice, id, tick)`.
 * - The dish limit is `dishLimit()` of `meals`, a constant.
 */
import { MATERIALS, QUALITY_TIERS, qualityRank, type QualityTier } from '../materials';
import { dishLimit } from '../meals';
import { STATUSES } from '../statuses';
import { consumableSpec } from '../consumables';
import type { EatPlan, QueuedMeal } from './index';

/** A dish in a slot, as `activeMeals` of `meals` returns it. */
export interface MealInput {
  slot: {
    dish: string;
    quality: QualityTier;
    claims: readonly { id: string; left: number | null }[];
  };
  /** Ticks until its last claim runs out; null when one has no clock. */
  ticksLeft: number | null;
  /** The grade still in effect. */
  quality: QualityTier;
}

/**
 * One line per condition a dish still gives, with the longest time any of its
 * claims on it has left (a dish eaten twice at different grades has two).
 */
function conditionLines(m: MealInput): string[] {
  const ids: string[] = [];
  const left = new Map<string, number | null>();
  for (const c of m.slot.claims) {
    if (c.left !== null && c.left <= 0) continue;
    if (!left.has(c.id)) ids.push(c.id);
    const was = left.get(c.id);
    left.set(c.id, was === undefined ? c.left : was === null || c.left === null ? null : Math.max(was, c.left));
  }
  return ids.map((id) => {
    const def = STATUSES[id];
    return `${def?.icon ?? ''} ${def?.name ?? id}: ${timeLeftText(left.get(id) ?? null)}`.trim();
  });
}

/** "Fair Hearty Stew". */
export function dishLabel(dish: string, quality: QualityTier): string {
  return `${QUALITY_TIERS[quality].name} ${MATERIALS[dish]?.name ?? dish}`;
}

/**
 * Time left as the list shows it, counted down in whole seconds and rounded up, so
 * it never reads "9m 60s" and never reads zero while any time is left. A dish with
 * no clock has no time limit.
 */
export function timeLeftText(ticksLeft: number | null): string {
  if (ticksLeft === null) return 'no time limit';
  const seconds = Math.ceil(Math.max(0, ticksLeft) / 10);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export interface DishRow {
  dish: string;
  icon: string;
  /** Grade and name. */
  name: string;
  /** Time left, in words. */
  time: string;
  /** One line per condition the dish still gives: name and its own time. */
  conditions: string[];
  /** This is the dish a new dish would replace first (every slot is full). */
  replacedFirst: boolean;
}

/** "Dishes 2/3". */
export function dishHeading(meals: readonly MealInput[]): string {
  return `Dishes ${meals.length}/${dishLimit()}`;
}

/** One row per dish in a slot, oldest first. */
export function dishRows(meals: readonly MealInput[]): DishRow[] {
  const full = meals.length >= dishLimit();
  let least: MealInput | undefined;
  for (const m of meals) {
    if (!least || (m.ticksLeft ?? Infinity) < (least.ticksLeft ?? Infinity)) least = m;
  }
  return meals.map((m) => ({
    dish: m.slot.dish,
    icon: MATERIALS[m.slot.dish]?.icon ?? '🍽️',
    name: dishLabel(m.slot.dish, m.quality),
    time: timeLeftText(m.ticksLeft),
    conditions: conditionLines(m),
    replacedFirst: full && m === least,
  }));
}

/**
 * The queued dish for the sidebar line, and what it is waiting for right now: the
 * knockout to pass when you are down with no fight on, else the fight. Null when
 * none waits. `recovering` is the world's, `fight` whether combat has a fight open.
 */
export function queuedRow(
  queued: Pick<QueuedMeal, 'dish' | 'quality'> | null,
  recovering: boolean,
  fight: boolean,
): { icon: string; name: string; label: string } | null {
  const q = queued;
  if (!q) return null;
  return {
    icon: MATERIALS[q.dish]?.icon ?? '🍽️',
    name: dishLabel(q.dish, q.quality),
    label: recovering && !fight ? 'After recovering:' : 'After this fight:',
  };
}

/** What the Eat button on a dish says and does, and what its tooltip adds. */
export interface EatButton {
  label: string;
  disabled: boolean;
  /** Pressing it cancels the queued dish instead of eating or queueing. */
  cancels: boolean;
  /** Tooltip lines, empty when there is nothing to add. */
  tip: string[];
  /** The dish eating this would push out, said plainly under the button. */
  replaces: string | null;
}

/** "Eat" or "Drink": the button's verb, from the dish's own past-tense one. */
function verbOf(id: string): string {
  return consumableSpec(id)?.useVerb === 'Drank' ? 'Drink' : 'Eat';
}

/**
 * The Eat button of one held stack. `plan` is `eatPlan(ctx, id, quality)`,
 * `meals` the dishes in slots, `cooling` the ticks of cooldown left on `id`.
 */
export function eatButton(
  id: string,
  quality: QualityTier,
  plan: Pick<EatPlan, 'mode' | 'reason' | 'wait' | 'queued' | 'replaces'>,
  meals: readonly MealInput[],
  cooling: number,
): EatButton {
  const spec = consumableSpec(id);
  // Food reads as a verb the player would say; everything else keeps the
  // spec's own word, as it always has.
  const base = spec?.food ? verbOf(id) : (spec?.useVerb ?? 'Use');
  const tip: string[] = [];
  const active = meals.find((m) => m.slot.dish === id);
  const replaces = plan.replaces
    ? `Replaces ${dishLabel(plan.replaces.dish, plan.replaces.quality)}${
        plan.replaces.ticksLeft === null ? '' : ` (${timeLeftText(plan.replaces.ticksLeft)} left)`
      }`
    : null;

  if (plan.mode === 'blocked') {
    // A cooldown is the one refusal that passes by itself, so it counts down on
    // the button; any other refusal is the tooltip's.
    if (cooling > 0) return { label: `Cooling ${(cooling / 10).toFixed(1)}s`, disabled: true, cancels: false, tip, replaces: null };
    if (plan.reason) tip.push(plan.reason);
    return { label: base, disabled: true, cancels: false, tip, replaces: null };
  }

  if (active) {
    // A helping at least as good as the one still in effect renews it; a worse
    // one never lowers or extends it, and only takes over when it runs out.
    tip.push(
      qualityRank(quality) < qualityRank(active.quality)
        ? `Already active as ${QUALITY_TIERS[active.quality].name} (${timeLeftText(active.ticksLeft)} left): a worse grade takes over when that one runs out.`
        : `Already active (${timeLeftText(active.ticksLeft)} left): eating it again renews its time.`,
    );
  }
  if (replaces) tip.push(`${replaces}. At most ${dishLimit()} dishes can be active at once.`);

  if (plan.mode === 'queue') {
    const knockedOut = plan.wait === 'recovery';
    if (plan.queued) {
      return {
        label: 'Queued: cancel',
        disabled: false,
        cancels: true,
        tip: [
          knockedOut
            ? 'It is eaten the moment you are back on your feet. Pressing this takes it off the queue.'
            : 'It is eaten the moment the fight ends. Pressing this takes it off the queue.',
        ],
        replaces: null,
      };
    }
    tip.unshift(
      knockedOut
        ? 'You are knocked out, and conditions run several times faster until you wake. This dish waits and is eaten the moment you are back on your feet. One dish waits at a time: choosing another replaces it.'
        : 'Dishes are eaten between fights. This one waits and is eaten the moment the fight ends. One dish waits at a time: choosing another replaces it.',
    );
    return {
      label: `${base} ${knockedOut ? 'after recovering' : 'after this fight'}`,
      disabled: false,
      cancels: false,
      tip,
      replaces,
    };
  }

  return { label: base, disabled: false, cancels: false, tip, replaces };
}
