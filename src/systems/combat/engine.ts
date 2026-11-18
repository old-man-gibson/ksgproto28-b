/**
 * The fight. Port of the in-scope parts of the old `systems/combat.ts`:
 * fight start, the combat tick, the player's normal attack, enemy attacks,
 * kill, defeat, close and abandon. Each function names the old one it ports.
 * The order of the phases and of the random draws is the old order.
 *
 * Every function takes the combat context. Another system's state is read
 * with `ctx.read`, and changed with a request when the outcome is needed
 * here and with an event otherwise (docs/KERNEL.md section 7a).
 */
import { defineEvent, PLAYER, TPS, type Ctx, type DeepReadonly } from '../../kernel';
import { grantAttrXp } from '../attributes';
import clock, { totalTicksOf } from '../clock';
import counters, { bumpCounter, clearCounter, counterValue, setCounter } from '../counters';
import { addGold } from '../gold';
import items, {
  dropWorn,
  grantsOf,
  handSwingShare,
  itemDefOf,
  runeEffectAt,
  RUNES,
  weaponDef,
  wielderRank,
} from '../items';
import levels, { grantLevelXp, KILL_LEVEL_XP_RATE, killXp, levelOf, rewardLevel } from '../levels';
import {
  feedFloatingRun,
  feedLine,
  feedRepeatLine,
  feedSettle,
  fillText,
  floatingRun,
  huntLine,
  logLine,
  transcriptClose,
  transcriptOpen,
  type DamageReport,
  type DamageStep,
  type LogTally,
} from '../log';
import log from '../log';
import { rollDropTable } from '../loot';
import { rollProcChance } from '../mercy';
import {
  biasAttrs,
  ENCOUNTER_SLOTS,
  kitOf,
  MODIFIER_TIERS,
  MONSTERS,
  monsterSize,
  monsterSizeRank,
  monsterTagSet,
  penetrationOf,
  RARITIES,
  type MonsterKit,
} from '../monsters';
import resources, {
  attackUpkeep,
  availableMax,
  DOUSING_TYPES,
  drawNow,
  exertNow,
  hitPlayer,
  isAlive,
  NO_EXERTION,
  poolHooks,
  resourceValue,
  rollExtraHits,
  setPace,
  type DamageSource,
  type Exertion,
} from '../resources';
import { checkDiscovery, grantSkillXp } from '../skills';
import {
  actionTicks,
  attackFillRate,
  ELEMENTAL_TYPES as ELEMENTAL,
  MONSTER_ACTION_BAR,
  monsterStatsFromAttrs,
  PARRY_CAP,
  RES_STAT_BY_TYPE,
  statBlockOf,
  vsVariant,
  type AttributeId,
  type DamageType,
  type DerivedStats,
} from '../stats';
import statuses, {
  applyStatus,
  applyStatuses,
  consumeMagnetCharge,
  consumeSkippedAction,
  dueGraftSpread,
  fireStatusEvent,
  forgetEntity,
  graftHarvest,
  hasStatus,
  heldOf,
  heldWith,
  magnetBypassesDodge,
  magnetCritChance,
  setSituation,
  statueOf,
  statusBarDamage,
  statusBlocks,
  statusBlocksRangedType,
  statusDisadvantage,
  statusDisplacedExit,
  statusIncomingDamageMult,
  statusIncomingMissChance,
  statusMissChance,
  statusNegativeHeadroom,
  statusPacifiesFlankers,
  statusRetaliation,
  statusReversesBar,
  STATUSES,
  tendOnDamage,
  tickStatuses,
  toApplication,
  type HeldList,
  type StatusApplication,
  type StatusTickResult,
  reform,
  removeStatus,
  writeSurplus,
} from '../statuses';
import {
  armInterception,
  blowRiders,
  monsterActionHandler,
  monsterActionKind,
  playerActionHandler,
  playerActionKinds,
  type ActionCtx,
  type BlowRiderKind,
  type MonsterShape,
  type PickedActive,
} from './actions';
import { evaluateTrigger } from './triggers';
import {
  addSlice,
  heaviestType,
  incomingSlice,
  monsterSlice,
  POSITION_MODS,
  resNote,
  WEAPON_DAMAGE_TYPES,
  type TypedSlice,
} from './damage';
import { beginFight, noteAbsorbed, noteDodge, noteOutgoing, noteParry } from './ledger';
import {
  bossKey,
  eligibleEncounters,
  fightsKey,
  formation,
  isSiteBoss,
  pendingWounds,
  siteCleared,
  slainKey,
  spawnGroup,
  spawnMonster,
  warrantsAppearsLine,
} from './spawn';
import { TEXT } from './text';
import {
  NEUTRAL_POSITION,
  type CombatBuff,
  type CombatState,
  type EncounterSite,
  type Enemy,
  type Fight,
  type FightOutcome,
} from './types';

type C = Ctx<CombatState>;

// ---- constants ----

/** Ticks between the end of a fight and the next roll. Doubled after a defeat. */
export const RESPAWN_DELAY = 15;
/** Touched when the player's position in the fight changes. It states nothing itself: a source that reads the position lists it in `dependsOn`. */
export const POSITION_SOURCE = 'combat/position';
/** States the buffs of the fight on the player. */
export const BUFFS_SOURCE = 'combat/buffs';
/** Ticks before a monster may repeat a technique that declares no cooldown. */
export const TECHNIQUE_MONSTER_COOLDOWN = 60;
/** Intensity of the hunger a fasting body hands out per point of wisdom. */
export const HUNGER_PER_WISDOM = 0.01;
/** Share of a swing lost per unit of darkness. Old `exposure.ts`. */
export const DARK_MISS_CHANCE = 0.15;
/** Share of dodge lost per unit of darkness. Old `exposure.ts`. */
export const DARK_DODGE_PENALTY = 0.25;
/** The monster whose fight opens with a 30-tick address. Old `floodedFloor.ts`. */
export const TOLL_GOLEM = 'toll_collector_golem';

const PLAYER_CRIT = 'proc:crit';
const monsterCritKey = (defId: string): string => `proc:crit:${defId}`;

/** Floating feed runs of the enemy line-up. */
export const FOES_COND_RUN = 'cond:foes';
export const FOES_REGEN_RUN = 'regen:foes';

// ---- hook stats ----

export const hook = {
  /** 0 to 1. The old `darknessFactor`. */
  darkness: 'combat/darkness',
  /** The old `positionDodgeMult`. */
  positionDodgeMult: 'combat/positionDodgeMult',
  /** The old `positionIncomingMult`, before `stumbleTaken`. */
  positionIncomingMult: 'combat/positionIncomingMult',
  /** What the action bar fills at while a wind-up runs. The old `incantFillMult`. */
  barFillMult: 'combat/barFillMult',
} as const;

// ---- events ----

export interface EnemyRef {
  entity: string;
  defId: string;
  name: string;
  level: number;
}

const refOf = (e: DeepReadonly<Enemy>): EnemyRef => ({ entity: e.entity, defId: e.defId, name: e.name, level: e.level });

/** A fight began. The old `encounter` bus event and the `onEncounterStart` stamp. */
export const fightStarted = defineEvent<{ site: string; forced: boolean; enemies: EnemyRef[] }>('combat/fight-started');
/** A combatant's action bar completed. */
export const barFilled = defineEvent<{ entity: string }>('combat/bar-filled');

export type AttackOutcome = 'hit' | 'evaded' | 'fumbled' | 'dodged' | 'shrouded' | 'blocked' | 'parried' | 'harmless';
/** A normal attack was thrown. */
export const attackThrown = defineEvent<{ attacker: string; target: string; outcome: AttackOutcome }>('combat/attack');

export type HitKind = 'attack' | 'graze' | 'riposte' | 'spill' | 'condition' | 'strike';
/** Damage landed on a combatant. */
export const hitLanded = defineEvent<{
  attacker: string | null;
  target: string;
  total: number;
  crit: boolean;
  kind: HitKind;
  type: DamageType;
  /** The blow as thrown, before the target's defences. */
  thrown?: number;
}>('combat/hit');

/** An enemy died. The old `kill` bus event. */
export const enemyKilled = defineEvent<{
  entity: string;
  defId: string;
  name: string;
  level: number;
  rewardLevel: number;
  xp: number;
  tags: string[];
  lastHit: DamageType | null;
  site: string;
  boss: boolean;
  once: boolean;
}>('combat/kill');

/** The last enemy died. The old `fight:won`. */
export const fightWon = defineEvent<{ site: string; forced: boolean }>('combat/fight-won');
/** A fight ended for any reason. The old `fight:closed`. */
export const fightClosed = defineEvent<{ site: string; standing: EnemyRef[] }>('combat/fight-closed');

/**
 * The player went down in a fight. The old `defeat` bus event, with what
 * `onDefeat` handed to the retreat. The knockout (1 HP, recovery, the
 * retreat) belongs to the system that hears this.
 */
export const playerDefeated = defineEvent<{
  monster: EnemyRef | null;
  forced: boolean;
  outcome: FightOutcome;
  cause: string;
  site: string;
  /** A condition, not a blow of the fight, took the player to 0 HP. */
  byCondition: boolean;
}>('combat/defeat');

/** A rotation entry of a kind no system has registered was passed over. */
export const actionSkipped = defineEvent<{ entity: string; kind: string }>('combat/skipped-action');

/** To this system: close the fight ledger once the lines of this handler are in the transcript. */
export const closeLedger = defineEvent<{ outcome: FightOutcome; cause?: string }>('combat/close-ledger');

// ---- small reads ----

export const now = (ctx: C): number => totalTicksOf(ctx.read(clock));
const mine = (ctx: C): HeldList => heldOf(ctx.read(statuses));
const heldBy = (ctx: C, e: DeepReadonly<Enemy>): HeldList => heldOf(ctx.read(statuses), e.entity);
const statsOf = (ctx: C, e: DeepReadonly<Enemy>): Readonly<DerivedStats> => statBlockOf(ctx, e.entity);
const alive = (ctx: C): boolean => isAlive(ctx.read(resources));
const roller = (ctx: C) => (p: number) => ctx.rng.chance(p);
const randInt = (ctx: C, min: number, max: number): number => min + ctx.rng.int(max - min + 1);

/** Enemies still in the fight, in slot order. */
export function liveEnemies(fight: DeepReadonly<Fight>): DeepReadonly<Enemy>[] {
  return fight.enemies.filter((e): e is DeepReadonly<Enemy> => e !== null);
}

/** True while the live fight is one that cannot be walked away from. */
export function inForcedFight(state: DeepReadonly<CombatState>): boolean {
  return !!state.fight?.forced;
}

/** A fight against training equipment only. The old `isPracticeFight`. */
export function isPracticeFight(fight: DeepReadonly<Fight> | null): boolean {
  let any = false;
  for (const e of fight?.enemies ?? []) {
    if (!e || e.hp <= 0) continue;
    if (MONSTERS[e.defId]?.passive !== true) return false;
    any = true;
  }
  return any;
}

/** A monster's mind as a burn sees it: 1 x INT deep, recovering 0.01 x INT + 0.05 x WIS a second. */
export function monsterMind(e: DeepReadonly<Enemy>): { current: number; max: number; regen: number } {
  const int = Math.max(0, e.attrs.int ?? 0);
  const wis = Math.max(0, e.attrs.wis ?? 0);
  return { current: e.mana ?? int, max: int, regen: int * 0.01 + wis * 0.05 };
}

/** Burned past empty: the mind cannot shape a working until it recovers. */
export function mindInDebt(e: DeepReadonly<Enemy>): boolean {
  return (e.mana ?? 0) < 0;
}

// ---- writes to other systems ----

function feed(ctx: C, text: string, damage?: DamageReport): void {
  ctx.emit(feedLine, damage ? { text, damage } : { text });
}

function say(ctx: C, id: keyof typeof TEXT, params: Record<string, unknown> | undefined, kind: string): void {
  ctx.emit(logLine, { msg: fillText(TEXT[id], params), kind });
}

function bump(ctx: C, key: string, amount?: number): void {
  ctx.emit(bumpCounter, amount === undefined ? { key } : { key, amount });
}

/** Stamp a trigger event, so an active gated on it can react. The old `markCombatEvent`. */
export function markCombatEvent(ctx: C, event: string): void {
  if (ctx.state.fight) ctx.state.fight.events[event] = now(ctx);
}

/** Roll a chance of something going wrong. With disadvantage it is rolled twice and fails if either fails. */
function rollAgainst(ctx: C, badChance: number, disadvantage: boolean): boolean {
  if (badChance <= 0) return false;
  const first = ctx.rng.chance(badChance);
  if (!disadvantage) return first;
  return first || ctx.rng.chance(badChance);
}

