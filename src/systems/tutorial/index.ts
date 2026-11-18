/**
 * Floor 0: the steps read off the world, the weapon rack, the skip, and the
 * gate that ends it. Port of the old `systems/tutorial.ts` and
 * `data/tutorial.data.ts`. See README.md in this folder.
 *
 * Nothing here gates anything. The floor's roads and fights work with every
 * step ignored. A step is done when the world says so (a counter, a spot
 * stood in), never when a button was pressed.
 */
import {
  defineCommand,
  defineSystem,
  handle,
  on,
  OK,
  registry,
  s,
  skipped,
  type Ctx,
  type DeepReadonly,
  type RecordOf,
} from '../../kernel';
import combat, { abandon } from '../combat';
import counters, { bumpCounter, counterValue, type CountersState } from '../counters';
import items, { equipNow, grantItem, ITEMS } from '../items';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import styles, { pickStyleNow, STYLES, type StyleDef } from '../styles';
import world, { arrived, placeNow, SPOTS, type WorldState } from '../world';
import rackData from './content/tutorial_rack.json';
import stepsData from './content/tutorial_steps.json';
import tutorialTextData from './content/tutorial_text.json';
import { migrations } from './migrations';

// ---- content ----

const steps = registry(
  s.object({
    id: s.id(),
    title: s.string(),
    spot: s.ref('spots', { help: 'Where the step is done.' }),
    choice: s.optional(s.enum(['weapon', 'stance', 'spell'])),
    desc: s.string(),
  }),
  stepsData,
  'Floor 0 steps',
);

const rack = registry(
  s.object({
    id: s.id(),
    item: s.optional(s.ref('items', { help: 'Absent: the pick grants nothing (unarmed).' })),
    hands: s.enum(['one', 'two', 'none']),
  }),
  rackData,
  'Floor 0 weapon rack',
);

const tutorialText = registry(textSchema, tutorialTextData, 'Floor 0 text');
const TEXT = Object.fromEntries((tutorialTextData as TextRecord[]).map((r) => [r.id, r.text]));

export type TutorialStepDef = RecordOf<typeof steps>;
export type RackPick = RecordOf<typeof rack>;

export const TUTORIAL_STEP_LIST = stepsData as TutorialStepDef[];
export const TUTORIAL_RACK: Record<string, RackPick> = Object.fromEntries((rackData as RackPick[]).map((r) => [r.id, r]));

/** The counter that ends the tutorial: 1 or more means done or skipped. */
export const TUTORIAL_DONE_KEY = 'flag:tutorial_done';

/** Per-choice latches; a choice is offered while its flag is 0. */
export const TUTORIAL_FLAGS = {
  weapon: 'flag:tutorial_weapon',
  stance: 'flag:tutorial_stance',
  spell: 'flag:tutorial_spell',
} as const;

/** Where the gate lets out: the city hub. The skip lands here too. */
export const TUTORIAL_EXIT = 'ascent_foot';

/** The shield that goes with a one-handed pick. */
export const TUTORIAL_SHIELD = 'wooden_shield';

/** The item a new character holds in the pack, and the one the skip leaves there. */
export const STARTING_WEAPON = 'rusty_sword';

/**
 * Choices whose control belongs to a system not ported yet: the spell
 * (arcane, step 3). The step reader passes over it; the skip stamps its flag
 * as the old skip did. The stance arrived with the martial port.
 */
export const WAITING_CHOICES: readonly string[] = ['spell'];

/**
 * The stances the card offers, in order: no modifiers, attack, defence. The
 * other six stay on the martial panel; picking one there sets the stance but
 * not the stamp. The old `TUTORIAL_STANCES`.
 */
export const TUTORIAL_STANCES = ['balanced', 'aggressive', 'defensive'] as const;

// ---- reads ----

interface Facts {
  counts: DeepReadonly<CountersState>;
  world: DeepReadonly<WorldState>;
}

const flag = (key: string) => (f: Facts) => counterValue(f.counts, key) >= 1;
const stood = (spot: string) => (f: Facts) => f.world.spot === spot || f.world.discovered.includes(spot);

/** When each step is done. The old `TUTORIAL_STEPS[*].done`. */
const DONE: Record<string, (f: Facts) => boolean> = {
  arm: flag(TUTORIAL_FLAGS.weapon),
  stance: flag(TUTORIAL_FLAGS.stance),
  cellblock: stood('f0_cellblock'),
  fight: (f) => counterValue(f.counts, 'slain:f0_cellblock:slime_cell') >= 1,
  field: stood('f0_field'),
  spell: flag(TUTORIAL_FLAGS.spell),
  cast: (f) => counterValue(f.counts, 'fights:f0_field') >= 1,
  gate: stood('f0_gate'),
  leave: stood(TUTORIAL_EXIT),
};

