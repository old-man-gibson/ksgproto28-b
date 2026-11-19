/**
 * Mutagens: the chromosome. This file is the state half of old
 * `systems/mutagens.ts`: the slice, the edits (each a command), the kill
 * harvest, refinement at the culture bench, fusion, the stat source, and the
 * registrations with `benches` and `combat`. The pure half is `engine.ts`.
 * See README.md.
 */
import {
  answer,
  defineCommand,
  defineRequest,
  defineSystem,
  handle,
  OK,
  on,
  PLAYER,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import { attrName } from '../attributes';
import { benchCrafted, registerBench, type Placement } from '../benches';
import clock, { totalTicksOf } from '../clock';
import { enemyKilled, registerBody, registerPlayerAction, type ActionCtx, type BodyBlow, type PickedActive } from '../combat';
import { setBearer } from '../items';
import { fillText, logLine } from '../log';
import materials, { grantGraded, grantMaterial, QUALITY_ORDER, QUALITY_TIERS, qualityRank, rollQuality, stockOf, takeGraded, takeMaterial, type QualityTier } from '../materials';
import { rollMercyChance } from '../mercy';
import { monsterTagSet } from '../monsters';
import { grantDiscoveryXp, grantSkillXp, skillLevel } from '../skills';
import skills from '../skills';
import { contentMod, formulaAttr, statBlockOf, type StatMod } from '../stats';
import statuses, { heldOf } from '../statuses';
import world, { SPOTS } from '../world';
import {
  BASELINE_EDGE,
  elementLines,
  edgeKey,
  elementOf,
  genera,
  layouts,
  MAIN_GENES,
  mainGenes,
  mutagensText,
  mutations,
  MUTATIONS,
  NUCLEASES,
  nucleases,
  startingKit,
  TEXT,
  type ChromosomeEdge,
  type MutagenDef,
  type NucleaseDef,
} from './defs';
import {
  armGrants,
  bearerGrants,
  bodySize,
  capacityUsed,
  chromosomeMods,
  expressedMain,
  geneAbility,
  geneAbilityBase,
  geneInflicts,
  layoutOf,
  mainCost,
  NO_GENOME,
  priceGeneAbility,
  resolveChromosome,
  routedType,
  socketIds,
  SPLIT_SPLASH,
  type Chromosome,
  type GeneInstance,
} from './engine';
import { migrations } from './migrations';

export * from './defs';
export * from './engine';

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };
type M = Ctx<MutagensState>;

const text = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

// ---- tuning (old `systems/mutagens.ts`) ----

/** Capacity the pool starts at, and what each Geneshaping level adds. */
export const CAPACITY_BASE = 20;
export const CAPACITY_PER_LEVEL = 1.5;

/** Per-kill drop odds, before the skill tilts them. */
export const GENE_DROP_BASE = 0.02;
export const MUTAGEN_DROP_BASE = 0.03;
export const BIOMATTER_DROP = 0.25;
export const DROP_PER_LEVEL = 0.0005;
/** Rarer than a mutagen. */
export const NUCLEASE_DROP_BASE = 0.012;

/** Discovery payouts grow with how much of the book is filled. */
export const GENE_DISCOVERY_GROWTH = 1.15;
export const MUTAGEN_DISCOVERY_GROWTH = 1.08;

/** Biomatter per point of capacity the new body costs, and the settling period. */
export const SWAP_BIOMATTER_PER_CAPACITY = 0.6;
export const SWAP_SETTLE_TICKS = 600;

/** Same-grade copies consumed to push one up a grade, and the biomatter it burns. */
export const REFINE_COPIES = 2;
export const REFINE_BIOMATTER_BASE = 4;
export const REFINE_BIOMATTER_GROWTH = 1.9;

/** Histones one baseline-length connection costs. */
export const HISTONE_PER_BASELINE = 3;

/** Biomatter one fusion burns, and the grade every fused mutagen is made at. */
export const FUSE_BIOMATTER = 12;
export const FUSED_GRADE: QualityTier = 'c';

