/**
 * Floor 17, the Malgeri Crossing: the layout, the sky lines, the calm rule
 * and the disclosure rule that keeps the calm unnamed until the first calm
 * has been stood under. Port of the old `tests/malgeri.test.ts` (37 cases),
 * step 4 port C6.
 *
 * Call shape:
 * - A state at a spot and a tick is a kernel with `world.spot`,
 *   `clock.totalTicks` and `weather.seed` patched (`gameAt`); the seed is the
 *   old one (`worldSeedOf(CREATED)`).
 * - `state.stats[key] = n` is a patch of the counters slice (no event: the
 *   old write raised no event either). Where the old case relied on the
 *   flag's stamp, the tick stamps it.
 * - `recordKill(state, bus, id)` is the `combat/kill` event, which the
 *   bestiary hears; the log lines and entries are read from `onEvent`.
 * - `tickSky(state, bus)` is the kernel tick that lands on the game minute.
 * - Text: the old text tables (`SPOTS_TEXT`, `FLOORS_TEXT`, `BANDS_TEXT`,
 *   `NPCS_TEXT`, `MONSTERS_TEXT`) are fields of the records here; the scans
 *   read the text fields of the records (names, descriptions, find and
 *   activity lines, road labels, dialogue), not their data.
 * - `f18_well_head` (the desert, port C7) is not here; the neighbour scan
 *   reads `f16_arena` only.
 * - "the forge validator on veils and lore": the old forge's rule is
 *   `veilIssues` (bestiary) and `loreIssues` (npcs) here, called on the live
 *   registries with one record swapped, as the old stand-in store did.
 * - "the map badge" (2 cases): the old badge (`spotThreat` of
 *   `ui/lib/navigation.ts`) is not in this build's map (the UI step):
 *   `it.todo`.
 * - The old `createInitialState(CREATED)` started the clock at tick 0 and the
 *   bestiary wrote `firstKill` from the clock; here `firstKill` is the
 *   kernel tick, so a stamp is checked as above 0.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { isDiscovered, isVeiled, bestiaryProgress, veilIssues, type BestiaryState } from '../src/systems/bestiary';
import { eligibleEncounters, enemyKilled, type EncounterSite } from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import { BANDS, clearMet, exploreIssues, FLOORS, floorStructureIssues, ladderReader } from '../src/systems/ladder';
import { MATERIALS } from '../src/systems/materials';
import { MONSTER_LIST, MONSTERS } from '../src/systems/monsters';
import npcs, { DIALOGUE_LINE_TICKS, loreIssues, npcDialogue, NPC_LIST, NPCS, talkTo, type NpcsView } from '../src/systems/npcs';
import PeopleList from '../src/systems/npcs/PeopleList.svelte';
import { QUESTS } from '../src/systems/quests';
import { conditionReader, SKILLS } from '../src/systems/skills';
import { CALM_SEEN_KEY, calmSpell, SKY_TABLES, skyKindAt, weatherAt, worldSeedOf } from '../src/systems/weather';
import type { SmithingView } from '../src/systems/smithing';
import { ADJACENCY, AREAS, edgesFrom, REGIONS, skyRegionOf, spotActivities, spotCleared, SPOTS, type SpotDef } from '../src/systems/world';
import { emit, makeGame, patch, reads, slice } from './helpers';

const FLOOR = FLOORS.ascent_f17;
const AREA_ID = 'ascent_f17_area';
const CALM_TRIO = ['malgeri_ridge_wolf', 'malgeri_cairn_brute', 'malgeri_hollow_seer'];
const SKY_SLIMES: Record<string, string> = {
  snow: 'malgeri_rime_slime',
  heatwave: 'malgeri_cinder_slime',
  gale: 'malgeri_squall_slime',
  storm: 'malgeri_storm_slime',
  rain: 'malgeri_downpour_slime',
};
const CREATED = 1_754_000_000_000;
const SEED = worldSeedOf(CREATED);
const TICKS_PER_MINUTE = 10;
/** The first tick on a rule boundary inside the calm spell of window 3. */
const CALM_TICK = Math.ceil(calmSpell(SEED, 'malgeri_range', 3)[0] / 3) * 3 * TICKS_PER_MINUTE;

