/**
 * This game's adapter for the FACET core. Port of old
 * `src/core/facet/host.ts` (`createFacetHost`) and the binding half of
 * `signal.ts`.
 *
 * The core is one global (`globalThis.Facet`) with one installed host. Every
 * host member reads and writes through the context of the handler that
 * called into the core: `withCtx` pushes it, the members read the top of the
 * stack. A member that changes the game needs a handler context; a view
 * context reads only.
 *
 * The core keeps the attached documents per ref. `bind` points it at the
 * slice being run: a load, a new run or a second kernel in the same process
 * hands it another slice object, and the documents are attached again
 * (old `bindFacets`). Attaching rebuilds nothing that is saved: the cell
 * values live in the documents, the carrier statuses in `statuses`.
 */
import { TPS, type Ctx, type DeepReadonly } from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import combat, { abilityStrikeRequest, isSiteBoss, statueLanded, type Enemy } from '../combat';
import levels from '../levels';
import { logLine } from '../log';
import mercy, { procRate, rollProcChance } from '../mercy';
import { healNow, spendNow, type ResourceId } from '../resources';
import { ATTRIBUTE_IDS, DAMAGE_TYPES, effectiveAttr, ELEMENTAL_TYPES, statBlockOf, type DamageType } from '../stats';
import statuses, {
  applyStatus,
  findStatus,
  heldOf,
  isHarmful,
  removeStatus,
  setDose,
  statueOf,
  STATUSES,
  type StatusApplication,
  type StatusDef,
} from '../statuses';
import { resourceValue } from '../resources';
import resources from '../resources';
import type { FacetDoc, FacetHost } from './facet';
import { CORE } from './load';

export { CORE, NO_CORE } from './load';
import { FACET_POOLS, facetQuantities, readQuantity, type QuantityReads } from './quantities';
import { FOE, PLAYER_REF, type FacetState } from './state';

const PHYSICAL: ReadonlySet<DamageType> = new Set(['slashing', 'piercing', 'bludgeoning']);

/** Off: what this game does not have. The core skips the matching members. */
const CAPS = {
  party: false,
  ally: false,
  arena: false,
  laws: false,
  mission: false,
  calendar: false,
  summon: false,
  revive: false,
  simulate: false,
};

/**
 * Status fields a FACET document may set on a generated condition. The core
 * copies only fields named here. The old `STATUS_SCHEMA`.
 */
const STATUS_SCHEMA = {
  fields: {
    mods: { kind: 'mod' },
    duration: { kind: 'meta' },
    hidden: { kind: 'meta' },
    stacking: { kind: 'meta' },
    desc: { kind: 'meta' },
    overrideRes: { kind: 'res', mortality: 'coverage' },
    element: { kind: 'meta' },
    contest: { kind: 'meta' },
    escalatesTo: { kind: 'meta' },
    attrCeiling: { kind: 'meta' },
    routeExcess: { kind: 'meta' },
    repMult: { kind: 'meta' },
    drillsAll: { kind: 'meta' },
    parryContest: { kind: 'meta' },
    blowCut: { kind: 'meta' },
    pureBlows: { kind: 'meta' },
    cloneYield: { kind: 'meta' },
    cloneXp: { kind: 'meta' },
    unarmedRider: { kind: 'meta' },
  },
};

// ---- the context stack ----

interface Frame {
  reads: QuantityReads;
  /** Null for a view: it reads and changes nothing. */
  ctx: Ctx<FacetState> | null;
  state: DeepReadonly<FacetState>;
}

const STACK: Frame[] = [];

function top(): Frame {
  const frame = STACK[STACK.length - 1];
  if (!frame) throw new Error('facet: the core called the host outside a handler');
  return frame;
}

function writer(member: string): Ctx<FacetState> {
  const ctx = top().ctx;
  if (!ctx) throw new Error(`facet: ${member} changes the game and was called from a view`);
  return ctx;
}

let BOUND: DeepReadonly<FacetState> | null = null;

