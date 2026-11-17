/**
 * Monster generation. Port of `eligibleEncounters`, `encounterPowerRatio`,
 * `spotCleared`, `spawnMonster`, `rollGroupSize`, `spawnGroup`,
 * `warrantsAppearsLine`, `spawnHp`, `pendingWounds` of the old
 * `systems/combat.ts`, and `dynamicLevelBonus` of the old `systems/levels.ts`.
 *
 * The site replaces the old `SpotDef`. The order of the random draws is the
 * old order.
 */
import type { Ctx, DeepReadonly } from '../../kernel';
import clock, { clockOf, totalTicksOf } from '../clock';
import counters, { conditionsMet, counterValue } from '../counters';
import levels, { encounterLevel, levelOf } from '../levels';
import { mercyTracked, rollMercyPick } from '../mercy';
import {
  baseMonsterAttrs,
  ENCOUNTER_SLOTS,
  innateArmor,
  MODIFIER_TIERS,
  MODIFIER_WEIGHTS,
  MONSTERS,
  RARITIES,
  RARITY_WEIGHTS,
  rollMonsterAttrs,
  scaledMonsterAttrs,
  TIERS,
  type ModifierTierId,
  type MonsterDef,
  type MonsterRarityId,
} from '../monsters';
import { conditionReader } from '../skills';
import { ATTRIBUTE_IDS, finalAttributes, monsterStatsFromAttrs, statBlockOf } from '../stats';
import type { CombatState, EncounterLine, EncounterSite, Enemy, Fight } from './types';

type C = Ctx<CombatState>;

/** Where a site remembers a `once` kill. */
export const slainKey = (siteId: string, monsterId: string): string => `slain:${siteId}:${monsterId}`;
/** Where a site with a `fightLimit` counts its wins. */
export const fightsKey = (siteId: string): string => `fights:${siteId}`;
/** Where a site remembers its boss going down. One counter for every boss line of the site. */
export const bossKey = (siteId: string): string => `boss:${siteId}`;

/** The most of its max HP a monster that keeps its wounds can carry between fights. */
export const KEPT_WOUND_CAP = 0.95;

/** Fallback distribution of group sizes. */
export const DEFAULT_GROUP_WEIGHTS: { size: number; weight: number }[] = [
  { size: 1, weight: 70 },
  { size: 2, weight: 18 },
  { size: 3, weight: 8 },
  { size: 4, weight: 3 },
  { size: 5, weight: 1 },
];

/** How dark the sky is at this hour before moonlight. The night boundary of `daypart` lines. */
export function naturalDarkness(hour: number): number {
  if (hour >= 20 || hour <= 4) return 1;
  if (hour === 19 || hour === 5) return 0.5;
  return 0;
}

/** Whether this monster is a boss of the site. */
export function isSiteBoss(site: DeepReadonly<EncounterSite> | null, defId: string): boolean {
  return !!site?.encounters.some((e) => e.boss && e.monsterId === defId);
}

/**
 * Player power against a line's own: damage times max HP on both sides, the
 * line at the middle of its level range and of its tier's multiplier range.
 */
export function encounterPowerRatio(ctx: C, line: DeepReadonly<EncounterLine>): number {
  const def = MONSTERS[line.monsterId];
  if (!def) return 0;
  const tier = TIERS[def.tier];
  const mult = (tier.multiplierRange[0] + tier.multiplierRange[1]) / 2;
  const level = (line.level[0] + line.level[1]) / 2;
  const theirs = monsterStatsFromAttrs(
    scaledMonsterAttrs(def, level, mult),
    undefined,
    innateArmor(line.monsterId),
    def.regen ?? 0,
    level,
  );
  const mine = statBlockOf(ctx);
  const power = (s: { damage: number; maxHp: number }) => Math.max(1, s.damage * s.maxHp);
  return power(mine) / power(theirs);
}

/**
 * The lines the site can still roll: a `once` line whose kill is on record
 * is gone, a gated line waits for its conditions, a `daypart` line follows
 * the clock, a `window` line follows the power ratio.
 *
 * A `sky` line needs the weather over the site, which arrives with the world
 * port. Until then it does not roll, and the skip log says so.
 */
