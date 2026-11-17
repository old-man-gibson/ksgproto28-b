/**
 * The spellcraft slice, its events, the requests it makes of itself and the
 * registry of the refuting body.
 */
import { defineEvent, defineRequest, type DeepReadonly } from '../../kernel';
import type { ActionCtx } from '../combat';
import type { DamageType } from '../stats';
import type { CraftedSpell, SpellSchool } from './types';

/** Rotation ids of prepared spells: `grimoire:<uid>`. */
export const GRIMOIRE_PREFIX = 'grimoire:';

/** An enemy working being cast. The old `CombatState.casting`. */
export interface Casting {
  entity: string;
  name: string;
  school: SpellSchool;
  element?: DamageType;
  /** Clock tick it began. */
  tick: number;
}

export interface SpellcraftState {
  /** The book. The old `state.grimoire`. Nothing writes it in spine port 5. */
  grimoire: CraftedSpell[];
  nextUid: number;
  casting: Casting | null;
  /** The last miracle cast in the fight. The old `CombatState.lastMiracle`. */
  lastMiracle: { deity: string; tick: number } | null;
}

export type SpellcraftReads = DeepReadonly<SpellcraftState>;

// ---- events ----

/**
 * A working was cast, by either side, refused or not. `id` is the rotation
 * id of the player's spell. The systems the old cast code called directly
 * hear this: the toll office, word practice, the run's ability.
 */
export const spellCast = defineEvent<{
  caster: string;
  id?: string;
  school: SpellSchool;
  name: string;
  deity?: string;
  manaCost: number;
}>('spellcraft/cast');

/** A strike of the player's working dealt damage to an enemy. `first` marks the first landing of the strike. */
export const strikeLanded = defineEvent<{ target: string; defId: string; type: DamageType; first: boolean }>(
  'spellcraft/strike-landed',
);

// ---- requests of this system to itself ----

/** Stamp the enemy working being cast. */
export const noteCasting = defineRequest<Omit<Casting, 'tick'>, void>('spellcraft/note-casting');
/** Record a miracle cast now. Answers the one before it and its age in ticks, or null. */
export const noteMiracle = defineRequest<{ deity: string }, { deity: string; age: number } | null>('spellcraft/note-miracle');

// ---- the refuting body ----

export interface Refusal {
  negated: boolean;
  /** Damage the refused working returns on its caster. */
  backlash: number;
  /** The working cannot be cast again this fight. */
  sealed: boolean;
}

/** A body that argues with every working in the fight. The old `refuteCast` and `isSealed` of `mutagens.ts`. */
export interface Refuter {
  refute(ctx: ActionCtx, key: string, cost: number): Refusal;
  sealed(ctx: ActionCtx, key: string): boolean;
}

let refuter: Refuter | null = null;

/** Register the refuting body. Called at module load by the system that owns it. None is registered in spine port 5. */
export function registerRefuter(handler: Refuter | null): void {
  if (handler && refuter) throw new Error('spellcraft: a refuter is registered twice');
  refuter = handler;
}

const UNREFUSED: Refusal = { negated: false, backlash: 0, sealed: false };

export function refute(ctx: ActionCtx, key: string, cost: number): Refusal {
  return refuter ? refuter.refute(ctx, key, cost) : UNREFUSED;
}

export function sealed(ctx: ActionCtx, key: string): boolean {
  return refuter ? refuter.sealed(ctx, key) : false;
}
