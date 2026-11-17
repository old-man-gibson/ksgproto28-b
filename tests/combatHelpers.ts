/**
 * Shared set-up of the ported combat tests.
 *
 * The old tests stood on spots of the location registry. A spot that is in
 * this repository (floors 0 to 6, Threshold) is read from the world registry
 * as the encounter site the world system sends. A spot that is not here yet
 * (the shelved countryside, the hold, floor 17) is data in
 * `tests/sitesOutside.json`, written by `scripts/dump-outside-sites.mjs`
 * from the old repository.
 *
 * `keepHunting` is for tests that send `combat/hunt` directly, with no hunt
 * activity for the knockout return to resume: after a defeat the hunt is
 * off, and once the recovery of the knockout system is over it sends the
 * hunt again.
 */
import type { Ctx, Kernel, KernelOptions } from '../src/kernel';
import combat, {
  hunt,
  spawnMonster,
  startStaged,
  type CombatState,
  type EncounterSite,
  type Enemy,
  type SpawnOverride,
  type StagedMember,
} from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import type { FeedEntry, LogState } from '../src/systems/log';
import type { ResourcesState } from '../src/systems/resources';
import { statBlockOf, type DerivedStats } from '../src/systems/stats';
import { ask, equip, makeGame, patch, reads, run, setMods, slice } from './helpers';
import { bandDynamicLevel } from '../src/systems/ladder';
import { SPOTS, type WorldState } from '../src/systems/world';
import sitesOutside from './sitesOutside.json';

type TestSite = EncounterSite & { forced?: boolean };

/** The site of a spot of the world registry, as `siteOf` builds it, plus `forced`. No band here has level steps. */
function siteOfSpot(id: string): TestSite {
  const spot = SPOTS[id];
  const dynamicLevel = bandDynamicLevel(spot.areaId);
  return {
    id: spot.id,
    name: spot.name,
    encounters: spot.encounters ?? [],
    ...(spot.groupWeights ? { groupWeights: spot.groupWeights } : {}),
    ...(spot.modifierWeights ? { modifierWeights: spot.modifierWeights } : {}),
    ...(spot.fightLimit ? { fightLimit: spot.fightLimit } : {}),
    ...(spot.stampOnClear ? { stampOnClear: spot.stampOnClear } : {}),
    ...(dynamicLevel ? { dynamicLevel } : {}),
    ...(spot.forced ? { forced: true } : {}),
  };
}

/** Every spot with an encounter table, by id, and the six tables of spots that are not here yet. */
export const SITES: Record<string, TestSite> = {
  ...(sitesOutside as unknown as Record<string, TestSite>),
  ...Object.fromEntries(
    Object.values(SPOTS)
      .filter((spot) => spot.encounters?.length)
      .map((spot) => [spot.id, siteOfSpot(spot.id)]),
  ),
};

/** The share of max HP the old recovery ran to (`RECOVER_THRESHOLD`). */
export const RECOVER_THRESHOLD = 0.6;

export function combatOf(kernel: Kernel): CombatState {
  return slice<CombatState>(kernel, 'combat');
}

export function counterOf(kernel: Kernel, key: string): number {
  return slice<CountersState>(kernel, 'counters').counts[key] ?? 0;
}

export function hpOf(kernel: Kernel): number {
  return slice<ResourcesState>(kernel, 'resources').values.hp;
}

export function feedOf(kernel: Kernel): FeedEntry[] {
  return slice<LogState>(kernel, 'log').combatFeed;
}

export function logOf(kernel: Kernel): string[] {
  return slice<LogState>(kernel, 'log').log.map((entry) => entry.msg);
}

export function playerStats(kernel: Kernel): Readonly<DerivedStats> {
  return statBlockOf(reads(kernel));
}

/** The stat block of a live enemy. */
export function enemyStats(kernel: Kernel, e: Pick<Enemy, 'entity'>): Readonly<DerivedStats> {
  return statBlockOf(reads(kernel), e.entity);
}

/** The enemy in the centre slot. Throws when no fight is open. */
export function frontEnemy(kernel: Kernel): Enemy {
  const front = combatOf(kernel).fight?.enemies[0];
  if (!front) throw new Error('no enemy in the centre slot');
  return front;
}

