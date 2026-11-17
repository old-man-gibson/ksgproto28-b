/**
 * The trigger language: when an active may fire. Port of the old
 * `systems/triggers.ts` (`evaluateTrigger`, `conditionHolds`, the subjects).
 *
 * A trigger is baked into a technique (its reflex), carried by one way into
 * a technique, or set by the player on a rotation id (`CombatState.triggers`,
 * the old `state.skillTriggers`). All conditions must hold; an `event` also
 * gates it to the window after that event was stamped on the fight.
 *
 * A subject is a value a condition compares against. The subjects that read
 * what this system and its imports hold are here. A subject owned by another
 * system (what an enemy is casting) is registered by that system with
 * `registerTriggerSubject`, so this file imports no system that registers one.
 *
 * The picker of the old rotation screen (`options`, `visible`,
 * `describeCondition`) is not ported: it arrives with that screen.
 */
import type { DeepReadonly } from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import { kitOf } from '../monsters';
import resources, { availableMax, poolHooks, resourceValue, type ResourceId } from '../resources';
import { MONSTER_ACTION_BAR, statBlockOf } from '../stats';
import statuses, { heldOf } from '../statuses';
import type { ActionCtx } from './actions';
import { NEUTRAL_POSITION, type CombatState, type Enemy, type Fight } from './types';

export type TriggerOp = '>=' | '<=' | '>' | '<' | '==' | 'is' | 'isNot';

/** One test against a subject. Content writes `value` as a string; a number is compared as a number. */
export interface TriggerCondition {
  subject: string;
  op: TriggerOp;
  value: number | string;
}

export interface SkillTrigger {
  /** Default true. */
  enabled?: boolean;
  conditions?: TriggerCondition[];
  /** An event stamped on the fight (`Fight.events`). */
  event?: string;
  /** Ticks the event stays fresh. Default `EVENT_WINDOW`. */
  window?: number;
}

/** Events a trigger can gate on. Stamped by `markCombatEvent`. */
export const TRIGGER_EVENTS = ['onHit', 'onCrit', 'onParry', 'onDodge', 'onGraze', 'onEncounterStart', 'onEnemyCast'] as const;

/** Ticks an event stays fresh for an event-gated trigger. */
export const EVENT_WINDOW = 2;

/** What a subject reads from. */
export interface TriggerContext {
  ctx: ActionCtx;
  fight: DeepReadonly<Fight>;
  state: DeepReadonly<CombatState>;
}

export interface TriggerSubject {
  kind: 'number' | 'enum';
  read(t: TriggerContext): number | string;
}

const pctOf = (cur: number, max: number): number => (max > 0 ? (cur / max) * 100 : 0);
const front = (t: TriggerContext) => t.fight.enemies[0];
const mine = (t: TriggerContext) => heldOf(t.ctx.read(statuses));

const SUBJECTS = new Map<string, TriggerSubject>([
  ['player.status', { kind: 'enum', read: (t) => mine(t)[0]?.id ?? '' }],
  ['player.statusCount', { kind: 'number', read: (t) => mine(t).length }],
  [
    'enemy.status',
    {
      kind: 'enum',
      read: (t) => {
        const e = front(t);
        return e ? (heldOf(t.ctx.read(statuses), e.entity)[0]?.id ?? '') : '';
      },
    },
  ],
  [
    'enemy.statusCount',
    {
      kind: 'number',
      read: (t) => {
        const e = front(t);
        return e ? heldOf(t.ctx.read(statuses), e.entity).length : 0;
      },
    },
  ],
  [
    'enemy.hpPct',
    {
      kind: 'number',
      read: (t) => {
        const e = front(t);
        return e ? pctOf(e.hp, statBlockOf(t.ctx, e.entity).maxHp) : 0;
      },
    },
  ],
  ['enemy.level', { kind: 'number', read: (t) => front(t)?.level ?? 0 }],
  ['enemy.count', { kind: 'number', read: (t) => t.fight.enemies.filter((e) => e !== null).length }],
  ['combat.position', { kind: 'enum', read: (t) => t.fight.position ?? NEUTRAL_POSITION }],
  // The styles system is not ported: both subjects read the style id it last stated.
  ['style.active', { kind: 'enum', read: (t) => t.state.style.id }],
  ['style.selected', { kind: 'enum', read: (t) => t.state.style.id }],
  ['enemy.tier', { kind: 'enum', read: (t) => front(t)?.tier ?? '' }],
  ['enemy.rarity', { kind: 'enum', read: (t) => front(t)?.rarity ?? '' }],
  [
    'enemy.damageType',
    {
      kind: 'enum',
      read: (t) => {
        const e = front(t);
        return e ? kitOf(e as Enemy).damageType : '';
      },
    },
  ],
  ['enemy.range', { kind: 'enum', read: (t) => front(t)?.range ?? '' }],
  [
    'enemy.bar',
    {
      kind: 'number',
      read: (t) => {
        const e = front(t);
        return e ? pctOf(e.bar, MONSTER_ACTION_BAR) : 0;
      },
    },
  ],
]);