/** Take the monster out of the kernel and out of the statuses slice. */
function forget(ctx: C, e: Enemy): void {
  ctx.emit(forgetEntity, { entity: e.entity });
  ctx.dropEntity(e.entity);
}

/**
 * The player takes damage, already reduced by every defence. The old
 * `damagePlayer`. The ledger attributes it when `resources/damaged` arrives.
 */
function damagePlayer(ctx: C, amount: number, type?: DamageType, source?: DamageSource | null): number {
  if (amount <= 0) return 0;
  return ctx.request(hitPlayer, {
    amount,
    ...(type ? { type } : {}),
    ...(source !== undefined ? { source } : {}),
  });
}

// ---- sizes ----

/** How many size steps the monster is below the player, floored at 0. */
function stepsSmaller(ctx: C, defId: string): number {
  return Math.max(0, wielderRank(ctx.read(items)) - monsterSizeRank(defId));
}

/** How many size steps the player is below the monster, floored at 0. */
function stepsLarger(ctx: C, defId: string): number {
  return Math.max(0, monsterSizeRank(defId) - wielderRank(ctx.read(items)));
}

/** The old `positionIncomingMult`: only a penalty is softened by `stumbleTaken`. */
function positionIncomingMult(ctx: C, stumbleTaken = 1): number {
  const mult = ctx.derived(hook.positionIncomingMult) || 1;
  return mult > 1 ? 1 + (mult - 1) * Math.max(0, stumbleTaken) : mult;
}

// ---- tags and the weapon ----

/** The tags a fight's XP is paid to. The old `combatTags`. */
export function combatTags(ctx: C): string[] {
  const tags = isPracticeFight(ctx.state.fight) ? ['combat'] : ['combat', 'hunt'];
  const worn = ctx.read(items).equipment;
  const weapon = worn.weapon;
  if (weapon) for (const t of itemDefOf(weapon)?.tags ?? []) tags.push(t);
  else tags.push('unarmed');
  const offhand = worn.offhand;
  if (offhand) for (const t of itemDefOf(offhand)?.tags ?? []) tags.push(t);
  tags.push(`style:${ctx.state.style.id}`);
  return tags;
}

/** Record which weapon family the player attacks with, once per family. */
function trackWeaponFamily(ctx: C): void {
  const weapon = ctx.read(items).equipment.weapon;
  if (!weapon) return;
  const tags = itemDefOf(weapon)?.tags ?? [];
  const family = tags.find((t) => t in WEAPON_DAMAGE_TYPES) ?? tags[0];
  if (!family || counterValue(ctx.read(counters), `used:${family}`)) return;
  bump(ctx, `used:${family}`);
  bump(ctx, 'weapon:families');
}

/** The damage type of the player's weapon attacks. Bare fists bludgeon. */
export function playerDamageType(ctx: Pick<C, 'read'>): DamageType {
  const def = weaponDef(ctx.read(items));
  if (!def) return 'bludgeoning';
  if (def.damageType) return def.damageType;
  for (const t of def.tags ?? []) {
    const type = WEAPON_DAMAGE_TYPES[t];
    if (type) return type;
  }
  return 'bludgeoning';
}

/** What the player's weapon damage is credited to in a damage report. */
export function weaponSource(ctx: Pick<C, 'read'>): string {
  return weaponDef(ctx.read(items))?.name ?? 'Bare hands';
}

// ---- a blow on an enemy ----

/**
 * A blow has landed on an enemy: tell its conditions, in the damage's own
 * type. Returns the damage a burned-off graft ledger paid out; the caller
 * applies it. The old `enemyTookDamage`.
 */
function enemyTookDamage(ctx: C, monster: Enemy, dealt: Map<DamageType, number>): number {
  if (dealt.size === 0) {
    ctx.request(fireStatusEvent, { entity: monster.entity, on: 'damageTaken' });
    return 0;
  }
  let harvested = 0;
  let heaviest = 0;
  for (const [type, amount] of dealt) {
    for (const h of graftHarvest(heldBy(ctx, monster), type)) {
      harvested += h.amount;
      if (h.amount > heaviest) {
        heaviest = h.amount;
        monster.lastHit = h.type;
      }
      feed(ctx, `${h.icon} The ${monster.name}'s ${h.name} is destroyed and deals ${Math.round(h.amount)} ${h.type} damage.`);
    }
    ctx.request(tendOnDamage, { entity: monster.entity, type });
    ctx.request(fireStatusEvent, { entity: monster.entity, on: 'damageTaken', detail: { damageType: type, amount } });
  }
  return harvested;
}

/** Take the graft harvest off the monster, as every damage site of the old code did. */
function applyHarvest(ctx: C, monster: Enemy, harvested: number): void {
  if (harvested <= 0) return;
  const burned = Math.max(1, Math.round(harvested));
  monster.hp -= burned;
  noteOutgoing(ctx.state, now(ctx), burned);
}

export interface EnemyStrike {
  type: DamageType;
  raw: number;
  /** Added to the attacker's penetration for this slice. */
  penetration?: number;
}

export interface EnemyDamageResult {
  dealt: number;
  killed: boolean;
  slices: TypedSlice[];
}

/**
 * Damage from outside the normal attack landing on an enemy: every slice
 * through the target's armour and resistance, at least 1 in total, its
 * conditions told, the graft harvest applied, the ledger written. The body
 * of the old `abilityStrike` and of each strike of `castCraftedAttack`. It
 * does not sweep the dead: the tick does.
 */
export function strikeEnemy(
  ctx: C,
  monster: Enemy,
  strikes: readonly EnemyStrike[],
  source: string,
  penetration = 0,
  kind: HitKind = 'strike',
): EnemyDamageResult {
  const stats = statsOf(ctx, monster);
  const slices = strikes.map((s) =>
    monsterSlice(stats, s.type, source, s.raw, Math.min(0.95, penetration + (s.penetration ?? 0))),
  );
  const dealt = Math.max(1, Math.round(slices.reduce((sum, s) => sum + s.dealt, 0)));
  monster.hp -= dealt;
  monster.lastHit = heaviestType(slices) ?? strikes[0]?.type ?? monster.lastHit;
  noteOutgoing(ctx.state, now(ctx), dealt);
  const byType = new Map<DamageType, number>();
  for (const s of slices) byType.set(s.type, (byType.get(s.type) ?? 0) + s.dealt);
  applyHarvest(ctx, monster, enemyTookDamage(ctx, monster, byType));
  ctx.emit(hitLanded, {
    attacker: PLAYER,
    target: monster.entity,
    total: dealt,
    crit: false,
    kind,
    type: monster.lastHit ?? 'bludgeoning',
  });
  return { dealt, killed: monster.hp <= 0, slices };
}

// ---- bar damage and retaliation ----

/**
 * Damage a condition deals as the player's action bar fills or bottoms out.
 * True when it was fatal. A jolt that takes the player under a share of
 * health makes them drop the weapon. The old `applyBarDamage`.
 */
function applyBarDamage(ctx: C, when: 'onFill' | 'onDeplete'): boolean {
  const stats = statBlockOf(ctx);
  for (const hit of ctx.request(statusBarDamage, { entity: PLAYER, when })) {
    const slice = incomingSlice(stats, hit.type, hit.name, hit.amount);
    const dealt = slice.dealt;
    damagePlayer(ctx, dealt);
    feed(ctx, `${hit.icon} ${hit.name} discharges for ${dealt} ${hit.type}.`, {
      label: hit.name,
      target: 'You',
      steps: [{ label: hit.name, value: hit.amount }],
      slices: [slice],
      hits: 1,
      crit: false,
      incoming: true,
      total: dealt,
    });
    if (!alive(ctx)) {
      onDefeat(ctx);
      return true;
    }
    if (
      hit.dropWeaponBelow !== undefined &&
      ctx.read(items).equipment.weapon &&
      resourceValue(ctx.read(resources), 'hp') < availableMax(stats, poolHooks(ctx), 'hp') * hit.dropWeaponBelow
    ) {
      const name = ctx.request(dropWorn, { slot: 'weapon' }) ?? 'your weapon';
      say(ctx, 'weapon_dropped', { name }, 'danger');
      feed(ctx, `⚡ You drop ${name}!`);
    }
  }
  return false;
}

/** The same discharge on an enemy. True when it killed the monster. The old `applyMonsterBarDamage`. */
function applyMonsterBarDamage(ctx: C, e: Enemy, when: 'onFill' | 'onDeplete'): boolean {
  for (const hit of ctx.request(statusBarDamage, { entity: e.entity, when })) {
    const slice = monsterSlice(statsOf(ctx, e), hit.type, hit.name, hit.amount, 0);
    e.hp -= slice.dealt;
    e.lastHit = hit.type;
    feed(ctx, `${hit.icon} ${hit.name} discharges through the ${e.name} for ${slice.dealt} ${hit.type}.`);
    if (e.hp <= 0) return true;
  }
  return false;
}

/**
 * The player's conditions that fire when they act or are struck. True when
 * the phase must stop: the player died, or the attacker died and the line
 * was swept. The old `applyRetaliation`.
 */
function applyRetaliation(ctx: C, when: 'onAttack' | 'onContact', attacker?: number): boolean {
  const back = statusRetaliation(mine(ctx), when);
  if (back.length === 0) return false;
  const stats = statBlockOf(ctx);
  for (const r of back) {
    if (r.hits === 'attacker') {
      const e = attacker === undefined ? null : ctx.state.fight?.enemies[attacker];
      if (!e || e.hp <= 0) continue;
      const slice = monsterSlice(statsOf(ctx, e), r.type, r.name, r.amount, 0);
      e.hp -= slice.dealt;
      e.lastHit = r.type;
      feed(ctx, `${r.icon} ${r.name} hits the ${e.name} for ${slice.dealt} ${r.type}.`);
      for (const app of r.inflicts ?? []) ctx.request(applyStatus, { entity: e.entity, app, source: r.name });
      if (e.hp <= 0) {
        sweepDead(ctx);
        return true;
      }
      continue;
    }
    const dealt = incomingSlice(stats, r.type, r.name, r.amount).dealt;
    damagePlayer(ctx, dealt);
    feed(ctx, `${r.icon} ${r.name} tears at you for ${dealt} ${r.type}.`);
    for (const app of r.inflicts ?? []) ctx.request(applyStatus, { entity: PLAYER, app, source: r.name, resist: true });
    if (!alive(ctx)) {
      onDefeat(ctx);
      return true;
    }
  }
  return false;
}

/** The same conditions on the enemy at `index`. True when the phase must stop. The old `applyMonsterRetaliation`. */
function applyMonsterRetaliation(ctx: C, index: number, when: 'onAttack' | 'onContact'): boolean {
  const e = ctx.state.fight?.enemies[index];
  if (!e || e.hp <= 0) return false;
  for (const r of statusRetaliation(heldBy(ctx, e), when)) {
    if (r.hits === 'attacker') {
      if (when !== 'onContact') continue;
      const stats = statBlockOf(ctx);
      const dealt = incomingSlice(stats, r.type, r.name, r.amount).dealt;
      damagePlayer(ctx, dealt);
      feed(ctx, `${r.icon} The ${e.name}'s ${r.name} hits you for ${dealt} ${r.type}.`);
      for (const app of r.inflicts ?? []) ctx.request(applyStatus, { entity: PLAYER, app, source: r.name, resist: true });
      if (!alive(ctx)) {
        onDefeat(ctx);
        return true;
      }
      continue;
    }
    const slice = monsterSlice(statsOf(ctx, e), r.type, r.name, r.amount, 0);
    e.hp -= slice.dealt;
    e.lastHit = r.type;
    feed(ctx, `${r.icon} ${r.name} hits the ${e.name} for ${slice.dealt} ${r.type}.`);
    for (const app of r.inflicts ?? []) ctx.request(applyStatus, { entity: e.entity, app, source: r.name });
    if (e.hp <= 0) {
      sweepDead(ctx);
      return true;
    }
  }
  return false;
}

/** A dead attacker is swept at once. True when the phase must stop. The old `answeredToDeath`. */
function answeredToDeath(ctx: C, e: Enemy): boolean {
  if (e.hp > 0 || !alive(ctx)) return false;
  sweepDead(ctx);
  return true;
}

// ---- grazes and misses ----

/**
 * A swing that missed, landing anyway for a share of itself. True when the
 * graze killed. The old `landGraze`.
 */