export function stepDone(f: Facts, step: TutorialStepDef): boolean {
  return DONE[step.id]?.(f) ?? false;
}

/** The steps a player is shown now: every step but those whose choice waits. */
export function shownSteps(): TutorialStepDef[] {
  return TUTORIAL_STEP_LIST.filter((s) => !s.choice || !WAITING_CHOICES.includes(s.choice));
}

/** On until `flag:tutorial_done` is 1 or more. */
export function tutorialActive(counts: DeepReadonly<CountersState>): boolean {
  return counterValue(counts, TUTORIAL_DONE_KEY) < 1;
}

/** The first shown step the world says is not done; null once all are, or once the tutorial is over. */
export function tutorialStep(f: Facts): TutorialStepDef | null {
  if (!tutorialActive(f.counts)) return null;
  return shownSteps().find((s) => !stepDone(f, s)) ?? null;
}

// ---- commands ----

/**
 * The rack: grant the pick, equip it, and the shield beside it when the pick
 * leaves a hand free. `unarmed` grants nothing and still counts. Refused once
 * made. The old `chooseTutorialWeapon`.
 */
export const chooseWeapon = defineCommand<{ weapon: string; shield?: boolean }>('tutorial/choose-weapon');

/**
 * Settle every choice not made the way the game used to open (the rusty
 * sword left in the pack, no stance, no spell), stamp every flag, and stand
 * the player at the Foot. A fight on the floor is abandoned first. The old
 * `skipTutorial`.
 */
export const skipTutorial = defineCommand<void>('tutorial/skip');

/**
 * Set the stance through the real control (`styles/set-now`), then stamp the
 * step. Refused once stamped. The old `chooseTutorialStance` and
 * `confirmTutorialStance`.
 */
export const chooseStance = defineCommand<{ style: string }>('tutorial/choose-stance');

/** A stance's modifiers as "Label: fact" text for the card, one per line. */
function modLines(def: StyleDef): string[] {
  return def.mods.map((m) => {
    const sign = m.value >= 0 ? '+' : '-';
    const size = Math.abs(m.value) * 100;
    return m.op === 'mult' ? `${m.stat}: ${sign}${+size.toFixed(1)}%` : `${m.stat}: ${sign}${+size.toFixed(1)} points`;
  });
}

type C = Ctx<TutorialState>;

function factsOf(ctx: { read: C['read'] }): Facts {
  return { counts: ctx.read(counters), world: ctx.read(world) };
}

function chosen(ctx: C, key: string): boolean {
  return counterValue(ctx.read(counters), key) >= 1;
}

function finish(ctx: C): void {
  ctx.emit(bumpCounter, { key: TUTORIAL_DONE_KEY });
  ctx.emit(logLine, { msg: TEXT.tutorial_done, kind: 'quest' });
}

// ---- view ----

export interface TutorialView {
  active: boolean;
  step: { id: string; title: string; desc: string; choice: string | null; index: number; of: number } | null;
  /** The rack, while its choice is open. */
  rack: { id: string; name: string; icon: string; hands: 'one' | 'two' | 'none' }[];
  /** The skip is offered on the first step only, as in the old build. */
  canSkip: boolean;
  /** The stance buttons, while the stance step is shown. */
  stances: { id: string; name: string; icon: string; lines: string[]; current: boolean }[];
}

export interface TutorialState {}

