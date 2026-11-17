/**
 * The drought ledger: misses on record per key, for drops and for combat
 * procs. Port of the old `engine/mercy.ts` and of `state.mercy`. The rules
 * are in `engine.ts`; this file owns the ledger. See README.md in this
 * folder.
 */
import { answer, defineRequest, defineSystem, type DeepReadonly } from '../../kernel';
import { MERCY, mercyChance, mercyMisses, mercyPick, procChance, type MercyLedger } from './engine';
import { migrations } from './migrations';

export * from './engine';

export interface MercyState {
  ledger: MercyLedger;
}

/** Roll an independent drop chance under mercy. */
export const rollMercyChance = defineRequest<{ key: string; rate: number; mercy?: number }, boolean>('mercy/chance');

/** Roll a combat proc under mercy. */
export const rollProcChance = defineRequest<{ key: string; rate: number }, boolean>('mercy/proc');

/**
 * Weighted pick under mercy. `keys[i]` is the ledger key of entry `i`, or
 * null for an entry that is not tracked. Answers the index picked. One draw.
 */
export const rollMercyPick = defineRequest<{ weights: number[]; keys: (string | null)[]; mercy?: number }, number>(
  'mercy/pick',
);

export function missesOf(state: DeepReadonly<MercyState>, key: string): number {
  return mercyMisses(state.ledger, key);
}

export default defineSystem<MercyState>({
  id: 'mercy',
  version: 1,
  migrations,
  initial: () => ({ ledger: {} }),

  requests: [
    answer(rollMercyChance, (ctx, { key, rate, mercy = MERCY }) => mercyChance(ctx.state.ledger, ctx.rng, key, rate, mercy)),
    answer(rollProcChance, (ctx, { key, rate }) => procChance(ctx.state.ledger, ctx.rng, key, rate)),
    answer(rollMercyPick, (ctx, { weights, keys, mercy = MERCY }) => {
      const entries = weights.map((weight, index) => ({ weight, index }));
      return mercyPick(ctx.state.ledger, ctx.rng, entries, (e) => keys[e.index], mercy).index;
    }),
  ],
});
