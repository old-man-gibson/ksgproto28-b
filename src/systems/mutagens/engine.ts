/**
 * The pure half of old `systems/mutagens.ts`: reading a chromosome. Graph
 * in, resolution out, no state and no roll. Routing counts edges and never
 * length; intensity is the distance travelled over `BASELINE_EDGE`. An
 * effect lands in the arm of the edge it arrives on. See README.md and the
 * old docs/MUTAGENS.md.
 */
import { qualityRank, type QualityTier } from '../materials';
import { BASE_SPEED, RES_STAT_BY_TYPE, STAT_NAMES, type AttributeId, type ContentMod, type DamageType, type DerivedStats } from '../stats';
import { STATUSES, type StatusApplication } from '../statuses';
import {
  BASELINE_EDGE,
  CENTROMERE,
  CUT_BASE,
  CUT_GROWTH,
  edgeKey,
  GENERA,
  LAYOUTS,
  MAIN_BASE_COST,
  MAIN_GENES,
  MUTAGEN_ARMS,
  MUTATION_COST,
  MUTATIONS,
  QUALITY_APPROACH,
  QUALITY_COST,
  TIER_COST_EXPONENT,
  typeOfResStat,
  type ChromosomeEdge,
  type ChromosomeLayout,
  type GeneAbility,
  type GeneSpec,
  type MainGeneDef,
  type MutagenArm,
  type MutagenDef,
  type MutagenEffect,
  type MutationTransform,
} from './defs';

// ---- shapes ----

/** A gene or mutagen held at a grade. */
export interface GeneInstance {
  id: string;
  quality: QualityTier;
}

/** Sockets, connections and one centromere. */
export interface Chromosome {
  layout: string;
  main: GeneInstance | null;
  placed: Record<string, GeneInstance>;
  /** Edge keys paid for (permanent). */
  established: string[];
  /** Edge keys switched off (reversible). */
  cut: string[];
}

// ---- tuning ----

/** What one branch of an even two-way split carries. */
export const SPLIT_SHARE = 0.5;
/** How far past its own coefficient a main gene lets routed magnitude climb. */
export const CEILING_HEADROOM = 3;
/** What `splits_target` adds to a blow's splash. */
export const SPLIT_SPLASH = 0.35;

// ---- reading the graph ----

export function layoutOf(chromo: Chromosome): ChromosomeLayout {
  return LAYOUTS[chromo.layout] ?? LAYOUTS.baseline;
}

/** The floor every chromosome falls back to: an empty centromere expresses bare. */
export const BARE: GeneInstance = Object.freeze({ id: 'bare', quality: 'c' }) as GeneInstance;

/** What the centromere expresses. The null case is a real body (bare). */
export function expressedMain(chromo: Chromosome): GeneInstance {
  return chromo.main ?? BARE;
}

/** The graph a monster wears: none written, so bare (the old `NO_GENOME`). */
export const NO_GENOME: Chromosome = Object.freeze({
  layout: 'baseline',
  main: null,
  placed: Object.freeze({}) as Record<string, GeneInstance>,
  established: Object.freeze([]) as unknown as string[],
  cut: Object.freeze([]) as unknown as string[],
}) as Chromosome;

/** A chromosome with every edge established and nothing cut. */
export function fullyConnected(layoutId = 'baseline'): Chromosome {
  const layout = LAYOUTS[layoutId] ?? LAYOUTS.baseline;
  return { layout: layout.id, main: null, placed: {}, established: layout.edges.map((e) => edgeKey(e.a, e.b)), cut: [] };
}

/** How a graded `[worst, best]` range reads at this grade. */
export function atGrade(range: readonly number[], gene: GeneInstance): number {
  const t = QUALITY_APPROACH[gene.quality] ?? 1;
  return range[0] + (range[1] - range[0]) * t;
}

/** Socket names only. */
export function socketIds(layout: ChromosomeLayout): string[] {
  return layout.sockets.map((s) => s.id);
}

/** Where a node sits, centromere included. Presentation only. */
export function positionOf(layout: ChromosomeLayout, node: string): { x: number; y: number } | undefined {
  if (node === CENTROMERE) return layout.centre;
  return layout.sockets.find((s) => s.id === node);
}

