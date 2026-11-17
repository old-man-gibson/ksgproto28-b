/**
 * Counters: the named numbers that gates, quests, achievements and prestige
 * read. Port of the counter half of the old `systems/achievements.ts`
 * (`state.stats`, `bumpStat`, `raiseStat`, `setStat`) and of
 * `systems/conditions.ts`. See README.md in this folder.
 */
import { defineEvent, defineSystem, on, type DeepReadonly } from '../../kernel';
import { migrations } from './migrations';

export * from './conditions';

// ---- slice ----

export interface CountersState {
  /** Counter key to value. A key that was never written is absent and reads 0. */
  counts: Record<string, number>;
}

// ---- events ----

/** Request: add `amount` (default 1) to a counter. */
export const bumpCounter = defineEvent<{ key: string; amount?: number }>('counters/bump');
/** Request: raise a counter to `value` if it is lower. For level-style counters. */
export const raiseCounter = defineEvent<{ key: string; value: number }>('counters/raise');
/** Request: overwrite a counter. The reset path. */
export const setCounter = defineEvent<{ key: string; value: number }>('counters/set');
/** Request: remove a counter, so it reads 0 and is absent from the save. */
export const clearCounter = defineEvent<{ key: string }>('counters/clear');
/** A counter was written. `value` is the new value, 0 after a clear. */
export const counterChanged = defineEvent<{ key: string; value: number }>('counters/changed');

// ---- reads ----

export function counterValue(state: DeepReadonly<CountersState>, key: string): number {
  return state.counts[key] ?? 0;
}

/** The `flag:*` namespace: a counter that is 0 or 1. */
export function flagKey(name: string): string {
  return `flag:${name}`;
}

export function hasFlag(state: DeepReadonly<CountersState>, name: string): boolean {
  return counterValue(state, flagKey(name)) > 0;
}

export interface CountersView {
  counts: Record<string, number>;
}

// ---- the declaration ----

export default defineSystem<CountersState, CountersView>({
  id: 'counters',
  version: 1,
  migrations,
  initial: () => ({ counts: {} }),

  events: [
    on(bumpCounter, (ctx, event) => {
      const { key, amount = 1 } = event.payload;
      ctx.state.counts[key] = (ctx.state.counts[key] ?? 0) + amount;
      ctx.emit(counterChanged, { key, value: ctx.state.counts[key] });
    }),
    on(raiseCounter, (ctx, event) => {
      const { key, value } = event.payload;
      // Not a skip: a raise to a value already reached is the normal case.
      if ((ctx.state.counts[key] ?? 0) >= value) return;
      ctx.state.counts[key] = value;
      ctx.emit(counterChanged, { key, value });
    }),
    on(setCounter, (ctx, event) => {
      const { key, value } = event.payload;
      ctx.state.counts[key] = value;
      ctx.emit(counterChanged, { key, value });
    }),
    on(clearCounter, (ctx, event) => {
      const { key } = event.payload;
      if (!(key in ctx.state.counts)) return ctx.skip('counters/clear', `counter "${key}" is not set`);
      delete ctx.state.counts[key];
      ctx.emit(counterChanged, { key, value: 0 });
    }),
  ],

  view: ({ state }) => ({ counts: { ...state.counts } }),
});