function landGraze(ctx: C, monster: Enemy, active: PickedActive | null, share = 1): boolean {
  const vs = statBlockOf(ctx, PLAYER, vsVariant(monsterTagSet(monster.defId)));
  if (vs.graze <= 0 || monster.hp <= 0) return false;
  const raw = vs.damage * share * (active?.shape?.damageMult ?? 1) * vs.graze;
  if (raw <= 0) return false;

  const type = playerDamageType(ctx);
  const slice = monsterSlice(statsOf(ctx, monster), type, 'Graze', raw, vs.penetration);
  const dealt = Math.max(1, Math.round(slice.dealt));
  monster.hp -= dealt;
  monster.lastHit = type;
  noteOutgoing(ctx.state, now(ctx), dealt);
  applyHarvest(ctx, monster, enemyTookDamage(ctx, monster, new Map([[type, dealt]])));

  markCombatEvent(ctx, 'onGraze');
  bump(ctx, 'combat:grazes');
  feed(ctx, `💢 Your attack misses but grazes for ${dealt} ${type}.`);
  ctx.emit(hitLanded, { attacker: PLAYER, target: monster.entity, total: dealt, crit: false, kind: 'graze', type, thrown: raw });

  if (monster.hp <= 0) {
    bump(ctx, 'kills:graze');
    onKill(ctx, 0);
    return true;
  }
  return false;
}

/** Give back a share of every remaining cooldown, because the swing missed. The old `shedCooldownsOnMiss`. */
function shedCooldownsOnMiss(ctx: C): void {
  const share = statBlockOf(ctx).missRefund;
  const c = ctx.state.fight;
  if (share <= 0 || !c) return;
  for (const [id, left] of Object.entries(c.cooldowns)) {
    if (left > 0) c.cooldowns[id] = Math.max(0, left - left * share);
  }
}

/** A monster's swing that was dodged, landing anyway for a share of itself. What it dealt, or 0. The old `landMonsterGraze`. */
function landMonsterGraze(ctx: C, e: Enemy, es: Readonly<DerivedStats>, positionMult: number): number {
  if (es.graze <= 0) return 0;
  const raw = es.damage * positionMult * es.graze;
  if (raw <= 0) return 0;
  const kit = kitOf(e);
  const type = kit.damageType;
  const slice = incomingSlice(statBlockOf(ctx), type, e.name, raw, 0, kit.range === 'ranged');
  const dealt = Math.max(1, Math.round(slice.dealt));
  damagePlayer(ctx, dealt, type, {
    key: `monster:${e.defId}`,
    label: e.name,
    icon: e.icon,
    by: e.entity,
    thrown: raw,
    boss: isSiteBoss(ctx.state.site, e.defId),
  });
  return dealt;
}

/**
 * Feed whatever is fasting in this fight. Called where a hostile action is
 * taken. The old `feedTheFast`.
 */
function feedTheFast(ctx: C, actor: string): void {
  const combat = ctx.state.fight;
  if (!combat) return;
  if (hasStatus(mine(ctx), 'fasting')) {
    ctx.request(applyStatus, {
      entity: actor,
      app: { id: 'hunger_anupama', intensity: ctx.derived('stats/formula:wis') * HUNGER_PER_WISDOM },
      source: 'your fast',
    });
  }
  for (const e of liveEnemies(combat)) {
    if (!hasStatus(heldBy(ctx, e), 'fasting')) continue;
    ctx.request(applyStatus, {
      entity: actor,
      app: { id: 'hunger_anupama', intensity: e.attrs.wis * HUNGER_PER_WISDOM },
      source: e.name,
    });
  }
}

/** Heavy stance's answer: the attacker is Rattled by the share of its blow that Power cut. */
function rattle(ctx: C, e: Enemy, intensity: number): void {
  if (intensity <= 0 || e.hp <= 0) return;
  ctx.request(applyStatus, { entity: e.entity, app: { id: 'rattled', intensity }, source: 'Heavy stance' });
}

// ---- fight start ----

export interface StagedMember {
  monsterId: string;
  level: number;
  /** Share of its (biased) maximum health it comes in with. */
  hpShare?: number;
  kit?: MonsterKit;
  /** Replaces the minted name. */
  name?: string;
  /** Attribute multipliers, scaled back to keep the total. */
  attrBias?: Partial<Record<AttributeId, number>>;
}

/** Start an encounter at the site. The old `startEncounter`. */
function startEncounter(ctx: C, site: EncounterSite, forced = false, enemies?: (Enemy | null)[]): void {
  ctx.state.site = site;
  const line = enemies ?? spawnGroup(ctx, site);
  const fight: Fight = {
    enemies: line,
    ...(line.some((e) => e?.defId === TOLL_GOLEM) ? { introTicks: 30 } : {}),
    playerBar: 0,
    momentum: 0,
    position: NEUTRAL_POSITION,
    cooldowns: {},
    events: {},
    ...(forced ? { forced: true } : {}),
    buffs: [],
  };
  ctx.state.fight = fight;

  // What a body is, on it before its first tick. Applied here and not in
  // `spawnMonster`: the monster's stat block is read from the slice.
  for (const e of liveEnemies(fight)) {
    const wears = MONSTERS[e.defId]?.wears;
    if (wears?.length)
      ctx.request(applyStatuses, { entity: e.entity, apps: wears.map(toApplication), source: MONSTERS[e.defId].name });
  }

  // Opening tempo: a fight that begins on enemies who have not registered it
  // hands the player the first move. The bar starts one tick short of full.
  if (liveEnemies(fight).some((e) => heldBy(ctx, e).some((s) => STATUSES[s.id]?.opensTempo))) {
    const stats = statBlockOf(ctx);
    fight.playerBar = Math.max(0, stats.actionBar - attackFillRate(stats));
  }

  markCombatEvent(ctx, 'onEncounterStart');
  beginFight(ctx.state, line, now(ctx));
  ctx.emit(transcriptOpen, undefined);
  ctx.emit(setSituation, { inCombat: true });
  ctx.emit(setPace, { inCombat: true });
  const group = liveEnemies(fight);
  ctx.emit(fightStarted, { site: site.id, forced, enemies: group.map(refOf) });
  const lead = group[0];
  // The main log names a spawn only when it is not routine. The feed names every spawn.
  const notable = group.find((m) => warrantsAppearsLine(m, site));
  if (notable) {
    const what = group.length > 1 ? `${notable.name} and ${group.length - 1} more` : notable.name;
    say(ctx, group.length > 1 ? 'appear_group' : 'appears', { what, level: notable.level }, 'combat');
  }
  feed(
    ctx,
    group.length > 1
      ? `${lead.icon} ${lead.name} (Lv ${lead.level}) and ${group.length - 1} others attack!`
      : `${lead.icon} ${lead.name} (Lv ${lead.level}) attacks!`,
  );
}

/**
 * The fight a site forces on arrival. False when nothing began: a fight is
 * open, the site is cleared, or no line is eligible. The old `startForcedFight`.
 */
export function startForcedFight(ctx: C, site: EncounterSite): boolean {
  if (ctx.state.fight || siteCleared(ctx, site) || !eligibleEncounters(ctx, site).length) return false;
  startEncounter(ctx, site, true);
  say(ctx, 'ambushed', undefined, 'danger');
  feed(ctx, `⚔️ You cannot flee this fight.`);
  return true;
}

/**
 * A staged formation, forced: each member pinned and plain, a melee in the
 * centre where the group has one. The old `startStagedGroup`.
 */
export function startStagedGroup(ctx: C, site: EncounterSite, members: readonly StagedMember[]): void {
  if (ctx.state.fight) abandonCombat(ctx);
  const minted = members.slice(0, ENCOUNTER_SLOTS).map((m) => {
    const monster = spawnMonster(ctx, site, { monsterId: m.monsterId, level: m.level, plain: true });
    if (m.name) monster.name = m.name;
    if (m.kit) {
      monster.kit = m.kit;
      monster.range = kitOf(monster).range;
    }
    if (m.attrBias) {
      monster.attrs = biasAttrs(monster.attrs, m.attrBias);
      monster.hp = monsterStatsFromAttrs(monster.attrs).maxHp;
    }
    if (m.hpShare !== undefined && m.hpShare < 1) {
      monster.hp = Math.max(1, Math.round(monster.hp * Math.max(0, m.hpShare)));
    }
    return monster;
  });
  startEncounter(ctx, site, true, formation(minted));
  feed(ctx, `⚔️ You cannot flee this fight.`);
}

// ---- kill, defeat, close ----

/** An enemy died. The old `onKill`, without the statue rules. */
function onKill(ctx: C, index: number): void {
  const c = ctx.state.fight!;
  const monster = c.enemies[index]!;
  const def = MONSTERS[monster.defId];
  const tags = combatTags(ctx);
  const site = ctx.state.site;
  const boss = isSiteBoss(site, monster.defId);
  const once = !!site?.encounters.some((e) => e.once && e.monsterId === monster.defId);

  // A `once` kill goes on the site's record the moment it happens, so a
  // knockout after the deed still keeps the deed.
  if (site && once) {
    bump(ctx, slainKey(site.id, monster.defId));
    say(ctx, 'unique_slain', { name: monster.name }, 'combat');
  }
  // A boss kill latches the site's boss counter. Announced the first time only.
  if (site && boss) {
    const first = counterValue(ctx.read(counters), bossKey(site.id)) === 0;
    bump(ctx, bossKey(site.id));
    if (first) say(ctx, 'keeper_slain', { spot: site.name }, 'combat');
  }
  // Its death ends the wounds it was carrying between fights.
  const kept = def?.keepsWounds;
  if (kept) ctx.emit(clearCounter, { key: kept.key });

  const gold = Math.round(monster.gold * statBlockOf(ctx).goldGain);
  if (gold > 0) ctx.request(addGold, { amount: gold, earned: true });
  // The XP is cut by how far the fighter has outgrown the monster; the same
  // number pays level XP.
  const xp = killXp(levelOf(ctx.read(levels)), monster);
  ctx.emit(grantSkillXp, { tags, amount: xp, sourceKey: monster.defId });
  const monsterTags = [...monsterTagSet(monster.defId)];
  if (def) {
    ctx.request(rollDropTable, {
      table: def.loot,
      source: monster.defId,
      tags: monsterTags,
      rewardMult: RARITIES[monster.rarity].lootMult * MODIFIER_TIERS[monster.modifier].rewardMult,
      rarity: monster.rarity,
      rewardLevel: rewardLevel(monster),
      size: monsterSize(monster.defId),
      ...(monster.lastHit ? { lastHit: monster.lastHit } : {}),
    });
  }
  // The kill's own line goes after its drops and before the kill event.
  ctx.emit(
    logLine,
    huntLine([
      { label: fillText(TEXT.hunt_kill, { icon: monster.icon, name: monster.name }).trim(), qty: 1 },
      ...(gold > 0 ? [{ label: 'gold', qty: gold, style: 'amount' as const }] : []),
    ]),
  );
  ctx.emit(enemyKilled, {
    entity: monster.entity,
    defId: monster.defId,
    name: monster.name,
    level: monster.level,
    rewardLevel: rewardLevel(monster),
    xp,
    tags: monsterTags,
    lastHit: monster.lastHit ?? null,
    site: site?.id ?? '',
    boss,
    once,
  });
  // What the old achievement and level listeners did on `kill`.
  bump(ctx, 'kills');
  bump(ctx, `kills:${monster.defId}`);
  for (const tag of monsterTags) bump(ctx, `kills:tag:${tag}`);
  // Training equipment pays no level XP.
  if (def?.passive !== true) ctx.emit(grantLevelXp, { xp: xp * KILL_LEVEL_XP_RATE });

  c.enemies[index] = null;
  forget(ctx, monster);

  const survivors = c.enemies.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  if (survivors.length === 0) {
    // A finite site counts the win against its budget; the last one clears it.
    if (site?.fightLimit) {
      bump(ctx, fightsKey(site.id));
      if (siteCleared(ctx, site, 1)) {
        if (site.clearedMsg) ctx.emit(logLine, { kind: 'explore', msg: site.clearedMsg });
        say(ctx, 'spot_cleared', { spot: site.name }, 'combat');
        const stamp = site.stampOnClear;
        if (stamp && counterValue(ctx.read(counters), stamp) < 1) ctx.emit(setCounter, { key: stamp, value: 1 });
      }
    }
    const forcedWin = !!c.forced;
    closeCombat(ctx);
    endFight(ctx, 'won');
    ctx.state.respawnTimer = RESPAWN_DELAY;
    if (site) ctx.emit(fightWon, { site: site.id, forced: forcedWin });
    return;
  }
  // A random enemy still fighting steps into the centre; the two trade
  // places, so the slot it came from is the one left empty.
  if (index === 0) {
    const pick = survivors[randInt(ctx, 0, survivors.length - 1)];
    c.enemies[0] = c.enemies[pick];
    c.enemies[pick] = null;
    feed(ctx, `↔️ ${c.enemies[0]!.icon} ${c.enemies[0]!.name} steps forward!`);
  }
}

