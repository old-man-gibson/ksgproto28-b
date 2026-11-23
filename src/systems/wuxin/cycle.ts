/**
 * The five-element cycle as a graph. Port of the old `systems/wuxin.ts` and
 * of the `WuxinBond` and `WuxinConfig` types of old `types.ts`.
 *
 * Structure only: the shape of a configuration and the rules on which shapes
 * are legal. Five slots; each holds an element, points a generative arrow
 * (`nourishes`) at one other slot and a destructive arrow (`hinders`) at
 * another. No number and no game effect is defined here; the old build had
 * none.
 *
 * Two facts the classification rests on:
 *
 * 1. A permutation of five elements with no fixed point is either one
 *    5-cycle or a 2-cycle plus a 3-cycle (2+2+1, 4+1 and 3+1+1 need a fixed
 *    point). An unsevered relation is one ring through all five, or a pair
 *    beside a triangle.
 * 2. The classical relation is `hinders = nourishes ∘ nourishes`: the ring
 *    wood→fire→earth→metal→water→wood applied twice gives the classical
 *    destructive cycle. Harmony is a relation between the two arrow sets, not
 *    a table: any five elements wired so that each hinders what its nourished
 *    element nourishes are harmonious. `discord()` counts the slots where that
 *    fails.
 *
 * Sects, martial masters and great beasts each carry a configuration in the
 * design notes, authored as five lines of the grammar below. None exists in
 * content.
 */
import { ARCANE_WORD_LIST } from '../arcane';

/**
 * One slot of a five-element cycle: what it holds, what it feeds, what it
 * fights. A null arrow is severed, which is how the non-harmonious
 * configurations are expressed.
 */
export interface WuxinBond {
  /** An arcane noun id. */
  element: string;
  /** The element this one nourishes, or null if that arrow is cut. */
  nourishes: string | null;
  /** The element this one hinders, or null if that arrow is cut. */
  hinders: string | null;
}

/** A whole cycle: the player's, a sect's, a great beast's. */
export interface WuxinConfig {
  slots: WuxinBond[];
}

/** A cycle is five slots. Both facts above depend on it. */
export const WUXIN_SLOTS = 5;

/**
 * Elements are the arcane lexicon's nouns, so a noun added to spellcraft
 * widens what a cycle can be built from. Nothing here casts anything.
 */
export const WUXIN_EXCLUDED = [
  // `zero` is untyped: nothing resists it and nothing fears it, so it has no
  // relation to anything. Excluded until it is made the wildcard on purpose.
  'zero',
];

/** Every element a slot may hold. */
export function eligibleElements(): string[] {
  return ARCANE_WORD_LIST.filter((w) => w.kind === 'noun' && !WUXIN_EXCLUDED.includes(w.id)).map((w) => w.id);
}

// ---------- The grammar ----------

/**
 * One clause per element, five clauses per configuration:
 *
 *     fire  → earth ⊣ metal
 *     earth → metal ⊣ water
 *     metal → water ⊣ wood
 *     water → wood  ⊣ fire
 *     wood  → fire  ⊣ earth
 *
 * `→` nourishes, `⊣` hinders, `∅` severs an arrow. Read: "fire nourishes
 * earth, hinders metal."
 */
export const NOURISHES = '→';
export const HINDERS = '⊣';
export const SEVERED = '∅';

/** A configuration as text, one clause per line. */
export function formatWuxin(cfg: WuxinConfig): string {
  const width = Math.max(...cfg.slots.map((s) => s.element.length));
  return cfg.slots
    .map((s) => {
      const from = s.element.padEnd(width);
      return `${from} ${NOURISHES} ${s.nourishes ?? SEVERED} ${HINDERS} ${s.hinders ?? SEVERED}`;
    })
    .join('\n');
}

/**
 * Read a configuration back from the grammar. Lenient about whitespace;
 * accepts ASCII `->` and `-|`. Null on anything it cannot read. Parsing
 * proves the text well formed, not the cycle legal: run `validateWuxin` on
 * the result.
 */
