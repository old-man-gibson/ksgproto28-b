/**
 * Port of old `tests/mutagens.test.ts`. Changed only where the call shape
 * changed: the game is a kernel (`makeGame`), state is set with `patch`, an
 * edit is a command (`mutagens/slot-main` and the rest) that answers
 * `{ ok, reason }`, the harvest is the `combat/kill` event, the bench is
 * `benches/start` and the tick. A pure function that took `GameState` takes
 * the chromosome (`resolveChromosome(chromo)`) or the reads
 * (`mutagenReadsOf(reads(g))`). `priceGeneAbility` takes the stat block and
 * a reader of the target's stacks in place of the target.
 *
 * Cases on parts left behind (README "Left behind") are `it.todo` with the
 * reason: the old save migrations (fresh save, no importer), the shelved
 * basement and its histone recipe, the ability card text of `ui/lib/format`,
 * tongues, refuting, the wind-up, the volley and telekinesis, the fast and
 * the conferred conditions (`syncGeneStatuses`).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { startBench, type BenchesState } from '../src/systems/benches';
import { enemyKilled, playerDamageType } from '../src/systems/combat';
import { qualityMult, MATERIALS, type MaterialsState, type QualityTier } from '../src/systems/materials';
import { MONSTER_TAGS, MONSTERS, monsterTagSet } from '../src/systems/monsters';
import {
  abilityCarries,
  abilityDamage,
  activeEdges,
  applyActiveArm,
  armDelivery,
  armGrants,
  BASELINE_LAYOUT,
  bearerGrants,
  capacityFree,
  capacityLimit,
  capacityUsed,
  chromosomeMods,
  coefficientOf,
  contributionWeight,
  cutCost,
  cutEdge,
  deliveredBy,
  edgeKey,
  establish,
  expressedGene,
  expressedMain,
  fullyConnected,
  fuse,
  FUSE_BIOMATTER,
  FUSED_GRADE,
  fusionOf,
  geneAbility,
  geneAbilityBase,
  geneFrom,
  genomeOf,
  GENERA,
  grantIsLive,
  histoneCost,
  hopDistances,
  isClamped,
  MAIN_BASE_COST,
  MAIN_GENES,
  mainCost,
  mutagenReadsOf,
  mutagensFrom,
  MUTATIONS,
  canRefine,
  nextGrade,
  NUCLEASES,
  nucleasesFrom,
  perTargetInflictIntensity,
  placeMutagen,
  powerRank,
  priceGeneAbility,
  QUALITY_APPROACH,
  reaching,
  refineCost,
  refineRequest,
  REFINE_COPIES,
  rekeyGene,
  removeMutagen,
  resolveChromosome,
  restoreEdge,
  setSkipSettling,
  settlingLeft,
  showsGrade,
  slotMain,
  startingKit,
  swapBiomatterCost,
  SWAP_SETTLE_TICKS,
  unlockMutagens,
  unslotMain,
  weakPointsOf,
  type Chromosome,
  type GeneInstance,
  type MutagensState,
} from '../src/systems/mutagens';
import type { FeedEntry } from '../src/systems/log';
import { BASE_SPEED } from '../src/systems/stats';
import { SPOTS } from '../src/systems/world';
import { combatOf, feedOf, hardenFoes, huntingGame, spawn } from './combatHelpers';
import { ask, equip, giveItem, makeGame, patch, reads, run, setMods, slice } from './helpers';
import oldGenerated from './mutagensGenerated.json';

const fresh = (seed = 1) => makeGame({ seed });
const mut = (g: Kernel) => slice<MutagensState>(g, 'mutagens');
const chromosomeOf = (g: Kernel) => mut(g).chromosome;
const mats = (g: Kernel) => slice<MaterialsState>(g, 'materials');
const stockOf = (g: Kernel, id: string, q: QualityTier) => mats(g).stock[id]?.[q] ?? 0;
const countOf = (g: Kernel, id: string) => mats(g).counts[id] ?? 0;
const rd = (g: Kernel) => mutagenReadsOf(reads(g));

function setCount(g: Kernel, id: string, n: number) {
  patch(g, (s) => {
    s.materials.counts[id] = n;
  });
}

function grantGraded(g: Kernel, id: string, q: QualityTier, n: number) {
  patch(g, (s) => {
    s.materials.stock[id] ??= {};
    s.materials.stock[id][q] = (s.materials.stock[id][q] ?? 0) + n;
  });
}

function setLevel(g: Kernel, level: number) {
  patch(g, (s) => {
    s.skills.skills.geneshaping = { level, xp: 0 };
  });
}

function setChromosome(g: Kernel, c: Chromosome) {
  patch(g, (s) => {
    s.mutagens.chromosome = c;
  });
}

/** A game with mutagens explicitly shut (the system ships open). */
function locked(seed = 1) {
  const g = fresh(seed);
  patch(g, (s) => {
    s.mutagens.unlocked = false;
    s.mutagens.chromosome.established = [];
  });
  return g;
}

const gene = (id: string, quality: QualityTier = 'c'): GeneInstance => ({ id, quality });

/** A fully wired baseline chromosome with a main gene, plus whatever is layered on. */
function chromo(over: Partial<Chromosome> = {}): Chromosome {
  return { ...fullyConnected(), main: gene('hill_giant'), ...over };
}

const cutting = (...pairs: [string, string][]) => pairs.map(([a, b]) => edgeKey(a, b));

/** The single branch that passed through every named socket, in order. */
function branchVia(c: Chromosome, from: string, ...via: string[]) {
  const res = resolveChromosome(c);
  const all = Object.values(res.arms).flatMap((a) => a.contributions);
  return all.find((x) => x.from === from && via.every((v, i) => x.through[i] === v) && x.through.length === via.length);
}

/** Kill the same thing many times, so a low per-kill roll still resolves. The old `grind`. */
function grind(g: Kernel, monsterId: string, times = 400) {
  run(g, (ctx) => {
    for (let i = 0; i < times; i++) {
      ctx.emit(enemyKilled, {
        entity: `test-${i}`,
        defId: monsterId,
        name: monsterId,
        level: 1,
        rewardLevel: 1,
        xp: 0,
        tags: [...monsterTagSet(monsterId)],
        lastHit: null,
        site: 'test',
        boss: false,
        once: false,
      });
    }
  });
}

describe('law 1: routing counts edges, never length', () => {
  it('measures hops topologically while the ring carries the long edges', () => {
    const dist = hopDistances(activeEdges(chromo()));
    expect(dist.g).toBe(1);
    expect(dist.a).toBe(2);
    const long = BASELINE_LAYOUT.edges.find((e) => e.a === 'g' && e.b === '@')!;
    const short = BASELINE_LAYOUT.edges.find((e) => e.a === 'a' && e.b === 'd')!;
    expect(long.length).toBeGreaterThan(short.length);
  });

  it('an unestablished edge is not a route', () => {
    const c = chromo({ established: [] });
    expect(hopDistances(activeEdges(c))['@']).toBe(0);
    expect(hopDistances(activeEdges(c)).g).toBeUndefined();
  });

  it('a cut edge stops carrying, but stays established', () => {
    const c = chromo({ cut: cutting(['g', '@']) });
    expect(activeEdges(c).some((e) => edgeKey(e.a, e.b) === edgeKey('g', '@'))).toBe(false);
    expect(c.established).toContain(edgeKey('g', '@'));
    expect(hopDistances(activeEdges(c)).g).toBe(3);
  });
});

describe('law 1: ties split evenly, and the ring makes that structural', () => {
  it('g and i sit one hop out and deliver whole', () => {
    const arrivals = reaching(resolveChromosome(chromo({ placed: { g: gene('elastic') } })), 'attacks');
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].share).toBe(1);
    expect(arrivals[0].through).toEqual([]);
  });

  it('h is two hops out either way round, so it splits 50:50 into both lower arms', () => {
    const res = resolveChromosome(chromo({ placed: { h: gene('vigorous') } }));
    const attacks = reaching(res, 'attacks');
    const defenses = reaching(res, 'defenses');
    expect(attacks).toHaveLength(1);
    expect(defenses).toHaveLength(1);
    expect(attacks[0].share).toBe(0.5);
    expect(defenses[0].share).toBe(0.5);
    expect(attacks[0].distance).toBe(defenses[0].distance);
  });

  it('splitting costs exactly the halving and nothing more', () => {
    const whole = resolveChromosome(chromo({ placed: { g: gene('vigorous') } }));
    const split = resolveChromosome(chromo({ placed: { h: gene('vigorous') } }));
    const wholeTotal = reaching(whole, 'attacks').reduce((s, c) => s + c.share, 0);
    const splitTotal = Object.values(split.arms)
      .flatMap((a) => a.contributions)
      .reduce((s, c) => s + c.share, 0);
    expect(wholeTotal).toBeCloseTo(1, 10);
    expect(splitTotal).toBeCloseTo(1, 10);
  });

  it('a cut breaks the ring symmetry and makes h deliver whole', () => {
    const res = resolveChromosome(chromo({ placed: { h: gene('vigorous') }, cut: cutting(['h', 'i']) }));
    expect(reaching(res, 'attacks')[0].share).toBe(1);
    expect(reaching(res, 'defenses')).toHaveLength(0);
  });
});

describe('distance buys magnitude, hops buy character', () => {
  it('the ring delivers strong and untouched; the cluster delivers transformed', () => {
    const res = resolveChromosome(chromo({ placed: { g: gene('vigorous'), a: gene('studious') } }));
    const ring = reaching(res, 'attacks')[0];
    const cluster = reaching(res, 'special')[0];
    expect(ring.hops).toBeLessThan(cluster.hops);
    expect(ring.intensity).toBeGreaterThan(cluster.intensity);
    expect(ring.through).toEqual([]);
    expect(cluster.through).toEqual(['d']);
  });

  it('a full upper traversal reaches ×6, the calibration MUTAGENS.md §12 claims', () => {
    const c = chromo({ placed: { e: gene('studious') }, cut: cutting(['d', 'e'], ['f', '@']) });
    const branch = branchVia(c, 'e', 'f', 'c', 'b', 'a', 'd');
    expect(branch).toBeDefined();
    expect(branch!.hops).toBe(6);
    expect(branch!.distance).toBe(18);
    expect(branch!.intensity).toBeCloseTo(6, 10);
    expect(branch!.arm).toBe('special');
  });

  it('two cuts are all the grand tour costs: the price is a silent arm', () => {
    const res = resolveChromosome(chromo({ placed: { e: gene('studious') }, cut: cutting(['d', 'e'], ['f', '@']) }));
    expect(res.arms.active.contributions).toHaveLength(0);
  });
});