/** The edges an effect may travel: established and not cut. */
export function activeEdges(chromo: Chromosome): ChromosomeEdge[] {
  const layout = layoutOf(chromo);
  const live = new Set(chromo.established);
  const cut = new Set(chromo.cut);
  return layout.edges.filter((e) => {
    const key = edgeKey(e.a, e.b);
    return live.has(key) && !cut.has(key);
  });
}

interface Adjacency {
  [node: string]: { to: string; edge: ChromosomeEdge }[];
}

function adjacencyOf(edges: ChromosomeEdge[]): Adjacency {
  const adj: Adjacency = {};
  for (const edge of edges) {
    (adj[edge.a] ??= []).push({ to: edge.b, edge });
    (adj[edge.b] ??= []).push({ to: edge.a, edge });
  }
  return adj;
}

/** Edges from the centromere to every node that reaches it. Length is ignored. */
export function hopDistances(edges: ChromosomeEdge[]): Record<string, number> {
  const adj = adjacencyOf(edges);
  const dist: Record<string, number> = { [CENTROMERE]: 0 };
  const queue: string[] = [CENTROMERE];
  while (queue.length) {
    const node = queue.shift()!;
    for (const { to } of adj[node] ?? []) {
      if (dist[to] === undefined) {
        dist[to] = dist[node] + 1;
        queue.push(to);
      }
    }
  }
  return dist;
}

// ---- effects in transit ----

function transformOf(chromo: Chromosome, socket: string): MutationTransform | undefined {
  const held = chromo.placed[socket];
  return held ? MUTATIONS[held.id]?.transform : undefined;
}

/** How close to full strength a mutagen of this grade works. Magnitudes only. */
export function mutagenApproach(quality: QualityTier): number {
  return QUALITY_APPROACH[quality] ?? 1;
}

/** A mutagen's own effect at the strength its grade works at. */
export function scaleEffect(effect: MutagenEffect, approach: number): MutagenEffect {
  if (approach === 1 || !effect.mods?.length) return effect;
  return { ...effect, mods: effect.mods.map((m) => ({ ...m, value: m.value * approach })) };
}

/** What passing through one mutagen does to an effect's character. `mult` is not applied here. */
export function applyTransform(effect: MutagenEffect, t: MutationTransform | undefined): MutagenEffect {
  if (!t) return effect;
  const out: MutagenEffect = { ...effect };
  if (t.retype) out.type = t.retype;
  if (t.grants?.length) out.grants = [...(out.grants ?? []), ...t.grants];
  return out;
}

/** What passing through one mutagen does to an effect's magnitude, as a factor on the route. */
export function transformGain(t: MutationTransform | undefined, approach: number): number {
  if (t?.mult === undefined) return 1;
  return 1 + (t.mult - 1) * approach;
}

// ---- routing ----

/** One branch of one mutation's journey, from its socket to one arm. */
export interface RoutedContribution {
  from: string;
  gene: MutagenDef;
  quality: QualityTier;
  /** Sockets passed through, in order. Excludes the origin. */
  through: string[];
  hops: number;
  /** Micrometres travelled. */
  distance: number;
  /** distance / BASELINE_EDGE. */
  intensity: number;
  /** Conduits passed and catalysts feeding the origin. 1 when neither. */
  gain: number;
  /** intensity x gain: what the ceiling is measured against. */
  magnitude: number;
  /** Product of the even splits taken. */
  share: number;
  /** The effect as it arrives. */
  arrived: MutagenEffect;
  arm: MutagenArm;
  notes: string[];
}

