import { describe, expect, it } from 'vitest';
import { defineCommand, defineSystem, Derived, handle, OK } from '../src/kernel';
import { buyStep, RATE } from '../src/systems/counter';
import { makeKernel } from './helpers';

describe('derived values', () => {
  it('computes (base + add) * mult', () => {
    const derived = new Derived();
    derived.defineStat('a/x', 2);
    derived.register('a/one', () => [{ stat: 'a/x', kind: 'add', value: 3 }]);
    derived.register('a/two', () => [{ stat: 'a/x', kind: 'mult', value: 4 }]);
    expect(derived.get('a/x')).toBe(20);
  });

  it('serves from the cache until a source is touched', () => {
    const derived = new Derived();
    let bonus = 1;
    let collected = 0;
    derived.defineStat('a/x', 0);
    derived.register('a/src', () => {
      collected++;
      return [{ stat: 'a/x', kind: 'add', value: bonus }];
    });
    expect(derived.get('a/x')).toBe(1);
    expect(derived.get('a/x')).toBe(1);
    expect(collected).toBe(1);

    bonus = 5;
    expect(derived.get('a/x')).toBe(1); // not touched: the cache still answers
    expect(derived.findStale()).toEqual(['a/x']); // and the check finds it
    derived.touch('a/src');
    expect(derived.get('a/x')).toBe(5);
    expect(derived.findStale()).toEqual([]);
  });

  it('collects again only from the source that was touched', () => {
    const derived = new Derived();
    const calls = { one: 0, two: 0 };
    derived.defineStat('a/x', 0);
    derived.register('a/one', () => (calls.one++, [{ stat: 'a/x', kind: 'add', value: 1 }]));
    derived.register('a/two', () => (calls.two++, [{ stat: 'a/x', kind: 'add', value: 1 }]));
    derived.get('a/x');
    derived.touch('a/two');
    derived.get('a/x');
    expect(calls).toEqual({ one: 1, two: 2 });
  });

  it('builds the cache key from the registered sources', () => {
    const derived = new Derived();
    derived.defineStat('a/x', 0);
    derived.register('a/one', () => []);
    const before = derived.cacheKeyNow();
    derived.register('a/two', () => []);
    const after = derived.cacheKeyNow();
    expect(after).not.toBe(before);
    expect(after).toContain('a/two');
    derived.touch('a/two');
    expect(derived.cacheKeyNow()).not.toBe(after);
  });

  it('rejects unknown stats and unknown sources', () => {
    const derived = new Derived();
    derived.defineStat('a/x', 0);
    derived.register('a/bad', () => [{ stat: 'a/nope', kind: 'add', value: 1 }]);
    expect(() => derived.get('a/x')).toThrow(/unknown stat/);
    expect(() => derived.touch('a/missing')).toThrow(/unknown modifier source/);
  });

  it('a new source in a new system invalidates the cache with no other edit', () => {
    // A system the kernel has never seen. It declares one modifier source on
    // the counter's rate stat. Nothing else changes: no list of sources, no
    // fingerprint, no edit to the counter or the kernel.
    const setBoost = defineCommand<{ value: number }>('booster/set');
    const booster = defineSystem<{ boost: number }>({
      id: 'booster',
      version: 1,
      initial: () => ({ boost: 0 }),
      modifiers: [
        {
          id: 'booster/boost',
          collect: ({ state }) => [{ stat: RATE, kind: 'add', value: state.boost }],
        },
      ],
      commands: [
        handle(setBoost, (ctx, { value }) => {
          ctx.state.boost = value;
          ctx.touch('booster/boost');
          return OK;
        }),
      ],
    });

    const plain = makeKernel();
    const kernel = makeKernel([booster]);
    expect(kernel.derived(RATE)).toBe(plain.derived(RATE));

    kernel.dispatch(setBoost({ value: 7 }));
    expect(kernel.derived(RATE)).toBe(plain.derived(RATE) + 7);

    kernel.dispatch(setBoost({ value: 2 }));
    expect(kernel.derived(RATE)).toBe(plain.derived(RATE) + 2);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('the counter touches its source when a step is bought', () => {
    const kernel = makeKernel();
    expect(kernel.derived(RATE)).toBe(1);
    kernel.tick(200);
    expect(kernel.dispatch(buyStep({ stepId: 'small_step' })).ok).toBe(true);
    expect(kernel.derived(RATE)).toBe(2);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('loading a save invalidates every source', () => {
    const rich = makeKernel();
    rich.tick(200);
    rich.dispatch(buyStep({ stepId: 'small_step' }));
    const kernel = makeKernel();
    expect(kernel.derived(RATE)).toBe(1);
    kernel.load(rich.save(0));
    expect(kernel.derived(RATE)).toBe(2);
  });
});
