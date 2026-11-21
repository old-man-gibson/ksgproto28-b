/**
 * Port of the old `tests/navigation.test.ts`: resume on return, go and do,
 * wayfinding.
 *
 * The old file stood on the shelved countryside: `village_square` (a rest and
 * a drill) beside `training_grounds` (three drills), and the two-leg road
 * `village_square`, `woods_edge`, `deep_woods`. The countryside is not ported.
 * The same structures in the content here:
 *
 * - `ironyard_gate` (`train_str_muster`) beside `long_gallery`
 *   (`train_dex_gallery`, `train_con_gallery`), 8 ticks.
 * - `ascent_foot`, `ironyard_gate`, `the_sand`: two legs, 12 and 8 ticks.
 * - `f4_treeline` beside `f4_woods_edge`: an undiscovered spot one visible
 *   road away. Threshold has no fog, so the case stands on floor 4.
 *
 * The old `Game.travelTo` was one hop (`startTravel`): `hop` here. The old
 * `Game.travelPlanTo` is the command `world/travel-to`.
 *
 * Banked idle time is the `bonus` system (step 4 port C2): its slice is read
 * for the old `state.bonusTime`. The old `setPaused` has no counterpart in the
 * kernel (a paused page runs no tick), so "banks nothing while paused" runs
 * no tick. Spending the bank (double speed) is the UI step: its two cases
 * stay `it.todo`.
 *
 * Not ported: the wayfinding boon (port 7).
 */
import { describe, expect, it } from 'vitest';
import { BONUS_CAP_TICKS, isIdle, type BonusState } from '../src/systems/bonus';
import { SKILLS, skillTrainedBy } from '../src/systems/skills';
import {
  activityXpTags,
  cancelPlan,
  findPath,
  goAndDoCommand,
  journeyEnd,
  selectActivity,
  setIntent,
  spotActivities,
  SPOTS,
  trainingSpots,
  travelTo,
} from '../src/systems/world';
import { makeGame, patch, reads, slice } from './helpers';
import { discover, gameAt, hop, patchWorld, sent, walkUntilStill, worldOf } from './worldHelpers';

describe('resume on return', () => {
  it('restarts the last activity chosen at a spot on arrival', () => {
    const g = gameAt(1, 'ironyard_gate');
    discover(g, 'long_gallery');
    expect(sent(g, selectActivity({ activity: 'train_str_muster' }))).toBe(true);
    expect(hop(g, 'long_gallery')).toBe(true);
    expect(worldOf(g).activity).toBeNull();
    walkUntilStill(g);
    expect(worldOf(g).spot).toBe('long_gallery');
    expect(worldOf(g).activity).toBeNull(); // never chose anything here

    expect(sent(g, selectActivity({ activity: 'train_con_gallery' }))).toBe(true);
    expect(hop(g, 'ironyard_gate')).toBe(true);
    walkUntilStill(g);
    expect(worldOf(g).activity).toBe('train_str_muster');

    expect(hop(g, 'long_gallery')).toBe(true);
    walkUntilStill(g);
    expect(worldOf(g).activity).toBe('train_con_gallery');
  });

  it('forgets a spot the player stopped working at by hand', () => {
    const g = gameAt(2, 'ironyard_gate');
    discover(g, 'long_gallery');
    sent(g, selectActivity({ activity: 'train_str_muster' }));
    sent(g, selectActivity({ activity: null }));
    expect(hop(g, 'long_gallery')).toBe(true);
    walkUntilStill(g);
    expect(hop(g, 'ironyard_gate')).toBe(true);
    walkUntilStill(g);
    expect(worldOf(g).spot).toBe('ironyard_gate');
    expect(worldOf(g).activity).toBeNull();
  });

  it('does not resume at an intermediate halt of a longer journey', () => {
    const g = gameAt(3, 'ascent_foot');
    discover(g, 'ironyard_gate', 'the_sand');
    patchWorld(g, (w) => {
      w.resumeActivity.ironyard_gate = 'train_str_muster';
    });
    expect(sent(g, travelTo({ to: 'the_sand' }))).toBe(true);
    for (let i = 0; i < 2000 && worldOf(g).spot !== 'ironyard_gate'; i++) g.tick();
    expect(worldOf(g).spot).toBe('ironyard_gate');
    expect(worldOf(g).travel).not.toBeNull(); // straight on to the next leg
    expect(worldOf(g).activity).toBeNull();
  });
});

