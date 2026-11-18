/**
 * Combat: the fight, from spawn to kill or defeat, the fight ledger and the
 * rest rule. Port of the old `systems/combat.ts`, `systems/ledger.ts` and
 * `systems/huntrest.ts`. See README.md in this folder.
 *
 * - `engine.ts` holds the fight: start, tick, kill, defeat, close.
 * - `spawn.ts` holds monster generation.
 * - `damage.ts` holds the typed-damage maths.
 * - `ledger.ts` holds the fight ledger.
 * - `actions.ts` holds the registry of rotation kinds.
 * - This file owns the slice and declares what other systems send and hear.
 */
import {
  answer,
  cloneJson,
  defineCommand,
  defineEvent,
  defineRequest,
  defineSystem,
  handle,
  OK,
  on,
  PLAYER,
  skipped,
  type DeepReadonly,
  type Json,
  type StatDef,
} from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import log, { logLine, transcriptClose, transcriptForSave } from '../log';
import { MONSTERS, monsterFactMod, type MonsterRange } from '../monsters';
import resources, { isAlive, playerDamaged, playerHealed } from '../resources';
import {
  ATTRIBUTE_IDS,
  baseAttrFact,
  contentMod,
  statBlockOf,
  type ContentMod,
  type DamageType,
  type StatMod,
} from '../stats';
import statuses, {
  conditionDamage,
  conditionDetonated,
  conditionFatal,
  heldOf,
  STATUSES,
  visibleStatuses,
} from '../statuses';
import type { ActionCtx } from './actions';
import type { TypedSlice } from './damage';
import {
  abandonCombat,
  addBuff as pushBuff,
  attackRetaliation,
  BUFFS_SOURCE,
  closeLedger,
  fallToCondition,
  healEnemy as healEnemyNow,
  hook,
  inForcedFight,
  landSlices as landSlicesNow,
  markCombatEvent,
  now,
  POSITION_SOURCE,
  MOMENTUM_SOURCE,
  restTarget,
  runCombatTick,
  setPlayerPosition,
  setResting,
  stampMonsterAction,
  startForcedFight,
  startStagedGroup,
  strikeEnemy,
  type EnemyDamageResult,
  type EnemyStrike,
  type HitKind,
  type StagedMember,
} from './engine';
import {
  dropFight,
  endFight,
  isKept,
  keepFight,
  noteConditionDamage,
  noteHealed,
  noteHealRefused,
  noteIncoming,
  noteOutgoing,
} from './ledger';
import { migrations } from './migrations';
import { combatText, TEXT } from './text';
import { evaluateTrigger, type SkillTrigger } from './triggers';
import type { CombatBuff, CombatState, EncounterSite, Enemy, FightLedger, HuntRest, StyleState } from './types';

export * from './actions';
export * from './triggers';
export * from './damage';
export * from './engine';
export * from './ledger';
export * from './spawn';
export { TEXT } from './text';
export * from './types';

// ---- commands ----

/** Set the site and turn the hunt loop on. A fight is rolled when the respawn timer runs out. */
export const hunt = defineCommand<{ site: EncounterSite }>('combat/hunt');
/** Turn the hunt loop off and walk away from the fight. Refused in a forced fight. */
export const stopHunt = defineCommand<void>('combat/stop');
/** The rest rule: the share of max HP under which a hunt rests first (0 is off), and what resting aims for. */
export const setHuntRest = defineCommand<{ at: number; toFull: boolean }>('combat/set-hunt-rest');
/** Keep the last fight in the notebook. */
export const keepLastFight = defineCommand<void>('combat/keep-fight');
/** Forget a kept fight. */
export const dropKeptFight = defineCommand<{ id: number }>('combat/drop-fight');
/** The player's explicit order of actives. */
export const setRotation = defineCommand<{ order: string[] }>('combat/set-rotation');
/** The player's own trigger on a rotation id. `trigger: null` removes it. */
export const setTrigger = defineCommand<{ id: string; trigger: SkillTrigger | null }>('combat/set-trigger');

// ---- requests ----

