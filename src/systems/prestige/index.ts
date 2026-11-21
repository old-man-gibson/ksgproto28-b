/**
 * Prestige: the harvest re-climb. Port of the old `systems/prestige.ts`,
 * `systems/legacy.ts` and `data/prestige.data.ts`. See README.md in this
 * folder.
 *
 * A run ends by choice once the warchief of floor 6 is dead
 * (`PRESTIGE_UNLOCK`). The harvest measures how far the run went, pays whole
 * points, and the next run starts new with only this slice carried over: the
 * legacy block. Points buy boons that are applied at the start of every run.
 *
 * Two rules from the old build:
 * - The preview is the harvest: `harvest` is the one function; the panel
 *   shows its output and `prestige/now` banks the same output.
 * - The review after a prestige is save state (`review`). It survives a
 *   reload and closes only through `prestige/leave-review`.
 */
import {
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  PLAYER,
  registry,
  s,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type RecordOf,
  type SystemDef,
} from '../../kernel';
import achievements, { totalTiers } from '../achievements';
import attributes from '../attributes';
import bonus, { bankTicks } from '../bonus';
import counters, { conditionsMet, counterValue, setCounter, type Condition, type ConditionReader, type CountersState } from '../counters';
import { addGold } from '../gold';
import { clearLapsed, clearMet, floorSeenKey, floorsReachedThisRun, ladderFloors, registerBandPass, TOWERS } from '../ladder';
import { raiseStartingLevel } from '../levels';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import skills, { conditionReader } from '../skills';
import { ATTRIBUTE_IDS, endowmentFact, namedFact, scaleFact, type AttributeId, type StatMod } from '../stats';
import { placeNow } from '../world';
import boonsData from './content/prestige_boons.json';
import sourcesData from './content/prestige_sources.json';
import prestigeTextData from './content/prestige_text.json';
import { migrations } from './migrations';

// ---- content ----

const sources = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    measure: s.enum(['stat', 'floors', 'skillLevels', 'achievements']),
    key: s.optional(s.string({ help: 'The counter a "stat" source reads.' })),
    per: s.number({ min: 1, help: 'Amount per point; with growth, the first threshold.' }),
    growth: s.optional(s.number({ min: 1, help: 'Each point this many times further than the last.' })),
    unit: s.string(),
  }),
  sourcesData,
  'Prestige sources',
);

const boons = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    cost: s.array(s.number({ integer: true, min: 0 }), { help: 'Cost of each rank, in order.' }),
    effect: s.object({
      kind: s.enum([
        'talent',
        'endowment',
        'startGold',
        'preparedPages',
        'techniqueSlots',
        'skillCap',
        'foresight',
        'wayfinding',
        'startLevel',
        'key',
        'bandPass',
        'cookbook',
      ]),
      rate: s.optional(s.number()),
      amount: s.optional(s.number()),
      pages: s.optional(s.number()),
      slots: s.optional(s.number()),
      skill: s.optional(s.ref('skills')),
      by: s.optional(s.number()),
      levels: s.optional(s.number()),
      bandId: s.optional(s.ref('bands')),
    }),
    auto: s.optional(s.boolean({ help: 'Rank 1 arrives free with the first prestige.' })),
    desc: s.string(),
  }),
  boonsData,
  'Prestige boons',
);

const prestigeText = registry(textSchema, prestigeTextData, 'Prestige text');
const TEXT = Object.fromEntries((prestigeTextData as TextRecord[]).map((r) => [r.id, r.text]));

export type PrestigeSourceDef = RecordOf<typeof sources>;
export type PrestigeBoonDef = RecordOf<typeof boons>;

export const PRESTIGE_SOURCE_LIST = sourcesData as PrestigeSourceDef[];
export const PRESTIGE_BOON_LIST = boonsData as PrestigeBoonDef[];
export const PRESTIGE_BOONS: Record<string, PrestigeBoonDef> = Object.fromEntries(PRESTIGE_BOON_LIST.map((b) => [b.id, b]));

/**
 * The button lights when this holds: the warchief at the bottom of band 2
 * (old `prestige.data.ts:25`). The same counter the floor 6 clear reads.
 */
export const PRESTIGE_UNLOCK: Condition[] = [{ type: 'stat', key: 'slain:f6_great_hall:goblin_warchief', value: 1 }];