describe('law 2: you never write an order, you move things', () => {
  it('the same two mutations in opposite positions are not the same arrival', () => {
    const cut = cutting(['b', 'c']);
    const rimeFirst = chromo({ placed: { b: gene('radiant_edge'), a: gene('rime_edge'), d: gene('searing_edge') }, cut });
    const searFirst = chromo({ placed: { b: gene('radiant_edge'), a: gene('searing_edge'), d: gene('rime_edge') }, cut });
    expect(branchVia(rimeFirst, 'b', 'a', 'd')!.arrived.type).toBe('heat');
    expect(branchVia(searFirst, 'b', 'a', 'd')!.arrived.type).toBe('cold');
  });

  it('the socket nearest the centre gets the last word', () => {
    const c = chromo({
      placed: { b: gene('radiant_edge'), a: gene('rime_edge'), d: gene('searing_edge') },
      cut: cutting(['b', 'c']),
    });
    const branch = branchVia(c, 'b', 'a', 'd')!;
    expect(branch.through).toEqual(['a', 'd']);
    expect(branch.arrived.type).toBe('heat');
  });

  it('a gene does not transform its own effect', () => {
    const arrival = reaching(resolveChromosome(chromo({ placed: { g: gene('rime_edge') } })), 'attacks')[0];
    expect(arrival.through).toEqual([]);
    expect(arrival.arrived.type).toBe('cold');
  });

  it('capabilities accumulate along the way rather than replacing', () => {
    const c = chromo({
      placed: { b: gene('elastic'), a: gene('bouncing'), d: gene('taint_brand') },
      cut: cutting(['b', 'c']),
    });
    expect(branchVia(c, 'b', 'a', 'd')!.arrived.grants).toEqual(
      expect.arrayContaining(['ignores_dodge', 'splits_target', 'inflicts_tainted']),
    );
  });
});

describe('capabilities are free, magnitudes are capped', () => {
  it('a cheap gene reaches every trick', () => {
    const cheap = chromo({ main: gene('hill_giant', 'f'), placed: { g: gene('elastic') } });
    const dear = chromo({ main: gene('jotunn', 's'), placed: { g: gene('elastic') } });
    expect(resolveChromosome(cheap).arms.attacks.grants).toEqual(resolveChromosome(dear).arms.attacks.grants);
    expect(resolveChromosome(cheap).arms.attacks.grants).toContain('ignores_dodge');
  });

  it('but cannot push the numbers as far', () => {
    const cheap = resolveChromosome(chromo({ main: gene('rock_giant', 'f'), placed: { g: gene('vigorous') } }));
    const dear = resolveChromosome(chromo({ main: gene('jotunn', 's'), placed: { g: gene('vigorous') } }));
    expect(cheap.ceiling).toBeLessThan(dear.ceiling);
    expect(cheap.arms.attacks.weight).toBeLessThan(dear.arms.attacks.weight);
  });

  it('the ceiling covers the special arm, where the exploit would live', () => {
    const tour = { placed: { e: gene('studious') }, cut: cutting(['d', 'e'], ['f', '@']) };
    const cheap = resolveChromosome(chromo({ main: gene('hill_giant', 'f'), ...tour }));
    const dear = resolveChromosome(chromo({ main: gene('jotunn', 's'), ...tour }));
    expect(cheap.arms.special.weight).toBeLessThan(dear.arms.special.weight);
    expect(cheap.arms.special.weight).toBeCloseTo(cheap.ceiling, 10);
    expect(dear.arms.special.weight).toBeCloseTo(6, 10);
  });

  it('but a cap that has not been reached does not penalise a cheap gene', () => {
    const cheap = resolveChromosome(chromo({ main: gene('hill_giant', 'f'), placed: { a: gene('studious') } }));
    const dear = resolveChromosome(chromo({ main: gene('jotunn', 's'), placed: { a: gene('studious') } }));
    expect(cheap.arms.special.weight).toBe(dear.arms.special.weight);
    expect(cheap.arms.special.weight).toBeLessThan(cheap.ceiling);
  });
});

describe('tier and quality', () => {
  it('tier buys the ceiling, quality buys the approach', () => {
    expect(coefficientOf(gene('hill_giant', 'f'))).toBeCloseTo(1, 6);
    expect(coefficientOf(gene('hill_giant', 's'))).toBeCloseTo(2, 6);
    expect(coefficientOf(gene('jotunn', 's'))).toBeGreaterThan(coefficientOf(gene('hill_giant', 's')));
  });

  it('the flat term decays and the coefficient rides gear forever', () => {
    const hill = gene('hill_giant', 's');
    const jotunn = gene('jotunn', 'f');
    expect(abilityDamage(jotunn, 10)).toBeGreaterThan(abilityDamage(hill, 10));
    expect(abilityDamage(hill, 2000)).toBeGreaterThan(abilityDamage(jotunn, 2000));
  });

  it('at two grades a step, a B reads level with a D one tier up', () => {
    expect(powerRank(gene('wyrmling', 'b'))).toBeCloseTo(powerRank(gene('drake', 'd')), 10);
  });

  it('a wider genus makes the same two grades worth less of a tier', () => {
    expect(powerRank(gene('hill_giant', 'b'))).toBeLessThan(powerRank(gene('jotunn', 'd')));
  });

  it('a unique is out of reach of anything more than a tier below it', () => {
    expect(powerRank(gene('forest_giant', 's'))).toBeLessThan(powerRank(gene('balor', 'f')));
    expect(powerRank(gene('jotunn', 's'))).toBeLessThan(powerRank(gene('surtr', 'f')));
    expect(coefficientOf(gene('balor', 'f'))).toBeGreaterThan(coefficientOf(gene('forest_giant', 's')));
    expect(coefficientOf(gene('surtr', 'f'))).toBeGreaterThan(coefficientOf(gene('jotunn', 's')));
    expect(coefficientOf(gene('balor', 'c'))).toBeGreaterThan(coefficientOf(gene('storm_giant', 'c')));
  });

  it('the debug settling skip is a module flag, never save state', () => {
    const g = fresh();
    patch(g, (s) => {
      s.mutagens.settleUntil = s.clock.totalTicks + SWAP_SETTLE_TICKS;
    });
    expect(settlingLeft(rd(g))).toBeGreaterThan(0);
    setSkipSettling(true);
    try {
      expect(settlingLeft(rd(g))).toBe(0);
      expect(mut(g).settleUntil).toBeGreaterThan(rd(g).now);
    } finally {
      setSkipSettling(false);
    }
    expect(settlingLeft(rd(g))).toBeGreaterThan(0);
  });

  it('a unique variant keeps its parent species’ capabilities exactly', () => {
    expect(MAIN_GENES.balor.grants).toEqual(MAIN_GENES.fomorian.grants);
    expect(MAIN_GENES.balor.size).toBe(MAIN_GENES.fomorian.size);
  });

  it('F is weak here, never harmful: the documented divergence', () => {
    expect(qualityMult('f')).toBeLessThan(0);
    expect(QUALITY_APPROACH.f).toBeGreaterThan(0);
    expect(coefficientOf(gene('hill_giant', 'f'))).toBeGreaterThan(0);
    expect(abilityDamage(gene('hill_giant', 'f'), 100)).toBeGreaterThan(0);
  });
});

