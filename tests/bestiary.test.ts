/**
 * Port of the old `tests/bestiary.test.ts`. The cases keep their old names.
 *
 * Call shape:
 * - `recordKill(state, bus, id)` is the `combat/kill` event, which the
 *   bestiary hears (the old "real listener path"); `recordEncounter(state,
 *   spot, ids)` is `combat/fight-started` with that site and group.
 * - The reads take a read context and the bestiary slice: `isDiscovered(ctx,
 *   state, id)`, `knowsFact(state, id, fact)`, `entryOf(state, id)`,
 *   `bestiaryProgress(ctx, state)`; `bestiaryInsight`, `factChance`,
 *   `habitatNeeded` and `isVeiled` take the read context.
 * - `monsterProfile(id)` takes the level range: `monsterProfile(id,
 *   spawnLevels(id))`.
 * - `state.skills.hunting = ...` and `state.attrs.int.level = ...` are
 *   written through `patch`.
 * - The countryside spots of the old file (`forest_edge_w`, `deep_forest_w`,
 *   `malgeri_path`, `riverbank`) are shelved. A sighting is counted by site
 *   id, so the habitat cases use spots of this build (`the_cages`,
 *   `long_gallery`, `the_sand`).
 * - "escort-only monsters still get a level band from their leader": the old
 *   `slime_soldier_spear` stands on no spot of this build, and no escort of
 *   this build lacks a line of its own. The case checks the rule the old one
 *   rested on: an escort's range covers its leader's (`goblin_warchief` and
 *   its three escorts, floor 6).
 * - An entry opened at tick 0 keeps `firstKill` 0, the "not opened" mark of
 *   a veiled species (old bug, kept): the veil case ticks once first.
 *
 * New: the veil (a veiled species is counted, not shown, and opens when its
 * counter is raised), the entries counter, and the view.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import bestiary, {
  BESTIARY_FACTS,
  BESTIARY_TUNING,
  bestiaryInsight,
  bestiaryProgress,
  dropChance,
  entryOf,
  factChance,
  groupByTaxon,
  habitatNeeded,
  isDiscovered,
  isVeiled,
  knowsFact,
  matchesQuery,
  monsterProfile,
  primaryTaxon,
  queryMonsters,
  spawnLevels,
  taxonPlural,
  type BestiaryState,
  type BestiaryView,
} from '../src/systems/bestiary';
import { enemyKilled, fightStarted } from '../src/systems/combat';
import { raiseCounter, type CountersState } from '../src/systems/counters';
import { MONSTER_LIST, MONSTER_TAGS, MONSTERS, monsterTagsOf } from '../src/systems/monsters';
import type { SkillsState } from '../src/systems/skills';
import { CALM_SEEN_KEY } from '../src/systems/weather';
import { SPOTS } from '../src/systems/world';
import { emit, makeGame, patch, reads, slice } from './helpers';

function newGame(seed = 42): Kernel {
  return makeGame({ seed });
}

const book = (g: Kernel) => slice<BestiaryState>(g, 'bestiary');

/** Kill the same monster n times through the real listener path. */
function kill(g: Kernel, monsterId: string, times = 1): void {
  for (let i = 0; i < times; i++) {
    emit(g, enemyKilled, {
      entity: 'm:test',
      defId: monsterId,
      name: monsterId,
      level: 1,
      rewardLevel: 1,
      xp: 1,
      tags: [],
      lastHit: null,
      site: 'test',
      boss: false,
      once: false,
    });
  }
}

/** One fight start at a site with this group. */
function encounter(g: Kernel, site: string, monsterIds: string[]): void {
  emit(g, fightStarted, {
    site,
    forced: false,
    enemies: monsterIds.map((defId, i) => ({ entity: `m:${i}`, defId, name: defId, level: 1 })),
  });
}

function setHunting(g: Kernel, level: number): void {
  patch(g, (slices) => {
    (slices.skills as SkillsState).skills.hunting = { level, xp: 0 };
  });
}

const fact = (id: string) => BESTIARY_FACTS.find((f) => f.id === id)!;
const discovered = (g: Kernel, id: string) => isDiscovered(reads(g), book(g), id);