/**
 * The stronghold on floor 11 (old `prestige.data.ts` 29-41). The wave is held
 * when every fight on the wall is won. That ends the run on the next tick, an
 * automatic prestige, and the legacy records the stronghold for good: every
 * later run starts with `STRONGHOLD_KEY` at 1, which opens the hold's door on
 * floor 11 and shuts the siege.
 */
export const STRONGHOLD_WAVE = 8;
export const STRONGHOLD_WALL_KEY = 'fights:f11_wall';
export const STRONGHOLD_HELD: Condition[] = [{ type: 'stat', key: STRONGHOLD_WALL_KEY, value: STRONGHOLD_WAVE }];
export const STRONGHOLD_KEY = 'legacy:stronghold';

/** Where every run after a prestige starts. */
export const RUN_START_SPOT = 'ascent_foot';
/** The counter the content gates read. */
export const PRESTIGE_COUNT_KEY = 'prestige:count';
/** Opened alpha shutters stay open (old `LOCKABLE_SUBSYSTEMS`, `unlockKey`). */
export const UNLOCK_PREFIX = 'flag:unlock_';
/** A second life skips the cell. The tutorial's counter, written here as the old `prestigeNow` did. */
export const TUTORIAL_DONE_KEY = 'flag:tutorial_done';

// ---- slice ----

export interface HarvestLine {
  id: string;
  name: string;
  icon: string;
  points: number;
  detail: string;
}

export interface HarvestReport {
  /** Which prestige this is, 1 for the first. */
  ordinal: number;
  total: number;
  lines: HarvestLine[];
}

export interface PrestigeState {
  /** Prestiges completed. Mirrored to the counter `prestige:count`. */
  count: number;
  points: number;
  /** Boon id to rank bought. */
  purchases: Record<string, number>;
  /** Highest level of each skill at any prestige. Never lowers. */
  peakLevels: Record<string, number>;
  /** Highest trained level of each attribute at any prestige. Never lowers. */
  peakAttrs: Record<string, number>;
  /** Ladder floors reached in any run that ended in a prestige. Never shortened. */
  floorsSeen: string[];
  /** The stronghold of floor 11 was held on some run. Never unset. */
  stronghold: boolean;
  lastHarvest: HarvestReport | null;
  /** The review after a prestige is owed. */
  review: boolean;
  /** Points spent since the review opened. */
  spentThisReview: number;
}

type State = DeepReadonly<PrestigeState>;
type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- reads (old `legacy.ts`) ----

export function boonRank(state: State, boonId: string): number {
  return state.purchases[boonId] ?? 0;
}

export function boughtBoons(state: State): { def: PrestigeBoonDef; rank: number }[] {
  return PRESTIGE_BOON_LIST.map((def) => ({ def, rank: boonRank(state, def.id) })).filter((b) => b.rank > 0);
}

/** Character level a run starts at: 1 plus Head Start's levels per rank. */
export function startingLevel(state: State): number {
  let level = 1;
  for (const { def, rank } of boughtBoons(state)) {
    if (def.effect.kind === 'startLevel') level += (def.effect.levels ?? 0) * rank;
  }
  return level;
}

export function hasForesight(state: State): boolean {
  return boughtBoons(state).some(({ def }) => def.effect.kind === 'foresight');
}

/** Whether go links reach every place (the Wayfinding boon). */
export function hasWayfinding(state: State): boolean {
  return boughtBoons(state).some(({ def }) => def.effect.kind === 'wayfinding');
}

/** Cap levels a skill's ceiling gains from prestige. */
export function legacyCapRaise(state: State, skillId: string): number {
  let by = 0;
  for (const { def, rank } of boughtBoons(state)) {
    if (def.effect.kind === 'skillCap' && def.effect.skill === skillId) by += (def.effect.by ?? 0) * rank;
  }
  return by;
}

/**
 * Talent's multiplier on one skill's effects, as a fraction: rate x rank x the
 * skill's peak level x prestiges. Zero before the first prestige.
 */
export function talentBonus(state: State, skillId: string): number {
  const peak = state.peakLevels[skillId] ?? 0;
  if (peak <= 0 || state.count <= 0) return 0;
  let bonus = 0;
  for (const { def, rank } of boughtBoons(state)) {
    if (def.effect.kind === 'talent') bonus += (def.effect.rate ?? 0) * rank * peak * state.count;
  }
  return bonus;
}

