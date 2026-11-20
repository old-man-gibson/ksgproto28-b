/**
 * Shared set-up of the Facet tests: a game with the switch on and one bank
 * ability held, the way the old tests called `installFacet`, `bindFacets` and
 * `grantFacet` on a new state.
 */
import { expect } from 'vitest';
import type { Kernel } from '../src/kernel';
import { hunt } from '../src/systems/combat';
import facet, { grantFacet, setCell, switchFacet, type FacetState } from '../src/systems/facet';
import type { FacetDoc } from '../src/systems/facet';
import { withReads } from '../src/systems/facet/host';
import type { ResourcesState } from '../src/systems/resources';
import { statBlockOf } from '../src/systems/stats';
import { sunlight } from '../src/systems/weather';
import { SPOTS } from '../src/systems/world';
import { combatOf, SITES } from './combatHelpers';
import { equip, makeGame, patch, reads, slice } from './helpers';

export const ATTRS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

/**
 * A character holding `ability`, with the given attributes trained and full
 * HP. The old tests' `createInitialState(7)`, the attribute levels, then the
 * grant. `attrs` lists the attributes to train; default the five the old
 * tests trained.
 */
export function holding(
  ability: string | null,
  options: { seed?: number; level?: number; attrs?: readonly (typeof ATTRS)[number][]; weapon?: boolean } = {},
): Kernel {
  const kernel = makeGame({ seed: options.seed ?? 7 });
  if (options.weapon) equip(kernel, 1);
  const level = options.level ?? 25;
  const which = options.attrs ?? ['str', 'dex', 'con', 'int', 'wis'];
  patch(kernel, (slices) => {
    for (const a of which) slices.attributes.attrs[a].level = level;
  });
  fullHp(kernel);
  expect(kernel.dispatch(switchFacet({ on: true }))).toEqual({ ok: true });
  if (ability) expect(kernel.dispatch(grantFacet({ id: ability }))).toEqual({ ok: true });
  return kernel;
}

export function fullHp(kernel: Kernel): void {
  const max = statBlockOf(reads(kernel)).maxHp;
  patch(kernel, (slices) => ((slices.resources as ResourcesState).values.hp = max));
}

export function facetOf(kernel: Kernel): FacetState {
  return slice<FacetState>(kernel, 'facet');
}

export function docOf(kernel: Kernel): FacetDoc {
  return facetOf(kernel).docs[0];
}

/** A cell's value of the held document. */
export function cell(kernel: Kernel, key: string): number {
  return docOf(kernel).cells!.find((c) => c.key === key)!.state!.v;
}

/** A cell's cap, evaluated for the player. */
export function capOf(kernel: Kernel, key: string): number {
  const state = facetOf(kernel);
  return withReads(reads(kernel), state, () => {
    const doc = state.docs[0];
    return Facet.evalExpr(doc.cells!.find((c) => c.key === key)!.cap, { ref: 'player', facet: doc, bindings: {} });
  });
}

/** Set a cell to a share of its cap (the old debug panel's `debugSetCell`). */
export function setShare(kernel: Kernel, key: string, share: number): void {
  expect(kernel.dispatch(setCell({ key, share }))).toEqual({ ok: true });
}

/** Run until the next game minute has passed (10 ticks: the clock starts on a minute). */
export function aMinute(kernel: Kernel): void {
  for (let t = 0; t < 10; t++) kernel.tick();
}

/** Hunt at a site until a fight is on. */
export function intoFight(kernel: Kernel, site = 'woods_edge'): void {
  const result = kernel.dispatch(hunt({ site: SITES[site] }));
  expect(result.ok).toBe(true);
  for (let t = 0; t < 2_000 && !combatOf(kernel).fight?.enemies.some((e) => e && e.hp > 0); t++) kernel.tick();
  expect(combatOf(kernel).fight).toBeTruthy();
}

/** The published view of the facet system. */
export function facetView(kernel: Kernel) {
  return kernel.view().systems[facet.id] as ReturnType<NonNullable<typeof facet.view>>;
}

/** Move the player to a spot under open sky in daylight now, or to one under a roof. */
export function moveTo(kernel: Kernel, where: 'open' | 'roofed'): string {
  for (const id of Object.keys(SPOTS)) {
    patch(kernel, (slices) => (slices.world.spot = id));
    const sun = sunlight(reads(kernel));
    if (where === 'open' ? sun > 0 : sun === 0) return id;
  }
  throw new Error(`no spot is ${where} now`);
}