/** Run `fn` with the core pointed at this handler's slice. */
export function withCtx<T>(ctx: Ctx<FacetState>, fn: () => T): T {
  STACK.push({ reads: ctx, ctx, state: ctx.state });
  try {
    bind(ctx.state);
    return fn();
  } finally {
    STACK.pop();
  }
}

/** Run `fn` with read access only (the view). The core is not attached again. */
export function withReads<T>(reads: QuantityReads, state: DeepReadonly<FacetState>, fn: () => T): T {
  STACK.push({ reads, ctx: null, state });
  try {
    ensureInstalled();
    return fn();
  } finally {
    STACK.pop();
  }
}

/** Attach the slice's documents when the core holds another slice's. `force` after the documents were replaced. */
export function bind(state: DeepReadonly<FacetState>, force = false): void {
  ensureInstalled();
  if (BOUND === state && !force) return;
  BOUND = state;
  Facet.detach(PLAYER_REF);
  Facet.attach(PLAYER_REF, state.docs as FacetDoc[]);
}

// ---- refs ----

function fight(reads: QuantityReads) {
  return reads.read(combat).fight;
}

/** The enemies an ability can aim at: alive and not statues. */
function livingFoes(reads: QuantityReads): string[] {
  const held = reads.read(statuses);
  return (fight(reads)?.enemies ?? []).flatMap((e, i) =>
    e && e.hp > 0 && !statueOf(heldOf(held, e.entity)) ? [FOE + i] : [],
  );
}

function foeOf(reads: QuantityReads, ref: string): DeepReadonly<Enemy> | null {
  if (!ref.startsWith(FOE)) return null;
  const e = fight(reads)?.enemies[Number(ref.slice(FOE.length))];
  return e && e.hp > 0 ? e : null;
}

/** The kernel entity a ref names: the player, a living enemy, or null. */
function entityOf(reads: QuantityReads, ref: string): string | null {
  if (ref === PLAYER_REF) return 'player';
  return foeOf(reads, ref)?.entity ?? null;
}

/** The ref of an enemy entity in the open fight, or '' when it is not in it. */
export function refOfEntity(reads: QuantityReads, entity: string | undefined): string {
  if (!entity) return '';
  const slot = (fight(reads)?.enemies ?? []).findIndex((e) => e?.entity === entity);
  return slot >= 0 ? FOE + slot : '';
}

/** An enemy's numbers a document may read: its level and `fighter.boss`. Everything else reads 0. */
function readFoe(reads: QuantityReads, foe: DeepReadonly<Enemy>, id: string): number {
  if (id === 'fighter.boss') return isSiteBoss(reads.read(combat).site, foe.defId) ? 1 : 0;
  if (id === 'fighter.level') return foe.level;
  return 0;
}

/** Raise `statue` when an enemy has just turned to stone (Basilisk Hide's count). */
function signalStatue(ctx: Ctx<FacetState>, ref: string, foe: DeepReadonly<Enemy>): void {
  const mine = ATTRIBUTE_IDS.reduce((n, a) => n + effectiveAttr(ctx, a), 0);
  const its = ATTRIBUTE_IDS.reduce((n, a) => n + (foe.attrs[a] ?? 0), 0);
  const level = ctx.read(levels).level;
  Facet.event('statue', PLAYER_REF, {
    target: ref,
    level: foe.level,
    levelShare: foe.level / Math.max(1, level),
    attrShare: its / Math.max(1, mine),
    boss: isSiteBoss(ctx.read(combat).site, foe.defId) ? 1 : 0,
  });
}

function notYet(member: string, step: string): () => never {
  return () => {
    throw new Error(`Facet host (ksgproto28-b): ${member} arrives with ${step}; no document may use it yet`);
  };
}

/** The document an effect came from, by id. */
function docOf(id: string | undefined): DeepReadonly<FacetDoc> | undefined {
  return top().state.docs.find((d) => d.id === id);
}

