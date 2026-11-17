/**
 * Rotation entries: the kinds a combatant's action bar can spend itself on.
 *
 * The old `pickActive` and `pickMonsterAction` knew every kind by name
 * (skill actives, techniques, crafted spells, ability actions, the gene
 * active; monster techniques and monster workings). Here a kind is
 * registered by the system that owns it, at module load, and the tick asks
 * the registry. This file imports no system that registers a kind, so a new
 * kind edits no file in this folder.
 *
 * A handler is given a narrow context: it can read, roll, emit and make
 * requests. It does not get the combat slice. To change its own slice it
 * makes a request to its own system; to hurt an enemy it makes
 * `combat/damage-enemy`.
 *
 * Port 4 registered no kind. Port 5 registers `technique` (martial) and
 * `cast` (spellcraft) for monsters, `technique:` and `grimoire:` for the
 * player. The normal attack is what a combatant does when its rotation
 * offers nothing.
 *
 * Two more registries hold the hooks inside a blow that a kind cannot reach:
 * an interception (a counter technique: inside the enemy's blow) and a blow
 * rider (a coating: per hit of the player's blow).
 */
import type { Ctx, DeepReadonly } from '../../kernel';
import type { MonsterAction } from '../monsters';
import type { DamageType } from '../stats';
import type { StatusApplication } from '../statuses';
import type { Enemy, Fight } from './types';

/** What a handler may use of the kernel context. */
export type ActionCtx = Pick<Ctx<unknown>, 'tick' | 'rng' | 'derived' | 'stats' | 'read' | 'request' | 'emit' | 'skip'>;

// ---- monsters ----

/**
 * How a technique shapes the monster's normal attack. The old
 * `TechniqueMove` fields the enemy attack phase read, plus the walk.
 */
export interface MonsterShape {
  name: string;
  icon: string;
  damageMult?: number;
  damageType?: DamageType;
  /** Blows in the exchange. Default 1. */
  hits?: number;
  inflicts?: StatusApplication[];
  /** Ticks before the entry may fire again. Default 60. */
  cooldown?: number;
  /** The position the exchange leaves the monster in. */
  to: string;
  /** Counter bumped when the move comes at the player (the old `watchStatKey`). */
  watchKey?: string;
}

export interface MonsterActionKind {
  /**
   * Whether the entry can be chosen now. The clock and the `uses` count are
   * checked by the tick before this is asked. The old gates of
   * `pickMonsterAction`: a technique's `from` positions; for a working, a
   * counterspell, a kin-only working with no kin, a mind in debt, a seal.
   *
   * `true`: it can. `false`: not now, and that is the ordinary rhythm of a
   * fight (the position, a trap that waits). A string: it cannot, for the
   * reason given; the tick reports it once per fight and entry.
   */
  available(
    ctx: ActionCtx,
    enemy: DeepReadonly<Enemy>,
    entry: DeepReadonly<MonsterAction>,
    fight: DeepReadonly<Fight>,
    index: number,
  ): boolean | string;
  /**
   * A technique: the shape of the swing. The tick stamps the clock, moves the
   * monster and throws the blow.
   */
  shape?(ctx: ActionCtx, enemy: DeepReadonly<Enemy>, entry: DeepReadonly<MonsterAction>): MonsterShape;
  /**
   * A working: it replaces the swing. The handler does everything, including
   * the clock (`combat/stamp-action`). Dodge, parry and the ranged wall are
   * not rolled. The tick sweeps the dead and checks the player afterwards.
   */
  perform?(ctx: ActionCtx, enemy: DeepReadonly<Enemy>, entry: DeepReadonly<MonsterAction>, index: number): void;
}

const MONSTER_KINDS = new Map<string, MonsterActionKind>();

/** The kind of a monster rotation entry: `technique` or `cast`. */
export function monsterActionKind(entry: DeepReadonly<MonsterAction>): string {
  return 'cast' in entry ? 'cast' : 'technique';
}

