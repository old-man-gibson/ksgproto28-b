/**
 * The bestiary: what the player has learned about each monster. Port of the
 * state half of old `systems/bestiary.ts` and of `data/bestiary.data.ts`
 * (`BESTIARY_FACTS`, `BESTIARY_TUNING`). The tag registry is in `monsters`;
 * the content reads are in `book.ts`. See README.md in this folder.
 *
 * The first kill opens an entry. Each fact waits for a minimum kill count,
 * then rolls once per kill against insight (Hunting, Intelligence, Wisdom),
 * and is granted at its `sureKills`. A caged spot grants each fact at its
 * `minKills` with no roll. A habitat is confirmed per spot by sightings.
 */
import {
  defineEvent,
  defineSystem,
  on,
  registry,
  s,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type RecordOf,
  type SystemDef,
} from '../../kernel';
import { dynamicLevelBonus, enemyKilled, fightStarted, type CombatState, type EncounterLine } from '../combat';
import counters, { bumpCounter, conditionRefIssues, conditionsMet, counterChanged, counterValue, type Condition } from '../counters';
import levels, { encounterLevel, levelOf } from '../levels';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { MONSTER_LIST, MONSTERS } from '../monsters';
import { conditionReader, grantDiscoveryXp } from '../skills';
import { formulaAttr } from '../stats';
import world, { siteOf, SPOTS, type SpotDef } from '../world';
import factsData from './content/bestiary_facts.json';
import textData from './content/bestiary_text.json';
import { migrations } from './migrations';

export * from './book';

// ---- content ----

const bestiaryFacts = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    minKills: s.number({ integer: true, min: 1, help: 'Kills before the fact can be learned at all.' }),
    sureKills: s.number({ integer: true, min: 1, help: 'Kills at which the fact is granted without a roll.' }),
    difficulty: s.number({ min: 0, help: 'Multiplies insight into the per-kill chance.' }),
    hint: s.string(),
  }),
  factsData,
  'Bestiary facts',
);
const bestiaryText = registry(textSchema, textData, 'Bestiary text');
const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));

export type BestiaryFactDef = RecordOf<typeof bestiaryFacts>;
/** In render order. */
export const BESTIARY_FACTS: readonly BestiaryFactDef[] = factsData as BestiaryFactDef[];

/**
 * Per kill a learnable fact rolls
 * `min(maxChance, (base + hunting x perHuntingLevel + (INT + WIS) x perMind) x difficulty)`.
 * A habitat needs `habitatBase` sightings at a spot, less one per
 * `habitatPerHunting` Hunting levels, at least `habitatFloor`.
 */
export const BESTIARY_TUNING = {
  base: 0.05,
  perHuntingLevel: 0.004,
  perMind: 0.0015,
  maxChance: 0.6,
  habitatBase: 10,
  habitatFloor: 5,
  habitatPerHunting: 10,
} as const;

/** The counter the harvest and `a_taste_of_everything` read. */
export const ENTRIES_KEY = 'bestiary:entries';

// ---- slice ----

export interface BestiaryEntry {
  kills: number;
  /** Sightings per spot id, counted before the first kill too. */
  seen: Record<string, number>;
  /** Learned fact ids, in the order learned. */
  facts: string[];
  /** Spots confirmed as habitat. */
  spots: string[];
  /** Tick the entry opened; 0 while not opened (a veiled species). */
  firstKill: number;
}

export interface BestiaryState {
  entries: Record<string, BestiaryEntry>;
}

type State = DeepReadonly<BestiaryState>;
type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };
type C = Ctx<BestiaryState>;

// ---- reads ----

const veilOf = (monsterId: string): readonly Condition[] | undefined => MONSTERS[monsterId]?.veil;

/** The book may not show this species yet: a condition of its `veil` is unmet. */
export function isVeiled(ctx: ReadCtx, monsterId: string): boolean {
  const veil = veilOf(monsterId);
  return !!veil && !conditionsMet(conditionReader(ctx), veil);
}