function walk(
  chromo: Chromosome,
  adj: Adjacency,
  dist: Record<string, number>,
  origin: string,
  gene: MutagenDef,
  quality: QualityTier,
  boost: Record<string, number>,
  out: RoutedContribution[],
): void {
  const step = (
    node: string,
    share: number,
    distance: number,
    gain: number,
    effect: MutagenEffect,
    through: string[],
    notes: string[],
  ): void => {
    const successors = (adj[node] ?? []).filter(({ to }) => dist[to] === dist[node] - 1);
    if (!successors.length) return;
    const each = share / successors.length;
    if (successors.length > 1) {
      notes.push(`${node} ties ${successors.length} ways: the effect divides evenly, ${(each * 100).toFixed(0)}% down each.`);
    }
    for (const { to, edge } of successors) {
      const travelled = distance + edge.length;
      const branchNotes = [...notes];
      if (to === CENTROMERE) {
        const arm = edge.arm;
        if (!arm) continue;
        const intensity = travelled / BASELINE_EDGE;
        branchNotes.push(
          `arrives at the ${arm} arm after ${travelled}μm: ×${intensity.toFixed(2)} intensity` +
            (through.length ? `, reinterpreted ${through.length} time(s) on the way.` : ', untouched.'),
        );
        if (gain !== 1) branchNotes.push(`amplified ×${gain.toFixed(2)} on top of the distance.`);
        out.push({
          from: origin,
          gene,
          quality,
          through: [...through],
          hops: through.length + 1,
          distance: travelled,
          intensity,
          gain,
          magnitude: intensity * gain,
          share: each,
          arrived: effect,
          arm,
          notes: branchNotes,
        });
        continue;
      }
      const t = transformOf(chromo, to);
      let carried = gain;
      if (t) {
        const held = chromo.placed[to];
        const factor = transformGain(t, mutagenApproach(held.quality));
        carried *= factor;
        branchNotes.push(
          `passes through ${to} (${MUTATIONS[held.id]?.name ?? held.id}) and is rewritten` +
            (factor !== 1 ? `, ×${factor.toFixed(2)} stronger for it.` : '.'),
        );
      }
      step(to, each, travelled, carried, applyTransform(effect, t), [...through, to], branchNotes);
    }
  };

  const held = chromo.placed[origin];
  const start = scaleEffect(MUTATIONS[held.id]?.effect ?? {}, mutagenApproach(quality));
  step(origin, 1, 0, boost[origin] ?? 1, start, [], []);
}

/** What each socket's own output is multiplied by: the catalysts, outermost first. */
export function amplification(chromo: Chromosome, adj: Adjacency, dist: Record<string, number>): Record<string, number> {
  const boost: Record<string, number> = {};
  const sockets = Object.keys(chromo.placed)
    .filter((s) => dist[s] !== undefined)
    .sort((a, b) => dist[b] - dist[a]);
  for (const socket of sockets) {
    const held = chromo.placed[socket];
    const amplify = MUTATIONS[held.id]?.amplify;
    if (amplify === undefined) continue;
    const own = 1 + (amplify - 1) * mutagenApproach(held.quality);
    const strength = 1 + (own - 1) * (boost[socket] ?? 1);
    const successors = (adj[socket] ?? []).filter(({ to }) => dist[to] === dist[socket] - 1);
    if (!successors.length) continue;
    const each = 1 + (strength - 1) / successors.length;
    for (const { to } of successors) boost[to] = (boost[to] ?? 1) * each;
  }
  return boost;
}

// ---- resolution ----

export interface ArmResolution {
  arm: MutagenArm;
  /** What the main gene puts here before anything is routed in. */
  base: ContentMod[] | undefined;
  contributions: RoutedContribution[];
  /** Capabilities that reached this arm. Never scaled, never capped. */
  grants: string[];
  /** Summed magnitude weight, after the ceiling. */
  weight: number;
}

export interface CapacityUse {
  main: number;
  mutations: number;
  cuts: number;
  total: number;
}

export interface ChromosomeResolution {
  layout: ChromosomeLayout;
  main: MainGeneDef | null;
  ceiling: number;
  arms: Record<MutagenArm, ArmResolution>;
  stranded: string[];
  capacity: CapacityUse;
  notes: string[];
}

export const ARMS: readonly MutagenArm[] = ['attacks', 'defenses', 'active', 'special'];

/** Everything about a chromosome that changes what it resolves to, as one string. */
export function chromosomeKey(chromo: Chromosome): string {
  const placed = Object.keys(chromo.placed)
    .sort()
    .map((s) => `${s}:${chromo.placed[s].id}:${chromo.placed[s].quality}`)
    .join(',');
  return [
    chromo.layout,
    `${chromo.main?.id ?? '-'}:${chromo.main?.quality ?? '-'}`,
    placed,
    [...chromo.established].sort().join('|'),
    [...chromo.cut].sort().join('|'),
  ].join('#');
}

/** Keyed memo of 8, least recently used out. */
const MEMO_CAP = 8;

function memoized<T>(store: Map<string, T>, key: string, build: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) {
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  const fresh = build();
  store.set(key, fresh);
  if (store.size > MEMO_CAP) store.delete(store.keys().next().value!);
  return fresh;
}