/** Endowment's multiplier on one attribute's effective value, as a fraction. Talent's twin. */
export function endowmentBonus(state: State, attr: string): number {
  const peak = state.peakAttrs[attr] ?? 0;
  if (peak <= 0 || state.count <= 0) return 0;
  let bonus = 0;
  for (const { def, rank } of boughtBoons(state)) {
    if (def.effect.kind === 'endowment') bonus += (def.effect.rate ?? 0) * rank * peak * state.count;
  }
  return bonus;
}

/** Prepared-spell pages and technique slots the legacy adds. Read when the book and the bench are ported (step 3). */
export function legacyPreparedPages(state: State): number {
  let pages = 0;
  for (const { def, rank } of boughtBoons(state)) if (def.effect.kind === 'preparedPages') pages += (def.effect.pages ?? 0) * rank;
  return pages;
}

export function legacyTechniqueSlots(state: State): number {
  let slots = 0;
  for (const { def, rank } of boughtBoons(state)) if (def.effect.kind === 'techniqueSlots') slots += (def.effect.slots ?? 0) * rank;
  return slots;
}

/** The modifier source of the legacy. */
export const LEGACY_SOURCE = 'prestige/legacy';

function legacyMods(state: State): StatMod[] {
  const out: StatMod[] = [];
  for (const { def, rank } of boughtBoons(state)) out.push(namedFact(`boon:${def.id}`, rank));
  if (hasForesight(state)) out.push(namedFact('foresight', 1));
  for (const id of Object.keys(state.peakLevels)) {
    const t = talentBonus(state, id);
    if (t > 0) out.push(scaleFact(`talent:${id}`, t));
  }
  for (const attr of ATTRIBUTE_IDS) {
    const e = endowmentBonus(state, attr);
    if (e > 0) out.push(endowmentFact(attr as AttributeId, e));
  }
  const capped = new Set(PRESTIGE_BOON_LIST.filter((b) => b.effect.kind === 'skillCap').map((b) => b.effect.skill!));
  for (const id of capped) {
    const by = legacyCapRaise(state, id);
    if (by > 0) out.push(namedFact(`skillCap:${id}`, by));
  }
  return out;
}

// The ladder asks whether a band is passed; the answer is a boon. Read
// through the boon facts above, so the condition reader is enough.
registerBandPass((r: ConditionReader, bandId: string) =>
  PRESTIGE_BOON_LIST.some((b) => b.effect.kind === 'bandPass' && b.effect.bandId === bandId && r.boonRank(b.id) > 0),
);

// ---- the harvest (old `prestige.ts`) ----

export function canPrestige(r: ConditionReader): boolean {
  return conditionsMet(r, PRESTIGE_UNLOCK) || strongholdHeld(r);
}

/**
 * The stronghold's wave was held on this run, and no earlier run did it. It
 * opens prestige on its own, so a run that passed band 2 without the
 * warchief still ends here. The old build read the legacy flag; the run's
 * `STRONGHOLD_KEY` counter is that flag, set at the start of every run after.
 */
export function strongholdHeld(r: ConditionReader): boolean {
  return r.counter(STRONGHOLD_KEY) < 1 && conditionsMet(r, STRONGHOLD_HELD);
}

/**
 * The run ends without asking: the prestige tick ends it on the tick after
 * the wave is held. During offline catch-up the remaining ticks run in the
 * new run, idle at the Foot, where they bank as bonus time.
 */
export function autoPrestigeDue(r: ConditionReader): boolean {
  return strongholdHeld(r);
}

/** The tab shows once the run could prestige, or once any run has. */
export function prestigeVisible(state: State, r: ConditionReader): boolean {
  return state.count > 0 || canPrestige(r);
}

/** The raw measure behind one source, before `per` divides it. */
export function sourceAmount(ctx: ReadCtx, src: PrestigeSourceDef): number {
  switch (src.measure) {
    case 'stat':
      return Math.floor(counterValue(ctx.read(counters), src.key ?? ''));
    case 'floors': {
      // The floor's own clear, not a pass: a passed band pays nothing, and a
      // floor cleared by a lapsed ward window pays nothing (old Q24).
      const r = conditionReader(ctx);
      return Object.keys(TOWERS).reduce(
        (n, towerId) => n + ladderFloors(towerId).filter((f) => clearMet(r, f) && !clearLapsed(r, f)).length,
        0,
      );
    }
    case 'skillLevels':
      return Object.values(ctx.read(skills).skills).reduce((n, sk) => n + sk.level, 0);
    case 'achievements':
      return totalTiers(ctx.read(achievements));
  }
}