describe('bestiary unlocking', () => {
  it('the first kill opens the entry and nothing before it does', () => {
    const g = newGame();
    expect(discovered(g, 'goblin')).toBe(false);

    // Seeing one, repeatedly, is not knowing one.
    encounter(g, 'the_cages', ['goblin', 'goblin']);
    expect(discovered(g, 'goblin')).toBe(false);
    expect(entryOf(book(g), 'goblin')!.seen.the_cages).toBe(1); // deduped per encounter

    kill(g, 'goblin');
    expect(discovered(g, 'goblin')).toBe(true);
    expect(entryOf(book(g), 'goblin')!.kills).toBe(1);
  });

  it('a fact cannot be learned before its minimum kill count, however lucky', () => {
    const g = newGame(7);
    const defenses = fact('defenses');
    kill(g, 'wolf', defenses.minKills - 1);
    expect(knowsFact(book(g), 'wolf', 'defenses')).toBe(false);
  });

  it('grinding past sureKills guarantees every fact', () => {
    const g = newGame(3);
    const most = Math.max(...BESTIARY_FACTS.map((f) => f.sureKills));
    kill(g, 'wolf', most);
    for (const f of BESTIARY_FACTS) {
      expect(knowsFact(book(g), 'wolf', f.id), `${f.id} still unknown after ${most} kills`).toBe(true);
    }
  });

  it('facts are learned once and never duplicated', () => {
    const g = newGame(11);
    kill(g, 'wolf', 200);
    const facts = entryOf(book(g), 'wolf')!.facts;
    expect(new Set(facts).size).toBe(facts.length);
  });

  it('sharper hunters learn faster', () => {
    const dull = newGame();
    const sharp = newGame();
    patch(sharp, (slices) => {
      (slices.skills as SkillsState).skills.hunting = { level: 40, xp: 0 };
      (slices.attributes as AttributesState).attrs.int.level = 30;
      (slices.attributes as AttributesState).attrs.wis.level = 30;
    });

    expect(bestiaryInsight(reads(sharp))).toBeGreaterThan(bestiaryInsight(reads(dull)));
    expect(factChance(reads(sharp), fact('vitals'))).toBeGreaterThan(factChance(reads(dull), fact('vitals')));
  });

  it('insight rides the same roll chance but never exceeds the cap', () => {
    const g = newGame();
    setHunting(g, 500);
    expect(factChance(reads(g), fact('lore'))).toBe(BESTIARY_TUNING.maxChance);
  });

  it('progress counts only what has actually been killed', () => {
    const g = newGame();
    // A veiled species (`veil`) is not in the total until its veil lifts.
    const unveiled = MONSTER_LIST.filter((d) => !isVeiled(reads(g), d.id)).length;
    expect(bestiaryProgress(reads(g), book(g))).toEqual({ known: 0, total: unveiled });
    kill(g, 'goblin');
    expect(bestiaryProgress(reads(g), book(g)).known).toBe(1);
  });
});

describe('habitats', () => {
  it('a location is confirmed only after enough sightings, and only once killed', () => {
    const g = newGame();
    const needed = habitatNeeded(reads(g));
    for (let i = 0; i < needed + 3; i++) encounter(g, 'the_cages', ['goblin']);
    // Never killed one: nothing is confirmed yet.
    expect(entryOf(book(g), 'goblin')!.spots).toEqual([]);

    kill(g, 'goblin');
    expect(entryOf(book(g), 'goblin')!.spots).toEqual(['the_cages']);
  });

  it('each location is learned separately', () => {
    const g = newGame();
    const needed = habitatNeeded(reads(g));
    kill(g, 'goblin');
    for (let i = 0; i < needed; i++) encounter(g, 'long_gallery', ['goblin']);
    for (let i = 0; i < needed - 1; i++) encounter(g, 'the_sand', ['goblin']);
    kill(g, 'goblin');

    const entry = entryOf(book(g), 'goblin')!;
    expect(entry.spots).toContain('long_gallery');
    expect(entry.spots).not.toContain('the_sand');
  });

  it('hunting skill lowers the sightings needed, down to a floor', () => {
    const g = newGame();
    expect(habitatNeeded(reads(g))).toBe(BESTIARY_TUNING.habitatBase);
    setHunting(g, 20);
    expect(habitatNeeded(reads(g))).toBe(BESTIARY_TUNING.habitatBase - 2);
    setHunting(g, 999);
    expect(habitatNeeded(reads(g))).toBe(BESTIARY_TUNING.habitatFloor);
  });
});

