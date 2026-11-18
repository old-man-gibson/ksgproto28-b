/**
 * The book: what the player holds, what is prepared, and casting outside a
 * fight. Port of the book half of the old `systems/spellcraft.ts`
 * (`preparedCap`, `findSpell`, `preparedSpells`, `hasSpell`, `hasDivine`,
 * `isUtilityWorking`, `utilityCooldown`, `canCastUtility`, `deityConflict`).
 * The commands that write the book are in `index.ts`.
 */
import type { DeepReadonly } from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import combat from '../combat';
import prestige, { legacyPreparedPages } from '../prestige';
import resources, { resourceValue } from '../resources';
import skills from '../skills';
import type { DerivedStats } from '../stats';
import { resolveSpell, resolveSpellFor } from './cast';
import { schoolOf, spellKey, type SchoolReads } from './spec';
import type { SpellcraftReads } from './state';
import type { CraftedSpell, SpellSource, SpellSpec } from './types';

/** How many spells may be held ready for combat before any study earns more. */
export const BASE_PREPARED = 3;
/** Levels of a school that buy one more page. */
export const PREPARED_PER_LEVELS = 20;
/** The school skills that count for pages. Their shared parent `magic` does not. */
export const PREPARED_SCHOOLS = ['arcana', 'psionics', 'devotion'] as const;

/** The prepared cap: the base, the prestige pages, and a page per twenty levels of each school. */
export function preparedCap(reads: SchoolReads): number {
  let cap = BASE_PREPARED + legacyPreparedPages(reads.read(prestige));
  const held = reads.read(skills).skills;
  for (const id of PREPARED_SCHOOLS) cap += Math.floor((held[id]?.level ?? 0) / PREPARED_PER_LEVELS);
  return cap;
}

export function findSpell(book: SpellcraftReads, uid: number): DeepReadonly<CraftedSpell> | undefined {
  return book.grimoire.find((spell) => spell.uid === uid);
}

export function preparedSpells(book: SpellcraftReads): DeepReadonly<CraftedSpell>[] {
  return book.grimoire.filter((spell) => spell.prepared);
}

/** Whether the book holds this combination already, by its key. */
export function hasSpell(book: SpellcraftReads, source: SpellSource): boolean {
  const key = spellKey(source);
  return book.grimoire.some((spell) => spellKey(spell.source as SpellSource) === key);
}

export function hasDivine(book: SpellcraftReads, litany: string): boolean {
  return book.grimoire.some((spell) => spell.source.school === 'divine' && spell.source.litany === litany);
}

/**
 * Whether a working does anything with nobody to do it to: a grant, or a
 * heal of the caster. A counterspell never: it waits for a casting.
 */
export function isUtilityWorking(spec: SpellSpec): boolean {
  if (spec.counter) return false;
  return (spec.grants?.length ?? 0) > 0 || (!!spec.heal && !spec.healsEnemy);
}

/** Ticks until this working can be cast outside a fight again. */
export function utilityCooldown(book: SpellcraftReads, now: number, uid: number): number {
  return Math.max(0, (book.utilityReady[String(uid)] ?? 0) - now);
}

export interface UtilityCheck {
  ok: boolean;
  reason?: string;
}

/** Whether `uid` can be cast outside a fight now. The old `canCastUtility`. */
export function canCastUtility(
  reads: SchoolReads,
  book: SpellcraftReads,
  stats: Readonly<DerivedStats>,
  uid: number,
): UtilityCheck {
  const spell = findSpell(book, uid);
  if (!spell) return { ok: false, reason: 'No such spell' };
  const spec = resolveSpellFor(reads, spell);
  if (!isUtilityWorking(spec)) return { ok: false, reason: `${spec.name} needs a target` };
  if (reads.read(combat).fight) return { ok: false, reason: 'In combat: prepare it instead' };
  if (utilityCooldown(book, totalTicksOf(reads.read(clock)), uid) > 0) {
    return { ok: false, reason: `${spec.name} on cooldown` };
  }
  const pools = reads.read(resources);
  if (resourceValue(pools, 'mana') < spec.manaCost * stats.manaEff) return { ok: false, reason: 'Not enough mana' };
  if (spec.focusCost && resourceValue(pools, 'focus') < spec.focusCost) return { ok: false, reason: 'Not enough focus' };
  return { ok: true };
}

/**
 * The pantheon's veto: a miracle of a deity hostile to the deity of an
 * already prepared miracle refuses the page. Learning is not restricted;
 * this bites at preparation only. The old `deityConflict`. A worn title
 * that defies dogma waives it; `spellcraft/set-prepared` checks that.
 */
export function deityConflict(
  book: SpellcraftReads,
  spell: DeepReadonly<CraftedSpell>,
  nameOf: (deity: string) => string,
): string | null {
  const deity = resolveSpell(spell).deity;
  if (!deity) return null;
  const relation = schoolOf('divine')?.relation;
  if (!relation) return null;
  for (const other of preparedSpells(book)) {
    if (other.uid === spell.uid) continue;
    const otherDeity = resolveSpell(other).deity;
    if (otherDeity && relation(deity, otherDeity) === 'hostile') {
      return `${nameOf(deity)} refuses to share a page with ${nameOf(otherDeity)}.`;
    }
  }
  return null;
}
