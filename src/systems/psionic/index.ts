/**
 * The psionic school: shapes on eight axes, read as derived quantities. The
 * teacher state (open axes, tier), shapes held in mind, shaping into the
 * grimoire, and the school's registration with `spellcraft`. Port of the old
 * `systems/psionic.ts` and of `shapePsionic` of the old
 * `systems/spellcraft.ts`. See README.md in this folder.
 *
 * No tick, no modifier source. The book lives in `spellcraft`, the level in
 * `skills`, the shutter flag in `counters`.
 */
import { defineCommand, defineSystem, handle, OK, skipped, type DeepReadonly, type SystemDef } from '../../kernel';
import counters, { counterValue } from '../counters';
import { fillText, logLine } from '../log';
import skills, { checkDiscovery, grantSkillXp } from '../skills';
import spellcraft, { addSpell, hasSpell, registerSchool, specForSource, spellKey, type SpellSource } from '../spellcraft';
import { statBlockOf, type DerivedStats } from '../stats';
import world, { SPOTS } from '../world';
import {
  MAX_PSI_MEMORIZED,
  PSIONIC,
  PSIONIC_TEXT,
  PSI_AXES,
  PSI_STARTING_AXES,
  psiAxes as psiAxesRegistry,
  psionicText,
  psiQuantities,
  psiRecognitions,
  type PsiAxisId,
  type PsiBias,
  type PsionicShape,
} from './defs';
import { migrations } from './migrations';
import { psiBiasFrom, recogniseShape, shapeKey, shapeName, shapeSpec, shapeTotal, toShape, toShapeList } from './shape';

export * from './defs';
export * from './shape';

// ---- slice ----

export interface PsiMemory {
  name: string;
  shape: PsionicShape;
}

export interface PsionicState {
  /** Open axes, in the order opened. The old `state.psi.axes`. */
  axes: string[];
  /** Teacher tier. The old `state.psi.tier`. */
  tier: number;
  /** Shapes held in mind, at most `MAX_PSI_MEMORIZED`. The old `state.psi.memorized`. */
  memorized: PsiMemory[];
}

/** What the reads below look at: other systems' slices. */
export interface PsiReads {
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
}

/** The UI shutter of the old `unlocks.ts`. Nothing in content lifts it. */
export const PSIONICS_UNLOCK = 'flag:unlock_psionics';

/** The bench the wheel stands at. */
export const SPELL_TABLE = 'spelltable';

/** The tags a shaping trains, and that its discovery checks. */
const SHAPE_TAGS = ['spellcraft', 'magic', 'psionic'];

// ---- reads ----

export function psionicsLevel(reads: PsiReads): number {
  return reads.read(skills).skills.psionics?.level ?? 0;
}

/** Per-axis point cap. The old `psiAxisCap`. */
export function psiAxisCap(reads: PsiReads): number {
  return PSIONIC.axisCap(psionicsLevel(reads));
}

/** Open axes. The old `psiAxes`. */
export function psiOpenAxes(reads: PsiReads): readonly string[] {
  return reads.read(psionic).axes;
}

export function psiTier(reads: PsiReads): number {
  return reads.read(psionic).tier;
}

export function psiMemorized(reads: PsiReads): readonly DeepReadonly<PsiMemory>[] {
  return reads.read(psionic).memorized;
}

export interface ShapeCheck {
  ok: boolean;
  reason?: string;
}

/** Whether this mind may hold the shape. The old `checkShape`, in its order. */
export function checkShape(reads: PsiReads, shape: PsionicShape): ShapeCheck {
  const cap = psiAxisCap(reads);
  const open = psiOpenAxes(reads);
  for (const [axis, points] of Object.entries(shape) as [PsiAxisId, number][]) {
    if (!points) continue;
    if (!Number.isInteger(points) || points < 0) return { ok: false, reason: PSIONIC_TEXT.not_whole_points };
    if (!PSI_AXES[axis]) return { ok: false, reason: fillText(PSIONIC_TEXT.no_such_axis, { axis }) };
    if (!open.includes(axis)) return { ok: false, reason: fillText(PSIONIC_TEXT.axis_locked, { axis: PSI_AXES[axis].name }) };
    if (points > cap) return { ok: false, reason: fillText(PSIONIC_TEXT.axis_cap, { axis: PSI_AXES[axis].name, cap }) };
  }
  if (shapeTotal(shape) === 0) return { ok: false, reason: PSIONIC_TEXT.empty_shape };
  return { ok: true };
}

