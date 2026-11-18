/**
 * Standing with the gods: favour per deity, the gods a life knows, and
 * whether a miracle may be received. Port of the favour half of old
 * `systems/deities.ts`, the checks of old `systems/divine.ts` and the known
 * gods of old `systems/unlocks.ts`.
 */
import type { DeepReadonly, SystemDef } from '../../kernel';
import counters, { counterValue } from '../counters';
import skills, { skillLevel } from '../skills';
import spellcraft, { hasDivine } from '../spellcraft';
import { DEITIES, MIRACLES } from './defs';

/** The divine slice. */
export interface DivineState {
  /** Deity id to favour held. A deity never granted any is absent. */
  favor: Record<string, number>;
}

/** What the reads of this file need: `ctx` of any handler or view. */
export interface DivineReads {
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
}

/**
 * The two deities a new life can find unaided. The rest wait to be met:
 * the counter `met:deity:<id>`. The old `STARTER_DEITIES`.
 */
export const STARTER_DEITIES: ReadonlySet<string> = new Set(['denjalle', 'usvylgr']);

export const deityMetKey = (deityId: string): string => `met:deity:${deityId}`;

/** Unassigned favour, placed one at a time on a known god. */
export const FLOATING_FAVOR_KEY = 'favor:floating';
/** Starting favour a newly met god receives (the first votive token's +2). */
export const VOTIVE_BASELINE_KEY = 'votive:baseline';
/** Miracles received, ever. The title `iconoclast` reads it. */
export const MIRACLES_LEARNED_KEY = 'miracles:learned';

export function deityKnown(reads: DivineReads, deityId: string): boolean {
  return STARTER_DEITIES.has(deityId) || counterValue(reads.read(counters), deityMetKey(deityId)) >= 1;
}

export function favorWith(state: DeepReadonly<DivineState>, deityId: string): number {
  return state.favor[deityId] ?? 0;
}

/** Add favour with one deity. Nothing for an unknown id or an amount of 0 or less. The old `grantFavor`. */
export function grantFavor(state: DivineState, deityId: string, amount: number): void {
  if (amount <= 0 || !DEITIES[deityId]) return;
  state.favor[deityId] = favorWith(state, deityId) + amount;
}

/** Spend favour with one deity. False, and nothing spent, when it does not cover. The old `spendFavor`. */
export function spendFavor(state: DivineState, deityId: string, amount: number): boolean {
  if (favorWith(state, deityId) < amount) return false;
  state.favor[deityId] = favorWith(state, deityId) - amount;
  return true;
}

export function floatingFavor(reads: DivineReads): number {
  return counterValue(reads.read(counters), FLOATING_FAVOR_KEY);
}

export function devotionLevel(reads: DivineReads): number {
  return skillLevel(reads.read(skills), 'devotion');
}

export interface MiracleCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether this life may receive the miracle now. Whether its god is known
 * is not checked: the old `checkMiracle` did not either. The old
 * `checkMiracle`.
 */
export function checkMiracle(reads: DivineReads, state: DeepReadonly<DivineState>, id: string): MiracleCheck {
  const miracle = MIRACLES[id];
  if (!miracle) return { ok: false, reason: 'No such miracle' };
  if (hasDivine(reads.read(spellcraft), id)) return { ok: false, reason: 'Already received' };
  if ((miracle.minLevel ?? 0) > devotionLevel(reads)) {
    return { ok: false, reason: `Needs Devotion ${miracle.minLevel}` };
  }
  const held = favorWith(state, miracle.deity);
  if (held < miracle.favorCost) {
    const deity = DEITIES[miracle.deity]?.name ?? miracle.deity;
    return { ok: false, reason: `Needs ${miracle.favorCost} favor with ${deity} (you have ${held})` };
  }
  return { ok: true };
}
