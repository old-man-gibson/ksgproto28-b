/**
 * Port of the old `tests/completability.test.ts`: degenerate play may
 * trivialize the game, it may not break it. No `NaN`, no `Infinity`, no save
 * that refuses to load, no tick that dies on the way through.
 *
 * Changed: the call shape only. A state is a kernel; `computeDerivedStats` is
 * the derived layer of the kernel and "the cached read agrees with the raw
 * one" is `kernel.staleStats()`, which recomputes every stat of every entity
 * and lists the ones whose stored value differs; `serialize` and
 * `deserialize` are `kernel.save` and `kernel.load` through JSON text;
 * `applyStatus` is the `statuses/apply` request. The fight stood on
 * `woods_edge` of the shelved countryside; it stands on the Woods Edge of
 * floor 4 here.
 *
 * The old note on duplicate instances of one condition holds here too:
 * `statuses/apply` merges into the instance held, so the list holds each
 * condition at most once. A state with duplicates is not reachable and is not
 * tested.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { ATTRIBUTE_LIST, type AttributesState } from '../src/systems/attributes';
import type { ResourcesState } from '../src/systems/resources';
import { SKILLS, type SkillsState } from '../src/systems/skills';
import { STAT_KEYS, statOf } from '../src/systems/stats';
import { applyStatus, heldOf, STATUSES, type StatusesState } from '../src/systems/statuses';
import { selectActivity } from '../src/systems/world';
import { ask, makeGame, patch, slice } from './helpers';

/** Every number reachable from `root`, by path, that is not a finite number. */
function nonFinite(root: unknown): string[] {
  const bad: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) bad.push(`${path} = ${node}`);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
    else for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(root, '');
  return bad;
}

/** A character no honest play produces: every attribute and skill absurd. */
function trollSave(seed = 3): Kernel {
  const g = makeGame({ seed });
  patch(g, (slices) => {
    for (const attr of ATTRIBUTE_LIST) (slices.attributes as AttributesState).attrs[attr.id].level = 1_000_000;
    for (const id of Object.keys(SKILLS)) (slices.skills as SkillsState).skills[id] = { level: 100_000, xp: 0 };
  });
  return g;
}

/** The stats of the player that are not finite numbers. */
function badStats(g: Kernel): string[] {
  return STAT_KEYS.filter((key) => !Number.isFinite(statOf(g, key))).map((key) => `${key} = ${statOf(g, key)}`);
}

/** The state after a save, a trip through JSON text and a load into a new kernel. */
function roundTrip(g: Kernel, seed: number): Kernel {
  const text = JSON.stringify(g.save(0));
  const loaded = makeGame({ seed });
  const result = loaded.load(JSON.parse(text));
  expect(result.ok, result.ok ? '' : result.error).toBe(true);
  return loaded;
}

describe('completability — degeneracy may trivialize, never break', () => {
  it('absurd levels leave every derived stat a finite number', () => {
    const bad = badStats(trollSave());
    expect(bad, `derived stats went off the number line:\n${bad.join('\n')}`).toEqual([]);
  });

  it('the cached read agrees with the raw one at absurd values', () => {
    // The stored path must not be the one that overflows.
    const g = trollSave();
    for (const key of STAT_KEYS) statOf(g, key);
    expect(g.staleStats()).toEqual([]);
  });

  it('an absurd save round-trips through JSON with nothing falling off', () => {
    // JSON.stringify turns Infinity and NaN into null, so a stat that overflows
    // comes back as a hole the loader has to guess at.
    const g = trollSave();
    expect(nonFinite(g.snapshot()), 'the save held non-finite numbers BEFORE serializing').toEqual([]);

    const loaded = roundTrip(g, 3);
    expect(nonFinite(loaded.snapshot()), 'non-finite numbers after the round trip').toEqual([]);
    expect(slice<AttributesState>(loaded, 'attributes').attrs.str.level).toBe(1_000_000);
    expect(slice<SkillsState>(loaded, 'skills').skills.fighting?.level).toBe(100_000);
  });

  it(
    'a fight at absurd values resolves instead of hanging or going NaN',
    () => {
      const g = trollSave(11);
      patch(g, (slices) => {
        slices.world.spot = 'f4_woods_edge';
        if (!slices.world.discovered.includes('f4_woods_edge')) slices.world.discovered.push('f4_woods_edge');
      });
      expect(g.dispatch(selectActivity({ activity: 'hunt' }))).toEqual({ ok: true });
      for (let i = 0; i < 600; i++) g.tick();

      const resources = slice<ResourcesState>(g, 'resources');
      expect(nonFinite(resources), 'resource pools went off the number line').toEqual([]);
      const gold = slice<{ gold: number }>(g, 'gold').gold;
      expect(Number.isFinite(gold), `gold = ${gold}`).toBe(true);
      expect(resources.values.hp).toBeGreaterThan(0);
      expect(nonFinite(roundTrip(g, 11).snapshot()), 'the played save is loadable').toEqual([]);
    },
    // Generous, as in the old file: speed past the attack-time floor becomes
    // extra hits, so one tick resolves many swings.
    30_000,
  );

  it('every condition in the game, laid on at once and hammered, stays finite', () => {
    // Applied through `statuses/apply` on purpose: it merges into the instance
    // already held, so the list never holds two of the same condition.
    const g = makeGame({ seed: 5 });
    patch(g, (slices) => {
      for (const attr of ATTRIBUTE_LIST) (slices.attributes as AttributesState).attrs[attr.id].level = 1;
    });
    for (const id of Object.keys(STATUSES)) {
      for (let i = 0; i < 500; i++) {
        ask(g, applyStatus, { entity: 'player', app: { id, intensity: 1000, duration: 'permanent' }, source: 'troll' });
      }
    }
    const held = heldOf(slice<StatusesState>(g, 'statuses'), 'player');
    expect(held.length, 'statuses/apply should merge, not duplicate').toBe(
      Object.keys(STATUSES).filter((id) => held.some((s) => s.id === id)).length,
    );
    expect(held.length).toBeGreaterThan(0);

    const bad = badStats(g);
    expect(bad, `derived stats went off the number line:\n${bad.join('\n')}`).toEqual([]);
    expect(statOf(g, 'maxHp'), 'maxHp must stay a positive number').toBeGreaterThan(0);
    expect(g.staleStats()).toEqual([]);
    expect(nonFinite(roundTrip(g, 5).snapshot()), 'the afflicted save is loadable').toEqual([]);
    // Slow under the parallel run: 5.1 s was measured against the default limit of 5 s.
  }, 30_000);
});