/** "1 entry", "2 entries", "3 quests", "40 gold". */
export function unitText(n: number, unit: string): string {
  if (unit === 'gold' || n === 1) return `${n} ${unit}`;
  return `${n} ${unit.endsWith('y') ? `${unit.slice(0, -1)}ies` : `${unit}s`}`;
}

/** Whole points an amount pays: linear, or with `growth` the thresholds reached. */
export function pointsFor(amount: number, src: Pick<PrestigeSourceDef, 'per' | 'growth'>): number {
  if (!src.growth) return Math.floor(amount / src.per);
  let points = 0;
  for (let threshold = src.per; amount >= threshold; threshold *= src.growth) points += 1;
  return points;
}

/** The amount at which the next point is paid. */
export function nextThreshold(amount: number, src: Pick<PrestigeSourceDef, 'per' | 'growth'>): number {
  if (!src.growth) return (Math.floor(amount / src.per) + 1) * src.per;
  return src.per * src.growth ** pointsFor(amount, src);
}

function rateText(amount: number, src: PrestigeSourceDef): string {
  return src.growth ? `next at ${nextThreshold(amount, src)}` : `${src.per} per point`;
}

/** What a prestige would pay now, and what it does pay when it happens. */
export function harvest(ctx: ReadCtx, state: State): HarvestReport {
  const lines: HarvestLine[] = PRESTIGE_SOURCE_LIST.map((src) => {
    const amount = sourceAmount(ctx, src);
    return {
      id: src.id,
      name: src.name,
      icon: src.icon,
      points: pointsFor(amount, src),
      detail: `${unitText(amount, src.unit)} (${rateText(amount, src)})`,
    };
  });
  return { ordinal: state.count + 1, total: lines.reduce((n, l) => n + l.points, 0), lines };
}

/** How far each source is from its next point. */
export function forecast(ctx: ReadCtx): { id: string; name: string; icon: string; need: number; unit: string }[] {
  return PRESTIGE_SOURCE_LIST.map((src) => {
    const amount = sourceAmount(ctx, src);
    return { id: src.id, name: src.name, icon: src.icon, need: nextThreshold(amount, src) - amount, unit: src.unit };
  });
}

/** Cost of the next rank of a boon, or null at max rank. */
export function nextBoonCost(state: State, boonId: string): number | null {
  const def = PRESTIGE_BOONS[boonId];
  if (!def) return null;
  const rank = boonRank(state, boonId);
  return rank < def.cost.length ? def.cost[rank] : null;
}

export function canBuyBoon(state: State, boonId: string): boolean {
  const cost = nextBoonCost(state, boonId);
  return cost !== null && state.points >= cost;
}

// ---- events and commands ----

/** A prestige happened; the new run has started. */
export const prestiged = defineEvent<{ count: number; points: number }>('prestige/prestiged');

/** End the run and start the next with the legacy grown by this harvest. The old `prestigeNow`. */
export const prestigeNow = defineCommand<void>('prestige/now');
/** Spend points on the next rank of a boon. The old `buyBoon`. */
export const buyBoon = defineCommand<{ boon: string }>('prestige/buy-boon');
/** Close the review after a prestige. The old `leaveReview`. */
export const leaveReview = defineCommand<void>('prestige/leave-review');
/**
 * DEBUG, not a player action (docs/CONTENT.md decision Q5): write the wall's
 * fight count to the wave, as the old John's siege skip wrote
 * `fights:f11_wall`. The next tick holds the stronghold. Used by the John
 * driver past a wall only. Refused in a production build.
 */
export const debugHoldWall = defineCommand<void>('prestige/debug-hold-wall');

/** A production build of the page: the debug skip is refused. Tests, scripts and the dev server run it. */
const PRODUCTION = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;

/** Per-run grants for every rank bought: starting gold and starting level. The old `applyRunStart`. */
function applyRunStart(ctx: Ctx<PrestigeState>): void {
  for (const { def, rank } of boughtBoons(ctx.state)) {
    if (def.effect.kind === 'startGold') ctx.request(addGold, { amount: (def.effect.amount ?? 0) * rank, earned: false });
  }
  const level = startingLevel(ctx.state);
  if (level > 1) ctx.emit(raiseStartingLevel, { level });
}

