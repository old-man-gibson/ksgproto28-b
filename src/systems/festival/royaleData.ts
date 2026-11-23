/**
 * The royale's tables and dials (step 4 port C5): the royale part of old
 * `data/festival.data.ts` and all of `data/survivors.data.ts`. The records
 * are this system's registries (`content/royale_*.json`,
 * `content/survivor_*.json`, declared in `index.ts`); this file types them
 * and holds the dials, so the pure modules (`royaleMap.ts`,
 * `royaleTerrain.ts`, `royaleField.ts`, `survivorGen.ts`, `royaleView.ts`)
 * read them without importing the declaration.
 */
import { MINUTES_PER_HOUR, TICKS_PER_GAME_MINUTE } from '../clock';
import type { MonsterCast, MonsterRange } from '../monsters';
import type { AttributeId, DamageType } from '../stats';
import type { ContentApplication } from '../statuses';
import royaleCachesData from './content/royale_caches.json';
import royaleDensData from './content/royale_dens.json';
import royaleSectionsData from './content/royale_sections.json';
import royaleStrategiesData from './content/royale_strategies.json';
import survivorArchetypesData from './content/survivor_archetypes.json';
import survivorFamiliesData from './content/survivor_families.json';
import survivorSpeciesData from './content/survivor_species.json';
import type { FestivalFoe } from './rules';

const TICKS_PER_HOUR = TICKS_PER_GAME_MINUTE * MINUTES_PER_HOUR;

// ---- record types ----

/**
 * Where a royale strategy walks its fighter: toward the nearest fighter,
 * toward the weakest one within sight, to the field's centre, away from the
 * nearest, to the nearest edge, nowhere, to the nearest known open cache, to a
 * point in another section, or to the nearest section with cover.
 */
export type RoyaleMove = 'nearest' | 'weakest' | 'centre' | 'away' | 'edge' | 'hold' | 'loot' | 'roam' | 'cover';
export const ROYALE_MOVES: readonly RoyaleMove[] = ['nearest', 'weakest', 'centre', 'away', 'edge', 'hold', 'loot', 'roam', 'cover'];

/**
 * A way to move on the royale's field. The player ranks up to three; every
 * survivor species fights with a list from the same registry. The first
 * strategy in a list whose `when` holds decides the move.
 */
export interface RoyaleStrategyDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  move: RoyaleMove;
  /**
   * Applies only while these hold: the bearer's health share is below
   * `hpBelow`, and more than `fieldAbove` (or fewer than `fieldBelow`)
   * survivors are left on the field, the player not counted.
   */
  when?: { hpBelow?: number; fieldAbove?: number; fieldBelow?: number };
}

/**
 * A section of the royale's field: terrain that changes how fast a fighter
 * walks and how far it sees. Where each section lies is generated per attempt
 * (`royaleMap.ts`); a cell no section takes is open meadow (pace 1, sight 1).
 */
export interface RoyaleSectionDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Walking pace multiplier for a fighter standing in it. */
  pace: number;
  /** Sight multiplier for a fighter standing in it. */
  sight: number;
  /** A fighter standing in it is seen at COVER_SIGHT of the looker's range. */
  cover?: boolean;
  /** Health share a free fighter regains per tick standing in it (the glade's spring). */
  heal?: number;
}

/**
 * A one-time find on the royale's field: the first fighter to reach it takes
 * it, once an attempt. Exactly one of `item`, `weapon` and `heal`. A player's
 * item is lent for the attempt (`FestivalRun.lent`). Its place is generated
 * per attempt, inside `section`.
 */
export interface RoyaleCacheDef {
  id: string;
  name: string;
  icon: string;
  /** The section it stands in, for scouting and the map. */
  section: string;
  /** In the village: the kind of building it stands in (smithy, bakery, guard_post, house). */
  building?: string;
  /** An item id, lent to the player for the attempt. */
  item?: string;
  /** A weapon of the player's issued family (CACHE_WEAPONS), lent for the attempt. */
  weapon?: boolean;
  /** A share of health back, at once. */
  heal?: number;
  /** Shut until this den is cleared. */
  den?: string;
}

/**
 * Monsters holding a place on the royale's field. They never leave it: a
 * fighter that comes within `radius` of the den's place (generated per
 * attempt inside `section`) fights them. Pinned levels.
 */
