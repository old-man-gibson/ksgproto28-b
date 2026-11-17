/**
 * Port of the old `tests/huntrest.test.ts`: rest before the next fight. The
 * cases keep their names.
 *
 * Call shape changes: `g.setHuntRest(at, toFull)` is the command
 * `combat/set-hunt-rest`; the site is the Cages table from
 * `tests/sites.json`; `restingForFight` reads the combat slice.
 *
 * Not ported: `returnRecoverTarget` (it reads the pending return of the
 * knockout: port 6). The old file had no case for it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import combat, { restingForFight, setHuntRest } from '../src/systems/combat';
import { applyStatus, STATUSES, type StatusDef } from '../src/systems/statuses';
import { combatOf, hpOf, huntingGame, playerStats, setHp } from './combatHelpers';
import { ask, makeGame, reads } from './helpers';

/** Hunting the Cages between fights, at `hp` share of max. */
function hunting(hp: number, seed = 3): Kernel {
  const g = huntingGame(seed, 'the_cages');
  setHp(g, playerStats(g).maxHp * hp);
  return g;
}
const share = (g: Kernel) => hpOf(g) / playerStats(g).maxHp;
const resting = (g: Kernel) => restingForFight(reads(g).read(combat));

describe('rest before the next fight', () => {
  afterEach(() => {
    delete (STATUSES as Record<string, StatusDef>).test_no_mending;
  });

  it('is off by default: a hunt at 20% HP rolls its next fight at once', () => {
    const g = hunting(0.2);
    g.tick();
    expect(combatOf(g).fight).not.toBeNull();
  });

  it('below the threshold the hunt rests first, at the rest rate, then fights at full', () => {
    const g = hunting(0.2);
    g.dispatch(setHuntRest({ at: 0.5, toFull: true }));
    g.tick();
    expect(combatOf(g).fight).toBeNull();
    expect(resting(g)).toBe(true);
    // Resting heals at the rest multiplier (15 times a hunt's lull).
    const stats = playerStats(g);
    const before = hpOf(g);
    g.tick();
    expect(hpOf(g) - before).toBeGreaterThan((stats.hpRegen / 10) * 10);
    for (let i = 0; i < 20000 && !combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).fight).not.toBeNull();
    expect(resting(g)).toBe(false);
    expect(share(g)).toBeGreaterThan(0.99);
  });

  it('"until the threshold" stops resting at the threshold', () => {
    const g = hunting(0.2);
    g.dispatch(setHuntRest({ at: 0.5, toFull: false }));
    for (let i = 0; i < 20000 && !combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).fight).not.toBeNull();
    expect(share(g)).toBeGreaterThanOrEqual(0.5);
    expect(share(g)).toBeLessThan(0.6);
  });

  it('above the threshold nothing waits', () => {
    const g = hunting(0.8);
    g.dispatch(setHuntRest({ at: 0.5, toFull: true }));
    g.tick();
    expect(combatOf(g).fight).not.toBeNull();
  });

  it('never waits on a pool that cannot recover', () => {
    (STATUSES as Record<string, StatusDef>).test_no_mending = {
      id: 'test_no_mending',
      name: 'No Mending',
      icon: '🚫',
      desc: 'test',
      blocksRegen: ['hp'],
    } as StatusDef;
    const g = hunting(0.2);
    g.dispatch(setHuntRest({ at: 0.5, toFull: true }));
    ask(g, applyStatus, { entity: 'player', app: { id: 'test_no_mending', duration: 1000 }, source: 'test' });
    g.tick();
    expect(combatOf(g).fight).not.toBeNull();
  });

  it('the setting survives a save, and an older save without it loads as off', () => {
    const g = hunting(0.9);
    g.dispatch(setHuntRest({ at: 0.4, toFull: false }));
    const back = makeGame({ seed: 9 });
    expect(back.load(JSON.parse(JSON.stringify(g.save(0)))).ok).toBe(true);
    expect(combatOf(back).huntRest).toMatchObject({ at: 0.4, toFull: false });
    // There is no older save here: a new slice has the rule off.
    expect(combatOf(makeGame()).huntRest.at).toBe(0);
  });

  // New here: the health trickle goes back to the hunt's rate when resting ends.
  it('restores the pace when the rest ends or the hunt stops', () => {
    const g = hunting(0.2);
    g.dispatch(setHuntRest({ at: 0.5, toFull: false }));
    g.tick(2);
    const pace = () => (g.snapshot().slices.resources as { pace: { hpMult: number; healKind: string } }).pace;
    expect(pace()).toMatchObject({ hpMult: 15, healKind: 'rest' });
    g.dispatch(setHuntRest({ at: 0, toFull: false }));
    g.tick();
    expect(pace()).toMatchObject({ hpMult: 1, healKind: 'idle' });
  });
});
