/**
 * The counter system. A toy with no game rules: it exists to use every part
 * of the system contract once. See README.md in this folder.
 */
import {
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  on,
  registry,
  s,
  skipped,
  TPS,
  type Modifier,
  type RecordOf,
} from '../../kernel';
import stepsData from './content/steps.json';
import { migrations } from './migrations';

// ---- slice ----

export interface CounterState {
  count: number;
  /** Step id to number owned. */
  owned: Record<string, number>;
  /** Milestone events handled. */
  milestones: number;
  /** Lucky ticks so far. */
  lucky: number;
}

// ---- content ----

const steps = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1, label: 'Name' }),
    cost: s.number({ min: 0, label: 'Cost', help: 'Price of the first one.' }),
    costGrowth: s.number({ min: 1, label: 'Cost growth', help: 'Price multiplier per one owned.' }),
    rateAdd: s.number({ min: 0, label: 'Rate added', help: 'Count per second, per one owned.' }),
    rateMult: s.optional(s.number({ min: 1, label: 'Rate multiplier', help: 'Applied once per one owned.' })),
    requires: s.optional(s.ref('steps', { label: 'Requires', help: 'A step that must be owned first.' })),
  }),
  stepsData,
  'Counter steps',
);

export type Step = RecordOf<typeof steps>;

// ---- commands, events, stats ----

export const buyStep = defineCommand<{ stepId: string }>('counter/buy');
export const milestoneReached = defineEvent<{ count: number }>('counter/milestone');

export const RATE = 'counter/rate';
const STEPS_SOURCE = 'counter/steps';

const MILESTONE_EVERY = 100;
const LUCKY_CHANCE = 0.01;
const LUCKY_FACTOR = 10;

export function stepCost(step: Step, owned: number): number {
  return Math.floor(step.cost * Math.pow(step.costGrowth, owned));
}

// ---- view ----

export interface CounterView {
  count: number;
  rate: number;
  milestones: number;
  lucky: number;
  steps: { id: string; name: string; owned: number; cost: number; blockedBy: string | null }[];
}

export default defineSystem<CounterState, CounterView>({
  id: 'counter',
  version: 2,
  initial: () => ({ count: 0, owned: {}, milestones: 0, lucky: 0 }),
  migrations,

  stats: { [RATE]: { base: 1 } },

  modifiers: [
    {
      id: STEPS_SOURCE,
      collect: ({ state, content }) => {
        const mods: Modifier[] = [];
        for (const step of content.all<Step>('steps')) {
          const owned = state.owned[step.id] ?? 0;
          if (owned === 0) continue;
          if (step.rateAdd !== 0) mods.push({ stat: RATE, kind: 'add', value: step.rateAdd * owned });
          if (step.rateMult !== undefined)
            mods.push({ stat: RATE, kind: 'mult', value: Math.pow(step.rateMult, owned) });
        }
        return mods;
      },
    },
  ],

  tick(ctx) {
    const state = ctx.state;
    let gain = ctx.derived(RATE) / TPS;
    if (ctx.rng.chance(LUCKY_CHANCE)) {
      gain *= LUCKY_FACTOR;
      state.lucky++;
    }
    const before = Math.floor(state.count / MILESTONE_EVERY);
    state.count += gain;
    const after = Math.floor(state.count / MILESTONE_EVERY);
    if (after > before) ctx.emit(milestoneReached, { count: after * MILESTONE_EVERY });
  },

  commands: [
    handle(buyStep, (ctx, { stepId }) => {
      const state = ctx.state;
      const step = ctx.content.get<Step>('steps', stepId);
      if (!step) return skipped(`no step with id "${String(stepId)}"`);
      if (step.requires !== undefined && (state.owned[step.requires] ?? 0) === 0) {
        const needed = ctx.content.get<Step>('steps', step.requires);
        return skipped(`${step.name} requires ${needed?.name ?? step.requires}`);
      }
      const cost = stepCost(step, state.owned[step.id] ?? 0);
      if (state.count < cost)
        return skipped(`${step.name} costs ${cost}; count is ${Math.floor(state.count)}`);
      state.count -= cost;
      state.owned[step.id] = (state.owned[step.id] ?? 0) + 1;
      ctx.touch(STEPS_SOURCE);
      return OK;
    }),
  ],

  events: [
    on(milestoneReached, (ctx) => {
      ctx.state.milestones++;
    }),
  ],

  content: { steps },

  view: ({ state, content, derived }) => ({
    count: state.count,
    rate: derived(RATE),
    milestones: state.milestones,
    lucky: state.lucky,
    steps: content.all<Step>('steps').map((step) => {
      const owned = state.owned[step.id] ?? 0;
      const blocked = step.requires !== undefined && (state.owned[step.requires] ?? 0) === 0;
      return {
        id: step.id,
        name: step.name,
        owned,
        cost: stepCost(step, owned),
        blockedBy: blocked ? (content.get<Step>('steps', step.requires!)?.name ?? step.requires!) : null,
      };
    }),
  }),
});