/** Start the fight a site forces on arrival. True when a fight began. The old `startForcedFight`. */
export const startForced = defineRequest<{ site: EncounterSite }, boolean>('combat/start-forced');
/** Start a staged, forced formation. An open fight is abandoned first. The old `startStagedGroup`. */
export const startStaged = defineRequest<{ site: EncounterSite; members: StagedMember[] }, void>('combat/start-staged');
/**
 * The hunt loop set from a system: the site, and the loop on. What the hunt
 * activity of the world system sends, where `combat/hunt` is the command of
 * the panel. A fight open at another site is abandoned. False when the site
 * is unsound or the open fight cannot be left.
 */
export const setHunt = defineRequest<{ site: EncounterSite }, boolean>('combat/set-hunt');
/** The hunt loop off, without leaving a fight: the caller abandons it first. */
export const stopHuntLoop = defineRequest<void, void>('combat/stop-hunt');
/** Leave the fight. Never refuses. True when there was one. The old `abandonCombat`. */
export const abandon = defineRequest<void, boolean>('combat/abandon');
/**
 * Damage from outside the normal attack lands on an enemy. Null when no
 * enemy has the entity id or it is already dead. The dead are swept by the
 * tick, not here.
 */
export const damageEnemy = defineRequest<
  { entity: string; strikes: EnemyStrike[]; source: string; penetration?: number; kind?: HitKind },
  EnemyDamageResult | null
>('combat/damage-enemy');
/** Stamp a monster's rotation entry as fired. For the kind that performs a working. False for an unknown entity. */
export const stampAction = defineRequest<
  { entity: string; index: number; cooldown: number; name?: string; icon?: string },
  boolean
>('combat/stamp-action');
/**
 * Heal a monster: kindness from its own side, or life forced into it by a
 * working (the default). The old `healEnemy`. A burst is not swept here.
 */
export const healEnemy = defineRequest<
  { entity: string; amount: number; source: string; hostile?: boolean; penetration?: number },
  void
>('combat/heal-enemy');
/**
 * Slices the caller computed land on an enemy. Null when no living enemy has
 * the entity id. The landing of the old `castCraftedAttack`.
 */
export const landSlices = defineRequest<
  { entity: string; slices: TypedSlice[]; crit?: boolean; kind?: HitKind },
  { dealt: number; bite: number; killed: boolean } | null
>('combat/land-slices');
/** HP taken off a monster with no defence asked and nothing told: a backlash, a spill. */
export const hurtEnemy = defineRequest<{ entity: string; amount: number; type: DamageType; outgoing?: boolean }, void>(
  'combat/hurt-enemy',
);
/** A buff on the player for the fight. The old `c.buffs.push`. */
export const addBuff = defineRequest<CombatBuff, void>('combat/add-buff');
/** Move the player to a position. The old `setPosition`. */
export const movePlayer = defineRequest<{ to: string }, void>('combat/move-player');
/** Put a rotation id of the player on its clock. */
export const stampCooldown = defineRequest<{ id: string; ticks: number }, void>('combat/stamp-cooldown');
/** Stamp a trigger event on the fight. The old `markCombatEvent`. */
export const markEvent = defineRequest<{ event: string }, void>('combat/mark-event');
/** Read and spend what the last block or parry stopped. */
/**
 * Switch a rotation entry on or off, keeping the rest of its trigger. Martial's
 * bench writes through it: a benched technique is one switched off (old
 * `benchTechnique`, `setTechniqueSlotted`).
 */
export const enableAction = defineRequest<{ id: string; enabled: boolean }, void>('combat/enable-action');
export const takePrevented = defineRequest<{ by: 'onHit' | 'onParry' }, number>('combat/take-prevented');
/** The cost of attacking under the player's conditions, for a working that takes the swing's place. True when fatal. */
export const retaliateAttack = defineRequest<void, boolean>('combat/attack-retaliation');

// ---- events to this system ----

/** Request: state the style fought in and its exertion. The styles system sends it when the style changes. */
export const setStyle = defineEvent<StyleState>('combat/set-style');

// ---- reads ----

type State = DeepReadonly<CombatState>;

export function inCombat(state: State): boolean {
  return state.fight !== null;
}

/** True while the hunt is holding its next fight back so the player can rest. */
export function restingForFight(state: State): boolean {
  return state.huntRest.active;
}