/**
 * Clear the dead after something struck several enemies at once, from the
 * flanks inward. True when the player's phase should end: the centre slot
 * died, or the fight did. The old `sweepDead`.
 */
export function sweepDead(ctx: C): boolean {
  const c = ctx.state.fight;
  if (!c) return true;
  let frontDied = false;
  for (let i = c.enemies.length - 1; i >= 0; i--) {
    const e = c.enemies[i];
    if (!e || e.hp > 0) continue;
    if (i === 0) frontDied = true;
    onKill(ctx, i);
    if (!ctx.state.fight) return true;
  }
  return frontDied;
}

/** Ask for the ledger to be closed once this handler's lines are in the transcript. */
function endFight(ctx: C, outcome: FightOutcome, cause?: string): void {
  if (!ctx.state.ledger) return;
  ctx.emit(closeLedger, { outcome, ...(cause ? { cause } : {}) });
}

/**
 * The player loses the fight. The old `onDefeat`, up to the knockout: this
 * system closes the fight, doubles the respawn delay, stops the hunt (the
 * old retreat cleared the activity) and emits `combat/defeat`. Setting HP to
 * 1, `recovering`, the retreat and the return are done by the `knockout` and
 * `world` systems (spine port 6).
 */
export function onDefeat(ctx: C, outcome: FightOutcome = 'knocked_out', cause = ''): void {
  const c = ctx.state.fight!;
  const forced = !!c.forced;
  const monster = c.enemies[0];
  const site = ctx.state.site?.id ?? '';
  ctx.emit(playerDefeated, { monster: monster ? refOf(monster) : null, forced, outcome, cause, site, byCondition: false });
  bump(ctx, 'defeats');
  if (cause) ctx.emit(logLine, { msg: `${outcome === 'dead' ? '💀' : '💫'} ${cause}`, kind: 'danger' });
  else say(ctx, forced ? 'knocked_out_forced' : 'knocked_out', { name: monster?.name ?? '' }, 'danger');
  closeCombat(ctx);
  ctx.state.respawnTimer = RESPAWN_DELAY * 2;
  ctx.state.hunting = false;
  ctx.state.huntRest.active = false;
  endFight(ctx, outcome, cause || undefined);
}

/**
 * A condition finished the player while a fight was open. The fight half of
 * the three knockout branches of the old `tickPlayerStatuses`
 * (`systems/actions.ts`): a detonation or a tick of condition damage that
 * leaves the player at 0 HP, and a fatal condition whatever the HP. Called
 * from the handlers of `statuses/detonated`, `statuses/damage` and
 * `statuses/fatal`. The ledger is closed as a knockout, the fight is
 * abandoned (the respawn delay is the short one), and the hunt is turned off
 * as the old retreat cleared the activity. The old code emitted no `defeat`
 * bus event here, so the counter `defeats` is not bumped. The "knocks you
 * out" line names the condition and is written by the `knockout` system.
 */
export function fallToCondition(ctx: C): void {
  const c = ctx.state.fight;
  if (!c) return;
  const monster = c.enemies[0];
  ctx.emit(playerDefeated, {
    monster: monster ? refOf(monster) : null,
    forced: !!c.forced,
    outcome: 'knocked_out',
    cause: '',
    site: ctx.state.site?.id ?? '',
    byCondition: true,
  });
  endFight(ctx, 'knocked_out');
  closeCombat(ctx);
  ctx.state.respawnTimer = RESPAWN_DELAY;
  ctx.state.hunting = false;
  ctx.state.huntRest.active = false;
}

/**
 * What every ending shares: kept wounds written, `combatEnd` fired, the
 * enemies dropped. Callers run this before `endFight`, so the ledger's list
 * of what is still held is read after `combatEnd`. The old `closeCombat`.
 */
function closeCombat(ctx: C): void {
  const fight = ctx.state.fight;
  const standing = fight ? liveEnemies(fight).map(refOf) : [];
  const counts = ctx.read(counters);
  for (const [key, value] of Object.entries(pendingWounds(ctx, fight))) {
    if (counterValue(counts, key) !== value) ctx.emit(setCounter, { key, value });
  }
  ctx.request(fireStatusEvent, { entity: PLAYER, on: 'combatEnd' });
  if (fight) {
    for (const e of fight.enemies) if (e) forget(ctx, e);
  }
  ctx.state.fight = null;
  if (fight) {
    // Outside a fight the player stands neutral (`playerPosition`): the
    // position source is touched only when closing the fight changes that.
    // A touch rebuilds the player's stat block, and a fight closes thousands
    // of times in a catch-up.
    if (fight.position !== NEUTRAL_POSITION) ctx.touch(POSITION_SOURCE, PLAYER);
    if (fight.buffs.length) ctx.touch(BUFFS_SOURCE, PLAYER);
    ctx.emit(setSituation, { inCombat: false });
    ctx.emit(setPace, { inCombat: false });
    ctx.emit(fightClosed, { site: ctx.state.site?.id ?? '', standing });
  }
}

/**
 * Leave the fight (travel, switching activity). Never refuses: the decision
 * points check `inForcedFight` first. The tally is dropped, not committed.
 * The old `abandonCombat`.
 */
export function abandonCombat(ctx: C): void {
  const had = ctx.state.fight !== null;
  closeCombat(ctx);
  ctx.state.ledger = null;
  if (had) ctx.emit(transcriptClose, undefined);
  ctx.state.respawnTimer = RESPAWN_DELAY;
}

// ---- enemy conditions, regeneration, minds ----

/** Whether a burning or dissolving condition is stopping this monster's regeneration. */
function regenDoused(ctx: C, e: DeepReadonly<Enemy>): boolean {
  return heldBy(ctx, e).some((s) => {
    const element = STATUSES[s.id]?.element;
    return !!element && DOUSING_TYPES.has(element);
  });
}

function settleWhen(ctx: C, group: string, stillGoing: (ids: readonly string[]) => boolean): void {
  const run = floatingRun(ctx.read(log), group);
  if (run && !stillGoing(run.ids)) ctx.emit(feedSettle, { group });
}

/** The old `tickEnemyRegen`. */
function tickEnemyRegen(ctx: C, c: Fight): void {
  const tally: LogTally[] = [];
  let any = false;
  for (const e of c.enemies) {
    if (!e || e.hp <= 0) continue;
    const stats = statsOf(ctx, e);
    if (stats.hpRegen <= 0 || regenDoused(ctx, e)) continue;
    any = true;
    const before = e.hp;
    e.hp = Math.min(stats.maxHp, e.hp + stats.maxHp * stats.hpRegen);
    if (e.hp - before >= 1) tally.push({ label: e.name, qty: Math.round(e.hp - before), style: 'amount' });
  }
  if (tally.length > 0) {
    ctx.emit(feedFloatingRun, { group: FOES_REGEN_RUN, prefix: '🌿 Enemies regain HP:', tally, ids: ['regen'] });
  }
  // The run ends when nobody left standing is able to heal.
  settleWhen(ctx, FOES_REGEN_RUN, () => any);
}

/** What a condition ate out of a monster's mind this tick, and what went off. The old `burnMind`. */
function burnMind(ctx: C, e: Enemy, mind: ReturnType<typeof monsterMind>, result: StatusTickResult): boolean {
  let mana = mind.current;
  for (const drain of result.drains) {
    if (drain.resource !== 'mana') continue;
    mana = Math.max(-statusNegativeHeadroom(heldBy(ctx, e), 'mana', mind.max), mana - drain.amount);
  }
  if (mana !== mind.current) e.mana = mana;
  for (const boom of result.detonations) {
    const stats = statsOf(ctx, e);
    const figure = Math.min(
      Math.max(0, stats.resistCap),
      stats[RES_STAT_BY_TYPE[boom.type]] + (ELEMENTAL.has(boom.type) ? stats.resElemental : 0),
    );
    const res = figure * (1 - boom.bypassRes);
    const dealt = Math.max(1, Math.round(boom.amount * (1 - res)));
    e.hp -= dealt;
    e.lastHit = boom.type;
    noteOutgoing(ctx.state, now(ctx), dealt);
    feed(ctx, `${boom.icon} ${boom.name} detonates on the ${e.name} for ${dealt} ${boom.type}!`);
  }
  return result.detonations.length > 0;
}

/** A burned mind recovering. Back at full, it is no longer tracked. The old `tickEnemyMinds`. */
function tickEnemyMinds(c: Fight): void {
  for (const e of c.enemies) {
    if (!e || e.mana === undefined) continue;
    const mind = monsterMind(e);
    const next = e.mana + mind.regen / TPS;
    if (next >= mind.max) delete e.mana;
    else e.mana = next;
  }
}

/**
 * One tick of every enemy's conditions. The statuses system reports; the
 * damage is applied here. The old `tickEnemyStatuses`.
 */
function tickEnemyStatuses(ctx: C, c: Fight): void {
  for (let i = 0; i < c.enemies.length; i++) {
    const e = c.enemies[i];
    if (!e || heldBy(ctx, e).length === 0) continue;

    // Statues are not ported (no monster of floors 0 to 6 has the rule). A
    // statue condition on an enemy is reported, not ignored in silence.
    if (statueOf(heldBy(ctx, e)) && !c.reported?.[`statue:${e.entity}`]) {
      (c.reported ??= {})[`statue:${e.entity}`] = true;
      ctx.skip('combat/statue', `"${e.name}" holds a statue condition; statue rules are not ported`);
    }

    // A matured root network carries what it learned to everything else in the fight.
    const carried = ctx.request(dueGraftSpread, { entity: e.entity });
    if (carried) {
      let reached = 0;
      for (let j = 0; j < c.enemies.length; j++) {
        const other = c.enemies[j];
        if (!other || j === i || other.hp <= 0) continue;
        for (const graft of carried) {
          ctx.request(applyStatus, {
            entity: other.entity,
            app: { id: graft.id, intensity: graft.intensity },
            source: 'rootbound',
          });
        }
        reached += 1;
      }
      if (reached > 0) {
        feed(ctx, `🌳 Rootbound on the ${e.name} spreads its recorded conditions to ${reached} other ${reached === 1 ? 'enemy' : 'enemies'}.`);
      }
    }

    const mind = monsterMind(e);
    const result = ctx.request(tickStatuses, {
      entity: e.entity,
      hp: e.hp,
      maxHp: statsOf(ctx, e).maxHp,
      inCombat: true,
      pools: { mana: { current: mind.current, trueMax: mind.max } },
    });
    const detonated = burnMind(ctx, e, mind, result);
    if (result.damage <= 0) {
      if (detonated && e.hp <= 0) {
        onKill(ctx, i);
        if (!ctx.state.fight) return;
      }
      continue;
    }
    const dealt = Math.max(1, Math.round(result.damage));
    e.hp -= dealt;
    // Damage over time kills by its condition's type.
    e.lastHit = heaviestType(result.hits.map((h) => ({ type: h.type, dealt: h.amount })));
    noteOutgoing(ctx.state, now(ctx), dealt);
    ctx.emit(feedFloatingRun, {
      group: FOES_COND_RUN,
      prefix: '🩸 Afflictions:',
      tally: result.hits.map((h) => ({
        label: `${h.icon} ${e.name} ${h.name.toLowerCase()}`,
        qty: h.amount,
        style: 'amount' as const,
      })),
      ids: result.hits.map((h) => h.id),
    });
    ctx.emit(hitLanded, {
      attacker: null,
      target: e.entity,
      total: dealt,
      crit: false,
      kind: 'condition',
      type: e.lastHit ?? 'bludgeoning',
    });
    if (e.hp <= 0) {
      onKill(ctx, i);
      if (!ctx.state.fight) return;
    }
  }
  settleWhen(ctx, FOES_COND_RUN, (ids) =>
    ids.some((id) => c.enemies.some((e) => e && e.hp > 0 && heldBy(ctx, e).some((s) => s.id === id))),
  );
}

// ---- rotations ----

function reportSkipped(ctx: C, fight: Fight, entity: string, key: string, kind: string): void {
  const mark = `${entity}:${key}`;
  if (fight.reported?.[mark]) return;
  (fight.reported ??= {})[mark] = true;
  ctx.skip('combat/rotation', `${entity} entry "${key}": no system has registered the action kind "${kind}"`);
  ctx.emit(actionSkipped, { entity, kind });
}