export function parseWuxin(text: string): WuxinConfig | null {
  const slots: WuxinBond[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(new RegExp(`^(\\S+)\\s*(?:${NOURISHES}|->)\\s*(\\S+)\\s*(?:${HINDERS}|-\\|)\\s*(\\S+)$`));
    if (!m) return null;
    const [, element, nourishes, hinders] = m;
    slots.push({
      element,
      nourishes: nourishes === SEVERED ? null : nourishes,
      hinders: hinders === SEVERED ? null : hinders,
    });
  }
  return slots.length ? { slots } : null;
}

// ---------- Legality ----------

export type WuxinRelation = 'nourishes' | 'hinders';

export type WuxinProblem =
  | { kind: 'slotCount'; found: number }
  | { kind: 'duplicateElement'; element: string }
  | { kind: 'unknownElement'; element: string }
  | { kind: 'selfArrow'; element: string; relation: WuxinRelation }
  | { kind: 'danglingArrow'; element: string; relation: WuxinRelation; target: string }
  | { kind: 'contested'; relation: WuxinRelation; target: string; by: string[] };

const RELATIONS: WuxinRelation[] = ['nourishes', 'hinders'];

/**
 * Everything wrong with a configuration, or an empty list. A severed arrow
 * is not a problem: it is how the non-harmonious shapes are expressed, and
 * `classify` reads it.
 */
export function validateWuxin(cfg: WuxinConfig): WuxinProblem[] {
  const problems: WuxinProblem[] = [];
  if (cfg.slots.length !== WUXIN_SLOTS) {
    problems.push({ kind: 'slotCount', found: cfg.slots.length });
  }

  const eligible = new Set(eligibleElements());
  const seen = new Set<string>();
  for (const slot of cfg.slots) {
    if (seen.has(slot.element)) problems.push({ kind: 'duplicateElement', element: slot.element });
    seen.add(slot.element);
    if (!eligible.has(slot.element)) {
      problems.push({ kind: 'unknownElement', element: slot.element });
    }
  }

  for (const relation of RELATIONS) {
    // In-degree: an element is pointed at by at most one arrow of each kind.
    const pointedBy = new Map<string, string[]>();
    for (const slot of cfg.slots) {
      const target = slot[relation];
      if (target === null) continue;
      if (target === slot.element) {
        problems.push({ kind: 'selfArrow', element: slot.element, relation });
        continue;
      }
      if (!seen.has(target)) {
        problems.push({ kind: 'danglingArrow', element: slot.element, relation, target });
        continue;
      }
      pointedBy.set(target, [...(pointedBy.get(target) ?? []), slot.element]);
    }
    for (const [target, by] of pointedBy) {
      if (by.length > 1) problems.push({ kind: 'contested', relation, target, by });
    }
  }

  return problems;
}

export function isLegal(cfg: WuxinConfig): boolean {
  return validateWuxin(cfg).length === 0;
}

// ---------- Shape ----------

/** One relation as a lookup: element to what it points at, or null. */
export function arrowsOf(cfg: WuxinConfig, relation: WuxinRelation): Map<string, string | null> {
  return new Map(cfg.slots.map((s) => [s.element, s[relation]]));
}

export interface WuxinShape {
  /** Closed loops, each listed from an arbitrary starting element. */
  cycles: string[][];
  /** Open runs, from an element nothing points at to a severed end. */
  chains: string[][];
  /** How many arrows of this relation are cut. */
  severed: number;
}

/**
 * Decompose one relation into its loops and its open runs. With every arrow
 * intact the result is one 5-cycle, or a 2-cycle and a 3-cycle. A severed
 * arrow opens a loop into a chain.
 */
