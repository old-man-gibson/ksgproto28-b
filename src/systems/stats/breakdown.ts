/**
 * Tooltip breakdowns. Port of `statBreakdown` and `BASE_FORMULA_TEXT` in the
 * old `systems/derived.ts`, and of `groupModLines` and `attrBreakdown` in the
 * old `systems/attributes.ts`.
 */
import type { Modifier } from '../../kernel';
import type { AttributeId, StatKey } from './keys';
import { STATS_PREFIX, type StatMod } from './mods';
import { baseStats, computeBlock, FOOD_MULT_CAP, PARRY_CAP, RESIST_CAP, type ActiveMod } from './pipeline';

/** The base formula of each stat as text. Mirrors `baseStats`. */
export const BASE_FORMULA_TEXT: Record<StatKey, string> = {
  damageTaken: '1 (a multiplier — lower is better)',
  ward: '0 (flat, taken off every blow after resistances)',
  resElemental: '0 (added to every elemental resistance)',
  resRanged: '0 (added only against attackers at range)',
  critTaken: '1 (scales the SURPLUS a crit adds, never the blow under it)',
  stumbleTaken: "1 (scales a position's PENALTY, never its benefit)",
  resistCap: '0.75 — the ceiling every resistance clamps to',
  resAcid: '0',
  missRefund: '0 (share of remaining cooldown handed back on a miss)',
  graze: '0 (share of a swing that lands anyway when it misses)',
  vsSmaller: '0 (added damage per size step the target is below you)',
  fromSmaller: '0 (damage reduction per size step the attacker is below you)',
  vsLarger: '0 (added damage per size step the target is above you)',
  maxHp: '40 + 10 × CON',
  hpRegen: '1% of Max HP + 0.01 × CON /s',
  damage: '2 + 1.2 × STR',
  speed: '50 × (1 + 1.5% × DEX)',
  actionBar: '1000 units',
  attackSpeed: '×1 — sources converge: each multiplies remaining attack time by (1 − v)',
  extraSwings: 'overflow past the 0.5s attack-time floor, as extra hits per swing',
  dodge: '1 − 98% × 0.996^DEX',
  crit: '5% + 0.15% × DEX',
  armor: '0.3 × CON',
  spellPower: '2 + 1.5 × INT',
  skillXp: '1 + 1% × INT',
  trainXp: '1 + 1.2% × WIS',
  loot: '1 + 0.5% × WIS',
  goldGain: '1 + 1.2% × CHA',
  travelSpeed: '×1',
  craftSpeed: '×1',
  foodDuration: 'Cooking milestones add; read at most 150%',
  foodPotency: 'Cooking milestones add; read at most 150%',
  critDamage: '×2',
  penetration: '0',
  splash: '0',
  parry: '0',
  riposte: '30% of your damage',
  maxStamina: '10 + 0.5 × STR + 1 × CON',
  staminaRegen: '2% of Max Stamina + 0.005 × CON /s',
  staminaEff: '50% + 50% × 0.999^STR × 0.9985^DEX',
  staminaPower: '2 − Stamina Efficiency',
  maxMana: '1 × INT',
  manaRegen: '0.01 × INT + 0.05 × WIS /s',
  manaEff: '0.99967^INT × 0.9999^WIS',
  maxSpirit: '5 + 0.25 × WIS + 0.1 × CHA',
  maxFocus: '6 + 0.3 × CHA + 0.1 × WIS',
  focusRegen: '2% of Max Focus + 0.01 × CHA /s',
  psiPressure: '×1 — bias from gear only',
  psiMomentum: '×1 — bias from gear only',
  psiInertia: '×1 — bias from gear only',
  psiAcuity: '×1 — bias from gear only',
  psiAwareness: '×1 — bias from gear only',
  psiCoherence: '×1 — bias from gear only',
  psiPurchase: '×1 — bias from gear only',
  resSlashing: '0',
  resPiercing: '0',
  resBludgeoning: '0',
  resHeat: '0',
  resCold: '0',
  resPoison: '0',
  resArcane: '0',
  resLightning: '0',
  resEarth: '0',
  resWind: '0',
  resWater: '0',
  resLight: '0',
  resDark: '0',
};

