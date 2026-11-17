/**
 * The new run of the kernel (docs/KERNEL.md decision 30): `ctx.endRun()`
 * replaces every slice with `initial()` after the asking handler has drained,
 * and each system's `newRun` copies what it carries.
 */
import { describe, expect, it } from 'vitest';
import { createKernel, defineCommand, defineEvent, defineSystem, handle, OK, on, PLAYER } from '../src/kernel';

const end = defineCommand<void>('legacy/end');
const add = defineCommand<{ by: number }>('run/add');
const noted = defineEvent<{ value: number }>('run/noted');

interface LegacyState {
  ended: number;
  carried: number;
  heardInRun: number;
}

const legacy = defineSystem<LegacyState>({
  id: 'legacy',
  version: 1,
  initial: () => ({ ended: 0, carried: 0, heardInRun: 0 }),
  commands: [
    handle(end, (ctx) => {
      ctx.state.ended++;
      ctx.emit(noted, { value: 1 });
      ctx.endRun();
      return OK;
    }),
  ],
  events: [
    on(noted, (ctx) => {
      ctx.state.heardInRun++;
    }),
  ],
  newRun: (ctx, previous) => {
    const old = previous(legacy);
    ctx.state.ended = old.ended;
    ctx.state.carried = previous(run).value;
    ctx.emit(noted, { value: 2 });
  },
});

const run = defineSystem<{ value: number; ticks: number }>({
  id: 'run',
  version: 1,
  initial: () => ({ value: 0, ticks: 0 }),
  modifiers: [{ id: 'run/value', collect: ({ state }) => [{ stat: 'run/power', kind: 'add', value: state.value }] }],
  stats: { 'run/power': { base: 0 } },
  tick: (ctx) => {
    ctx.state.ticks++;
  },
  commands: [
    handle(add, (ctx, { by }) => {
      ctx.state.value += by;
      ctx.touch('run/value');
      return OK;
    }),
  ],
});

describe('a new run', () => {
  it('starts every slice new after the handler drained, and newRun copies what carries', () => {
    const k = createKernel({ systems: [legacy, run], seed: 5 });
    k.dispatch(add({ by: 7 }));
    k.tick(3);
    expect(k.derived('run/power')).toBe(7);
    const rngBefore = k.snapshot().kernel.rng;
    k.dispatch(end());
    const slices = k.snapshot().slices as { legacy: LegacyState; run: { value: number; ticks: number } };
    expect(slices.run).toEqual({ value: 0, ticks: 0 });
    expect(slices.legacy.ended).toBe(1);
    expect(slices.legacy.carried).toBe(7);
    // The event of the old run was heard before the reset; the one newRun sent after it.
    expect(slices.legacy.heardInRun).toBe(1);
    // Game time and the generator go on.
    expect(k.tickCount).toBe(3);
    expect(k.snapshot().kernel.rng).toBe(rngBefore);
    // Sources are touched: the stat follows the new slice.
    expect(k.derived('run/power')).toBe(0);
    expect(k.staleStats()).toEqual([]);
  });

  it('drops every entity but the player', () => {
    const k = createKernel({ systems: [legacy, run] });
    k.derived('run/power', 'monster:1');
    expect(k.entities()).toContain('monster:1');
    k.dispatch(end());
    expect(k.entities()).toEqual([PLAYER]);
  });

  it('a second end in a later command counts on', () => {
    const k = createKernel({ systems: [legacy, run] });
    k.dispatch(end());
    k.dispatch(end());
    expect((k.snapshot().slices as { legacy: LegacyState }).legacy.ended).toBe(2);
  });

  it('a load cancels nothing that was not asked: a save after a new run loads as it is', () => {
    const k = createKernel({ systems: [legacy, run] });
    k.dispatch(add({ by: 3 }));
    k.dispatch(end());
    const saved = k.save(0);
    const k2 = createKernel({ systems: [legacy, run] });
    expect(k2.load(saved).ok).toBe(true);
    expect(k2.snapshot()).toEqual(k.snapshot());
  });
});