/** Register the handler of a monster rotation kind. Called at module load by the system that owns the kind. */
export function registerMonsterAction(kind: string, handler: MonsterActionKind): void {
  if (MONSTER_KINDS.has(kind)) throw new Error(`combat: monster action kind "${kind}" is registered twice`);
  MONSTER_KINDS.set(kind, handler);
}

export function monsterActionHandler(kind: string): MonsterActionKind | undefined {
  return MONSTER_KINDS.get(kind);
}

// ---- the player ----

/**
 * How an active shapes the player's swing. The old `TechniqueMove` and
 * strike `ActiveSpec` fields the player attack read.
 */
export interface SwingShape {
  /** "<label> the <monster> for N". Default "You hit". */
  label: string;
  /** The name of the blow in the damage report. */
  hitLabel: string;
  damageMult?: number;
  /** Base blows. Default 1. */
  hits?: number;
  penetration?: number;
  splash?: number;
  /** A named crit: no roll, the ledger untouched. */
  crit?: { floor?: number; damageMult?: number };
  inflicts?: StatusApplication[];
  /** Share of max stamina, on top of the swing's upkeep. */
  staminaCost?: number;
  momentum?: number;
  /** Multiplier on what the last block or parry stopped, added to the blow. */
  prevented?: { by: 'onHit' | 'onParry'; mult: number };
  /** The position the blow leaves the player in. Default neutral. */
  to?: string;
  /** Tags the swing's skill XP goes to. Default: the fight's tags. */
  tags?: string[];
}

export interface PickedActive {
  id: string;
  /** Ticks before it is ready again. Stamped by the tick when it is used. */
  cooldown: number;
  /** Needs a hand holding a weapon. A swing-shaping active does; a working does not. */
  usesHands: boolean;
  /** Rolls nothing to hit. */
  sure?: boolean;
  /** The damage type coming at the target, for the magnetism check. Default: the weapon's. */
  approach?: DamageType;
  /** A swing-shaping active: the tick throws the blow. */
  shape?: SwingShape;
  /**
   * A working that takes the swing's place, called once the blow is neither
   * evaded nor fumbled. The handler lands it through `combat/damage-enemy`.
   */
  cast?(ctx: ActionCtx): void;
  /** Called after a shaped blow landed (equipment follow-through, mastery). */
  after?(ctx: ActionCtx): void;
}

export interface PlayerActionKind {
  /** The ids of this kind the player has, beyond the explicit order (known techniques, prepared spells). */
  known(ctx: ActionCtx): string[];
  /**
   * The active when it can be used now for `slot`, else null. The cooldown
   * is checked by the tick before this is asked. `attack` spends the action
   * bar; `buff` fires as soon as it is ready and is performed by the handler.
   *
   * Null: not now (the slot, the position, a trigger). A string: it cannot
   * be used, for the reason given; the tick reports it once per fight and id.
   */
  pick(ctx: ActionCtx, id: string, slot: 'attack' | 'buff', fight: DeepReadonly<Fight>): PickedActive | string | null;
}

const PLAYER_KINDS = new Map<string, PlayerActionKind>();

/**
 * Register a kind of player active by the prefix of its rotation id:
 * `technique:`, `grimoire:`, `facet:`. A kind with one id (the gene active)
 * registers the whole id.
 */
export function registerPlayerAction(prefix: string, handler: PlayerActionKind): void {
  if (PLAYER_KINDS.has(prefix)) throw new Error(`combat: player action kind "${prefix}" is registered twice`);
  PLAYER_KINDS.set(prefix, handler);
}

/** The handler of a rotation id, by the longest registered prefix. */
export function playerActionHandler(id: string): PlayerActionKind | undefined {
  let best: string | undefined;
  for (const prefix of PLAYER_KINDS.keys()) {
    if (id.startsWith(prefix) && (best === undefined || prefix.length > best.length)) best = prefix;
  }
  return best === undefined ? undefined : PLAYER_KINDS.get(best);
}