const resolutionMemo = new Map<string, ChromosomeResolution>();

/**
 * Resolutions by chromosome object. The `mutagens` system never edits a
 * chromosome in place (every edit stores a new object), so an object seen
 * before resolves to what it resolved to then. This spares the fight's body
 * hooks building the key on every swing. Not in the old build, which keyed
 * by string only; the answer is the same object either way.
 */
const byObject = new WeakMap<object, ChromosomeResolution>();

/** Read a chromosome. The returned object is shared: treat it as read-only. */
export function resolveChromosome(chromo: Chromosome): ChromosomeResolution {
  const seen = byObject.get(chromo);
  if (seen) return seen;
  const res = memoized(resolutionMemo, chromosomeKey(chromo), () => computeResolution(chromo));
  byObject.set(chromo, res);
  return res;
}

/** Tests: how many chromosomes the memo holds. */
export function resolutionMemoSize(): number {
  return resolutionMemo.size;
}

function computeResolution(chromo: Chromosome): ChromosomeResolution {
  const layout = layoutOf(chromo);
  const edges = activeEdges(chromo);
  const adj = adjacencyOf(edges);
  const dist = hopDistances(edges);
  const notes: string[] = [];

  const expressed = expressedMain(chromo);
  const written = MAIN_GENES[expressed.id] ?? null;
  // Rekeys first, nearest first by hops, before anything reads the gene.
  const rekeys = Object.keys(chromo.placed)
    .filter((s) => dist[s] !== undefined && MUTATIONS[chromo.placed[s].id]?.rekey)
    .sort((a, b) => dist[a] - dist[b] || (a < b ? -1 : 1))
    .map((s) => MUTATIONS[chromo.placed[s].id].rekey!)
    .filter((r) => r.kind === 'vulnerability')
    .map((r) => r.to);
  const main = written ? rekeyGene(written, rekeys) : null;
  const ceiling = main ? coefficientOf(expressed) * CEILING_HEADROOM : 0;

  const arms = Object.fromEntries(
    ARMS.map((arm) => [arm, { arm, base: main?.base?.[arm], contributions: [], grants: [], weight: 0 } as ArmResolution]),
  ) as Record<MutagenArm, ArmResolution>;

  const stranded: string[] = [];
  const all: RoutedContribution[] = [];
  const boost = amplification(chromo, adj, dist);
  for (const socket of Object.keys(chromo.placed)) {
    const held = chromo.placed[socket];
    const gene = MUTATIONS[held.id];
    if (!gene) continue;
    if (dist[socket] === undefined) {
      stranded.push(socket);
      notes.push(`${gene.name} in ${socket} has no live route to the centromere and contributes nothing.`);
      continue;
    }
    walk(chromo, adj, dist, socket, gene, held.quality, boost, all);
  }

  for (const c of all) {
    const arm = arms[c.arm];
    arm.contributions.push(c);
    arm.weight += contributionWeight(c, ceiling);
    for (const g of c.arrived.grants ?? []) if (!arm.grants.includes(g)) arm.grants.push(g);
  }

  return { layout, main, ceiling, arms, stranded, capacity: capacityUsed(chromo), notes };
}

// ---- what a gene is worth ----

/** The weapon coefficient a gene reads at: ceiling x approach. */
export function coefficientOf(gene: GeneInstance): number {
  const def = MAIN_GENES[gene.id];
  if (!def) return 0;
  return def.ceiling * (QUALITY_APPROACH[gene.quality] ?? 1);
}

/** A headline ability's damage: the tier's flat term plus the weapon-scaled term. */
export function abilityDamage(gene: GeneInstance, weaponDamage: number): number {
  const def = MAIN_GENES[gene.id];
  if (!def) return 0;
  return def.flatBase + weaponDamage * coefficientOf(gene);
}

/** Where a gene sits on its genus's power ladder, in tier-units. */
export function powerRank(gene: GeneInstance): number {
  const def = MAIN_GENES[gene.id];
  if (!def) return 0;
  const genus = GENERA[def.genus];
  if (!genus) return def.tier;
  return def.tier + qualityRank(gene.quality) / genus.gradesPerStep;
}

// ---- capacity ----

