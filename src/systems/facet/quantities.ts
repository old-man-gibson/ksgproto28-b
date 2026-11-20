/**
 * Every number of this game a FACET document may read, as the core's
 * quantity registry. Port of old `src/core/facet/quantities.ts`.
 *
 * Ids are shared with InfiniteGacha where both games have the number
 * (`stat.eff.<attr>`, `fighter.<key>`, `res.<type>`, `pool.<id>.cur/.max`,
 * `world.<name>`). A number only this game has is `ksg.<StatKey>`.
 */
import { type DeepReadonly, type DerivedReads, type SystemDef } from '../../kernel';
import attributes, { attrName } from '../attributes';
import combat from '../combat';
import levels from '../levels';
import martial from '../martial';
import resources, { resourceValue, type ResourceId } from '../resources';
import skills, { SKILLS } from '../skills';
import { ATTRIBUTE_IDS, effectiveAttr, hasWieldTag, statOf, STAT_NAMES, type StatKey } from '../stats';
import statuses, { heldOf, statueOf } from '../statuses';
import { sunlight } from '../weather';
import type { FacetQuantity } from './facet';

/** What a quantity reader may use: reads and derived values, never a change. */
export type QuantityReads = Pick<DerivedReads, 'derived' | 'stats' | 'resolved'> & {
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
};

type Kind = 'prob' | 'mult' | 'flat' | 'rate' | 'pool' | 'cap' | 'scalar';
type Role = 'vitality' | 'evade' | 'coverage';

interface StatRow {
  /** The shared id when InfiniteGacha has the same number; `ksg.<key>` otherwise. */
  id?: string;
  kind: Kind;
  role?: Role;
}

/** One row per derived stat. `Record<StatKey, ...>` keeps it total: a new stat fails svelte-check until it has a row. */
const STATS: Record<StatKey, StatRow> = {
  maxHp: { id: 'fighter.maxHpAbs', kind: 'pool', role: 'vitality' },
  hpRegen: { kind: 'rate' },
  damage: { id: 'fighter.damage', kind: 'flat' },
  attackSpeed: { kind: 'mult' },
  extraSwings: { kind: 'flat' },
  dodge: { id: 'fighter.dodge', kind: 'prob', role: 'evade' },
  crit: { id: 'fighter.crit', kind: 'prob' },
  armor: { id: 'fighter.armor', kind: 'flat', role: 'coverage' },
  spellPower: { id: 'fighter.magicDamage', kind: 'flat' },
  skillXp: { kind: 'mult' },
  trainXp: { kind: 'mult' },
  loot: { kind: 'mult' },
  goldGain: { kind: 'mult' },
  travelSpeed: { kind: 'mult' },
  craftSpeed: { kind: 'mult' },
  foodDuration: { kind: 'mult' },
  foodPotency: { kind: 'mult' },
  critDamage: { id: 'fighter.critDamage', kind: 'mult' },
  penetration: { id: 'fighter.penetration', kind: 'prob' },
  splash: { id: 'fighter.splash', kind: 'prob' },
  parry: { id: 'fighter.parry', kind: 'prob', role: 'evade' },
  riposte: { kind: 'flat' },
  speed: { id: 'fighter.speed', kind: 'rate' },
  actionBar: { kind: 'flat' },
  maxStamina: { id: 'pool.stamina.max', kind: 'pool' },
  staminaRegen: { kind: 'rate' },
  staminaEff: { kind: 'mult' },
  staminaPower: { kind: 'mult' },
  maxMana: { id: 'pool.mana.max', kind: 'pool' },
  manaRegen: { kind: 'rate' },
  manaEff: { kind: 'mult' },
  maxSpirit: { id: 'pool.spirit.max', kind: 'pool' },
  maxFocus: { id: 'pool.focus.max', kind: 'pool' },
  focusRegen: { kind: 'rate' },
  psiPressure: { kind: 'mult' },
  psiMomentum: { kind: 'mult' },
  psiInertia: { kind: 'mult' },
  psiAcuity: { kind: 'mult' },
  psiAwareness: { kind: 'mult' },
  psiCoherence: { kind: 'mult' },
  psiPurchase: { kind: 'mult' },
  resSlashing: { id: 'res.slashing', kind: 'prob', role: 'coverage' },
  resPiercing: { id: 'res.piercing', kind: 'prob', role: 'coverage' },
  resBludgeoning: { id: 'res.bludgeoning', kind: 'prob', role: 'coverage' },
  resHeat: { id: 'res.heat', kind: 'prob', role: 'coverage' },
  resCold: { id: 'res.cold', kind: 'prob', role: 'coverage' },
  resPoison: { id: 'res.poison', kind: 'prob', role: 'coverage' },
  resAcid: { id: 'res.acid', kind: 'prob', role: 'coverage' },
  resArcane: { id: 'res.arcane', kind: 'prob', role: 'coverage' },
  resLightning: { id: 'res.lightning', kind: 'prob', role: 'coverage' },
  resEarth: { id: 'res.earth', kind: 'prob', role: 'coverage' },
  resWind: { id: 'res.wind', kind: 'prob', role: 'coverage' },
  resWater: { id: 'res.water', kind: 'prob', role: 'coverage' },
  resLight: { id: 'res.light', kind: 'prob', role: 'coverage' },
  resDark: { id: 'res.dark', kind: 'prob', role: 'coverage' },
  damageTaken: { kind: 'mult', role: 'coverage' },
  ward: { id: 'fighter.ward', kind: 'flat', role: 'coverage' },
  resElemental: { kind: 'prob', role: 'coverage' },
  resRanged: { kind: 'prob', role: 'coverage' },
  critTaken: { kind: 'mult' },
  stumbleTaken: { kind: 'mult' },
  resistCap: { id: 'fighter.resistCap', kind: 'cap' },
  vsSmaller: { kind: 'flat' },
  fromSmaller: { kind: 'flat' },
  vsLarger: { kind: 'flat' },
  missRefund: { kind: 'prob' },
  graze: { kind: 'prob' },
};