export function shapeOf(cfg: WuxinConfig, relation: WuxinRelation): WuxinShape {
  const arrows = arrowsOf(cfg, relation);
  const elements = cfg.slots.map((s) => s.element);
  const severed = elements.filter((e) => arrows.get(e) == null).length;

  // An element nothing points at can only be the head of an open run.
  const targets = new Set([...arrows.values()].filter((t): t is string => t != null));
  const chains: string[][] = [];
  const visited = new Set<string>();
  for (const head of elements) {
    if (targets.has(head)) continue;
    const run: string[] = [];
    let at: string | null | undefined = head;
    while (at != null && !visited.has(at)) {
      visited.add(at);
      run.push(at);
      at = arrows.get(at);
    }
    chains.push(run);
  }

  // What is left after the open runs is closed.
  const cycles: string[][] = [];
  for (const start of elements) {
    if (visited.has(start)) continue;
    const loop: string[] = [];
    let at: string | null | undefined = start;
    while (at != null && !visited.has(at)) {
      visited.add(at);
      loop.push(at);
      at = arrows.get(at);
    }
    cycles.push(loop);
  }

  return { cycles, chains, severed };
}

/**
 * How far a configuration sits from harmony: the number of elements whose
 * destructive arrow is not where two generative steps land. Zero is the
 * classical relation, whatever elements are in the slots. A severed
 * generative arrow counts as discord.
 */
export function discord(cfg: WuxinConfig): number {
  const gen = arrowsOf(cfg, 'nourishes');
  const des = arrowsOf(cfg, 'hinders');
  let count = 0;
  for (const slot of cfg.slots) {
    const once = gen.get(slot.element);
    const twice = once == null ? null : gen.get(once);
    if (twice == null || des.get(slot.element) !== twice) count += 1;
  }
  return count;
}

export function isHarmonious(cfg: WuxinConfig): boolean {
  return discord(cfg) === 0;
}

/**
 * Destruction is generation run backwards: every element hinders the one
 * that nourishes it (X nourishes Y, and Y hinders X). The antipode of
 * harmony; for a single ring it always reads `discord === WUXIN_SLOTS`.
 * Written against the arrows, so it holds when generation closes as two
 * loops.
 */
export function isCounterflow(cfg: WuxinConfig): boolean {
  const gen = arrowsOf(cfg, 'nourishes');
  const des = arrowsOf(cfg, 'hinders');
  return cfg.slots.every((slot) => {
    const hindered = des.get(slot.element);
    return hindered != null && gen.get(hindered) === slot.element;
  });
}

/**
 * How far around the generative ring destruction reaches: the k for which
 * `hinders = nourishes^k`, or null when no single k fits.
 *
 *   k = 1  destruction is generation
 *   k = 2  harmonious, the classical relation
 *   k = 3  the pentagram traced the other way; unnamed
 *   k = 4  counterflow, generation reversed
 *
 * A split cycle usually reads null even when regular: walking generation
 * from inside the pair never reaches the triangle.
 */
export function alignment(cfg: WuxinConfig): number | null {
  const gen = arrowsOf(cfg, 'nourishes');
  const des = arrowsOf(cfg, 'hinders');
  let found: number | null = null;
  for (const slot of cfg.slots) {
    const target = des.get(slot.element);
    if (target == null) return null;
    let at: string | null | undefined = slot.element;
    let steps = 0;
    while (steps < cfg.slots.length) {
      at = gen.get(at as string);
      steps += 1;
      if (at == null) return null;
      if (at === target) break;
    }
    if (at !== target) return null;
    if (found === null) found = steps;
    else if (found !== steps) return null;
  }
  return found;
}

/**
 * Cyclic distance from the classical relation, or null when no single
 * exponent describes the configuration: 0 harmonious, 1 for either
 * neighbour, 2 for the antipode.
 *
 * Why it exists: on a closed ring `discord` takes two values only, 0 at k = 2
 * and the maximum at every other power. Of the 1,936 legal closed
 * configurations 692 read maximum discord: the 24 counterflows, the 24 at
 * k = 3, the 44 at k = 1 and 600 with no structure. Discord answers "is this
 * the classical relation" and is not a distance.
 */