/**
 * Bank the harvest into the legacy and end the run: the old `prestigeNow`.
 * Called by the command and, for the stronghold, by the tick.
 */
function endTheRun(ctx: Ctx<PrestigeState>): void {
  const r = conditionReader(ctx);
  const report = harvest(ctx, ctx.state);
  const state = ctx.state;
  // Peaks never lower.
  for (const [id, sk] of Object.entries(ctx.read(skills).skills)) {
    state.peakLevels[id] = Math.max(state.peakLevels[id] ?? 0, sk.level);
  }
  for (const [id, a] of Object.entries(ctx.read(attributes).attrs)) {
    state.peakAttrs[id] = Math.max(state.peakAttrs[id] ?? 0, a.level);
  }
  // Floors reached stay named on the ladder in every later run.
  state.floorsSeen = [...new Set([...state.floorsSeen, ...floorsReachedThisRun(r)])];
  // Auto boons: rank 1 arrives with the first prestige, unasked and free.
  for (const def of PRESTIGE_BOON_LIST) {
    if (def.auto && !(state.purchases[def.id] > 0) && def.cost[0] === 0) state.purchases[def.id] = 1;
  }
  // One base, unlocked for good.
  state.stronghold = state.stronghold || strongholdHeld(r);
  state.count += 1;
  state.points += report.total;
  state.lastHarvest = report;
  state.review = true;
  state.spentThisReview = 0;
  ctx.endRun();
}

/** The run that `previous` reads held the stronghold: the old `strongholdHeld` on the state before the prestige. */
function heldBefore(previousCounters: DeepReadonly<CountersState>): boolean {
  return (
    counterValue(previousCounters, STRONGHOLD_KEY) < 1 && counterValue(previousCounters, STRONGHOLD_WALL_KEY) >= STRONGHOLD_WAVE
  );
}

// ---- view ----

export interface BoonView {
  id: string;
  name: string;
  icon: string;
  desc: string;
  rank: number;
  maxRank: number;
  /** Null at max rank. */
  nextCost: number | null;
  canBuy: boolean;
}

export interface PrestigeView {
  visible: boolean;
  canPrestige: boolean;
  count: number;
  points: number;
  harvest: HarvestReport;
  forecast: { id: string; name: string; icon: string; need: number; unit: string }[];
  boons: BoonView[];
  review: boolean;
  spentThisReview: number;
  lastHarvest: HarvestReport | null;
  wayfinding: boolean;
}

// ---- the declaration ----

