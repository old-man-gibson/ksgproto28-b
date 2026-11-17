/**
 * How well an undoing answers a working. Port of `counterEfficiency`,
 * `matchCeiling` and the undo constants of the old `systems/arcane.ts`.
 * They read a `SpellCounter` and a signature, whatever school made them, so
 * they are here and not in `arcane`.
 *
 *   efficiency = UNDO_BASE
 *              + UNDO_PER_TIER x (undo tiers - 1)
 *              + ARCANE_UNDO_PER_UNIT x (arcane units in the tuning)
 *              + match
 *
 * Efficiency is not capped: past 100% nothing is left of the working to
 * undo, and the burn laid on its caster keeps growing.
 */
import type { DamageType } from '../stats';
import type { SpellCounter } from './types';

/** A working sent to `others` lands on each enemy at this share of its power. */
export const OTHERS_POWER = 0.5;

/** What an undoing is worth before it has matched anything. */
export const UNDO_BASE = 0.2;
/** Each undo tier past the first. */
export const UNDO_PER_TIER = 0.075;
/** Each unit of arcane in the tuning, whatever the working was made of. */
export const ARCANE_UNDO_PER_UNIT = 0.05;
/** The match ceiling for a single unit of tuning. */
export const MATCH_FIRST = 0.1;
/** The share of it each further unit adds on top. */
export const MATCH_DECAY = 0.8;

/** The most a tuning of `units` can add, every unit matched: a geometric sum. */
export function matchCeiling(units: number): number {
  if (units <= 0) return 0;
  return (MATCH_FIRST * (1 - Math.pow(MATCH_DECAY, units))) / (1 - MATCH_DECAY);
}

/** A counterspell read against one working, term by term. */
export interface CounterReading {
  efficiency: number;
  /** From the undo tiers alone. */
  base: number;
  /** From arcane in the tuning. */
  arcane: number;
  /** From tuning that met its element. */
  match: number;
  /** Units of tuning that met their element. */
  matched: number;
  /** Units of tuning in all. */
  tuned: number;
  /** What each matched unit was worth. */
  perUnit: number;
}

/** Pure: the counter as composed, the working as `workingSignature` reads it. */
export function counterEfficiency(
  counter: SpellCounter,
  signature: Partial<Record<DamageType, number>>,
): CounterReading {
  const base = UNDO_BASE + UNDO_PER_TIER * Math.max(0, counter.tiers - 1);
  const arcane = ARCANE_UNDO_PER_UNIT * (counter.tuning.arcane ?? 0);
  let tuned = 0;
  let matched = 0;
  for (const [element, units] of Object.entries(counter.tuning) as [DamageType, number][]) {
    tuned += units;
    matched += Math.min(units, signature[element] ?? 0);
  }
  const perUnit = tuned > 0 ? matchCeiling(tuned) / tuned : 0;
  const match = perUnit * matched;
  return { efficiency: base + arcane + match, base, arcane, match, matched, tuned, perUnit };
}