export function harmonyDistance(cfg: WuxinConfig): number | null {
  const k = alignment(cfg);
  if (k === null) return null;
  const n = cfg.slots.length;
  const raw = Math.abs(k - 2) % n;
  return Math.min(raw, n - raw);
}

// ---------- Landmarks ----------

/** Elements the shape alone singles out. */
export interface WuxinLandmarks {
  /**
   * No arrows in or out. Only severing makes one: none of the 1,936 closed
   * configurations has one.
   */
  orphans: string[];
  /**
   * When both relations split into a pair and a triangle on disjoint pairs,
   * the one element left over: in both triangles and in no pair.
   */
  pivot: string | null;
  /** Points at nothing, and both relations point at it. */
  sinks: string[];
  /** Points at both, and nothing points at it. */
  sources: string[];
  /** Both arrows name the same target: it feeds and fights the same element. */
  doubled: string[];
}

export function landmarks(cfg: WuxinConfig): WuxinLandmarks {
  const gen = arrowsOf(cfg, 'nourishes');
  const des = arrowsOf(cfg, 'hinders');
  const pointedBy = (m: Map<string, string | null>, e: string) => cfg.slots.some((s) => m.get(s.element) === e);

  const orphans: string[] = [];
  const sinks: string[] = [];
  const sources: string[] = [];
  const doubled: string[] = [];
  for (const slot of cfg.slots) {
    const e = slot.element;
    const out = (gen.get(e) != null ? 1 : 0) + (des.get(e) != null ? 1 : 0);
    const inGen = pointedBy(gen, e);
    const inDes = pointedBy(des, e);
    if (out === 0 && !inGen && !inDes) orphans.push(e);
    else if (out === 0 && inGen && inDes) sinks.push(e);
    else if (out === 2 && !inGen && !inDes) sources.push(e);
    if (slot.nourishes != null && slot.nourishes === slot.hinders) doubled.push(e);
  }

  return { orphans, pivot: pivotOf(cfg), sinks, sources, doubled };
}

function pivotOf(cfg: WuxinConfig): string | null {
  const pairOf = (relation: WuxinRelation): string[] | null => {
    const two = shapeOf(cfg, relation).cycles.filter((c) => c.length === 2);
    return two.length === 1 ? two[0] : null;
  };
  const g = pairOf('nourishes');
  const d = pairOf('hinders');
  if (!g || !d) return null;
  if (g.some((e) => d.includes(e))) return null; // the pairs must be disjoint
  const spoken = new Set([...g, ...d]);
  const left = cfg.slots.map((s) => s.element).filter((e) => !spoken.has(e));
  return left.length === 1 ? left[0] : null;
}

/**
 * The kind of a cycle, checked in this order:
 *
 * - `sustain`: every destructive arrow is cut.
 * - `burst`: a generative arrow is cut; generation runs down a line.
 * - `tempered`: some destructive arrows are cut, generation intact.
 * - `harmonious`: the classical relation.
 * - `counterflow`: destruction is generation run backwards. Checked before
 *   `split`.
 * - `split`: generation closes as two loops, a pair beside a triangle.
 * - `irregular`: anything else that is closed.
 */
export type WuxinKind = 'harmonious' | 'counterflow' | 'split' | 'burst' | 'sustain' | 'tempered' | 'irregular';

export function classify(cfg: WuxinConfig): WuxinKind {
  const gen = shapeOf(cfg, 'nourishes');
  const des = shapeOf(cfg, 'hinders');
  // Before generation's shape: with nothing destructive left it is a sustain
  // configuration whatever its generative ring looks like.
  if (des.severed === cfg.slots.length) return 'sustain';
  if (gen.severed > 0) return 'burst';
  if (des.severed > 0) return 'tempered';
  if (isHarmonious(cfg)) return 'harmonious';
  if (isCounterflow(cfg)) return 'counterflow';
  if (gen.cycles.length > 1) return 'split';
  return 'irregular';
}