type Encounter = NonNullable<SpotDef['encounters']>[number];
const f17Spots = (): SpotDef[] => Object.values(SPOTS).filter((s) => s.areaId === AREA_ID);
const openHunts = () => f17Spots().filter((s) => !s.tags?.includes('indoor') && (s.encounters ?? []).some((e) => e.sky));
const dropsAmber = (id: string) => MONSTERS[id].loot.entries.some((l) => l.kind === 'material' && l.id === 'ridge_amber');
const sum = (lines: readonly Encounter[]) => lines.reduce((n, e) => n + e.weight, 0);
const siteOf = (spotId: string): EncounterSite => ({ id: spotId, name: spotId, encounters: SPOTS[spotId].encounters ?? [] });

/** A new game standing at `spot` with the clock at `tick` and the old seed. */
function gameAt(spot: string, tick = 0, change?: (slices: Record<string, any>) => void): Kernel {
  const k = makeGame({ seed: 17 });
  patch(k, (slices) => {
    slices.world.spot = spot;
    if (!slices.world.discovered.includes(spot)) slices.world.discovered.push(spot);
    slices.clock.totalTicks = tick;
    slices.weather.seed = SEED;
    change?.(slices);
  });
  return k;
}

const counts = (k: Kernel) => slice<CountersState>(k, 'counters').counts;
const book = (k: Kernel) => slice<BestiaryState>(k, 'bestiary');
/** The old `state.stats[key] = value`: a write with no event. */
const setStat = (k: Kernel, key: string, value: number) => patch(k, (slices) => (slices.counters.counts[key] = value));

