/**
 * The spellcraft slice, its events, the requests it makes of itself and the
 * registry of the refuting body.
 */
import { defineEvent, defineRequest, type DeepReadonly } from '../../kernel';
import type { ActionCtx } from '../combat';
import type { DamageType } from '../stats';
import type { SchoolReads } from './spec';
import type { CraftedSpell, SpellSchool, SpellSource } from './types';

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
  /**
   * Grimoire uid to the clock tick from which it may be cast outside a fight
   * again. The old `state.useCooldowns['spell:<uid>']` (version 2).
   */
  utilityReady: Record<string, number>;
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

/**
 * A grimoire working paid its cast XP: a self cast, an offensive cast, or a
 * counterspell's spring. `id` is the rotation id. A school whose words wear
 * in with use hears it. The old `grantCastWordXp` call sites.
 */
export const spellPractised = defineEvent<{ id: string }>('spellcraft/practised');

// ---- requests ----

/**
 * Write a spell into the book. The caller has checked legality. `prepared`
 * is written as given, with no cap check (the floor 0 spell). Answers a copy
 * of the new entry. The old `addSpell`.
 */
export const addSpell = defineRequest<{ source: SpellSource; name?: string; prepared?: boolean }, CraftedSpell>(
  'spellcraft/add',
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

// ---- the held working ----

/**
 * Whose working is held ready rather than left to cast on its own: the
 * grimoire uid, or null. Registered by the system that owns the
 * spell-ready seat (martial). The old `spellIsHeld`.
 */
export type HeldSpellReader = (reads: SchoolReads) => number | null;

let heldReader: HeldSpellReader | null = null;

/** Register the reader of the held working. Called at module load. */
export function registerHeldSpell(reader: HeldSpellReader | null): void {
  if (reader && heldReader) throw new Error('spellcraft: a held-spell reader is registered twice');
  heldReader = reader;
}

/** The uid of the working held ready now, or null. */
export function heldSpell(reads: SchoolReads): number | null {
  return heldReader ? heldReader(reads) : null;
}
