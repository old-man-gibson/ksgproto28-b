/**
 * What a piece gives where it sits, and how a candidate differs from the
 * worn piece. Port of `effectiveTerms`, `compareToWorn`, `isConditional` and
 * `lowerIsBetter` of the old `ui/lib/gearCompare.ts`. Pure.
 *
 * `effectiveTerms` mirrors the equipment loop of the stat source in
 * `index.ts`: base and affix mods scaled by hand fit and size fit, each
 * socketed rune's mods for the item's rune context at the same scale, and the
 * hand bonus unscaled when its pairing holds. A test checks the two agree.
 */
import type { DeepReadonly } from '../../kernel';
import type { ContentMod } from '../stats';
import { itemDefOf, runeContextFor, runeEffectAt, type ItemInstance, type SlotId } from './defs';
import { describeMod } from './format';
import { sizeFit, wieldScale, type Equipment } from './wield';

type Item = DeepReadonly<ItemInstance>;
type Mod = DeepReadonly<ContentMod>;

/** Numbers within this are equal: a summed 0.1 + 0.08 is not exactly 0.18. */
const EPS = 1e-9;

/** Stats where the smaller value is the better one. */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set([
  'damageTaken',
  'critTaken',
  'stumbleTaken',
  'staminaEff',
  'manaEff',
  'actionBar',
]);

/** A scoped stat (`damageTaken:heat`) reads by the stat before the colon. */
export function lowerIsBetter(stat: string): boolean {
  return LOWER_IS_BETTER.has(stat.split(':')[0]);
}

/**
 * A modifier the (stat, op) key does not fully describe: it applies only
 * under a tag, a style, a target tag, a level or another stat, or it is
 * exempt from damping.
 */
export function isConditional(mod: Mod): boolean {
  return (
    !!mod.requiresTag ||
    !!mod.requiresStyle ||
    !!mod.requiresMonsterTag ||
    mod.perLevel !== undefined ||
    mod.levelCurve !== undefined ||
    mod.fromStat !== undefined ||
    mod.undampened === true
  );
}

export interface Term {
  stat: string;
  op: 'add' | 'mult';
  value: number;
}

const termKey = (mod: Mod): string => `${mod.stat}|${mod.op}`;

function addTerm(terms: Map<string, Term>, mod: Mod, scale = 1): void {
  const key = termKey(mod);
  const held = terms.get(key);
  if (held) held.value += mod.value * scale;
  else terms.set(key, { stat: mod.stat, op: mod.op, value: mod.value * scale });
}

/**
 * What an item gives in `slot` for a wearer of `wielderRank`, with `worn` as
 * the rest of the gear. A conditional modifier is left out and flagged.
 */
export function effectiveTerms(
  worn: DeepReadonly<Equipment>,
  item: Item,
  slot: SlotId,
  wielderRank: number,
): { terms: Map<string, Term>; conditional: boolean } {
  const terms = new Map<string, Term>();
  const def = itemDefOf(item);
  if (!def) return { terms, conditional: false };
  const fit = wieldScale(def, slot) * sizeFit(item, slot, wielderRank);
  let conditional = false;
  const add = (mods: readonly Mod[], scale: number) => {
    for (const mod of mods) {
      if (isConditional(mod)) conditional = true;
      else addTerm(terms, mod, scale);
    }
  };
  add(def.mods, fit);
  add(item.affix?.mods ?? [], fit);
  const context = runeContextFor(def.slot);
  for (const ref of item.runes ?? []) add(runeEffectAt(ref, context)?.mods ?? [], fit);
  const bonus = slot === 'weapon' ? def.mainHand : slot === 'offhand' ? def.offHand : undefined;
  if (bonus) {
    const other = worn[slot === 'weapon' ? 'offhand' : 'weapon'];
    const tags = other ? (itemDefOf(other)?.tags ?? []) : [];
    if (!bonus.pairedWith || tags.includes(bonus.pairedWith)) add(bonus.mods, 1);
  }
  return { terms, conditional };
}

export interface DeltaLine {
  text: string;
  /** True when the change helps the wearer. */
  better: boolean;
}

export interface WornComparison {
  worn: Item;
  lines: DeltaLine[];
  /** Either piece has a conditional modifier. Those are left out of the lines. */
  conditional: boolean;
}

/** "+3 Armor" as "Armor: +3 vs worn". */
function deltaText(term: Term, diff: number): string {
  const line = describeMod({ stat: term.stat, op: term.op, value: diff });
  const parts = /^([+−]\S+) (.+)$/.exec(line);
  return parts ? `${parts[2]}: ${parts[1]} vs worn` : `${line} vs worn`;
}

/**
 * How `item` differs from the piece worn in `slot`, stat by stat. Typed
 * on-hit damage and technique changes are not compared. Null when the slot is
 * empty or holds this item. Rune slots are listed only while runecarving is
 * open (`runesOpen`).
 */
export function compareToWorn(
  equipment: DeepReadonly<Equipment>,
  item: Item,
  slot: SlotId,
  runesOpen: boolean,
  wielderRank: number,
): WornComparison | null {
  const worn = equipment[slot];
  if (!worn || worn.uid === item.uid) return null;
  const mine = effectiveTerms(equipment, item, slot, wielderRank);
  const theirs = effectiveTerms(equipment, worn, slot, wielderRank);

  const lines: DeltaLine[] = [];
  const keys = new Set([...mine.terms.keys(), ...theirs.terms.keys()]);
  for (const key of keys) {
    const a = mine.terms.get(key);
    const b = theirs.terms.get(key);
    const term = (a ?? b)!;
    const diff = Math.round(((a?.value ?? 0) - (b?.value ?? 0)) * 1e6) / 1e6;
    if (Math.abs(diff) < EPS) continue;
    lines.push({
      text: deltaText(term, diff),
      better: lowerIsBetter(term.stat) ? diff < 0 : diff > 0,
    });
  }
  if (runesOpen) {
    const gap = (item.slots ?? 0) - (worn.slots ?? 0);
    if (gap !== 0) lines.push({ text: `Rune slots: ${gap > 0 ? '+' : '−'}${Math.abs(gap)}`, better: gap > 0 });
  }
  return { worn, lines, conditional: mine.conditional || theirs.conditional };
}