describe('go and do', () => {
  it('walks there and starts the activity on arrival, over any resume entry', () => {
    const g = gameAt(4, 'ironyard_gate');
    discover(g, 'long_gallery');
    patchWorld(g, (w) => {
      w.resumeActivity.long_gallery = 'train_dex_gallery';
    });
    expect(sent(g, goAndDoCommand({ spot: 'long_gallery', activity: 'train_con_gallery' }))).toBe(true);
    expect(worldOf(g).travelIntent).toEqual({ spot: 'long_gallery', activity: 'train_con_gallery' });
    walkUntilStill(g);
    expect(worldOf(g).activity).toBe('train_con_gallery');
    expect(worldOf(g).travelIntent).toBeNull();
  });

  it('starts at once when already standing there', () => {
    const g = gameAt(5, 'ironyard_gate');
    expect(sent(g, goAndDoCommand({ spot: 'ironyard_gate', activity: 'train_str_muster' }))).toBe(true);
    expect(worldOf(g).activity).toBe('train_str_muster');
    expect(worldOf(g).travel).toBeNull();
  });

  it('refuses an activity the destination does not have', () => {
    const g = gameAt(6, 'ironyard_gate');
    discover(g, 'long_gallery');
    expect(sent(g, goAndDoCommand({ spot: 'long_gallery', activity: 'train_str_muster' }))).toBe(false);
    expect(worldOf(g).travel).toBeNull();
  });

  it('cancelling the journey drops the intent; a plain map walk carries none', () => {
    const g = gameAt(7, 'ascent_foot');
    discover(g, 'ironyard_gate', 'the_sand');
    expect(sent(g, goAndDoCommand({ spot: 'the_sand', activity: 'train_dex_sand' }))).toBe(true);
    expect(sent(g, cancelPlan())).toBe(true);
    expect(worldOf(g).travelIntent).toBeNull();
    walkUntilStill(g);
    expect(worldOf(g).spot).toBe('ironyard_gate');
    expect(worldOf(g).activity).toBeNull();

    patchWorld(g, (w) => {
      w.travelIntent = { spot: 'ascent_foot', activity: 'rest_foot' }; // stale
    });
    expect(sent(g, travelTo({ to: 'ascent_foot' }))).toBe(true);
    expect(worldOf(g).travelIntent).toBeNull();
  });

  it('the journey in progress can be given (or relieved of) a purpose', () => {
    const g = gameAt(8, 'ironyard_gate');
    discover(g, 'long_gallery');
    expect(hop(g, 'long_gallery')).toBe(true);
    expect(journeyEnd(worldOf(g))).toBe('long_gallery');
    expect(sent(g, setIntent({ activity: 'train_str_muster' }))).toBe(false); // not at that end
    expect(sent(g, setIntent({ activity: 'train_con_gallery' }))).toBe(true);
    walkUntilStill(g);
    expect(worldOf(g).activity).toBe('train_con_gallery');
  });

  it('routes to an unknown place one road past known ground', () => {
    const g = gameAt(9, 'f4_treeline');
    // f4_woods_edge is undiscovered but a visible road away.
    expect(worldOf(g).discovered).not.toContain('f4_woods_edge');
    expect(findPath(reads(g), worldOf(g), 'f4_treeline', 'f4_woods_edge')).toBeNull();
    expect(findPath(reads(g), worldOf(g), 'f4_treeline', 'f4_woods_edge', { unknownDest: true })).toEqual(['f4_woods_edge']);
    expect(sent(g, travelTo({ to: 'f4_woods_edge' }))).toBe(true);
    walkUntilStill(g);
    expect(worldOf(g).discovered).toContain('f4_woods_edge');
  });

  it('the intent survives a save mid-journey', () => {
    const g = gameAt(10, 'ironyard_gate');
    discover(g, 'long_gallery');
    expect(sent(g, goAndDoCommand({ spot: 'long_gallery', activity: 'train_con_gallery' }))).toBe(true);
    g.tick();
    const loaded = makeGame({ seed: 99 });
    expect(loaded.load(JSON.parse(JSON.stringify(g.save(0)))).ok).toBe(true);
    walkUntilStill(loaded);
    expect(worldOf(loaded).spot).toBe('long_gallery');
    expect(worldOf(loaded).activity).toBe('train_con_gallery');
  });
});