/** Caps the pipeline applies, shown in tooltips when they bite. */
const STAT_CAPS: Partial<Record<StatKey, number>> = {
  foodDuration: FOOD_MULT_CAP,
  foodPotency: FOOD_MULT_CAP,
  dodge: 0.75,
  crit: 0.9,
  penetration: 0.6,
  splash: 1,
  parry: PARRY_CAP,
  resSlashing: RESIST_CAP,
  resPiercing: RESIST_CAP,
  resBludgeoning: RESIST_CAP,
  resHeat: RESIST_CAP,
  resCold: RESIST_CAP,
  resPoison: RESIST_CAP,
  resArcane: RESIST_CAP,
  resLightning: RESIST_CAP,
  resEarth: RESIST_CAP,
  resWind: RESIST_CAP,
  resWater: RESIST_CAP,
  resLight: RESIST_CAP,
  resDark: RESIST_CAP,
};

export interface BreakdownLine {
  source: string;
  op: 'add' | 'mult';
  value: number;
}

/** Merge modifiers into one line per (source, op). Adds sum, mults compound. Adds come first. */
export function groupModLines(mods: readonly Pick<ActiveMod, 'source' | 'op' | 'value'>[]): BreakdownLine[] {
  const groups = new Map<string, BreakdownLine>();
  for (const m of mods) {
    const source = m.source ?? 'Other';
    const key = `${m.op}:${source}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { source, op: m.op, value: m.value });
    else g.value = m.op === 'add' ? g.value + m.value : (1 + g.value) * (1 + m.value) - 1;
  }
  return [...groups.values()].sort((a, b) => (a.op === b.op ? 0 : a.op === 'add' ? -1 : 1));
}

export interface StatBreakdown {
  key: StatKey;
  /** Value from the base formula, before any modifier. */
  base: number;
  baseText: string;
  /** One line per modifier source. Adds first, then multipliers. */
  lines: BreakdownLine[];
  /** Final value as the game uses it. */
  total: number;
  /** True when a hard cap trimmed the raw total. */
  capped: boolean;
}

/** Everything contributing to one derived stat. `collected` is `ctx.modifiers()`. */
export function statBreakdown(collected: readonly Modifier[], key: StatKey): StatBreakdown {
  const block = computeBlock(collected);
  const base = baseStats((id) => block.formula[id])[key];
  const lines = groupModLines(block.mods.filter((m) => m.target === key));
  let raw = base + lines.filter((l) => l.op === 'add').reduce((sum, l) => sum + l.value, 0);
  for (const l of lines) if (l.op === 'mult') raw *= 1 + l.value;
  const cap = STAT_CAPS[key];
  return {
    key,
    base,
    baseText: BASE_FORMULA_TEXT[key],
    lines,
    total: block.stats[key],
    capped: cap !== undefined && raw > cap,
  };
}

export interface AttrBreakdown {
  trained: number;
  lines: BreakdownLine[];
  effective: number;
  /** Endowment's multiplier as a fraction (0.05 is x1.05), when any applies. */
  endowment?: number;
  /** Present when this attribute is a fused component. */
  fusion?: { partner: AttributeId; partnerValue: number; total: number };
}

/** Everything contributing to one attribute's effective value. `collected` is `ctx.modifiers()`. */
export function attrBreakdown(collected: readonly Modifier[], attr: AttributeId): AttrBreakdown {
  const block = computeBlock(collected);
  const sum = (name: string) =>
    (collected as readonly StatMod[])
      .filter((m) => m.stat === `${STATS_PREFIX}@${name}`)
      .reduce((total, m) => total + m.value, 0);
  const result: AttrBreakdown = {
    trained: sum(`base:${attr}`),
    lines: groupModLines(block.mods.filter((m) => m.target === attr)),
    effective: block.effective[attr],
  };
  const endowment = sum(`endowment:${attr}`);
  if (endowment > 0) result.endowment = endowment;
  const pair = block.fused.find(([a, b]) => a === attr || b === attr);
  if (pair) {
    const partner = pair[0] === attr ? pair[1] : pair[0];
    result.fusion = {
      partner,
      partnerValue: block.effective[partner],
      total: block.effective[attr] + block.effective[partner],
    };
  }
  return result;
}
