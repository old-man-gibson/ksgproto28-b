/**
 * The fight ledger: what happened to the player, attributed. Port of the old
 * `systems/ledger.ts`. Functions on the combat slice; `now` is the clock
 * tick.
 *
 * Everything adds to a bucket. Nothing appends to a list that grows with
 * time. One rollup is committed when the fight ends.
 */
import type { DeepReadonly } from '../../kernel';
import { STATUSES } from '../statuses';
import type { CombatState, Enemy, FightLedger, FightOutcome, LedgerSource, NotebookEntry } from './types';

/** How many fights the notebook keeps. */
export const NOTEBOOK_MAX = 20;

/**
 * `ticks` holds the negated start tick while the ledger is open and becomes
 * the duration in `endFight`.
 */
function blank(state: CombatState, now: number): FightLedger {
  return {
    outcome: 'won',
    ticks: -now,
    endedAt: now,
    spot: state.site?.id ?? '',
    foes: [],
    incoming: [],
    stopped: { absorbed: 0, parried: 0, riposted: 0, dodged: 0, parries: 0, dodges: 0 },
    healed: {},
    healRefused: 0,
    outgoing: { damage: 0, hits: 0, kills: 0 },
    afflictions: [],
    transcript: [],
  };
}

/** Whether this fight is already kept. */
export function isKept(state: DeepReadonly<CombatState>, ledger: DeepReadonly<FightLedger> | null): boolean {
  return !!ledger && state.notebook.some((e) => e.id === ledger.endedAt);
}

/** Keep a fight. Returns what was evicted to make room, if anything. */
export function keepFight(state: CombatState, ledger: FightLedger, now: number): NotebookEntry | null {
  if (isKept(state, ledger)) return null;
  state.notebook.unshift({ id: ledger.endedAt, keptAt: now, ledger });
  if (state.notebook.length <= NOTEBOOK_MAX) return null;
  return state.notebook.pop() ?? null;
}

/** Forget a kept fight. False when no kept fight has the id. */
export function dropFight(state: CombatState, id: number): boolean {
  const at = state.notebook.findIndex((e) => e.id === id);
  if (at < 0) return false;
  state.notebook.splice(at, 1);
  return true;
}

/**
 * The ledger to write into, made on demand. Damage also happens outside a
 * fight: a bleed that ticks between fights lands here.
 */
export function ensureLedger(state: CombatState, now: number): FightLedger {
  if (!state.ledger) state.ledger = blank(state, now);
  return state.ledger;
}

/** Start a new tally for an encounter, with who turned up. */
export function beginFight(state: CombatState, foes: readonly (Enemy | null)[], now: number): void {
  const led = blank(state, now);
  for (const e of foes) {
    if (!e) continue;
    const seen = led.foes.find((f) => f.defId === e.defId);
    if (seen) {
      seen.count += 1;
      seen.level = Math.max(seen.level, e.level);
    } else {
      led.foes.push({ defId: e.defId, name: e.name, icon: e.icon, level: e.level, count: 1 });
    }
  }
  state.ledger = led;
}

function bump(list: LedgerSource[], src: Omit<LedgerSource, 'amount' | 'hits'>, amount: number): void {
  const seen = list.find((s) => s.key === src.key);
  if (seen) {
    seen.amount += amount;
    seen.hits += 1;
    return;
  }
  list.push({ key: src.key, label: src.label, icon: src.icon, amount, hits: 1 });
}

/** Damage that landed on the player, credited to what dealt it. */
export function noteIncoming(
  state: CombatState,
  now: number,
  src: { key: string; label: string; icon: string },
  amount: number,
): void {
  if (amount <= 0) return;
  bump(ensureLedger(state, now).incoming, src, amount);
}

/** A condition's damage, named from the registry. */
export function noteConditionDamage(state: CombatState, now: number, id: string, amount: number): void {
  const def = STATUSES[id];
  noteIncoming(state, now, { key: `cond:${id}`, label: def?.name ?? id, icon: def?.icon ?? '☠️' }, amount);
}

/** Damage that never reached the player, and how it was stopped. */
export function noteAbsorbed(state: CombatState, now: number, amount: number): void {
  if (amount > 0) ensureLedger(state, now).stopped.absorbed += amount;
}

export function noteParry(state: CombatState, now: number, turnedAside: number, riposted: number): void {
  const s = ensureLedger(state, now).stopped;
  s.parried += Math.max(0, turnedAside);
  s.riposted += Math.max(0, riposted);
  s.parries += 1;
}

export function noteDodge(state: CombatState, now: number, avoided: number): void {
  const s = ensureLedger(state, now).stopped;
  s.dodged += Math.max(0, avoided);
  s.dodges += 1;
}

/** Health that came back, by the kind of act that returned it. */
export function noteHealed(state: CombatState, now: number, kind: string, amount: number): void {
  if (amount <= 0) return;
  const led = ensureLedger(state, now);
  led.healed[kind] = (led.healed[kind] ?? 0) + amount;
}

/** Healing a condition refused to let land. */
export function noteHealRefused(state: CombatState, now: number, amount: number): void {
  if (amount > 0) ensureLedger(state, now).healRefused += amount;
}

/** What the player dealt. Kills are counted apart. */
export function noteOutgoing(state: CombatState, now: number, amount: number, kill = false): void {
  const out = ensureLedger(state, now).outgoing;
  if (amount > 0) {
    out.damage += amount;
    out.hits += 1;
  }
  if (kill) out.kills += 1;
}

/**
 * Close the books and hand the result to `lastFight`. Called on every
 * outcome. `afflictions` is what the player still holds, visible ones only;
 * the caller reads it after `combatEnd` has fired.
 */
export function endFight(
  state: CombatState,
  now: number,
  outcome: FightOutcome,
  afflictions: FightLedger['afflictions'],
  cause?: string,
): FightLedger | null {
  const led = state.ledger;
  if (!led) return null;
  led.outcome = outcome;
  if (cause) led.cause = cause;
  led.endedAt = now;
  led.ticks = Math.max(0, now + led.ticks);
  led.incoming.sort((a, b) => b.amount - a.amount);
  led.afflictions = afflictions;
  state.lastFight = led;
  state.ledger = null;
  return led;
}