describe('recorded knowledge', () => {
  it('profile stats bracket what the spawner actually produces', () => {
    const [lo, hi] = spawnLevels('wolf');
    const profile = monsterProfile('wolf', [lo, hi]);
    expect(profile.levels).toEqual([lo, hi]);
    // Tier mid-point sits inside the rolled band, so the book's numbers are
    // plausible rather than extreme.
    expect(profile.hp[0]).toBeLessThanOrEqual(profile.hp[1]);
    expect(profile.damage[0]).toBeLessThanOrEqual(profile.damage[1]);
    expect(profile.attackInterval).toBeGreaterThan(0);
  });

  it('escort-only monsters still get a level band from their leader', () => {
    const leader = MONSTERS.goblin_warchief;
    const [lo, hi] = spawnLevels(leader.id);
    expect(hi).toBeGreaterThan(1);
    for (const escort of leader.escorts ?? []) {
      const [elo, ehi] = spawnLevels(escort);
      expect(elo, escort).toBeLessThanOrEqual(lo);
      expect(ehi, escort).toBeGreaterThanOrEqual(hi);
    }
  });

  it('drop chances account for multiple rolls', () => {
    const golem = MONSTERS.slime_golem;
    const index = golem.loot.entries.findIndex((e) => e.id === 'warm_slime_gel');
    const single = golem.loot.entries[index].weight / golem.loot.entries.reduce((s, e) => s + e.weight, 0);
    expect(dropChance(golem, index)).toBeGreaterThan(single); // 3 rolls beat 1
    expect(dropChance(golem, index)).toBeLessThanOrEqual(1);
  });
});

describe('tags and search', () => {
  it('derived tags come from the stats, not the data file', () => {
    expect(monsterTagsOf(MONSTERS.slime_fire)).toContain('ranged'); // range: 'ranged'
    expect(monsterTagsOf(MONSTERS.goblin_boss)).toContain('leader'); // has escorts
    expect(monsterTagsOf(MONSTERS.stone_golem)).toContain('solitary'); // group.max 1
    expect(monsterTagsOf(MONSTERS.slime_spider)).toContain('swarm'); // group.min > 1
    expect(monsterTagsOf(MONSTERS.slime_base_basic)).toContain('non_elemental');
    expect(monsterTagsOf(MONSTERS.slime_fire)).not.toContain('non_elemental');
  });

  it('filters OR within a category and AND across categories', () => {
    const slimeFire = queryMonsters({ tags: ['slime', 'fire'] }).map((d) => d.id);
    expect(slimeFire).toContain('slime_fire');
    expect(slimeFire).not.toContain('slime_water'); // slime, but not fire
    expect(slimeFire).not.toContain('goblin');

    // Two elements in one category widen the net rather than narrowing it.
    const either = queryMonsters({ tags: ['fire', 'ice'] }).map((d) => d.id);
    expect(either).toEqual(expect.arrayContaining(['slime_fire', 'slime_ice_basic']));
  });

  it('search matches names and tag names', () => {
    expect(matchesQuery(MONSTERS.slime_metal, { search: 'metal' })).toBe(true);
    expect(matchesQuery(MONSTERS.slime_metal, { search: 'construct' })).toBe(true);
    expect(matchesQuery(MONSTERS.slime_metal, { search: 'goblin' })).toBe(false);
  });

  it('results are ordered by tier', () => {
    const ids = queryMonsters({ tags: ['slime'] });
    const tiers = ids.map((d) => d.tier);
    expect(tiers.indexOf('basic')).toBeLessThan(tiers.lastIndexOf('elite'));
  });
});