/** Whether a gene has a grade worth showing. Bare does not. */
export function showsGrade(gene: GeneInstance): boolean {
  return !MAIN_GENES[gene.id]?.gradeless;
}

/** What one main gene reserves. */
export function mainCost(gene: GeneInstance): number {
  const def = MAIN_GENES[gene.id];
  if (!def) return 0;
  if (def.gradeless) return MAIN_BASE_COST * 0.4 * (QUALITY_COST[gene.quality] ?? 1);
  const genus = GENERA[def.genus];
  const bottom = genus?.tiers
    .map((id) => MAIN_GENES[id])
    .filter(Boolean)
    .reduce((lo, g) => (g.flatBase < lo.flatBase ? g : lo), def);
  const ratio = bottom && bottom.flatBase > 0 ? def.flatBase / bottom.flatBase : 1;
  return MAIN_BASE_COST * Math.pow(ratio, TIER_COST_EXPONENT) * (QUALITY_COST[gene.quality] ?? 1);
}

/** What n held cuts reserve. Compounding. */
export function cutCost(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += CUT_BASE * Math.pow(CUT_GROWTH, i);
  return total;
}

export function capacityUsed(chromo: Chromosome): CapacityUse {
  const main = chromo.main ? mainCost(chromo.main) : 0;
  let mutations = 0;
  for (const socket of Object.keys(chromo.placed)) {
    const held = chromo.placed[socket];
    if (!MUTATIONS[held.id]) continue;
    mutations += MUTATION_COST * (QUALITY_COST[held.quality] ?? 1);
  }
  const cuts = cutCost(chromo.cut.length);
  return { main, mutations, cuts, total: main + mutations + cuts };
}

/** Every route reaching an arm, strongest first. */
export function reaching(res: ChromosomeResolution, arm: MutagenArm): RoutedContribution[] {
  return [...res.arms[arm].contributions].sort(
    (x, y) => contributionWeight(y, res.ceiling) - contributionWeight(x, res.ceiling),
  );
}

// ---- rekeying ----

export interface WeakPoint {
  where: 'base' | 'douses';
  arm?: MutagenArm;
  at?: number;
  confers?: number;
  typeAt?: number;
  type: DamageType;
}

/** The body's weak points, in the order a nuclease rewrites them. */
export function weakPointsOf(def: MainGeneDef): WeakPoint[] {
  const out: WeakPoint[] = [];
  for (const arm of ARMS) {
    const mods = def.base?.[arm] ?? [];
    for (let at = 0; at < mods.length; at++) {
      const mod = mods[at];
      const type = typeOfResStat(mod.stat);
      if (type && mod.value < 0) out.push({ where: 'base', arm, at, type });
    }
  }
  const confers = def.confers ?? [];
  for (let c = 0; c < confers.length; c++) {
    for (const rule of confers[c].removal ?? []) {
      const types = rule.damageTypes ?? [];
      for (let typeAt = 0; typeAt < types.length; typeAt++) {
        out.push({ where: 'douses', confers: c, typeAt, type: types[typeAt] });
      }
    }
  }
  return out;
}

/** The gene with every routed rekey written into it. Deep-copied: the def is shared content. */
export function rekeyGene(def: MainGeneDef, rekeys: DamageType[]): MainGeneDef {
  if (!rekeys.length) return def;
  const points = weakPointsOf(def);
  if (!points.length) return def;
  const next: MainGeneDef = {
    ...def,
    base: Object.fromEntries(Object.entries(def.base ?? {}).map(([arm, mods]) => [arm, (mods ?? []).map((m) => ({ ...m }))])),
    confers: (def.confers ?? []).map((app) => ({
      ...app,
      ...(app.removal ? { removal: app.removal.map((r) => ({ ...r, ...(r.damageTypes ? { damageTypes: r.damageTypes.slice() } : {}) })) } : {}),
    })),
  };
  for (let i = 0; i < Math.min(rekeys.length, points.length); i++) {
    const point = points[i];
    const to = rekeys[i];
    if (point.where === 'base') {
      const mod = next.base![point.arm!]![point.at!];
      mod.stat = RES_STAT_BY_TYPE[to];
    } else {
      const rule = next.confers![point.confers!].removal!.find((r) => r.damageTypes);
      if (rule?.damageTypes) rule.damageTypes[point.typeAt!] = to;
    }
  }
  return next;
}

// ---- what lands ----

