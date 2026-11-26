/**
 * The hold of play while an evolution waits on a pick. Port of old
 * `Game.tick` (`pendingEvolution` beside `dareHolds`: the tick is banked as
 * bonus time and nothing moves) and `facet/host.ts` `pendingEvolution`.
 * Kernel decision 36 (`playHold`, request K2).
 *
 * Memory, never saved, as the keeper's dare keeps its hold: `kernel.tick()`
 * asks before every tick, so the ask does not read the documents. Written
 * when it changes: the core writes an offer (`offerEvolution` of the host),
 * a branch is taken, an ability is granted, the switch goes off. A load and
 * a new run replace the slice object; the first ask after either is a miss
 * and reads the documents once.
 */
import type { DeepReadonly } from '../../kernel';
import type { FacetDoc } from './facet';
import { CORE } from './load';
import type { FacetState } from './state';

let holdFor: object | null = null;
let holdNow = false;

/** The held document that offers an evolution, or undefined. */
export function offering(docs: readonly DeepReadonly<FacetDoc>[]): DeepReadonly<FacetDoc> | undefined {
  return docs.find((d) => Array.isArray(d.offer) && d.offer.length > 0);
}

/** Write the hold for a slice object: an offer is waiting or not. */
export function noteEvolutionHold(state: DeepReadonly<FacetState>, held: boolean): void {
  holdFor = state;
  holdNow = held;
}

/**
 * True while an evolution waits on a pick: play holds. Without the core
 * nothing can be picked, so a saved offer holds nothing.
 */
export function evolutionHolds(ctx: { state: DeepReadonly<FacetState> }): boolean {
  if (ctx.state === holdFor) return holdNow;
  noteEvolutionHold(ctx.state, CORE && offering(ctx.state.docs) !== undefined);
  return holdNow;
}