/** The rotation id of the body's own tool. */
export const GENE_ACTIVE = 'gene';

/** The bench id (the culture bench). */
export const CULTURE_BENCH = 'mutagens';

export const CHROMOSOME_SOURCE = 'mutagens/chromosome';

// ---- slice ----

export interface MutagensState {
  unlocked: boolean;
  chromosome: Chromosome;
  known: { genes: string[]; mutagens: string[] };
  /** Clock tick the centromere can be touched again (old `useCooldowns.centromere`). */
  settleUntil: number;
}

/** A chromosome as it arrives. Open, with the kit, as old `freshMutagenState`. */
export function freshMutagens(): MutagensState {
  return {
    unlocked: true,
    chromosome: { layout: 'baseline', main: null, placed: {}, established: startingKit(), cut: [] },
    known: { genes: [], mutagens: [] },
    settleUntil: 0,
  };
}

// ---- pure reads ----

export function swapBiomatterCost(gene: GeneInstance): number {
  return Math.max(1, Math.round(mainCost(gene) * SWAP_BIOMATTER_PER_CAPACITY));
}

/** Histones a connection costs, by its length. */
export function histoneCost(edge: ChromosomeEdge): number {
  return Math.max(1, Math.round(HISTONE_PER_BASELINE * (edge.length / BASELINE_EDGE)));
}

/** Biomatter a push into `target` costs. */
export function refineCost(target: QualityTier): number {
  return Math.round(REFINE_BIOMATTER_BASE * Math.pow(REFINE_BIOMATTER_GROWTH, qualityRank(target)));
}

export function nextGrade(quality: QualityTier): QualityTier | null {
  return QUALITY_ORDER[qualityRank(quality) + 1] ?? null;
}

/** The one gene a species carries. */
export function geneFrom(monsterId: string) {
  return GENE_BY_SPECIES.get(monsterId);
}

/** The first gene naming each species, as the old `find` returned. */
const GENE_BY_SPECIES = new Map<string, (typeof MAIN_GENES)[string]>();
for (const g of Object.values(MAIN_GENES)) if (g.from && !GENE_BY_SPECIES.has(g.from)) GENE_BY_SPECIES.set(g.from, g);

/** Mutations a kill with these tags could carry. Fused ones are never found. */
export function mutagensFrom(tags: ReadonlySet<string>): MutagenDef[] {
  return Object.values(MUTATIONS).filter((m) => !m.rekey && m.from && tags.has(m.from));
}

/** Nucleases a kill with these tags could carry. */
export function nucleasesFrom(tags: ReadonlySet<string>): NucleaseDef[] {
  return Object.values(NUCLEASES).filter((n) => n.from && tags.has(n.from));
}

/** The fused mutagen a pairing makes, keyed on the mutation's element. */
export function fusionOf(nucleaseId: string, mutagenId: string): MutagenDef | undefined {
  const parent = MUTATIONS[mutagenId];
  const element = parent && !parent.rekey ? elementOf(parent) : undefined;
  return element ? MUTATIONS[`${nucleaseId}_${element}`] : undefined;
}

/** The capacity pool at a Geneshaping level. */
export function capacityLimitAt(level: number): number {
  return CAPACITY_BASE + level * CAPACITY_PER_LEVEL;
}

/** What the rules read: the slice, the stock, the level and the clock. */
export interface MutagenReads {
  state: DeepReadonly<MutagensState>;
  counts: Readonly<Record<string, number>>;
  stock: DeepReadonly<Record<string, Partial<Record<QualityTier, number>>>>;
  level: number;
  now: number;
}

export function mutagenReadsOf(ctx: ReadCtx, own?: DeepReadonly<MutagensState>): MutagenReads {
  const m = ctx.read(materials);
  return {
    state: own ?? ctx.read(system),
    counts: m.counts,
    stock: m.stock as MutagenReads['stock'],
    level: skillLevel(ctx.read(skills), 'geneshaping'),
    now: totalTicksOf(ctx.read(clock)),
  };
}