describe('banked idle time', () => {
  const banked = (g: ReturnType<typeof makeGame>) => slice<BonusState>(g, 'bonus').banked;

  it('banks one tick per idle tick and nothing while working', () => {
    const g = gameAt(11, 'ironyard_gate');
    expect(isIdle(reads(g))).toBe(true);
    for (let i = 0; i < 50; i++) g.tick();
    expect(banked(g)).toBe(50);
    expect(sent(g, selectActivity({ activity: 'train_str_muster' }))).toBe(true);
    for (let i = 0; i < 50; i++) g.tick();
    expect(banked(g)).toBe(50);
  });

  it('banks nothing while paused', () => {
    // A paused page runs no tick: there is no pause flag in the kernel.
    const g = gameAt(12, 'ironyard_gate');
    expect(banked(g)).toBe(0);
  });

  it('caps the bank', () => {
    const g = gameAt(13, 'ironyard_gate');
    patch(g, (s) => (s.bonus.banked = BONUS_CAP_TICKS));
    g.tick();
    expect(banked(g)).toBe(BONUS_CAP_TICKS);
  });

  it.todo('spending doubles working ticks, one banked tick each, and never spends on idleness (UI step: the double speed control)');
  it.todo('is off by default and the choice survives a save (UI step: the double speed control)');
});

describe('wayfinding', () => {
  it('lists discovered spots whose activities train a skill or an attribute', () => {
    const g = gameAt(16, 'long_gallery');
    // Strength trains at the muster yard, but only once the yard is known.
    expect(trainingSpots(reads(g), worldOf(g), { attr: 'str' })).toEqual([]);
    discover(g, 'ironyard_gate');
    const str = trainingSpots(reads(g), worldOf(g), { attr: 'str' });
    expect(str).toContainEqual({ spot: 'ironyard_gate', activity: 'train_str_muster' });
    expect(str.every((t) => t.spot === 'ironyard_gate')).toBe(true);
    expect(trainingSpots(reads(g), worldOf(g), { attr: 'dex' })).toContainEqual({ spot: 'long_gallery', activity: 'train_dex_gallery' });
  });

  it('a skill trains wherever an activity carries its tags — the same tags the tick pays', () => {
    const g = gameAt(17, 'ironyard_gate');
    discover(g, 'long_gallery', 'f4_woods_edge');
    const def = Object.values(SKILLS).find((s) => s.tags.includes('explore'))!;
    const spots = trainingSpots(reads(g), worldOf(g), { skill: def.id });
    expect(spots).toContainEqual({ spot: 'f4_woods_edge', activity: 'explore' });
    for (const t of spots) {
      const act = spotActivities(SPOTS[t.spot]).find((a) => a.id === t.activity)!;
      expect(skillTrainedBy(def, activityXpTags(act))).toBe(true);
    }
  });

  it.todo('is a boon: off on a fresh save, on once bought (port 7: prestige boons)');
});