/**
 * An entry that cannot run, for a reason its kind gave or the tick found (a
 * spent supply). One skip-log line per fight, entry and reason. The old code
 * passed such an entry over without a word (`docs/PITFALLS.md` section 6).
 */
function reportRefusal(ctx: C, fight: Fight, entity: string, key: string, reason: string): void {
  const mark = `${entity}:${key}:${reason}`;
  if (fight.reported?.[mark]) return;
  (fight.reported ??= {})[mark] = true;
  ctx.skip('combat/rotation', `${entity} entry "${key}": ${reason}`);
}

/** Where the player stands: the position of the open fight, neutral with none. A fight starts neutral. */
export function playerPosition(state: DeepReadonly<CombatState>): string {
  return state.fight?.position ?? NEUTRAL_POSITION;
}

/** Where the player stands. The one place the position changes, so the source that states it is touched. The old `setPosition`. */
export function setPlayerPosition(ctx: C, c: Fight, next: string): void {
  if (c.position === next) return;
  c.position = next;
  ctx.touch(POSITION_SOURCE, PLAYER);
}

/** Add a buff on the player for the fight. The old `c.buffs.push`. */
export function addBuff(ctx: C, buff: CombatBuff): void {
  const c = ctx.state.fight;
  if (!c) return;
  c.buffs.push(buff);
  ctx.touch(BUFFS_SOURCE, PLAYER);
}

/**
 * The order the player's actives are considered in: the explicit rotation
 * first, then every other id the registered kinds know. The old
 * `activeRotation`.
 */
export function activeRotation(ctx: C, order: readonly string[]): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  const kinds = playerActionKinds();
  const known = new Map(kinds.map(([, kind]) => [kind, kind.known(ctx as ActionCtx)]));
  for (const id of order) {
    // A stale id of a registered kind (a spell stood down, a technique not
    // known) is inert. An id of no registered kind stays, so the pick reports it.
    const kind = playerActionHandler(id);
    if (kind && !known.get(kind)!.includes(id)) continue;
    add(id);
  }
  for (const [, kind] of kinds) for (const id of known.get(kind)!) add(id);
  return out;
}

/**
 * The first active of the rotation that is off cooldown and that its kind
 * says can be used now. An id whose kind is not registered is passed over
 * and reported once per fight. The old `pickActive`.
 */
export function pickActive(ctx: C, slot: 'attack' | 'buff'): PickedActive | null {
  const c = ctx.state.fight!;
  for (const id of activeRotation(ctx, ctx.state.rotation)) {
    const kind = playerActionHandler(id);
    if (!kind) {
      reportSkipped(ctx, c, PLAYER, id, id.includes(':') ? id.slice(0, id.indexOf(':') + 1) : id);
      continue;
    }
    if ((c.cooldowns[id] ?? 0) > 0) continue;
    // The player's own trigger on the id: every kind answers to it. The old
    // code read `state.skillTriggers[id]` in each branch of `pickActive`.
    if (!evaluateTrigger({ ctx: ctx as ActionCtx, fight: c, state: ctx.state }, ctx.state.triggers[id])) continue;
    const picked = kind.pick(ctx as ActionCtx, id, slot, c);
    if (typeof picked === 'string') {
      reportRefusal(ctx, c, PLAYER, id, picked);
      continue;
    }
    if (picked) return picked;
  }
  return null;
}

interface MonsterChoice {
  index: number;
  shape?: MonsterShape;
  perform?: () => void;
}

/**
 * What a monster means to do this turn, chosen once from its rotation: the
 * first entry whose clock is down, whose supply is not spent and whose kind
 * says it is available. Null: a plain swing. The old `pickMonsterAction`.
 */
function pickMonsterAction(ctx: C, e: Enemy): MonsterChoice | null {
  const rotation = kitOf(e).rotation;
  if (!rotation?.length || MONSTERS[e.defId]?.passive) return null;
  const fight = ctx.state.fight!;
  const tick = now(ctx);
  for (let index = 0; index < rotation.length; index++) {
    if ((e.cooldowns?.[index] ?? 0) > tick) continue;
    const entry = rotation[index];
    if (entry.uses !== undefined && (e.spent?.[index] ?? 0) >= entry.uses) {
      reportRefusal(ctx, fight, e.entity, String(index), `its supply of ${entry.uses} is spent`);
      continue;
    }
    const kind = monsterActionKind(entry);
    const handler = monsterActionHandler(kind);
    if (!handler) {
      reportSkipped(ctx, fight, e.entity, String(index), kind);
      continue;
    }
    const can = handler.available(ctx as ActionCtx, e, entry, fight, index);
    if (typeof can === 'string') {
      reportRefusal(ctx, fight, e.entity, String(index), can);
      continue;
    }
    if (!can) continue;
    if (handler.perform) return { index, perform: () => handler.perform!(ctx as ActionCtx, e, entry, index) };
    if (handler.shape) return { index, shape: handler.shape(ctx as ActionCtx, e, entry) };
  }
  return null;
}

/** Stamp a monster's rotation entry as fired: its clock and its supply. The old `spendMonsterAction` with the clock. */
export function stampMonsterAction(
  ctx: C,
  e: Enemy,
  index: number,
  cooldown: number,
  action?: { name: string; icon: string },
): void {
  (e.cooldowns ??= {})[index] = now(ctx) + cooldown;
  (e.spent ??= {})[index] = (e.spent?.[index] ?? 0) + 1;
  if (action) e.lastAction = { name: action.name, icon: action.icon, at: now(ctx) };
}

// ---- the rest rule ----

/** The HP share resting stops at. */
export function restTarget(cfg: DeepReadonly<CombatState['huntRest']>): number {
  return cfg.toFull ? 1 : cfg.at;
}

/**
 * Called where a hunt would roll its next encounter. True: rest instead. A
 * pool that cannot recover never makes the hunt wait forever. The old
 * `holdNextFight`. While resting the health trickle runs at the rest rate.
 */
function holdNextFight(ctx: C): boolean {
  const cfg = ctx.state.huntRest;
  if (cfg.at <= 0) {
    if (cfg.active) setResting(ctx, false);
    return false;
  }
  const stats = statBlockOf(ctx);
  const max = availableMax(stats, poolHooks(ctx), 'hp');
  const share = max > 0 ? resourceValue(ctx.read(resources), 'hp') / max : 0;
  const stuck = stats.hpRegen <= 0 || ctx.derived('resources/regenBlocked.hp') > 0;
  if (!cfg.active) {
    if (share >= cfg.at || stuck) return false;
    setResting(ctx, true);
    say(
      ctx,
      'huntrest_resting',
      { hp: Math.floor(share * 100), at: Math.round(cfg.at * 100), to: Math.round(restTarget(cfg) * 100) },
      'action',
    );
    return true;
  }
  // Within a hair of full counts as full.
  if (share >= restTarget(cfg) - 0.005 || stuck) {
    setResting(ctx, false);
    say(ctx, stuck ? 'huntrest_stuck' : 'huntrest_done', undefined, 'action');
    return false;
  }
  return true;
}

/** Rest multiplier of the health trickle (`RECOVERY_MULT.rest`) while the hunt holds its next fight back. */
const REST_MULT = 15;
const HUNT_MULT = 1;

export function setResting(ctx: C, active: boolean): void {
  if (ctx.state.huntRest.active === active) return;
  ctx.state.huntRest.active = active;
  ctx.emit(setPace, active ? { hpMult: REST_MULT, healKind: 'rest' } : { hpMult: HUNT_MULT, healKind: 'idle' });
}

// ---- the tick ----

/** One tick of combat. The old `runCombatTick`. */
export function runCombatTick(ctx: C): void {
  const state = ctx.state;
  if (!state.fight) {
    // The fight is over however it ended: anything still floating settles now.
    const feedState = ctx.read(log);
    if (floatingRun(feedState, FOES_COND_RUN)) ctx.emit(feedSettle, { group: FOES_COND_RUN });
    if (floatingRun(feedState, FOES_REGEN_RUN)) ctx.emit(feedSettle, { group: FOES_REGEN_RUN });
    if (!state.hunting || !state.site) return;
    if (state.respawnTimer > 0) {
      state.respawnTimer -= 1;
      return;
    }
    // A cleared site spawns nothing, and neither does a table whose every line is gated or slain.
    if (siteCleared(ctx, state.site) || !eligibleEncounters(ctx, state.site).length) return;
    // The player's own rule: below the threshold, rest before the next one.
    if (holdNextFight(ctx)) return;
    startEncounter(ctx, state.site);
    return;
  }

  const c = state.fight;

  if (c.introTicks && c.introTicks > 0) {
    if (c.introTicks === 30 || c.introTicks === 20) feed(ctx, '“Please provide documents.”');
    if (c.introTicks === 10) feed(ctx, '“Procedural flow is being impaired. Removing interrupting entity.”');
    c.introTicks -= 1;
    return;
  }

  for (const id of Object.keys(c.cooldowns)) {
    if (c.cooldowns[id] > 0) c.cooldowns[id] -= 1;
  }
  if (c.buffs.length) {
    const held = c.buffs.length;
    c.buffs = c.buffs.filter((b) => (b.ticksLeft -= 1) > 0);
    if (c.buffs.length !== held) ctx.touch(BUFFS_SOURCE, PLAYER);
  }

  const stats = statBlockOf(ctx);

  // Afflictions burn down first, and can finish a fight on their own.
  tickEnemyStatuses(ctx, c);
  if (!state.fight) return;
  // Then whatever regenerates, after the conditions have bitten.
  tickEnemyRegen(ctx, c);
  tickEnemyMinds(c);

  // What `combat/damage-enemy` killed since the last tick is swept here: the
  // request has no kill of its own. The old tick swept at this point, after
  // the strikes of the run's ability.
  if (c.enemies.some((e) => e !== null && e.hp <= 0)) {
    sweepDead(ctx);
    if (!state.fight) return;
  }

  const front = c.enemies[0];
  if (!front) {
    // Every slot emptied. `onKill` ends the encounter first, so this is a guard.
    closeCombat(ctx);
    state.respawnTimer = RESPAWN_DELAY;
    return;
  }

  // Buff-type actives fire as soon as available. The kind performs them; the
  // clock is stamped here, as the old buff slot stamped it for a working on
  // the caster and for a defensive form.
  const buff = pickActive(ctx, 'buff');
  if (buff?.cast) {
    c.cooldowns[buff.id] = buff.cooldown;
    buff.cast(ctx as ActionCtx);
    if (!state.fight) return;
    // "Fire pierce me" is valid grammar: a working on the caster can be the last thing they do.
    if (!alive(ctx)) {
      onDefeat(ctx);
      return;
    }
    // An enemy's counterspell can be refused and its backlash can drop it.
    if (c.enemies.some((e) => e !== null && e.hp <= 0)) {
      sweepDead(ctx);
      if (!state.fight) return;
    }
  }

  // The stat block is read again: a buff or a new position changes it.
  const live = buff?.cast ? statBlockOf(ctx) : stats;
  const centre = c.enemies[0];
  if (!centre) return;
  if (playerPhase(ctx, c, centre, live)) return;
  enemyPhase(ctx, c, live);
}

/**
 * The player's action bar and normal attack. True when the tick must stop.
 * Old `runCombatTick`, lines 4217 to 4834.
 */