const chromoOf = (state: DeepReadonly<MutagensState>): Chromosome => state.chromosome as Chromosome;

/**
 * The graph a bearer wears. The player wears the slice's chromosome; every
 * other entity (a monster) wears none written, so bare. The old `genomeOf`.
 */
export function genomeOf(state: DeepReadonly<MutagensState>, entity: string = PLAYER): Chromosome {
  return entity === PLAYER ? chromoOf(state) : NO_GENOME;
}
const stockAt = (r: MutagenReads, id: string, q: QualityTier): number => r.stock[id]?.[q] ?? 0;
const countAt = (r: MutagenReads, id: string): number => r.counts[id] ?? 0;

/** Debug: when set, the centromere never settles. A module flag, never save state (old). */
let skipSettling = false;
export function setSkipSettling(on: boolean): void {
  skipSettling = on;
}
export function skippingSettling(): boolean {
  return skipSettling;
}

/** Ticks before the centromere can be touched again. */
export function settlingLeft(r: Pick<MutagenReads, 'state' | 'now'>): number {
  if (skipSettling) return 0;
  return Math.max(0, r.state.settleUntil - r.now);
}

export function capacityLimit(r: Pick<MutagenReads, 'level'>): number {
  return capacityLimitAt(r.level);
}

export function capacityFree(r: Pick<MutagenReads, 'level' | 'state'>): number {
  return capacityLimit(r) - capacityUsed(chromoOf(r.state)).total;
}

export interface MutagenCheck {
  ok: boolean;
  reason?: string;
}

const no = (reason: string): MutagenCheck => ({ ok: false, reason });

/** Whether a chromosome in `next` shape fits the pool. */
export function fits(r: Pick<MutagenReads, 'level'>, next: Chromosome): MutagenCheck {
  const use = capacityUsed(next).total;
  const limit = capacityLimit(r);
  if (use > limit) return no(text('reason_over_capacity', { use: use.toFixed(1), limit: limit.toFixed(1) }));
  return { ok: true };
}

export function canRefine(r: MutagenReads, id: string, from: QualityTier): MutagenCheck {
  if (!r.state.unlocked) return no(text('reason_not_unlocked'));
  const target = nextGrade(from);
  if (!target) return no(text('reason_refine_ceiling'));
  if (stockAt(r, id, from) < REFINE_COPIES) return no(text('reason_refine_copies', { copies: REFINE_COPIES }));
  const cost = refineCost(target);
  if (countAt(r, 'biomatter') < cost) return no(text('reason_refine_needs_biomatter', { cost }));
  return { ok: true };
}

/** The bench's preview: the subject out of the placement. Old `previewRefine`. */
export function previewRefine(r: MutagenReads, placement: Placement): MutagenCheck {
  const subject = placement.subject;
  if (!subject) return no(text('reason_bench_empty'));
  return canRefine(r, subject.id, subject.quality);
}

export function canFuse(r: MutagenReads, nucleaseId: string, mutagenId: string, quality: QualityTier): MutagenCheck {
  if (!r.state.unlocked) return no(text('reason_not_unlocked'));
  if (!NUCLEASES[nucleaseId]) return no(text('reason_not_a_nuclease'));
  if (!fusionOf(nucleaseId, mutagenId)) return no(text('reason_no_element'));
  if (countAt(r, nucleaseId) < 1) return no(text('reason_no_nuclease_held'));
  if (stockAt(r, mutagenId, quality) < 1) return no(text('reason_none_held'));
  if (countAt(r, 'biomatter') < FUSE_BIOMATTER) return no(text('reason_fuse_needs_biomatter', { cost: FUSE_BIOMATTER }));
  return { ok: true };
}