describe('floor 17: the layout', () => {
  it("is the Malgeri Crossing in the Malgeri Mountains, on the range's sky", () => {
    expect(FLOOR.areaId).toBe(AREA_ID);
    expect(FLOOR.bandId).toBe('ascent_aberrant');
    expect(FLOOR.landing).toBe('f17_landing');
    expect(AREAS[AREA_ID].regionId).toBe('the_ascent');
    expect(AREAS[AREA_ID].skyRegionId).toBe('malgeri_range');
    expect(skyRegionOf('f17_landing')?.id).toBe('malgeri_range');
    expect(skyRegionOf('f17_keeper')?.id).toBe('malgeri_range');
    expect(SKY_TABLES[skyRegionOf('f17_keeper')!.sky!]).toBeDefined();
    expect(BANDS.ascent_aberrant.name).toBe('The Malgeri Mountains');
    expect(FLOOR.name).toBe('The Malgeri Crossing');
  });

  it("clears on the gate boss's kill, which only a boss line of that spot can make", () => {
    expect(FLOOR.clear).toEqual([{ type: 'stat', key: 'boss:f17_keeper', value: 1 }]);
    expect(SPOTS.f17_keeper.encounters!.some((e) => e.boss)).toBe(true);
  });

  it('has eighteen spots in four zones', () => {
    expect(f17Spots().map((s) => s.id).sort()).toEqual(
      [
        'f17_landing', 'f17_cave_hub', 'f17_cave_crack', 'f17_nest', 'f17_central_caves',
        'f17_east_mouth', 'f17_east_ascent', 'f17_east_peak',
        'f17_east_ridge', 'f17_west_ridge', 'f17_west_peak', 'f17_peak',
        'f17_base', 'f17_path', 'f17_old_path', 'f17_hamlet_square', 'f17_hamlet_forge', 'f17_keeper',
      ].sort(),
    );
  });

  it('passes the floor structure rules and the explore rule, with the spine running landing to clear spot', () => {
    const report = floorStructureIssues(FLOOR, SPOTS, ADJACENCY);
    expect(report.issues).toEqual([]);
    expect(report.skipped).toBeUndefined();
    expect(exploreIssues(f17Spots())).toEqual([]);
  });

  it('shuts the descent behind the peak boss, in one direction only', () => {
    const down = edgesFrom('f17_peak').find((e) => e.to === 'f17_base')!;
    expect(down.requires).toEqual([{ type: 'stat', key: 'boss:f17_peak', value: 1 }]);
    // Nothing else leads into the descent, from the landing or from the ridge.
    const into = new Set(['f17_base', 'f17_path', 'f17_old_path', 'f17_hamlet_square', 'f17_hamlet_forge', 'f17_keeper']);
    const entries = f17Spots()
      .filter((s) => !into.has(s.id))
      .flatMap((s) => edgesFrom(s.id).filter((e) => into.has(e.to)).map((e) => `${s.id}>${e.to}`));
    expect(entries).toEqual(['f17_peak>f17_base']);
    // The reverse edge is open: the hamlet side is never a trap.
    const up = edgesFrom('f17_base').find((e) => e.to === 'f17_peak')!;
    expect(up.requires ?? []).toEqual([]);
  });

  it('keeps the hamlet off the fast-travel network, so it cannot skip the gate', () => {
    for (const id of ['f17_base', 'f17_path', 'f17_old_path', 'f17_hamlet_square', 'f17_hamlet_forge', 'f17_keeper']) {
      expect(SPOTS[id].waypoint, id).toBeFalsy();
    }
  });

  it('puts the roofs on the roofed spots: indoor, and the caves also dark', () => {
    for (const id of ['f17_landing', 'f17_cave_hub', 'f17_cave_crack', 'f17_nest', 'f17_central_caves']) {
      expect(SPOTS[id].tags, id).toEqual(expect.arrayContaining(['indoor', 'dark']));
    }
    for (const id of ['f17_east_mouth', 'f17_west_peak', 'f17_base', 'f17_hamlet_square', 'f17_hamlet_forge']) {
      expect(SPOTS[id].tags, id).toContain('indoor');
    }
    expect(SPOTS.f17_hamlet_forge.tags).toContain('heat');
  });

  it('puts an optional queen in the nest: one fight, and no gate or clear reads it', () => {
    const nest = SPOTS.f17_nest;
    expect(nest.fightLimit).toBe(1);
    expect(nest.encounters).toEqual([expect.objectContaining({ monsterId: 'malgeri_brood_queen', boss: true, level: [43, 43] })]);
    const readsNest = (conds: unknown) => JSON.stringify(conds ?? []).includes('f17_nest');
    expect(readsNest(FLOOR.clear)).toBe(false);
    expect(readsNest(edgesFrom('f17_peak').find((e) => e.to === 'f17_base')!.requires)).toBe(false);
  });

  it("new here: Kystel's Anvil is an anvil, smelts and tans, and the anvil view names it once found", () => {
    expect(SPOTS.f17_hamlet_forge.benches).toEqual(['forging']);
    const k = gameAt('f17_hamlet_forge');
    const anvil = k.view().systems.smithing as SmithingView;
    expect(anvil.atAnvil).toBe(true);
    expect(anvil.anvils.map((a) => a.id)).toContain('f17_hamlet_forge');
    const crafts = spotActivities(SPOTS.f17_hamlet_forge).filter((a) => a.kind === 'craft').map((a) => a.id);
    expect(crafts).toEqual(SPOTS.f17_hamlet_forge.recipes!.map((id) => `craft_${id}`));
    expect(NPCS.f17_thora.spotId).toBe('f17_hamlet_forge');
  });

  it('has a camp in every roofed zone, and the gate boss without a fight limit', () => {
    const rests = (id: string) => SPOTS[id].activities.some((a) => a.kind === 'rest');
    expect(['f17_landing', 'f17_east_mouth', 'f17_west_peak', 'f17_base'].every(rests)).toBe(true);
    expect(SPOTS.f17_keeper.fightLimit).toBeUndefined();
    expect(SPOTS.f17_peak.fightLimit).toBeUndefined();
  });
});