export function eligibleEncounters(ctx: C, site: DeepReadonly<EncounterSite>): DeepReadonly<EncounterLine>[] {
  const night = naturalDarkness(clockOf(totalTicksOf(ctx.read(clock))).hour) >= 0.5;
  const counts = ctx.read(counters);
  return site.encounters.filter((e) => {
    if (e.once && counterValue(counts, slainKey(site.id, e.monsterId)) > 0) return false;
    if (e.daypart && (e.daypart === 'night') !== night) return false;
    if (e.sky) {
      ctx.skip('combat/encounter', `line "${e.monsterId}" of "${site.id}" needs the sky (world port)`);
      return false;
    }
    if (e.window) {
      const ratio = encounterPowerRatio(ctx, e);
      if (ratio < e.window.min || ratio > e.window.max) return false;
    }
    return !e.requires || conditionsMet(conditionReader(ctx), e.requires as EncounterLine['requires'] & object);
  });
}

/** True when the site's fight budget is spent. `extra` counts a win bumped in this handler and not yet in the counter. */
export function siteCleared(ctx: C, site: DeepReadonly<EncounterSite>, extra = 0): boolean {
  return !!site.fightLimit && counterValue(ctx.read(counters), fightsKey(site.id)) + extra >= site.fightLimit;
}

const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Dynamic monster levels. On a site whose band sets the rule, a table-rolled
 * spawn gains levels while the player is ahead of it. With P the mean of the
 * player's three highest final attributes, M the mean of the monster's three
 * highest book attributes at the rolled level L and g their mean growth:
 *
 *   min(cap, floor(factor x max(0, P - M) / g)),  cap = max(1, floor(capShare x L))
 *
 * No random draw.
 */
export function dynamicLevelBonus(ctx: C, site: DeepReadonly<EncounterSite>, monsterId: string, level: number): number {
  const dyn = site.dynamicLevel;
  const def = MONSTERS[monsterId];
  if (!dyn || !def) return 0;
  const final = finalAttributes(ctx);
  const mine = ATTRIBUTE_IDS.map((id) => final[id]).sort((a, b) => b - a);
  const book = baseMonsterAttrs(def, level);
  const top = [...ATTRIBUTE_IDS].sort((a, b) => book[b] - book[a]).slice(0, 3);
  const growth = meanOf(top.map((id) => def.growth[id] ?? 0));
  if (!(growth > 0)) return 0;
  const gap = meanOf(mine.slice(0, 3)) - meanOf(top.map((id) => book[id]));
  const cap = Math.max(1, Math.floor(dyn.capShare * level));
  return Math.min(cap, Math.max(0, Math.floor((dyn.factor * gap) / growth)));
}

function rollRange(ctx: C, range: readonly [number, number] | readonly number[]): number {
  return range[0] + ctx.rng.next() * (range[1] - range[0]);
}

const randInt = (ctx: C, min: number, max: number): number => min + ctx.rng.int(max - min + 1);

/** Weighted pick, one draw. */
function weightedPick<T extends { weight: number }>(ctx: C, entries: readonly T[]): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = ctx.rng.next() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

/** Weighted pick under drought protection, through the mercy ledger. One draw. */
function mercyPick<T extends { weight: number }>(ctx: C, entries: readonly T[], keyOf: (entry: T) => string): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  const keys = entries.map((e) => (total > 0 && mercyTracked(e.weight / total) ? keyOf(e) : null));
  return entries[ctx.request(rollMercyPick, { weights: entries.map((e) => e.weight), keys })];
}

/** The level a table line spawns at, before dynamic levels: the roll, the line's rise, the band's step. */
function steppedLevel(ctx: C, site: DeepReadonly<EncounterSite>, line: DeepReadonly<EncounterLine>, rolled: number): number {
  const rise = line.levelRise;
  const counter = rise ? counterValue(ctx.read(counters), rise.stat) : 0;
  return encounterLevel(rise, counter, levelOf(ctx.read(levels)), rolled) + (site.levelStep ?? 0);
}

/** The HP a spawn starts on: its max, or less the stored share for a monster that keeps its wounds, at least 1. */
function spawnHp(ctx: C, def: MonsterDef, maxHp: number): number {
  const kept = def.keepsWounds;
  if (!kept) return maxHp;
  const share = Math.max(0, Math.min(KEPT_WOUND_CAP, counterValue(ctx.read(counters), kept.key)));
  return Math.max(1, Math.round(maxHp * (1 - share)));
}

