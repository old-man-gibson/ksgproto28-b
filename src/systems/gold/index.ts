/**
 * Gold: the one purse. Port of the old `state.gold` field and of the
 * `gold:earned` counter that the earning sites bumped beside it. See
 * README.md in this folder.
 */
import { answer, defineRequest, defineSystem, type DeepReadonly } from '../../kernel';
import { bumpCounter } from '../counters';
import { migrations } from './migrations';

export interface GoldState {
  gold: number;
}

/** The counter the gates and achievements read. */
export const GOLD_EARNED = 'gold:earned';

/**
 * Add gold. `earned` also adds the amount to the `gold:earned` counter: the
 * old build bumped it at a sale, a drop, a job and a quest, and not at a
 * prestige boon's starting gold. Returns the purse after the change.
 */
export const addGold = defineRequest<{ amount: number; earned: boolean }, number>('gold/add');

/**
 * Take gold. Returns false and takes nothing when the purse holds less than
 * `amount`.
 */
export const spendGold = defineRequest<{ amount: number }, boolean>('gold/spend');

export function goldOf(state: DeepReadonly<GoldState>): number {
  return state.gold;
}

export interface GoldView {
  gold: number;
}

export default defineSystem<GoldState, GoldView>({
  id: 'gold',
  version: 1,
  migrations,
  initial: () => ({ gold: 0 }),

  requests: [
    answer(addGold, (ctx, { amount, earned }) => {
      ctx.state.gold += amount;
      if (earned) ctx.emit(bumpCounter, { key: GOLD_EARNED, amount });
      return ctx.state.gold;
    }),
    answer(spendGold, (ctx, { amount }) => {
      if (ctx.state.gold < amount) return false;
      ctx.state.gold -= amount;
      return true;
    }),
  ],

  view: ({ state }) => ({ gold: state.gold }),
});
