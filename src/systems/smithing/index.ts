/**
 * Smithing: the anvil. The resolver and kernel are `assembly.ts` (pure);
 * this file is old `systems/forging.ts`, the state half: the skill gates,
 * the stock, the craft the bench run asks for, and the registrations with
 * `benches` (the Anvil) and `items` (the forged item). See README.md.
 */
import { answer, defineRequest, defineSystem, type Ctx, type DeepReadonly, type DerivedReads, type SystemDef } from '../../kernel';
import { benchCrafted, DISCIPLINES, registerBench, type AssembledPlacement, type DisciplineDef, type Placement as BenchPlacement } from '../benches';
import counters, { bumpCounter, counterValue, type CountersState } from '../counters';
import { grantForged, registerForging, type ItemDef } from '../items';
import { fillText, logLine, repeatLine } from '../log';
import materials, { MATERIALS, QUALITY_TIERS, rollQuality, takeMaterial, type QualityTier } from '../materials';
import prestige from '../prestige';
import skills, { checkDiscovery, grantSkillXp, skillLevel } from '../skills';
import { statBlockOf } from '../stats';
import world, { SPOTS } from '../world';
import {
  classifyPlacement,
  classStubs,
  exemplarSpec,
  forgedClassOf,
  forgedDef,
  forgeKey,
  forgeStats,
  forgeTicks,
  partsOf,
  placementCost,
  placementOf,
  placementProblem,
  type ForgeStats,
} from './assembly';
import {
  FORGE_SLOTS,
  forgedIdOf,
  ITEM_CLASS_LIST,
  itemClasses,
  parts,
  smithingText,
  TEXT,
  type ForgedPart,
  type ForgeSlot,
  type ItemClassDef,
  type Placement,
} from './defs';
import { migrations } from './migrations';

export * from './assembly';
export * from './defs';
export * from './validation';

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

const text = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

/** The bench. `assembles: true` is what makes the bench run ask this system for its clock. */
export const FORGING: DisciplineDef = DISCIPLINES.forging;

/** The grade a preview is drawn at: the real grade is rolled when the piece lands. */
export const PREVIEW_QUALITY: QualityTier = 'c';

// ---- slice ----

/** The anvil keeps nothing of its own: the job is in `benches`, the forms known in `counters`. */
export type SmithingState = Record<string, never>;

// ---- reads ----

/** What the anvil's rules read: the Smithing level and the plain stock. */
export interface ForgeReads {
  level: number;
  counts: Readonly<Record<string, number>>;
}

export function forgeReadsOf(ctx: ReadCtx): ForgeReads {
  return { level: skillLevel(ctx.read(skills), FORGING.skill), counts: ctx.read(materials).counts };
}

/** The counter a forged class bumps. The form chart reads it. */
export const forgedKey = (classId: string): string => `forged:${classId}`;

/**
 * Whether this class has been forged on this save. The form chart shows a
 * class's name once it has ("?" otherwise): discovery in place of an unlock.
 */
export function formKnown(state: DeepReadonly<CountersState>, classId: string): boolean {
  return counterValue(state, forgedKey(classId)) >= 1;
}

/** The anvil's slots still shut at this Smithing level, and the level that opens each. */
export function forgeSlotLocks(level: number): Partial<Record<ForgeSlot, number>> {
  const locks: Partial<Record<ForgeSlot, number>> = {};
  for (const slot of FORGING.slots) {
    if ((slot.unlockLevel ?? 0) > level) locks[slot.id as ForgeSlot] = slot.unlockLevel;
  }
  return locks;
}

/** One line of the bill: a material, how many whole units, how many are held. */
export interface ForgeCostLine {
  id: string;
  qty: number;
  held: number;
}

export interface ForgePreview {
  /** Can this be forged right now: valid, unlocked and paid for. */
  ok: boolean;
  /** Why not, when it cannot. The first failure only. */
  reason?: string;
  /** What the placement is. */
  class: ItemClassDef;
  /** The item it makes, at Fair quality. */
  def: ItemDef;
  /** The numbers behind `def`, at Fair quality. */
  stats: ForgeStats;
  /** The parts as an item would store them. */
  parts: ForgedPart[];
  /** The bill: each material, whole units, and how many of each are held. */
  cost: ForgeCostLine[];
  /** Bench ticks before the smith's speed. */
  ticks: number;
  /** Every material of the bill is held in full. */
  affordable: boolean;
  /** Slots still shut at this Smithing level, with the level each opens at. */
  slotLocks: Partial<Record<ForgeSlot, number>>;
}

/**
 * What the anvil would do with this placement, without spending anything.
 * The class, definition and cost are always filled in (the resolver is
 * total); `ok` says whether it can be forged right now. The old `previewForge`.
 */
export function previewForge(reads: ForgeReads, placement: Placement): ForgePreview {
  const cls = classifyPlacement(placement);
  const stats = forgeStats(placement, PREVIEW_QUALITY, cls);
  const partList = partsOf(placement);
  const def = forgedDef({ parts: partList, q: PREVIEW_QUALITY });
  const cost = placementCost(placement).map((c) => ({ ...c, held: reads.counts[c.id] ?? 0 }));
  const affordable = cost.every((c) => c.held >= c.qty);
  const slotLocks = forgeSlotLocks(reads.level);

  let reason = placementProblem(placement) ?? undefined;
  if (!reason) {
    for (const slot of FORGE_SLOTS) {
      const need = slotLocks[slot];
      if (placement[slot] && need !== undefined) {
        reason = text('reason_slot_locked', { slot: FORGING.slots.find((s) => s.id === slot)?.name ?? slot, level: need });
        break;
      }
    }
  }
  if (!reason && !affordable) {
    const short = cost.find((c) => c.held < c.qty)!;
    reason = text('reason_short', { material: MATERIALS[short.id]?.name ?? short.id, held: short.held, need: short.qty });
  }
  return {
    ok: reason === undefined,
    ...(reason ? { reason } : {}),
    class: cls,
    def,
    stats,
    parts: partList,
    cost,
    ticks: forgeTicks(placement),
    affordable,
    slotLocks,
  };
}