function playerPhase(ctx: C, c: Fight, monster: Enemy, stats: Readonly<DerivedStats>): boolean {
  const state = ctx.state;
  const exertion = state.style.exertion;
  const attackExertion = exertion?.on === 'attack' ? exertion : undefined;

  // A shock runs the bar backwards at the rate it would have filled.
  const reversed = statusReversesBar(mine(ctx));
  const dragging = ctx.derived(hook.barFillMult);
  c.playerBar += (reversed ? -attackFillRate(stats) : attackFillRate(stats)) * dragging;

  if (reversed && c.playerBar <= 0) {
    c.playerBar = 0;
    if (applyBarDamage(ctx, 'onDeplete')) return true;
    ctx.request(fireStatusEvent, { entity: PLAYER, on: 'barDeplete' });
  }

  if (reversed || c.playerBar < stats.actionBar) return false;
  // Read here and not on every tick: nothing above changes what it reads.
  const tags = combatTags(ctx);

  c.playerBar -= stats.actionBar;
  // Whatever is riding the bar discharges as it completes, before the swing.
  if (applyBarDamage(ctx, 'onFill')) return true;
  const skippedAction = consumeSkippedAction(mine(ctx));
  ctx.request(fireStatusEvent, { entity: PLAYER, on: 'barFill' });
  ctx.emit(barFilled, { entity: PLAYER });
  if (skippedAction || statusBlocks(mine(ctx), 'attack')) {
    feed(ctx, `😵 A condition on you costs you this action.`);
    return true;
  }
  trackWeaponFamily(ctx);
  const active = pickActive(ctx, 'attack');

  // A fast refuses the plain swing, not the fight: the fill is spent.
  if (!active && statusBlocks(mine(ctx), 'swing')) {
    ctx.emit(feedRepeatLine, {
      group: 'fasting',
      prefix: '🕳️ Fasting blocks plain attacks:',
      tally: [{ label: 'action bar spent', qty: 1 }],
    });
    return true;
  }

  // A swing wants a hand holding a weapon. With every grip floating there is none.
  const worn = ctx.read(items).equipment;
  const grants = grantsOf(ctx.read(items));
  const usesHands = active ? active.usesHands : true;
  if (usesHands && handSwingShare(worn, grants) === 0) {
    ctx.emit(feedRepeatLine, {
      group: 'concentrating',
      prefix: '🧘 No free hand for a weapon attack:',
      tally: [{ label: 'action bar spent', qty: 1 }],
    });
    return true;
  }

  feedTheFast(ctx, PLAYER);

  // Blind fighting rolls the to-hit sequence twice and keeps the worse.
  const blind = statusDisadvantage(mine(ctx));
  const approach = active?.approach ?? playerDamageType(ctx);
  const pulled = magnetBypassesDodge(roller(ctx), heldBy(ctx, monster), approach);
  const dark = ctx.derived(hook.darkness);
  // Empty stance: a weapon blow that cannot be dodged and lands at its raw size.
  const empty = !active && heldWith(mine(ctx), 'pureBlows') !== null;
  const sure = empty || !!active?.sure;
  const evaded = !sure && !pulled && monster.hp > 0 && rollAgainst(ctx, statsOf(ctx, monster).dodge, blind);
  const fumbled = !evaded && rollAgainst(ctx, statusMissChance(mine(ctx)) + DARK_MISS_CHANCE * dark, blind);

  if (evaded || fumbled) shedCooldownsOnMiss(ctx);
  if ((evaded || fumbled) && landGraze(ctx, monster, active)) return true;

  if (evaded) {
    feed(ctx, `${monster.icon} The ${monster.name} evades your attack.`);
    ctx.emit(attackThrown, { attacker: PLAYER, target: monster.entity, outcome: 'evaded' });
  } else if (fumbled) {
    feed(
      ctx,
      blind
        ? `🙈 Your attack misses: you are Blinded.`
        : dark > 0
          ? `🌑 Your attack misses: darkness adds a miss chance.`
          : `😵‍💫 Your attack misses: a condition on you adds a miss chance.`,
    );
    ctx.emit(attackThrown, { attacker: PLAYER, target: monster.entity, outcome: 'fumbled' });
  } else if (active?.cast) {
    // A working takes the swing's place. Its kind lands it; the dead are swept here.
    c.cooldowns[active.id] = active.cooldown;
    active.cast(ctx as ActionCtx);
    if (!state.fight || !alive(ctx)) return true;
    if (sweepDead(ctx)) return true;
  } else {
    if (swing(ctx, c, monster, stats, tags, active, attackExertion, empty)) return true;
  }

  if (monster.hp <= 0 && state.fight && c.enemies[0] === monster) {
    onKill(ctx, 0);
    return true;
  }
  return false;
}

/**
 * The blow of a normal attack, plain or shaped by an active. True when the
 * tick must stop. Old lines 4364 to 4828.
 */
function swing(
  ctx: C,
  c: Fight,
  monster: Enemy,
  stats: Readonly<DerivedStats>,
  tags: string[],
  active: PickedActive | null,
  attackExertion: CombatState['style']['exertion'],
  empty: boolean,
): boolean {
  const shape = active?.shape ?? null;
  // Hunter bonuses are gated on what is fought: the offensive half of the
  // block is resolved against this target's tags.
  const vs = statBlockOf(ctx, PLAYER, vsVariant(monsterTagSet(monster.defId)));
  const dmgType = playerDamageType(ctx);
  const label = shape?.label ?? 'You hit';
  const hitLabel = shape?.hitLabel ?? 'Your attack';
  const hitSource = weaponSource(ctx);
  const usedTags = shape?.tags ?? tags;
  const steps: DamageStep[] = [];
  let dmg = vs.damage * (shape?.damageMult ?? 1);
  steps.push({ label: 'Damage', value: vs.damage });
  if (shape?.damageMult !== undefined && shape.damageMult !== 1) steps.push({ label: hitLabel, mult: shape.damageMult });
  if (shape?.prevented) {
    const stopped = c.prevented?.[shape.prevented.by];
    if (stopped) {
      const returned = stopped * shape.prevented.mult;
      dmg += returned;
      steps.push({ label: shape.prevented.by === 'onParry' ? 'Damage parried' : 'Damage blocked', value: returned });
      c.prevented = { ...c.prevented, [shape.prevented.by]: undefined };
    }
  }
  if (active) c.cooldowns[active.id] = active.cooldown;

  // Weapons the mind holds are on their own clock; their share went with them.
  const handShare = handSwingShare(ctx.read(items).equipment, grantsOf(ctx.read(items)));
  if (handShare < 1) {
    dmg *= handShare;
    steps.push({ label: 'Share of damage left in your hands', mult: handShare });
  }
  // Every swing pays its upkeep; the style's bargain costs extra, and only
  // when the player has opted in.
  ctx.request(drawNow, {
    id: 'stamina',
    amount: attackUpkeep(stats, actionTicks(stats.actionBar, attackFillRate(stats)) / TPS),
  });
  if (shape?.staminaCost) {
    ctx.request(drawNow, { id: 'stamina', amount: stats.maxStamina * shape.staminaCost * stats.staminaEff });
  }
  const ex: Exertion = attackExertion ? ctx.request(exertNow, { spec: attackExertion }) : NO_EXERTION;
  if (attackExertion?.ramp) {
    const built = (ex.spent > 0 ? attackExertion.ramp.per * ex.ratio : 0) + (shape?.momentum ?? 0);
    if (built > 0) c.momentum = Math.min(attackExertion.ramp.cap, c.momentum + built);
  }
  const penetration = Math.min(0.95, vs.penetration + ex.penetration + (shape?.penetration ?? 0));
  if (ex.damage > 0) steps.push({ label: 'Exertion', mult: 1 + ex.damage });
  const hits = (shape?.hits ?? 1) + rollExtraHits(ctx.rng, ex.extraHits + vs.extraSwings);
  const blow = dmg * (1 + ex.damage);
  const slices = new Map<string, TypedSlice>();
  let total = 0;
  let raw = 0;
  let isCrit = false;
  let crits = 0;
  // A named crit is not luck: it neither pays the ledger nor is paid by it.
  const forced = shape?.crit;
  const forcedCritDamage = forced ? Math.max(forced.floor ?? 1, vs.critDamage * (forced.damageMult ?? 1)) : 0;
  const smallerBy = stepsSmaller(ctx, monster.defId);
  const bully = 1 + vs.vsSmaller * smallerBy;
  if (bully !== 1) steps.push({ label: 'Damage vs Smaller', mult: bully });
  const underdog = 1 + vs.vsLarger * stepsLarger(ctx, monster.defId);
  if (underdog !== 1) steps.push({ label: 'Damage vs Larger', mult: underdog });
  const theirs = statsOf(ctx, monster);
  const looming = Math.max(0, 1 - theirs.fromSmaller * stepsLarger(ctx, monster.defId));
  if (looming !== 1) steps.push({ label: 'Resistance vs Smaller (target)', mult: looming });
  const weapon = ctx.read(items).equipment.weapon;
  const wdef = weapon ? itemDefOf(weapon) : undefined;
  const ridden = new Set<BlowRiderKind>();
  for (let h = 0; h < hits; h++) {
    let hit = blow * bully * underdog * looming;
    const crit = forced
      ? true
      : ctx.request(rollProcChance, { key: PLAYER_CRIT, rate: vs.crit + magnetCritChance(heldBy(ctx, monster), dmgType) });
    if (crit) {
      // `critTaken` scales the surplus only.
      const critDamage = (forced ? forcedCritDamage : vs.critDamage) + ctx.request(consumeMagnetCharge, { entity: monster.entity });
      hit *= 1 + (critDamage - 1) * Math.max(0, theirs.critTaken);
      isCrit = true;
      crits++;
    }
    hit *= 0.9 + ctx.rng.next() * 0.2;
    const rawHit = hit;
    raw += rawHit;
    const landed: TypedSlice = empty
      ? { type: dmgType, source: hitSource, raw: rawHit, armor: 0, resisted: 0, resistance: 0, pierced: 0, dealt: rawHit }
      : monsterSlice(statsOf(ctx, monster), dmgType, hitSource, rawHit, penetration);
    addSlice(slices, landed);
    hit = landed.dealt;
    // Weapon enchants and socketed runes add their own typed damage per hit.
    const typed: { type: DamageType; value: number; source: string }[] = [];
    if (wdef?.bonusDamage) typed.push({ ...wdef.bonusDamage, source: wdef.name });
    for (const ref of weapon?.runes ?? []) {
      const effect = runeEffectAt(ref, 'weapon');
      if (!effect) continue;
      const source = RUNE_NAME(ref);
      if (effect.bonusDamage) typed.push({ type: effect.bonusDamage.type as DamageType, value: effect.bonusDamage.value, source });
    }
    for (const ref of weapon?.runes ?? []) {
      const effect = runeEffectAt(ref, 'weapon');
      if (effect?.bonusDamagePct)
        typed.push({ type: effect.bonusDamagePct.type as DamageType, value: rawHit * effect.bonusDamagePct.value, source: RUNE_NAME(ref) });
    }
    // A bare-handed blow adds a share of itself in the rider's type.
    const rider = weapon ? null : heldWith(mine(ctx), 'unarmedRider');
    if (rider?.def.unarmedRider) {
      typed.push({ type: rider.def.unarmedRider as DamageType, value: rawHit * rider.intensity, source: rider.def.name });
    }
    for (const b of typed) {
      const extra = monsterSlice(statsOf(ctx, monster), b.type, b.source, b.value, penetration);
      addSlice(slices, extra);
      hit += extra.dealt;
    }
    // Registered riders (a coating) are spent per hit, because they are paid out per hit.
    for (const rider of blowRiders()) {
      const carried = rider.perHit(ctx as ActionCtx, monster);
      if (!carried.length) continue;
      ridden.add(rider);
      for (const b of carried) {
        const extra = monsterSlice(
          statsOf(ctx, monster),
          b.type,
          b.source,
          b.value,
          Math.min(0.95, penetration + (b.penetration ?? 0)),
        );
        addSlice(slices, extra);
        hit += extra.dealt;
      }
    }
    total += hit;
  }
  if (hits > 1) steps.push({ label: `${hits} simultaneous hits`, mult: hits });
  if (crits > 0) {
    steps.push({
      label: forced
        ? 'Critical hit (guaranteed by the technique)'
        : crits === hits
          ? 'Critical hit'
          : `Critical hit (${crits} of ${hits})`,
      mult: forced ? forcedCritDamage : vs.critDamage,
    });
  }
  steps.push({ label: 'Swing variance ±10%' });
  // An ambushed target takes the blow harder; the damageTaken event below spends the surprise.
  const bite = statusIncomingDamageMult(heldBy(ctx, monster));
  if (bite !== 1) steps.push({ label: 'Conditions on the target', mult: bite });
  const dealt = Math.max(1, Math.round(total * bite));
  monster.hp -= dealt;
  monster.lastHit = heaviestType(slices.values()) ?? dmgType;
  noteOutgoing(ctx.state, now(ctx), dealt);
  applyHarvest(ctx, monster, enemyTookDamage(ctx, monster, new Map([[dmgType, dealt]])));
  const note = resNote(statsOf(ctx, monster)[RES_STAT_BY_TYPE[dmgType]]);
  bump(ctx, 'combat:attacks');
  if (isCrit) {
    markCombatEvent(ctx, 'onCrit');
    bump(ctx, 'combat:crits');
  }
  feed(
    ctx,
    `⚔️ ${label} the ${monster.name} for ${dealt}${hits > 1 ? ` (×${hits} hits)` : ''}${isCrit ? ' — CRIT!' : ''}${note}`,
    { label: hitLabel, target: monster.name, steps, slices: [...slices.values()], hits, crit: isCrit, total: dealt },
  );
  ctx.emit(attackThrown, { attacker: PLAYER, target: monster.entity, outcome: 'hit' });
  ctx.emit(hitLanded, {
    attacker: PLAYER,
    target: monster.entity,
    total: dealt,
    crit: isCrit,
    kind: 'attack',
    type: monster.lastHit,
    thrown: raw,
  });

  // What the blow leaves behind, and where it leaves the player.
  if (shape?.inflicts && monster.hp > 0) {
    for (const app of shape.inflicts)
      ctx.request(applyStatus, { entity: monster.entity, app, source: hitLabel, penetration: vs.penetration });
  }
  for (const rider of ridden) {
    const left = rider.afterBlow?.(ctx as ActionCtx, monster);
    if (!left) continue;
    if (left.inflicts && monster.hp > 0) {
      for (const app of left.inflicts)
        ctx.request(applyStatus, { entity: monster.entity, app, source: left.source, penetration: vs.penetration });
    }
    if (left.line) feed(ctx, left.line);
  }
  // A plain swing recovers to neutral, and that recovery is not displaced.
  setPlayerPosition(
    ctx,
    c,
    shape?.to ? (statusDisplacedExit(roller(ctx), mine(ctx)) ?? shape.to) : NEUTRAL_POSITION,
  );
  if (shape) active?.after?.(ctx as ActionCtx);

  // Spill: part of the blow carries past its target into a random flanker.
  const splash = vs.splash + ex.splash + (shape?.splash ?? 0);
  const flanks = c.enemies.map((e, i) => (e && i > 0 ? i : -1)).filter((i) => i >= 0);
  if (splash > 0 && flanks.length > 0) {
    const idx = flanks[randInt(ctx, 0, flanks.length - 1)];
    const other = c.enemies[idx];
    if (other) {
      const slice = monsterSlice(statsOf(ctx, other), dmgType, hitSource, raw * splash, penetration);
      const spill = Math.max(1, Math.round(slice.dealt));
      other.hp -= spill;
      other.lastHit = dmgType;
      feed(ctx, `↯ The blow carries into the ${other.name} for ${spill}`, {
        label: 'Spill from your blow',
        target: other.name,
        steps: [
          { label: 'Blow before defences', value: raw },
          { label: 'Splash', mult: splash },
        ],
        slices: [slice],
        hits: 1,
        crit: false,
        total: spill,
      });
      ctx.emit(hitLanded, { attacker: PLAYER, target: other.entity, total: spill, crit: false, kind: 'spill', type: dmgType });
      if (other.hp <= 0) onKill(ctx, idx);
    }
  }

  // A weapon blow is contact: the target's own conditions answer it.
  if (applyMonsterRetaliation(ctx, 0, 'onContact')) return true;
  // Some conditions cost the player every time they swing.
  if (applyRetaliation(ctx, 'onAttack')) return true;

  ctx.emit(grantAttrXp, { attr: 'str', amount: 2 });
  ctx.emit(grantAttrXp, { attr: 'dex', amount: 1 });
  ctx.emit(grantSkillXp, { tags: usedTags, amount: 4 + rewardLevel(monster) * 0.5 });
  // Weapon families and stance schools manifest here.
  ctx.emit(checkDiscovery, { tags });
  return false;
}