const system = defineSystem<TutorialState, TutorialView>({
  id: 'tutorial',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { tutorial_steps: steps, tutorial_rack: rack, tutorial_text: tutorialText },

  commands: [
    handle(chooseWeapon, (ctx, { weapon, shield = false }) => {
      if (chosen(ctx, TUTORIAL_FLAGS.weapon)) return skipped('the rack is empty: a weapon was already taken');
      const pick = TUTORIAL_RACK[weapon];
      if (!pick) return skipped(`the rack holds no "${weapon}"`);
      const granted: string[] = [];
      if (pick.item && ITEMS[pick.item]) {
        // The pack already holds a rusty sword: picking the sword equips that
        // one rather than minting a twin.
        const held = ctx.read(items).inventory.find((i) => i.defId === pick.item);
        const uid = held ? held.uid : ctx.request(grantItem, { defId: pick.item }).uid;
        ctx.request(equipNow, { uid });
        granted.push(`${ITEMS[pick.item].icon} ${ITEMS[pick.item].name}`);
      }
      if (shield && pick.hands === 'one' && ITEMS[TUTORIAL_SHIELD]) {
        const item = ctx.request(grantItem, { defId: TUTORIAL_SHIELD });
        ctx.request(equipNow, { uid: item.uid, slot: 'offhand' });
        granted.push(`${ITEMS[TUTORIAL_SHIELD].icon} ${ITEMS[TUTORIAL_SHIELD].name}`);
      }
      ctx.emit(bumpCounter, { key: TUTORIAL_FLAGS.weapon });
      ctx.emit(logLine, {
        msg: granted.length ? fillText(TEXT.tutorial_armed, { list: granted.join(', ') }) : TEXT.tutorial_unarmed,
        kind: 'quest',
      });
      return OK;
    }),

    handle(chooseStance, (ctx, { style }) => {
      if (chosen(ctx, TUTORIAL_FLAGS.stance)) return skipped('the stance step is done');
      // The old card set the style and stamped the step whatever the set did.
      const why = ctx.request(pickStyleNow, { style });
      if (why) ctx.skip(chooseStance.type, why);
      ctx.emit(bumpCounter, { key: TUTORIAL_FLAGS.stance });
      const def = STYLES[ctx.read(styles).style];
      ctx.emit(logLine, { msg: fillText(TEXT.tutorial_stance, { icon: def?.icon ?? '', name: def?.name ?? '' }), kind: 'quest' });
      return OK;
    }),

    handle(skipTutorial, (ctx) => {
      if (!tutorialActive(ctx.read(counters))) return skipped('the tutorial is over');
      if (ctx.read(combat).fight) ctx.request(abandon, undefined);
      if (!chosen(ctx, TUTORIAL_FLAGS.weapon)) {
        // The rusty sword is already in the pack; a save that lost it is handed one.
        const held = ctx.read(items);
        if (!held.inventory.some((i) => i.defId === STARTING_WEAPON) && !held.equipment.weapon) {
          ctx.request(grantItem, { defId: STARTING_WEAPON });
        }
        ctx.emit(bumpCounter, { key: TUTORIAL_FLAGS.weapon });
      }
      if (!chosen(ctx, TUTORIAL_FLAGS.stance)) ctx.emit(bumpCounter, { key: TUTORIAL_FLAGS.stance });
      if (!chosen(ctx, TUTORIAL_FLAGS.spell)) ctx.emit(bumpCounter, { key: TUTORIAL_FLAGS.spell });
      const dest = SPOTS[TUTORIAL_EXIT];
      // The arrival this sends ends the tutorial (the listener below).
      ctx.request(placeNow, { spot: TUTORIAL_EXIT });
      ctx.emit(logLine, { msg: fillText(TEXT.tutorial_skipped, { icon: dest.icon, name: dest.name }), kind: 'quest' });
      return OK;
    }),
  ],

  events: [
    // The gate stamps the end: the tutorial finishes the moment the player
    // stands at the Foot, however they got there.
    on(arrived, (ctx, { payload }) => {
      if (payload.spot !== TUTORIAL_EXIT || !tutorialActive(ctx.read(counters))) return;
      finish(ctx);
    }),
  ],

  view: (ctx) => {
    const f = factsOf(ctx);
    const active = tutorialActive(f.counts);
    const step = tutorialStep(f);
    const shown = shownSteps();
    const rackOpen = active && counterValue(f.counts, TUTORIAL_FLAGS.weapon) < 1;
    return {
      active,
      step: step
        ? {
            id: step.id,
            title: step.title,
            desc: step.desc,
            choice: step.choice ?? null,
            index: shown.indexOf(step) + 1,
            of: shown.length,
          }
        : null,
      rack: rackOpen
        ? Object.values(TUTORIAL_RACK).map((p) => ({
            id: p.id,
            name: p.item ? (ITEMS[p.item]?.name ?? p.item) : 'Nothing',
            icon: p.item ? (ITEMS[p.item]?.icon ?? '') : '👊',
            hands: p.hands,
          }))
        : [],
      canSkip: active && step !== null && step.id === shown[0].id,
      stances:
        step?.choice === 'stance'
          ? TUTORIAL_STANCES.map((id) => ({
              id,
              name: STYLES[id].name,
              icon: STYLES[id].icon,
              lines: modLines(STYLES[id]),
              current: ctx.read(styles).style === id,
            }))
          : [],
    };
  },
});

export default system;
