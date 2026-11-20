/**
 * Runecarving: the Rune Table, the carved pile, socketing, and the sale and
 * discard of loose runes. Port of the old `systems/runecarving.ts`
 * (`carveRune`) and of the socket and sale half of the old `systems/runes.ts`
 * (`socketRune`, `unsocketRune`, `runeSellPrice`, `sellRune`, `discardRune`,
 * `sellRunesBatch`, `discardRunesBatch`, `weaponRuneBonuses`). See README.md
 * in this folder.
 *
 * No tick, no modifier source: a socketed rune's modifiers are collected by
 * `items/worn`, which the socket requests of `items` touch. The catalogue
 * pile lives in `items`; the carved pile lives here.
 */
import {
  defineCommand,
  defineSystem,
  handle,
  on,
  OK,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import { consumedParts, noveltyKeys, openSlots, nextSlot, slotPicks, type BenchReads, type GradedStack, type Placement } from '../benches';
import counters, { counterValue } from '../counters';
import { addGold } from '../gold';
import items, {
  carvingsFreed,
  itemDefOf,
  registerCarving,
  resolveRune,
  runeContextFor,
  runeRiders,
  RUNES,
  RUNECARVING_FLAG,
  socketRune as socketRequest,
  takeRune,
  unsocketRune as unsocketRequest,
  type CarvedRune,
  type ItemInstance,
  type RuneContext,
  type RuneRef,
  type SlotId,
} from '../items';
import { logLine } from '../log';
import materials, { grantGraded, MATERIAL_LIST, QUALITY_TIERS, qualityRank, takeGraded, type QualityTier } from '../materials';
import skills, { checkDiscovery, grantSkillXp, skillLevel } from '../skills';
import { statOf } from '../stats';
import world, { SPOTS } from '../world';
import {
  availablePatterns,
  carvedKey,
  composeCarved,
  describeRuneEffect,
  namedRuneFor,
  namedRunes,
  previewCarve,
  RUNECARVING,
  runeAdornments,
  runecarvingText,
  runePatterns,
  say,
} from './defs';
import { migrations } from './migrations';

export * from './defs';

// The item rules hand a carving to this system's composition.
registerCarving({ compose: composeCarved, key: carvedKey });

// ---- slice ----

export interface RunecarvingState {
  /** Carved runes not socketed, in the order made. The old `state.carved`. */
  carved: CarvedRune[];
}

type R = Ctx<RunecarvingState>;
type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/** The shutter flag (`counters`). While it is shut the panel shows one line. */
export const RUNECARVING_UNLOCK = `flag:${RUNECARVING_FLAG}`;

/** A held loose rune is named the way the old code named it: a catalogue id, or `carved:<index>`. */
export const CARVED_PREFIX = 'carved:';

/** What a bench rule reads for the Rune Table. */
export function benchReadsOf(ctx: Pick<ReadCtx, 'read'>): BenchReads {
  return {
    level: skillLevel(ctx.read(skills), RUNECARVING.skill),
    materials: ctx.read(materials),
    knowsRecipe: () => false,
  };
}

// ---- commands ----

/** Work the Rune Table once with this layout. The old `carveRune`. */
export const carveRune = defineCommand<{ placement: Placement }>('runecarving/carve');
/** Socket a held rune (catalogue id or `carved:<index>`) into an item. The old `socketRune`. */
export const socketRune = defineCommand<{ uid: number; ref: string }>('runecarving/socket');
/** Pry the rune at `index` out of an item. The old `unsocketRune`. */
export const unsocketRune = defineCommand<{ uid: number; index: number }>('runecarving/unsocket');
/** Sell one loose rune. The old `sellRune`. */
export const sellRune = defineCommand<{ ref: string }>('runecarving/sell');
/** Throw one loose rune away. The old `discardRune`. */
export const discardRune = defineCommand<{ ref: string }>('runecarving/discard');
/** Sell many loose runes: catalogue piles whole, carvings one each. The old `sellRunesBatch`. */
export const sellRunesBatch = defineCommand<{ refs: string[] }>('runecarving/sell-batch');
/** Throw many loose runes away. The old `discardRunesBatch`. */
export const discardRunesBatch = defineCommand<{ refs: string[] }>('runecarving/discard-batch');

const carvedIndex = (ref: string): number => (ref.startsWith(CARVED_PREFIX) ? Number(ref.slice(CARVED_PREFIX.length)) : -1);

/** A held loose rune: what it is, and how to take one away. The old `heldRune`. */
function heldRune(ctx: R, ref: string): { name: string; icon: string; value: number; take: () => void } | null {
  const i = carvedIndex(ref);
  if (i >= 0) {
    const carving = ctx.state.carved[i];
    if (!carving) return null;
    const rune = resolveRune(carving);
    return { name: rune.name, icon: rune.icon, value: rune.value, take: () => void ctx.state.carved.splice(i, 1) };
  }
  if ((ctx.read(items).runes[ref] ?? 0) <= 0) return null;
  const rune = RUNES[ref];
  return {
    name: rune?.name ?? ref,
    icon: rune?.icon ?? '',
    value: rune?.value ?? 1,
    take: () => void ctx.request(takeRune, { id: ref }),
  };
}

/** The sale price of one held loose rune: worth x gold gain, at least 1. The old `runeSellPrice`. */
export function runeSellPrice(value: number, goldGain: number): number {
  return Math.max(1, Math.round(value * goldGain));
}

/** A batch resolved before anything changes. Carvings are removed by descending index. The old `planRuneBatch`. */
function planBatch(ctx: R, refs: readonly string[]): { unitValue: number; count: number; catalogue: string[]; carvedDesc: number[] } {
  const catalogue: string[] = [];
  const carved = new Set<number>();
  const pile = ctx.read(items).runes;
  let unitValue = 0;
  let count = 0;
  for (const ref of refs) {
    const i = carvedIndex(ref);
    if (i >= 0) {
      if (ctx.state.carved[i] && !carved.has(i)) {
        carved.add(i);
        unitValue += resolveRune(ctx.state.carved[i]).value;
        count += 1;
      }
    } else {
      const qty = pile[ref] ?? 0;
      if (qty > 0 && !catalogue.includes(ref)) {
        catalogue.push(ref);
        unitValue += (RUNES[ref]?.value ?? 1) * qty;
        count += qty;
      }
    }
  }
  return { unitValue, count, catalogue, carvedDesc: [...carved].sort((a, b) => b - a) };
}

function applyBatch(ctx: R, plan: ReturnType<typeof planBatch>): void {
  for (const id of plan.catalogue) ctx.request(takeRune, { id, all: true });
  for (const i of plan.carvedDesc) ctx.state.carved.splice(i, 1);
}

/** Every typed on-hit rider of the runes in a hand, credited to its rune. The old `weaponRuneBonuses`. */
export function weaponRuneBonuses(
  itemsState: DeepReadonly<{ equipment: Partial<Record<SlotId, ItemInstance>> }>,
  slot: SlotId = 'weapon',
): { flat: { type: string; value: number; source: string }[]; pct: { type: string; value: number; source: string }[] } {
  const weapon = itemsState.equipment[slot];
  const flat: { type: string; value: number; source: string }[] = [];
  const pct: { type: string; value: number; source: string }[] = [];
  if (!weapon) return { flat, pct };
  for (const ref of weapon.runes ?? []) {
    const rune = resolveRune(ref);
    const effect = rune.effects.find((e) => e.context === 'weapon');
    for (const r of runeRiders(effect?.bonusDamage)) flat.push({ ...r, source: rune.name });
    for (const r of runeRiders(effect?.bonusDamagePct)) pct.push({ ...r, source: rune.name });
  }
  return { flat, pct };
}

// ---- view ----

export interface RuneLine {
  context: RuneContext;
  text: string;
}

export interface HeldRuneView {
  /** The ref the commands take: a catalogue id or `carved:<index>`. */
  ref: string;
  name: string;
  icon: string;
  qty: number;
  /** The slab grade of a carving; null for a catalogue rune. */
  grade: string | null;
  desc: string | null;
  effects: RuneLine[];
  /** Price of one. */
  sell: number;
}

export interface SocketedView {
  name: string;
  icon: string;
  text: string;
}

export interface GearView {
  uid: number;
  name: string;
  icon: string;
  /** The slot it is worn in; null in the pack. */
  worn: SlotId | null;
  slots: number;
  context: RuneContext;
  runes: SocketedView[];
}

export interface StockView {
  id: string;
  name: string;
  icon: string;
  tags: string[];
  grades: { quality: QualityTier; name: string; qty: number }[];
}

export interface RunecarvingView {
  /** Whether the shutter is open (`flag:unlock_runecarving`). */
  unlocked: boolean;
  /** Whether the player stands at a Rune Table. */
  atTable: boolean;
  /** Spots that hold a Rune Table. */
  tables: string[];
  level: number;
  /** Slot ids open at the level, in bench order. */
  open: string[];
  next: { name: string; level: number } | null;
  /** Held graded stock a station accepts. */
  stock: StockView[];
  /** Patterns open at the level. */
  patterns: { id: string; name: string; icon: string; desc: string | null }[];
  carved: HeldRuneView[];
  pile: HeldRuneView[];
  gear: GearView[];
  goldGain: number;
}

const TABLE_SPOTS = Object.values(SPOTS).filter((spot) => spot.benches?.includes(RUNECARVING.id));
const ACCEPTED = new Set(RUNECARVING.slots.filter((s) => slotPicks(s) !== 'design').flatMap((s) => s.accepts));
const STATION_MATERIALS = MATERIAL_LIST.filter((m) => (m.craftTags ?? []).some((t) => ACCEPTED.has(t)));
const CONTEXTS: readonly RuneContext[] = ['weapon', 'armor', 'accessory'];

function linesOf(ref: DeepReadonly<RuneRef>): RuneLine[] {
  const rune = resolveRune(ref);
  return CONTEXTS.map((context) => ({ context, text: describeRuneEffect(rune.effects.find((e) => e.context === context)) }));
}

const runecarving = defineSystem<RunecarvingState, RunecarvingView>({
  id: 'runecarving',
  version: 1,
  migrations,
  initial: () => ({ carved: [] }),
  content: {
    rune_patterns: runePatterns,
    rune_adornments: runeAdornments,
    named_runes: namedRunes,
    runecarving_text: runecarvingText,
  },

  commands: [
    handle(carveRune, (ctx, payload) => {
      const placement: Placement = { ...(payload?.placement ?? {}) };
      const check = previewCarve(benchReadsOf(ctx), placement);
      if (!check.ok || !check.preview) {
        const reason = check.reason ?? 'the bench would not carve';
        ctx.emit(logLine, { msg: say('locked', { reason }), kind: 'danger' });
        return skipped(reason);
      }
      // Spend the bench either way: a split slab is still a spent slab. A
      // take that fails puts back what was taken (old `consumePlacement`).
      const taken: GradedStack[] = [];
      for (const part of consumedParts(RUNECARVING, placement)) {
        if (ctx.request(takeGraded, { id: part.id, quality: part.quality })) taken.push(part);
        else {
          for (const back of taken) ctx.request(grantGraded, { id: back.id, quality: back.quality });
          return skipped(`the stock of ${part.id} at grade ${part.quality} ran out`);
        }
      }

      const keys = noveltyKeys(RUNECARVING, placement);
      const tags = ['craft', RUNECARVING.tag];
      // The bench names its own trade.
      ctx.emit(checkDiscovery, { tags: [RUNECARVING.tag] });

      // The slab split. Half the lesson still lands (40% of the XP).
      if (ctx.rng.chance(check.failure ?? 0)) {
        ctx.emit(grantSkillXp, { tags, amount: RUNECARVING.xp * 0.4, sourceKey: keys });
        ctx.emit(logLine, { msg: say('slab_split'), kind: 'danger' });
        return OK;
      }

      const carving = check.preview;
      ctx.state.carved.push(carving);
      const rune = composeCarved(carving);
      const named = namedRuneFor(carving);
      const placedCount = Object.values(placement).filter((v) => !!v).length;
      ctx.emit(grantSkillXp, { tags, amount: RUNECARVING.xp * (1 + placedCount * 0.25), sourceKey: keys });
      ctx.emit(logLine, { msg: say(named ? 'carved_named' : 'carved', { icon: rune.icon, name: rune.name }), kind: 'item' });
      return OK;
    }),

    handle(socketRune, (ctx, { uid, ref }) => {
      const i = carvedIndex(ref);
      const carving = i >= 0 ? ctx.state.carved[i] : undefined;
      if (i >= 0 && !carving) return skipped(`no carving is held at ${ref}`);
      const answer = ctx.request(socketRequest, { uid, ref: carving ?? ref });
      if (!answer.ok) return skipped(answer.reason ?? 'the rune was not socketed');
      const rune = resolveRune(carving ?? ref);
      if (carving) ctx.state.carved.splice(i, 1);
      ctx.emit(logLine, {
        msg: say('socketed', { icon: rune.icon, name: rune.name, itemIcon: answer.icon ?? '', item: answer.item ?? String(uid) }),
        kind: 'item',
      });
      return OK;
    }),

    handle(unsocketRune, (ctx, { uid, index }) => {
      const out = ctx.request(unsocketRequest, { uid, index });
      if (!out) return skipped(`item ${uid} holds no rune at socket ${index}`);
      // A carving goes back to the carved pile; `items` put a catalogue rune back on its own.
      if (typeof out.ref !== 'string') ctx.state.carved.push(out.ref);
      return OK;
    }),

    handle(sellRune, (ctx, { ref }) => {
      const held = heldRune(ctx, ref);
      if (!held) return skipped(`no rune "${ref}" is held`);
      const price = runeSellPrice(held.value, statOf(ctx, 'goldGain'));
      held.take();
      ctx.request(addGold, { amount: price, earned: true });
      ctx.emit(logLine, { msg: say('sold', { icon: held.icon, name: held.name, price }), kind: 'item' });
      return OK;
    }),

    handle(discardRune, (ctx, { ref }) => {
      const held = heldRune(ctx, ref);
      if (!held) return skipped(`no rune "${ref}" is held`);
      held.take();
      ctx.emit(logLine, { msg: say('discarded', { icon: held.icon, name: held.name }), kind: 'info' });
      return OK;
    }),

    handle(sellRunesBatch, (ctx, { refs }) => {
      const plan = planBatch(ctx, refs ?? []);
      if (plan.count === 0) return skipped('none of the listed runes is held');
      const price = Math.max(plan.count, Math.round(plan.unitValue * statOf(ctx, 'goldGain')));
      applyBatch(ctx, plan);
      ctx.request(addGold, { amount: price, earned: true });
      ctx.emit(logLine, {
        msg: say('sold_many', { count: plan.count, plural: plan.count === 1 ? '' : 's', price }),
        kind: 'item',
      });
      return OK;
    }),

    handle(discardRunesBatch, (ctx, { refs }) => {
      const plan = planBatch(ctx, refs ?? []);
      if (plan.count === 0) return skipped('none of the listed runes is held');
      applyBatch(ctx, plan);
      ctx.emit(logLine, { msg: say('discarded_many', { count: plan.count, plural: plan.count === 1 ? '' : 's' }), kind: 'info' });
      return OK;
    }),
  ],

  events: [
    // A sold item's carvings come back to the pile (old `sellItems`).
    on(carvingsFreed, (ctx, { payload: { carvings } }) => {
      for (const c of carvings) ctx.state.carved.push(JSON.parse(JSON.stringify(c)) as CarvedRune);
    }),
  ],

  view: (ctx): RunecarvingView => {
    const level = skillLevel(ctx.read(skills), RUNECARVING.skill);
    const inv = ctx.read(items);
    const mats = ctx.read(materials);
    const goldGain = statOf(ctx, 'goldGain');
    const spot = ctx.read(world).spot;
    const next = nextSlot(RUNECARVING, level);
    const carved: HeldRuneView[] = ctx.state.carved.map((c, i) => {
      const rune = resolveRune(c);
      return {
        ref: `${CARVED_PREFIX}${i}`,
        name: rune.name,
        icon: rune.icon,
        qty: 1,
        grade: QUALITY_TIERS[c.stone.quality]?.name ?? c.stone.quality,
        desc: rune.desc ?? null,
        effects: linesOf(c),
        sell: runeSellPrice(rune.value, goldGain),
      };
    });
    const pile: HeldRuneView[] = Object.entries(inv.runes)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const rune = resolveRune(id);
        return {
          ref: id,
          name: rune.name,
          icon: rune.icon,
          qty,
          grade: null,
          desc: rune.desc ?? null,
          effects: linesOf(id),
          sell: runeSellPrice(rune.value, goldGain),
        };
      });
    const gearOf = (item: DeepReadonly<ItemInstance>, worn: SlotId | null): GearView | null => {
      const def = itemDefOf(item);
      if (!def || (item.slots ?? 0) <= 0) return null;
      const context = runeContextFor(def.slot);
      return {
        uid: item.uid,
        name: def.name,
        icon: def.icon,
        worn,
        slots: item.slots ?? 0,
        context,
        runes: (item.runes ?? []).map((ref) => {
          const rune = resolveRune(ref);
          return { name: rune.name, icon: rune.icon, text: describeRuneEffect(rune.effects.find((e) => e.context === context)) };
        }),
      };
    };
    const gear: GearView[] = [
      ...(Object.entries(inv.equipment) as [SlotId, DeepReadonly<ItemInstance>][]).map(([slot, item]) => gearOf(item, slot)),
      ...inv.inventory.map((item) => gearOf(item, null)),
    ].filter((g): g is GearView => !!g);
    return {
      unlocked: counterValue(ctx.read(counters), RUNECARVING_UNLOCK) >= 1,
      atTable: !!SPOTS[spot]?.benches?.includes(RUNECARVING.id),
      tables: TABLE_SPOTS.map((t) => t.name),
      level,
      open: openSlots(RUNECARVING, level).map((s) => s.id),
      next: next ? { name: next.slot.name, level: next.level } : null,
      stock: STATION_MATERIALS.map((m) => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        tags: [...(m.craftTags ?? [])],
        grades: Object.entries(mats.stock[m.id] ?? {})
          .filter(([, qty]) => (qty ?? 0) > 0)
          .sort(([a], [b]) => qualityRank(b as QualityTier) - qualityRank(a as QualityTier))
          .map(([quality, qty]) => ({ quality: quality as QualityTier, name: QUALITY_TIERS[quality as QualityTier]?.name ?? quality, qty: qty ?? 0 })),
      })).filter((m) => m.grades.length > 0),
      patterns: availablePatterns(level).map((p) => ({ id: p.id, name: p.name, icon: p.icon, desc: p.desc ?? null })),
      carved,
      pile,
      gear,
      goldGain,
    };
  },
});

export default runecarving;
