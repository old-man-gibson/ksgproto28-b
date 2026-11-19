/**
 * Port of the "modular smithing content" block of old `tests/content.test.ts`
 * and the Forges case of old `tests/alphalocks.test.ts`. Changed only where
 * the call shape changed: the rules are `smithingContentIssues` of
 * `src/systems/smithing`, the stubs are the `forged:<class>` records the
 * smithing system registers into `ITEMS`, the bench is the `forging` record
 * of `benches`. The old block also checked `SPOTS.f17_hamlet_forge` (floor 17,
 * step 4) and that the Cold Counter `assembling` does not assemble.
 */
import { describe, expect, it } from 'vitest';
import { DISCIPLINES } from '../src/systems/benches';
import { ITEMS } from '../src/systems/items';
import { MATERIALS } from '../src/systems/materials';
import { ITEM_CLASSES, PART_KINDS, smithingContentIssues, type SmithingView } from '../src/systems/smithing';
import { SPOTS } from '../src/systems/world';
import { makeGame, patch } from './helpers';

describe('modular smithing content', () => {
  // Run once with the exhaustive enumeration (every part x every accepted
  // material x both head slots x every quantity); one `it` per rule so a
  // failure names the rule.
  let cached: ReturnType<typeof smithingContentIssues> | undefined;
  const issuesOf = () => {
    if (!cached) {
      cached = smithingContentIssues({ parts: PART_KINDS, classes: ITEM_CLASSES, materials: MATERIALS }, { materials: 'all' });
    }
    return cached;
  };
  const report = (rule: string) =>
    issuesOf()
      .filter((i) => i.rule === rule)
      .map((i) => `${i.kind} ${i.id}: ${i.message}`);

  // The first test pays for `issuesOf()` (seconds), so it gets a longer limit.
  it('parts, smith profiles and class rules are well formed', () => {
    expect(report('parts')).toEqual([]);
    expect(report('materials')).toEqual([]);
    expect(report('classes')).toEqual([]);
  }, 60_000);

  it('every class exemplar resolves to its own class', () => {
    expect(report('exemplars')).toEqual([]);
    for (const cls of Object.values(ITEM_CLASSES)) expect(cls.exemplar, `${cls.id} has no exemplar`).toBeDefined();
  });

  it('every class is reachable from the catalogue', () => {
    // A class no placement can produce is a dead rule, or a part that was
    // never authored (the odachi waited on the long curved blade).
    expect(report('reachable')).toEqual([]);
  });

  it('the resolver is total: the last class matches everything and no placement falls through', () => {
    expect(report('last-class')).toEqual([]);
    expect(report('total')).toEqual([]);
  });

  it('every class has a generated item stub, and the stub carries no numbers', () => {
    for (const cls of Object.values(ITEM_CLASSES)) {
      const stub = ITEMS[`forged:${cls.id}`];
      expect(stub, `ITEMS['forged:${cls.id}']`).toBeDefined();
      expect(stub.slot, cls.id).toBe(cls.slot);
      expect(stub.tags, cls.id).toEqual(cls.tags);
      expect(stub.mods, `${cls.id}: a stub grants nothing`).toEqual([]);
    }
  });

  it('forging is the Forges bench; the Cold Counter does not assemble', () => {
    expect(SPOTS.the_forges.benches).toEqual(['forging']);
    expect(DISCIPLINES.forging.assembles).toBe(true);
    expect(DISCIPLINES.forging.skill).toBe('smithing');
    expect(DISCIPLINES.assembling.assembles).toBeUndefined();
  });

  it('the smithy stands the anvil: the panel opens at the Forges, and names them from elsewhere', () => {
    // Old alphalocks case: `visibleBenches(s, SPOTS.the_forges)` is `['forging']`
    // on a new game, with no shutter on it.
    const g = makeGame({ seed: 1 });
    patch(g, (s) => {
      s.world.spot = 'the_forges';
      s.world.discovered = [...new Set([...s.world.discovered, 'the_forges'])];
    });
    const at = g.view().systems.smithing as SmithingView;
    expect(at.atAnvil).toBe(true);
    expect(at.anvils.map((a) => a.id)).toEqual(['the_forges']);
    patch(g, (s) => (s.world.spot = 'the_long_bench'));
    expect((g.view().systems.smithing as SmithingView).atAnvil).toBe(false);
  });
});