export interface SpawnOverride {
  monsterId: string;
  level: number;
  /** Skip the modifier and rarity rolls. */
  plain?: boolean;
  /** How much of `level` is dynamic levels. */
  levelBonus?: number;
}

/**
 * Mint one monster. Without `override` the site's table is rolled under
 * drought protection. Its `wears` are applied by the caller once the monster
 * is in the fight: its stat block is read from the slice.
 */
export function spawnMonster(ctx: C, site: DeepReadonly<EncounterSite>, override?: SpawnOverride): Enemy {
  const table = eligibleEncounters(ctx, site);
  const pick: Pick<DeepReadonly<EncounterLine>, 'monsterId' | 'level' | 'levelRise' | 'once'> = override
    ? { monsterId: override.monsterId, level: [override.level, override.level] }
    : mercyPick(ctx, table, (e) => `spawn:${site.id}:${e.monsterId}`);
  const def = MONSTERS[pick.monsterId];
  if (!def) throw new Error(`combat: site "${site.id}" names the unknown monster "${pick.monsterId}"`);

  // A pinned level is final. A rolled one takes the line's rise, then the
  // band's step, then the dynamic levels, never on a `once` line.
  const rolled = randInt(ctx, pick.level[0], pick.level[1]);
  const stepped = override ? rolled : steppedLevel(ctx, site, pick as DeepReadonly<EncounterLine>, rolled);
  const levelBonus = override
    ? (override.levelBonus ?? 0)
    : pick.once
      ? 0
      : dynamicLevelBonus(ctx, site, pick.monsterId, stepped);
  const level = override ? rolled : stepped + levelBonus;
  const paid = level - levelBonus;

  // Three axes: the tier's rolled multiplier, the rolled modifier, the rolled rarity.
  const tier = TIERS[def.tier];
  const tierMult = rollRange(ctx, tier.multiplierRange);
  const modifierWeights: { id: ModifierTierId; weight: number }[] = site.modifierWeights
    ? (Object.entries(site.modifierWeights) as [ModifierTierId, number][]).map(([id, weight]) => ({ id, weight }))
    : MODIFIER_WEIGHTS;
  const modifier = override?.plain
    ? MODIFIER_TIERS.normal
    : MODIFIER_TIERS[mercyPick(ctx, modifierWeights, (e) => `mod:${site.id}:${e.id}`).id];
  const modifierMult = rollRange(ctx, modifier.multiplierRange);
  const rarity = override?.plain
    ? RARITIES.common
    : RARITIES[mercyPick(ctx, RARITY_WEIGHTS, (e) => `rarity:${e.id}`).id];

  const statMult = tierMult * modifierMult * rarity.statMult;
  const rewardMult = tier.rewardMult * modifier.rewardMult * rarity.statMult;

  const nameParts = [rarity.name, modifier.name, def.name].filter(Boolean);
  const attrs = rollMonsterAttrs(ctx.rng, def, level, statMult);
  const maxHp = monsterStatsFromAttrs(attrs).maxHp;
  const entity = `m${ctx.state.nextEntity++}`;
  const spawned: Enemy = {
    entity,
    defId: def.id,
    name: nameParts.join(' '),
    icon: def.icon,
    level,
    tier: def.tier,
    modifier: modifier.id as ModifierTierId,
    rarity: rarity.id as MonsterRarityId,
    attrs,
    hp: spawnHp(ctx, def, maxHp),
    range: def.range ?? 'melee',
    bar: 0,
    stunSpent: 0,
    xp: def.xp * (1 + 0.35 * (paid - 1)) * rewardMult,
    gold: def.gold
      ? Math.round(randInt(ctx, def.gold[0], def.gold[1]) * paid * tier.rewardMult * modifier.rewardMult)
      : 0,
    ...(levelBonus ? { levelBonus } : {}),
  };
  return spawned;
}

