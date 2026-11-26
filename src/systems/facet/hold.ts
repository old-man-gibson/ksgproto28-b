/**
 * The hold of play while an evolution waits on a pick. Port of old
 * `Game.tick` (`pendingEvolution` beside `dareHolds`: the tick is banked as
 * bonus time and nothing moves) and `facet/host.ts` `pendingEvolution`.
 * Kernel decision 36 (`playHold`, request K2).
 *
 * The kernel keeps the answer and asks again only when this system says the
 * hold may have changed (`ctx.holdChanged()`): the core writes an offer
 * (`offerEvolution` of the host), a branch is taken, an ability is granted,
 * the switch goes off. A load and a new run ask on their own. No tick asks,
 * so a game without Facet pays nothing for the hold.
 */
import type { DeepReadonly } from '../../kernel';
import type { FacetDoc } from './facet';
import { CORE } from './load';
import type { FacetState } from './state';

/** The held document that offers an evolution, or undefined. */
export function offering(docs: readonly DeepReadonly<FacetDoc>[]): DeepReadonly<FacetDoc> | undefined {
  return docs.find((d) => Array.isArray(d.offer) && d.offer.length > 0);
}

/**
 * True while an evolution waits on a pick: play holds. Without the core
 * nothing can be picked, so a saved offer holds nothing.
 */
export function evolutionHolds(ctx: { state: DeepReadonly<FacetState> }): boolean {
  return CORE && offering(ctx.state.docs) !== undefined;
}