describe('floor 17: monster levels', () => {
  const levels = (id: string) => SPOTS[id].encounters!.map((e) => e.level);

  it('has fixed levels, no dynamic ones', () => {
    // Dynamic levels are the band's (`dynamicLevel`); a line can also rise with a stat.
    expect(BANDS.ascent_aberrant.dynamicLevel).toBeUndefined();
    for (const s of f17Spots()) {
      for (const e of s.encounters ?? []) {
        expect(e.levelRise, `${s.id} ${e.monsterId}`).toBeUndefined();
        expect(e.once, `${s.id} ${e.monsterId}`).toBeFalsy();
      }
    }
  });

  it('puts plain lines at 40 to 42, rising by zone', () => {
    const plain = (id: string) =>
      SPOTS[id].encounters!.filter((e) => !e.boss && !e.sky && e.monsterId !== 'malgeri_legionary').flatMap((e) => e.level);
    const range = (ids: string[]) => {
      const all = ids.flatMap(plain);
      return [Math.min(...all), Math.max(...all)];
    };
    expect(range(['f17_landing', 'f17_cave_hub', 'f17_central_caves'])).toEqual([40, 41]);
    expect(range(['f17_east_mouth', 'f17_east_ascent', 'f17_east_peak', 'f17_east_ridge', 'f17_west_ridge', 'f17_west_peak'])).toEqual([41, 42]);
    expect(range(['f17_base', 'f17_path', 'f17_old_path'])).toEqual([42, 42]);
  });

  it('puts the queen at 43, the peak boss at 44, the gate boss at 45 and its escorts at 42 to 43', () => {
    expect(levels('f17_nest')).toEqual([[43, 43]]);
    expect(levels('f17_peak')).toEqual([[44, 44]]);
    const keeper = SPOTS.f17_keeper.encounters!;
    expect(keeper.find((e) => e.monsterId === 'malgeri_slime_king')!.level).toEqual([45, 45]);
    expect(keeper.find((e) => e.monsterId === 'malgeri_legionary')!.level).toEqual([42, 43]);
  });

  it('flags the three bosses, and keeps a sky-less, daypart-less line on each boss and clear spot', () => {
    for (const id of ['f17_nest', 'f17_peak', 'f17_keeper']) {
      const lines = SPOTS[id].encounters!;
      expect(lines.some((e) => e.boss), id).toBe(true);
      expect(lines.some((e) => !e.sky && !e.daypart), id).toBe(true);
    }
  });
});

describe('floor 17: the sky lines', () => {
  it('has seven open-sky hunt spots, each with the same shape', () => {
    // The old name says seven; the old list, like this one, holds six.
    expect(openHunts().map((s) => s.id).sort()).toEqual(
      ['f17_east_ascent', 'f17_east_peak', 'f17_east_ridge', 'f17_old_path', 'f17_path', 'f17_west_ridge'].sort(),
    );
  });

  it('gives each one a slime line per front, each beside plain lines', () => {
    for (const spot of openHunts()) {
      const lines = spot.encounters!;
      const plain = lines.filter((e) => !e.sky);
      expect(plain.length, spot.id).toBeGreaterThanOrEqual(2);
      for (const [kind, slime] of Object.entries(SKY_SLIMES)) {
        const line = lines.find((e) => e.monsterId === slime);
        expect(line, `${spot.id} ${slime}`).toBeDefined();
        expect(line!.sky, `${spot.id} ${slime}`).toEqual([kind]);
      }
    }
  });

  it('gives each one calm lines: groups of 2 to 3 at 46 to 48, four times the plain weight, calm only', () => {
    for (const spot of openHunts()) {
      const lines = spot.encounters!;
      const calm = lines.filter((e) => e.sky?.includes('calm'));
      expect(calm.map((e) => e.monsterId).sort(), spot.id).toEqual([...CALM_TRIO].sort());
      for (const e of calm) {
        expect(e.sky, `${spot.id} ${e.monsterId}`).toEqual(['calm']);
        expect(e.level, `${spot.id} ${e.monsterId}`).toEqual([46, 48]);
      }
      expect(sum(calm), spot.id).toBe(4 * sum(lines.filter((e) => !e.sky)));
    }
  });

  it('keeps sky lines and calm lines off every roofed spot', () => {
    for (const spot of f17Spots().filter((s) => s.tags?.includes('indoor'))) {
      for (const e of spot.encounters ?? []) expect(e.sky, `${spot.id} ${e.monsterId}`).toBeUndefined();
    }
  });

  it('makes the calm trio elite, in groups of 2 or 3, escorting each other', () => {
    for (const id of CALM_TRIO) {
      const def = MONSTERS[id];
      expect(def.tier, id).toBe('elite');
      expect(def.group, id).toMatchObject({ min: 2, max: 3 });
      expect(def.escorts, id).toEqual(CALM_TRIO);
      expect(def.veil, id).toEqual([{ type: 'stat', key: CALM_SEEN_KEY, value: 1 }]);
      expect(dropsAmber(id), id).toBe(true);
    }
    expect(MATERIALS.ridge_amber).toBeDefined();
  });

  it('drops Ridge Amber only from the calm trio', () => {
    for (const id of Object.keys(MONSTERS)) {
      expect(dropsAmber(id), id).toBe(CALM_TRIO.includes(id));
    }
  });

  it('rolls the calm lines only under a calm open sky, and never indoors', () => {
    const k = gameAt('f17_east_ridge', CALM_TICK);
    expect(skyKindAt(reads(k), 'f17_east_ridge')).toBe('calm');
    const calmIds = (spotId: string) =>
      eligibleEncounters(reads(k) as never, siteOf(spotId))
        .filter((e) => CALM_TRIO.includes(e.monsterId))
        .map((e) => e.monsterId);
    expect(calmIds('f17_east_ridge').sort()).toEqual([...CALM_TRIO].sort());
    for (const id of ['f17_east_mouth', 'f17_west_peak', 'f17_base', 'f17_cave_hub']) expect(calmIds(id), id).toEqual([]);
    // Each front over the same spot rolls its own slime line and none of the calm trio.
    for (const [kind, slime] of Object.entries(SKY_SLIMES)) {
      let tick = -1;
      for (let cell = 0; cell < 24 * 400 && tick < 0; cell++) {
        if (weatherAt(SEED, REGIONS.malgeri_range, cell * 3600)?.kind === kind) tick = cell * 3600;
      }
      expect(tick, kind).toBeGreaterThanOrEqual(0);
      patch(k, (slices) => (slices.clock.totalTicks = tick));
      expect(skyKindAt(reads(k), 'f17_east_ridge'), kind).toBe(kind);
      const ids = eligibleEncounters(reads(k) as never, siteOf('f17_east_ridge')).map((e) => e.monsterId);
      const skyed = ids.filter((id) => Object.values(SKY_SLIMES).includes(id));
      expect(skyed, kind).toEqual([slime]);
      expect(ids.some((id) => CALM_TRIO.includes(id)), kind).toBe(false);
      expect(ids.length, kind).toBeGreaterThan(1);
    }
  });

  it('starts uncleared: a new save has neither the peak nor the floor cleared', () => {
    const k = gameAt('f17_peak');
    expect(spotCleared(reads(k), SPOTS.f17_peak)).toBe(false);
    expect(clearMet(ladderReader(reads(k)), FLOOR)).toBe(false);
  });
});