export interface RoyaleDenDef {
  id: string;
  name: string;
  icon: string;
  section: string;
  radius: number;
  foes: FestivalFoe[];
}

/** A royale survivor species: its share of strength in duels and the strategies it moves by. `id` is the monster. */
export interface SurvivorSpeciesDef {
  id: string;
  weight: number;
  plan: string[];
}

/**
 * How a weapon family fights. `damageType` and `range` are what a blow of the
 * family deals and from where; `techniques` are the technique ids a survivor
 * of the family draws from, every one a damaging move a monster rotation can
 * run. `signature` are the ones that make the family what it is; they are
 * drawn three times as often.
 */
export interface SurvivorFamily {
  id: string;
  damageType: DamageType;
  range: MonsterRange;
  techniques: string[];
  signature: string[];
}

/**
 * One working a caster or priest can draw. `group` keeps one build from
 * drawing two of the same element or school.
 */
export interface SurvivorWorking {
  cast: MonsterCast;
  group: string;
}

/**
 * A kind of fighter. `family` and `weapons` give its weapon (empty = bare
 * hands); `range` overrides the family's reach. `armor` is a range in monster
 * armour units at level 1: it grows 5% a level. `attrs` are multipliers on
 * the species' attributes, scaled back so the total is kept. `power` is a
 * bonus in levels for duels between survivors. `keepsFocus` archetypes never
 * trade their weapon for a loose one of another family. `species` weights how
 * often each survivor species draws it; a species not listed draws at weight
 * 1. (The old table keyed `species` by monster id; here it is a list, since
 * the content schema has no map.)
 */
export interface SurvivorArchetype {
  id: string;
  name: string;
  family: string;
  weapons: string[];
  range?: MonsterRange;
  armor: [number, number];
  resistances?: Partial<Record<DamageType, number>>;
  inflicts?: ContentApplication[];
  attrs: Partial<Record<AttributeId, number>>;
  power: number;
  keepsFocus?: boolean;
  /** Workings drawn into the rotation, ahead of the techniques. */
  workings?: { pool: SurvivorWorking[]; count: number };
  /** A self-mending kept in the rotation after the techniques, with this many uses. */
  mending?: number;
  species: { monsterId: string; weight: number }[];
}

// ---- the registries, typed ----

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((r) => [r.id, r]));

/** The strategies, by id, in registry order. */
export const ROYALE_STRATEGIES: Record<string, RoyaleStrategyDef> = byId(royaleStrategiesData as RoyaleStrategyDef[]);
/**
 * The field's sections, by id. Registry order is the index the map's cells
 * store: the cliff along the far edge, the waterfall under it, the river from
 * the waterfall to the near edge with a bank either side, the cave in a far
 * corner, the glade inside the forest in the west, the village in the east.
 */
export const ROYALE_SECTIONS: Record<string, RoyaleSectionDef> = byId(royaleSectionsData as RoyaleSectionDef[]);
/** The field's dens: monsters that never leave their place, put inside the den's section by the map. */
export const ROYALE_DENS = royaleDensData as RoyaleDenDef[];
/**
 * The field's caches: taken once an attempt by whoever reaches them first. A
 * player's item or weapon is lent for the attempt. Thirty-five, none in the
 * river; a village cache stands in a building of its own kind, one cache to a
 * building, and a guarded cache beside its den.
 */
export const ROYALE_CACHES = royaleCachesData as RoyaleCacheDef[];
/** The survivor species, in equal shares, each with the strategies it fights with. */
export const SURVIVOR_SPECIES = survivorSpeciesData as SurvivorSpeciesDef[];
export const SURVIVOR_FAMILIES: Record<string, SurvivorFamily> = byId(survivorFamiliesData as SurvivorFamily[]);
export const SURVIVOR_ARCHETYPES = survivorArchetypesData as unknown as SurvivorArchetype[];

// ---- dials ----

/** The champion: the last survivor, fought alone. */
export const SURVIVOR_CHAMPION = 'ph_survivor_champion';