export function canSlotMain(r: MutagenReads, gene: GeneInstance): MutagenCheck {
  if (!MAIN_GENES[gene.id]) return no(text('reason_not_a_main_gene'));
  if (stockAt(r, gene.id, gene.quality) < 1) return no(text('reason_none_held'));
  const settling = settlingLeft(r);
  if (settling > 0) return no(text('reason_settling', { seconds: (settling / 10).toFixed(0) }));
  const cost = swapBiomatterCost(gene);
  if (countAt(r, 'biomatter') < cost) return no(text('reason_wear_needs_biomatter', { cost }));
  return { ok: true };
}

// ---- commands and requests ----

export const slotMain = defineCommand<GeneInstance>('mutagens/slot-main');
export const unslotMain = defineCommand<void>('mutagens/unslot-main');
export const placeMutagen = defineCommand<{ socket: string; id: string; quality: QualityTier }>('mutagens/place');
export const removeMutagen = defineCommand<{ socket: string }>('mutagens/remove');
export const establish = defineCommand<{ a: string; b: string }>('mutagens/establish');
export const cutEdge = defineCommand<{ a: string; b: string }>('mutagens/cut');
export const restoreEdge = defineCommand<{ a: string; b: string }>('mutagens/restore');
export const fuse = defineCommand<{ nuclease: string; id: string; quality: QualityTier }>('mutagens/fuse');
export const unlockMutagens = defineCommand<{ lowerArm?: 'g' | 'i' }>('mutagens/unlock');

/** The bench run's craft: one refinement of the subject. Old `refineOnce`. */
export const refineRequest = defineRequest<{ placement: Placement }, boolean>('mutagens/refine');

const locked = (ctx: M, reason: string): void => {
  ctx.emit(logLine, { msg: text('locked', { reason }), kind: 'danger' });
};

const xp = (ctx: M, amount: number, sourceKey?: string): void => {
  ctx.emit(grantSkillXp, { tags: ['craft', 'geneshaping'], amount, ...(sourceKey ? { sourceKey } : {}) });
};

/**
 * The chromosome changed: touch the stat source and tell `items` what the
 * body grants and how big it is (old `equipment.ts` read both live).
 */
function bodyChanged(ctx: M): void {
  ctx.touch(CHROMOSOME_SOURCE);
  const chromo = chromoOf(ctx.state);
  ctx.request(setBearer, { grants: [...bearerGrants(chromo)], size: bodySize(chromo) as never });
}

/** Commit a chromosome that fits the pool. A refusal changes nothing. */
function commit(ctx: M, next: Chromosome): MutagenCheck {
  const check = fits(mutagenReadsOf(ctx, ctx.state), next);
  if (!check.ok) {
    locked(ctx, check.reason!);
    return check;
  }
  ctx.state.chromosome = next;
  return { ok: true };
}

const copyChromo = (state: DeepReadonly<MutagensState>): Chromosome => JSON.parse(JSON.stringify(state.chromosome)) as Chromosome;

function discover(ctx: M, kind: 'genes' | 'mutagens', id: string, name: string): void {
  const book = ctx.state.known[kind];
  if (book.includes(id)) return;
  const growth = kind === 'genes' ? GENE_DISCOVERY_GROWTH : MUTAGEN_DISCOVERY_GROWTH;
  const weight = Math.pow(growth, book.length);
  book.push(id);
  ctx.emit(grantDiscoveryXp, { domain: 'geneshaping', weight });
  ctx.emit(logLine, { msg: text('catalogued', { name }), kind: 'bestiary' });
}

/** What a species can carry, by monster id: content only, so kept for the session (the old code filtered every kill). */
const CARRIED = new Map<string, { mutagens: MutagenDef[]; nucleases: NucleaseDef[] }>();
function carriedBy(monsterId: string): { mutagens: MutagenDef[]; nucleases: NucleaseDef[] } {
  let hit = CARRIED.get(monsterId);
  if (!hit) {
    const tags = monsterTagSet(monsterId);
    hit = { mutagens: mutagensFrom(tags), nucleases: nucleasesFrom(tags) };
    CARRIED.set(monsterId, hit);
  }
  return hit;
}

