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
import { answer, defineCommand, defineSystem, handle, OK, on, PLAYER, registry, skipped, type DeepReadonly } from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import { fightClosed, registerTriggerSubject } from '../combat';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { healNow, spendNow } from '../resources';
import { checkDiscovery, grantSkillXp } from '../skills';
import { statBlockOf } from '../stats';
import { applyStatus } from '../statuses';
import {
  canCastUtility,
  deityConflict,
  findSpell,
  isUtilityWorking,
  preparedCap,
  preparedSpells,
  utilityCooldown,
} from './book';
import { resolveSpellFor } from './cast';
import textData from './content/spellcraft_text.json';
import { migrations } from './migrations';
import { addSpell, noteCasting, noteMiracle, type SpellcraftState } from './state';
import type { CraftedSpell } from './types';

export * from './book';
export * from './cast';
export * from './counter';
export * from './lines';
export * from './spec';
export * from './state';
export * from './types';

/** Ticks a casting stays fresh for a trigger that asks what is being cast. The old `EVENT_WINDOW`. */
const CASTING_WINDOW = 2;

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const spellcraftText = registry(textSchema, textData, 'Spellcraft text');

// ---- commands ----

/** Ready a spell for combat, or stand it down. The old `setPrepared`. */
export const setPrepared = defineCommand<{ uid: number; prepared: boolean }>('spellcraft/set-prepared');
/** Strike a spell from the book. The old `forgetSpell`. */
export const forgetSpell = defineCommand<{ uid: number }>('spellcraft/forget');
/** Name a spell; an empty name drops the name. The old `renameSpell`. */
export const renameSpell = defineCommand<{ uid: number; name: string }>('spellcraft/rename');
/** Cast a working on yourself with no fight on. The old `castUtility`. */
export const castUtility = defineCommand<{ uid: number }>('spellcraft/cast-utility');

/** One spell in the book as the panel lists it. */
export interface BookEntryView {
  uid: number;
  id: string;
  name: string;
  icon: string;
  school: string;
  /** The words, the litany or the shape, as written. */
  source: string;
  prepared: boolean;
  /** Mana per cast before efficiency, in the hands of the caster. */
  manaCost: number;
  cooldown: number;
  /** Ticks until it can be cast outside a fight again. */
  utilityWait: number;
  /** Null when it can be cast outside a fight now, else why not. */
  utility: string | null;
  /** Whether it is the kind of working that can be cast with no fight on. */
  utilityKind: boolean;
}

export interface SpellcraftView {
  /** Rotation ids are `grimoire:<uid>`; this lists the prepared uids. */
  prepared: number[];
  cap: number;
  book: BookEntryView[];
}

function sourceText(spell: DeepReadonly<CraftedSpell>): string {
  const source = spell.source;
  if (source.school === 'arcane') return source.words.join(' ');
  if (source.school === 'divine') return source.litany;
  return JSON.stringify(source);
}

