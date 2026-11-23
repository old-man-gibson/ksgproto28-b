/**
 * Wuxin: the five-element cycle as a graph the player rewires. Port of the
 * old `systems/wuxin.ts`, the Wuxin types of old `types.ts`, the panel
 * `WuxinPanel.svelte` and its shutter (`wuxin` of the old
 * `LOCKABLE_SUBSYSTEMS`). See README.md in this folder.
 *
 * Structure only, as in the old build: no number, no game effect, no state.
 * The panel is a sandbox that reads and writes nothing of the save. The one
 * thing the game decides is whether the panel is listed: the counter
 * `flag:unlock_wuxin`, which nothing in play sets (the old debug panel did).
 */
import { defineSystem, type DeepReadonly, type SystemDef } from '../../kernel';
import counters, { counterValue } from '../counters';
import { migrations } from './migrations';

export * from './cycle';

/** The shutter: the panel is listed while this counter is 1 or more. The old `unlockKey('wuxin')`. */
export const WUXIN_UNLOCK = 'flag:unlock_wuxin';

export type WuxinState = Record<string, never>;

export interface WuxinView {
  /** The shutter is open: the navigation lists the panel. */
  open: boolean;
}

type ReadCtx = { read<S>(system: SystemDef<S, any>): DeepReadonly<S> };

/** Whether the shutter is open. The old `subsystemUnlocked(state, 'wuxin')`. */
export function wuxinOpen(ctx: ReadCtx): boolean {
  return counterValue(ctx.read(counters), WUXIN_UNLOCK) >= 1;
}

const wuxin = defineSystem<WuxinState, WuxinView>({
  id: 'wuxin',
  version: 1,
  migrations,
  initial: () => ({}),
  view: (ctx) => ({ open: wuxinOpen(ctx) }),
});

export default wuxin;