/** What one route's modifiers are multiplied by: magnitude held by the ceiling, times the share. */
export function contributionWeight(c: RoutedContribution, ceiling: number): number {
  return Math.min(c.magnitude, ceiling) * c.share;
}

/** Whether the gene's ceiling bit this route. */
export function isClamped(c: RoutedContribution, ceiling: number): boolean {
  return c.magnitude > ceiling;
}

/** One route's modifiers as they land. */
export function deliveredBy(c: RoutedContribution, ceiling: number): ContentMod[] {
  const weight = contributionWeight(c, ceiling);
  if (weight <= 0) return [];
  return (c.arrived.mods ?? []).map((m) => ({ ...m, value: m.value * weight }));
}

/** Whether something reads this capability where it landed. The old `grantIsLive`. */
export function grantIsLive(grant: string, arm?: MutagenArm, spec?: GeneSpec | null): boolean {
  if (grant.startsWith('arms:+') || grant.startsWith('onehand:') || grant.startsWith('telekinetic:')) return true;
  const active = (can: (c: ReturnType<typeof abilityCarries>) => boolean) => {
    if (arm !== undefined && arm !== 'active') return false;
    if (spec === undefined) return true;
    return !!spec && can(abilityCarries(spec));
  };
  if (grant === 'ignores_dodge') return arm === 'attacks' || active((c) => c.sure);
  if (grant === 'splits_target') return arm === 'attacks' || active((c) => c.splash);
  if (grant.startsWith('inflicts_') && STATUSES[grant.slice('inflicts_'.length)]) return active((c) => c.inflicts);
  return false;
}

/** Everything routing put into one arm, folded the way the stat pipeline folds it. */
export interface ArmDelivery {
  mods: ContentMod[];
  grants: string[];
  types: DamageType[];
  /** Routes that reached this arm carrying no modifier. */
  silent: number;
}

export function armDelivery(res: ChromosomeResolution, arm: MutagenArm): ArmDelivery {
  const groups = new Map<string, ContentMod>();
  const grants: string[] = [];
  const types: DamageType[] = [];
  let silent = 0;
  for (const c of res.arms[arm].contributions) {
    const mods = deliveredBy(c, res.ceiling);
    if (!mods.length) silent += 1;
    for (const mod of mods) {
      const key = [mod.stat, mod.op, mod.fromStat, mod.requiresTag, mod.requiresStyle, mod.requiresMonsterTag].join('|');
      const seen = groups.get(key);
      if (!seen) groups.set(key, { ...mod });
      else if (mod.op === 'mult') seen.value = (1 + seen.value) * (1 + mod.value) - 1;
      else seen.value += mod.value;
    }
    for (const g of c.arrived.grants ?? []) if (!grants.includes(g)) grants.push(g);
    if (c.arrived.type && !types.includes(c.arrived.type)) types.push(c.arrived.type);
  }
  return { mods: [...groups.values()], grants, types, silent };
}

/** Every modifier the chromosome contributes: base per arm, then each route's delivery. */
export function chromosomeMods(res: ChromosomeResolution): { mod: ContentMod; source: string }[] {
  const out: { mod: ContentMod; source: string }[] = [];
  const geneName = res.main?.name ?? 'Chromosome';
  for (const arm of Object.values(res.arms)) {
    for (const mod of arm.base ?? []) out.push({ mod, source: geneName });
    for (const c of arm.contributions) {
      for (const mod of deliveredBy(c, res.ceiling)) out.push({ mod, source: `${c.gene.name} → ${arm.arm}` });
    }
  }
  return out;
}

// ---- the arms that read a type or a capability ----

/** The arriving type of the heaviest route into an arm, or none. */
export function loudestType(arm: ArmResolution, ceiling: number): DamageType | undefined {
  let loudest = 0;
  let winner: DamageType | undefined;
  for (const c of arm.contributions) {
    if (!c.arrived.type) continue;
    const weight = contributionWeight(c, ceiling);
    if (weight > loudest) {
      loudest = weight;
      winner = c.arrived.type;
    }
  }
  return winner;
}

/** The type an arm's routing delivered. */
export function routedType(chromo: Chromosome, arm: MutagenArm): DamageType | undefined {
  const res = resolveChromosome(chromo);
  return loudestType(res.arms[arm], res.ceiling);
}