function enemyOf(state: CombatState, entity: string): Enemy | null {
  return state.fight?.enemies.find((e) => e?.entity === entity) ?? null;
}

/** Why a site cannot be fought at, or null. */
export function siteIssue(site: DeepReadonly<EncounterSite> | undefined): string | null {
  if (!site || typeof site.id !== 'string' || !Array.isArray(site.encounters)) return 'the site has no id or no encounter list';
  for (const line of site.encounters) {
    if (!MONSTERS[line.monsterId]) return `the site names the unknown monster "${line.monsterId}"`;
    if (!Array.isArray(line.level) || line.level.length !== 2 || line.level[0] > line.level[1])
      return `line "${line.monsterId}" needs a lowest and a highest level`;
  }
  return null;
}

// ---- stats ----

const stats: Record<string, StatDef> = {
  [hook.darkness]: { base: 0 },
  [hook.positionDodgeMult]: { base: 1 },
  [hook.positionIncomingMult]: { base: 1 },
  [hook.barFillMult]: { base: 1 },
};

/** States what every enemy of the fight is: its attributes and the monster fact. */
export const MONSTERS_SOURCE = 'combat/monsters';

// ---- view ----

export interface EnemyView {
  entity: string;
  defId: string;
  name: string;
  icon: string;
  /** Portrait file name of the old build. The file is licensed art and is not in this repository. */
  art: string | null;
  level: number;
  hp: number;
  maxHp: number;
  /** Action bar, 0 to 1. */
  bar: number;
  range: MonsterRange;
  /** Icons of its visible conditions. */
  conditions: string[];
  /** The rotation entry it used within the last `ACTION_SHOWN_TICKS`, or null. */
  action: { name: string; icon: string } | null;
}

/** Ticks the panel shows a monster's last action for. */
export const ACTION_SHOWN_TICKS = 30;

export interface CombatView {
  inFight: boolean;
  forced: boolean;
  hunting: boolean;
  resting: boolean;
  /** Seconds until the next roll while hunting with no fight. */
  respawnIn: number;
  site: { id: string; name: string } | null;
  /** The player's action bar, 0 to 1. */
  playerBar: number;
  /** Five slots. Slot 0 is the centre. */
  enemies: (EnemyView | null)[];
  huntRest: HuntRest;
  lastFight: FightLedger | null;
  lastFightKept: boolean;
  notebook: { id: number; keptAt: number; outcome: string; foes: string }[];
  rotation: string[];
}

const copy = <T>(value: DeepReadonly<T>): T => cloneJson(value as Json) as T;

// ---- the declaration ----

