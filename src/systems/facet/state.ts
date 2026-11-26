/**
 * The slice of the `facet` system and the refs the core names bearers by.
 */
import type { AssembledPlacement, Placement } from '../benches';
import type { FacetDoc } from './facet';

/** The player's ref. Refs are strings so they survive JSON and the core's Map keys. */
export const PLAYER_REF = 'player';

/** An enemy's ref is this plus its slot in the fight (`foe:0` is the front). A ref lives for one call. */
export const FOE = 'foe:';

/** A rotation entry for an ability action is this plus the action's key (`facet:sun_blast`). */
export const FACET_ACTION = 'facet:';

/**
 * A Shadow Clone sent to one task at one spot (old `CloneJob`, `systems/clones.ts`):
 * a gathering or job activity, or a bench run with its own copy of the layout.
 */
export interface CloneJob {
  /** Deployment order; the lowest is the oldest. */
  order: number;
  spot: string;
  /** A gathering or job activity at `spot`... */
  activity?: string;
  /** ...or a bench run there: its own copy of the layout, on its own clock. */
  bench?: {
    discipline: string;
    placement: Placement;
    /** A timed bench's length in units. */
    duration?: number;
    /** An assembling bench (the anvil): the parts. */
    forge?: AssembledPlacement;
    /** Ticks per pass: the bench's time divided by the clone's yield share. */
    ticksPer: number;
    ticksLeft: number;
    /** Crafts per pass. */
    batch: number;
  };
  /** Progress toward the activity's next cycle, like the player's `activityProgress`. */
  progress: number;
}

export interface FacetState {
  /** The switch. Off: no ability can be granted and the Ability tab is not listed. */
  on: boolean;
  /** The run's ability as FACET documents, at most one (old `state.facets`). */
  docs: FacetDoc[];
  /** The action pressed for the next bar fill (old `CombatState.queuedAct`). Cleared when a fight closes. */
  queued: string | null;
  /** The ability ended the fight as a loss (old `CombatState.fallen`). Settled by the next fight tick. */
  fallen: { outcome: 'knocked_out' | 'dead'; cause: string } | null;
  /**
   * Shadow Clones at work, oldest first (old `state.clones`). Absent while
   * none is out, so a save without clones is the same as before step 4
   * port F: no version step, no migration (README, Slice).
   */
  clones?: CloneJob[];
}

export function initialFacet(): FacetState {
  return { on: false, docs: [], queued: null, fallen: null };
}