// ---- the host ----

function createHost(): FacetHost {
  const r = () => top().reads;
  const bags = new Map<string, Record<string, unknown>>();
  const held = (ref: string, id: string) => {
    const entity = entityOf(r(), ref);
    return entity ? findStatus(heldOf(r().read(statuses), entity), id) : null;
  };

  return {
    id: 'ksgproto28',
    ticksPerSecond: TPS,
    caps: CAPS,
    encounterCap: () => Infinity,

    // ---- chance: the kernel's generator and the mercy ledger ----
    rand: () => writer('rand').rng.next(),
    pick: <T>(arr: T[]): T | undefined => (arr.length ? arr[Math.floor(writer('pick').rng.next() * arr.length)] : undefined),
    weightedPick: <T>(arr: T[], weightOf: (x: T) => number): T | undefined => {
      const total = arr.reduce((n, x) => n + Math.max(0, weightOf(x)), 0);
      if (!arr.length || total <= 0) return arr[0];
      let roll = writer('weightedPick').rng.next() * total;
      for (const x of arr) {
        roll -= Math.max(0, weightOf(x));
        if (roll < 0) return x;
      }
      return arr[arr.length - 1];
    },
    proc: (_ref: string, key: string, rate: number, mercyOn: boolean) =>
      mercyOn ? writer('proc').request(rollProcChance, { key, rate }) : writer('proc').rng.chance(rate),
    curveRate: (_ref: string, key: string, rate: number) => procRate(r().read(mercy).ledger, key, rate),

    // ---- the bearer ----
    now: () => totalTicksOf(r().read(clock)),
    bearerId: (ref: string) => ref,
    isAlive: (ref: string) => (ref === PLAYER_REF ? resourceValue(r().read(resources), 'hp') > 0 : !!foeOf(r(), ref)),
    sideOf: (ref: string) => (ref.startsWith(FOE) ? 'enemy' : 'party'),
    levelOf: (ref: string) => (ref === PLAYER_REF ? r().read(levels).level : (foeOf(r(), ref)?.level ?? 0)),
    hp: (ref: string) => (ref === PLAYER_REF ? resourceValue(r().read(resources), 'hp') : (foeOf(r(), ref)?.hp ?? 0)),
    maxHp: (ref: string) => {
      if (ref === PLAYER_REF) return statBlockOf(r()).maxHp;
      const foe = foeOf(r(), ref);
      return foe ? statBlockOf(r(), foe.entity).maxHp : 0;
    },
    personOf: () => null,
    // The player is the only bearer on the party side. Enemies come in slot
    // order, so the front enemy is first and `n: 1` picks it.
    resolve: (from: string, scope: { side?: string; n?: number | null }) => {
      let pool: string[];
      if (!scope.side || scope.side === 'self' || scope.side === 'party' || scope.side === 'ally') pool = [from];
      else if (scope.side === 'enemy') pool = livingFoes(r());
      else if (scope.side === 'arena') pool = [PLAYER_REF, ...livingFoes(r())];
      else pool = [];
      return scope.n === null || scope.n === undefined ? pool : pool.slice(0, scope.n);
    },
    rankers: () => ['front'],

    // ---- quantities ----
    quantities: facetQuantities,
    readQ: (ref: string, id: string) => {
      if (ref === PLAYER_REF) return readQuantity(r(), id) ?? 0;
      const foe = foeOf(r(), ref);
      return foe ? readFoe(r(), foe, id) : 0;
    },
    // An override would change what an ability reads and nothing the player
    // fights with until the stat path takes it, so it is refused (old K3).
    overrideQ: notYet('overrideQ', 'K3'),
    clearOverrides: () => {},
    // A carrier's change reaches the stat cache through `statuses`, which
    // touches its source when the held list's signature changes.
    touchQ: () => {},

    // ---- statuses ----
    statusSchema: () => STATUS_SCHEMA,
    // Idempotent registration into the status registry. A generated definition
    // is never saved; it is rebuilt from the document.
    defineStatus: (def: Partial<StatusDef> & { id: string; duration?: number | null }) => {
      if (!def?.id) return;
      const known: Partial<StatusDef> | undefined = STATUSES[def.id];
      const merged = { desc: '', stacking: { mode: 'highest' }, ...known, ...def } as StatusDef & { duration?: number | null };
      // The registry writes no timer as an absent duration (the old `null`).
      if (merged.duration === null) delete merged.duration;
      // The Ability tab shows this cell: the status list leaves its carrier out, as the old sidebar did.
      if (SHOWN_CARRIERS.has(def.id)) merged.hidden = true;
      // A carrier rides the player only, applied by the ability itself, so no
      // resistance answers it. Said, for the status lint, when it harms.
      if (def.id.startsWith('fc_') && !merged.element && !merged.unresistable && isHarmful(merged)) {
        merged.unresistable = "the run's ability holds it on you";
      }
      STATUSES[def.id] = merged;
    },
    applyStatus: (ref: string, app: StatusApplication, source?: string) => {
      const ctx = writer('applyStatus');
      const entity = entityOf(ctx, ref);
      if (!entity) return null;
      const foe = ref === PLAYER_REF ? null : foeOf(ctx, ref);
      const was = foe ? statueOf(heldOf(ctx.read(statuses), entity)) : null;
      const landed = ctx.request(applyStatus, { entity, app, ...(source ? { source } : {}) });
      if (foe && !was && statueOf(heldOf(ctx.read(statuses), entity))) {
        // The statue rules of combat apply in this fight from now on.
        ctx.request(statueLanded, { entity });
        signalStatue(ctx, ref, foe);
      }
      return landed;
    },
    removeStatus: (ref: string, id: string) => {
      const ctx = writer('removeStatus');
      const entity = entityOf(ctx, ref);
      if (entity) ctx.request(removeStatus, { entity, id });
    },
    findStatus: (ref: string, id: string) => held(ref, id) ?? null,
    // These change a held condition only. A condition not held is left absent.
    setStatusIntensity: (ref: string, id: string, v: number) => {
      const ctx = writer('setStatusIntensity');
      const entity = entityOf(ctx, ref);
      const now = entity ? findStatus(heldOf(ctx.read(statuses), entity), id) : null;
      if (!entity || !now || now.intensity === v) return;
      ctx.request(setDose, { entity, id, intensity: v, ticksLeft: now.ticksLeft });
    },
    // No bank document holds a set (`hold: 'many'`); the statuses system has no request for stacks or data.
    setStatusStacks: (ref: string, id: string) => {
      writer('setStatusStacks').skip('facet/stacks', `"${id}" on ${ref}: a set cell is not supported`);
    },
    setStatusData: (ref: string, id: string) => {
      writer('setStatusData').skip('facet/stacks', `"${id}" on ${ref}: a set cell is not supported`);
    },

    // ---- damage and costs ----
    // An enemy takes a document's damage through combat's own path. The
    // player is not a target: no bank ability hurts its bearer.
    applyDamage: (ref: string, amount: number, type: string, source?: string) => {
      const ctx = writer('applyDamage');
      const foe = foeOf(ctx, ref);
      if (!foe) return 0;
      const doc = docOf(source);
      const known = (DAMAGE_TYPES as readonly string[]).includes(type) ? (type as DamageType) : 'arcane';
      return ctx.request(abilityStrikeRequest, {
        entity: foe.entity,
        amount,
        type: known,
        by: {
          name: doc?.reading?.name ?? 'Ability',
          icon: doc?.reading?.icon ?? '✦',
          ...(doc?.reading?.hit ? { hit: doc.reading.hit } : {}),
        },
      });
    },
    // The `heal` verb: the player's HP, kind `other`, so it closes no wound.
    applyHeal: (ref: string, amount: number) => {
      if (ref !== PLAYER_REF) return 0;
      return writer('applyHeal').request(healNow, { amount, kind: 'other' })?.healed ?? 0;
    },
    // A pool cost (the `spend` verb): stamina, mana, spirit or focus, never HP.
    spendPool: (ref: string, pool: string, amount: number) =>
      ref === PLAYER_REF && FACET_POOLS.includes(pool as ResourceId)
        ? writer('spendPool').request(spendNow, { id: pool as ResourceId, amount })
        : 0,
    // The `defeat` verb (Calorie Burn): the player's fight ends as a loss.
    // Marked here; the fight hook settles it after the ability's tick.
    defeat: (ref: string, outcome: string, cause: string) => {
      const ctx = writer('defeat');
      if (ref !== PLAYER_REF || !fight(ctx) || ctx.state.fallen) return;
      ctx.state.fallen = { outcome: outcome === 'dead' ? 'dead' : 'knocked_out', cause };
    },

    // ---- damage stages: none ----
    stages: () => [],
    channels: () => DAMAGE_TYPES.map((id) => ({ id, group: PHYSICAL.has(id) ? 'physical' : 'magical' })),
    classOf: (type: DamageType) => (PHYSICAL.has(type) ? 'physical' : 'magical'),

    // ---- the action gate: not used ----
    descriptorSchema: () => ({ lethalField: 'damageType', costField: 'cost', fields: {} }),
    vocabulary: (field: string) => (field === 'element' ? [...ELEMENTAL_TYPES] : []),

    // ---- persistence and output ----
    bag: (tier: string, ref: string) => {
      const key = tier + '|' + ref;
      let bag = bags.get(key);
      if (!bag) {
        bag = {};
        bags.set(key, bag);
      }
      return bag;
    },
    log: (line: string) => {
      if (line) writer('log').emit(logLine, { msg: line, kind: 'info' });
    },
    // The `evolve` effect wrote its offer onto the document; play holds until
    // the player picks (`hold.ts`). This says so and tells the kernel.
    offerEvolution: (_ref: string, id: string) => {
      const doc = docOf(id);
      writer('offerEvolution').holdChanged();
      writer('offerEvolution').emit(logLine, {
        msg: `${doc?.reading?.icon ?? '✦'} ${doc?.reading?.name ?? 'Your ability'} can evolve: pick a branch.`,
        kind: 'info',
      });
    },
  };
}