/** The pools whose current value is a quantity, and the pools a document may spend. HP is `fighter.hp`. */
export const FACET_POOLS: ResourceId[] = ['stamina', 'mana', 'spirit', 'focus'];

type Reader = (ctx: QuantityReads) => number;

interface Entry {
  def: FacetQuantity;
  read: Reader;
}

function build(): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const add = (def: FacetQuantity, read: Reader) => out.set(def.id, { def, read });

  for (const a of ATTRIBUTE_IDS) {
    add(
      { id: 'stat.eff.' + a, label: attrName(a), kind: 'attribute', namespace: 'stat', nullifiable: false, writable: true, modStat: a, modOps: ['add', 'mult'] },
      (ctx) => effectiveAttr(ctx, a),
    );
  }

  for (const key of Object.keys(STATS) as StatKey[]) {
    const row = STATS[key];
    const id = row.id ?? 'ksg.' + key;
    const vital = row.role === 'vitality';
    add(
      {
        id,
        label: STAT_NAMES[key],
        kind: row.kind,
        namespace: id.slice(0, id.indexOf('.')),
        nul: row.kind === 'mult' ? 1 : 0,
        nullifiable: !vital && row.kind !== 'cap',
        writable: row.kind !== 'cap',
        sealed: row.kind === 'cap',
        mortalRole: row.role ?? null,
        modStat: key,
        modOps: ['add', 'mult'],
      },
      (ctx) => statOf(ctx, key),
    );
  }

  // Never written and never severed: the mortality proof protects this number.
  add(
    { id: 'fighter.hp', label: 'HP', kind: 'pool', namespace: 'fighter', nullifiable: false, writable: false, mortalRole: 'vitality', modStat: null },
    (ctx) => resourceValue(ctx.read(resources), 'hp'),
  );
  // Character level. Read-only.
  add(
    { id: 'fighter.level', label: 'Level', kind: 'scalar', namespace: 'fighter', nullifiable: false, writable: false, modStat: null },
    (ctx) => ctx.read(levels).level,
  );
  // 1 on the spot's boss. The player is never one; an enemy answers it through the host.
  add(
    { id: 'fighter.boss', label: 'Boss', kind: 'scalar', namespace: 'fighter', nullifiable: false, writable: false, modStat: null },
    () => 0,
  );
  for (const p of FACET_POOLS) {
    add(
      { id: 'pool.' + p + '.cur', label: p + ' (current)', kind: 'pool', namespace: 'pool', modStat: null },
      (ctx) => resourceValue(ctx.read(resources), p),
    );
  }
  // The world around the bearer. Read-only.
  add(
    { id: 'world.sunlight', label: 'Sunlight', kind: 'prob', namespace: 'world', nullifiable: false, writable: false, modStat: null },
    (ctx) => sunlight(ctx),
  );
  // Weakest Weapon Master's Power reads these. Read-only.
  add(
    { id: 'ksg.martialTotal', label: 'Combat skill levels', kind: 'scalar', namespace: 'ksg', nullifiable: false, writable: false, modStat: null },
    (ctx) =>
      Object.entries(ctx.read(skills).skills).reduce((n, [id, k]) => n + (SKILLS[id]?.category === 'combat' ? k.level : 0), 0),
  );
  add(
    { id: 'ksg.techniqueTotal', label: 'Technique reps', kind: 'scalar', namespace: 'ksg', nullifiable: false, writable: false, modStat: null },
    (ctx) => Object.values(ctx.read(martial).techniques ?? {}).reduce((n, t) => n + t.executions, 0),
  );
  // Trained CON + STR, without bonuses: the body Calorie Burn's store grows with.
  add(
    { id: 'ksg.trainedBody', label: 'Trained CON + STR', kind: 'scalar', namespace: 'ksg', nullifiable: false, writable: false, modStat: null },
    (ctx) => ctx.read(attributes).attrs.con.level + ctx.read(attributes).attrs.str.level,
  );
  // 1 unless a ranged weapon is held (an item tagged `ranged`).
  add(
    { id: 'ksg.melee', label: 'Melee', kind: 'scalar', namespace: 'ksg', nullifiable: false, writable: false, modStat: null },
    (ctx) => (hasWieldTag(ctx, 'ranged') ? 0 : 1),
  );
  // Statues standing in the bearer's fight (Stoneskin), 0 out of one.
  add(
    { id: 'world.statues', label: 'Statues', kind: 'scalar', namespace: 'world', nullifiable: false, writable: false, modStat: null },
    (ctx) => {
      const held = ctx.read(statuses);
      return (ctx.read(combat).fight?.enemies ?? []).filter((e) => e && statueOf(heldOf(held, e.entity))).length;
    },
  );
  return out;
}

const ENTRIES = build();

/** The registry rows handed to `Facet.install` through `host.quantities()`. */
export function facetQuantities(): FacetQuantity[] {
  return [...ENTRIES.values()].map((e) => e.def);
}

/** The player's native value of a quantity, or undefined for an id this game does not register. */
export function readQuantity(ctx: QuantityReads, id: string): number | undefined {
  return ENTRIES.get(id)?.read(ctx);
}
