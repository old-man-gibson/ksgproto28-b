/**
 * A working in a fight: what a spell source resolves to and what the
 * resolved spell does. Port of the resolution half of the old
 * `systems/spellcraft.ts` and of the cast functions of `systems/combat.ts`.
 * See README.md in this folder for the cut: writing the book, the reading in
 * the caster's hands and casting outside a fight are step 3.
 *
 * `cast.ts` registers two kinds with combat at module load: the monster kind
 * `cast` and the player kind `grimoire:`. A school of magic registers itself
 * here with `registerSchool`.
 */
import { answer, defineSystem, on } from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import { fightClosed, registerTriggerSubject } from '../combat';
import './cast';
import { migrations } from './migrations';
import { noteCasting, noteMiracle, type SpellcraftState } from './state';

export * from './cast';
export * from './counter';
export * from './spec';
export * from './state';
export * from './types';

/** Ticks a casting stays fresh for a trigger that asks what is being cast. The old `EVENT_WINDOW`. */
const CASTING_WINDOW = 2;

const spellcraft = defineSystem<SpellcraftState>({
  id: 'spellcraft',
  version: 1,
  migrations,
  initial: () => ({ grimoire: [], nextUid: 1, casting: null, lastMiracle: null }),

  requests: [
    answer(noteCasting, (ctx, p) => {
      ctx.state.casting = { ...p, tick: totalTicksOf(ctx.read(clock)) };
    }),
    answer(noteMiracle, (ctx, { deity }) => {
      const tick = totalTicksOf(ctx.read(clock));
      const last = ctx.state.lastMiracle;
      ctx.state.lastMiracle = { deity, tick };
      return last ? { deity: last.deity, age: tick - last.tick } : null;
    }),
  ],

  events: [
    // What the fight held of this system ends with the fight.
    on(fightClosed, (ctx) => {
      ctx.state.casting = null;
      ctx.state.lastMiracle = null;
    }),
  ],

  view: (ctx) => ({
    prepared: ctx.state.grimoire.filter((spell) => spell.prepared).map((spell) => spell.uid),
  }),
});

export default spellcraft;

// What the enemy is casting: blank when nothing began within the window. How
// several counterspells tuned for different workings are routed.
registerTriggerSubject('enemy.castSchool', {
  kind: 'enum',
  read: ({ ctx }) => {
    const k = ctx.read(spellcraft).casting;
    return k && totalTicksOf(ctx.read(clock)) - k.tick <= CASTING_WINDOW ? k.school : '';
  },
});
registerTriggerSubject('enemy.castElement', {
  kind: 'enum',
  read: ({ ctx }) => {
    const k = ctx.read(spellcraft).casting;
    return k && totalTicksOf(ctx.read(clock)) - k.tick <= CASTING_WINDOW ? (k.element ?? '') : '';
  },
});