const system: SystemDef<PrestigeState, PrestigeView> = defineSystem<PrestigeState, PrestigeView>({
  id: 'prestige',
  version: 2,
  migrations,
  initial: () => ({
    count: 0,
    points: 0,
    purchases: {},
    peakLevels: {},
    peakAttrs: {},
    floorsSeen: [],
    stronghold: false,
    lastHarvest: null,
    review: false,
    spentThisReview: 0,
  }),
  content: { prestige_sources: sources, prestige_boons: boons, prestige_text: prestigeText },
  // First in the tick: the old `Game.tick` checked the automatic prestige
  // before it advanced anything.
  order: -200,

  // The stronghold's wave was held: the run ends here, unasked. The old check
  // read the conditions every tick; the two counters are read first, so a run
  // that never stands on the wall pays two lookups.
  tick: (ctx) => {
    const counts = ctx.read(counters);
    if (counterValue(counts, STRONGHOLD_WALL_KEY) < STRONGHOLD_WAVE || counterValue(counts, STRONGHOLD_KEY) >= 1) return;
    if (autoPrestigeDue(conditionReader(ctx))) endTheRun(ctx);
  },

  modifiers: [
    {
      id: LEGACY_SOURCE,
      collect: ({ state, entity }) => (entity === PLAYER ? legacyMods(state) : []),
    },
  ],

  commands: [
    handle(prestigeNow, (ctx) => {
      if (!canPrestige(conditionReader(ctx)))
        return skipped('prestige opens when the warchief of floor 6 is dead or the stronghold of floor 11 is held');
      endTheRun(ctx);
      return OK;
    }),

    handle(buyBoon, (ctx, { boon }) => {
      const def = PRESTIGE_BOONS[boon];
      if (!def) return skipped(`no boon "${boon}"`);
      const cost = nextBoonCost(ctx.state, boon);
      if (cost === null) return skipped(`${def.name} is at its highest rank`);
      if (ctx.state.points < cost) return skipped(`${def.name} costs ${cost} points; ${ctx.state.points} held`);
      ctx.state.points -= cost;
      ctx.state.purchases[boon] = boonRank(ctx.state, boon) + 1;
      if (ctx.state.review) ctx.state.spentThisReview += cost;
      ctx.touch(LEGACY_SOURCE);
      // Grants that pay per run pay now too, so a purchase is felt in the run in progress.
      if (def.effect.kind === 'startGold') ctx.request(addGold, { amount: def.effect.amount ?? 0, earned: false });
      if (def.effect.kind === 'startLevel') ctx.emit(raiseStartingLevel, { level: startingLevel(ctx.state) });
      ctx.emit(logLine, {
        msg: fillText(TEXT.prestige_boon_bought, {
          icon: def.icon,
          name: def.name,
          rank: boonRank(ctx.state, boon),
          cost,
          plural: cost === 1 ? '' : 's',
        }),
        kind: 'info',
      });
      return OK;
    }),

    handle(debugHoldWall, (ctx) => {
      if (PRODUCTION) return skipped('the debug skip is refused in a production build');
      if (ctx.state.stronghold) return skipped('the stronghold is already held');
      ctx.emit(setCounter, { key: STRONGHOLD_WALL_KEY, value: STRONGHOLD_WAVE });
      return OK;
    }),

    handle(leaveReview, (ctx) => {
      if (!ctx.state.review) return skipped('no review is open');
      ctx.state.review = false;
      ctx.state.spentThisReview = 0;
      return OK;
    }),
  ],

  // The legacy block is this slice: copy it whole, then start the run. Every
  // other slice is new; the counters a run starts with are set here.
  newRun: (ctx, previous) => {
    const legacy = previous(system);
    Object.assign(ctx.state, JSON.parse(JSON.stringify(legacy)) as PrestigeState);
    ctx.touch(LEGACY_SOURCE);
    if (ctx.state.count === 0) return;
    ctx.emit(setCounter, { key: PRESTIGE_COUNT_KEY, value: ctx.state.count });
    ctx.emit(setCounter, { key: TUTORIAL_DONE_KEY, value: 1 });
    const old = previous(counters);
    for (const [key, value] of Object.entries(old.counts)) {
      if (key.startsWith(UNLOCK_PREFIX) && value >= 1) ctx.emit(setCounter, { key, value: 1 });
    }
    for (const floor of ctx.state.floorsSeen) ctx.emit(setCounter, { key: floorSeenKey(floor), value: 1 });
    if (ctx.state.stronghold) ctx.emit(setCounter, { key: STRONGHOLD_KEY, value: 1 });
    // The stronghold ends the run without asking, so the bank the player had
    // not spent stays theirs; a prestige by choice starts it at 0.
    if (heldBefore(old)) ctx.emit(bankTicks, { ticks: previous(bonus).banked });
    ctx.request(placeNow, { spot: RUN_START_SPOT, newRun: true });
    applyRunStart(ctx);
    ctx.emit(prestiged, { count: ctx.state.count, points: ctx.state.points });
  },

  view: (ctx) => {
    const state = ctx.state;
    const r = conditionReader(ctx);
    return {
      visible: prestigeVisible(state, r),
      canPrestige: canPrestige(r),
      count: state.count,
      points: state.points,
      harvest: harvest(ctx, state),
      forecast: forecast(ctx),
      boons: PRESTIGE_BOON_LIST.map((def) => {
        const cost = nextBoonCost(state, def.id);
        return {
          id: def.id,
          name: def.name,
          icon: def.icon,
          desc: def.desc,
          rank: boonRank(state, def.id),
          maxRank: def.cost.length,
          nextCost: cost,
          canBuy: cost !== null && state.points >= cost,
        };
      }),
      review: state.review,
      spentThisReview: state.spentThisReview,
      lastHarvest: state.lastHarvest ? (JSON.parse(JSON.stringify(state.lastHarvest)) as HarvestReport) : null,
      wayfinding: hasWayfinding(state),
    };
  },
});

export default system;