describe('floor 17: the disclosure rule', () => {
  const NAMES = /calm|ridge wolf|cairn brute|hollow seer|ridge amber|\bwolves\b|\bseers?\b|\bbrutes?\b/i;
  /** The text of a spot: name, description, find and activity lines, road labels. */
  const spotText = (s: SpotDef): string[] => [
    s.name,
    s.desc,
    ...(s.finds ?? []).map((f) => f.desc ?? ''),
    ...s.activities.map((a) => a.name),
    ...s.connections.flatMap((c) => [c.label ?? '', c.returnLabel ?? '']),
  ];
  const hits = (texts: { key: string; text: string }[]) => texts.filter((e) => NAMES.test(e.text));

  it("names none of it in the floor's spot, find, floor and band text, nor the neighbours that describe it", () => {
    const texts = [
      ...Object.values(SPOTS)
        .filter((s) => s.id.startsWith('f17_') || s.id === 'f16_arena')
        .flatMap((s) => spotText(s).map((text) => ({ key: s.id, text }))),
      { key: 'ascent_f17.name', text: FLOOR.name },
      { key: 'ascent_f17.desc', text: FLOOR.desc ?? '' },
      { key: 'ascent_aberrant.name', text: BANDS.ascent_aberrant.name },
      { key: 'ascent_aberrant.desc', text: BANDS.ascent_aberrant.desc ?? '' },
    ];
    expect(texts.length).toBeGreaterThan(40);
    expect(hits(texts)).toEqual([]);
  });

  it("names none of it in the hamlet's base dialogue or descriptions", () => {
    const people = NPC_LIST.filter((n) => n.id.startsWith('f17_'));
    expect(people.map((n) => n.id).sort()).toEqual(['f17_bren', 'f17_thora']);
    const texts = people.flatMap((n) => [n.name, n.desc, ...n.dialogue].map((text) => ({ key: n.id, text })));
    expect(hits(texts)).toEqual([]);
  });

  it("names none of it in the other Malgeri monsters' text", () => {
    const others = MONSTER_LIST.filter((m) => m.id.startsWith('malgeri_') && !CALM_TRIO.includes(m.id));
    expect(others).toHaveLength(13);
    const texts = others.flatMap((m) => [m.name, m.desc ?? ''].map((text) => ({ key: m.id, text })));
    expect(hits(texts)).toEqual([]);
  });

  it("puts the only NPC mention behind the captain's lore entry, on the first-calm flag", () => {
    expect(NPCS.f17_bren.lore).toEqual([{ requires: [{ type: 'stat', key: CALM_SEEN_KEY, value: 1 }], dialogue: expect.any(Array) }]);
    expect(NPCS.f17_thora.lore).toBeUndefined();
    const lore = NPC_LIST.flatMap((n) => (n.lore ?? []).map((entry, i) => ({ key: `${n.id}.lore.${i}.dialogue`, lines: entry.dialogue })));
    expect(lore.map((l) => l.key)).toEqual(['f17_bren.lore.0.dialogue']);
    expect(NAMES.test(lore[0].lines.join(' '))).toBe(true);
  });

  it("shows the captain's lore line after the flag and not before", () => {
    const k = gameAt('f17_hamlet_square');
    const shown = (id: string) => (k.view().systems[npcs.id] as NpcsView).here.find((n) => n.id === id)!.dialogue;
    const before = npcDialogue(conditionReader(reads(k)), NPCS.f17_bren);
    expect(before).toEqual(NPCS.f17_bren.dialogue);
    expect(before.some((l) => NAMES.test(l))).toBe(false);
    expect(shown('f17_bren')).toEqual(before);
    setStat(k, CALM_SEEN_KEY, 1);
    const after = npcDialogue(conditionReader(reads(k)), NPCS.f17_bren);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((l) => NAMES.test(l))).toBe(true);
    // New here: the people the UI reads say it too.
    expect(shown('f17_bren')).toEqual(after);
    expect(npcDialogue(conditionReader(reads(k)), NPCS.f17_thora)).toEqual(NPCS.f17_thora.dialogue);
  });

  it('new here: the people list says the captain’s lore line in its turn after the flag, and its Talk control greets him', () => {
    // The fourth line is said from tick 900 to 1199 of every 1,200 (old `dialogueLine`, 300 ticks a line).
    const tick = 4 * DIALOGUE_LINE_TICKS * 50 + 3 * DIALOGUE_LINE_TICKS;
    const k = gameAt('f17_hamlet_square', tick);
    const view = () => k.view().systems[npcs.id] as NpcsView;
    const html = () => render(PeopleList, { props: { people: view().here, onTalk: () => {} } }).body;
    // Before the flag Bren has three lines, and the same tick reads one of them.
    expect(view().here.find((n) => n.id === 'f17_bren')!.line).toBe(NPCS.f17_bren.dialogue[Math.floor(tick / DIALOGUE_LINE_TICKS) % 3]);
    expect(NAMES.test(html())).toBe(false);
    setStat(k, CALM_SEEN_KEY, 1);
    const bren = view().here.find((n) => n.id === 'f17_bren')!;
    expect(bren.line).toBe(NPCS.f17_bren.lore![0].dialogue[0]);
    expect(html()).toContain(`Says: “${bren.line}”`);
    // The Talk control is drawn for each person here (Bren alone: Thora stands at the forge) and sends the greeting.
    expect(view().here.map((n) => n.id)).toEqual(['f17_bren']);
    expect(html()).toMatch(/<button[^>]*>\s*<span data-npc="f17_bren">Talk<\/span>/);
    expect(k.dispatch(talkTo({ npc: 'f17_bren' })).ok).toBe(true);
    expect(view().here.find((n) => n.id === 'f17_bren')!.met).toBe(true);
    expect(html()).toMatch(/<button[^>]*disabled[^>]*>\s*<span data-npc="f17_bren">Met<\/span>/);
  });
});

