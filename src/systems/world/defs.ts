/**
 * The location registries and what is read from them with no state: regions,
 * areas, spots, the roads between spots. Port of the location half of the old
 * `registry.ts` and of the types `RegionDef`, `AreaDef`, `SpotDef`,
 * `Connection`, `ActivityDef`, `SpotFind`, `SearchReward`, `ExploreGate`.
 */
import { registry, s, type Ctx, type RecordOf } from '../../kernel';
import type { EncounterLine } from '../combat';
import { conditionSchema, type Condition } from '../counters';
import type { ModifierTierId } from '../monsters';
import type { AttributeId, DerivedStats } from '../stats';
import areasData from './content/areas.json';
import keyItemsData from './content/key_items.json';
import regionsData from './content/regions.json';
import spotsData from './content/spots.json';
import type { Reads, WorldState } from './engine';

// ---- schemas ----

const conditions = s.optional(s.array(conditionSchema));
const mapPin = s.object({ x: s.number(), y: s.number() });

export const regions = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    world: s.optional(mapPin),
    terrain: s.optional(s.ref('terrains', { help: 'Climate terrain. Default: plains.' })),
    sky: s.optional(s.ref('sky_tables', { help: 'Weather by fronts and a calm spell.' })),
    sheltered: s.optional(s.boolean({ help: 'Roofed: no wind, no precipitation.' })),
    mapped: s.optional(s.boolean({ help: 'No fog: one spot discovered discovers all.' })),
    tags: s.optional(s.array(s.string())),
  }),
  regionsData,
  'Regions',
);

export const areas = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    regionId: s.ref('regions'),
    sheltered: s.optional(s.boolean({ help: 'Overrides the region. `false` is open sky.' })),
    skyRegionId: s.optional(s.ref('regions', { help: 'The region whose sky this area stands under.' })),
    tags: s.optional(s.array(s.string())),
    scene: s.optional(s.enum(['town', 'hall', 'crypt', 'cistern', 'webs'])),
  }),
  areasData,
  'Areas',
);

const factor = s.object({
  attr: s.optional(s.string()),
  stat: s.optional(s.string()),
  skill: s.optional(s.string()),
  weight: s.number(),
  base: s.optional(s.number()),
});

const payload = {
  desc: s.optional(s.string()),
  material: s.optional(s.object({ id: s.ref('materials'), qty: s.optional(s.number({ min: 1 })) })),
  item: s.optional(s.ref('items')),
  keyItem: s.optional(s.ref('key_items')),
  rune: s.optional(s.ref('runes')),
  gold: s.optional(s.object({ min: s.number(), max: s.number() }, { help: 'Inclusive roll.' })),
  skillXp: s.optional(s.object({ tags: s.array(s.string()), xp: s.number() })),
  stat: s.optional(s.object({ key: s.string(), amount: s.optional(s.number()), set: s.optional(s.number()) })),
  requires: conditions,
};

const activity = s.object({
  id: s.id(),
  kind: s.enum(['rest', 'hunt', 'train', 'search', 'explore', 'job', 'gather']),
  name: s.string(),
  icon: s.string(),
  attr: s.optional(s.string({ help: 'train: the attribute trained.' })),
  ticksPer: s.optional(s.number({ min: 1, help: 'search, job, gather: base ticks per cycle.' })),
  gold: s.optional(s.number({ help: 'job: pay per cycle.' })),
  material: s.optional(s.ref('materials', { help: 'gather: the material.' })),
  requires: conditions,
  rewards: s.optional(
    s.array(
      s.object({
        id: s.id(),
        weight: s.number({ min: 0 }),
        limit: s.optional(s.number({ min: 1 })),
        guaranteedBy: s.optional(s.number({ min: 1 })),
        ...payload,
      }),
    ),
  ),
  speedFactors: s.optional(s.array(factor)),
  outputFactors: s.optional(s.array(factor)),
  outputCap: s.optional(s.number()),
  staticTime: s.optional(s.boolean()),
  attrXp: s.optional(s.array(s.object({ attr: s.string(), weight: s.number() }))),
  tags: s.optional(s.array(s.string())),
  drops: s.optional(
    s.array(
      s.object({
        material: s.ref('materials'),
        chance: s.number({ min: 0, max: 1 }),
        qty: s.optional(s.number({ min: 1 })),
        quality: s.optional(s.string()),
        rarer: s.optional(s.number()),
        unique: s.optional(s.boolean()),
      }),
    ),
  ),
});

