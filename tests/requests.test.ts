import { describe, expect, it } from 'vitest';
import {
  answer,
  createKernel,
  defineCommand,
  defineEvent,
  defineRequest,
  defineSystem,
  handle,
  OK,
  on,
  type RequestDef,
} from '../src/kernel';

// A bank that answers a withdrawal with the amount it paid, and a shop that
// needs that amount inside the handler that asked.
const withdraw = defineRequest<{ amount: number }, number>('bank/withdraw');
const withdrew = defineEvent<{ paid: number }>('bank/withdrew');

const bank = defineSystem<{ gold: number; heard: number }>({
  id: 'bank',
  version: 1,
  initial: () => ({ gold: 10, heard: 0 }),
  requests: [
    answer(withdraw, (ctx, { amount }) => {
      const paid = Math.min(amount, ctx.state.gold);
      ctx.state.gold -= paid;
      ctx.emit(withdrew, { paid });
      return paid;
    }),
  ],
});

const buy = defineCommand<{ price: number }>('shop/buy');

const shop = defineSystem<{ bought: number; paidSeen: number[]; order: string[] }>({
  id: 'shop',
  version: 1,
  initial: () => ({ bought: 0, paidSeen: [], order: [] }),
  commands: [
    handle(buy, (ctx, { price }) => {
      const paid = ctx.request(withdraw, { amount: price });
      ctx.state.order.push(`answer:${paid}`);
      if (paid >= price) ctx.state.bought++;
      return OK;
    }),
  ],
  events: [
    on(withdrew, (ctx, event) => {
      ctx.state.order.push(`event:${event.payload.paid}`);
      ctx.state.paidSeen.push(event.payload.paid);
    }),
  ],
});

describe('requests', () => {
  it('returns the answer inside the handler that asked, and the answering system changes its own slice', () => {
    const kernel = createKernel({ systems: [bank, shop] });
    kernel.dispatch(buy({ price: 4 }));
    const slices = kernel.snapshot().slices as { bank: { gold: number }; shop: { bought: number } };
    expect(slices.bank.gold).toBe(6);
    expect(slices.shop.bought).toBe(1);
  });

  it('queues the events of an answer: they arrive after the asking handler returns', () => {
    const kernel = createKernel({ systems: [bank, shop] });
    kernel.dispatch(buy({ price: 4 }));
    const order = (kernel.snapshot().slices.shop as { order: string[] }).order;
    expect(order).toEqual(['answer:4', 'event:4']);
  });

  it('throws on a request no system answers', () => {
    const orphan: RequestDef<void, void> = defineRequest('nobody/ask');
    const ask = defineCommand('asker/ask');
    const asker = defineSystem<Record<string, never>>({
      id: 'asker',
      version: 1,
      initial: () => ({}),
      commands: [
        handle(ask, (ctx) => {
          ctx.request(orphan, undefined);
          return OK;
        }),
      ],
    });
    const kernel = createKernel({ systems: [asker] });
    expect(() => kernel.dispatch(ask())).toThrow(/no system answers/);
  });

  it('keeps request types inside the system namespace, one answer per type', () => {
    expect(() =>
      defineSystem({ id: 'thief', version: 1, initial: () => ({}), requests: [answer(withdraw, () => 0)] }),
    ).toThrow(/must start with "thief\/"/);
    // A copy of the declaration under another id answers the same type.
    expect(() => createKernel({ systems: [bank, { ...bank, id: 'bank2' }] })).toThrow(/answered twice/);
  });

  it('throws on requests that call each other without end', () => {
    const ping: RequestDef<void, void> = defineRequest('loop/ping');
    const start = defineCommand('loop/start');
    const loop = defineSystem<Record<string, never>>({
      id: 'loop',
      version: 1,
      initial: () => ({}),
      requests: [answer(ping, (ctx) => ctx.request(ping, undefined))],
      commands: [
        handle(start, (ctx) => {
          ctx.request(ping, undefined);
          return OK;
        }),
      ],
    });
    const kernel = createKernel({ systems: [loop] });
    expect(() => kernel.dispatch(start())).toThrow(/nested requests/);
    // The depth counter is restored: a later request still runs.
    expect(() => kernel.dispatch(start())).toThrow(/nested requests/);
  });
});