/**
 * The field. Units are field units on a square `size` across, drawn
 * isometrically. A fighter walks `speed` a tick (the player's pace is scaled
 * by their travel speed) and picks where to walk every `thinkTicks`. Two
 * fighters closer than `engageRadius` fight: two survivors duel for
 * `duelTicks` and the loser falls; survivors who reach the player, up to
 * `maxGroup` of them, are the player's next fight. A duel's winner is wounded
 * by `duelWound` of its health and recovers `healPerTick`. `sight` is how far
 * a fighter standing on open ground sees (sections scale it) and how far
 * `weakest` looks. Survivors are scattered at least `spread` apart and
 * `cacheClear` from every cache (both relaxed together if placement runs out
 * of tries), `startClear` from the player's start and `denMargin` beyond
 * every den's radius. `cacheReach` is how close a fighter must come to take a
 * cache. Caches are hidden: a survivor notices an open one only within
 * `cacheNotice`. Each tool a survivor holds adds `toolBonus` levels to its
 * strength in duels, up to `toolCap` tools. `denPack` is the share of its
 * other foes' level a den adds to its strongest foe's (`denPower`).
 */
export const ROYALE_FIELD = {
  size: 180,
  speed: 0.2,
  thinkTicks: 5,
  engageRadius: 2.5,
  maxGroup: 3,
  duelTicks: 100,
  duelWound: 0.35,
  healPerTick: 0.002,
  sight: 20,
  spread: 8,
  startClear: 30,
  denMargin: 3,
  cacheClear: 12,
  cacheNotice: 3,
  cacheReach: 1.5,
  toolBonus: 0.5,
  toolCap: 4,
  denPack: 0.4,
};

/** The player's strategies until they rank their own. */
export const DEFAULT_ROYALE_PLAN = ['fall_back_hurt', 'loot_while_crowded', 'press_nearest'];

/** Strategies a player may rank at once. */
export const ROYALE_PLAN_SLOTS = 3;

/** The layout a field is made for; a saved field from an older one is replaced whole. */
export const ROYALE_LAYOUT_VERSION = 3;

/** One festival hour without a fight and a fighter knows where the nearest enemy is (the radar). */
export const RADAR_TICKS = TICKS_PER_HOUR;

/** A fighter standing in a section with cover is seen at this share of the looker's range. */
export const COVER_SIGHT = 0.5;

/**
 * A den's strength in a duel with a survivor, on the survivors' scale (a
 * level): its strongest foe's level, plus `ROYALE_FIELD.denPack` of each
 * other foe's.
 */
export function denPower(den: { foes: readonly { level: number }[] }): number {
  const levels = den.foes.map((f) => f.level).sort((a, b) => b - a);
  return levels.reduce((sum, level, i) => sum + (i === 0 ? level : level * ROYALE_FIELD.denPack), 0);
}

/**
 * The weapon a `weapon` cache lends, by the player's issued family: one step
 * above that family's starter. The festival's own weapons are lent by caches
 * only; the sword family uses the catalog's iron sword. Bare hands get iron
 * gauntlets.
 */
export const CACHE_WEAPONS: Record<string, string> = {
  unarmed: 'iron_gauntlets',
  sword: 'iron_sword',
  spear: 'festival_spear',
  dagger: 'festival_dagger',
  blunt: 'festival_mace',
  greatsword: 'festival_greatsword',
  staff: 'festival_staff',
  bow: 'festival_bow',
};

// ---- survivors (old `data/survivors.data.ts`) ----

/**
 * The family an item belongs to, by its tags: the first family here whose id
 * is among them. A katana is also tagged sword, so katana comes first.
 */
export const SURVIVOR_FAMILY_ORDER = ['katana', 'greatsword', 'spear', 'dagger', 'bow', 'staff', 'blunt', 'sword'];

/** Conditions a particular weapon adds to its wielder's blows. */
export const SURVIVOR_WEAPON_INFLICTS: Record<string, ContentApplication[]> = {
  ember_knife: [{ id: 'on_fire', intensity: 1, chance: 0.2 }],
};

/** The self-mending a priest brings and a healing tool becomes: a miracle that closes the caster's own wounds. */
export const SURVIVOR_MENDING: MonsterCast = { school: 'divine', litany: 'litany_mending' };