/** Roll one kill for what it carried. Old `harvestKill`. */
function harvestKill(ctx: M, monsterId: string): void {
  if (!ctx.state.unlocked) return;
  const level = skillLevel(ctx.read(skills), 'geneshaping');
  const luck = statBlockOf(ctx).loot;
  const tilt = level * DROP_PER_LEVEL;

  if (ctx.rng.chance(BIOMATTER_DROP + tilt)) {
    ctx.request(grantMaterial, { id: 'biomatter', qty: 1 + Math.floor(ctx.rng.next() * 3) });
    xp(ctx, 2);
  }

  const gene = geneFrom(monsterId);
  if (gene && ctx.request(rollMercyChance, { key: `gene:${monsterId}:${gene.id}`, rate: GENE_DROP_BASE + tilt })) {
    const quality = rollQuality(ctx.rng, luck);
    ctx.request(grantGraded, { id: gene.id, quality, qty: 1 });
    discover(ctx, 'genes', gene.id, gene.name);
    xp(ctx, 12, gene.id);
    ctx.emit(logLine, { msg: text('gene_recovered', { icon: gene.icon, name: gene.name, grade: QUALITY_TIERS[quality].name }), kind: 'loot' });
  }

  const carried = carriedBy(monsterId);
  for (const mutagen of carried.mutagens) {
    if (!ctx.request(rollMercyChance, { key: `mutagen:${monsterId}:${mutagen.id}`, rate: MUTAGEN_DROP_BASE + tilt })) continue;
    const quality = rollQuality(ctx.rng, luck);
    ctx.request(grantGraded, { id: mutagen.id, quality, qty: 1 });
    discover(ctx, 'mutagens', mutagen.id, mutagen.name);
    xp(ctx, 6, mutagen.id);
    ctx.emit(logLine, {
      msg: text('mutagen_recovered', { icon: mutagen.icon, name: mutagen.name, grade: QUALITY_TIERS[quality].name }),
      kind: 'loot',
    });
  }

  for (const nuclease of carried.nucleases) {
    if (!ctx.request(rollMercyChance, { key: `nuclease:${monsterId}:${nuclease.id}`, rate: NUCLEASE_DROP_BASE + tilt })) continue;
    ctx.request(grantMaterial, { id: nuclease.id, qty: 1 });
    xp(ctx, 20, nuclease.id);
    ctx.emit(logLine, { msg: text('nuclease_recovered', { icon: nuclease.icon, name: nuclease.name }), kind: 'loot' });
  }
}

/** Push one grade up. Old `refine`. Null when refused (the reason is logged). */
function refine(ctx: M, id: string, from: QualityTier): QualityTier | null {
  const check = canRefine(mutagenReadsOf(ctx, ctx.state), id, from);
  if (!check.ok) {
    locked(ctx, check.reason!);
    return null;
  }
  const target = nextGrade(from)!;
  for (let i = 0; i < REFINE_COPIES; i++) ctx.request(takeGraded, { id, quality: from, qty: 1 });
  ctx.request(takeMaterial, { id: 'biomatter', qty: refineCost(target) });
  ctx.request(grantGraded, { id, quality: target, qty: 1 });
  const def = MAIN_GENES[id] ?? MUTATIONS[id];
  xp(ctx, 8 * (qualityRank(target) + 1), id);
  ctx.emit(logLine, { msg: text('refined', { icon: def?.icon ?? '', name: def?.name ?? id, grade: QUALITY_TIERS[target].name }), kind: 'item' });
  return target;
}

registerBench(CULTURE_BENCH, {
  preview: (ctx, placement) => previewRefine(mutagenReadsOf(ctx), placement),
  craft: refineRequest,
});

// ---- combat ----

/** The body as a combat handler reads it. */
const bodyOf = (ctx: Pick<ActionCtx, 'read'>): Chromosome => chromoOf(ctx.read(system));

