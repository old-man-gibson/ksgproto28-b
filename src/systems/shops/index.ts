/**
 * Shops: buying at a person's counter. Port of the old `systems/shops.ts`.
 * Selling is the other half of the counter and lives with the goods: `items`
 * (`items/sell`) and `materials` (`materials/sell`, `materials/sell-batch`).
 * See README.md in this folder.
 *
 * One law on top: no arbitrage. Whatever the charisma, buying a thing and
 * selling it straight back never profits. Nothing about a shop is saved:
 * stock is data, prices are derived, the discount is the `met:` counter.
 */
import {
  defineCommand,
  defineSystem,
  handle,
  OK,
  registry,
  skipped,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import counters, { bumpCounter, conditionsMet, counterValue } from '../counters';
import gold, { spendGold } from '../gold';
import { grantItem, ITEMS, maxRuneSlots, sellPrice } from '../items';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import {
  grantGraded,
  grantMaterial,
  gradedUnitPrice,
  isGraded,
  materialSellPrice,
  MATERIALS,
  QUALITY_TIERS,
  qualityMult,
  type QualityTier,
} from '../materials';
import { hasMet, NPCS, type NpcDef, type ShopLine } from '../npcs';
import { conditionReader } from '../skills';
import { statOf } from '../stats';
import world from '../world';
import shopsTextData from './content/shops_text.json';
import { migrations } from './migrations';

const shopsText = registry(textSchema, shopsTextData, 'Shop text');
const TEXT = Object.fromEntries((shopsTextData as TextRecord[]).map((r) => [r.id, r.text]));

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- prices ----

/** Markup over base value for a customer the vendor knows. */
export const BUY_MARKUP = 2;
/** Extra multiplier a stranger pays on top of BUY_MARKUP. */
export const STRANGER_MARKUP = 1.5;
/** Grade a graded ware is sold at when the line does not say. */
export const DEFAULT_SHOP_QUALITY: QualityTier = 'c';
/** Set by the Chancery Price Seal card: a standing discount at every counter. */
export const PRICE_SEAL_FLAG = 'flag:chancery_seal';
/** What the seal leaves of the asking price. */
export const PRICE_SEAL_MULT = 0.9;

export function lineQuality(line: ShopLine): QualityTier {
  return line.kind === 'material' ? ((line.quality as QualityTier | undefined) ?? DEFAULT_SHOP_QUALITY) : DEFAULT_SHOP_QUALITY;
}

/** Base worth of one unit of a line, before any markup. */
export function lineValue(line: ShopLine): number {
  if (line.kind === 'item') return ITEMS[line.id]?.value ?? 1;
  const def = MATERIALS[line.id];
  const mult = def?.graded ? Math.max(0.1, qualityMult(lineQuality(line))) : 1;
  return (def?.value ?? 1) * mult;
}

/** What a vendor asks before the no-arbitrage floor. Reads no state. */
export function askingPrice(line: ShopLine, met: boolean): number {
  const base = line.price ?? Math.ceil(lineValue(line) * BUY_MARKUP);
  return Math.max(1, Math.ceil(base * (met ? 1 : STRANGER_MARKUP)));
}

/**
 * The most one unit could sell back for. Rune slots roll on purchase, so an
 * item is priced as its best possible roll; otherwise a lucky slot turns the
 * counter into a mint.
 */
export function resaleCeiling(line: ShopLine, goldGain: number): number {
  if (line.kind === 'material') {
    return isGraded(line.id) ? gradedUnitPrice(line.id, lineQuality(line), goldGain) : materialSellPrice(line.id, goldGain);
  }
  const def = ITEMS[line.id];
  return sellPrice({ defId: line.id, slots: def ? maxRuneSlots(def) : 0 }, goldGain);
}

/**
 * The price per unit. The floor is applied last, so it survives a `price`
 * override too: a bargain is still never a mint.
 */
export function buyPrice(
  counts: DeepReadonly<{ counts: Record<string, number> }>,
  npcId: string,
  line: ShopLine,
  goldGain: number,
): number {
  const base = askingPrice(line, hasMet(counts, npcId));
  const asked = counterValue(counts, PRICE_SEAL_FLAG) > 0 ? Math.max(1, Math.ceil(base * PRICE_SEAL_MULT)) : base;
  return Math.max(asked, resaleCeiling(line, goldGain) + 1);
}

/** Lines a vendor shows this player: unknown ids and unmet `requires` stay off the shelf. */
export function visibleLines(ctx: ReadCtx, npc: NpcDef): ShopLine[] {
  const r = conditionReader(ctx);
  return (npc.shop?.lines ?? []).filter((line) => {
    const known = line.kind === 'item' ? ITEMS[line.id] : MATERIALS[line.id];
    return !!known && (!line.requires || conditionsMet(r, line.requires));
  });
}

export function lineName(line: ShopLine): string {
  if (line.kind === 'item') return ITEMS[line.id]?.name ?? line.id;
  const def = MATERIALS[line.id];
  const grade = def?.graded ? `${QUALITY_TIERS[lineQuality(line)].name} ` : '';
  return `${grade}${def?.name ?? line.id}`;
}

export function lineIcon(line: ShopLine): string {
  return (line.kind === 'item' ? ITEMS[line.id]?.icon : MATERIALS[line.id]?.icon) ?? '📦';
}

// ---- the command ----

/**
 * Buy `qty` of the line at `index` on this vendor's visible shelf. Partial
 * buys are deliberate: "buy 5" with gold for 3 buys 3. The old `buy`.
 */
export const buy = defineCommand<{ npc: string; index: number; qty?: number }>('shops/buy');

// ---- view ----

export interface ShopLineView {
  index: number;
  kind: 'item' | 'material';
  id: string;
  name: string;
  icon: string;
  price: number;
}

export interface CounterView {
  npc: string;
  npcName: string;
  icon: string;
  name: string;
  met: boolean;
  lines: ShopLineView[];
}

export interface ShopsView {
  gold: number;
  /** Counters at the spot the player stands on. */
  counters: CounterView[];
}

/** Nothing about a shop is saved. */
export interface ShopsState {}

const system = defineSystem<ShopsState, ShopsView>({
  id: 'shops',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { shops_text: shopsText },

  commands: [
    handle(buy, (ctx, { npc: npcId, index, qty = 1 }) => {
      const npc = NPCS[npcId];
      if (!npc?.shop) return skipped(`"${npcId}" keeps no counter`);
      if (ctx.read(world).spot !== npc.spotId) return skipped(`${npc.name} is not here`);
      const line = visibleLines(ctx, npc)[index];
      if (!line) return skipped(`${npc.shop.name} has no line ${index}`);
      if (!(qty > 0)) return skipped('nothing to buy: the quantity is 0');
      const unit = buyPrice(ctx.read(counters), npcId, line, statOf(ctx, 'goldGain'));
      const count = Math.min(Math.floor(qty), Math.floor(ctx.read(gold).gold / unit));
      if (count <= 0) return skipped(`${lineName(line)} costs ${unit} gold; the purse holds ${ctx.read(gold).gold}`);
      const total = unit * count;
      ctx.request(spendGold, { amount: total });

      if (line.kind === 'item') {
        for (let i = 0; i < count; i++) ctx.request(grantItem, { defId: line.id });
      } else if (isGraded(line.id)) {
        // Bought goods are a known grade, not a rolled one: the shelf said so.
        ctx.request(grantGraded, { id: line.id, quality: lineQuality(line), qty: count });
      } else {
        ctx.request(grantMaterial, { id: line.id, qty: count });
      }

      ctx.emit(bumpCounter, { key: 'gold:spent', amount: total });
      ctx.emit(bumpCounter, { key: 'shop:buys', amount: count });
      ctx.emit(bumpCounter, { key: `shop:buys:${npcId}`, amount: count });
      ctx.emit(logLine, {
        msg: fillText(TEXT.shops_bought, {
          icon: lineIcon(line),
          name: lineName(line),
          qty: count > 1 ? fillText(TEXT.common_times, { qty: count }) : '',
          total,
        }),
        kind: 'item',
      });
      return OK;
    }),
  ],

  view: (ctx) => {
    const counts = ctx.read(counters);
    const goldGain = statOf(ctx, 'goldGain');
    const here = ctx.read(world).spot;
    return {
      gold: ctx.read(gold).gold,
      counters: Object.values(NPCS)
        .filter((n) => n.spotId === here && n.shop)
        .map((n) => ({
          npc: n.id,
          npcName: n.name,
          icon: n.icon,
          name: n.shop!.name,
          met: hasMet(counts, n.id),
          lines: visibleLines(ctx, n).map((line, index) => ({
            index,
            kind: line.kind,
            id: line.id,
            name: lineName(line),
            icon: lineIcon(line),
            price: buyPrice(counts, n.id, line, goldGain),
          })),
        })),
    };
  },
});

export default system;