/**
 * The veil lint of the old forge validator (`forge/lib/validate.ts`, the
 * `veil` half of its veil and lore rule): a veil holds a condition, and its
 * conditions name real skills and quests. Empty when sound. The lore half is
 * `loreIssues` in `npcs`.
 */
export function veilIssues(
  monsters: readonly { id: string; veil?: readonly Condition[] }[],
  refs: { skills: Record<string, unknown>; quests: Record<string, unknown> },
): { monster: string; message: string }[] {
  const issues: { monster: string; message: string }[] = [];
  for (const def of monsters) {
    if (def.veil && !def.veil.length) issues.push({ monster: def.id, message: 'an empty veil hides nothing' });
    for (const message of conditionRefIssues(def.veil, refs)) issues.push({ monster: def.id, message });
  }
  return issues;
}

/** An entry exists once its species was killed, and is not veiled. */
export function isDiscovered(ctx: ReadCtx, state: State, monsterId: string): boolean {
  return (state.entries[monsterId]?.kills ?? 0) > 0 && !isVeiled(ctx, monsterId);
}

export function entryOf(state: State, monsterId: string): DeepReadonly<BestiaryEntry> | undefined {
  return state.entries[monsterId];
}

export function knowsFact(state: State, monsterId: string, factId: string): boolean {
  return state.entries[monsterId]?.facts.includes(factId) ?? false;
}

/** Known and total species. A veiled species is in neither count. */
export function bestiaryProgress(ctx: ReadCtx, state: State): { known: number; total: number } {
  const ids = MONSTER_LIST.map((d) => d.id).filter((id) => !isVeiled(ctx, id));
  return { known: ids.filter((id) => isDiscovered(ctx, state, id)).length, total: ids.length };
}

const huntingLevel = (ctx: ReadCtx): number => conditionReader(ctx).skillLevel('hunting');

/** Per-kill chance of a fact of difficulty 1. */
export function bestiaryInsight(ctx: ReadCtx): number {
  const mind = formulaAttr(ctx, 'int') + formulaAttr(ctx, 'wis');
  return BESTIARY_TUNING.base + huntingLevel(ctx) * BESTIARY_TUNING.perHuntingLevel + mind * BESTIARY_TUNING.perMind;
}

export function factChanceAt(insight: number, fact: Pick<BestiaryFactDef, 'difficulty'>): number {
  return Math.min(BESTIARY_TUNING.maxChance, insight * fact.difficulty);
}

export function factChance(ctx: ReadCtx, fact: Pick<BestiaryFactDef, 'difficulty'>): number {
  return factChanceAt(bestiaryInsight(ctx), fact);
}

/** Sightings needed at one spot to confirm a habitat. */
export function habitatNeeded(ctx: ReadCtx): number {
  return Math.max(
    BESTIARY_TUNING.habitatFloor,
    BESTIARY_TUNING.habitatBase - Math.floor(huntingLevel(ctx) / BESTIARY_TUNING.habitatPerHunting),
  );
}

// ---- spawn levels ----

interface SpawnSite {
  spot: SpotDef;
  line: DeepReadonly<EncounterLine>;
}

let spawnIndex: Map<string, SpawnSite[]> | null = null;

/** Every encounter line a species spawns on, its own or as a leader's escort. Built once. */
function sitesOf(monsterId: string): SpawnSite[] {
  if (!spawnIndex) {
    spawnIndex = new Map();
    for (const spot of Object.values(SPOTS)) {
      for (const line of (spot.encounters ?? []) as EncounterLine[]) {
        const ids = new Set([line.monsterId, ...(MONSTERS[line.monsterId]?.escorts ?? [])]);
        for (const id of ids) {
          let list = spawnIndex.get(id);
          if (!list) spawnIndex.set(id, (list = []));
          list.push({ spot, line });
        }
      }
    }
  }
  return spawnIndex.get(monsterId) ?? [];
}

/**
 * Level range a species spawns at, escorts included. With `ctx`, a line's
 * `levelRise` is read as it stands and a band's dynamic levels are added for
 * this player (an escort takes its leader's); without it, the authored range.
 * The band's level step is not added, as in the old book.
 */