describe('the veil on the calm monsters', () => {
  type Heard = { log: string[]; entries: string[] };
  /** Kill a species n times and return the log lines and entry events the kills sent. */
  const kill = (k: Kernel, id: string, n = 1): Heard => {
    const heard: Heard = { log: [], entries: [] };
    const stop = k.onEvent((ev) => {
      if (ev.type === 'log/line') heard.log.push((ev.payload as { msg: string }).msg);
      if (ev.type === 'bestiary/entry') heard.entries.push((ev.payload as { monster: string }).monster);
    });
    for (let i = 0; i < n; i++) {
      emit(k, enemyKilled, {
        entity: 'm:test',
        defId: id,
        name: id,
        level: 46,
        rewardLevel: 46,
        xp: 0,
        tags: [],
        lastHit: null,
        site: 'f17_east_ridge',
        boss: false,
        once: false,
      });
    }
    stop();
    return heard;
  };

  it('is veiled until the flag, and lifts with it', () => {
    const k = gameAt('f17_east_ridge');
    for (const id of CALM_TRIO) expect(isVeiled(reads(k), id), id).toBe(true);
    expect(isVeiled(reads(k), 'malgeri_goblin')).toBe(false);
    setStat(k, CALM_SEEN_KEY, 1);
    for (const id of CALM_TRIO) expect(isVeiled(reads(k), id), id).toBe(false);
  });

  it('counts a veiled kill and shows nothing for it: no entry, no log line, no XP, no count', () => {
    const k = gameAt('f17_east_ridge');
    const total = bestiaryProgress(reads(k), book(k)).total;
    const xpBefore = JSON.stringify(slice(k, 'skills'));
    const heard = kill(k, 'malgeri_ridge_wolf', 3);
    expect(book(k).entries.malgeri_ridge_wolf.kills).toBe(3);
    expect(book(k).entries.malgeri_ridge_wolf.firstKill).toBe(0);
    expect(book(k).entries.malgeri_ridge_wolf.facts).toEqual([]);
    expect(isDiscovered(reads(k), book(k), 'malgeri_ridge_wolf')).toBe(false);
    expect(heard).toEqual({ log: [], entries: [] });
    expect(counts(k)['bestiary:entries']).toBeUndefined();
    expect(JSON.stringify(slice(k, 'skills'))).toBe(xpBefore);
    expect(bestiaryProgress(reads(k), book(k))).toEqual({ known: 0, total });
  });

  it('keeps the book total free of the veiled species, and adds them when the veil lifts', () => {
    const k = gameAt('f17_east_ridge');
    const veiled = bestiaryProgress(reads(k), book(k)).total;
    setStat(k, CALM_SEEN_KEY, 1);
    expect(bestiaryProgress(reads(k), book(k)).total).toBe(veiled + CALM_TRIO.length);
  });

  it('opens the entry on the first kill after the veil lifts, once, counting the kills made before it', () => {
    const k = gameAt('f17_east_ridge');
    kill(k, 'malgeri_cairn_brute', 2);
    // The flag carried or loaded, not stamped: no event, so nothing opens yet.
    setStat(k, CALM_SEEN_KEY, 1);
    k.tick(5);
    // The veil is up: the two kills made under it count, and the book shows the species.
    expect(isDiscovered(reads(k), book(k), 'malgeri_cairn_brute')).toBe(true);
    // The entry itself (log line, XP, count) waits for the next kill.
    expect(book(k).entries.malgeri_cairn_brute.firstKill).toBe(0);
    const first = kill(k, 'malgeri_cairn_brute');
    expect(first.entries).toEqual(['malgeri_cairn_brute']);
    expect(first.log.some((m) => m.includes('Cairn Brute'))).toBe(true);
    expect(book(k).entries.malgeri_cairn_brute.kills).toBe(3);
    expect(book(k).entries.malgeri_cairn_brute.firstKill).toBeGreaterThan(0);
    expect(counts(k)['bestiary:entries']).toBe(1);
    // The next kill is an ordinary one: no second entry.
    expect(kill(k, 'malgeri_cairn_brute').entries).toEqual([]);
    expect(counts(k)['bestiary:entries']).toBe(1);
  });

  it('opens the pending entries at the moment the first calm stamps the flag, not on the next kill', () => {
    // The calm minute lands on the fifth tick, so the kernel tick of the stamp is not 0.
    const k = gameAt('f17_east_ridge', CALM_TICK - 5);
    kill(k, 'malgeri_cairn_brute', 2);
    kill(k, 'malgeri_ridge_wolf');
    expect(counts(k)['bestiary:entries']).toBeUndefined();
    const entries: string[] = [];
    const log: string[] = [];
    const stop = k.onEvent((ev) => {
      if (ev.type === 'bestiary/entry') entries.push((ev.payload as { monster: string }).monster);
      if (ev.type === 'log/line') log.push((ev.payload as { msg: string }).msg);
    });
    // The first calm minute under an open sky.
    k.tick(5);
    expect(skyKindAt(reads(k), 'f17_east_ridge')).toBe('calm');
    expect(counts(k)[CALM_SEEN_KEY]).toBe(1);
    expect(entries.sort()).toEqual(['malgeri_cairn_brute', 'malgeri_ridge_wolf']);
    expect(counts(k)['bestiary:entries']).toBe(2);
    expect(book(k).entries.malgeri_cairn_brute.firstKill).toBeGreaterThan(0);
    expect(log.some((m) => m.includes('Cairn Brute'))).toBe(true);
    // A species killed only before the stamp and never opened stays out; the next kill is ordinary.
    expect(book(k).entries.malgeri_hollow_seer?.firstKill ?? 0).toBe(0);
    expect(kill(k, 'malgeri_cairn_brute').entries).toEqual([]);
    expect(counts(k)['bestiary:entries']).toBe(2);
    // The stamp is once: a second calm minute opens nothing.
    k.tick(TICKS_PER_MINUTE * 3);
    stop();
    expect(counts(k)['bestiary:entries']).toBe(2);
  });

  it('leaves an unveiled species alone: the first kill opens its entry as before', () => {
    const k = gameAt('f17_landing');
    expect(kill(k, 'malgeri_goblin').entries).toEqual(['malgeri_goblin']);
    expect(isDiscovered(reads(k), book(k), 'malgeri_goblin')).toBe(true);
    expect(book(k).entries.malgeri_goblin.kills).toBe(1);
  });
});