/** Carrier status ids of the cells the Ability tab shows. */
const SHOWN_CARRIERS = new Set<string>();

const HOST = createHost();

function ensureInstalled(): void {
  // Every caller checks `CORE` first; this is the guard behind them.
  if (!CORE) throw new Error('facet: the core is not installed (docs/SETUP.md)');
  if (Facet.host() === HOST) return;
  Facet.install(HOST);
  BOUND = null;
}

/** The status ids a document's cells ride on start with this. */
export const carrierPrefix = (doc: DeepReadonly<FacetDoc>) => 'fc_' + String(doc.id).replace('fc_', '') + '_';

/**
 * Every status the bank's documents define, registered at load, so a saved
 * carrier has its definition before anything reads it. Compiling needs the
 * registry and the schema, not a game state. A carrier of a cell the Ability
 * tab shows is kept out of the status list, as the old sidebar left it out.
 */
function registerBankStatuses(): void {
  ensureInstalled();
  for (const template of Object.values(Facet.bank ?? {})) {
    const doc = Facet.hydrate(template);
    for (const cell of doc.cells ?? []) if (cell.show) SHOWN_CARRIERS.add(carrierPrefix(doc) + cell.key);
    const compiled = (Facet as unknown as { compile(f: FacetDoc, h: FacetHost): { defs: StatusDef[] } | null }).compile(doc, HOST);
    for (const def of compiled?.defs ?? []) (HOST.defineStatus as (d: StatusDef) => void)(def);
  }
}

// Without the core there is no bank and no carrier to define.
if (CORE) registerBankStatuses();

export { HOST };