describe('taxonomy shelves', () => {
  it('a monster files under its FIRST taxon tag', () => {
    // Slime Spider is slime + vermin, in that order: it shelves with the slimes.
    expect(primaryTaxon(MONSTERS.slime_spider)).toBe('slime');
    expect(primaryTaxon(MONSTERS.cave_spider)).toBe('vermin');
    expect(primaryTaxon(MONSTERS.goblin)).toBe('goblin');
    expect(primaryTaxon(MONSTERS.stone_golem)).toBe('construct');
  });

  it('every monster lands on a shelf, exactly once', () => {
    const groups = groupByTaxon(MONSTER_LIST);
    const shelved = groups.flatMap((g) => g.defs.map((d) => d.id));
    expect(shelved.length).toBe(MONSTER_LIST.length);
    expect(new Set(shelved).size).toBe(MONSTER_LIST.length);
    for (const g of groups) expect(MONSTER_TAGS[g.tag], `unregistered shelf ${g.tag}`).toBeDefined();
  });

  it('headings pluralise, and irregulars are respected', () => {
    expect(taxonPlural('slime')).toBe('Slimes');
    expect(taxonPlural('goblin')).toBe('Goblins');
    expect(taxonPlural('vermin')).toBe('Vermin');
    expect(taxonPlural('undead')).toBe('Undead');
  });

  it('shelf order follows the tag registry, not discovery order', () => {
    const order = Object.keys(MONSTER_TAGS);
    const tags = groupByTaxon(MONSTER_LIST).map((g) => g.tag);
    const positions = tags.map((t) => order.indexOf(t));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('wired into the game', () => {
  it('killing through the event bus records the kill', () => {
    const g = newGame();
    kill(g, 'goblin');
    expect(discovered(g, 'goblin')).toBe(true);
  });

  it('encounters recorded through the bus count sightings', () => {
    const g = newGame();
    encounter(g, 'the_cages', ['slime_water']);
    expect(entryOf(book(g), 'slime_water')!.seen.the_cages).toBe(1);
  });

  it('a fresh save starts with an empty book', () => {
    expect(book(newGame(1)).entries).toEqual({});
  });
});

// ---- new cases ----

describe('the veil', () => {
  const veiled = MONSTER_LIST.find((d) => d.veil?.length)!;

  it('a veiled species is counted and nothing else; raising its counter opens the entry', () => {
    const g = newGame(5);
    g.tick();
    expect(veiled).toBeDefined();
    expect(isVeiled(reads(g), veiled.id)).toBe(true);
    kill(g, veiled.id, 3);
    expect(entryOf(book(g), veiled.id)!.kills).toBe(3);
    expect(entryOf(book(g), veiled.id)!.firstKill).toBe(0);
    expect(discovered(g, veiled.id)).toBe(false);
    expect(slice<CountersState>(g, 'counters').counts['bestiary:entries'] ?? 0).toBe(0);

    emit(g, raiseCounter, { key: CALM_SEEN_KEY, value: 1 });
    expect(isVeiled(reads(g), veiled.id)).toBe(false);
    expect(discovered(g, veiled.id)).toBe(true);
    expect(entryOf(book(g), veiled.id)!.firstKill).toBeGreaterThan(0);
    // Every veiled species with kills opens, and only those.
    expect(slice<CountersState>(g, 'counters').counts['bestiary:entries']).toBe(1);
  });
});

describe('the view', () => {
  it('lists discovered species only, with haunts and the live level range', () => {
    const g = newGame(9);
    encounter(g, 'the_cages', ['forest_rat', 'goblin']);
    kill(g, 'forest_rat', 2);
    const view = g.view().systems[bestiary.id] as BestiaryView;
    expect(view.entries.map((e) => e.id)).toEqual(['forest_rat']);
    const rat = view.entries[0];
    expect(rat.kills).toBe(2);
    expect(rat.haunts).toEqual([{ spot: 'the_cages', name: SPOTS.the_cages.name, icon: SPOTS.the_cages.icon, count: 1, confirmed: false }]);
    expect(rat.levels).toEqual(spawnLevels('forest_rat', reads(g)));
    expect(view.known).toBe(1);
    expect(view.habitatNeeded).toBe(habitatNeeded(reads(g)));
  });
});