/** The book's source for a shape. */
export function psionicSource(shape: PsionicShape): Extract<SpellSource, { school: 'psionic' }> {
  return { school: 'psionic', shape: toShapeList(shape) };
}

/** The shapes in a monster's or the book's list form. */
type ShapeSource = Extract<SpellSource, { school: 'psionic' }>;

registerSchool('psionic', {
  key: (source) => shapeKey(toShape(source.shape)),
  // The bare reading: full tier, no bias. Memoised by `spellcraft`.
  spec: (source) => shapeSpec(toShape(source.shape)),
  // In the caster's hands: what they wear argues with the arithmetic.
  reading: (reads, source: ShapeSource) =>
    shapeSpec(toShape(source.shape), 12, psiBiasFrom(statBlockOf(reads) as DerivedStats)),
});

// ---- commands ----

/** Shape a working and set it in the grimoire. The old `shapePsionic`. */
export const shape = defineCommand<{ shape: PsionicShape }>('psionic/shape');
/** Hold a shape in mind. The old `memorizePsiShape`. */
export const memorize = defineCommand<{ shape: PsionicShape; name?: string }>('psionic/memorize');
/** Let a held shape go. The old `forgetPsiShape`. */
export const forgetShape = defineCommand<{ index: number }>('psionic/forget');
/** A teacher opens an axis. The old `learnPsiAxis`. No content calls it. */
export const learnAxis = defineCommand<{ axis: string }>('psionic/learn-axis');
/** A teacher raises the tier. The old `raisePsiTier`. No content calls it. */
export const raiseTier = defineCommand<{ tier: number }>('psionic/raise-tier');