/** Whether a capability arrived in a particular arm. */
export function armGrants(chromo: Chromosome, arm: MutagenArm, grant: string): boolean {
  return resolveChromosome(chromo).arms[arm].grants.includes(grant);
}

/** What an ability can carry from the Active arm. */
export function abilityCarries(spec: GeneSpec): { type: boolean; sure: boolean; splash: boolean; inflicts: boolean } {
  if (spec.volley) return { type: false, sure: false, splash: false, inflicts: false };
  if (spec.incant) return { type: true, sure: false, splash: false, inflicts: true };
  return { type: true, sure: true, splash: true, inflicts: true };
}

/** Whether this ability lands a blow whose size is worth quoting. */
export function pricesABlow(spec: GeneSpec): boolean {
  if (spec.volley) return false;
  if (spec.flat !== undefined) return true;
  return spec.power !== undefined && (spec.fromStat !== undefined || spec.fromAttr !== undefined);
}

/** A resolved ability spec: the Active arm may add these. */
export type ResolvedSpec = GeneSpec & { sure?: boolean };

/** The Active arm applied to the ability (old section 12.3). */
export function applyActiveArm(ability: GeneAbility, res: ChromosomeResolution): GeneAbility & { spec: ResolvedSpec } {
  const arm = res.arms.active;
  if (!arm.contributions.length) return ability;
  if (ability.spec.type !== 'gene') return ability;

  const spec: ResolvedSpec = { ...ability.spec };
  const carries = abilityCarries(spec);
  const retype = loudestType(arm, res.ceiling);
  if (retype && carries.type) spec.damageType = retype;

  // What each capability arrived with: the summed weight of its routes, at the origin's grade.
  const carried = new Map<string, number>();
  for (const c of arm.contributions) {
    const weight = contributionWeight(c, res.ceiling) * mutagenApproach(c.quality);
    for (const g of c.arrived.grants ?? []) carried.set(g, (carried.get(g) ?? 0) + weight);
  }

  for (const grant of arm.grants) {
    if (grant === 'ignores_dodge') {
      if (carries.sure) spec.sure = true;
    } else if (grant === 'splits_target') {
      if (!carries.splash) continue;
      spec.splashAll = true;
      spec.splash = Math.max(spec.splash ?? 0, SPLIT_SPLASH);
    } else if (grant.startsWith('inflicts_')) {
      if (!carries.inflicts) continue;
      const id = grant.slice('inflicts_'.length);
      if (!STATUSES[id]) continue;
      if (spec.inflicts?.some((a) => a.id === id)) continue;
      spec.inflicts = [...(spec.inflicts ?? []), { id, intensity: carried.get(grant) ?? 1 }];
    }
  }
  return { ...ability, spec };
}

/** The tool the expressed gene hands over, as written. Bare has none. */
export function geneAbilityBase(chromo: Chromosome): GeneAbility | undefined {
  return MAIN_GENES[expressedMain(chromo).id]?.ability;
}

/** The tool as the body expresses it: the gene's own, through the Active arm. */
export function geneAbility(chromo: Chromosome): (GeneAbility & { spec: ResolvedSpec }) | undefined {
  const base = geneAbilityBase(chromo);
  if (!base) return undefined;
  return applyActiveArm(base, resolveChromosome(chromo));
}

/** The body as expressed, rekeys written in. Bare included. */
export function expressedGene(chromo: Chromosome): MainGeneDef {
  return resolveChromosome(chromo).main ?? MAIN_GENES[expressedMain(chromo).id];
}

/** The species as written, before any rekey. */
export function expressedGeneBase(chromo: Chromosome): MainGeneDef {
  return MAIN_GENES[expressedMain(chromo).id];
}

const grantsMemo = new Map<string, ReadonlySet<string>>();

/** Every capability the body has: the gene's own and anything routed into an arm. Shared set. */
export function bearerGrants(chromo: Chromosome): ReadonlySet<string> {
  return memoized(grantsMemo, chromosomeKey(chromo), () => {
    const out = new Set(MAIN_GENES[expressedMain(chromo).id]?.grants ?? []);
    for (const arm of Object.values(resolveChromosome(chromo).arms)) for (const g of arm.grants) out.add(g);
    return out;
  });
}

