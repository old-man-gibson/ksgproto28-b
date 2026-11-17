/**
 * Techniques in a fight: the registries, the ways into a technique, the move
 * it makes, and its execution from a rotation for monsters and the player.
 * Port of the execution half of the old `systems/martial.ts` and of the
 * technique branches of `systems/combat.ts`. See README.md in this folder
 * for the cut: learning, mastery, forks, weapon states and the planner are
 * step 3.
 *
 * This system registers three things with combat at module load: the monster
 * kind `technique`, the player kind `technique:` and the interception of the
 * incoming blow (counter techniques). It edits no file of combat.
 */
import { defineSystem, PLAYER, type DeepReadonly, type Modifier } from '../../kernel';
import { grantAttrXp } from '../attributes';
import combat, {
  addBuff,
  damageEnemy,
  hook,
  movePlayer,
  playerDamageType,
  playerPosition,
  POSITION_SOURCE,
  registerInterception,
  registerMonsterAction,
  registerPlayerAction,
  stampCooldown,
  takePrevented,
  triggerHolds,
  weaponSource,
  type ActionCtx,
  type ArmedInterception,
  type EnemyStrike,
  type Fight,
  type PickedActive,
} from '../combat';
import items, { itemDefOf } from '../items';
import { feedLine, type DamageReport, type DamageStep } from '../log';
import resources, { availableMax, drawNow, poolHooks, resourceValue, spendNow, type ResourceId } from '../resources';
import { grantSkillXp } from '../skills';
import { statBlockOf, type DerivedStats } from '../stats';
import statuses, { heldOf, statusDisplacedExit } from '../statuses';
import {
  forkArchetypes,
  NEUTRAL_POSITION,
  positions,
  POSITIONS,
  TECHNIQUE_LIST,
  techniques,
  TECHNIQUES,
  WATCH_KEY_PREFIX,
  type TechniqueDef,
  type TechniqueEntry,
  type TechniqueMove,
  type TechniqueState,
} from './defs';
import { migrations } from './migrations';

export * from './defs';

// ---- the slice ----

export interface MartialState {
  /** The ledger: a technique in it is known. The old `state.techniques`. Nothing writes it in spine port 5. */
  techniques: Record<string, TechniqueState>;
}

type Held = DeepReadonly<TechniqueState> | undefined;

/** States what the position the player stands in does to incoming blows and to dodge. */
export const POSITION_EFFECT_SOURCE = 'martial/position';

// ---- the ways in, the move, the exit ----

/** The ways a technique declares, with no ledger read. A monster and the content tests read these. The old `declaredEntries`. */
export function declaredEntries(def: TechniqueDef): readonly TechniqueEntry[] {
  return def.from;
}

/** Declared entry positions, flattened. The old `declaredPositions`. */
export function declaredPositions(def: TechniqueDef): string[] | 'any' {
  const entries = declaredEntries(def);
  if (entries.some((e) => e.at === 'any')) return 'any';
  return [...new Set(entries.flatMap((e) => e.at as string[]))];
}

/**
 * Every way into a technique for the one who holds it. The old
 * `techniqueEntries`. `held` is the ledger entry; step 3 adds the positions a
 * mastery rung opens (`mastery.addFrom`) here.
 */
export function entriesOf(def: TechniqueDef, held: Held): readonly TechniqueEntry[] {
  void held;
  return declaredEntries(def);
}

/** The watch counter a monster's use of a technique bumps. The old `watchStatKey`. */
export function watchStatKey(techniqueId: string): string {
  return `${WATCH_KEY_PREFIX}${techniqueId}`;
}

/**
 * The move as practice and provenance have shaped it. The old `resolvedMove`.
 * With no rung, no fork, no rune and a canonical form it is the declared
 * move, which is every case until step 3 writes the ledger.
 */
export function moveOf(def: TechniqueDef, held: Held): TechniqueMove {
  void held;
  return def.move;
}

/** Where executing it leaves the fighter. The old `techniqueExit`. Step 3 adds the fork and the rune. */
export function exitOf(def: TechniqueDef, held: Held): string {
  void held;
  return def.to;
}

/** The way in that is open now: a position it admits and its own trigger. The old `openEntry`. */
export function openEntry(ctx: ActionCtx, def: TechniqueDef, held: Held, position: string): TechniqueEntry | undefined {
  return entriesOf(def, held).find(
    (e) => (e.at === 'any' || e.at.includes(position)) && triggerHolds(ctx, e.trigger),
  );
}