export function spawnLevels(monsterId: string, ctx?: ReadCtx): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const playerLevel = ctx ? levelOf(ctx.read(levels)) : 1;
  const asCombat = ctx ? ({ skip: () => {}, ...ctx, read: ctx.read } as unknown as Ctx<CombatState>) : null;
  for (const { spot, line } of sitesOf(monsterId)) {
    const at = (rolled: number): number => {
      if (!ctx || !asCombat) return rolled;
      const rise = line.levelRise;
      const lvl = encounterLevel(rise, rise ? counterValue(ctx.read(counters), rise.stat) : 0, playerLevel, rolled);
      return line.once ? lvl : lvl + dynamicLevelBonus(asCombat, siteOf(ctx, spot), line.monsterId, lvl);
    };
    lo = Math.min(lo, at(line.level[0]));
    hi = Math.max(hi, at(line.level[1]));
  }
  return Number.isFinite(lo) ? [lo, hi] : [1, 1];
}

// ---- events ----

/** A species was added to the book. */
export const entryOpened = defineEvent<{ monster: string }>('bestiary/entry');
/** A fact about a species was learned. */
export const factLearned = defineEvent<{ monster: string; fact: string }>('bestiary/fact');
/** A spot was confirmed as a species' habitat. */
export const habitatConfirmed = defineEvent<{ monster: string; spot: string }>('bestiary/habitat');

// ---- recording ----

function ensureEntry(state: BestiaryState, monsterId: string): BestiaryEntry {
  return (state.entries[monsterId] ??= { kills: 0, seen: {}, facts: [], spots: [], firstKill: 0 });
}

/** Sightings at a site, one per species per encounter. The old `recordEncounter`. */
export function recordEncounter(ctx: C, spotId: string, monsterIds: readonly string[]): void {
  for (const id of new Set(monsterIds)) {
    if (!MONSTERS[id]) continue;
    const entry = ensureEntry(ctx.state, id);
    entry.seen[spotId] = (entry.seen[spotId] ?? 0) + 1;
  }
}

/** The book gains a species: stamp, discovery XP, the entries counter, the event, the line. */
function openEntry(ctx: C, monsterId: string): void {
  const def = MONSTERS[monsterId];
  ctx.state.entries[monsterId].firstKill = ctx.tick;
  ctx.emit(grantDiscoveryXp, { domain: 'bestiary', weight: 3 });
  ctx.emit(bumpCounter, { key: ENTRIES_KEY });
  ctx.emit(entryOpened, { monster: monsterId });
  ctx.emit(logLine, { msg: fillText(TEXT.species_added, { icon: def.icon, name: def.name }), kind: 'bestiary' });
}

/**
 * Open the entries of species killed while veiled whose veil now holds. Runs
 * when a counter a veil reads changes. Facts roll from the next kill.
 */
export function openLiftedEntries(ctx: C): void {
  for (const def of MONSTER_LIST) {
    if (!veilOf(def.id)) continue;
    const entry = ctx.state.entries[def.id];
    if (!entry || entry.kills < 1 || entry.firstKill !== 0 || isVeiled(ctx, def.id)) continue;
    openEntry(ctx, def.id);
  }
}

/** One kill of a species. The old `recordKill`. */
export function recordKill(ctx: C, monsterId: string): void {
  const def = MONSTERS[monsterId];
  if (!def) return ctx.skip('bestiary/kill', `no monster "${monsterId}"`);
  const entry = ensureEntry(ctx.state, monsterId);
  entry.kills += 1;
  // A veiled species is counted and nothing else. The first kill after the
  // veil lifts opens the entry (`firstKill` is still 0).
  if (isVeiled(ctx, monsterId)) return;
  if (entry.kills === 1 || (veilOf(monsterId) && entry.firstKill === 0)) openEntry(ctx, monsterId);

  // A caged spot grants every fact at its `minKills`, no roll.
  const caged = !!SPOTS[ctx.read(world).spot]?.caged;
  let insight: number | null = null;
  for (const fact of BESTIARY_FACTS) {
    if (entry.facts.includes(fact.id)) continue;
    if (entry.kills < fact.minKills) continue;
    if (!caged && entry.kills < fact.sureKills) {
      insight ??= bestiaryInsight(ctx);
      if (!ctx.rng.chance(factChanceAt(insight, fact))) continue;
    }
    entry.facts.push(fact.id);
    ctx.emit(grantDiscoveryXp, { domain: 'bestiary', weight: fact.difficulty <= 0.5 ? 2 : 1 });
    ctx.emit(factLearned, { monster: monsterId, fact: fact.id });
    ctx.emit(logLine, {
      msg: fillText(TEXT.fact_learned, { icon: fact.icon, name: fact.name, monster: def.name }),
      kind: 'bestiary',
    });
  }
  checkHabitats(ctx, monsterId);
}