/**
 * What the tools a survivor took from caches add to its build.
 *
 *  - A kit's armour is a level-1 figure that grows 5% a level, while an item's
 *    is flat, so a worn piece adds its armour divided by the level factor at
 *    the survivors' starting level plus their ten days of growth.
 *  - `accessoryArmor`: a level-1 armour figure per accessory.
 *  - `armorCap`: the most level-1 armour a build can wear.
 *  - `heals`: at most this many healing tools count; each is a one-use mending.
 *  - `power`: bonus levels for duels. A weapon adds its quality over
 *    `weaponPer` (to `weaponMax`), a worn piece `piece` plus its armour times
 *    `perArmor`, an accessory or a heal a flat amount; the total is held to
 *    `cap`.
 */
export const SURVIVOR_TOOLS = {
  accessoryArmor: 1,
  armorCap: 12,
  heals: 2,
  power: { cap: 6, weaponPer: 14, weaponMax: 2.5, piece: 0.3, perArmor: 0.05, accessory: 0.3, heal: 0.3 },
};

/**
 * Personal names, built from syllables in three places: first, middle (often
 * none) and last. A field walks each list in its own stride, so no two
 * survivors on one field share a name. That needs the three lists' lengths
 * pairwise coprime (25, 7 and 16), which `tests/survivorGen.test.ts` checks.
 */
export const SURVIVOR_NAME_FIRST = [
  'Tam', 'Bran', 'Cor', 'Dal', 'Ed', 'Fen', 'Gar', 'Hal', 'Iv', 'Jor', 'Kel', 'Lor', 'Mar',
  'Nor', 'Os', 'Per', 'Quen', 'Ros', 'Sel', 'Tav', 'Ul', 'Ver', 'Wil', 'Yor', 'Ber',
];
export const SURVIVOR_NAME_MID = ['', 'a', 'e', 'i', 'o', 'u', 'er'];
export const SURVIVOR_NAME_LAST = [
  'sin', 'wyn', 'ric', 'dan', 'mund', 'lin', 'ard', 'wick',
  'ley', 'ton', 'vel', 'dis', 'na', 'ra', 'ta', 'len',
];

// ---- the field's saved shape ----

/** One survivor on the royale's field. Coordinates are field units, 0 to the field's size. */
export interface FieldFighter {
  id: number;
  /** Its species, a monster id from SURVIVOR_SPECIES. */
  monsterId: string;
  x: number;
  y: number;
  /** Coarse health share, 0 to 1: duels between survivors wound the winner. */
  hp: number;
  /** Duels won on the field. Each adds to its level when it meets the player. */
  wins: number;
  /**
   * In a duel with another survivor (the foe's id) or with a den (`den`, and
   * `foe` 0), and the world tick it ends.
   */
  duel?: { foe: number; until: number; den?: string };
  /** In the player's fight. */
  engaged?: boolean;
  /** Where it is walking, chosen every few ticks. */
  goal?: { x: number; y: number };
  /** World tick its last fight ended (duel or den); absent = the royale's start. The radar reads it. */
  lastFight?: number;
  /**
   * Item ids this survivor took from caches: they count in its duels and join
   * its kit (`survivorGen.ts`) when it fights the player. Its generated build
   * is not saved: it is rebuilt from the field's seed, its id and its species.
   */
  tools?: string[];
}

/**
 * The royale's field (`royaleField.ts` runs it, `royale.ts` hands its
 * engagements to combat): the survivors still standing and the player's place
 * among them.
 */
export interface RoyaleField {
  size: number;
  fighters: FieldFighter[];
  player: {
    x: number;
    y: number;
    /** Where the player was sent by hand; the strategies resume on arrival. */
    target?: { x: number; y: number };
    goal?: { x: number; y: number };
    /** World tick the player's last fight on the field ended; absent = the royale's start. The radar reads it. */
    lastFight?: number;
  };
  /** Survivors who have fallen to other survivors or to dens. */
  fallen: number;
  /** ROYALE_LAYOUT_VERSION the field was made for. A field with an older one is replaced whole on the next tick. */
  layout?: number;
  /** The seed its terrain was generated from (`royaleMap.ts`). Only the seed is saved; the map is rebuilt from it. */
  seed?: number;
  /** World tick the field opened: the radar's clock for anyone who has not fought yet. */
  openedAt?: number;
  /** Cache ids taken this attempt, by anyone. */
  taken?: string[];
  /** Den ids cleared this attempt, by anyone. */
  cleared?: string[];
  /** Section ids the player has stood in this attempt. */
  seen?: string[];
  /** The den the player is fighting, while that fight lasts. */
  denFight?: string;
}