const RUNE_NAME = (ref: string): string => RUNES[ref]?.name ?? ref;

// ---- landing from outside the normal attack ----

/**
 * Slices a caller computed land on an enemy: the bite of the target's
 * conditions, at least 1 in total, HP, `lastHit`, the ledger, its conditions
 * told per type, the graft harvest. The landing of the old
 * `castCraftedAttack`. It does not sweep the dead.
 */
export function landSlices(
  ctx: C,
  monster: Enemy,
  slices: readonly TypedSlice[],
  crit = false,
  kind: HitKind = 'strike',
): { dealt: number; bite: number; killed: boolean } {
  const bite = statusIncomingDamageMult(heldBy(ctx, monster));
  const total = slices.reduce((sum, s) => sum + s.dealt, 0);
  const dealt = Math.max(1, Math.round(total * bite));
  monster.hp -= dealt;
  monster.lastHit = heaviestType(slices) ?? monster.lastHit;
  const byType = new Map<DamageType, number>();
  for (const s of slices) byType.set(s.type, (byType.get(s.type) ?? 0) + s.dealt);
  applyHarvest(ctx, monster, enemyTookDamage(ctx, monster, byType));
  if (crit) markCombatEvent(ctx, 'onCrit');
  ctx.emit(hitLanded, {
    attacker: PLAYER,
    target: monster.entity,
    total: dealt,
    crit,
    kind,
    type: monster.lastHit ?? 'bludgeoning',
  });
  return { dealt, bite, killed: monster.hp <= 0 };
}

/** The share of a mending an overgrowth swallows before it can close a wound. */
export const OVERGROWTH_HEAL_TAX = 1 / 3;

/**
 * Heal a monster. Kindness from its own side (`hostile: false`) closes
 * wounds and settles an overgrowth: a third of it is spent on the growth,
 * and each point spent undoes three of the surplus. Life forced into it by a
 * working aimed at it accrues in full in the overgrowth ledger, whether it
 * found a wound or not; enough of it escalates the growth, and more bursts
 * the body. A burst deals the damage; the caller sweeps. The old `healEnemy`.
 */
export function healEnemy(
  ctx: C,
  target: Enemy,
  amount: number,
  source: string,
  hostile = true,
  penetration = 0,
): void {
  const c = ctx.state.fight;
  if (!c || amount <= 0) return;
  const maxHp = statsOf(ctx, target).maxHp;
  // Only what has somewhere to go closes a wound.
  const room = Math.max(0, maxHp - target.hp);
  let mending = Math.min(amount, room);
  const list = heldBy(ctx, target);
  const swollen = list.find((s) => s.id === 'proliferating') ?? list.find((s) => s.id === 'overgrowth');

  if (!hostile) {
    if (mending > 0 && swollen?.data?.surplus) {
      const withheld = mending * OVERGROWTH_HEAL_TAX;
      mending -= withheld;
      const left = Math.max(0, swollen.data.surplus - withheld / OVERGROWTH_HEAL_TAX);
      ctx.request(writeSurplus, { entity: target.entity, id: swollen.id, set: left });
      if (left <= 0) {
        ctx.request(removeStatus, { entity: target.entity, id: swollen.id });
        feed(ctx, `🌿 The ${target.name} loses ${STATUSES[swollen.id]?.name ?? 'overgrowth'}: its overgrowth total is 0.`);
      }
    }
    if (mending > 0) target.hp += mending;
    feed(ctx, `💚 ${source} heals the ${target.name} for ${Math.round(mending)} HP.`);
    return;
  }

  if (mending > 0) target.hp += mending;

  // The ledger rides whichever rung of the ladder is already held.
  let heldId = swollen?.id;
  let intensity = swollen?.intensity ?? 0;
  if (!heldId) {
    const fresh = ctx.request(applyStatus, {
      entity: target.entity,
      app: { id: 'overgrowth', intensity: 1 },
      source,
      penetration,
    });
    if (!fresh) return;
    heldId = fresh.id;
    intensity = fresh.intensity;
  }
  // Feeding it keeps the clock wound.
  const surplus = ctx.request(writeSurplus, { entity: target.entity, id: heldId, add: amount, rewind: true });
  if (surplus === null) return;

  const def = STATUSES[heldId];
  const cfg = def?.surplus;
  if (cfg?.escalateAt !== undefined && def?.escalatesTo && surplus >= maxHp * cfg.escalateAt) {
    ctx.request(removeStatus, { entity: target.entity, id: heldId });
    // A transformation, not a new dose: the next rung goes through `reform`,
    // so a poison-resistant body is not billed twice.
    const next = ctx.request(reform, { entity: target.entity, app: { id: def.escalatesTo, intensity }, source });
    if (next) ctx.request(writeSurplus, { entity: target.entity, id: next.id, set: surplus });
    feed(ctx, `🧬 The ${target.name}'s overgrowth escalates to ${STATUSES[def.escalatesTo]?.name ?? def.escalatesTo}.`);
    return;
  }
  if (cfg?.detonateAt !== undefined && surplus >= maxHp * cfg.detonateAt) {
    // The bearer takes the whole ledger and everything beside it a share.
    ctx.request(removeStatus, { entity: target.entity, id: heldId });
    const type = (cfg.detonateType ?? 'poison') as DamageType;
    target.hp -= surplus;
    target.lastHit = type;
    feed(ctx, `💥 The ${target.name}'s overgrowth bursts: it takes ${Math.round(surplus)} ${type} damage.`);
    for (const other of c.enemies) {
      if (!other || other === target) continue;
      const slice = monsterSlice(statsOf(ctx, other), type, source, surplus * (cfg.detonateShare ?? 0.5), 0);
      const dealt = Math.max(1, Math.round(slice.dealt));
      other.hp -= dealt;
      other.lastHit = type;
      feed(ctx, `💥 The burst hits the ${other.name} for ${dealt} ${type}.`);
    }
    return;
  }
  feed(
    ctx,
    `🌿 ${source} heals the ${target.name} for ${Math.round(mending)} HP and adds ${Math.round(amount)} to its overgrowth (total ${Math.round(surplus)}).`,
  );
}

/** The player's per-attack retaliation, for a working that takes the swing's place. True when it was fatal. */
export function attackRetaliation(ctx: C): boolean {
  return applyRetaliation(ctx, 'onAttack');
}

/**
 * Enemy attacks: everyone acts, and position against reach decides how well.
 * Old `runCombatTick`, lines 4836 to 5303.
 */