/** Tags of everything worn, with `unarmed` for an empty weapon hand. The old `equippedTags`. */
function wornTags(ctx: ActionCtx): Set<string> {
  const worn = ctx.read(items).equipment;
  const tags = new Set<string>();
  for (const item of Object.values(worn)) {
    if (!item) continue;
    for (const t of itemDefOf(item)?.tags ?? []) tags.add(t);
  }
  if (!worn.weapon) tags.add('unarmed');
  return tags;
}

/** Whether the required weapon family is worn. No family: anything. The old `techniqueArmed`. */
export function techniqueArmed(ctx: ActionCtx, def: TechniqueDef): boolean {
  return !def.family || wornTags(ctx).has(def.family);
}

/**
 * The weapon-state requirement a technique cannot meet, or null. The old
 * `weaponStateGate`. Grounded, impaled and sheathed weapons and readied
 * spells are states of step 3: a technique that needs one cannot run yet.
 */
export function weaponStateGate(
  ctx: ActionCtx,
  def: TechniqueDef,
): 'wielded' | 'grounded' | 'sheathed' | 'impaled' | 'readied' | null {
  if (def.requiresWielded && !ctx.read(items).equipment.weapon) return 'wielded';
  if (def.requiresGrounded) return 'grounded';
  if (def.requiresImpaled) return 'impaled';
  if (def.requiresReadiedSpell) return 'readied';
  if (def.requiresSheathed) return 'sheathed';
  return null;
}

const STEP_3_STATES: Record<string, string> = {
  grounded: 'it needs a grounded weapon (weapon states: step 3)',
  impaled: 'it needs an impaled weapon (weapon states: step 3)',
  sheathed: 'it needs a sheathed weapon (weapon states: step 3)',
  readied: 'it needs a readied spell (readied spells: step 3)',
};

/** What a move does that step 3 owns, or null. */
function unportedEffect(move: TechniqueMove): string | null {
  if (move.equipment) return `its move changes the weapon state "${move.equipment}" (weapon states: step 3)`;
  if (move.readiesSpell || move.deliversSpell) return 'its move readies or delivers a spell (readied spells: step 3)';
  return null;
}

const ledgerOf = (ctx: ActionCtx): DeepReadonly<MartialState['techniques']> => ctx.read(martial).techniques;

const feed = (ctx: ActionCtx, text: string, damage?: DamageReport): void =>
  ctx.emit(feedLine, damage ? { text, damage } : { text });

// ---- a monster's technique ----

registerMonsterAction('technique', {
  available(_ctx, enemy, entry) {
    if (!('technique' in entry)) return false;
    const def = TECHNIQUES[entry.technique];
    if (!def) return `no technique has the id "${entry.technique}"`;
    // A monster has no ledger: it reads the declared ways only, and no trigger.
    const from = declaredPositions(def);
    return from === 'any' || from.includes(enemy.position ?? NEUTRAL_POSITION);
  },
  shape(_ctx, _enemy, entry) {
    const def = TECHNIQUES[(entry as { technique: string }).technique];
    const move = def.move;
    return {
      name: def.name,
      icon: def.icon,
      ...(move.damageMult !== undefined ? { damageMult: move.damageMult } : {}),
      // The old enemy phase threw the blow as `move.damageType ?? kit.damageType`.
      ...(move.damageType ? { damageType: move.damageType } : {}),
      ...(move.hits !== undefined ? { hits: move.hits } : {}),
      ...(move.inflicts ? { inflicts: move.inflicts } : {}),
      // The old enemy phase stamped `tech.move.cooldown ?? 60`; every record has a cooldown.
      cooldown: move.cooldown,
      to: def.to,
      watchKey: watchStatKey(def.id),
    };
  },
});

// ---- the player's technique ----

const PREFIX = 'technique:';

/** Known techniques in registry order. The old `knownTechniques`. */
export function knownTechniques(state: DeepReadonly<MartialState>): TechniqueDef[] {
  if (!hasAny(state.techniques)) return [];
  return TECHNIQUE_LIST.filter((t) => !!state.techniques[t.id]);
}

function hasAny(record: DeepReadonly<Record<string, unknown>>): boolean {
  for (const _ in record) return true;
  return false;
}

/** The gates every path into a player's technique shares, in the old order. A string is a reason. */
function gate(ctx: ActionCtx, def: TechniqueDef, held: Held, fight: DeepReadonly<Fight>, baked: boolean): true | false | string {
  if (!techniqueArmed(ctx, def)) return false;
  const state = weaponStateGate(ctx, def);
  if (state) return STEP_3_STATES[state] ?? false;
  // The baked reflex gates every way in; then one way must be open.
  if (baked && !triggerHolds(ctx, def.trigger)) return false;
  if (!openEntry(ctx, def, held, fight.position)) return false;
  return true;
}

