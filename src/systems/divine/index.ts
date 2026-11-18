/**
 * The divine school: miracles and the deities they come from, favour with
 * each deity, and receiving a miracle for favour. Port of old
 * `systems/divine.ts`, `systems/deities.ts`, the known gods of
 * `systems/unlocks.ts` and the divine data. See README.md in this folder.
 *
 * The school registers itself with `spellcraft` at module load.
 */
import { answer, defineCommand, defineRequest, defineSystem, handle, OK, registry, skipped } from '../../kernel';
import counters, { bumpCounter, counterValue, setCounter } from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { checkDiscovery, grantSkillXp } from '../skills';
import { addSpell, registerSchool, type SpellSpec } from '../spellcraft';
import world, { SPOTS } from '../world';
import textData from './content/divine_text.json';
import { DEITIES, DEITY_LIST, deities, deityRelation, deityTags, MIRACLE_LIST, MIRACLES, miracles } from './defs';
import {
  checkMiracle,
  deityKnown,
  deityMetKey,
  devotionLevel,
  favorWith,
  FLOATING_FAVOR_KEY,
  floatingFavor,
  grantFavor,
  MIRACLES_LEARNED_KEY,
  spendFavor,
  VOTIVE_BASELINE_KEY,
  type DivineState,
} from './favor';
import { migrations } from './migrations';

export * from './defs';
export * from './favor';
export * from './shelf';

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const divineText = registry(textSchema, textData, 'Divine text');

/** The tags receiving a miracle trains, and that its discovery checks. */
const RECEIVE_TAGS = ['spellcraft', 'magic', 'divine'];
/** Skill XP for receiving a miracle. */
const RECEIVE_XP = 20;
/** The bench whose Divine tab teaches miracles. */
const SPELL_TABLE = 'spelltable';

// ---- the school ----

/** Resolve a miracle to its spell, or null for an unknown id. The old `miracleSpec`. */
export function miracleSpec(id: string): SpellSpec | null {
  const miracle = MIRACLES[id];
  if (!miracle) return null;
  return { ...miracle.spec, school: 'divine', deity: miracle.deity };
}

registerSchool('divine', {
  key: (source) => source.litany,
  spec: (source) => miracleSpec(source.litany),
  relation: deityRelation,
});

// ---- commands and requests ----

/** Receive a miracle: spend favour with its deity, write it in the book. The old `learnMiracle`. */
export const learnMiracle = defineCommand<{ miracle: string }>('divine/learn');
/** Place one unassigned favour with a known god. The old `assignFloatingFavor`. */
export const assignFavor = defineCommand<{ deity: string }>('divine/assign-favor');

/**
 * Favour with every known god, and the log line. The old `grantFavorAll`.
 * A request so the line lands where the caller asks (the turn-in logs it
 * before its own line, as the old order).
 */
export const grantFavorAll = defineRequest<{ amount: number }, void>('divine/grant-favor-all');

/**
 * Meet a god: set `met:deity:<id>` and pay the votive baseline. False for a
 * god already known. The old `meetDeity`.
 */
export const meetDeity = defineRequest<{ deity: string }, boolean>('divine/meet');

// ---- view ----

export interface DivineView {
  devotion: number;
  floating: number;
  /** Ids of the gods this life knows, in registry order. */
  known: string[];
  /** Favour per known god. */
  favor: Record<string, number>;
  /** Per miracle: null when it may be received now, else the reason. */
  checks: Record<string, string | null>;
  /** The player stands at a Spellcrafting Table. */
  atTable: boolean;
  /** Names of the spots that hold one. */
  tables: string[];
}

const TABLE_SPOTS = Object.values(SPOTS).filter((spot) => spot.benches?.includes(SPELL_TABLE));

const divine = defineSystem<DivineState, DivineView>({
  id: 'divine',
  version: 2,
  migrations,
  initial: () => ({ favor: {} }),
  content: { miracles, deities, deity_tags: deityTags, divine_text: divineText },

  commands: [
    handle(learnMiracle, (ctx, { miracle: id }) => {
      const check = checkMiracle(ctx, ctx.state, id);
      if (!check.ok) {
        const reason = check.reason ?? 'No such miracle';
        ctx.emit(logLine, { msg: fillText(TEXT.locked, { reason }), kind: 'danger' });
        return skipped(reason);
      }
      const miracle = MIRACLES[id];
      spendFavor(ctx.state, miracle.deity, miracle.favorCost);
      ctx.request(addSpell, { source: { school: 'divine', litany: id } });
      ctx.emit(bumpCounter, { key: MIRACLES_LEARNED_KEY });
      // Receiving a miracle is an act of devotion; it may be the first.
      ctx.emit(checkDiscovery, { tags: RECEIVE_TAGS });
      ctx.emit(grantSkillXp, { tags: RECEIVE_TAGS, amount: RECEIVE_XP, sourceKey: [`divine:${id}`] });
      ctx.emit(logLine, {
        msg: fillText(TEXT.received, {
          icon: miracle.icon,
          name: miracle.name,
          deity: DEITIES[miracle.deity]?.name ?? miracle.deity,
        }),
        kind: 'item',
      });
      return OK;
    }),

    handle(assignFavor, (ctx, { deity }) => {
      if (floatingFavor(ctx) < 1) return skipped('No unassigned favor');
      if (!DEITIES[deity]) return skipped(`No such deity: ${deity}`);
      if (!deityKnown(ctx, deity)) return skipped(`${DEITIES[deity].name} is not known yet`);
      ctx.emit(bumpCounter, { key: FLOATING_FAVOR_KEY, amount: -1 });
      grantFavor(ctx.state, deity, 1);
      ctx.emit(logLine, { msg: fillText(TEXT.favor_assigned, { deity: DEITIES[deity].name }), kind: 'skill' });
      return OK;
    }),
  ],

  requests: [
    answer(grantFavorAll, (ctx, { amount }) => {
      if (amount <= 0) return;
      for (const deity of DEITY_LIST) {
        if (deityKnown(ctx, deity.id)) grantFavor(ctx.state, deity.id, amount);
      }
      ctx.emit(logLine, { msg: fillText(TEXT.favor_gained, { amount }), kind: 'skill' });
    }),

    answer(meetDeity, (ctx, { deity }) => {
      // An unknown id is stamped met and paid nothing, as the old `meetDeity`.
      if (deityKnown(ctx, deity)) return false;
      ctx.emit(setCounter, { key: deityMetKey(deity), value: 1 });
      grantFavor(ctx.state, deity, counterValue(ctx.read(counters), VOTIVE_BASELINE_KEY));
      return true;
    }),
  ],

  view: (ctx): DivineView => {
    const known = DEITY_LIST.filter((d) => deityKnown(ctx, d.id)).map((d) => d.id);
    const checks: Record<string, string | null> = {};
    for (const m of MIRACLE_LIST) {
      const check = checkMiracle(ctx, ctx.state, m.id);
      checks[m.id] = check.ok ? null : (check.reason ?? 'No such miracle');
    }
    return {
      devotion: devotionLevel(ctx),
      floating: floatingFavor(ctx),
      known,
      favor: Object.fromEntries(known.map((id) => [id, favorWith(ctx.state, id)])),
      checks,
      atTable: !!SPOTS[ctx.read(world).spot]?.benches?.includes(SPELL_TABLE),
      tables: TABLE_SPOTS.map((t) => t.name),
    };
  },
});

export default divine;