/** How many show up: the leader's own rule, then the site's distribution, then the default. */
function rollGroupSize(ctx: C, site: DeepReadonly<EncounterSite>, leader: MonsterDef): number {
  const spec = leader.group;
  const weights = spec?.weights ?? site.groupWeights ?? DEFAULT_GROUP_WEIGHTS;
  const entries = weights.filter((e) => e.weight > 0);
  const rolled = entries.length ? weightedPick(ctx, entries).size : 1;
  const min = spec?.min ?? 1;
  const max = spec?.max ?? ENCOUNTER_SLOTS;
  return Math.max(1, Math.min(ENCOUNTER_SLOTS, Math.max(min, Math.min(max, rolled))));
}

/** Lay members into the five slots, a melee in the centre when the group has one. */
export function formation(members: Enemy[]): (Enemy | null)[] {
  const front = members.findIndex((m) => m.range === 'melee');
  if (front > 0) [members[0], members[front]] = [members[front], members[0]];
  const slots: (Enemy | null)[] = Array(ENCOUNTER_SLOTS).fill(null);
  members.slice(0, ENCOUNTER_SLOTS).forEach((m, i) => (slots[i] = m));
  return slots;
}

/**
 * Roll a full formation. The leader comes from the site table; the rest are
 * its declared escorts at the leader's level, or new rolls from the table.
 */
export function spawnGroup(ctx: C, site: DeepReadonly<EncounterSite>): (Enemy | null)[] {
  const leader = spawnMonster(ctx, site);
  const leaderDef = MONSTERS[leader.defId];
  const size = rollGroupSize(ctx, site, leaderDef);
  const escorts = leaderDef.escorts;

  // Fillers: no encounter leader (it demands a squad of its own) and no
  // solitary monster. Drawn from the eligible table, so a slain `once` boss
  // cannot come back as an escort.
  const filler = eligibleEncounters(ctx, site).filter((e) => {
    const spec = MONSTERS[e.monsterId]?.group;
    return (spec?.min ?? 1) <= 1 && (spec?.max ?? ENCOUNTER_SLOTS) > 1;
  });

  const members: Enemy[] = [leader];
  for (let i = 1; i < size; i++) {
    if (escorts?.length) {
      members.push(
        spawnMonster(ctx, site, {
          monsterId: escorts[randInt(ctx, 0, escorts.length - 1)],
          level: leader.level,
          levelBonus: leader.levelBonus,
        }),
      );
    } else if (filler.length) {
      const pick = weightedPick(ctx, filler);
      const stepped = steppedLevel(ctx, site, pick, randInt(ctx, pick.level[0], pick.level[1]));
      const levelBonus = pick.once ? 0 : dynamicLevelBonus(ctx, site, pick.monsterId, stepped);
      members.push(spawnMonster(ctx, site, { monsterId: pick.monsterId, level: stepped + levelBonus, levelBonus }));
    } else {
      members.push(spawnMonster(ctx, site));
    }
  }
  return formation(members);
}

/**
 * Whether a spawn gets an "appears" line in the main log: modifier boss or
 * aberrant, rarity epic, or a `boss` or `once` line of the site.
 */
export function warrantsAppearsLine(
  m: Pick<Enemy, 'modifier' | 'rarity' | 'defId'>,
  site?: DeepReadonly<Pick<EncounterSite, 'encounters'>> | null,
): boolean {
  return (
    m.modifier === 'boss' ||
    m.modifier === 'aberrant' ||
    m.rarity === 'epic' ||
    !!site?.encounters.some((e) => (e.boss || e.once) && e.monsterId === m.defId)
  );
}

/**
 * What each standing monster that keeps its wounds would carry away if the
 * fight ended now, by counter key: the wounds it came in with, plus `share`
 * times the part of its max HP lost in this fight, held to
 * [0, KEPT_WOUND_CAP]. Two of one monster keep the larger share.
 */
export function pendingWounds(ctx: C, fight: DeepReadonly<Fight> | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!fight) return out;
  const counts = ctx.read(counters);
  for (const e of fight.enemies) {
    if (!e) continue;
    const kept = MONSTERS[e.defId]?.keepsWounds;
    if (!kept) continue;
    const missing = 1 - e.hp / monsterStatsFromAttrs(e.attrs).maxHp;
    const before = Math.max(0, Math.min(KEPT_WOUND_CAP, counterValue(counts, kept.key)));
    const share = Math.max(0, Math.min(KEPT_WOUND_CAP, before + kept.share * Math.max(0, missing - before)));
    out[kept.key] = Math.max(out[kept.key] ?? 0, share);
  }
  return out;
}