const spellcraft = defineSystem<SpellcraftState, SpellcraftView>({
  id: 'spellcraft',
  version: 2,
  migrations,
  initial: () => ({ grimoire: [], nextUid: 1, casting: null, lastMiracle: null, utilityReady: {} }),
  content: { spellcraft_text: spellcraftText },

  commands: [
    handle(setPrepared, (ctx, { uid, prepared }) => {
      const entry = ctx.state.grimoire.find((s) => s.uid === uid);
      if (!entry) return skipped(`no spell has the uid ${uid}`);
      if (prepared && !entry.prepared) {
        const cap = preparedCap(ctx);
        if (preparedSpells(ctx.state).length >= cap) {
          ctx.emit(logLine, { msg: fillText(TEXT.prepared_cap, { cap }), kind: 'danger' });
          return skipped(`all ${cap} prepared pages are in use`);
        }
      }
      if (prepared) {
        const conflict = deityConflict(ctx.state, entry, (id) => ctx.content.get<{ name: string }>('deities', id)?.name ?? id);
        if (conflict) {
          ctx.emit(logLine, { msg: fillText(TEXT.prepare_conflict, { conflict }), kind: 'danger' });
          return skipped(conflict);
        }
      }
      if (prepared) entry.prepared = true;
      else delete entry.prepared;
      return OK;
    }),
    handle(forgetSpell, (ctx, { uid }) => {
      const i = ctx.state.grimoire.findIndex((s) => s.uid === uid);
      if (i < 0) return skipped(`no spell has the uid ${uid}`);
      ctx.state.grimoire.splice(i, 1);
      return OK;
    }),
    handle(renameSpell, (ctx, { uid, name }) => {
      const spell = ctx.state.grimoire.find((s) => s.uid === uid);
      if (!spell) return skipped(`no spell has the uid ${uid}`);
      const trimmed = name.trim();
      if (trimmed) spell.name = trimmed;
      else delete spell.name;
      return OK;
    }),
    handle(castUtility, (ctx, { uid }) => {
      const stats = statBlockOf(ctx);
      const check = canCastUtility(ctx, ctx.state, stats, uid);
      if (!check.ok) {
        ctx.emit(logLine, { msg: fillText(TEXT.locked, { reason: check.reason }), kind: 'danger' });
        return skipped(check.reason ?? 'it cannot be cast now');
      }
      const spell = findSpell(ctx.state, uid)!;
      // What it does in the hands of the caster, not what the book lists.
      const spec = resolveSpellFor(ctx, spell);
      ctx.request(spendNow, { id: 'mana', amount: spec.manaCost * stats.manaEff });
      if (spec.focusCost) ctx.request(spendNow, { id: 'focus', amount: spec.focusCost });
      ctx.state.utilityReady[String(uid)] = totalTicksOf(ctx.read(clock)) + spec.cooldown;

      const worn: string[] = [];
      for (const app of spec.grants ?? []) {
        const inst = ctx.request(applyStatus, { entity: PLAYER, app, source: spec.name });
        if (inst) worn.push(ctx.content.get<{ name: string }>('statuses', inst.id)?.name ?? inst.id);
      }
      let healed = 0;
      if (spec.heal && !spec.healsEnemy) {
        healed = ctx.request(healNow, { amount: spec.heal * stats.spellPower, kind: 'spell' })?.healed ?? 0;
      }
      const did = [
        ...(healed > 0 ? [`you heal ${Math.round(healed)} HP`] : []),
        ...(worn.length ? [`you gain ${worn.join(', ')}`] : []),
      ];
      ctx.emit(logLine, {
        msg: fillText(TEXT.utility_cast, {
          icon: spec.icon,
          name: spec.name,
          effects: did.length ? fillText(TEXT.effects, { list: did.join('; ') }) : '',
        }),
        kind: 'info',
      });
      const tags = ['magic', spec.school];
      ctx.emit(checkDiscovery, { tags });
      ctx.emit(grantSkillXp, { tags, amount: 3 });
      return OK;
    }),
  ],

  requests: [
    answer(addSpell, (ctx, { source, name, prepared }) => {
      const spell: CraftedSpell = { uid: ctx.state.nextUid++, source: structuredClone(source) };
      if (name) spell.name = name;
      if (prepared) spell.prepared = true;
      ctx.state.grimoire.push(spell);
      return structuredClone(spell);
    }),
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

  view: (ctx): SpellcraftView => {
    const now = totalTicksOf(ctx.read(clock));
    const stats = statBlockOf(ctx);
    return {
      prepared: ctx.state.grimoire.filter((spell) => spell.prepared).map((spell) => spell.uid),
      cap: preparedCap(ctx),
      book: ctx.state.grimoire.map((spell) => {
        const spec = resolveSpellFor(ctx, spell);
        const check = canCastUtility(ctx, ctx.state, stats, spell.uid);
        return {
          uid: spell.uid,
          id: `grimoire:${spell.uid}`,
          name: spec.name,
          icon: spec.icon,
          school: spell.source.school,
          source: sourceText(spell),
          prepared: !!spell.prepared,
          manaCost: spec.manaCost,
          cooldown: spec.cooldown,
          utilityWait: utilityCooldown(ctx.state, now, spell.uid),
          utility: check.ok ? null : (check.reason ?? 'it cannot be cast now'),
          utilityKind: isUtilityWorking(spec),
        };
      }),
    };
  },
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
