import type { Placement } from './defs';

/**
 * The last layout laid out at each bench, kept for the session. Port of old
 * `ui/lib/benchLayouts.ts`. A panel is thrown away when another panel opens,
 * so the layout would vanish with it. This is UI state, not game state: it
 * lives at module level, is never saved, and is gone on reload.
 */
export interface BenchLayout {
  placement: Placement;
  /** A timed bench's chosen duration; null while it is still the default. */
  units: number | null;
}

const layouts = new Map<string, BenchLayout>();

/** Remember the layout now on a bench. The placement is copied, so later edits do not leak in. */
export function rememberLayout(disciplineId: string, placement: Placement, units: number | null): void {
  const copy: Placement = {};
  for (const [slot, stack] of Object.entries(placement)) {
    if (stack) copy[slot] = { id: stack.id, quality: stack.quality };
  }
  layouts.set(disciplineId, { placement: copy, units });
}

/** The layout last left at a bench, or undefined if the session has not touched it. */
export function recallLayout(disciplineId: string): BenchLayout | undefined {
  return layouts.get(disciplineId);
}

/** Forget every remembered layout. */
export function forgetLayouts(): void {
  layouts.clear();
}
