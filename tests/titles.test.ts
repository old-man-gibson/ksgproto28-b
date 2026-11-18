/**
 * Port of the old `tests/titles.test.ts`, and new cases for what the divine
 * port added to titles (the veto waiver is in `tests/spellcraft.test.ts`).
 *
 * Call shape:
 * - The old kill (`bus.emit({ type: 'kill' })`, whose listener bumped
 *   `kills`) is `combat/kill` followed by the counter bumps, in the order
 *   combat emits them (`kill`). The check runs after both.
 * - `checkTitleUnlocks(state, bus)` is the event `titles/check`;
 *   `hasTitle(state, id)` reads the titles slice; `g.setTitle(id)` and
 *   `setTitle(state, bus, id)` are the command `titles/wear`.
 * - `getDerivedStats(state).damage` is `statOf(reads, 'damage')`.
 * - `state.stats[key]` is the counters slice, written with `patch`.
 *
 * `it.todo`:
 * - "weapon families are tracked once each from combat attacks": the old
 *   case hunts on `woods_edge`, shelved content. The counter is written by
 *   combat (`used:<family>`, `weapon:families`); its test belongs to combat.
 * - "save migration v6 → v7 adds title fields": the save starts at version
 *   1 here.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { enemyKilled } from '../src/systems/combat';
import { bumpCounter, type CountersState } from '../src/systems/counters';
import type { LogState } from '../src/systems/log';
import { factValue, statOf } from '../src/systems/stats';
import { checkTitles, hasTitle, TITLE_LIST, titles, wearTitle, type TitlesState } from '../src/systems/titles';
import { emit, makeGame, patch, reads, run, slice } from './helpers';

const fresh = (seed: number): Kernel => makeGame({ seed });
const titlesOf = (g: Kernel) => slice<TitlesState>(g, 'titles');
const earned = (g: Kernel, id: string) => hasTitle(titlesOf(g), id);

function setCounters(g: Kernel, values: Record<string, number>): void {
  patch(g, (slices) => Object.assign((slices.counters as CountersState).counts, values));
}

/** A kill as combat reports it: the event, then the kill counters. */
function killEvent(g: Kernel, defId: string): void {
  run(g, (ctx) => {
    ctx.emit(enemyKilled, {
      entity: 'enemy:test',
      defId,
      name: defId,
      level: 5,
      rewardLevel: 5,
      xp: 1,
      tags: [],
      lastHit: null,
      site: 'test',
      boss: false,
      once: false,
    });
    ctx.emit(bumpCounter, { key: 'kills' });
    ctx.emit(bumpCounter, { key: `kills:${defId}` });
  });
}

const wear = (g: Kernel, id: string | null) => g.dispatch(wearTitle({ title: id }));

describe('title unlocks', () => {
  it('simple threshold titles latch on the completing event', () => {
    const g = fresh(80);
    setCounters(g, { kills: 99 });
    expect(earned(g, 'slayer')).toBe(false);

    killEvent(g, 'forest_rat'); // kills → 100
    expect(earned(g, 'slayer')).toBe(true);
    expect(slice<LogState>(g, 'log').log.some((l) => l.msg.includes('Title earned'))).toBe(true);
  });

  it('complex purity deed: boss kill with ≤1 weapon family earns; 2 families does not', () => {
    const pure = fresh(81);
    setCounters(pure, { 'weapon:families': 1 });
    killEvent(pure, 'goblin_boss');
    expect(earned(pure, 'first_blade')).toBe(true);

    const impure = fresh(82);
    setCounters(impure, { 'weapon:families': 2 });
    killEvent(impure, 'goblin_boss');
    expect(earned(impure, 'first_blade')).toBe(false);

    // Breaking the restraint after earning never revokes the title.
    setCounters(pure, { 'weapon:families': 5 });
    emit(pure, checkTitles, undefined);
    expect(earned(pure, 'first_blade')).toBe(true);
  });

  it('passive bonuses apply once earned; equipped bonuses only while worn', () => {
    const g = fresh(83);
    const base = statOf(reads(g), 'damage');

    setCounters(g, { kills: 100 });
    emit(g, checkTitles, undefined);
    expect(earned(g, 'slayer')).toBe(true);
    const withPassive = statOf(reads(g), 'damage');
    expect(withPassive).toBeCloseTo(base * 1.02, 5); // slayer passive +2%

    expect(wear(g, 'slayer').ok).toBe(true);
    expect(statOf(reads(g), 'damage')).toBeCloseTo(base * 1.02 * 1.05, 5); // +5% worn
    expect(wear(g, null).ok).toBe(true);
    expect(statOf(reads(g), 'damage')).toBeCloseTo(withPassive, 5);
    expect(g.staleStats()).toEqual([]);
  });

  it('unearned titles cannot be worn', () => {
    const g = fresh(84);
    const result = wear(g, 'slayer');
    expect(result.ok ? '' : result.reason).toBe('Slayer is not earned');
    expect(titlesOf(g).worn).toBeNull();
  });

  it.todo('weapon families are tracked once each from combat attacks (shelved woods_edge; the counter is combat)');
  it.todo('save migration v6 → v7 adds title fields (the save starts at version 1)');
});

describe('titles of the divine port', () => {
  it('the content is the old eleven, and every unlock condition is well formed', () => {
    expect(TITLE_LIST).toHaveLength(11);
    expect(titles).toBeDefined();
    expect(TITLE_LIST.filter((t) => t.defiesDogma).map((t) => t.id)).toEqual(['iconoclast']);
  });

  it('Iconoclast: ten miracles learned, latched on the next check; spirit always, the waiver only worn', () => {
    const g = fresh(85);
    const spirit = statOf(reads(g), 'maxSpirit');
    setCounters(g, { 'miracles:learned': 10 });
    // No check has run: the old build checked on kills, arrivals, level-ups.
    expect(earned(g, 'iconoclast')).toBe(false);
    emit(g, checkTitles, undefined);
    expect(earned(g, 'iconoclast')).toBe(true);
    expect(statOf(reads(g), 'maxSpirit')).toBeCloseTo(spirit + 5, 6);
    expect(factValue(reads(g), 'defiesDogma')).toBe(0);
    expect(wear(g, 'iconoclast').ok).toBe(true);
    expect(factValue(reads(g), 'defiesDogma')).toBe(1);
    const again = wear(g, 'iconoclast');
    expect(again.ok ? '' : again.reason).toBe('Iconoclast is already worn');
    expect(g.staleStats()).toEqual([]);
  });

  it('Iron Stomach: an earned immunity is stated as the statuses system reads it', () => {
    const g = fresh(86);
    setCounters(g, { 'food:spoiled': 25 });
    emit(g, checkTitles, undefined);
    expect(earned(g, 'iron_stomach')).toBe(true);
    expect(factValue(reads(g), 'statusImmune:queasy', PLAYER)).toBe(1);
  });

  it('an earned title is listed; a secret one only once earned', () => {
    const g = fresh(87);
    const ids = () => (g.view().systems.titles as { rows: { id: string }[] }).rows.map((r) => r.id);
    expect(ids()).toContain('slayer');
    expect(ids()).not.toContain('iconoclast');
    setCounters(g, { 'miracles:learned': 10 });
    emit(g, checkTitles, undefined);
    expect(ids()[0]).toBe('iconoclast');
  });
});
