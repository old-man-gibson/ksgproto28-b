/**
 * The combat slice and what goes in and out of it. Port of `CombatState`,
 * `MonsterInstance`, `SpotEncounter`, `FightLedger`, `HuntRest` and the
 * combat-read half of `SpotDef` in the old `types.ts`.
 */
import type { Condition } from '../counters';
import type { LevelRise } from '../levels';
import type { FeedEntry } from '../log';
import type { ModifierTierId, MonsterKit, MonsterRange, MonsterRarityId, TierId } from '../monsters';
import type { ExertionSpec } from '../resources';
import type { AttributeId, DamageType } from '../stats';

// ---- the site ----

/** One line of a site's encounter table. The old `SpotEncounter`. */
export interface EncounterLine {
  monsterId: string;
  weight: number;
  /** Lowest and highest level. */
  level: [number, number];
  /** The line waits for these conditions. */
  requires?: Condition[];
  /** The line rolls by day or by night only. */
  daypart?: 'day' | 'night';
  /** The line rolls under these skies only. Needs weather: port 6. */
  sky?: string[];
  /** A boss of the site: its kill bumps `boss:<site>`. */
  boss?: boolean;
  /** The line rolls only while player power over its own is inside the window. */
  window?: { min: number; max: number };
  /** The kill is recorded as `slain:<site>:<monster>` and the line never rolls again. */
  once?: boolean;
  levelRise?: LevelRise;
}

/**
 * Where fights are rolled from: what combat read of the old `SpotDef`, as
 * data. The world port builds one from its location registry. `levelStep`
 * and `dynamicLevel` are what the old code read from the floor's band.
 */
export interface EncounterSite {
  id: string;
  name: string;
  encounters: EncounterLine[];
  /** Weight per group size. Default: 1: 70, 2: 18, 3: 8, 4: 3, 5: 1. */
  groupWeights?: { size: number; weight: number }[];
  /** Weight per modifier tier. Default: the registry weights. */
  modifierWeights?: Partial<Record<ModifierTierId, number>>;
  /** Wins before the site is cleared. */
  fightLimit?: number;
  /** Counter set to 1 when the site is cleared. */
  stampOnClear?: string;
  /** Levels the band adds to a table-rolled spawn (old `bandLevelStep`). */
  levelStep?: number;
  /** The band's dynamic-level rule (old `BandDef.dynamicLevel`). */
  dynamicLevel?: { factor: number; capShare: number };
  /** Line written to the log when the site is cleared, before the standard one. */
  clearedMsg?: string;
}

// ---- the fight ----

/** A monster in a fight. The old `MonsterInstance`; its conditions are in the `statuses` slice under `entity`. */
export interface Enemy {
  /** Kernel entity id, `m<n>`. Never reused. */
  entity: string;
  defId: string;
  name: string;
  icon: string;
  level: number;
  tier: TierId;
  modifier: ModifierTierId;
  rarity: MonsterRarityId;
  /** Its own attributes: book value grown to its level, jittered, scaled. */
  attrs: Record<AttributeId, number>;
  hp: number;
  range: MonsterRange;
  /** Action bar, 0 to 1000. */
  bar: number;
  /** Bar progress a ranged attacker in the front slot lost this fill. */
  stunSpent: number;
  xp: number;
  gold: number;
  /** Levels the dynamic-level rule added. Rewards do not read them. */
  levelBonus?: number;
  /** Clock tick each rotation entry is ready again, by index. */
  cooldowns?: Record<number, number>;
  /** Times each rotation entry has fired, by index. */
  spent?: Record<number, number>;
  /** Martial position. Absent: neutral. */
  position?: string;
  /** A burned mind: its notional mana while below full. */
  mana?: number;
  kit?: MonsterKit;
  /** The damage type of the last blow that hurt it. */
  lastHit?: DamageType;
}

/** The live fight. The old `CombatState`, without the fields of unported systems. */
export interface Fight {
  /** Five slots. Slot 0 is the centre: the only one the player's blows reach. */
  enemies: (Enemy | null)[];
  playerBar: number;
  momentum: number;
  position: string;
  cooldowns: Record<string, number>;
  /** Clock tick of the last time each trigger event happened. */
  events: Record<string, number>;
  forced?: boolean;
  /** What the last parry or landed blow took off the incoming damage. */
  prevented?: { onHit?: number; onParry?: number };
  /** Rotation entries already reported as skipped, so the skip log gets one line per entry. */
  reported?: Record<string, true>;
  /** Ticks of the opening address left. The fight waits while it is above 0. */
  introTicks?: number;
}

export const NEUTRAL_POSITION = 'neutral';

// ---- the ledger ----

export type FightOutcome = 'won' | 'knocked_out' | 'dead';

export interface LedgerSource {
  key: string;
  label: string;
  icon: string;
  amount: number;
  hits: number;
}

/** The fight ledger. Every field adds to a bucket; none grows with time. */
export interface FightLedger {
  outcome: FightOutcome;
  cause?: string;
  /** Negated start tick while open; the duration once closed. */
  ticks: number;
  endedAt: number;
  /** Site id, or '' for damage taken outside a fight. */
  spot: string;
  foes: { defId: string; name: string; icon: string; level: number; count: number }[];
  incoming: LedgerSource[];
  stopped: { absorbed: number; parried: number; riposted: number; dodged: number; parries: number; dodges: number };
  healed: Record<string, number>;
  healRefused: number;
  outgoing: { damage: number; hits: number; kills: number };
  afflictions: { id: string; name: string; icon: string; intensity: number }[];
  transcript: FeedEntry[];
}

export interface NotebookEntry {
  id: number;
  keptAt: number;
  ledger: FightLedger;
}

// ---- the rest rule ----

export interface HuntRest {
  /** Share of max HP under which the hunt rests first. 0 is off. */
  at: number;
  /** Rest to full, or back to the threshold. */
  toFull: boolean;
  active: boolean;
}

// ---- style ----

/** The exertion of the style fought in, as the styles system states it. */
export interface StyleExertion extends ExertionSpec {
  on: 'attack' | 'defend';
  ramp?: { per: number; cap: number };
}

export interface StyleState {
  id: string;
  exertion?: StyleExertion;
}

// ---- the slice ----

export interface CombatState {
  fight: Fight | null;
  site: EncounterSite | null;
  hunting: boolean;
  respawnTimer: number;
  ledger: FightLedger | null;
  lastFight: FightLedger | null;
  notebook: NotebookEntry[];
  huntRest: HuntRest;
  style: StyleState;
  /** The player's explicit order of actives. The old `state.skillOrder`. */
  rotation: string[];
  nextEntity: number;
}