function isShape(value: unknown): value is PsionicShape {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ---- view ----

export interface MemoryView {
  name: string;
  shape: PsionicShape;
  key: string;
  /** "Force 3 · Reach 1". */
  summary: string;
}

export interface PsionicView {
  /** The shutter is open on this save. */
  unlocked: boolean;
  atTable: boolean;
  /** Names of the spots that hold a table. */
  tables: string[];
  level: number;
  cap: number;
  tier: number;
  axes: string[];
  memorized: MemoryView[];
  max: number;
  /** What the shaper wears, read off the stat block. */
  bias: PsiBias;
  maxFocus: number;
  /** `shapeKey` of every psionic spell in the book. */
  bookKeys: string[];
}

/** "Force 3 · Reach 1", or "an empty shape". */
export function shapeSummary(shape: PsionicShape): string {
  return (
    toShapeList(shape)
      .map(({ axis, value }) => `${PSI_AXES[axis as PsiAxisId].name} ${value}`)
      .join(' · ') || 'an empty shape'
  );
}

const TABLE_SPOTS = Object.values(SPOTS).filter((spot) => spot.benches?.includes(SPELL_TABLE));

const psionic = defineSystem<PsionicState, PsionicView>({
  id: 'psionic',
  version: 1,
  migrations,
  initial: () => ({ axes: [...PSI_STARTING_AXES], tier: 0, memorized: [] }),
  content: {
    psi_axes: psiAxesRegistry,
    psi_quantities: psiQuantities,
    psi_recognitions: psiRecognitions,
    psionic_text: psionicText,
  },

  commands: [
    handle(shape, (ctx, payload) => {
      const raw = payload?.shape;
      if (!isShape(raw)) return skipped('the shape is not a record of axis points');
      const check = checkShape(ctx, raw);
      if (!check.ok) {
        const reason = check.reason ?? PSIONIC_TEXT.empty_shape;
        ctx.emit(logLine, { msg: fillText(PSIONIC_TEXT.locked, { reason }), kind: 'danger' });
        return skipped(reason);
      }
      const source = psionicSource(raw);
      if (hasSpell(ctx.read(spellcraft), source)) {
        ctx.emit(logLine, { msg: PSIONIC_TEXT.already_shaped, kind: 'danger' });
        return skipped('That shape is already in your grimoire');
      }
      // The teacher gate is held at inscription: a book entry resolves at
      // full tier forever after, so this is the one place it can be held.
      const recognition = recogniseShape(raw, 12);
      if (recognition && (recognition.tier ?? 0) > ctx.state.tier) {
        ctx.emit(logLine, { msg: fillText(PSIONIC_TEXT.recognition_locked, { recognition: recognition.name }), kind: 'danger' });
        return skipped(`Shape matches ${recognition.name}, which needs a teacher (tier ${recognition.tier})`);
      }
      ctx.emit(checkDiscovery, { tags: SHAPE_TAGS });
      ctx.request(addSpell, { source });
      const spec = specForSource(source);
      ctx.emit(grantSkillXp, { tags: SHAPE_TAGS, amount: 16, sourceKey: [spellKey(source)] });
      ctx.emit(logLine, { msg: fillText(PSIONIC_TEXT.shaped, { icon: spec.icon, name: spec.name }), kind: 'item' });
      return OK;
    }),

    handle(memorize, (ctx, payload) => {
      const raw = payload?.shape;
      if (!isShape(raw)) return skipped('the shape is not a record of axis points');
      const check = checkShape(ctx, raw);
      if (!check.ok) return skipped(check.reason ?? PSIONIC_TEXT.empty_shape);
      const held = ctx.state.memorized;
      if (held.length >= MAX_PSI_MEMORIZED) return skipped(`the mind holds ${MAX_PSI_MEMORIZED} shapes already`);
      const key = shapeKey(raw);
      if (held.some((m) => shapeKey(m.shape) === key)) return skipped('this shape is held in mind already');
      held.push({ name: payload.name?.trim() || shapeName(raw), shape: { ...raw } });
      return OK;
    }),

    handle(forgetShape, (ctx, { index }) => {
      if (!ctx.state.memorized[index]) return skipped(`no shape is held at index ${index}`);
      ctx.state.memorized.splice(index, 1);
      return OK;
    }),

    handle(learnAxis, (ctx, { axis }) => {
      if (!PSI_AXES[axis as PsiAxisId]) return skipped(`no psionic axis has the id "${axis}"`);
      if (ctx.state.axes.includes(axis)) return skipped(`${PSI_AXES[axis as PsiAxisId].name} is open already`);
      ctx.state.axes.push(axis);
      return OK;
    }),

    handle(raiseTier, (ctx, { tier }) => {
      if (!(tier > ctx.state.tier)) return skipped(`the tier is ${ctx.state.tier} already, not below ${tier}`);
      ctx.state.tier = tier;
      return OK;
    }),
  ],

  view: (ctx): PsionicView => {
    const stats = statBlockOf(ctx) as DerivedStats;
    const spot = ctx.read(world).spot;
    return {
      unlocked: counterValue(ctx.read(counters), PSIONICS_UNLOCK) >= 1,
      atTable: !!SPOTS[spot]?.benches?.includes(SPELL_TABLE),
      tables: TABLE_SPOTS.map((t) => t.name),
      level: psionicsLevel(ctx),
      cap: psiAxisCap(ctx),
      tier: ctx.state.tier,
      axes: [...ctx.state.axes],
      memorized: ctx.state.memorized.map((m) => ({
        name: m.name,
        shape: { ...m.shape },
        key: shapeKey(m.shape),
        summary: shapeSummary(m.shape),
      })),
      max: MAX_PSI_MEMORIZED,
      bias: psiBiasFrom(stats),
      maxFocus: stats.maxFocus,
      bookKeys: ctx
        .read(spellcraft)
        .grimoire.filter((spell) => spell.source.school === 'psionic')
        .map((spell) => shapeKey(toShape((spell.source as ShapeSource).shape))),
    };
  },
});

export default psionic;