/** Register a subject owned by another system. Called at module load. */
export function registerTriggerSubject(id: string, subject: TriggerSubject): void {
  if (SUBJECTS.has(id) || familySubject(id)) throw new Error(`combat: trigger subject "${id}" is registered twice`);
  SUBJECTS.set(id, subject);
}

/**
 * Subjects generated from an id: `player.<pool>Pct` for a resource pool
 * (old `RESOURCE_SUBJECTS`) and `technique.<id>` for the clock of a
 * technique (old `TECHNIQUE_SUBJECTS`: `ready` or `cooling`).
 */
function familySubject(id: string): TriggerSubject | undefined {
  if (id.startsWith('technique.')) {
    const key = `technique:${id.slice('technique.'.length)}`;
    return { kind: 'enum', read: (t) => ((t.fight.cooldowns[key] ?? 0) > 0 ? 'cooling' : 'ready') };
  }
  const pool = /^player\.([a-z]+)Pct$/.exec(id)?.[1];
  if (pool) {
    return {
      kind: 'number',
      read: (t) => {
        const pools = t.ctx.read(resources);
        if (!(pool in pools.values)) return Number.NaN;
        const stats = statBlockOf(t.ctx);
        return pctOf(resourceValue(pools, pool as ResourceId), availableMax(stats, poolHooks(t.ctx), pool as ResourceId));
      },
    };
  }
  return undefined;
}

export function triggerSubject(id: string): TriggerSubject | undefined {
  return SUBJECTS.get(id) ?? familySubject(id);
}

function conditionHolds(t: TriggerContext, c: DeepReadonly<TriggerCondition>): boolean {
  const subject = triggerSubject(c.subject);
  // An unknown subject is ignored, not a reason to switch the whole active off.
  if (!subject) return true;
  const actual = subject.read(t);
  if (subject.kind === 'enum') {
    const want = String(c.value);
    return c.op === 'isNot' ? actual !== want : actual === want;
  }
  const a = Number(actual);
  const b = Number(c.value);
  if (!isFinite(a) || !isFinite(b)) return false;
  switch (c.op) {
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '==':
      return a === b;
    default:
      return false; // an enum operator against a number
  }
}

/** Whether an active may fire now. No trigger: always. The old `evaluateTrigger`. */
export function evaluateTrigger(t: TriggerContext, trigger: DeepReadonly<SkillTrigger> | undefined): boolean {
  if (!trigger) return true;
  if (trigger.enabled === false) return false;
  if (trigger.event) {
    const at = t.fight.events[trigger.event];
    if (at === undefined || totalTicksOf(t.ctx.read(clock)) - at > (trigger.window ?? EVENT_WINDOW)) return false;
  }
  for (const c of trigger.conditions ?? []) {
    if (!conditionHolds(t, c)) return false;
  }
  return true;
}