describe('capacity', () => {
  it('cost grows faster than power as you climb', () => {
    const powerRatio = 400 / 200;
    expect(mainCost(gene('jotunn')) / mainCost(gene('hill_giant'))).toBeGreaterThan(powerRatio);
  });

  it('is anchored to measured power, not to the ordinal tier index', () => {
    expect(mainCost(gene('dvibahu'))).toBeLessThan(mainCost(gene('drake')));
    expect(mainCost(gene('asura'))).toBeGreaterThan(mainCost(gene('drake')));
  });

  it('F is the cheapest grade and S carries a slight surcharge', () => {
    const f = mainCost(gene('hill_giant', 'f'));
    const c = mainCost(gene('hill_giant', 'c'));
    const s = mainCost(gene('hill_giant', 's'));
    expect(f).toBeLessThan(c);
    expect(s).toBeGreaterThan(c);
    expect(s / c).toBeLessThan(mainCost(gene('jotunn')) / mainCost(gene('hill_giant')));
  });

  it('cuts compound, so a heavily sculpted graph bites', () => {
    const first = cutCost(1) - cutCost(0);
    const second = cutCost(2) - cutCost(1);
    const third = cutCost(3) - cutCost(2);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('accounts for the gene, the mutations and the cuts separately', () => {
    const use = capacityUsed(chromo({ placed: { g: gene('vigorous'), a: gene('studious') }, cut: cutting(['h', 'i']) }));
    expect(use.main).toBeGreaterThan(0);
    expect(use.mutations).toBeGreaterThan(0);
    expect(use.cuts).toBeGreaterThan(0);
    expect(use.total).toBeCloseTo(use.main + use.mutations + use.cuts, 10);
  });

  it('a refined low tier is cheaper than a raw high tier of the same output', () => {
    expect(mainCost(gene('hill_giant', 's'))).toBeLessThan(mainCost(gene('jotunn', 'f')));
  });
});

describe('the parts that must not contribute', () => {
  it('a gene with no live route to the centre is stranded and silent', () => {
    const res = resolveChromosome(chromo({ placed: { e: gene('studious') }, cut: cutting(['d', 'e'], ['e', 'f']) }));
    expect(res.stranded).toEqual(['e']);
    expect(Object.values(res.arms).every((a) => a.contributions.length === 0)).toBe(true);
  });

  it('an empty socket contributes nothing and is not stranded', () => {
    const res = resolveChromosome(chromo());
    expect(res.stranded).toEqual([]);
    expect(Object.values(res.arms).every((a) => a.contributions.length === 0)).toBe(true);
  });

  it('a main gene still carries its base effects with nothing routed in', () => {
    const res = resolveChromosome(chromo({ main: gene('hill_giant') }));
    expect(res.arms.defenses.base).toBeDefined();
    expect(res.arms.defenses.base!.map((m) => m.stat)).toContain('resBludgeoning');
    expect(res.arms.special!.base!.map((m) => m.stat)).toContain('maxHp');
  });

  it('an empty centromere expresses bare rather than nothing', () => {
    const res = resolveChromosome(chromo({ main: null }));
    expect(expressedMain(chromo({ main: null })).id).toBe('bare');
    expect(res.main!.id).toBe('bare');
    expect(res.ceiling).toBeGreaterThan(0);
  });

  it('so effects routed at an unfilled centromere land instead of evaporating', () => {
    const res = resolveChromosome(chromo({ main: null, placed: { g: gene('vigorous') } }));
    expect(res.arms.attacks.contributions).toHaveLength(1);
    expect(res.arms.attacks.weight).toBeGreaterThan(0);
  });

  it('the floor is free: bare costs no capacity', () => {
    expect(capacityUsed(chromo({ main: null })).main).toBe(0);
  });

  it('bare is not a thing you can hold', () => {
    expect(MATERIALS.bare).toBeUndefined();
    expect(MAIN_GENES.bare).toBeDefined();
  });

  it('bare has all four arms populated but no headline ability', () => {
    const res = resolveChromosome(chromo({ main: gene('bare') }));
    expect(res.main!.ability).toBeUndefined();
    expect(res.main!.writesAttributes).toBe(true);
    for (const arm of ['attacks', 'defenses', 'active', 'special'] as const) {
      expect(res.arms[arm].base?.length).toBeGreaterThan(0);
    }
  });

  it('bare is held at C but never shows a grade', () => {
    expect(showsGrade(gene('bare'))).toBe(false);
    expect(showsGrade(gene('hill_giant'))).toBe(true);
    expect(mainCost(gene('bare', 'c'))).toBeCloseTo(MAIN_BASE_COST * 0.4, 10);
  });
});

describe('content coherence', () => {
  const droppable = () => Object.values(MUTATIONS).filter((m) => !m.rekey);
  const carried = () => new Set(Object.values(MONSTERS).flatMap((d) => [...monsterTagSet(d.id)]));

  it('every mutagen keys on a real monster tag', () => {
    for (const m of droppable()) {
      expect(m.from, `mutagen ${m.id} declares no source tag`).toBeTruthy();
      expect(MONSTER_TAGS[m.from!], `mutagen ${m.id}: '${m.from}' is not a monster tag`).toBeDefined();
    }
  });

  it('every mutagen tag is actually carried by some monster', () => {
    const live = carried();
    for (const m of droppable()) expect(live.has(m.from!), `mutagen ${m.id}: nothing alive carries '${m.from}'`).toBe(true);
  });

  it('a fused mutagen declares no source, because nothing drops one', () => {
    const fused = Object.values(MUTATIONS).filter((m) => m.rekey);
    expect(fused.length).toBeGreaterThan(0);
    for (const m of fused) {
      expect(m.from, `${m.id} must not be findable`).toBeUndefined();
      expect(m.effect, `${m.id} kept an effect`).toBeUndefined();
      expect(m.transform, `${m.id} kept a transform`).toBeUndefined();
    }
  });

  it('every nuclease keys on a tag something actually carries', () => {
    const live = carried();
    for (const n of Object.values(NUCLEASES)) {
      expect(MONSTER_TAGS[n.from!], `nuclease ${n.id}: '${n.from}' is not a monster tag`).toBeDefined();
      expect(live.has(n.from!), `nuclease ${n.id}: nothing alive carries '${n.from}'`).toBe(true);
    }
  });

  it('the culture bench stands somewhere', () => {
    // Old main: the shelved basement and the Vivarium. The basement is
    // shelved content (not ported); the Vivarium of Alembic Row stands here.
    const homes = Object.values(SPOTS).filter((s) => (s.benches ?? []).includes('mutagens'));
    expect(homes.map((s) => s.id)).toContain('the_vivarium');
  });
  it.todo('the basement hosts the culture bench beside the slimes: shelved content, not ported');

  it('at least one genus is fully reachable today', () => {
    const reachable = Object.values(GENERA).filter((genus) => genus.tiers.every((id) => MONSTERS[MAIN_GENES[id]?.from ?? '']));
    expect(reachable.map((g) => g.id)).toContain('slimoid');
  });

  it('every genus lists its tiers in order and they exist', () => {
    for (const genus of Object.values(GENERA)) {
      let last = -1;
      for (const id of genus.tiers) {
        const def = MAIN_GENES[id];
        expect(def, `genus ${genus.id} names a missing gene '${id}'`).toBeDefined();
        expect(def.tier).toBeGreaterThanOrEqual(last);
        expect(def.genus).toBe(genus.id);
        last = def.tier;
      }
    }
  });

  it('sidegrades read as equals, not as a ladder', () => {
    expect(powerRank(gene('slime_guardian_gene', 'c'))).toBe(powerRank(gene('slime_golem_gene', 'c')));
    expect(mainCost(gene('slime_guardian_gene'))).toBeCloseTo(mainCost(gene('slime_golem_gene')), 6);
    expect(powerRank(gene('slime_gene', 'c'))).toBe(powerRank(gene('fire_slime_gene', 'c')));
  });

  it('cost anchors on the weakest species, not the first listed', () => {
    const bottom = mainCost(gene('slime_gene', 'c'));
    for (const id of GENERA.slimoid.tiers) {
      expect(mainCost(gene(id, 'c')), `${id} cheaper than the bottom rung`).toBeGreaterThanOrEqual(bottom - 1e-9);
    }
  });

  it('every slimoid species points at a monster that exists', () => {
    for (const id of GENERA.slimoid.tiers) {
      expect(MONSTERS[MAIN_GENES[id].from ?? ''], `${id} has no species to drop it`).toBeDefined();
    }
  });

  it('generates the same element blocks and fused mutagens as the old module (new test)', () => {
    const hand = new Set(['chill', 'ember', 'crystal', 'tainting', 'resonance', 'catalyst', 'elastic', 'bouncing', 'vigorous', 'studious', 'fleet']);
    const generated = Object.values(MUTATIONS).filter((m) => !hand.has(m.id));
    expect(JSON.parse(JSON.stringify(generated))).toEqual(oldGenerated);
    // Every generated id is a material, so it can be held.
    for (const m of Object.values(MUTATIONS)) expect(MATERIALS[m.id], m.id).toBeDefined();
  });
});

describe('save migration', () => {
  it.todo('an old save arrives with the starting kit: no importer from the old save (fresh save at version 1)');
  it.todo('a returning character gets exactly what a new one gets: no importer');
  it.todo('opens a v34 save that was already saved shut: no importer');
  it.todo('leaves a chromosome somebody has already built alone: no importer');

  it('a fresh slice has the kit and nothing catalogued', () => {
    const m = mut(fresh());
    expect(m.chromosome.main).toBeNull();
    expect(m.chromosome.established).toEqual(startingKit());
    expect(m.known).toEqual({ genes: [], mutagens: [] });
  });
});

describe('opening the system', () => {
  it('ships OPEN for now, with the kit already granted', () => {
    const g = fresh();
    expect(mut(g).unlocked).toBe(true);
    expect(chromosomeOf(g).established).toEqual(startingKit());
  });

  it('the starting kit is a centromere and exactly two arms', () => {
    const g = locked();
    expect(g.dispatch(unlockMutagens({ lowerArm: 'i' })).ok).toBe(true);
    const c = chromosomeOf(g);
    expect(c.established).toHaveLength(2);
    expect(c.established).toContain(edgeKey('d', '@'));
    expect(c.established).toContain(edgeKey('i', '@'));
    expect(c.main).toBeNull();
  });

  it('the lower arm is a real choice between attacks and defenses', () => {
    const a = locked();
    a.dispatch(unlockMutagens({ lowerArm: 'g' }));
    const b = locked();
    b.dispatch(unlockMutagens({ lowerArm: 'i' }));
    expect(chromosomeOf(a).established).toContain(edgeKey('g', '@'));
    expect(chromosomeOf(b).established).toContain(edgeKey('i', '@'));
  });

  it('unlocking twice does not re-grant the kit', () => {
    const g = locked();
    g.dispatch(unlockMutagens({}));
    g.dispatch(cutEdge({ a: 'd', b: '@' }));
    // Old: a silent return. Here the refusal says why.
    expect(g.dispatch(unlockMutagens({})).ok).toBe(false);
    expect(chromosomeOf(g).cut).toHaveLength(1);
  });
});

describe('acquisition', () => {
  it('drops nothing at all while the system is shut', () => {
    const g = locked();
    grind(g, 'slime_base_basic');
    expect(countOf(g, 'biomatter')).toBe(0);
    expect(mats(g).stock.slime_gene).toBeUndefined();
    expect(mut(g).known.genes).toEqual([]);
  });

  it('genes key on the species, so only its own kill yields it', () => {
    expect(geneFrom('slime_base_basic')?.id).toBe('slime_gene');
    expect(geneFrom('slime_base_elite')?.id).toBe('slimest_gene');
    expect(geneFrom('wolf')).toBeUndefined();
  });

  it('mutagens key on tags, so unrelated species share them', () => {
    const fromSlime = mutagensFrom(monsterTagSet('slime_fire')).map((m) => m.id);
    const fromRat = mutagensFrom(monsterTagSet('forest_rat')).map((m) => m.id);
    expect(fromSlime).toEqual(expect.arrayContaining(['elastic', 'ember']));
    expect(fromRat).toContain('vigorous');
    expect(fromRat).not.toContain('elastic');
  });

  it('once open, a species hands over its gene and its tags hand over mutagens', () => {
    const g = fresh();
    grind(g, 'slime_fire');
    expect(countOf(g, 'biomatter')).toBeGreaterThan(0);
    expect(mut(g).known.mutagens).toEqual(expect.arrayContaining(['elastic', 'ember']));
    expect(mut(g).known.genes).toEqual(['fire_slime_gene']);
  });

  it('a species that carries no gene still hands over its tag mutagens', () => {
    const g = fresh();
    grind(g, 'cave_spider', 800);
    expect(mut(g).known.mutagens).toEqual(expect.arrayContaining(['bouncing', 'tainting']));
    expect(geneFrom('cave_spider')).toBeUndefined();
    expect(mut(g).known.genes).toEqual([]);
  });

  it('the slimoid line is collectable from the species that exist', () => {
    const g = fresh();
    grind(g, 'slime_base_basic', 800);
    expect(mut(g).known.genes).toContain('slime_gene');
    expect(Object.keys(mats(g).stock)).toContain('slime_gene');
  });

  it('a find only ever pays discovery once', () => {
    const g = fresh();
    grind(g, 'forest_rat', 800);
    const entries = mut(g).known.mutagens;
    expect(entries).toContain('vigorous');
    expect(entries.filter((id) => id === 'vigorous')).toHaveLength(1);
  });

  it('the floor 6 species carry the nuclease and the slime gene (new test)', () => {
    // The undead tag of the Zombie Slime carries the nuclease.
    expect(nucleasesFrom(monsterTagSet('slime_zombie')).map((n) => n.id)).toContain('vuln');
    expect(geneFrom('slime_base_basic')).toBeDefined();
  });
});

describe('refinement', () => {
  function stocked(quality: QualityTier = 'c', copies = REFINE_COPIES, biomatter = 500) {
    const g = fresh();
    grantGraded(g, 'slime_gene', quality, copies);
    setCount(g, 'biomatter', biomatter);
    return g;
  }
  const refine = (g: Kernel, id: string, q: QualityTier) => ask(g, refineRequest, { placement: { subject: { id, quality: q } } });

  it('pushes a grade up by consuming copies and biomatter', () => {
    const g = stocked('c');
    const before = countOf(g, 'biomatter');
    expect(refine(g, 'slime_gene', 'c')).toBe(true);
    expect(stockOf(g, 'slime_gene', 'c')).toBe(0);
    expect(stockOf(g, 'slime_gene', 'b')).toBe(1);
    expect(countOf(g, 'biomatter')).toBeLessThan(before);
  });

  it('never touches tier: a refined slime gene is still a slime gene', () => {
    const g = stocked('c');
    refine(g, 'slime_gene', 'c');
    expect(MAIN_GENES.slime_gene.tier).toBe(0);
    expect(stockOf(g, 'slimer_gene', 'b')).toBe(0);
  });

  it('refuses without enough copies, and spends nothing when it does', () => {
    const g = stocked('c', 1);
    const before = countOf(g, 'biomatter');
    expect(refine(g, 'slime_gene', 'c')).toBe(false);
    expect(stockOf(g, 'slime_gene', 'c')).toBe(1);
    expect(countOf(g, 'biomatter')).toBe(before);
  });

  it('refuses without enough biomatter', () => {
    const g = stocked('c', REFINE_COPIES, 0);
    expect(canRefine(rd(g), 'slime_gene', 'c').ok).toBe(false);
    expect(refine(g, 'slime_gene', 'c')).toBe(false);
  });

  it('refuses entirely while the system is shut', () => {
    const g = locked();
    grantGraded(g, 'slime_gene', 'c', 4);
    setCount(g, 'biomatter', 500);
    expect(canRefine(rd(g), 'slime_gene', 'c').ok).toBe(false);
  });

  it('gets steeper the closer to the top', () => {
    expect(refineCost('b')).toBeGreaterThan(refineCost('d'));
    expect(refineCost('s')).toBeGreaterThan(refineCost('a'));
  });

  it('stops at Divine', () => {
    const g = stocked('s');
    expect(nextGrade('s')).toBeNull();
    expect(refine(g, 'slime_gene', 's')).toBe(false);
  });
});

describe('refinement on the bench clock', () => {
  function bench(copies = 4, biomatter = 500) {
    const g = fresh();
    grantGraded(g, 'slime_gene', 'c', copies);
    setCount(g, 'biomatter', biomatter);
    patch(g, (s) => {
      s.world.spot = 'the_vivarium';
    });
    return g;
  }
  const subject = { subject: { id: 'slime_gene', quality: 'c' as QualityTier } };
  const job = (g: Kernel) => slice<BenchesState>(g, 'benches').job;
  const start = (g: Kernel, count: number | null) => g.dispatch(startBench({ discipline: 'mutagens', placement: subject, count }));

  it('a gene is a material, so it stocks and slots like anything else', () => {
    expect(MATERIALS.slime_gene?.graded).toBe(true);
    expect(MATERIALS.slime_gene?.craftTags).toContain('gene');
    expect(MATERIALS.chill?.craftTags).toContain('mutagen');
  });

  it('runs as a timed job rather than resolving on the click', () => {
    const g = bench();
    expect(start(g, 1).ok).toBe(true);
    expect(job(g)).not.toBeNull();
    expect(stockOf(g, 'slime_gene', 'b')).toBe(0);
    for (let i = 0; i < 400 && job(g); i++) g.tick();
    expect(stockOf(g, 'slime_gene', 'b')).toBe(1);
    expect(job(g)).toBeNull();
  });

  it('takes real time: the subject is not refined on the first tick', () => {
    const g = bench();
    start(g, 1);
    g.tick();
    expect(stockOf(g, 'slime_gene', 'c')).toBe(4);
    expect(job(g)!.ticksLeft).toBeLessThan(job(g)!.ticksPer);
  });

  it('refuses to start on a subject that cannot be refined', () => {
    const g = bench(1);
    expect(start(g, 1).ok).toBe(false);
    expect(job(g)).toBeNull();
  });

  it('stops itself once the grade it was working runs out', () => {
    const g = bench(4);
    start(g, null);
    for (let i = 0; i < 2000 && job(g); i++) g.tick();
    expect(job(g)).toBeNull();
    expect(stockOf(g, 'slime_gene', 'c')).toBe(0);
    expect(stockOf(g, 'slime_gene', 'b')).toBe(2);
  });

  it('walking away abandons the culture', () => {
    const g = bench();
    start(g, 1);
    patch(g, (s) => {
      s.world.spot = 'the_alembics';
    });
    g.tick();
    expect(job(g)).toBeNull();
    expect(stockOf(g, 'slime_gene', 'c')).toBe(4);
  });
});

describe('capacity is enforced on every edit', () => {
  function opened(level = 0) {
    const g = fresh();
    if (level) setLevel(g, level);
    setCount(g, 'biomatter', 5000);
    return g;
  }
  const settled = (g: Kernel) =>
    patch(g, (s) => {
      s.mutagens.settleUntil = 0;
    });

  it('grows with the skill', () => {
    expect(capacityLimit(rd(opened(20)))).toBeGreaterThan(capacityLimit(rd(opened())));
  });

  it('refuses a gene that will not fit, and changes nothing when it does', () => {
    const g = opened();
    grantGraded(g, 'jotunn', 's', 1);
    expect(g.dispatch(slotMain(gene('jotunn', 's'))).ok).toBe(false);
    expect(chromosomeOf(g).main).toBeNull();
    expect(stockOf(g, 'jotunn', 's')).toBe(1);
  });

  it('takes a gene it can afford, and hands the old one back', () => {
    const g = opened(40);
    grantGraded(g, 'slime_gene', 'c', 1);
    grantGraded(g, 'slimer_gene', 'c', 1);
    expect(g.dispatch(slotMain(gene('slime_gene'))).ok).toBe(true);
    expect(stockOf(g, 'slime_gene', 'c')).toBe(0);
    expect(g.dispatch(slotMain(gene('slimer_gene'))).ok).toBe(false);
    settled(g);
    expect(g.dispatch(slotMain(gene('slimer_gene'))).ok).toBe(true);
    expect(stockOf(g, 'slime_gene', 'c')).toBe(1);
    expect(chromosomeOf(g).main!.id).toBe('slimer_gene');
  });

  it('will not place a mutagen you do not hold, or in a socket that is not there', () => {
    const g = opened(40);
    expect(g.dispatch(placeMutagen({ socket: 'g', id: 'vigorous', quality: 'c' })).ok).toBe(false);
    grantGraded(g, 'vigorous', 'c', 1);
    expect(g.dispatch(placeMutagen({ socket: 'zz', id: 'vigorous', quality: 'c' })).ok).toBe(false);
    expect(g.dispatch(placeMutagen({ socket: 'g', id: 'vigorous', quality: 'c' })).ok).toBe(true);
  });

  it('removing a mutagen returns it to stock', () => {
    const g = opened(40);
    grantGraded(g, 'vigorous', 'c', 1);
    g.dispatch(placeMutagen({ socket: 'g', id: 'vigorous', quality: 'c' }));
    expect(stockOf(g, 'vigorous', 'c')).toBe(0);
    expect(g.dispatch(removeMutagen({ socket: 'g' })).ok).toBe(true);
    expect(stockOf(g, 'vigorous', 'c')).toBe(1);
  });

  it('establishing is permanent and only along real edges', () => {
    const g = opened(40);
    setCount(g, 'histone', 100);
    expect(g.dispatch(establish({ a: 'a', b: 'i' })).ok).toBe(false);
    expect(g.dispatch(establish({ a: 'a', b: 'd' })).ok).toBe(true);
    expect(g.dispatch(establish({ a: 'a', b: 'd' })).ok).toBe(false);
  });

  it.todo('spooling histones teaches geneshaping and nothing else: the histone recipe stands only at the shelved basement');

  it('a connection costs histones, and refuses without them', () => {
    const g = opened(40);
    setCount(g, 'histone', 2);
    const check = g.dispatch(establish({ a: 'a', b: 'd' }));
    expect(check.ok).toBe(false);
    expect(check.ok ? '' : check.reason).toMatch(/histones/);
    expect(chromosomeOf(g).established).not.toContain(edgeKey('a', 'd'));
  });

  it('spends exactly what it quoted', () => {
    const g = opened(40);
    setCount(g, 'histone', 50);
    const edge = BASELINE_LAYOUT.edges.find((e) => edgeKey(e.a, e.b) === edgeKey('a', 'd'))!;
    expect(g.dispatch(establish({ a: 'a', b: 'd' })).ok).toBe(true);
    expect(countOf(g, 'histone')).toBe(50 - histoneCost(edge));
  });

  it('long edges cost more, so the premium geography is actually premium', () => {
    const ring = BASELINE_LAYOUT.edges.find((e) => edgeKey(e.a, e.b) === edgeKey('g', '@'))!;
    const cluster = BASELINE_LAYOUT.edges.find((e) => edgeKey(e.a, e.b) === edgeKey('a', 'd'))!;
    expect(ring.length).toBeGreaterThan(cluster.length);
    expect(histoneCost(ring)).toBeGreaterThan(histoneCost(cluster));
    expect(histoneCost(ring) / histoneCost(cluster)).toBeCloseTo(ring.length / cluster.length, 1);
  });

  it('cutting reserves capacity and restoring hands it back', () => {
    const g = opened(40);
    const before = capacityFree(rd(g));
    expect(g.dispatch(cutEdge({ a: 'd', b: '@' })).ok).toBe(true);
    expect(capacityFree(rd(g))).toBeLessThan(before);
    expect(g.dispatch(restoreEdge({ a: 'd', b: '@' })).ok).toBe(true);
    expect(capacityFree(rd(g))).toBeCloseTo(before, 10);
  });

  it('cannot cut what was never established', () => {
    expect(opened(40).dispatch(cutEdge({ a: 'a', b: 'b' })).ok).toBe(false);
  });

  it('rewriting the centromere costs biomatter, scaled by what you put on', () => {
    const g = opened(40);
    grantGraded(g, 'slime_gene', 'c', 1);
    grantGraded(g, 'jotunn', 'c', 1);
    expect(swapBiomatterCost(gene('jotunn'))).toBeGreaterThan(swapBiomatterCost(gene('slime_gene')));
    const before = countOf(g, 'biomatter');
    expect(g.dispatch(slotMain(gene('slime_gene'))).ok).toBe(true);
    expect(countOf(g, 'biomatter')).toBe(before - swapBiomatterCost(gene('slime_gene')));
  });

  it('refuses without the biomatter, and spends nothing when it does', () => {
    const g = opened(40);
    grantGraded(g, 'slime_gene', 'c', 1);
    setCount(g, 'biomatter', 0);
    const check = g.dispatch(slotMain(gene('slime_gene')));
    expect(check.ok).toBe(false);
    expect(check.ok ? '' : check.reason).toMatch(/biomatter/);
    expect(chromosomeOf(g).main).toBeNull();
    expect(stockOf(g, 'slime_gene', 'c')).toBe(1);
  });

  it('you cannot shrug a body off mid-fight and put it back after', () => {
    const g = opened(40);
    grantGraded(g, 'slime_gene', 'c', 1);
    g.dispatch(slotMain(gene('slime_gene')));
    settled(g);
    const held = countOf(g, 'biomatter');
    expect(g.dispatch(unslotMain()).ok).toBe(true);
    expect(countOf(g, 'biomatter')).toBe(held);
    expect(settlingLeft(rd(g))).toBeGreaterThan(0);
    expect(g.dispatch(slotMain(gene('slime_gene'))).ok).toBe(false);
  });

  it('the live resolution reflects what is actually worn', () => {
    const g = opened(40);
    grantGraded(g, 'slime_gene', 'c', 1);
    grantGraded(g, 'vigorous', 'c', 1);
    g.dispatch(slotMain(gene('slime_gene')));
    g.dispatch(placeMutagen({ socket: 'g', id: 'vigorous', quality: 'c' }));
    const res = resolveChromosome(chromosomeOf(g));
    expect(res.main!.id).toBe('slime_gene');
    expect(res.arms.attacks.contributions).toHaveLength(1);
    // Every edit touched the source (new check: the kernel's stale test).
    expect(g.staleStats()).toEqual([]);
  });
});

describe('legibility', () => {
  it('every arrival can explain how it got there', () => {
    const branch = branchVia(chromo({ placed: { b: gene('radiant_edge'), a: gene('rime_edge') }, cut: cutting(['b', 'c']) }), 'b', 'a', 'd')!;
    expect(branch.notes.join(' ')).toMatch(/passes through a/);
    expect(branch.notes.join(' ')).toMatch(/arrives at the special arm/);
  });

  it('a split says so', () => {
    const arrival = reaching(resolveChromosome(chromo({ placed: { h: gene('vigorous') } })), 'attacks')[0];
    expect(arrival.notes.join(' ')).toMatch(/ties 2 ways/);
  });
});

describe('what an arm actually delivers', () => {
  it('scales a route by distance and by the splits it took', () => {
    const res = resolveChromosome(chromo({ placed: { i: gene('vigorous') } }));
    const [route] = reaching(res, 'defenses');
    expect(contributionWeight(route, res.ceiling)).toBeCloseTo(3);
    expect(deliveredBy(route, res.ceiling)[0].value).toBeCloseTo(0.08 * 0.75 * 3);
  });

  it('is capped by the gene, not by the graph', () => {
    const res = resolveChromosome(chromo({ main: gene('slime_gene', 'f'), placed: { i: gene('vigorous') } }));
    const [route] = reaching(res, 'defenses');
    expect(isClamped(route, res.ceiling)).toBe(true);
    expect(contributionWeight(route, res.ceiling)).toBeCloseTo(res.ceiling);
    expect(deliveredBy(route, res.ceiling)[0].value).toBeCloseTo(0.08 * 0.75 * res.ceiling);
  });

  it('compounds several routes the way the stat pipeline compounds them', () => {
    const res = resolveChromosome(chromo({ placed: { g: gene('vigorous'), j: gene('vigorous') } }));
    const total = armDelivery(res, 'attacks').mods.find((m) => m.stat === 'maxHp');
    const parts = reaching(res, 'attacks').flatMap((r) => deliveredBy(r, res.ceiling));
    expect(parts.length).toBeGreaterThan(1);
    expect(total!.value).toBeCloseTo(parts.reduce((n, m) => (1 + n) * (1 + m.value) - 1, 0));
  });

  it('never folds two modifiers that apply under different conditions', () => {
    const attacks = resolveChromosome(chromo({ main: gene('troll'), placed: {} })).arms.attacks.base!;
    expect(attacks).toHaveLength(2);
    expect(attacks[0].fromStat).toBe('resBludgeoning');
    expect(attacks[1].requiresTag).toBe('bone');
  });

  it('shows exactly what the stat pipeline consumes', () => {
    const g = fresh();
    setLevel(g, 40);
    setCount(g, 'biomatter', 5000);
    grantGraded(g, 'troll', 'c', 1);
    grantGraded(g, 'vigorous', 'c', 1);
    grantGraded(g, 'chill', 'c', 1);
    expect(g.dispatch(slotMain(gene('troll'))).ok).toBe(true);
    patch(g, (s) => {
      s.mutagens.chromosome.established = BASELINE_LAYOUT.edges.map((e) => edgeKey(e.a, e.b));
    });
    g.dispatch(placeMutagen({ socket: 'i', id: 'vigorous', quality: 'c' }));
    g.dispatch(placeMutagen({ socket: 'a', id: 'chill', quality: 'c' }));
    const res = resolveChromosome(chromosomeOf(g));
    const routed = chromosomeMods(res)
      .filter((x) => x.source.includes('→'))
      .map((x) => x.mod);
    const drawn = Object.values(res.arms).flatMap((arm) => arm.contributions.flatMap((c) => deliveredBy(c, res.ceiling)));
    expect(routed.length).toBeGreaterThan(0);
    expect(drawn).toEqual(routed);
    // And the kernel's list holds those very values, under the same labels.
    const fromSource = g.modifiers(PLAYER).filter((m) => ((m as unknown as { source?: string }).source ?? '').includes('→'));
    expect(fromSource.map((m) => m.value)).toEqual(routed.map((m) => m.value));
    expect(g.staleStats()).toEqual([]);
  });

  it('knows which capabilities the game reads, and WHERE', () => {
    for (const arm of ['active', 'attacks'] as const) {
      expect(grantIsLive('splits_target', arm)).toBe(true);
      expect(grantIsLive('ignores_dodge', arm)).toBe(true);
    }
    for (const arm of ['defenses', 'special'] as const) {
      expect(grantIsLive('splits_target', arm)).toBe(false);
      expect(grantIsLive('ignores_dodge', arm)).toBe(false);
    }
    expect(grantIsLive('inflicts_tainted', 'active')).toBe(true);
    for (const arm of ['attacks', 'defenses', 'special'] as const) expect(grantIsLive('inflicts_tainted', arm)).toBe(false);
    for (const arm of ['active', 'attacks', 'defenses', 'special'] as const) {
      expect(grantIsLive('arms:+2', arm)).toBe(true);
      expect(grantIsLive('onehand:*', arm)).toBe(true);
    }
    expect(grantIsLive('inflicts_nonsense', 'active')).toBe(false);
  });

  it('makes a mutagen worth refining, which it once was not', () => {
    const value = (c: Chromosome) => {
      const res = resolveChromosome(c);
      return deliveredBy(reaching(res, 'defenses')[0], res.ceiling)[0].value;
    };
    const worst = chromo({ placed: { i: gene('vigorous', 'f') } });
    const best = chromo({ placed: { i: gene('vigorous', 's') } });
    expect(value(best)).toBeGreaterThan(value(worst));
    expect(value(worst)).toBeGreaterThan(0);
    expect(value(worst) / value(best)).toBeCloseTo(0.5);
  });

  it('leaves capabilities alone, however cheap the mutagen', () => {
    const worst = resolveChromosome(chromo({ placed: { g: gene('bouncing', 'f') } }));
    const best = resolveChromosome(chromo({ placed: { g: gene('bouncing', 's') } }));
    expect(worst.arms.attacks.grants).toEqual(best.arms.attacks.grants);
  });

  it('counts a route that carries nothing but a capability', () => {
    const got = armDelivery(resolveChromosome(chromo({ placed: { g: gene('bouncing') } })), 'attacks');
    expect(got.mods).toHaveLength(0);
    expect(got.silent).toBe(1);
    expect(got.grants).toContain('splits_target');
  });
});

describe('amplifiers', () => {
  const only = (c: Chromosome, arm: 'attacks' | 'defenses' | 'special' | 'active') => {
    const res = resolveChromosome(c);
    const route = reaching(res, arm)[0];
    return { res, route, weight: contributionWeight(route, res.ceiling) };
  };

  it('a conduit multiplies what passes through it and contributes nothing itself', () => {
    const plain = chromo({ placed: { j: gene('vigorous'), g: gene('vigorous') } });
    const piped = chromo({ placed: { j: gene('vigorous'), g: gene('resonance') } });
    const own = reaching(resolveChromosome(piped), 'attacks').find((r) => r.from === 'g');
    expect(own && deliveredBy(own, resolveChromosome(piped).ceiling)).toHaveLength(0);
    const through = (c: Chromosome) => reaching(resolveChromosome(c), 'attacks').find((r) => r.from === 'j')!;
    expect(through(piped).gain).toBeGreaterThan(through(plain).gain);
    expect(through(plain).gain).toBe(1);
  });

  it('a catalyst raises what its route runs INTO, not what passes through it', () => {
    const plain = chromo({ placed: { g: gene('vigorous') } });
    const fed = chromo({ placed: { g: gene('vigorous'), j: gene('catalyst') } });
    expect(only(fed, 'attacks').route.gain).toBeGreaterThan(only(plain, 'attacks').route.gain);
    expect(only(fed, 'attacks').route.from).toBe('g');
  });

  it('a catalyst pointed at the centromere helps nobody', () => {
    expect(only(chromo({ placed: { g: gene('catalyst'), i: gene('vigorous') } }), 'defenses').route.gain).toBe(1);
  });

  it('amplifiers compound through each other', () => {
    const one = chromo({ placed: { d: gene('vigorous'), a: gene('catalyst') } });
    const two = chromo({ placed: { d: gene('vigorous'), a: gene('catalyst'), b: gene('catalyst') } });
    const lifted = (c: Chromosome) => reaching(resolveChromosome(c), 'special').find((r) => r.from === 'd')!.gain;
    expect(lifted(two)).toBeGreaterThan(lifted(one));
  });

  it('quality buys the surplus, so a bottom-grade amplifier is weak and never harmful', () => {
    const weak = chromo({ placed: { g: gene('vigorous'), j: gene('catalyst', 'f') } });
    const strong = chromo({ placed: { g: gene('vigorous'), j: gene('catalyst', 's') } });
    expect(only(weak, 'attacks').route.gain).toBeGreaterThan(1);
    expect(only(weak, 'attacks').route.gain).toBeLessThan(only(strong, 'attacks').route.gain);
  });

  it('holds a conduit chain under the ceiling too', () => {
    const res = resolveChromosome(chromo({ main: gene('slime_gene', 'f'), placed: { j: gene('vigorous'), g: gene('resonance', 's') } }));
    const route = reaching(res, 'attacks').find((r) => r.from === 'j')!;
    expect(route.gain).toBeGreaterThan(1);
    expect(contributionWeight(route, res.ceiling)).toBeLessThanOrEqual(res.ceiling);
  });

  it('is held by the gene ceiling like every other magnitude', () => {
    const { res, route, weight } = only(chromo({ main: gene('slime_gene', 'f'), placed: { g: gene('vigorous'), j: gene('catalyst', 's') } }), 'attacks');
    expect(route.gain).toBeGreaterThan(1);
    expect(isClamped(route, res.ceiling)).toBe(true);
    expect(weight).toBeCloseTo(res.ceiling * route.share);
  });
});

describe('what a gene ability lands for', () => {
  const priced = (spec: object, stats: Partial<Record<string, number>>, targetStacks?: (s: string) => number) =>
    priceGeneAbility({ type: 'gene', cooldown: 10, ...spec } as never, { speed: BASE_SPEED, ...stats } as never, 'Test', targetStacks ? { targetStacks } : {})
      .damage;

  it('prices off a condition the TARGET carries, and reads as its floor without one', () => {
    const spec = { flat: 10, perTargetStacks: { status: 'hunger_anupama', power: 4 } };
    // Six appetites at 4 apiece, on top of the body's own 10.
    expect(priced(spec, {}, (s) => (s === 'hunger_anupama' ? 6 : 0))).toBeCloseTo(34);
    expect(priced(spec, {})).toBeCloseTo(10);
  });

  it('scales what it inflicts by the root of the same count, per target', () => {
    // Old: grade 'S' (upper case) reads no approach and falls back to 1.
    const g = { id: 'bare', quality: 'S' } as unknown as GeneInstance;
    const spec = { type: 'gene', cooldown: 10, perTargetStacks: { status: 'hunger_anupama', power: 1, inflictRoot: [4, 2] } } as never;
    expect(perTargetInflictIntensity(spec, g, 16)).toBeCloseTo(4);
    expect(perTargetInflictIntensity(spec, g, 0)).toBeUndefined();
  });

  it('leaves an ability with no inflictRoot to its authored intensity', () => {
    const g = { id: 'bare', quality: 'S' } as unknown as GeneInstance;
    const spec = { type: 'gene', cooldown: 10, perTargetStacks: { status: 'hunger_anupama', power: 1 } } as never;
    expect(perTargetInflictIntensity(spec, g, 1)).toBeUndefined();
  });

  it('prices an unbounded stat per point, as the giants do', () => {
    expect(priced({ flat: 30, power: 1.4, fromStat: 'damage' }, { damage: 1000 })).toBeCloseTo(1430);
  });

  it('adds armour to the base and scales the whole thing by speed', () => {
    const spec = { flat: 60, power: 1, fromStat: 'armor', scalesWithSpeed: true };
    expect(priced(spec, { armor: 40 })).toBeCloseTo(100);
    expect(priced(spec, { armor: 40, speed: BASE_SPEED * 2 })).toBeCloseTo(200);
  });

  it('amplifies rather than prices a resistance, so the cap is a ×1.75', () => {
    const spec = { flat: 60, amplifiedBy: 'resHeat', scalesWithSpeed: true };
    expect(priced(spec, { resHeat: 0 })).toBeCloseTo(60);
    expect(priced(spec, { resHeat: 0.75 })).toBeCloseTo(105);
  });

  it('Anupama wears its own rule and pays its attack arm in regeneration', () => {
    const def = MAIN_GENES.asurendra_anupama;
    expect(def.tier).toBe(5);
    expect(def.genus).toBe('asuroid');
    expect(def.confers?.map((a) => a.id)).toContain('fasting');
    expect(def.base?.attacks ?? []).toHaveLength(0);
    expect(def.fasts?.regenRoot[0]).toBeGreaterThan(def.fasts!.regenRoot[1]);
  });

  it("Anupama's active is priced off the target and thrown at the room", () => {
    const spec = MAIN_GENES.asurendra_anupama.ability!.spec;
    expect(spec.splashAll).toBe(true);
    expect(spec.perTargetStacks?.status).toBe('hunger_anupama');
    expect(spec.inflicts?.map((a) => a.id)).toContain('weight_of_hunger');
    const stats = { speed: BASE_SPEED } as never;
    const starving = priceGeneAbility(spec, stats, 'x', { targetStacks: () => 5 }).damage;
    const sated = priceGeneAbility(spec, stats, 'x').damage;
    expect(starving).toBeGreaterThan(sated);
  });

  it('lets a negative resistance genuinely take damage off', () => {
    const spec = { flat: 60, amplifiedBy: 'resHeat' };
    expect(priced(spec, { resHeat: -0.25 })).toBeCloseTo(45);
    expect(priced(spec, { resHeat: -3 })).toBe(0);
  });

  it('keeps growing after the resistance cap, through speed', () => {
    const spec = { flat: 60, amplifiedBy: 'resHeat', scalesWithSpeed: true };
    expect(priced(spec, { resHeat: 0.75, speed: BASE_SPEED * 3 })).toBeGreaterThan(priced(spec, { resHeat: 0.75 }));
  });

  it('shows its working, and the working multiplies out to the number', () => {
    const { damage, steps } = priceGeneAbility(
      { type: 'gene', cooldown: 10, flat: 60, amplifiedBy: 'resHeat', scalesWithSpeed: true } as never,
      { speed: BASE_SPEED * 1.5, resHeat: 0.5 } as never,
      'Flaming Bounce',
    );
    const rebuilt = steps.reduce((n, s) => (s.mult !== undefined ? n * s.mult : n + (s.value ?? 0)), 0);
    expect(rebuilt).toBeCloseTo(damage);
    expect(damage).toBeCloseTo(60 * 1.5 * 1.5);
  });
});

describe('a nuclease rekeys a body', () => {
  const troll = MAIN_GENES.troll;
  const heatMod = (def: typeof troll) => def.base!.defenses!.find((m) => m.value < 0)!;

  it('is the same product whichever mutation supplied the element', () => {
    expect(fusionOf('vuln', 'venom_edge')).toBe(MUTATIONS.vuln_poison);
    expect(fusionOf('vuln', 'miasma_brand')).toBe(MUTATIONS.vuln_poison);
    expect(fusionOf('vuln', 'tainting')).toBe(MUTATIONS.vuln_poison);
    for (const parent of ['rime_edge', 'frostbite_brand', 'chill']) expect(fusionOf('vuln', parent), parent).toBe(MUTATIONS.vuln_cold);
  });

  it('carries the rekey and nothing else: the parent is gone', () => {
    const fused = MUTATIONS.vuln_cold;
    expect(fused.rekey).toEqual({ kind: 'vulnerability', to: 'cold' });
    expect(fused.effect).toBeUndefined();
    expect(fused.transform).toBeUndefined();
    expect(MUTATIONS.chill.effect).toBeDefined();
  });

  it('pairs with nothing that speaks for no element', () => {
    expect(fusionOf('vuln', 'vigorous')).toBeUndefined();
    expect(fusionOf('vuln', 'resonance')).toBeUndefined();
    expect(fusionOf('vuln', 'vuln_cold')).toBeUndefined();
  });

  it('rewrites the weakness and leaves its size alone', () => {
    const before = heatMod(troll);
    expect(before.stat).toBe('resHeat');
    const after = heatMod(rekeyGene(troll, ['cold']));
    expect(after.stat).toBe('resCold');
    expect(after.value).toBe(before.value);
  });

  it('rewrites what douses it, which is the whole reason that moved onto the gene', () => {
    expect(rekeyGene(troll, ['cold', 'lightning']).confers![0].removal![0].damageTypes).toEqual(['lightning', 'acid']);
  });

  it('never touches the content the species is written from', () => {
    rekeyGene(troll, ['cold', 'lightning']);
    expect(MAIN_GENES.troll.base!.defenses!.some((m) => m.stat === 'resHeat')).toBe(true);
    expect(MAIN_GENES.troll.confers![0].removal![0].damageTypes).toEqual(['heat', 'acid']);
  });

  it('does nothing to a body with nothing to rewrite', () => {
    const slime = MAIN_GENES.slime_gene;
    expect(weakPointsOf(slime)).toHaveLength(0);
    expect(rekeyGene(slime, ['cold'])).toBe(slime);
  });

  it('takes the nearest route first, and ignores the surplus', () => {
    const res = resolveChromosome(chromo({ main: gene('troll'), placed: { g: gene('vuln_lightning'), j: gene('vuln_cold') } }));
    expect(res.main!.base!.defenses!.find((m) => m.value < 0)!.stat).toBe('resLightning');
    expect(res.main!.confers![0].removal![0].damageTypes).toEqual(['cold', 'acid']);
    const crowded = resolveChromosome(
      chromo({ main: gene('troll'), placed: { g: gene('vuln_lightning'), j: gene('vuln_cold'), i: gene('vuln_heat') } }),
    );
    expect(crowded.main!.base!.defenses!.find((m) => m.value < 0)!.stat).toBe('resLightning');
  });

  it('reaches the character sheet, not just the resolution', () => {
    const g = fresh();
    setChromosome(g, chromo({ main: gene('troll'), placed: { g: gene('vuln_cold') } }));
    const mods = chromosomeMods(resolveChromosome(chromosomeOf(g))).map((x) => x.mod);
    expect(mods.some((m) => m.stat === 'resCold' && m.value < 0)).toBe(true);
    expect(mods.some((m) => m.stat === 'resHeat' && m.value < 0)).toBe(false);
    // The kernel's list for the player carries it too.
    expect(g.modifiers(PLAYER).some((m) => m.stat === 'stats/resCold' && m.value < 0)).toBe(true);
  });

  describe('fusing one', () => {
    function bench() {
      const g = fresh();
      setCount(g, 'biomatter', 500);
      setCount(g, 'vuln', 2);
      grantGraded(g, 'chill', 'b', 1);
      grantGraded(g, 'vigorous', 'b', 1);
      return g;
    }

    it("spends both halves and keeps the subject's grade", () => {
      const g = bench();
      expect(g.dispatch(fuse({ nuclease: 'vuln', id: 'chill', quality: 'b' })).ok).toBe(true);
      expect(stockOf(g, 'vuln_cold', FUSED_GRADE)).toBe(1);
      expect(stockOf(g, 'vuln_cold', 'b')).toBe(0);
      expect(stockOf(g, 'chill', 'b')).toBe(0);
      expect(countOf(g, 'vuln')).toBe(1);
      expect(countOf(g, 'biomatter')).toBe(500 - FUSE_BIOMATTER);
    });

    it('refuses a mutation that speaks for no element, and spends nothing', () => {
      const g = bench();
      expect(g.dispatch(fuse({ nuclease: 'vuln', id: 'vigorous', quality: 'b' })).ok).toBe(false);
      expect(countOf(g, 'vuln')).toBe(2);
      expect(countOf(g, 'biomatter')).toBe(500);
      expect(stockOf(g, 'vigorous', 'b')).toBe(1);
    });

    it('refuses without the nuclease, the subject, or the biomatter', () => {
      const noNuclease = bench();
      setCount(noNuclease, 'vuln', 0);
      expect(noNuclease.dispatch(fuse({ nuclease: 'vuln', id: 'chill', quality: 'b' })).ok).toBe(false);
      expect(bench().dispatch(fuse({ nuclease: 'vuln', id: 'chill', quality: 's' })).ok).toBe(false);
      const noBiomatter = bench();
      setCount(noBiomatter, 'biomatter', 0);
      expect(noBiomatter.dispatch(fuse({ nuclease: 'vuln', id: 'chill', quality: 'b' })).ok).toBe(false);
    });

    it('is never found on a corpse: the bench is what makes one', () => {
      const everything = new Set(['ice', 'fire', 'undead', 'slime', 'beast', 'toxic']);
      expect(mutagensFrom(everything).some((m) => m.rekey)).toBe(false);
      expect(nucleasesFrom(new Set(['undead'])).map((n) => n.id)).toContain('vuln');
    });
  });

  it.todo('changes what douses the body it is actually worn on: conferred conditions (syncGeneStatuses) are left behind');
});

describe('the Attacks arm reaches your ordinary swing', () => {
  function armed(over: Partial<Chromosome>) {
    const g = fresh();
    setChromosome(g, chromo({ main: gene('troll'), ...over }));
    return g;
  }
  const sword = (g: Kernel) => {
    const item = giveItem(g, 'iron_sword');
    equip(g, item.uid);
  };
  const swingType = (g: Kernel) => run(g, (ctx) => playerDamageType(ctx));

  it('leaves the weapon speaking for itself when nothing is routed', () => {
    const g = armed({ placed: {} });
    sword(g);
    expect(swingType(g)).toBe('slashing');
  });

  it('re-types every ordinary swing when a type arrives', () => {
    const g = armed({ placed: { g: gene('rime_edge') } });
    sword(g);
    expect(swingType(g)).toBe('cold');
  });

  it('re-types a bare fist too: this is the body, not the weapon', () => {
    expect(swingType(armed({ placed: { g: gene('searing_edge') } }))).toBe('heat');
  });

  it('never re-types from another arm', () => {
    const g = armed({ placed: { i: gene('rime_edge') } });
    sword(g);
    expect(swingType(g)).toBe('slashing');
  });

  it('gives the loudest route the last word here as well', () => {
    const g = armed({ placed: { g: gene('searing_edge'), j: gene('rime_edge') }, cut: cutting(['i', 'j']) });
    expect(swingType(g)).toBe('heat');
  });

  it('carries the blow-shaping capabilities, which Active also reads', () => {
    const c = chromo({ main: gene('troll'), placed: { g: gene('elastic'), j: gene('bouncing') } });
    expect(armGrants(c, 'attacks', 'ignores_dodge')).toBe(true);
    expect(armGrants(c, 'attacks', 'splits_target')).toBe(true);
    expect(armGrants(c, 'defenses', 'ignores_dodge')).toBe(false);
  });
});

describe('the Active arm reaches the ability', () => {
  const troll = MAIN_GENES.troll.ability!;
  const resolved = (over: Partial<Chromosome>) => applyActiveArm(troll, resolveChromosome(chromo({ main: gene('troll'), ...over })));
  const spec = (over: Partial<Chromosome>) => resolved(over).spec;

  it('leaves the ability exactly as written when nothing arrives', () => {
    expect(resolved({ placed: {} })).toEqual(troll);
  });

  it('re-types the blow when a type arrives', () => {
    expect(troll.spec.damageType).toBe('piercing');
    expect(spec({ placed: { f: gene('rime_edge') } }).damageType).toBe('cold');
  });

  it('re-types rather than adding, because §7a says replacement is the safe one', () => {
    const s = spec({ placed: { f: gene('rime_edge') } });
    expect(s.damageType).toBe('cold');
    expect(s.riders ?? []).toHaveLength(0);
  });

  it('gives the loudest route the last word when several types arrive', () => {
    const cut = cutting(['d', 'e']);
    expect(spec({ placed: { e: gene('rime_edge'), b: gene('searing_edge') }, cut }).damageType).toBe('cold');
    expect(spec({ placed: { e: gene('searing_edge'), b: gene('rime_edge') }, cut }).damageType).toBe('heat');
  });

  it('makes the blow leave a condition when a brand arrives', () => {
    const s = spec({ placed: { f: gene('frostbite_brand') } });
    expect(s.inflicts?.map((a) => a.id)).toContain('chilled');
    expect(s.inflicts?.map((a) => a.id)).toEqual(expect.arrayContaining(['bleeding', 'punctured', 'chilled']));
  });

  it('brands as hard as the graph carried it, not always at 1', () => {
    const chill = (s: ReturnType<typeof spec>) => s.inflicts!.find((a) => a.id === 'chilled')!.intensity!;
    expect(chill(spec({ placed: { c: gene('frostbite_brand') } }))).toBeGreaterThan(chill(spec({ placed: { f: gene('frostbite_brand') } })));
  });

  it('brands harder for a better grade, like every other magnitude', () => {
    const chill = (s: ReturnType<typeof spec>) => s.inflicts!.find((a) => a.id === 'chilled')!.intensity!;
    const worst = spec({ placed: { f: gene('frostbite_brand', 'f') } });
    const best = spec({ placed: { f: gene('frostbite_brand', 's') } });
    expect(chill(worst)).toBeGreaterThan(0);
    expect(chill(best)).toBeGreaterThan(chill(worst));
  });

  it('names the BASE form, so branding repeatedly escalates on its own', () => {
    expect(spec({ placed: { f: gene('buffet_brand') } }).inflicts?.map((a) => a.id)).toContain('buffeted');
    expect(spec({ placed: { f: gene('tremor_brand') } }).inflicts?.map((a) => a.id)).toContain('shardbound');
  });

  it('changes the SHAPE of the blow when a function capability arrives', () => {
    expect(spec({ placed: { f: gene('bouncing') } }).splashAll).toBe(true);
    expect(spec({ placed: { f: gene('elastic') } }).sure).toBe(true);
  });

  it('never reaches the ability from another arm', () => {
    expect(resolved({ placed: { g: gene('rime_edge'), i: gene('frostbite_brand') } })).toEqual(troll);
  });

  it('does not pay a routed magnitude twice', () => {
    const s = spec({ placed: { f: gene('searing_edge') } });
    expect(s.power).toBe(troll.spec.power);
    expect(s.flat).toBe(troll.spec.flat);
  });

  it('reaches the live ability the rotation actually swings', () => {
    const g = fresh();
    setLevel(g, 40);
    setCount(g, 'biomatter', 5000);
    grantGraded(g, 'troll', 'c', 1);
    grantGraded(g, 'rime_edge', 'c', 1);
    expect(g.dispatch(slotMain(gene('troll'))).ok).toBe(true);
    patch(g, (s) => {
      s.mutagens.chromosome.established = BASELINE_LAYOUT.edges.map((e) => edgeKey(e.a, e.b));
    });
    expect(geneAbility(chromosomeOf(g))!.spec.damageType).toBe('piercing');
    g.dispatch(placeMutagen({ socket: 'f', id: 'rime_edge', quality: 'c' }));
    expect(geneAbility(chromosomeOf(g))!.spec.damageType).toBe('cold');
    expect(geneAbilityBase(chromosomeOf(g))!.spec.damageType).toBe('piercing');
  });
});

describe('Tarunavāk, of Sixteen Tongues', () => {
  it.todo('knows sixteen words, speaks each alone, climbs its ladder, speaks in a fight: tongues are left behind (no species through floor 6)');
});

describe('Kritavya, Refuter of Creation', () => {
  it.todo('refuses workings, seals them for the fight, holds a shield: refuting is left behind (no species through floor 6)');
});

describe('Nirākṣa who Swallowed His Eyes', () => {
  it.todo('wears its blindness, winds up and lands: the wind-up and conferred conditions are left behind');
});

describe('what a gene ability says about itself', () => {
  it.todo('the ability card lines of old ui/lib/format (geneAbilityLines, geneAbilityLanded): the card text is panel code here');

  it('keeps a deliberate zero in the working rather than dropping it', () => {
    const spec = MAIN_GENES.asurendra_kritavya.ability!.spec;
    const priced = priceGeneAbility(spec, { speed: BASE_SPEED } as never, 'Refutation');
    expect(priced.steps.some((s) => s.label.includes('flat damage'))).toBe(true);
  });
});

describe('what the Active arm may hand an ability', () => {
  const carriesOf = (id: string) => abilityCarries(MAIN_GENES[id].ability!.spec);

  it('hands a volley nothing, because a volley reads nothing', () => {
    expect(carriesOf('asurendra_vashkara')).toEqual({ type: false, sure: false, splash: false, inflicts: false });
  });

  it('hands a wind-up what lands with it, and nothing else', () => {
    expect(carriesOf('asurendra_niraksha')).toEqual({ type: true, sure: false, splash: false, inflicts: true });
  });

  it('declines the write rather than making it and hoping', () => {
    const spec = geneAbility({ ...fullyConnected(), main: { id: 'asurendra_vashkara', quality: 's' } })!.spec;
    expect(spec.damageType).toBeUndefined();
    expect(spec.splashAll).toBeUndefined();
    expect(spec.sure).toBeUndefined();
    expect(spec.inflicts).toBeUndefined();
  });

  it('calls an Active capability live only when something can read it', () => {
    const volley = MAIN_GENES.asurendra_vashkara.ability!.spec;
    for (const grant of ['splits_target', 'inflicts_burning', 'ignores_dodge']) {
      expect(grantIsLive(grant, 'active', null), `${grant} with no ability`).toBe(false);
      expect(grantIsLive(grant, 'active', volley), `${grant} on a volley`).toBe(false);
    }
    expect(grantIsLive('splits_target', 'attacks', null)).toBe(true);
    expect(grantIsLive('splits_target', 'active')).toBe(true);
  });
});

describe('grips the mind holds', () => {
  it.todo('telekinesis and floating grips (Vashkāra): left behind; `items` holds handSwingShare and its tests');
});

describe('Vashkāra of the Unheld Blades', () => {
  it.todo('the volley and the floating clock: left behind (no species through floor 6)');
});

describe('the bearer seam', () => {
  /** A player wearing a real body, so "it read the player's" would be visible. */
  function trollPlayer(seed = 1) {
    const g = fresh(seed);
    setLevel(g, 40);
    setCount(g, 'biomatter', 5000);
    grantGraded(g, 'troll', 'c', 1);
    expect(g.dispatch(slotMain(gene('troll'))).ok).toBe(true);
    return g;
  }
  const foe = (g: Kernel) => spawn(g, 'woods_edge');

  it('a monster carrying no genome wears the bare sequence, not nothing', () => {
    const g = fresh();
    const e = foe(g);
    const theirs = genomeOf(mut(g), e.entity);
    expect(expressedMain(theirs).id).toBe('bare');
    expect(expressedGene(theirs).id).toBe('bare');
    expect(resolveChromosome(theirs).main?.id).toBe('bare');
  });

  it('answers for the monster rather than for whoever is watching', () => {
    const g = trollPlayer();
    const e = foe(g);
    const mine = genomeOf(mut(g));
    const theirs = genomeOf(mut(g), e.entity);
    expect(expressedGene(mine).id).toBe('troll');
    expect(expressedGene(theirs).id).toBe('bare');
    expect(geneAbility(mine)?.name).toBe('Troll Bite');
    expect(geneAbility(theirs)).toBeUndefined();
    expect(bearerGrants(theirs).size).toBe(0);
    expect(armGrants(theirs, 'attacks', 'ignores_dodge')).toBe(false);
  });

  it('a bare bearer contributes the bare body and nothing routed', () => {
    const g = trollPlayer();
    const e = foe(g);
    const mine = chromosomeMods(resolveChromosome(genomeOf(mut(g))));
    const theirs = chromosomeMods(resolveChromosome(genomeOf(mut(g), e.entity)));
    expect(mine.some((m) => m.mod.stat === 'resHeat')).toBe(true);
    expect(theirs.some((m) => m.mod.stat === 'resHeat')).toBe(false);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((m) => m.mod.value === 0)).toBe(true);
    // Here the source gives a monster nothing at all: bare's values are all 0.
    expect(g.modifiers(e.entity).some((m) => (m as { source?: string }).source === 'Bare Sequence')).toBe(false);
  });

  it.todo('a fast is read off the faster, not off the field: the fast is left behind');

  it('keeps several bearers cached at once instead of thrashing one slot', () => {
    const g = trollPlayer();
    const mineChromo = genomeOf(mut(g));
    const mine = resolveChromosome(mineChromo);
    const grants = bearerGrants(mineChromo);
    for (let i = 0; i < 5; i++) {
      const e = foe(g);
      resolveChromosome(genomeOf(mut(g), e.entity));
      bearerGrants(genomeOf(mut(g), e.entity));
    }
    expect(resolveChromosome(mineChromo)).toBe(mine);
    expect(bearerGrants(mineChromo)).toBe(grants);
  });

  it('gives every ungenomed bearer the same cache entry', () => {
    const g = fresh();
    const a = foe(g);
    const b = foe(g);
    expect(resolveChromosome(genomeOf(mut(g), a.entity))).toBe(resolveChromosome(genomeOf(mut(g), b.entity)));
    expect(Object.isFrozen(genomeOf(mut(g), a.entity))).toBe(true);
    expect(genomeOf(mut(g), a.entity)).toBe(genomeOf(mut(g), b.entity));
  });
});

/**
 * New tests (the combat seams of this port): the body's blow and the
 * Attacks arm in a real fight. The old ones are in `combat.ts` lines
 * 1339, 4320-4340 and 4412-4810.
 */
describe('the body in a fight', () => {
  function wearing(over: Partial<Chromosome>, seed = 7) {
    const g = huntingGame(seed, 'woods_edge');
    patch(g, (s) => {
      s.mutagens.chromosome = { ...fullyConnected(), main: gene('slime_gene'), ...over };
    });
    return g;
  }

  it('Slime Bounce swings from the rotation, priced off armour and speed, and stuns', () => {
    const g = wearing({});
    let landed: FeedEntry | undefined;
    for (let i = 0; i < 3000 && !landed; i++) {
      g.tick();
      landed = feedOf(g).find((e) => e.text.includes('Slime Bounce hits'));
    }
    expect(landed, 'the bounce never landed').toBeDefined();
    const steps = landed!.damage!.steps.map((s) => s.label);
    expect(steps).toContain('Slime Bounce (flat damage)');
    expect(steps).toContain('Armor');
    expect(steps).toContain('Speed');
    expect(landed!.damage!.slices.every((s) => s.type === 'bludgeoning')).toBe(true);
    expect(g.staleStats()).toEqual([]);
  });

  it('a type in the Attacks arm re-types the plain swing in the damage report', () => {
    // Bare body (no ability), so every blow is a plain swing.
    const g = wearing({ main: null, placed: { g: gene('rime_edge') } });
    let hit: FeedEntry | undefined;
    for (let i = 0; i < 2000 && !hit; i++) {
      g.tick();
      hit = feedOf(g).find((e) => e.text.startsWith('⚔️ You hit'));
    }
    expect(hit).toBeDefined();
    expect(hit!.damage!.slices[0].type).toBe('cold');
  });

  it('ignores_dodge in the Attacks arm: no plain swing is evaded', () => {
    const outcomes = (g: Kernel) => {
      const seen: string[] = [];
      g.onEvent((ev) => {
        const p = ev.payload as { attacker?: string; outcome?: string };
        if (ev.type === 'combat/attack' && p.attacker === PLAYER) seen.push(p.outcome!);
      });
      // One long fight against a foe that dodges nearly everything.
      for (let i = 0; i < 2000 && !combatOf(g).fight; i++) g.tick();
      hardenFoes(g);
      for (const e of combatOf(g).fight!.enemies) if (e) setMods(g, [{ stat: 'stats/dodge', kind: 'add', value: 0.9 }], e.entity);
      g.tick(1500);
      return seen;
    };
    // The control: the same seed with an empty Attacks arm is evaded.
    expect(outcomes(wearing({ main: null }))).toContain('evaded');
    const seen = outcomes(wearing({ main: null, placed: { g: gene('elastic') } }));
    expect(seen).toContain('hit');
    expect(seen).not.toContain('evaded');
  });
});