registerBody({
  damageType: (ctx) => routedType(bodyOf(ctx), 'attacks'),
  sureSwing: (ctx) => armGrants(bodyOf(ctx), 'attacks', 'ignores_dodge'),
  splitSplash: (ctx) => (armGrants(bodyOf(ctx), 'attacks', 'splits_target') ? SPLIT_SPLASH : 0),
});

registerPlayerAction(GENE_ACTIVE, {
  rank: 10,
  // The base ability: whether the body has a tool at all.
  known: (ctx) => (geneAbilityBase(bodyOf(ctx)) ? [GENE_ACTIVE] : []),
  pick(ctx, id, slot) {
    const chromo = bodyOf(ctx);
    const ability = geneAbility(chromo);
    if (!ability) return null;
    const spec = ability.spec;
    if (spec.type === 'buff') {
      if (slot !== 'buff') return null;
      return 'a buff gene ability waits for a later port';
    }
    if (slot !== 'attack') return null;
    if (spec.volley || spec.incant) return 'this gene ability (a volley or a wind-up) waits for a later port';
    const gene = expressedMain(chromo);
    const picked: PickedActive = {
      id,
      cooldown: spec.cooldown,
      usesHands: false,
      ...(spec.sure ? { sure: true } : {}),
      approach: spec.damageType ?? 'bludgeoning',
      blow(c, vs, target): BodyBlow {
        const stacksOn = (entity: string) => (status: string) =>
          heldOf(c.read(statuses), entity).find((s) => s.id === status)?.stacks ?? 0;
        const priced = priceGeneAbility(spec, vs, ability.name, { attr: (a) => formulaAttr(c, a), targetStacks: stacksOn(target.entity) }, attrName);
        return {
          label: `${ability.icon} ${ability.name} hits`,
          hitLabel: ability.name,
          damage: priced.damage,
          steps: priced.steps,
          type: spec.damageType ?? 'bludgeoning',
          ...(spec.stun ? { stun: spec.stun } : {}),
          ...(spec.selfDelay ? { selfDelay: spec.selfDelay } : {}),
          ...(spec.riders ? { riders: spec.riders } : {}),
          ...(spec.sizeDouble ? { sizeDouble: spec.sizeDouble } : {}),
          ...(spec.execute ? { execute: spec.execute } : {}),
          ...(spec.splash ? { splash: spec.splash } : {}),
          ...(spec.splashAll ? { splashAll: true } : {}),
          inflicts: (t) => geneInflicts(spec, gene, spec.perTargetStacks ? stacksOn(t.entity)(spec.perTargetStacks.status) : 0),
          tags: ['combat', 'geneshaping'],
          attrXp: { attr: 'con', amount: 3 },
        };
      },
    };
    return picked;
  },
});

// ---- view ----

export interface MutagensView {
  state: MutagensState;
  /** What the rules read, for the panel's pure calls. */
  reads: MutagenReads;
  /** The spot has a culture bench. */
  atBench: boolean;
  /** Discovered spots with a culture bench. */
  benches: { id: string; name: string }[];
  craftSpeed: number;
  /** The player's stat block: the ability card prices against it. */
  stats: Readonly<Record<string, number>>;
  /** Attributes as the formulas read them, for an attribute-priced ability. */
  attrs: Record<string, number>;
}

