/**
 * The slice of the `facet` system and the refs the core names bearers by.
 */
import type { FacetDoc } from './facet';

/** The player's ref. Refs are strings so they survive JSON and the core's Map keys. */
export const PLAYER_REF = 'player';

/** An enemy's ref is this plus its slot in the fight (`foe:0` is the front). A ref lives for one call. */
export const FOE = 'foe:';

/** A rotation entry for an ability action is this plus the action's key (`facet:sun_blast`). */
export const FACET_ACTION = 'facet:';

export interface FacetState {
  /** The switch. Off: no ability can be granted and the Ability tab is not listed. */
  on: boolean;
  /** The run's ability as FACET documents, at most one (old `state.facets`). */
  docs: FacetDoc[];
  /** The action pressed for the next bar fill (old `CombatState.queuedAct`). Cleared when a fight closes. */
  queued: string | null;
  /** The ability ended the fight as a loss (old `CombatState.fallen`). Settled by the next fight tick. */
  fallen: { outcome: 'knocked_out' | 'dead'; cause: string } | null;
}

export function initialFacet(): FacetState {
  return { on: false, docs: [], queued: null, fallen: null };
}