/** Confirm each spot whose sightings reached the threshold. */
function checkHabitats(ctx: C, monsterId: string): void {
  const entry = ctx.state.entries[monsterId];
  if (!entry || entry.kills === 0) return;
  const needed = habitatNeeded(ctx);
  for (const [spotId, count] of Object.entries(entry.seen)) {
    if (count < needed || entry.spots.includes(spotId)) continue;
    entry.spots.push(spotId);
    ctx.emit(grantDiscoveryXp, { domain: 'bestiary' });
    ctx.emit(habitatConfirmed, { monster: monsterId, spot: spotId });
    ctx.emit(logLine, {
      msg: fillText(TEXT.den_learned, { monster: MONSTERS[monsterId].name, spot: SPOTS[spotId]?.name ?? spotId }),
      kind: 'bestiary',
    });
  }
}

/** Counter keys some species' veil reads. A change to one may lift a veil. */
const VEIL_KEYS: ReadonlySet<string> = new Set(
  MONSTER_LIST.flatMap((d) => veilOf(d.id) ?? []).flatMap((c) => ('key' in c && typeof c.key === 'string' ? [c.key] : [])),
);

// ---- view ----

export interface HauntView {
  spot: string;
  name: string;
  icon: string;
  count: number;
  confirmed: boolean;
}

export interface EntryView {
  id: string;
  kills: number;
  facts: string[];
  haunts: HauntView[];
  /** Live level range, as spawning reads it now. */
  levels: [number, number];
}

export interface BestiaryView {
  known: number;
  total: number;
  insight: number;
  habitatNeeded: number;
  /** Discovered species only. */
  entries: EntryView[];
}

const system = defineSystem<BestiaryState, BestiaryView>({
  id: 'bestiary',
  version: 1,
  migrations,
  initial: () => ({ entries: {} }),
  content: { bestiary_facts: bestiaryFacts, bestiary_text: bestiaryText },

  events: [
    // The old `encounter` bus event: one sighting per species per fight start.
    on(fightStarted, (ctx, { payload }) =>
      recordEncounter(
        ctx,
        payload.site,
        payload.enemies.map((e) => e.defId),
      ),
    ),
    on(enemyKilled, (ctx, { payload }) => recordKill(ctx, payload.defId)),
    // The old exposure tick called `openLiftedEntries` where it stamped the first calm.
    on(counterChanged, (ctx, { payload }) => {
      if (VEIL_KEYS.has(payload.key)) openLiftedEntries(ctx);
    }),
  ],

  view: (ctx): BestiaryView => {
    const state = ctx.state;
    const progress = bestiaryProgress(ctx, state);
    const entries: EntryView[] = [];
    for (const [id, e] of Object.entries(state.entries)) {
      if (!isDiscovered(ctx, state, id)) continue;
      entries.push({
        id,
        kills: e.kills,
        facts: [...e.facts],
        haunts: Object.entries(e.seen)
          .sort((a, b) => b[1] - a[1])
          .map(([spot, count]) => ({
            spot,
            name: SPOTS[spot]?.name ?? spot,
            icon: SPOTS[spot]?.icon ?? '',
            count,
            confirmed: e.spots.includes(spot),
          })),
        levels: spawnLevels(id, ctx),
      });
    }
    return {
      known: progress.known,
      total: progress.total,
      insight: bestiaryInsight(ctx),
      habitatNeeded: habitatNeeded(ctx),
      entries,
    };
  },
});

export default system;
