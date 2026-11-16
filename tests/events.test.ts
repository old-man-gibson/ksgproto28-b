import { describe, expect, it } from 'vitest';
import {
  createKernel,
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  on,
  skipped,
  type GameEvent,
} from '../src/kernel';
import { buyStep, milestoneReached } from '../src/systems/counter';
import { makeKernel } from './helpers';

describe('event bus', () => {
  it('delivers an event to a system that subscribes through its declaration', () => {
    // A second system hears the counter's event. The counter is not edited.
    const listener = defineSystem<{ heard: number[]; sources: string[] }>({
      id: 'listener',
      version: 1,
      initial: () => ({ heard: [], sources: [] }),
      events: [
        on(milestoneReached, (ctx, event) => {
          ctx.state.heard.push(event.payload.count);
          ctx.state.sources.push(event.source);
        }),
      ],
    });
    const kernel = makeKernel([listener]);
    kernel.tick(2500);
    const slice = kernel.snapshot().slices.listener as { heard: number[]; sources: string[] };
    expect(slice.heard.length).toBeGreaterThanOrEqual(2);
    expect(slice.heard[0]).toBe(100);
    expect(new Set(slice.sources)).toEqual(new Set(['counter']));
    // The counter handled its own event as well.
    expect((kernel.snapshot().slices.counter as { milestones: number }).milestones).toBe(slice.heard.length);
  });

  it('gives every event a type, a source, a tick and a payload', () => {
    const kernel = makeKernel();
    const seen: GameEvent[] = [];
    const remove = kernel.onEvent((event) => seen.push(event));
    kernel.tick(1200);
    expect(seen.length).toBeGreaterThan(0);
    for (const event of seen) {
      expect(event.type).toBe(milestoneReached.type);
      expect(event.source).toBe('counter');
      expect(Number.isInteger(event.tick)).toBe(true);
      expect(event.payload).toEqual({ count: expect.any(Number) });
    }
    const count = seen.length;
    remove();
    kernel.tick(1200);
    expect(seen.length).toBe(count);
  });

  it('delivers after the emitting handler returns, in emit order, with an explicit source', () => {
    const ping = defineEvent<{ n: number }>('chain/ping');
    const start = defineCommand('chain/start');
    const chain = defineSystem<{ log: string[] }>({
      id: 'chain',
      version: 1,
      initial: () => ({ log: [] }),
      commands: [
        handle(start, (ctx) => {
          ctx.emit(ping, { n: 1 }, 'chain/first');
          ctx.emit(ping, { n: 2 });
          ctx.state.log.push('command done');
          return OK;
        }),
      ],
      events: [
        on(ping, (ctx, event) => {
          ctx.state.log.push(`ping ${event.payload.n} from ${event.source}`);
          if (event.payload.n === 1) ctx.emit(ping, { n: 3 });
        }),
      ],
    });
    const kernel = createKernel({ systems: [chain] });
    kernel.dispatch(start());
    expect((kernel.snapshot().slices.chain as { log: string[] }).log).toEqual([
      'command done',
      'ping 1 from chain/first',
      'ping 2 from chain',
      'ping 3 from chain',
    ]);
  });

  it('stops an event loop with an error', () => {
    const loop = defineEvent('loop/again');
    const start = defineCommand('loop/start');
    const system = defineSystem<Record<string, never>>({
      id: 'loop',
      version: 1,
      initial: () => ({}),
      commands: [handle(start, (ctx) => (ctx.emit(loop, undefined), OK))],
      events: [on(loop, (ctx) => ctx.emit(loop, undefined))],
    });
    const kernel = createKernel({ systems: [system] });
    expect(() => kernel.dispatch(start())).toThrow(/events in one drain/);
  });
});

describe('skipped actions', () => {
  it('returns the reason and logs it', () => {
    const kernel = makeKernel();
    kernel.tick(3);
    const result = kernel.dispatch(buyStep({ stepId: 'small_step' }));
    expect(result).toEqual({ ok: false, reason: 'Small step costs 10; count is 0' });
    expect(kernel.skips()).toEqual([
      { tick: 3, source: 'counter', action: 'counter/buy', reason: 'Small step costs 10; count is 0' },
    ]);
    expect(kernel.view().skips).toEqual(kernel.skips());
  });

  it('gives a reason for each way the counter command can fail', () => {
    const kernel = makeKernel();
    const reasons = [
      kernel.dispatch(buyStep({ stepId: 'nope' })),
      kernel.dispatch(buyStep({ stepId: 'big_step' })),
      kernel.dispatch({ type: 'nobody/home', payload: null }),
    ].map((result) => (result.ok ? '' : result.reason));
    expect(reasons).toEqual([
      'no step with id "nope"',
      'Big step requires Small step',
      'unknown command "nobody/home"',
    ]);
    expect(kernel.skips().map((entry) => entry.source)).toEqual(['counter', 'counter', 'kernel']);
  });

  it('does not log a command that ran', () => {
    const kernel = makeKernel();
    kernel.tick(200);
    expect(kernel.dispatch(buyStep({ stepId: 'small_step' }))).toEqual({ ok: true });
    expect(kernel.skips()).toEqual([]);
  });

  it('logs a skip reported outside a command, and keeps only the newest entries', () => {
    const system = defineSystem<Record<string, never>>({
      id: 'idle',
      version: 1,
      initial: () => ({}),
      tick: (ctx) => ctx.skip('idle/work', `nothing to do at tick ${ctx.tick}`),
      commands: [handle(defineCommand('idle/never'), () => skipped('never'))],
    });
    const kernel = createKernel({ systems: [system], skipLogSize: 5 });
    kernel.tick(8);
    const skips = kernel.skips();
    expect(skips).toHaveLength(5);
    expect(skips[0]).toEqual({ tick: 3, source: 'idle', action: 'idle/work', reason: 'nothing to do at tick 3' });
    expect(skips[4].tick).toBe(7);
  });
});