registerPlayerAction(PREFIX, {
  rank: 30,
  known: (ctx) => knownTechniques(ctx.read(martial)).map((t) => `${PREFIX}${t.id}`),
  pick(ctx, id, slot, fight) {
    const def = TECHNIQUES[id.slice(PREFIX.length)];
    if (!def) return `no technique has the id "${id.slice(PREFIX.length)}"`;
    const held = ledgerOf(ctx)[def.id];
    if (!held) return 'the technique is not known';
    // A counter lives inside the enemy's attack: neither slot picks it.
    if (def.move.counter) return null;
    const offensive = def.move.damageMult !== undefined;
    if ((slot === 'attack') !== offensive) return null;
    const open = gate(ctx, def, held, fight, true);
    if (open !== true) return open === false ? null : open;
    const move = moveOf(def, held);
    const unported = unportedEffect(move);
    if (unported) return unported;
    const exit = exitOf(def, held);

    if (offensive) {
      const picked: PickedActive = {
        id,
        cooldown: move.cooldown,
        usesHands: true,
        shape: {
          label: `${def.icon} ${def.name} strikes`,
          hitLabel: def.name,
          damageMult: move.damageMult,
          ...(move.hits !== undefined ? { hits: move.hits } : {}),
          ...(move.penetration !== undefined ? { penetration: move.penetration } : {}),
          ...(move.splash !== undefined ? { splash: move.splash } : {}),
          ...(move.crit ? { crit: { floor: move.crit.floor, damageMult: move.crit.damageMult } } : {}),
          ...(move.inflicts ? { inflicts: move.inflicts } : {}),
          ...(move.staminaCost !== undefined ? { staminaCost: move.staminaCost } : {}),
          ...(move.momentum !== undefined ? { momentum: move.momentum } : {}),
          // A deflection answers with what its own trigger's defence stopped.
          ...(move.preventedMult
            ? { prevented: { by: def.trigger?.event === 'onParry' ? ('onParry' as const) : ('onHit' as const), mult: move.preventedMult } }
            : {}),
          to: exit,
        },
      };
      return picked;
    }

    // A defensive form: it fires from the buff slot as soon as its moment comes.
    return {
      id,
      cooldown: move.cooldown,
      usesHands: false,
      cast(c) {
        const stats = statBlockOf(c);
        if (move.buff) c.request(addBuff, { name: def.name, mods: move.buff.mods, ticksLeft: move.buff.duration });
        if (move.staminaCost) {
          c.request(drawNow, { id: 'stamina', amount: stats.maxStamina * move.staminaCost * stats.staminaEff });
        }
        c.request(movePlayer, { to: exit });
        feed(c, `${def.icon} ${def.name} — you settle ${POSITIONS[exit]?.name ?? exit}.`);
        c.emit(grantAttrXp, { attr: 'dex', amount: 2 });
        c.emit(grantSkillXp, { tags: ['combat', ...(def.family ? [def.family] : [])], amount: 3 });
      },
    };
  },
});

// ---- counters: techniques that live inside the enemy's attack ----

/** What one interception costs: a share of the pool's usable size, trimmed by its efficiency. The old `counterPrice`. */
function counterPrice(ctx: ActionCtx, stats: Readonly<DerivedStats>, pool: ResourceId, cost: number): number {
  const eff = pool === 'stamina' ? stats.staminaEff : pool === 'mana' ? stats.manaEff : 1;
  return availableMax(stats as DerivedStats, poolHooks(ctx), pool) * cost * eff;
}

/**
 * The counter form ready to intercept `event` now: the first in rotation
 * order that is known, off its clock, armed, open from where the player
 * stands and affordable. Its own event is happening now, so the baked
 * trigger is not asked. The old `pickCounter`.
 */
function pickCounter(ctx: ActionCtx, fight: DeepReadonly<Fight>, event: string): ArmedInterception | null {
  const book = ledgerOf(ctx);
  // Asked on every blow that lands: an empty ledger answers at once.
  if (!hasAny(book)) return null;
  const state = ctx.read(combat);
  // The explicit rotation first, then the rest in registry order: the order `activeRotation` gives techniques.
  const order: string[] = [];
  for (const id of state.rotation) {
    if (id.startsWith(PREFIX) && book[id.slice(PREFIX.length)] && !order.includes(id)) order.push(id);
  }
  for (const def of TECHNIQUE_LIST) {
    const id = `${PREFIX}${def.id}`;
    if (book[def.id] && !order.includes(id)) order.push(id);
  }
  const stats = statBlockOf(ctx);
  for (const id of order) {
    const def = TECHNIQUES[id.slice(PREFIX.length)];
    const held = book[def?.id ?? ''];
    if (!def?.move.counter) continue;
    if ((def.trigger?.event ?? 'onHit') !== event) continue;
    if ((fight.cooldowns[id] ?? 0) > 0) continue;
    if (gate(ctx, def, held, fight, false) !== true) continue;
    // Benching a counter switches the reflex off like anything else.
    if (!triggerHolds(ctx, state.triggers[id])) continue;
    const move = moveOf(def, held);
    const spec = move.counter!;
    const pool = spec.pool as ResourceId | undefined;
    // An empty pool is not a refusal: just not this blow.
    if (pool && spec.cost && counterPrice(ctx, stats, pool, spec.cost) > resourceValue(ctx.read(resources), pool)) continue;
    return {
      name: def.name,
      reduce: spec.reduce,
      fire: (c, target) => fireCounter(c, id, def, held, move, target),
    };
  }
  return null;
}