describe('the map badge', () => {
  it.todo('names the plain levels before the first calm, even under a calm sky (UI step: the map has no level badge, old `spotThreat`)');
  it.todo('adds the calm levels only after the flag, under a calm sky (UI step: the map has no level badge, old `spotThreat`)');
});

/**
 * The old forge validator's veil and lore rule (`forge/lib/validate.ts`,
 * mirrored from `tests/content.test.ts`) is `veilIssues` and `loreIssues`
 * here. The stand-in store is the registry with one monster and one person
 * swapped for edited copies.
 */
describe('the forge validator on veils and lore', () => {
  const refs = { skills: SKILLS, quests: QUESTS };
  const issues = (swap: { monster?: (typeof MONSTER_LIST)[number]; npc?: (typeof NPC_LIST)[number] } = {}) => [
    ...veilIssues(
      MONSTER_LIST.map((m) => (swap.monster && m.id === swap.monster.id ? swap.monster : m)),
      refs,
    ),
    ...loreIssues(
      NPC_LIST.map((n) => (swap.npc && n.id === swap.npc.id ? swap.npc : n)),
      refs,
    ),
  ];

  it('says nothing about the live veils and lore', () => {
    expect(issues()).toEqual([]);
  });

  it('reports an empty veil, and a veil naming an unknown skill or quest', () => {
    const wolf = MONSTERS.malgeri_ridge_wolf;
    expect(issues({ monster: { ...wolf, veil: [] } }).map((i) => i.message)).toEqual(['an empty veil hides nothing']);
    const bad = issues({
      monster: {
        ...wolf,
        veil: [
          { type: 'skill', id: 'no_such_skill', level: 1 },
          { type: 'quest', id: 'no_such_quest' },
        ],
      },
    });
    expect(bad.map((i) => i.message)).toEqual(["condition names unknown skill 'no_such_skill'", "condition names unknown quest 'no_such_quest'"]);
  });

  it('reports a lore entry with no conditions or no lines', () => {
    const bren = NPCS.f17_bren;
    const found = issues({
      npc: { ...bren, lore: [{ requires: [], dialogue: ['x'] }, { requires: bren.lore![0].requires, dialogue: [] }] },
    });
    expect(found.map((i) => i.message)).toEqual(['lore entry 0 has no conditions: it would always show', 'lore entry 1 has nothing to say']);
  });
});