const connection = s.object({
  to: s.ref('spots'),
  ticks: s.number({ min: 1 }),
  revealWhen: conditions,
  oneWay: s.optional(s.boolean()),
  forced: s.optional(s.boolean({ help: 'Arriving along this road starts a fight that cannot be fled.' })),
  requires: conditions,
  hidden: s.optional(s.boolean({ help: 'Hidden until the source spot is fully explored.' })),
  label: s.optional(s.string()),
  returnLabel: s.optional(s.string()),
});

const encounter = s.object({
  monsterId: s.ref('monsters'),
  weight: s.number({ min: 0 }),
  level: s.array(s.number({ min: 1 })),
  requires: conditions,
  daypart: s.optional(s.enum(['day', 'night'])),
  sky: s.optional(s.array(s.string())),
  boss: s.optional(s.boolean()),
  window: s.optional(s.object({ min: s.number(), max: s.number() })),
  once: s.optional(s.boolean()),
  levelRise: s.optional(s.object({ stat: s.string(), share: s.number(), ceiling: s.number() })),
});

export const spots = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    areaId: s.ref('areas'),
    desc: s.string(),
    activities: s.array(activity),
    encounters: s.optional(s.array(encounter)),
    fightLimit: s.optional(s.number({ integer: true, min: 1 })),
    stampOnClear: s.optional(s.string()),
    scene: s.optional(s.enum(['town', 'hall', 'crypt', 'cistern', 'webs'])),
    caged: s.optional(s.boolean({ help: 'Bestiary: a kill here grants each fact at its minKills, no roll.' })),
    healBetweenBouts: s.optional(s.object({ maxAttrTotal: s.number() }, { help: 'Not read until step 3.' })),
    dare: s.optional(
      s.object(
        { monsterId: s.ref('monsters'), level: s.number(), every: s.number(), desc: s.string() },
        { help: 'Not read until step 3.' },
      ),
    ),
    modifierWeights: s.optional(
      s.object({
        normal: s.optional(s.number()),
        demiboss: s.optional(s.number()),
        boss: s.optional(s.number()),
        aberrant: s.optional(s.number()),
      }),
    ),
    groupWeights: s.optional(s.array(s.object({ size: s.number({ min: 1 }), weight: s.number({ min: 0 }) }))),
    exploreTicks: s.optional(s.number({ min: 1 })),
    finds: s.optional(
      s.array(
        s.object({
          id: s.id(),
          at: s.number({ min: 0, max: 1 }),
          spot: s.optional(s.ref('spots', { help: 'Marks this spot discovered.' })),
          path: s.optional(s.ref('spots', { help: 'Opens the hidden road to this spot.' })),
          ...payload,
        }),
      ),
    ),
    exploreGates: s.optional(s.array(s.object({ at: s.number(), requires: s.array(conditionSchema), desc: s.optional(s.string()) }))),
    recipes: s.optional(s.array(s.string(), { help: 'Not read until crafting exists.' })),
    benches: s.optional(s.array(s.string(), { help: 'Not read until the benches exist.' })),
    map: s.optional(mapPin),
    waypoint: s.optional(s.boolean()),
    tags: s.optional(s.array(s.string())),
    forced: s.optional(s.boolean({ help: 'Arriving by any road starts a fight that cannot be fled.' })),
    connections: s.array(connection),
  }),
  spotsData,
  'Spots',
);

export const keyItems = registry(
  s.object({ id: s.id(), name: s.string(), icon: s.string(), desc: s.string() }),
  keyItemsData,
  'Key items',
);

// ---- types ----

export type RegionDef = RecordOf<typeof regions>;
export type AreaDef = RecordOf<typeof areas>;
export type KeyItemDef = RecordOf<typeof keyItems>;

/**
 * `craft` is synthesized from a spot's `recipes` by the craft provider
 * (`registerCraftKind`). The spot schema does not accept it: content cannot
 * author a craft activity.
 */
export type ActivityKind = 'rest' | 'hunt' | 'train' | 'search' | 'explore' | 'job' | 'gather' | 'craft';

export interface ActivityFactor {
  attr?: AttributeId;
  stat?: string;
  skill?: string;
  weight: number;
  base?: number;
}

export interface ActivityDrop {
  material: string;
  chance: number;
  qty?: number;
  quality?: string;
  rarer?: number;
  unique?: boolean;
}

