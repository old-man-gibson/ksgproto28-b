/**
 * Words for modifiers and conditions on an item. Port of `fmt`, `pct`,
 * `describeMod` and the attribute and skill cases of `condText` in the old
 * `ui/lib/format.ts`.
 */
import { attrName } from '../attributes';
import type { Condition } from '../counters';
import { SKILLS } from '../skills';
import { resolveModValue, RES_STAT_BY_TYPE, STAT_NAMES, type AttributeId, type ContentMod } from '../stats';

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** A number for display. */
export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs < 1000) {
    if (n % 1 === 0) return Math.round(n).toString();
    // A bonus under 1 must not read as "0.0".
    if (abs < 1) return parseFloat(n.toFixed(3)).toString();
    return abs < 10 ? n.toFixed(1) : Math.round(n).toString();
  }
  const tier = Math.floor(Math.log10(abs) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2).replace('e+', 'e');
  const scaled = n / Math.pow(10, tier * 3);
  return scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2) + SUFFIXES[tier];
}

/** A share as a percentage. */
export function pct(p: number, digits = 1): string {
  return (p * 100).toFixed(digits).replace(/\.0+$/, '') + '%';
}

/** Stats that are a share of something, shown as a percentage even when added. */
const PERCENT_STATS = new Set<string>([
  'dodge',
  'crit',
  'penetration',
  'splash',
  'parry',
  'riposte',
  'foodDuration',
  'foodPotency',
  ...Object.values(RES_STAT_BY_TYPE),
]);

const ATTR_IDS = new Set<string>(['str', 'dex', 'con', 'int', 'wis', 'cha']);

/** Display name of a modifier target: a stat, an attribute, or the key itself. */
export function statName(key: string): string {
  return (STAT_NAMES as Record<string, string>)[key] ?? (ATTR_IDS.has(key) ? attrName(key as AttributeId) : key);
}

/**
 * A modifier in words: "+10% Damage", "+3 Armor", "+2 Strength". A target
 * tag is named by its id: the monster tag names arrive with the bestiary.
 */
export function describeMod(mod: ContentMod, level = 0): string {
  const value = resolveModValue(mod, level);
  const name = statName(mod.stat);
  const sign = value >= 0 ? '+' : '−';
  const abs = Math.abs(value);
  const vs = mod.requiresMonsterTag ? ` vs ${mod.requiresMonsterTag}` : '';
  // With `fromStat` the number is a conversion rate of that stat, not a bonus.
  const from = mod.fromStat ? ` × ${statName(mod.fromStat)}` : '';
  if (mod.op === 'mult' || PERCENT_STATS.has(mod.stat)) return `${sign}${pct(abs)} ${name}${from}${vs}`;
  return `${sign}${fmt(abs)} ${name}${from}${vs}`;
}

/** A requirement in words. */
export function condText(cond: Condition): string {
  switch (cond.type) {
    case 'skill':
      return `${SKILLS[cond.id]?.name ?? cond.id} ${cond.level}`;
    case 'attr':
      return `${statName(cond.attr)} ${cond.level}`;
    case 'equippedTag':
      return `${cond.tag} equipped`;
    case 'stat':
      return `${cond.key} ≥ ${cond.value}`;
    case 'statMax':
      return `${cond.key} ≤ ${cond.value}`;
    case 'quest':
      return `quest "${cond.id}" completed`;
    case 'boon':
      return `own the ${cond.id} boon`;
  }
}

export function condsText(conds: readonly Condition[] | undefined): string {
  return (conds ?? []).map(condText).join(', ');
}
