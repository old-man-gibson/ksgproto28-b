/**
 * The royale panel's controls as commands (step 4 port C5), panel side: the
 * old `RoyaleField.svelte` handlers called `game.moveOnField`,
 * `game.setRoyalePlan` and `game.clearFieldTarget`; here each handler builds
 * its command with these functions and sends it. The tests build the same
 * commands from the same functions, so a control and its test cannot drift.
 */
import type { Command } from '../../kernel';
import { climb } from '../world';
import { backToPlan, setRoyalePlan, walkOnField } from './index';
import { fieldPoint, ISO_K } from './royaleView';
import { ROYALE_FLOOR } from './rules';

/**
 * A click on the ground: the point in the ground's screen space (after the
 * SVG's inverse transform) back onto the field. Null outside the field: the
 * click does nothing, as the old handler returned.
 */
export function walkAt(sx: number, sy: number, size: number): Command | null {
  const { x, y } = fieldPoint(sx, sy, ISO_K);
  if (x < 0 || y < 0 || x > size || y > size) return null;
  return walkOnField({ x, y });
}

/** Arrow keys walk the player by hand too, three units a press, in screen directions. */
export const NUDGE: Record<string, [number, number]> = {
  ArrowUp: [-1, -1],
  ArrowDown: [1, 1],
  ArrowLeft: [-1, 1],
  ArrowRight: [1, -1],
};

/** An arrow key's walk from the hand-set destination, or the player when none is set; null for any other key. */
export function nudgeCommand(key: string, from: { x: number; y: number }): Command | null {
  const step = NUDGE[key];
  return step ? walkOnField({ x: from.x + step[0] * 3, y: from.y + step[1] * 3 }) : null;
}

/** Slot `i` of the plan set to `id`, or cleared with ''; the rest keep their order. The old `setSlot`. */
export function planSlotCommand(plan: readonly string[], i: number, id: string): Command {
  const next = [...plan];
  if (id) next[i] = id;
  else next.splice(i, 1);
  return setRoyalePlan({ ids: next.filter(Boolean) });
}

/** "Back to the plan": the hand-set destination cleared. */
export const backToPlanCommand = (): Command => backToPlan();

/** "Enter the royale now": the ladder's climb to floor 16 from the hall. */
export const enterRoyaleCommand = (): Command => climb({ floor: ROYALE_FLOOR });