/**
 * The answer, on the spot and free of the action bar: the player's damage in
 * the weapon's type, and what was just stopped in the type the technique
 * names. Whoever threw the blow is who it answers. The old `fireCounter`,
 * without the readied spell (step 3).
 */
function fireCounter(
  ctx: ActionCtx,
  id: string,
  def: TechniqueDef,
  held: Held,
  move: TechniqueMove,
  target: DeepReadonly<{ entity: string; name: string }>,
): void {
  const stats = statBlockOf(ctx);
  const spec = move.counter!;
  const pool = spec.pool as ResourceId | undefined;
  if (pool && spec.cost) ctx.request(spendNow, { id: pool, amount: counterPrice(ctx, stats, pool, spec.cost) });

  const type = playerDamageType(ctx);
  const strikes: EnemyStrike[] = [];
  const steps: DamageStep[] = [];
  if (move.damageMult) {
    strikes.push({ type, raw: stats.damage * move.damageMult });
    steps.push({ label: 'Damage', value: stats.damage });
    if (move.damageMult !== 1) steps.push({ label: def.name, mult: move.damageMult });
  }
  if (move.preventedMult) {
    const stopped = ctx.request(takePrevented, { by: 'onHit' });
    if (stopped > 0) {
      strikes.push({ type: move.damageType ?? type, raw: stopped * move.preventedMult });
      steps.push({ label: 'Damage blocked', value: stopped * move.preventedMult });
    }
  }
  const landed = ctx.request(damageEnemy, {
    entity: target.entity,
    strikes,
    source: weaponSource(ctx),
    penetration: stats.penetration,
    kind: 'strike',
  });
  if (landed) {
    feed(ctx, `${def.icon} ${def.name} answers the ${target.name} for ${landed.dealt}`, {
      label: def.name,
      target: target.name,
      steps,
      slices: landed.slices,
      hits: 1,
      crit: false,
      total: landed.dealt,
    });
  }
  ctx.request(stampCooldown, { id, ticks: move.cooldown });
  const displaced = statusDisplacedExit((p) => ctx.rng.chance(p), heldOf(ctx.read(statuses)));
  ctx.request(movePlayer, { to: displaced ?? exitOf(def, held) });
  ctx.emit(grantAttrXp, { attr: 'dex', amount: 2 });
  ctx.emit(grantSkillXp, { tags: ['combat', ...(def.family ? [def.family] : [])], amount: 3 });
}

registerInterception('martial/counter', { arm: pickCounter });

// ---- the declaration ----

const martial = defineSystem<MartialState>({
  id: 'martial',
  version: 1,
  migrations,
  initial: () => ({ techniques: {} }),
  content: { positions, fork_archetypes: forkArchetypes, techniques },

  modifiers: [
    {
      id: POSITION_EFFECT_SOURCE,
      // Reads where the player stands in the fight; combat touches its
      // position source when that changes.
      dependsOn: [POSITION_SOURCE],
      collect: ({ entity, read }): Modifier[] => {
        if (entity !== PLAYER) return [];
        const effects = POSITIONS[playerPosition(read(combat))]?.effects;
        if (!effects) return [];
        const mods: Modifier[] = [];
        // `|| 1`: an incoming multiplier of 0 reads as none, as the old `positionIncomingMult` did.
        if (effects.incomingMult) mods.push({ stat: hook.positionIncomingMult, kind: 'mult', value: effects.incomingMult });
        // An explicit 0 is kept: a position taken wide open dodges nothing.
        if (effects.dodgeMult !== undefined) mods.push({ stat: hook.positionDodgeMult, kind: 'mult', value: effects.dodgeMult });
        return mods;
      },
    },
  ],

  view: (ctx) => ({
    known: knownTechniques(ctx.state).map((t) => ({ id: t.id, name: t.name, icon: t.icon })),
  }),
});

export default martial;
