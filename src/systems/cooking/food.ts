/**
 * Food rules, pure: how the cook scales a dish as eaten, a dose's lifetime,
 * calories, what counts as spoiled food, and the food lint. Port of the food
 * half of old `systems/consumables.ts` and of `foodProblems` in old
 * `systems/disciplines.ts`.
 */
import type { DisciplineDef } from '../benches';
import { qualityMult, type MaterialDef, type QualityTier } from '../materials';
import { harmOf, isHarmful, STATUSES, type StatusApplication, type StatusDef } from '../statuses';
import { MATERIALS } from '../materials';

/** What eating something spoiled does to you. */
export const SPOILED = 'queasy';
/** Spoiled dishes eaten so far; the hidden title Iron Stomach reads it. */
export const SPOILED_EATEN_KEY = 'food:spoiled';

export type ConsumableSpec = NonNullable<MaterialDef['consumable']>;

/** How the cook's skill scales food as eaten. */
export interface FoodScale {
  duration: number;
  potency: number;
}

export const NO_FOOD_SCALE: FoodScale = { duration: 1, potency: 1 };

/** The cook's scaling, read from the stat block (capped there). The old `foodScale`. */
export function foodScale(stats: { foodDuration: number; foodPotency: number }): FoodScale {
  return { duration: stats.foodDuration, potency: stats.foodPotency };
}

/**
 * One granted condition as eaten: intensity x grade x potency, and a lifetime
 * scaled by duration. A harmful condition is never scaled by the cook. The
 * old `eatenApplication`.
 */
export function eatenApplication(app: StatusApplication, scale: number, food: FoodScale): StatusApplication {
  const def = STATUSES[app.id];
  const f = def && isHarmful(def) ? NO_FOOD_SCALE : food;
  const out: StatusApplication = { ...app, intensity: (app.intensity ?? 1) * scale * f.potency };
  if (f.duration !== 1 && app.duration !== 'permanent') {
    const base = app.duration ?? STATUSES[app.id]?.duration;
    if (typeof base === 'number') out.duration = Math.round(base * f.duration);
  }
  return out;
}

/** A dose's full lifetime in ticks; null when it does not run out by clock. The old `doseTicks`. */
export function doseTicks(app: StatusApplication): number | null {
  if (app.duration === 'permanent') return null;
  const base = app.duration ?? STATUSES[app.id]?.duration;
  return typeof base === 'number' ? base : null;
}

/** Calories per point of Well Fed a dish grants. */
export const CALORIES_PER_WELL_FED = 400;
/** Calories of a dish that grants no Well Fed. */
export const CALORIES_PLAIN_DISH = 100;

/** Calories a dish gives at a grade. Read by nothing until Facet's Calorie Burn is ported. */
export function dishCalories(id: string, quality: QualityTier): number {
  const spec = MATERIALS[id]?.consumable;
  const scale = qualityMult(quality);
  if (!spec?.food || scale <= 0) return 0;
  const fed = (spec.grants ?? []).filter((g) => g.id === 'well_fed').reduce((n, g) => n + (g.intensity ?? 1), 0);
  return (fed > 0 ? CALORIES_PER_WELL_FED * fed : CALORIES_PLAIN_DISH) * scale;
}

/** Whether eating this was eating something spoiled. The old `isSpoiledFood`. */
export function isSpoiledFood(spec: ConsumableSpec, scale: number): boolean {
  return !!spec.food && (scale < 0 || !!spec.grants?.some((g) => g.id === SPOILED));
}

/**
 * Problems with the food flag, what food grants and Signatures, keyed by
 * material id. The old `foodProblems`, shared by the tests and the forge.
 */
export function foodProblems(
  disciplines: readonly DisciplineDef[],
  materials: Record<string, MaterialDef>,
  statuses?: Record<string, StatusDef>,
): { material: string; message: string }[] {
  const problems: { material: string; message: string }[] = [];
  const say = (material: string, message: string) => problems.push({ material, message });

  const made = new Map<string, { from: string[]; failureOnly: boolean }>();
  for (const disc of disciplines) {
    if (disc.skill !== 'cooking') continue;
    for (const o of disc.outcomes) {
      if (o.result.kind !== 'material' || !o.result.id) continue;
      const entry = made.get(o.result.id) ?? { from: [], failureOnly: true };
      entry.from.push(`${disc.id}/${o.id}`);
      if (!o.maxQuality) entry.failureOnly = false;
      made.set(o.result.id, entry);
    }
  }

  const failureDishes = new Set([...made].filter(([, e]) => e.failureOnly).map(([id]) => id));
  const spoilage = new Set<string>();
  for (const id of failureDishes) {
    for (const g of materials[id]?.consumable?.grants ?? []) spoilage.add(g.id);
  }

  for (const [id, entry] of made) {
    const mat = materials[id];
    if (!mat) continue;
    const spec = mat.consumable;
    if (!spec?.food) {
      say(id, `'${id}' is made by ${entry.from.join(', ')}, a cooking bench, but is not marked food`);
    } else if (entry.failureOnly && spec.signature?.length) {
      say(id, `'${id}' is a failure dish (only ${entry.from.join(', ')} make it) and carries a signature`);
    } else if (!entry.failureOnly && !spec.signature?.length) {
      say(id, `'${id}' is a dish and has no signature`);
    }
  }

  const checkApplications = (
    id: string,
    label: 'grants' | 'signature',
    apps: readonly StatusApplication[],
    harmAllowed: boolean,
  ) => {
    for (const app of apps) {
      const what = `'${id}' ${label} '${app.id}'`;
      if (app.duration === 'permanent') {
        say(id, `${what} with duration 'permanent': a dish's effect must run out`);
      } else if (app.duration !== undefined && !(app.duration > 0)) {
        say(id, `${what} with duration ${app.duration}: it would end at once`);
      }
      if (app.intensity !== undefined && !(app.intensity > 0)) {
        say(id, `${what} with intensity ${app.intensity}: it would do nothing`);
      }
      if (app.chance !== undefined && !(app.chance > 0)) {
        say(id, `${what} with chance ${app.chance}: it would never land`);
      }
      const def = statuses?.[app.id];
      const harm = def ? harmOf(def) : null;
      if (harm && !harmAllowed) say(id, `${what} is a harmful condition (${harm}); food only nourishes`);
    }
  };

  for (const mat of Object.values(materials)) {
    const spec = mat.consumable;
    if (!spec) continue;
    if (spec.food && !made.has(mat.id)) say(mat.id, `'${mat.id}' is marked food but no cooking bench makes it`);
    if (spec.signature?.length && !spec.food) say(mat.id, `'${mat.id}' has a signature but is not food`);
    if (spec.food) {
      const failure = failureDishes.has(mat.id);
      checkApplications(mat.id, 'grants', (spec.grants ?? []) as StatusApplication[], failure);
      checkApplications(mat.id, 'signature', (spec.signature ?? []) as StatusApplication[], false);
    }
    const own = new Set((spec.grants ?? []).map((g) => g.id));
    const seen = new Set<string>();
    for (const sig of spec.signature ?? []) {
      if (statuses && !statuses[sig.id]) say(mat.id, `'${mat.id}' signature names unknown condition '${sig.id}'`);
      if (own.has(sig.id)) say(mat.id, `'${mat.id}' signature repeats its own grant '${sig.id}'`);
      if (seen.has(sig.id)) say(mat.id, `'${mat.id}' signature lists '${sig.id}' twice`);
      seen.add(sig.id);
      if (spoilage.has(sig.id)) say(mat.id, `'${mat.id}' signature is the spoilage condition '${sig.id}'`);
    }
  }
  return problems;
}