// ---- the craft ----

/** Forge one piece. Answered for the bench run of `benches`. The old `forgeOnce`. */
export const forgeRequest = defineRequest<{ placement: BenchPlacement; duration?: number; forge?: AssembledPlacement }, boolean>(
  'smithing/forge',
);

/**
 * Finish one piece: spend the bill, roll the grade from Smithing, and put the
 * forged item in the pack. False when the placement cannot be forged (the
 * reason is logged), which stops a run. The grade rolls the way a cook's
 * does; there is no smithing tool, so nothing caps it.
 */
function forgeOnce(ctx: Ctx<SmithingState>, placement: Placement): boolean {
  const check = previewForge(forgeReadsOf(ctx), placement);
  if (!check.ok) {
    if (check.reason) ctx.emit(logLine, { msg: text('locked', { reason: check.reason }), kind: 'danger' });
    return false;
  }

  for (const c of check.cost) ctx.request(takeMaterial, { id: c.id, qty: c.qty });

  const q = rollQuality(ctx.rng, 1 + skillLevel(ctx.read(skills), FORGING.skill) / 20);
  const made = ctx.request(grantForged, { defId: forgedIdOf(check.class.id), spec: { parts: check.parts, q } });

  // The form chart fills in from this counter: a class shows its name once it has been forged.
  ctx.emit(bumpCounter, { key: forgedKey(check.class.id) });
  ctx.emit(bumpCounter, { key: 'crafts' });
  ctx.emit(checkDiscovery, { tags: [FORGING.tag] });
  ctx.emit(grantSkillXp, {
    tags: ['craft', FORGING.tag],
    amount: FORGING.xp + 0.2 * check.ticks,
    sourceKey: [`forging:${check.class.id}`],
  });
  ctx.emit(benchCrafted, { discipline: FORGING.id });

  const def = forgedDef(made.forged!);
  ctx.emit(
    logLine,
    repeatLine({
      group: `bench:${FORGING.id}`,
      prefix: TEXT.forged_prefix,
      tally: [{ label: `${def.icon} ${QUALITY_TIERS[q].name} ${def.name}`, qty: 1 }],
      kind: 'item',
    }),
  );
  return true;
}

registerBench('forging', {
  preview: (ctx, _placement, _duration, forge) => previewForge(forgeReadsOf(ctx), placementOf(partsOfLoose(forge))),
  craft: forgeRequest,
  ticks: (forge) => forgeTicks(placementOf(partsOfLoose(forge))),
});

registerForging(
  {
    defOf: (spec) => forgedDef(spec),
    keyOf: (spec) => forgeKey(spec),
    exemplarOf: (defId) => {
      const cls = forgedClassOf(defId);
      return cls ? exemplarSpec(cls) : undefined;
    },
  },
  classStubs(),
);

/**
 * The parts of an assembled placement as a stored list, so `placementOf`
 * reads only the five known slots with string kinds and materials: the same
 * guard a stored spec gets.
 */
function partsOfLoose(forge: AssembledPlacement | undefined): unknown[] {
  if (!forge) return [];
  return FORGE_SLOTS.flatMap((slot) => (forge[slot] ? [{ slot, ...forge[slot] }] : []));
}

// ---- view ----

export interface SmithingView {
  /** The spot has an anvil. */
  atAnvil: boolean;
  /** The discovered spots that have an anvil, by name. */
  anvils: { id: string; name: string }[];
  /** Smithing level and the plain stock: what `previewForge` reads. */
  reads: ForgeReads;
  /** Class ids forged at least once on this save. */
  known: string[];
  /** The shared craft speed: the run's clock is `benchPace(craftSpeed, ticks)`. */
  craftSpeed: number;
  /** The run this view belongs to: the prestige count. The working layout resets when it changes. */
  runKey: string;
}

const system: SystemDef<SmithingState, SmithingView> = defineSystem<SmithingState, SmithingView>({
  id: 'smithing',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { parts, item_classes: itemClasses, smithing_text: smithingText },

  requests: [
    answer(forgeRequest, (ctx, { forge }) => forgeOnce(ctx, placementOf(partsOfLoose(forge)))),
  ],

  view: (ctx): SmithingView => {
    const w = ctx.read(world);
    const c = ctx.read(counters);
    const reads = forgeReadsOf(ctx);
    return {
      atAnvil: (SPOTS[w.spot]?.benches ?? []).includes(FORGING.id),
      anvils: w.discovered
        .filter((id) => (SPOTS[id]?.benches ?? []).includes(FORGING.id))
        .map((id) => ({ id, name: SPOTS[id].name })),
      reads: { level: reads.level, counts: { ...reads.counts } },
      known: ITEM_CLASS_LIST.filter((cls) => formKnown(c, cls.id)).map((cls) => cls.id),
      craftSpeed: statBlockOf(ctx).craftSpeed,
      runKey: `run:${ctx.read(prestige).count}`,
    };
  },
});

export default system;