/** A character with the rusty sword in hand, hunting at a site. The old `huntingGame`. */
export function huntingGame(seed = 7, site: string | EncounterSite = 'woods_edge', options: Partial<KernelOptions> = {}): Kernel {
  const kernel = makeGame({ seed, ...options });
  equip(kernel, 1); // rusty sword
  const result = kernel.dispatch(hunt({ site: typeof site === 'string' ? SITES[site] : site }));
  if (!result.ok) throw new Error(result.reason);
  return kernel;
}

/**
 * After a defeat the hunt is off and the knockout system rests the
 * character. Once it has recovered, hunt again.
 */
export function keepHunting(kernel: Kernel, site: string | EncounterSite): void {
  const c = combatOf(kernel);
  if (c.hunting || c.fight) return;
  if (slice<WorldState>(kernel, 'world').recovering) return;
  kernel.dispatch(hunt({ site: typeof site === 'string' ? SITES[site] : site }));
}

/**
 * Mint a monster outside a fight, as the old tests called `spawnMonster`.
 * The context is the probe's with a scratch slice for the entity counter;
 * the monster is in no fight, so its stats are read from its attributes.
 */
export function spawn(kernel: Kernel, site: string | EncounterSite, override?: SpawnOverride): Enemy {
  return run(kernel, (ctx) => {
    const scratch = Object.create(ctx) as Ctx<CombatState>;
    Object.defineProperty(scratch, 'state', { value: { nextEntity: 100000 } });
    return spawnMonster(scratch, typeof site === 'string' ? SITES[site] : site, override);
  });
}

/** Start a staged fight and return its enemies in slot order. */
export function stage(kernel: Kernel, members: StagedMember[], site: EncounterSite = { id: 'staged', name: 'Staged', encounters: [] }): Enemy[] {
  ask(kernel, startStaged, { site, members });
  return combatOf(kernel).fight!.enemies.filter((e): e is Enemy => e !== null);
}

/** Change the open fight directly, for test setup. */
export function patchFight(kernel: Kernel, change: (state: CombatState) => void): void {
  patch(kernel, (slices) => change(slices.combat as CombatState));
}

/** Set the player's health directly, for test setup. */
export function setHp(kernel: Kernel, hp: number): void {
  patch(kernel, (slices) => {
    (slices.resources as ResourcesState).values.hp = hp;
  });
}

export { combat };

// ---- spine port 5: the player side of the registered kinds ----
//
// Nothing in the running game gives the player a technique or a spell yet
// (learning and the book are step 3). A test writes the ledger and the book
// directly.

/** Put a technique in the ledger. The old test helper `learn`. */
export function learn(kernel: Kernel, id: string, form: 'rough' | 'canonical' | 'syncretic' = 'canonical', executions = 0): void {
  patch(kernel, (slices) => {
    slices.martial.techniques[id] = { executions, form };
  });
}

/** Write a spell into the book, prepared unless told otherwise. Returns its rotation id (`grimoire:<uid>`). */
export function inscribe(
  kernel: Kernel,
  source: { school: 'arcane'; words: string[] } | { school: 'divine'; litany: string },
  options: { prepared?: boolean; name?: string } = {},
): string {
  let uid = 0;
  patch(kernel, (slices) => {
    const book = slices.spellcraft;
    uid = book.nextUid++;
    book.grimoire.push({
      uid,
      source,
      ...(options.name ? { name: options.name } : {}),
      ...(options.prepared === false ? {} : { prepared: true }),
    });
  });
  return `grimoire:${uid}`;
}

/** Set a resource pool directly, for test setup. */
export function setPool(kernel: Kernel, id: string, value: number): void {
  patch(kernel, (slices) => {
    (slices.resources as ResourcesState).values[id as keyof ResourcesState['values']] = value;
  });
}

/** Give every enemy of the open fight a health far above what the test deals, and the same maximum. */
export function hardenFoes(kernel: Kernel, hp = 1e7): void {
  for (const e of combatOf(kernel).fight?.enemies ?? []) {
    if (e) setMods(kernel, [{ stat: 'stats/maxHp', kind: 'add', value: hp }], e.entity);
  }
  patchFight(kernel, (state) => {
    for (const e of state.fight?.enemies ?? []) if (e) e.hp = hp;
  });
}

/** The skip-log reasons of one action. */
export function skipsOf(kernel: Kernel, action: string): string[] {
  return kernel
    .skips()
    .filter((entry) => entry.action === action)
    .map((entry) => entry.reason);
}