/** What a find or a search reward hands over. */
export interface FindPayload {
  id: string;
  desc?: string;
  material?: { id: string; qty?: number };
  item?: string;
  keyItem?: string;
  rune?: string;
  gold?: { min: number; max: number };
  skillXp?: { tags: string[]; xp: number };
  stat?: { key: string; amount?: number; set?: number };
  requires?: Condition[];
}

export interface SpotFind extends FindPayload {
  /** Share of `exploreTicks` done before it turns up. */
  at: number;
  spot?: string;
  path?: string;
}

export interface SearchReward extends FindPayload {
  weight: number;
  limit?: number;
  guaranteedBy?: number;
}

export interface ActivityDef {
  id: string;
  kind: ActivityKind;
  name: string;
  icon: string;
  attr?: AttributeId;
  ticksPer?: number;
  gold?: number;
  material?: string;
  requires?: Condition[];
  rewards?: SearchReward[];
  speedFactors?: ActivityFactor[];
  outputFactors?: ActivityFactor[];
  outputCap?: number;
  staticTime?: boolean;
  attrXp?: { attr: AttributeId; weight: number }[];
  tags?: string[];
  drops?: ActivityDrop[];
  /** craft: the recipe worked. Set only on a synthesized craft activity. */
  recipe?: string;
}

export interface Connection {
  to: string;
  ticks: number;
  revealWhen?: Condition[];
  oneWay?: boolean;
  forced?: boolean;
  requires?: Condition[];
  hidden?: boolean;
  label?: string;
  returnLabel?: string;
}

/** A road as travel sees it: a connection with its source. */
export interface Edge extends Connection {
  from: string;
  /** A ride of the ladder, not a road. */
  ride?: true;
  /** The rung a ride ends at. */
  toIndex?: number;
}

export interface ExploreGate {
  at: number;
  requires: Condition[];
  desc?: string;
}

export interface SpotDef {
  id: string;
  name: string;
  icon: string;
  areaId: string;
  desc: string;
  activities: ActivityDef[];
  encounters?: EncounterLine[];
  fightLimit?: number;
  stampOnClear?: string;
  scene?: string;
  caged?: boolean;
  healBetweenBouts?: { maxAttrTotal: number };
  dare?: { monsterId: string; level: number; every: number; desc: string };
  modifierWeights?: Partial<Record<ModifierTierId, number>>;
  groupWeights?: { size: number; weight: number }[];
  exploreTicks?: number;
  finds?: SpotFind[];
  exploreGates?: ExploreGate[];
  recipes?: string[];
  benches?: string[];
  map?: { x: number; y: number };
  waypoint?: boolean;
  tags?: string[];
  forced?: boolean;
  connections: Connection[];
}

// ---- lookups ----

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((r) => [r.id, r]));

export const REGIONS: Record<string, RegionDef> = byId(regionsData as RegionDef[]);
export const AREAS: Record<string, AreaDef> = byId(areasData as AreaDef[]);
export const SPOTS: Record<string, SpotDef> = byId(spotsData as unknown as SpotDef[]);
export const KEY_ITEMS: Record<string, KeyItemDef> = byId(keyItemsData as KeyItemDef[]);

/** Where a new character stands. */
export const STARTING_SPOT = 'f0_cell';

/** The spot, or a throw for an id no spot has. */
export function getSpot(id: string): SpotDef {
  const spot = SPOTS[id];
  if (!spot) throw new Error(`no spot has the id "${id}"`);
  return spot;
}

/**
 * The roads out of every spot. Every road that is not `oneWay` is mirrored.
 * The mirror carries `returnLabel` (or `label`) and never `forced`,
 * `requires`, `revealWhen` or `hidden`. A mirror is not added where the
 * reverse road is declared. The old `buildAdjacency`.
 */
export function buildAdjacency(all: Iterable<{ id: string; connections: Connection[] }>): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  const add = (from: string, c: Connection) => {
    const list = adj.get(from) ?? [];
    if (!list.some((e) => e.to === c.to)) list.push({ ...c, from });
    adj.set(from, list);
  };
  for (const spot of all) {
    for (const c of spot.connections) {
      add(spot.id, c);
      if (!c.oneWay) add(c.to, { to: spot.id, ticks: c.ticks, ...((c.returnLabel ?? c.label) ? { label: c.returnLabel ?? c.label } : {}) });
    }
  }
  return adj;
}

export const ADJACENCY: Map<string, Edge[]> = buildAdjacency(Object.values(SPOTS));

const NO_EDGES: Edge[] = [];

export function edgesFrom(spotId: string): Edge[] {
  return ADJACENCY.get(spotId) ?? NO_EDGES;
}

