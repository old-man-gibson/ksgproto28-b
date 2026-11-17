/**
 * Stat keys, attribute ids and damage types. Port of the matching unions and
 * name tables in the old `types.ts`.
 */

export const ATTRIBUTE_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type AttributeId = (typeof ATTRIBUTE_IDS)[number];

export const DAMAGE_TYPES = [
  'slashing',
  'piercing',
  'bludgeoning',
  'heat',
  'cold',
  'poison',
  'acid',
  'arcane',
  'lightning',
  'earth',
  'water',
  'wind',
  'light',
  'dark',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Every type but the three physical ones. `resElemental` is folded into these. */
export const ELEMENTAL_TYPES: ReadonlySet<DamageType> = new Set<DamageType>([
  'heat',
  'cold',
  'poison',
  'acid',
  'arcane',
  'lightning',
  'earth',
  'wind',
  'water',
  'light',
  'dark',
]);

/** Display name per stat. The key list of this table is the list of stats. */
export const STAT_NAMES = {
  damageTaken: 'Damage Taken',
  ward: 'Ward',
  resElemental: 'Elemental Resistance',
  resRanged: 'Ranged Resistance',
  critTaken: 'Crit Damage Taken',
  stumbleTaken: 'Exposure While Off Balance',
  resistCap: 'Resistance Ceiling',
  vsSmaller: 'Damage vs Smaller',
  fromSmaller: 'Resistance vs Smaller',
  vsLarger: 'Damage vs Larger',
  resAcid: 'Acid Resistance',
  missRefund: 'Cooldown Back on a Miss',
  graze: 'Graze Damage on a Miss',
  maxHp: 'Max HP',
  hpRegen: 'HP Regen',
  damage: 'Damage',
  attackSpeed: 'Attack Speed',
  extraSwings: 'Extra Swings',
  dodge: 'Dodge',
  crit: 'Crit Chance',
  armor: 'Armor',
  spellPower: 'Spell Power',
  skillXp: 'Skill XP',
  trainXp: 'Attribute XP',
  loot: 'Loot Luck',
  goldGain: 'Gold Gain',
  travelSpeed: 'Travel Speed',
  craftSpeed: 'Craft Speed',
  foodDuration: 'Food Duration',
  foodPotency: 'Food Potency',
  critDamage: 'Crit Damage',
  penetration: 'Penetration',
  splash: 'Splash Damage',
  parry: 'Parry',
  riposte: 'Riposte',
  speed: 'Speed',
  actionBar: 'Action Bar',
  maxStamina: 'Max Stamina',
  staminaRegen: 'Stamina Regen',
  staminaEff: 'Stamina Efficiency',
  staminaPower: 'Stamina Power',
  maxMana: 'Max Mana',
  manaRegen: 'Mana Regen',
  manaEff: 'Mana Efficiency',
  maxSpirit: 'Max Spirit',
  maxFocus: 'Max Focus',
  focusRegen: 'Focus Regen',
  psiPressure: 'Psi Pressure',
  psiMomentum: 'Psi Momentum',
  psiInertia: 'Psi Inertia',
  psiAcuity: 'Psi Acuity',
  psiAwareness: 'Psi Awareness',
  psiCoherence: 'Psi Coherence',
  psiPurchase: 'Psi Purchase',
  resSlashing: 'Slashing Res.',
  resPiercing: 'Piercing Res.',
  resBludgeoning: 'Bludgeon Res.',
  resHeat: 'Heat Res.',
  resCold: 'Cold Res.',
  resPoison: 'Poison Res.',
  resArcane: 'Arcane Res.',
  resLightning: 'Lightning Res.',
  resEarth: 'Earth Res.',
  resWind: 'Wind Res.',
  resWater: 'Water Res.',
  resLight: 'Light Res.',
  resDark: 'Dark Res.',
} as const;

export type StatKey = keyof typeof STAT_NAMES;
export const STAT_KEYS = Object.keys(STAT_NAMES) as StatKey[];
export type DerivedStats = Record<StatKey, number>;

const STAT_KEY_SET: ReadonlySet<string> = new Set(STAT_KEYS);
const ATTRIBUTE_ID_SET: ReadonlySet<string> = new Set(ATTRIBUTE_IDS);

export function isStatKey(target: string): target is StatKey {
  return STAT_KEY_SET.has(target);
}

export function isAttrTarget(target: string): target is AttributeId {
  return ATTRIBUTE_ID_SET.has(target);
}

/** `craftSpeed:leatherworking` is scoped; `craftSpeed` and `str` are not. */
export function isScopedTarget(target: string): boolean {
  return target.includes(':');
}

export const RES_STAT_BY_TYPE: Record<DamageType, StatKey> = {
  slashing: 'resSlashing',
  piercing: 'resPiercing',
  bludgeoning: 'resBludgeoning',
  heat: 'resHeat',
  cold: 'resCold',
  poison: 'resPoison',
  acid: 'resAcid',
  arcane: 'resArcane',
  lightning: 'resLightning',
  earth: 'resEarth',
  wind: 'resWind',
  water: 'resWater',
  light: 'resLight',
  dark: 'resDark',
};

export const RES_KEYS: StatKey[] = [
  'resSlashing',
  'resPiercing',
  'resBludgeoning',
  'resHeat',
  'resCold',
  'resPoison',
  'resAcid',
  'resArcane',
  'resLightning',
  'resEarth',
  'resWind',
  'resWater',
  'resLight',
  'resDark',
];