const system: SystemDef<MutagensState, MutagensView> = defineSystem<MutagensState, MutagensView>({
  id: 'mutagens',
  version: 1,
  migrations,
  initial: freshMutagens,
  content: {
    main_genes: mainGenes,
    genera,
    mutations,
    element_lines: elementLines,
    nucleases,
    chromosome_layouts: layouts,
    mutagens_text: mutagensText,
  },

  modifiers: [
    {
      id: CHROMOSOME_SOURCE,
      // A monster wears bare, every value 0: nothing to return.
      collect: ({ state, entity }): StatMod[] =>
        entity === PLAYER ? chromosomeMods(resolveChromosome(chromoOf(state))).map(({ mod, source }) => contentMod(mod, source, undefined)) : [],
    },
  ],

  commands: [
    handle(slotMain, (ctx, gene) => {
      const r = mutagenReadsOf(ctx, ctx.state);
      const allowed = canSlotMain(r, gene);
      if (!allowed.ok) {
        locked(ctx, allowed.reason!);
        return skipped(allowed.reason!);
      }
      const current = copyChromo(ctx.state);
      const check = commit(ctx, { ...current, main: { id: gene.id, quality: gene.quality } });
      if (!check.ok) return skipped(check.reason!);
      const cost = swapBiomatterCost(gene);
      ctx.request(takeMaterial, { id: 'biomatter', qty: cost });
      ctx.request(takeGraded, { id: gene.id, quality: gene.quality, qty: 1 });
      if (current.main) ctx.request(grantGraded, { id: current.main.id, quality: current.main.quality, qty: 1 });
      ctx.state.settleUntil = r.now + SWAP_SETTLE_TICKS;
      xp(ctx, 20 + cost);
      const def = MAIN_GENES[gene.id];
      ctx.emit(logLine, { msg: text('gene_worn', { icon: def.icon, name: def.name, cost, seconds: SWAP_SETTLE_TICKS / 10 }), kind: 'action' });
      bodyChanged(ctx);
      return OK;
    }),
    handle(unslotMain, (ctx) => {
      const r = mutagenReadsOf(ctx, ctx.state);
      const main = ctx.state.chromosome.main;
      if (!main) return skipped(text('reason_already_own_sequence'));
      const settling = settlingLeft(r);
      if (settling > 0) return skipped(text('reason_settling', { seconds: (settling / 10).toFixed(0) }));
      ctx.state.chromosome = { ...copyChromo(ctx.state), main: null };
      ctx.request(grantGraded, { id: main.id, quality: main.quality, qty: 1 });
      ctx.state.settleUntil = r.now + SWAP_SETTLE_TICKS;
      bodyChanged(ctx);
      return OK;
    }),
    handle(placeMutagen, (ctx, { socket, id, quality }) => {
      const current = copyChromo(ctx.state);
      if (!socketIds(layoutOf(current)).includes(socket)) return skipped(text('reason_no_such_socket'));
      if (!MUTATIONS[id]) return skipped(text('reason_not_a_mutagen'));
      if (stockOf(ctx.read(materials), id, quality) < 1) return skipped(text('reason_none_held'));
      const check = commit(ctx, { ...current, placed: { ...current.placed, [socket]: { id, quality } } });
      if (!check.ok) return skipped(check.reason!);
      ctx.request(takeGraded, { id, quality, qty: 1 });
      const had = current.placed[socket];
      if (had) ctx.request(grantGraded, { id: had.id, quality: had.quality, qty: 1 });
      bodyChanged(ctx);
      return OK;
    }),
    handle(removeMutagen, (ctx, { socket }) => {
      const had = ctx.state.chromosome.placed[socket];
      if (!had) return skipped(text('reason_socket_empty'));
      const next = copyChromo(ctx.state);
      delete next.placed[socket];
      ctx.state.chromosome = next;
      ctx.request(grantGraded, { id: had.id, quality: had.quality, qty: 1 });
      bodyChanged(ctx);
      return OK;
    }),
    handle(establish, (ctx, { a, b }) => {
      const current = copyChromo(ctx.state);
      const key = edgeKey(a, b);
      const edge = layoutOf(current).edges.find((e) => edgeKey(e.a, e.b) === key);
      if (!edge) return skipped(text('reason_no_edge'));
      if (current.established.includes(key)) return skipped(text('reason_already_established'));
      const cost = histoneCost(edge);
      const held = ctx.read(materials).counts.histone ?? 0;
      if (held < cost) return skipped(text('reason_histones_short', { cost, held }));
      const check = commit(ctx, { ...current, established: [...current.established, key] });
      if (!check.ok) return skipped(check.reason!);
      ctx.request(takeMaterial, { id: 'histone', qty: cost });
      xp(ctx, 5 + cost);
      ctx.emit(logLine, { msg: text('edge_coiled', { a, b, cost }), kind: 'action' });
      bodyChanged(ctx);
      return OK;
    }),
    handle(cutEdge, (ctx, { a, b }) => {
      const current = copyChromo(ctx.state);
      const key = edgeKey(a, b);
      if (!current.established.includes(key)) return skipped(text('reason_edge_not_established'));
      if (current.cut.includes(key)) return skipped(text('reason_already_cut'));
      const check = commit(ctx, { ...current, cut: [...current.cut, key] });
      if (!check.ok) return skipped(check.reason!);
      bodyChanged(ctx);
      return OK;
    }),
    handle(restoreEdge, (ctx, { a, b }) => {
      const key = edgeKey(a, b);
      if (!ctx.state.chromosome.cut.includes(key)) return skipped(text('reason_edge_not_cut'));
      const next = copyChromo(ctx.state);
      ctx.state.chromosome = { ...next, cut: next.cut.filter((k) => k !== key) };
      bodyChanged(ctx);
      return OK;
    }),
    handle(fuse, (ctx, { nuclease, id, quality }) => {
      const check = canFuse(mutagenReadsOf(ctx, ctx.state), nuclease, id, quality);
      if (!check.ok) {
        locked(ctx, check.reason!);
        return skipped(check.reason!);
      }
      const fused = fusionOf(nuclease, id)!;
      ctx.request(takeMaterial, { id: nuclease, qty: 1 });
      ctx.request(takeMaterial, { id: 'biomatter', qty: FUSE_BIOMATTER });
      ctx.request(takeGraded, { id, quality, qty: 1 });
      ctx.request(grantGraded, { id: fused.id, quality: FUSED_GRADE, qty: 1 });
      xp(ctx, 25, fused.id);
      ctx.emit(logLine, { msg: text('fused', { icon: fused.icon, name: fused.name }), kind: 'item' });
      return OK;
    }),
    handle(unlockMutagens, (ctx, { lowerArm }) => {
      if (ctx.state.unlocked) return skipped(text('reason_already_unlocked'));
      ctx.state.unlocked = true;
      ctx.state.chromosome = { ...copyChromo(ctx.state), established: startingKit(lowerArm ?? 'g') };
      ctx.emit(logLine, { msg: text('unlocked'), kind: 'action' });
      bodyChanged(ctx);
      return OK;
    }),
  ],

  requests: [
    answer(refineRequest, (ctx, { placement }) => {
      const subject = placement.subject;
      if (!subject) return false;
      const got = refine(ctx, subject.id, subject.quality);
      if (got) ctx.emit(benchCrafted, { discipline: CULTURE_BENCH });
      return got !== null;
    }),
  ],

  events: [on(enemyKilled, (ctx, { payload }) => harvestKill(ctx, payload.defId))],

  view: (ctx): MutagensView => {
    const w = ctx.read(world);
    const stats = statBlockOf(ctx);
    const state = JSON.parse(JSON.stringify(ctx.state)) as MutagensState;
    const r = mutagenReadsOf(ctx, ctx.state);
    return {
      state,
      reads: { ...r, state, counts: { ...r.counts }, stock: JSON.parse(JSON.stringify(r.stock)) },
      atBench: (SPOTS[w.spot]?.benches ?? []).includes(CULTURE_BENCH),
      benches: w.discovered.filter((id) => (SPOTS[id]?.benches ?? []).includes(CULTURE_BENCH)).map((id) => ({ id, name: SPOTS[id].name })),
      craftSpeed: stats.craftSpeed,
      stats: { ...stats },
      attrs: Object.fromEntries((['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => [a, formulaAttr(ctx, a)])),
    };
  },
});

export default system;