const combat = defineSystem<CombatState, CombatView>({
  id: 'combat',
  version: 2,
  migrations,
  // After `resources` and `statuses`: the old loop ticked the pools, the
  // player's conditions and the health trickle before the fight.
  order: 10,
  initial: () => ({
    fight: null,
    site: null,
    hunting: false,
    respawnTimer: 0,
    ledger: null,
    lastFight: null,
    notebook: [],
    huntRest: { at: 0, toFull: true, active: false },
    // The default style of the old build and its exertion, until the styles
    // system states the style.
    style: { id: 'balanced', exertion: { on: 'attack', cost: 0.02, hit: { damage: 0.1 } } },
    rotation: [],
    triggers: {},
    nextEntity: 1,
  }),
  content: { combat_text: combatText },
  stats,

  modifiers: [
    {
      id: MONSTERS_SOURCE,
      collect: ({ state, entity }) => {
        if (entity === PLAYER || !state.fight) return [];
        const e = state.fight.enemies.find((m) => m?.entity === entity);
        if (!e) return [];
        const mods: StatMod[] = [monsterFactMod(e.defId, e.level, e.kit as Enemy['kit'])];
        for (const id of ATTRIBUTE_IDS) mods.push(baseAttrFact(id, e.attrs[id] ?? 0));
        return mods;
      },
    },
    // States nothing: it is the change counter of the player's position, for
    // the source of another system that reads `fight.position` (`dependsOn`).
    { id: POSITION_SOURCE, collect: () => [] },
    { id: MOMENTUM_SOURCE, collect: () => [] },
    {
      id: BUFFS_SOURCE,
      collect: ({ state, entity }) => {
        if (entity !== PLAYER || !state.fight) return [];
        const mods: StatMod[] = [];
        for (const buff of state.fight.buffs)
          for (const m of buff.mods) mods.push(contentMod(m as ContentMod, `Buff: ${buff.name}`, { kind: 'buff' }));
        return mods;
      },
    },
  ],

  tick: runCombatTick,

  commands: [
    handle(hunt, (ctx, { site }) => {
      const issue = siteIssue(site);
      if (issue) return skipped(issue);
      if (ctx.state.fight) {
        if (inForcedFight(ctx.state)) return skipped('the fight cannot be left');
        if (ctx.state.site?.id !== site.id) abandonCombat(ctx);
      }
      ctx.state.site = copy(site);
      ctx.state.hunting = true;
      return OK;
    }),
    handle(stopHunt, (ctx) => {
      if (inForcedFight(ctx.state)) return skipped('the fight cannot be left');
      if (!ctx.state.hunting && !ctx.state.fight) return skipped('no hunt is on and no fight is open');
      ctx.state.hunting = false;
      setResting(ctx, false);
      if (ctx.state.fight) abandonCombat(ctx);
      return OK;
    }),
    handle(setHuntRest, (ctx, { at, toFull }) => {
      if (!Number.isFinite(at)) return skipped(`the threshold ${at} is not a number`);
      const clamped = Math.max(0, Math.min(1, at));
      const active = clamped > 0 && ctx.state.huntRest.active;
      if (!active) setResting(ctx, false);
      ctx.state.huntRest = { at: clamped, toFull, active };
      return OK;
    }),
    handle(keepLastFight, (ctx) => {
      const last = ctx.state.lastFight;
      if (!last) return skipped('no fight has ended yet');
      if (isKept(ctx.state, last)) return skipped('the fight is already kept');
      const evicted = keepFight(ctx.state, copy(last), now(ctx));
      ctx.emit(logLine, { msg: evicted ? TEXT.fight_evicted : TEXT.fight_kept, kind: 'info' });
      return OK;
    }),
    handle(dropKeptFight, (ctx, { id }) =>
      dropFight(ctx.state, id) ? OK : skipped(`no kept fight has the id ${id}`),
    ),
    handle(setRotation, (ctx, { order }) => {
      if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) return skipped('the order is not a list of ids');
      ctx.state.rotation = [...new Set(order)];
      return OK;
    }),
    handle(setTrigger, (ctx, { id, trigger }) => {
      if (typeof id !== 'string' || id === '') return skipped('the rotation id is empty');
      if (trigger === null) {
        if (!(id in ctx.state.triggers)) return skipped(`"${id}" has no trigger`);
        delete ctx.state.triggers[id];
        return OK;
      }
      if (typeof trigger !== 'object') return skipped('the trigger is not an object');
      ctx.state.triggers[id] = copy(trigger);
      return OK;
    }),
  ],

  requests: [
    answer(enableAction, (ctx, { id, enabled }) => {
      const trigger = (ctx.state.triggers[id] ??= { conditions: [] });
      trigger.enabled = enabled;
    }),
    answer(startForced, (ctx, { site }) => {
      const issue = siteIssue(site);
      if (issue) {
        ctx.skip(startForced.type, issue);
        return false;
      }
      return startForcedFight(ctx, copy(site));
    }),
    answer(startStaged, (ctx, { site, members }) => {
      const issue = siteIssue(site) ?? members.map((m) => (MONSTERS[m.monsterId] ? null : `unknown monster "${m.monsterId}"`)).find((i) => i);
      if (issue) return ctx.skip(startStaged.type, issue);
      if (members.length === 0) return ctx.skip(startStaged.type, 'a staged fight needs a member');
      startStagedGroup(ctx, copy(site), members);
    }),
    answer(setHunt, (ctx, { site }) => {
      const issue = siteIssue(site);
      if (issue) {
        ctx.skip(setHunt.type, issue);
        return false;
      }
      if (ctx.state.fight) {
        if (inForcedFight(ctx.state)) return false;
        if (ctx.state.site?.id !== site.id) abandonCombat(ctx);
      }
      ctx.state.site = copy(site);
      ctx.state.hunting = true;
      return true;
    }),
    answer(stopHuntLoop, (ctx) => {
      ctx.state.hunting = false;
      setResting(ctx, false);
    }),
    answer(abandon, (ctx) => {
      const had = ctx.state.fight !== null;
      abandonCombat(ctx);
      return had;
    }),
    answer(damageEnemy, (ctx, p) => {
      const e = enemyOf(ctx.state, p.entity);
      if (!e || e.hp <= 0) {
        ctx.skip(damageEnemy.type, `no living enemy has the entity id "${p.entity}"`);
        return null;
      }
      return strikeEnemy(ctx, e, p.strikes, p.source, p.penetration ?? 0, p.kind ?? 'strike');
    }),
    answer(stampAction, (ctx, p) => {
      const e = enemyOf(ctx.state, p.entity);
      if (!e) {
        ctx.skip(stampAction.type, `no enemy has the entity id "${p.entity}"`);
        return false;
      }
      stampMonsterAction(ctx, e, p.index, p.cooldown, p.name ? { name: p.name, icon: p.icon ?? '' } : undefined);
      return true;
    }),
    answer(healEnemy, (ctx, p) => {
      const e = enemyOf(ctx.state, p.entity);
      if (!e) return ctx.skip(healEnemy.type, `no enemy has the entity id "${p.entity}"`);
      healEnemyNow(ctx, e, p.amount, p.source, p.hostile ?? true, p.penetration ?? 0);
    }),
    answer(landSlices, (ctx, p) => {
      const e = enemyOf(ctx.state, p.entity);
      if (!e || e.hp <= 0) {
        ctx.skip(landSlices.type, `no living enemy has the entity id "${p.entity}"`);
        return null;
      }
      return landSlicesNow(ctx, e, p.slices, !!p.crit, p.kind ?? 'strike');
    }),
    answer(hurtEnemy, (ctx, p) => {
      const e = enemyOf(ctx.state, p.entity);
      if (!e) return ctx.skip(hurtEnemy.type, `no enemy has the entity id "${p.entity}"`);
      e.hp -= p.amount;
      e.lastHit = p.type;
      if (p.outgoing) noteOutgoing(ctx.state, now(ctx), p.amount);
    }),
    answer(addBuff, (ctx, p) => {
      if (!ctx.state.fight) return ctx.skip(addBuff.type, 'no fight is open');
      pushBuff(ctx, copy(p));
    }),
    answer(movePlayer, (ctx, { to }) => {
      if (!ctx.state.fight) return ctx.skip(movePlayer.type, 'no fight is open');
      setPlayerPosition(ctx, ctx.state.fight, to);
    }),
    answer(stampCooldown, (ctx, { id, ticks }) => {
      if (!ctx.state.fight) return ctx.skip(stampCooldown.type, 'no fight is open');
      ctx.state.fight.cooldowns[id] = ticks;
    }),
    answer(markEvent, (ctx, { event }) => {
      if (!ctx.state.fight) return ctx.skip(markEvent.type, 'no fight is open');
      markCombatEvent(ctx, event);
    }),
    answer(takePrevented, (ctx, { by }) => {
      const c = ctx.state.fight;
      const stopped = c?.prevented?.[by] ?? 0;
      if (c && stopped > 0) c.prevented = { ...c.prevented, [by]: undefined };
      return stopped;
    }),
    answer(retaliateAttack, (ctx) => (ctx.state.fight ? attackRetaliation(ctx) : false)),
  ],

  events: [
    // The ledger is closed after the lines of the handler that ended the
    // fight are in the transcript, and after its damage has been attributed.
    on(closeLedger, (ctx, { payload }) => {
      const still = visibleStatuses(heldOf(ctx.read(statuses))).map((h) => ({
        id: h.id,
        name: STATUSES[h.id]?.name ?? h.id,
        icon: STATUSES[h.id]?.icon ?? '☠️',
        intensity: h.intensity,
      }));
      const led = endFight(ctx.state, now(ctx), payload.outcome, still, payload.cause);
      if (!led) return ctx.skip(closeLedger.type, 'no ledger is open');
      const transcript = ctx.read(log).transcript;
      if (transcript) {
        led.transcript = transcriptForSave(transcript);
        ctx.emit(transcriptClose, undefined);
      }
    }),
    // Attribution at the one door: nothing that hurts the player does it
    // unnamed. `source: null` means the damage is already attributed.
    on(playerDamaged, (ctx, { payload }) => {
      if (payload.source === null) return;
      const src = payload.source ?? { key: 'unknown', label: 'Unknown', icon: '❔' };
      noteIncoming(ctx.state, now(ctx), { key: src.key, label: src.label, icon: src.icon }, payload.lost);
    }),
    on(conditionDamage, (ctx, { payload }) => {
      if (payload.entity !== PLAYER) return;
      for (const h of payload.hits) noteConditionDamage(ctx.state, now(ctx), h.id, h.amount);
      // The damage itself was applied before this event arrived.
      if (ctx.state.fight && !isAlive(ctx.read(resources))) fallToCondition(ctx);
    }),
    on(conditionDetonated, (ctx, { payload }) => {
      if (payload.entity === PLAYER && ctx.state.fight && !isAlive(ctx.read(resources))) fallToCondition(ctx);
    }),
    // A fatal condition ends the fight whatever health is left.
    on(conditionFatal, (ctx, { payload }) => {
      if (payload.entity === PLAYER && ctx.state.fight) fallToCondition(ctx);
    }),
    on(playerHealed, (ctx, { payload }) => {
      noteHealed(ctx.state, now(ctx), payload.kind, payload.healed);
      noteHealRefused(ctx.state, now(ctx), payload.asked - payload.allowed);
    }),
    on(setStyle, (ctx, { payload }) => {
      ctx.state.style = copy(payload);
    }),
  ],

  view: (ctx) => {
    const state = ctx.state;
    const fight = state.fight;
    const held = ctx.read(statuses);
    const player = statBlockOf(ctx);
    const tick = totalTicksOf(ctx.read(clock));
    return {
      inFight: fight !== null,
      forced: !!fight?.forced,
      hunting: state.hunting,
      resting: state.huntRest.active,
      respawnIn: !fight && state.hunting ? state.respawnTimer / 10 : 0,
      site: state.site ? { id: state.site.id, name: state.site.name } : null,
      playerBar: fight ? Math.max(0, Math.min(1, fight.playerBar / player.actionBar)) : 0,
      enemies: (fight?.enemies ?? [null, null, null, null, null]).map((e) => {
        if (!e) return null;
        const block = statBlockOf(ctx, e.entity);
        return {
          entity: e.entity,
          defId: e.defId,
          name: e.name,
          icon: e.icon,
          art: MONSTERS[e.defId]?.art ?? null,
          level: e.level,
          hp: Math.max(0, e.hp),
          maxHp: block.maxHp,
          bar: Math.max(0, Math.min(1, e.bar / 1000)),
          range: e.range,
          action: e.lastAction && tick - e.lastAction.at <= ACTION_SHOWN_TICKS ? { name: e.lastAction.name, icon: e.lastAction.icon } : null,
          conditions: visibleStatuses(heldOf(held, e.entity)).map((h) => STATUSES[h.id]?.icon ?? ''),
        };
      }),
      huntRest: { ...state.huntRest },
      lastFight: state.lastFight ? copy<FightLedger>(state.lastFight) : null,
      lastFightKept: isKept(state, state.lastFight),
      notebook: state.notebook.map((entry) => ({
        id: entry.id,
        keptAt: entry.keptAt,
        outcome: entry.ledger.outcome,
        foes: entry.ledger.foes.map((f) => (f.count > 1 ? `${f.name} x${f.count}` : f.name)).join(', '),
      })),
      rotation: [...state.rotation],
    };
  },
});

export default combat;

/** Whether a trigger holds now, for a handler of a registered kind. False with no fight open. */
export function triggerHolds(ctx: ActionCtx, trigger: DeepReadonly<SkillTrigger> | undefined): boolean {
  const state = ctx.read(combat);
  return state.fight ? evaluateTrigger({ ctx, fight: state.fight, state }, trigger) : false;
}

export { restTarget };
