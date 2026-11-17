/**
 * Shared set-up of the ported combat tests.
 *
 * The old tests stood on spots of the location registry. Locations arrive
 * with the world port; until then the encounter tables of those spots are
 * data in `tests/sites.json`, written by `scripts/dump-test-sites.mjs` from
 * the old repository.
 *
 * The knockout (1 HP, forced rest, recovery) is the world port's too.
 * `keepHunting` stands in for it where an old test relied on the character
 * getting back up: it rests the character at the rest rate until the old
 * recovery threshold and sends the hunt again.
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
import { setPace, type ResourcesState } from '../src/systems/resources';
import { statBlockOf, type DerivedStats } from '../src/systems/stats';
import { ask, emit, equip, makeGame, patch, reads, run, slice } from './helpers';
import sitesData from './sites.json';

export const SITES = sitesData as unknown as Record<string, EncounterSite & { forced?: boolean }>;

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
 * Stand-in for the knockout and its recovery. After a defeat the hunt is
 * off: rest at the rest rate until the old threshold, then hunt again.
 */
export function keepHunting(kernel: Kernel, site: string | EncounterSite): void {
  const c = combatOf(kernel);
  if (c.hunting || c.fight) return;
  const share = hpOf(kernel) / playerStats(kernel).maxHp;
  if (share < RECOVER_THRESHOLD) {
    emit(kernel, setPace, { hpMult: 15, healKind: 'rest', resting: true });
    return;
  }
  emit(kernel, setPace, { hpMult: 1, healKind: 'idle', resting: false });
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
