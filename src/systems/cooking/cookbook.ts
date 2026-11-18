/**
 * The Cook's Book: what the player has cooked, read back out of the counters
 * a cook bumps (`cooked:<dish>`, `cooked:<dish>:<tier>`). Port of old
 * `systems/cookbook.ts`. There is no Book in the save: the counters are the
 * record. Cook's Notes carries the thresholds, not the counters, in this
 * system's slice (`carried`), and its rank gates the reading.
 */
import type { DeepReadonly } from '../../kernel';
import { counterValue, type CountersState } from '../counters';
import { MATERIALS, QUALITY_ORDER, type QualityTier } from '../materials';
import { PRESTIGE_BOON_LIST, type PrestigeState } from '../prestige';
import { COOK_TIME_COOKS, COOKING_BENCHES, SIGNATURE_COOKS } from './defs';
import type { HeatWindow } from '../benches';

/** What the Book reads: the counters, what Cook's Notes carried, and its rank. */
export interface BookReads {
  counters: DeepReadonly<CountersState>;
  carried: DeepReadonly<{ timed: string[]; signed: string[] }>;
  /** The Cook's Notes rank held. */
  rank: number;
}

export const cookedKey = (dishId: string): string => `cooked:${dishId}`;
export const cookedGradeKey = (dishId: string, tier: QualityTier): string => `cooked:${dishId}:${tier}`;

/** The rank of Cook's Notes held. The old `cookbookRank`. */
export function cookbookRank(prestige: DeepReadonly<PrestigeState>): number {
  let rank = 0;
  for (const def of PRESTIGE_BOON_LIST) {
    if (def.effect.kind === 'cookbook') rank = Math.max(rank, prestige.purchases[def.id] ?? 0);
  }
  return rank;
}

/** Times this dish has been cooked this run. */
export function cookedCount(book: BookReads, dishId: string): number {
  return counterValue(book.counters, cookedKey(dishId));
}

/** Whether the Book shows this dish's cook time: cooked enough this run, or kept by Cook's Notes. */
export function cookTimeKnown(book: BookReads, dishId: string, count = cookedCount(book, dishId)): boolean {
  if (count >= COOK_TIME_COOKS) return true;
  return book.rank >= 1 && book.carried.timed.includes(dishId);
}

/** Whether eating this dish grants its Signature. False for a dish with none. */
export function signatureEarned(book: BookReads, dishId: string, count = cookedCount(book, dishId)): boolean {
  if (!MATERIALS[dishId]?.consumable?.signature?.length) return false;
  if (count >= SIGNATURE_COOKS) return true;
  return book.rank >= 2 && book.carried.signed.includes(dishId);
}

/** One row of the Book: a cooking-bench outcome and what the player made of it. */
export interface CookbookEntry {
  outcomeId: string;
  benchId: string;
  dishId: string;
  made: number;
  byGrade: Record<QualityTier, number>;
  best: QualityTier | null;
  cookTimeKnown: boolean;
  signature: boolean;
  /** The outcome's heat windows, only when it has some and the cook time is known. */
  heat?: HeatWindow[];
}

/** Every dish a cooking bench can make, one row per outcome. The old `cookbook`. */
export function cookbook(book: BookReads): CookbookEntry[] {
  const rows: CookbookEntry[] = [];
  for (const disc of COOKING_BENCHES) {
    for (const outcome of disc.outcomes) {
      if (outcome.result.kind !== 'material' || !outcome.result.id) continue;
      const dishId = outcome.result.id;
      const byGrade = {} as Record<QualityTier, number>;
      let best: QualityTier | null = null;
      for (const tier of QUALITY_ORDER) {
        const n = counterValue(book.counters, cookedGradeKey(dishId, tier));
        byGrade[tier] = n;
        if (n > 0) best = tier;
      }
      const known = cookTimeKnown(book, dishId);
      rows.push({
        outcomeId: outcome.id,
        benchId: disc.id,
        dishId,
        made: cookedCount(book, dishId),
        byGrade,
        best,
        cookTimeKnown: known,
        signature: signatureEarned(book, dishId),
        ...(known && outcome.heat?.length ? { heat: outcome.heat.map((w) => ({ ...w })) } : {}),
      });
    }
  }
  return rows;
}

/** Whether any outcome that makes this dish carries heat windows. */
export function dishHasCookTime(dishId: string): boolean {
  return COOKING_BENCHES.some((disc) =>
    disc.outcomes.some((o) => o.result.kind === 'material' && o.result.id === dishId && !!o.heat?.length),
  );
}

/** Every material id a cooking bench makes, once each, in bench order. */
export function cookingDishIds(): string[] {
  const ids = new Set<string>();
  for (const disc of COOKING_BENCHES) {
    for (const outcome of disc.outcomes) {
      if (outcome.result.kind === 'material' && outcome.result.id) ids.add(outcome.result.id);
    }
  }
  return [...ids];
}

/**
 * What a prestige carries of the Book: the lists so far plus every dish that
 * reached a threshold this run, whatever rank is held. Never shortens a list.
 */
export function carriedCookbook(book: Omit<BookReads, 'rank'>): { timed: string[]; signed: string[] } {
  const timed = new Set(book.carried.timed);
  const signed = new Set(book.carried.signed);
  for (const dishId of cookingDishIds()) {
    const n = counterValue(book.counters, cookedKey(dishId));
    if (n >= COOK_TIME_COOKS) timed.add(dishId);
    if (n >= SIGNATURE_COOKS && MATERIALS[dishId]?.consumable?.signature?.length) signed.add(dishId);
  }
  return { timed: [...timed], signed: [...signed] };
}