/** The region of a spot. */
export function regionOf(spotId: string): RegionDef | undefined {
  return REGIONS[AREAS[SPOTS[spotId]?.areaId]?.regionId];
}

/**
 * The region whose sky a spot stands under, with the area's `sheltered`
 * laid over the region's. The old `skyRegionOf`.
 */
export function skyRegionOf(spotId: string): RegionDef | undefined {
  const area = AREAS[SPOTS[spotId]?.areaId];
  const region = area && REGIONS[area.skyRegionId ?? area.regionId];
  if (!region || area.sheltered === undefined || area.sheltered === !!region.sheltered) return region;
  return { ...region, sheltered: area.sheltered };
}

/** The tags of a place: region, area and spot together. */
export function placeTags(spotId: string): Set<string> {
  const spot = SPOTS[spotId];
  const area = spot ? AREAS[spot.areaId] : undefined;
  const region = skyRegionOf(spotId);
  return new Set([...(region?.tags ?? []), ...(area?.tags ?? []), ...(spot?.tags ?? [])]);
}

/** Whether a spot sits in a mapped region. */
export function inMappedRegion(spotId: string): boolean {
  return !!regionOf(spotId)?.mapped;
}

/** "Region > Area > Spot". The old `locationBreadcrumb`. */
export function locationBreadcrumb(spotId: string): string {
  const spot = getSpot(spotId);
  const area = AREAS[spot.areaId];
  const region = REGIONS[area.regionId];
  return `${region.name} › ${area.name} › ${spot.name}`;
}

// ---- the craft kind ----

/**
 * What the system that owns recipes answers for the craft activities. The
 * world cannot import it (it imports the world), so it registers this at
 * module load: `crafting`. Same arrangement as `registerCardSpent`.
 */
export interface CraftKind {
  /** One craft activity per listed recipe it knows, in list order. Unknown ids are left out. */
  activities(recipeIds: readonly string[]): ActivityDef[];
  /** Base ticks of one craft, or undefined for an unknown recipe. */
  ticks(recipe: string): number | undefined;
  /** The recipe's `unlock` conditions are met. False for an unknown recipe. */
  unlocked(reads: Reads, recipe: string): boolean;
  /** A secret recipe not yet unlocked: not listed. The old `recipeHidden`. */
  hidden(reads: Reads, recipe: string): boolean;
  /** Some route of the recipe is affordable now. False for an unknown recipe. */
  affordable(reads: Reads, recipe: string): boolean;
  /** The line under the craft: its cost when unlocked, its requirement when not. */
  detail(reads: Reads, recipe: string): string;
  /**
   * One tick of the craft activity: the craft branch of the old `tickAction`.
   * False when the craft stopped (starved); the world clears the activity.
   */
  tick(ctx: Ctx<WorldState>, act: ActivityDef, stats: Readonly<DerivedStats>): boolean;
}

let craftKind: CraftKind | null = null;
let craftCache = new WeakMap<SpotDef, ActivityDef[]>();

/** Register the craft provider. Called once at module load by `crafting`. */
export function registerCraftKind(provider: CraftKind): void {
  if (craftKind) throw new Error('world: a craft kind is registered twice');
  craftKind = provider;
  craftCache = new WeakMap();
}

/** The registered craft provider, or null before `crafting` loads. */
export function craftProvider(): CraftKind | null {
  return craftKind;
}

/**
 * The activities of a spot: its own, then one craft activity per recipe it
 * lists that the craft provider knows. Without a provider, its own. The old
 * `spotActivities`.
 */
export function spotActivities(spot: SpotDef): ActivityDef[] {
  if (!craftKind || !spot.recipes?.length) return spot.activities;
  let all = craftCache.get(spot);
  if (!all) {
    all = [...spot.activities, ...craftKind.activities(spot.recipes)];
    craftCache.set(spot, all);
  }
  return all;
}

/** The one hunt of a spot, or null with none or several. The old `soleCombatActivity`. */
export function soleCombatActivity(spot: SpotDef): ActivityDef | null {
  const hunts = spot.activities.filter((a) => a.kind === 'hunt');
  return hunts.length === 1 ? hunts[0] : null;
}

/** Rest activities at a spot. */
export function restActivities(spot: SpotDef): ActivityDef[] {
  return spot.activities.filter((a) => a.kind === 'rest');
}

/** A spot with a rest anyone may use. */
export function isUnconditionalHaven(spot: SpotDef): boolean {
  return restActivities(spot).some((a) => !a.requires || a.requires.length === 0);
}