/** Every capability doing something now: the gene's, and routed ones an arm reads. */
export function liveGrants(chromo: Chromosome): ReadonlySet<string> {
  const out = new Set(MAIN_GENES[expressedMain(chromo).id]?.grants ?? []);
  const res = resolveChromosome(chromo);
  const tool = geneAbility(chromo);
  const spec = tool?.spec.type === 'gene' ? tool.spec : null;
  for (const arm of ARMS) for (const g of res.arms[arm].grants) if (grantIsLive(g, arm, spec)) out.add(g);
  return out;
}

/** The size the body stands at (old `playerSizeRank` read this through `sizeRank`). */
export function bodySize(chromo: Chromosome): string {
  return MAIN_GENES[expressedMain(chromo).id]?.size ?? 'medium';
}

// ---- pricing the blow ----

/** One line of a blow's working. */
export interface PriceStep {
  label: string;
  value?: number;
  mult?: number;
}

/** What `priceGeneAbility` reads besides the stat block. */
export interface PriceReads {
  /** An attribute as the formulas read it (`formulaAttr`). */
  attr?(attr: AttributeId): number;
  /** Stacks of a condition on the target. Absent: nobody in front of it. */
  targetStacks?(status: string): number;
}

/**
 * What a gene ability lands for, before crits, size and the rest:
 * `(flat + power x fromStat) x speed x (1 + amplifiedBy)`. One formula for
 * the fight and every readout. The old `priceGeneAbility`.
 */
export function priceGeneAbility(
  spec: GeneSpec,
  stats: Readonly<DerivedStats>,
  name: string,
  reads: PriceReads = {},
  attrLabel: (attr: AttributeId) => string = (a) => a.toUpperCase(),
): { damage: number; steps: PriceStep[] } {
  const steps: PriceStep[] = [];
  let damage = spec.flat ?? 0;
  if (spec.flat !== undefined) steps.push({ label: `${name} (flat damage)`, value: damage });
  const priced =
    spec.fromStat !== undefined
      ? { label: STAT_NAMES[spec.fromStat], value: stats[spec.fromStat] }
      : spec.fromAttr !== undefined
        ? { label: attrLabel(spec.fromAttr), value: reads.attr?.(spec.fromAttr) ?? 0 }
        : null;
  if (spec.power !== undefined && priced) {
    damage += spec.power * priced.value;
    steps.push({ label: priced.label, value: priced.value });
    if (spec.power !== 1) steps.push({ label: name, mult: spec.power });
  }
  if (spec.perTargetStacks && reads.targetStacks) {
    const stacks = reads.targetStacks(spec.perTargetStacks.status);
    if (stacks > 0) {
      damage += spec.perTargetStacks.power * stacks;
      steps.push({ label: `${STATUSES[spec.perTargetStacks.status]?.name ?? spec.perTargetStacks.status} on the target`, value: stacks });
      if (spec.perTargetStacks.power !== 1) steps.push({ label: name, mult: spec.perTargetStacks.power });
    }
  }
  if (spec.scalesWithSpeed) {
    const mult = stats.speed / BASE_SPEED;
    damage *= mult;
    steps.push({ label: 'Speed', mult });
  }
  if (spec.amplifiedBy) {
    const mult = Math.max(0, 1 + stats[spec.amplifiedBy]);
    damage *= mult;
    steps.push({ label: STAT_NAMES[spec.amplifiedBy], mult });
  }
  return { damage, steps };
}

/** The intensity a target-priced ability's inflicts land at, or undefined. */
export function perTargetInflictIntensity(spec: GeneSpec, gene: GeneInstance, stacks: number): number | undefined {
  const per = spec.perTargetStacks;
  if (!per?.inflictRoot) return undefined;
  if (stacks <= 0) return undefined;
  return Math.min(per.inflictCap ?? Infinity, stacks ** (1 / atGrade(per.inflictRoot, gene)));
}

/** What the blow leaves on one target. The old `geneInflicts`. */
export function geneInflicts(spec: GeneSpec, gene: GeneInstance, stacks: number): StatusApplication[] | undefined {
  const apps = spec.inflicts as StatusApplication[] | undefined;
  if (!apps?.length) return apps;
  const at = perTargetInflictIntensity(spec, gene, stacks);
  return at === undefined ? apps : apps.map((a) => ({ ...a, intensity: at }));
}

export { MUTAGEN_ARMS };