function enemyPhase(ctx: C, c: Fight, stats: Readonly<DerivedStats>): void {
  const state = ctx.state;
  const exertion = state.style.exertion;
  const defendExertion = exertion?.on === 'defend' ? exertion : undefined;

  for (let i = 0; i < c.enemies.length; i++) {
    const e = c.enemies[i];
    if (!e) continue;
    // The terms of an honourable duel: everyone but the front can only watch.
    if (i > 0 && statusPacifiesFlankers(mine(ctx))) continue;
    const mod = POSITION_MODS[i === 0 ? 'front' : 'back'][e.range];
    const es = statsOf(ctx, e);

    // A shock runs the bar backwards at the rate it would have filled.
    const reversed = statusReversesBar(heldBy(ctx, e));
    const fill = es.speed * es.attackSpeed * mod.fill;
    e.bar += reversed ? -fill : fill;

    if (reversed) {
      if (e.bar <= 0) {
        e.bar = 0;
        const died = applyMonsterBarDamage(ctx, e, 'onDeplete');
        ctx.request(fireStatusEvent, { entity: e.entity, on: 'barDeplete' });
        // Sweeping moves the line under this loop: the enemy phase ends here.
        if (died) {
          sweepDead(ctx);
          return;
        }
      }
      continue;
    }

    // A ranged attacker in the front slot is jostled: its progress is shaved, up to a cap per fill.
    if (mod.stunPerTick > 0 && e.stunSpent < mod.stunCap) {
      const shave = Math.min(mod.stunPerTick, mod.stunCap - e.stunSpent, Math.max(0, e.bar));
      e.bar -= shave;
      e.stunSpent += shave;
    }
    if (e.bar < MONSTER_ACTION_BAR) continue;
    e.bar -= MONSTER_ACTION_BAR;
    e.stunSpent = 0;
    // Whatever rides the bar discharges as it completes, before the swing.
    if (applyMonsterBarDamage(ctx, e, 'onFill')) {
      sweepDead(ctx);
      return;
    }
    ctx.request(fireStatusEvent, { entity: e.entity, on: 'barFill' });
    ctx.emit(barFilled, { entity: e.entity });
    if (consumeSkippedAction(heldBy(ctx, e))) {
      feed(ctx, `😵 The ${e.name} loses this action to a condition.`);
      continue;
    }

    // What it means to do this turn, chosen once from its rotation. A working
    // replaces the swing; a technique shapes it.
    const action = pickMonsterAction(ctx, e);

    if (!action && statusBlocks(heldBy(ctx, e), 'swing')) {
      feed(ctx, `🕳️ The ${e.name} does not reach for you.`);
      continue;
    }

    feedTheFast(ctx, e.entity);
    const kit = kitOf(e);

    if (action?.perform) {
      action.perform();
      if (!state.fight || !alive(ctx)) {
        if (state.fight && !alive(ctx)) onDefeat(ctx);
        return;
      }
      // A working's answer can kill mid-cast, and sweeping moves the line.
      if (c.enemies.some((m) => m && m.hp <= 0)) {
        sweepDead(ctx);
        return;
      }
      continue;
    }

    // Its own conditions can spoil the swing. Rolled only when there is a chance.
    const selfMiss = statusMissChance(heldBy(ctx, e));
    if (selfMiss > 0 && ctx.rng.chance(selfMiss)) {
      feed(ctx, `🙈 The ${e.name}'s attack misses: a condition on it adds a miss chance.`);
      ctx.emit(attackThrown, { attacker: e.entity, target: PLAYER, outcome: 'fumbled' });
      continue;
    }
    // Guarding stances pay stamina per incoming blow.
    const guard: Exertion = defendExertion ? ctx.request(exertNow, { spec: defendExertion }) : NO_EXERTION;
    const darkMult = 1 - DARK_DODGE_PENALTY * ctx.derived(hook.darkness);
    if (ctx.rng.chance(Math.min(0.9, (stats.dodge + guard.dodge) * ctx.derived(hook.positionDodgeMult) * darkMult))) {
      const worth = mod.damage * positionIncomingMult(ctx, stats.stumbleTaken);
      const grazed = landMonsterGraze(ctx, e, es, worth);
      feed(
        ctx,
        grazed > 0
          ? `💢 You dodge the ${e.name}'s attack, but its graze still hits you for ${grazed}.`
          : guard.dodge > 0
            ? `💨 You dodge the ${e.name}'s attack (your stance spent stamina to add dodge chance).`
            : `💨 You dodge the ${e.name}'s attack.`,
      );
      markCombatEvent(ctx, 'onDodge');
      bump(ctx, 'combat:dodges');
      ctx.emit(attackThrown, { attacker: e.entity, target: PLAYER, outcome: 'dodged' });
      if (!alive(ctx)) return;
      if (answeredToDeath(ctx, e)) return;
      noteDodge(state, now(ctx), es.damage * worth);
      ctx.emit(grantAttrXp, { attr: 'dex', amount: 2 });
      continue;
    }
    // A shroud on top of footwork: rolled after dodge has failed.
    if (ctx.rng.chance(statusIncomingMissChance(mine(ctx)))) {
      feed(ctx, `🌑 The ${e.name}'s attack misses you: a condition on you gives enemies a miss chance.`);
      ctx.emit(attackThrown, { attacker: e.entity, target: PLAYER, outcome: 'shrouded' });
      continue;
    }
    // A standing wall stops anything thrown.
    if (e.range === 'ranged' && statusBlocksRangedType(mine(ctx), kit.damageType)) {
      feed(ctx, `🛡️ The ${e.name}'s ranged attack is blocked by your Kinetic Bulwark.`);
      ctx.emit(attackThrown, { attacker: e.entity, target: PLAYER, outcome: 'blocked' });
      continue;
    }
    // A parry turns the blow aside and answers it. The riposte does not touch the action bar.
    const weight = es.damage * mod.damage * positionIncomingMult(ctx);
    const flowing = heldWith(mine(ctx), 'parryContest');
    const flow = flowing?.def.parryContest;
    const contest = flowing && flow && weight > 0 ? Math.min(1, flowing.intensity / (flow.per * weight)) : 0;
    const parryChance = Math.max(contest, Math.min(PARRY_CAP, stats.parry + guard.parry));
    if (parryChance > 0 && ctx.rng.chance(parryChance)) {
      const answer = flowing && flow ? flow.answer * flowing.intensity : stats.damage * stats.riposte;
      const slice = monsterSlice(statsOf(ctx, e), playerDamageType(ctx), weaponSource(ctx), answer, stats.penetration);
      const riposte = Math.max(1, Math.round(slice.dealt));
      e.hp -= riposte;
      e.lastHit = slice.type;
      c.prevented = { ...c.prevented, onParry: weight };
      markCombatEvent(ctx, 'onParry');
      bump(ctx, 'combat:parries');
      noteParry(state, now(ctx), weight, riposte);
      feed(ctx, `🛡️ You parry the ${e.name} and cut back for ${riposte}`, {
        label: 'Riposte',
        target: e.name,
        steps:
          flowing && flow
            ? [
                { label: 'Power (Flowing)', value: flowing.intensity },
                { label: 'Flowing answer share', mult: flow.answer },
              ]
            : [
                { label: 'Damage', value: stats.damage },
                { label: 'Riposte share of it', mult: stats.riposte },
              ],
        slices: [slice],
        hits: 1,
        crit: false,
        total: riposte,
      });
      ctx.emit(attackThrown, { attacker: e.entity, target: PLAYER, outcome: 'parried' });
      ctx.emit(hitLanded, { attacker: PLAYER, target: e.entity, total: riposte, crit: false, kind: 'riposte', type: slice.type });
      ctx.emit(grantAttrXp, { attr: 'dex', amount: 2 });
      if (e.hp <= 0) {
        onKill(ctx, i);
        if (!state.fight) return;
      }
      continue;
    }
    // Training equipment swings, and nothing it does can hurt.
    if (MONSTERS[e.defId]?.passive) {
      feed(ctx, `🎯 The ${e.name} thumps against your guard — no harm done.`);
      ctx.emit(attackThrown, { attacker: e.entity, target: PLAYER, outcome: 'harmless' });
      continue;
    }

    // A technique shapes the swing: its multiplier, type and riders ride the blow.
    const move = action?.shape;
    if (move) {
      stampMonsterAction(ctx, e, action!.index, move.cooldown ?? TECHNIQUE_MONSTER_COOLDOWN, move);
      e.position = statusDisplacedExit(roller(ctx), heldBy(ctx, e)) ?? move.to;
      feed(ctx, `${move.icon} The ${e.name} moves into ${move.name}.`);
      if (move.watchKey) bump(ctx, move.watchKey);
    } else {
      e.position = NEUTRAL_POSITION;
    }

    const type = move?.damageType ?? kit.damageType;
    const posMult = positionIncomingMult(ctx, stats.stumbleTaken);
    const looming = Math.max(0, 1 - stats.fromSmaller * stepsSmaller(ctx, e.defId));
    const bully = 1 + es.vsSmaller * stepsLarger(ctx, e.defId);
    const underdog = 1 + es.vsLarger * stepsSmaller(ctx, e.defId);
    // A counter form gets between the player and the blow: it comes off
    // before armour. Picked once for the exchange, not per hit.
    const counter = armInterception(ctx as ActionCtx, c, 'onHit');
    const braced = stats.armor * guard.armor;
    // Surprise cuts both ways: the damageTaken event of the blow spends the condition.
    const bite = statusIncomingDamageMult(mine(ctx));
    const hits = (move?.hits ?? 1) + rollExtraHits(ctx.rng, es.extraSwings);
    const slices = new Map<string, TypedSlice>();
    const ranged = kit.range === 'ranged';
    // Heavy stance: each hit is cut by Power before armour.
    const heavy = heldWith(mine(ctx), 'blowCut');
    let cutTotal = 0;
    let cutHits = 0;
    let thrown = 0;
    let dmg = 0;
    let critted = false;
    const fixed = MONSTERS[e.defId]?.fixedDamage;
    for (let h = 0; h < hits; h++) {
      const hitCrit = ctx.request(rollProcChance, { key: monsterCritKey(e.defId), rate: es.crit });
      if (hitCrit) critted = true;
      const critMult = hitCrit ? 1 + (es.critDamage - 1) * Math.max(0, stats.critTaken) : 1;
      const one =
        es.damage *
        mod.damage *
        posMult *
        (move?.damageMult ?? 1) *
        critMult *
        looming *
        bully *
        underdog *
        (0.9 + ctx.rng.next() * 0.2);
      thrown += one;
      const countered = counter ? one * (1 - counter.reduce) : one;
      const cut = heavy ? Math.min(countered, heavy.intensity) : 0;
      cutTotal += cut;
      const raw = countered - cut;
      if (heavy && raw <= 0) {
        cutHits++;
        continue;
      }
      const slice = incomingSlice(stats, type, e.name, raw, braced, ranged);
      // Training equipment: the number that reaches the bar is pinned.
      if (fixed !== undefined) {
        slice.raw = fixed;
        slice.armor = 0;
        slice.resisted = 0;
        slice.dealt = fixed;
        addSlice(slices, slice);
        dmg += fixed;
        continue;
      }
      addSlice(slices, slice);
      dmg += Math.max(1, Math.round(slice.dealt * bite));
    }
    if (heavy && cutTotal > 0) rattle(ctx, e, heavy.def.blowCut!.rattle * Math.min(1, cutTotal / thrown));
    if (heavy && cutHits === hits) {
      c.prevented = { ...c.prevented, onHit: thrown };
      noteAbsorbed(state, now(ctx), thrown);
      feed(ctx, `🪨 You take the ${e.name}'s blow on your guard. No damage.`, {
        label: `The ${e.name}`,
        target: 'You',
        steps: [
          { label: 'Its blow', value: thrown },
          { label: 'Heavy stance cuts it by Power', value: -Math.round(cutTotal) },
        ],
        slices: [],
        hits,
        crit: false,
        incoming: true,
        total: 0,
      });
      continue;
    }
    // A blow that lands leaves a reading: what armour, bracing and resistance took off it.
    c.prevented = { ...c.prevented, onHit: Math.max(0, thrown - dmg) };
    noteAbsorbed(state, now(ctx), Math.max(0, thrown - dmg));
    damagePlayer(ctx, dmg, type, {
      key: `monster:${e.defId}`,
      label: e.name,
      icon: e.icon,
      by: e.entity,
      thrown,
      boss: isSiteBoss(state.site, e.defId),
    });
    const res = stats[RES_STAT_BY_TYPE[type]];
    markCombatEvent(ctx, 'onHit');
    bump(ctx, 'combat:hitsTaken');
    feed(
      ctx,
      `🩸 The ${e.name} ${critted ? 'CRITS you' : 'hits you'} for ${dmg} ${type}${guard.armor > 0 ? ' — braced' : ''}${
        res >= 0.1 ? ' (resisted)' : ''
      }${critted && stats.critTaken < 1 ? ' (blunted)' : ''}.`,
      {
        label: `The ${e.name}`,
        target: 'You',
        steps: [
          { label: 'Its damage', value: es.damage },
          ...(mod.damage !== 1 ? [{ label: 'Melee attacker in the back row', mult: mod.damage }] : []),
          ...(posMult !== 1 ? [{ label: posMult > 1 ? 'You are off balance' : 'You are guarded', mult: posMult }] : []),
          { label: 'Swing variance ±10%' },
          ...(counter ? [{ label: `${counter.name} intercepts`, mult: 1 - counter.reduce }] : []),
          ...(bite !== 1 ? [{ label: 'Conditions on the target', mult: bite }] : []),
          ...(braced > 0 ? [{ label: 'Braced — extra armor', value: braced }] : []),
          ...(cutTotal > 0 ? [{ label: 'Heavy stance cuts it by Power', value: -Math.round(cutTotal) }] : []),
        ],
        slices: [...slices.values()],
        hits,
        crit: false,
        incoming: true,
        total: dmg,
      },
    );
    ctx.emit(attackThrown, { attacker: e.entity, target: PLAYER, outcome: 'hit' });
    ctx.emit(hitLanded, { attacker: e.entity, target: PLAYER, total: dmg, crit: critted, kind: 'attack', type, thrown });
    // Contact cuts both ways.
    if (e.range === 'melee' && applyRetaliation(ctx, 'onContact', i)) return;
    if (answeredToDeath(ctx, e)) return;
    // The attacker's own conditions cost it for swinging.
    if (applyMonsterRetaliation(ctx, i, 'onAttack')) return;

    // What its blows leave behind. Rolled once for the exchange.
    const apps: StatusApplication[] = [...(kit.inflicts ?? []).map(toApplication), ...(move?.inflicts ?? [])];
    const inflicted = ctx.request(applyStatuses, {
      entity: PLAYER,
      apps,
      source: e.name,
      resist: true,
      penetration: MONSTERS[e.defId] ? penetrationOf(MONSTERS[e.defId]) : 0,
    });
    for (const inst of inflicted) {
      const sdef = STATUSES[inst.id];
      if (sdef && !sdef.hidden) feed(ctx, `${sdef.icon} You are ${sdef.name.toLowerCase()}!`);
    }

    ctx.emit(grantAttrXp, { attr: 'con', amount: 2 });
    // Exposure: taking typed damage can manifest and level the matching resistance skill.
    ctx.emit(checkDiscovery, { tags: [`resist:${type}`] });
    ctx.emit(grantSkillXp, { tags: [`resist:${type}`], amount: Math.min(6, 1 + dmg * 0.1) });
    if (!alive(ctx)) {
      onDefeat(ctx);
      return;
    }
    // Still standing, so the reflex completes: soften, then answer.
    if (counter) {
      counter.fire(ctx as ActionCtx, e);
      if (e.hp <= 0) onKill(ctx, i);
      if (!state.fight) return;
    }
  }
}
