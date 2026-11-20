import { describe, expect, it } from 'vitest';
import { CORE, facetListed, grantFacet, NO_CORE, switchFacet, type FacetState } from '../src/systems/facet';
import { CORE_FILES } from '../src/systems/facet/load';
import { skipsOf } from './combatHelpers';
import { facetView } from './facetHelpers';
import { makeGame, patch, slice } from './helpers';

/**
 * A build without the Facet core (a checkout of the public repository, the
 * continuous integration run): the game runs, the switch refuses with the
 * reason, nothing is listed, and a save switched on elsewhere stays inert.
 * Runs only when `src/systems/facet/core/` is missing (docs/SETUP.md).
 */
describe.runIf(!CORE)('without the Facet core', () => {
  it('loads no core file', () => {
    expect(CORE_FILES).toEqual([]);
    expect((globalThis as { Facet?: unknown }).Facet).toBeUndefined();
  });

  it('refuses the switch and a grant with the reason, and stays off', () => {
    const k = makeGame({ seed: 3 });
    expect(k.dispatch(switchFacet({ on: true }))).toEqual({ ok: false, reason: NO_CORE });
    expect(k.dispatch(grantFacet({ id: 'zenkai' }))).toEqual({ ok: false, reason: NO_CORE });
    expect(skipsOf(k, 'facet/switch')).toEqual([NO_CORE]);
    expect(slice<FacetState>(k, 'facet').on).toBe(false);
    expect(facetListed(k.view().systems)).toBe(false);
    expect(facetView(k)).toMatchObject({ on: false, core: false, held: [], bank: [] });
  });

  it('keeps a save switched on with a held ability inert: listed off, nothing runs', () => {
    const k = makeGame({ seed: 3 });
    patch(k, (slices) => {
      Object.assign(slices.facet, { on: true, docs: [{ id: 'fc_x', v: 1, cells: [], clauses: [] }], queued: null, fallen: null });
    });
    expect(facetListed(k.view().systems)).toBe(false);
    for (let t = 0; t < 600; t++) k.tick();
    expect(slice<FacetState>(k, 'facet').docs).toHaveLength(1);
  });
});
