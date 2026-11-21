/**
 * Bonus time: banked idle time. Port of the bank half of the old
 * `systems/bonustime.ts`. See README.md in this folder.
 *
 * A tick in which the character does nothing (no activity, no journey, no
 * bench run, no fight, not knocked out) is banked, one tick per tick, up to
 * the offline catch-up cap. The old build handed the bank back as double
 * speed on the player's say-so; that control and the second advance it runs
 * are the UI step (docs/CONTENT.md decision Q4). Until then the bank only
 * fills.
 *
 * A prestige starts the bank at 0, except the automatic prestige of the
 * stronghold, which keeps it (`prestige` sends `bonus/bank` from its
 * `newRun`).
 */
import { defineEvent, defineSystem, on, TPS, type Ctx, type DeepReadonly, type SystemDef } from '../../kernel';
import benches from '../benches';
import combat from '../combat';
import world from '../world';
import { migrations } from './migrations';

/** The cap: the offline catch-up cap. A night away idle is worth a night of double speed, no more. */
export const BONUS_CAP_TICKS = 8 * 60 * 60 * TPS;

export interface BonusState {
  /** Ticks banked. */
  banked: number;
}

type B = Ctx<BonusState>;
type ReadCtx = { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/**
 * Doing nothing: no activity, no journey, no bench run, no fight, not knocked
 * out. Being knocked out is not idleness: it is the cost of the fight, and
 * banking it would pay the player for losing. The old list also named a
 * performance, which is not ported.
 */
export function isIdle(ctx: ReadCtx): boolean {
  const w = ctx.read(world);
  return !w.activity && !w.travel && !w.recovering && !ctx.read(benches).job && !ctx.read(combat).fight;
}

/**
 * Bank a stretch at once, up to the cap. The old `bankTicks`: time a held
 * world made the player wait, festival time away, the bank a stronghold
 * prestige keeps.
 */
export const bankTicks = defineEvent<{ ticks: number }>('bonus/bank');

function bank(ctx: B, ticks: number): void {
  ctx.state.banked = Math.min(BONUS_CAP_TICKS, ctx.state.banked + Math.max(0, ticks));
}

export interface BonusView {
  banked: number;
  cap: number;
}

const bonus = defineSystem<BonusState, BonusView>({
  id: 'bonus',
  version: 1,
  migrations,
  initial: () => ({ banked: 0 }),
  // Before the clock and everything that moves: idleness is judged before
  // anything moves, so the tick that starts or ends work is not banked (the
  // old `accrueBonusTime` at the top of `advance`). After `prestige`, whose
  // automatic prestige the old tick checked first.
  order: -150,

  tick: (ctx) => {
    if (ctx.state.banked < BONUS_CAP_TICKS && isIdle(ctx)) ctx.state.banked += 1;
  },

  events: [on(bankTicks, (ctx, { payload }) => bank(ctx, payload.ticks))],

  view: (ctx) => ({ banked: ctx.state.banked, cap: BONUS_CAP_TICKS }),
});

export default bonus;
