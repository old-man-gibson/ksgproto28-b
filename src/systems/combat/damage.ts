/**
 * Typed damage: how one slice of a blow meets a stat block. Port of
 * `afterPenetration`, `monsterSlice`, `incomingSlice`, `addSlice`,
 * `dealtByType`, `heaviestType`, `resNote`, `POSITION_MODS` and
 * `WEAPON_DAMAGE_TYPES` of the old `systems/combat.ts`. Pure: no context.
 */
import type { DamageSlice } from '../log';
import type { MonsterRange } from '../monsters';
import { ELEMENTAL_TYPES, RES_STAT_BY_TYPE, type DamageType, type DerivedStats } from '../stats';

export const PHYSICAL_TYPES: ReadonlySet<DamageType> = new Set<DamageType>(['slashing', 'piercing', 'bludgeoning']);

/** A slice with its type as a damage type. The log's slice types it as a string. */
export interface TypedSlice extends DamageSlice {
  type: DamageType;
}

/**
 * Position and reach. Melee belong in the front slot, ranged in the back. A
 * melee attacker in the back lands slower and softer. A ranged attacker in
 * the front has its bar progress shaved, up to a cap per fill.
 */
export const POSITION_MODS: Record<
  'front' | 'back',
  Record<MonsterRange, { damage: number; fill: number; stunPerTick: number; stunCap: number }>
> = {
  front: {
    melee: { damage: 1, fill: 1, stunPerTick: 0, stunCap: 0 },
    ranged: { damage: 1, fill: 1, stunPerTick: 12, stunCap: 300 },
  },
  back: {
    melee: { damage: 0.6, fill: 0.6, stunPerTick: 0, stunCap: 0 },
    ranged: { damage: 1, fill: 1, stunPerTick: 0, stunCap: 0 },
  },
};

/** The damage type of a weapon family tag. */
export const WEAPON_DAMAGE_TYPES: Record<string, DamageType> = {
  sword: 'slashing',
  greatsword: 'slashing',
  dagger: 'piercing',
  bow: 'piercing',
  spear: 'piercing',
  blunt: 'bludgeoning',
  staff: 'bludgeoning',
};

/** A resistance as a blow meets it. Penetration erodes a positive resistance toward 0 and never deepens a weakness. */
export function afterPenetration(res: number, penetration = 0): number {
  return res > 0 ? Math.max(0, res - penetration) : res;
}

/**
 * One typed slice of a blow landing on a monster. Armour first (physical
 * only), then resistance, then `damageTaken`, then the ward. Two differences
 * from the player's slice are the old rules: penetration exists here, and the
 * floor is 0, not 1.
 */
export function monsterSlice(
  stats: Readonly<DerivedStats>,
  type: DamageType,
  source: string,
  raw: number,
  penetration = 0,
  ranged = false,
): TypedSlice {
  const before = Math.min(
    Math.max(0, stats.resistCap),
    stats[RES_STAT_BY_TYPE[type]] + (ELEMENTAL_TYPES.has(type) ? stats.resElemental : 0) + (ranged ? stats.resRanged : 0),
  );
  const resistance = afterPenetration(before, penetration);
  const worn = PHYSICAL_TYPES.has(type) ? Math.min(raw, stats.armor) : 0;
  const afterArmor = raw - worn;
  const afterRes = Math.max(0, afterArmor * (1 - resistance) * Math.max(0, stats.damageTaken));
  const warded = Math.max(0, Math.min(afterRes, stats.ward));
  const dealt = Math.max(0, afterRes - warded);
  return {
    type,
    source,
    raw,
    armor: worn,
    resisted: afterArmor - afterRes,
    resistance,
    pierced: before - resistance,
    warded,
    dealt,
  };
}

/**
 * A blow landing on the player: flat armour first (physical only), then
 * resistance, `damageTaken`, the ward, then the floor of 1 every blow deals.
 * `bonusArmor` is the guard a bracing stance bought for this blow.
 */
export function incomingSlice(
  stats: Readonly<DerivedStats>,
  type: DamageType,
  source: string,
  raw: number,
  bonusArmor = 0,
  ranged = false,
): TypedSlice {
  const armor = PHYSICAL_TYPES.has(type) ? Math.min(raw, stats.armor + bonusArmor) : 0;
  const resistance = Math.min(
    Math.max(0, stats.resistCap),
    stats[RES_STAT_BY_TYPE[type]] + (ELEMENTAL_TYPES.has(type) ? stats.resElemental : 0) + (ranged ? stats.resRanged : 0),
  );
  const afterArmor = raw - armor;
  const afterRes = afterArmor * (1 - resistance) * Math.max(0, stats.damageTaken);
  const warded = Math.max(0, Math.min(afterRes, stats.ward));
  const dealt = Math.max(1, Math.round(afterRes - warded));
  return {
    type,
    source,
    raw,
    armor,
    resisted: afterArmor * resistance,
    resistance,
    pierced: 0,
    warded,
    dealt,
  };
}

/** Damage the player takes from one blow. */
export function incomingDamage(stats: Readonly<DerivedStats>, type: DamageType, raw: number, bonusArmor = 0): number {
  return incomingSlice(stats, type, '', raw, bonusArmor).dealt;
}

/** Merge a slice into a report, one row per type and source. */
export function addSlice(into: Map<string, TypedSlice>, slice: TypedSlice): void {
  const key = `${slice.type}|${slice.source}`;
  const prev = into.get(key);
  if (!prev) into.set(key, { ...slice });
  else {
    prev.raw += slice.raw;
    prev.armor += slice.armor;
    prev.resisted += slice.resisted;
    prev.dealt += slice.dealt;
  }
}

/** Damage dealt per type, folded out of a slice map. The map's keys are `type|source`, not types. */
export function dealtByType(slices: Iterable<TypedSlice>): Map<DamageType, number> {
  const out = new Map<DamageType, number>();
  for (const slice of slices) out.set(slice.type, (out.get(slice.type) ?? 0) + slice.dealt);
  return out;
}

/** The type a blow of several types is remembered by: the one that dealt the most, summed across sources. */
export function heaviestType(parts: Iterable<{ type: DamageType; dealt: number }>): DamageType | undefined {
  const byType = new Map<DamageType, number>();
  for (const p of parts) byType.set(p.type, (byType.get(p.type) ?? 0) + p.dealt);
  let best: DamageType | undefined;
  let most = -Infinity;
  for (const [type, dealt] of byType) {
    if (dealt > most) {
      best = type;
      most = dealt;
    }
  }
  return best;
}

export function resNote(res: number): string {
  if (res >= 0.15) return ' (resisted)';
  if (res <= -0.15) return ' (vulnerable!)';
  return '';
}