/** Every registered player kind, in registration order. */
export function playerActionKinds(): IterableIterator<[string, PlayerActionKind]> {
  return PLAYER_KINDS.entries();
}

/** Tests only: drop a registered kind. */
export function unregisterAction(side: 'monster' | 'player', key: string): void {
  (side === 'monster' ? MONSTER_KINDS : PLAYER_KINDS).delete(key);
}

// ---- inside the enemy's blow ----

/**
 * A reflex that has passed every gate and waits on the blow itself. The old
 * `ArmedCounter`.
 */
export interface ArmedInterception {
  /** Named in the damage report: "<name> intercepts". */
  name: string;
  /** Share of each hit taken off before the heavy stance and armour (0 to 1). */
  reduce: number;
  /**
   * The answer, after the exchange, when the player still stands. `target` is
   * the enemy that threw the blow. The handler lands it through
   * `combat/damage-enemy`; the tick processes a kill.
   */
  fire(ctx: ActionCtx, target: DeepReadonly<Enemy>): void;
}

export interface InterceptionKind {
  /**
   * The interception ready for `event` now, or null. Asked once per exchange,
   * after dodge, shroud, wall and parry have failed and before the hits are
   * rolled: the point the old enemy phase called `pickCounter`.
   */
  arm(ctx: ActionCtx, fight: DeepReadonly<Fight>, event: string): ArmedInterception | null;
}

const INTERCEPTIONS = new Map<string, InterceptionKind>();

/** Register an interception of the incoming blow. Called at module load by the system that owns it. */
export function registerInterception(key: string, handler: InterceptionKind): void {
  if (INTERCEPTIONS.has(key)) throw new Error(`combat: interception "${key}" is registered twice`);
  INTERCEPTIONS.set(key, handler);
}

/** The first registered interception that arms for the event, in registration order. */
export function armInterception(ctx: ActionCtx, fight: DeepReadonly<Fight>, event: string): ArmedInterception | null {
  for (const handler of INTERCEPTIONS.values()) {
    const armed = handler.arm(ctx, fight, event);
    if (armed) return armed;
  }
  return null;
}

// ---- inside the player's blow ----

/** Typed damage one hit carries on top of the weapon's own. */
export interface RiderSlice {
  type: DamageType;
  value: number;
  source: string;
  /** Added to the blow's penetration for this slice. */
  penetration?: number;
}

export interface BlowRiderKind {
  /**
   * Asked once per hit of a weapon blow, after the weapon's own typed bonuses
   * (the old `spendCoating`). The handler spends its supply through a request
   * to its own system. An empty list: nothing rides this hit.
   */
  perHit(ctx: ActionCtx, target: DeepReadonly<Enemy>): RiderSlice[];
  /**
   * Asked once after the blow when `perHit` returned a slice for any hit:
   * conditions for the target (applied while it lives, with the blow's
   * penetration) and a feed line (a coating used up).
   */
  afterBlow?(ctx: ActionCtx, target: DeepReadonly<Enemy>): { inflicts?: StatusApplication[]; source: string; line?: string };
}

const BLOW_RIDERS = new Map<string, BlowRiderKind>();

/** Register a per-hit rider of the player's weapon blow. Called at module load by the system that owns it. */
export function registerBlowRider(key: string, handler: BlowRiderKind): void {
  if (BLOW_RIDERS.has(key)) throw new Error(`combat: blow rider "${key}" is registered twice`);
  BLOW_RIDERS.set(key, handler);
}

export function blowRiders(): IterableIterator<BlowRiderKind> {
  return BLOW_RIDERS.values();
}

/** Tests only: drop a registered hook. */
export function unregisterHook(kind: 'interception' | 'rider', key: string): void {
  (kind === 'interception' ? INTERCEPTIONS : BLOW_RIDERS).delete(key);
}
