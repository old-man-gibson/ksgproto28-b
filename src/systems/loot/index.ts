/**
 * Drop tables: the table format and the roll. Port of `DropEntry`,
 * `DropTable`, `dropKey`, `dropRowsFor` and `rollDropTable` of the old
 * `systems/combat.ts`, and of the drop-table checks of the old
 * `tests/content.test.ts`. See README.md in this folder.
 *
 * This system holds no state. A roll changes other systems through their
 * requests: `mercy`, `gold`, `materials`, `items`.
 */
import {
  answer,
  defineEvent,
  defineRequest,
  defineSystem,
  registry,
  s,
  type DeepReadonly,
  type Infer,
} from '../../kernel';
import counters, { hasFlag } from '../counters';
import { addGold } from '../gold';
import { grantItem, grantRune, ITEMS, itemName, RUNECARVING_FLAG, RUNES, type ItemInstance, type RarityId, type SizeTag } from '../items';
import { fillText, huntLine, logLine, textSchema, type TextRecord } from '../log';
import { grantMaterial, huntMaterialLabel, MATERIALS, type QualityTier } from '../materials';
import { mercyTracked, rollMercyPick } from '../mercy';
import { DAMAGE_TYPES, scopedMult, statOf, type DamageType } from '../stats';
import lootTextData from './content/loot_text.json';
import { migrations } from './migrations';

// ---- the table format ----

export const DROP_KINDS = ['item', 'material', 'gold', 'rune', 'nothing'] as const;
export type DropKind = (typeof DROP_KINDS)[number];

/** One weighted entry in a drop table, as content writes it. */
export const dropEntrySchema = s.object({
  kind: s.enum(DROP_KINDS),
  id: s.optional(s.string({ help: 'Item, material or rune id. Required for those kinds. Checked by dropTableIssues.' })),
  weight: s.number(),
  qty: s.optional(s.array(s.number(), { help: 'Lowest and highest quantity. Default 1 and 1. The gold amount for gold.' })),
  killedBy: s.optional(
    s.array(s.enum(DAMAGE_TYPES), {
      help: 'A method drop: in the roll only when the killing blow was one of these types.',
    }),
  ),
});

/**
 * A drop table, as content writes it. The monster and location registries of
 * the later ports use this schema for their `loot` field.
 */
export const dropTableSchema = s.object({
  rolls: s.number({ min: 1 }),
  entries: s.array(dropEntrySchema),
});

export interface DropEntry {
  kind: DropKind;
  id?: string;
  weight: number;
  /** Quantity range, default [1, 1]. */
  qty?: [number, number];
  /**
   * A method drop. On a kill by any other type its weight rolls as `nothing`,
   * so the row keeps its authored share and the drought ledger never sees it.
   */
  killedBy?: DamageType[];
}

export interface DropTable {
  rolls: number;
  entries: DropEntry[];
}

/** A table as the schema types it is a `DropTable` once `dropTableIssues` is empty. */
export type DropTableRecord = Infer<typeof dropTableSchema>;

/**
 * What the schema cannot check of a drop table, as messages. Empty when
 * sound. The drought ledger keys a drop on kind and id, so the same drop
 * listed twice would escalate at double rate.
 */
export function dropTableIssues(table: DeepReadonly<DropTableRecord>): string[] {
  const issues: string[] = [];
  if (!(table.rolls > 0)) issues.push('rolls must be above 0');
  const seen = new Set<string>();
  for (const e of table.entries) {
    const name = `${e.kind}:${e.id ?? ''}`;
    if (e.kind !== 'nothing') {
      if (seen.has(name)) issues.push(`lists ${name} twice`);
      seen.add(name);
    }
    if (!(e.weight > 0)) issues.push(`${name}: weight must be above 0`);
    if (e.kind === 'item' && !ITEMS[e.id ?? '']) issues.push(`drops item "${e.id}", which is not a record of "items"`);
    if (e.kind === 'material' && !MATERIALS[e.id ?? ''])
      issues.push(`drops material "${e.id}", which is not a record of "materials"`);
    if (e.kind === 'rune' && !RUNES[e.id ?? '']) issues.push(`drops rune "${e.id}", which is not a record of "runes"`);
    if ((e.kind === 'gold' || e.kind === 'nothing') && e.id !== undefined) issues.push(`${name}: ${e.kind} takes no id`);
    if (e.qty) {
      if (e.qty.length !== 2) issues.push(`${name}: qty must be a lowest and a highest number`);
      else if (e.qty[0] > e.qty[1]) issues.push(`${name}: qty lowest ${e.qty[0]} is above highest ${e.qty[1]}`);
    }
    // `killedBy: []` matches no kill: a row that never drops.
    if (e.killedBy && e.killedBy.length === 0) issues.push(`${name}: killedBy is empty, so the row never drops`);
  }
  return issues;
}

// ---- the roll ----

/** Chance of an affix on a dropped item, by the rarity of what was killed. */
export const AFFIX_CHANCE: Record<RarityId, number> = { common: 0.08, uncommon: 0.25, rare: 0.5, epic: 0.9 };

/** The key of a drop entry in the drought ledger: per source and per entry, by kind and id. */
export function dropKey(source: string, entry: Pick<DropEntry, 'kind' | 'id'>): string {
  return `loot:${source}:${entry.kind}:${entry.id ?? ''}`;
}

/**
 * The rows one kill rolls. A method row the killing blow did not match
 * leaves the table before the pick, and its weight rolls as `nothing` in its
 * place. Out of the pick, it is neither written to nor read from the drought
 * ledger, and every other row keeps its authored share.
 */
export function dropRowsFor(table: DeepReadonly<DropTable>, lastHit: DamageType | undefined): DeepReadonly<DropEntry>[] {
  let unmatched = 0;
  const rows = table.entries.filter((e) => {
    if (!e.killedBy || (lastHit !== undefined && e.killedBy.includes(lastHit))) return true;
    unmatched += e.weight;
    return false;
  });
  if (unmatched > 0) rows.push({ kind: 'nothing', weight: unmatched });
  return rows;
}

export interface DropRoll {
  table: DropTable;
  /** Id of what was killed. Keys the drought ledger. */
  source: string;
  /** Tags of what was killed. Scoped loot (`loot:beast`) reads them. */
  tags: string[];
  /** The loot multiplier of its rarity times the reward multiplier of its modifier tier. */
  rewardMult: number;
  /** Its rarity: sets the affix chance of a dropped item. */
  rarity: RarityId;
  /** Its level as rewards read it. Scales gold. */
  rewardLevel: number;
  /** Its size. A dropped item takes it. Absent reads as medium. */
  size?: SizeTag;
  /** The damage type of the killing blow, for method drops. */
  lastHit?: DamageType;
}

/** One thing a roll paid. A roll that came up `nothing`, or a rune while runecarving is shut, pays nothing. */
export interface Drop {
  kind: Exclude<DropKind, 'nothing'>;
  id?: string;
  /** Units granted. For gold, the gold granted. */
  qty: number;
  /** The grade, when one graded material unit dropped. */
  quality?: QualityTier;
  /** The minted item. */
  item?: ItemInstance;
}

/**
 * Roll a drop table. Loot luck (the loot stat, scoped loot for the tags, the
 * reward multiplier) divides the weight of the `nothing` entries. Rare
 * entries roll under drought protection. Answers what dropped, in roll order.
 */
export const rollDropTable = defineRequest<DropRoll, Drop[]>('loot/roll');

/** An item dropped into the pack. */
export const itemLooted = defineEvent<{ item: ItemInstance; source: string }>('loot/item');

const lootText = registry(textSchema, lootTextData, 'Loot text');
const TEXT = Object.fromEntries((lootTextData as TextRecord[]).map((r) => [r.id, r.text]));

export default defineSystem<Record<string, never>>({
  id: 'loot',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { loot_text: lootText },

  requests: [
    answer(rollDropTable, (ctx, roll) => {
      const { table, source } = roll;
      const luck = statOf(ctx, 'loot') * scopedMult(ctx, 'loot', roll.tags) * roll.rewardMult;

      // Whether an entry is rare enough to protect is read off the authored
      // share, never the luck-adjusted one: a change of gear must not move an
      // entry on or off its counter. The rate it escalates around is the
      // adjusted one.
      const authored = table.entries.reduce((sum, e) => sum + e.weight, 0);
      const rows = dropRowsFor(table, roll.lastHit);
      const keys = rows.map((e) =>
        e.kind !== 'nothing' && mercyTracked(e.weight / authored) ? dropKey(source, e) : null,
      );
      const weights = rows.map((e) => (e.kind === 'nothing' ? e.weight / Math.max(1, luck) : e.weight));

      const drops: Drop[] = [];
      for (let n = 0; n < table.rolls; n++) {
        const pick = rows[ctx.request(rollMercyPick, { weights, keys })];
        const qty = pick.qty ? pick.qty[0] + ctx.rng.int(pick.qty[1] - pick.qty[0] + 1) : 1;

        switch (pick.kind) {
          case 'nothing':
            break;
          case 'gold': {
            const gold = Math.round(qty * roll.rewardLevel * statOf(ctx, 'goldGain'));
            ctx.request(addGold, { amount: gold, earned: true });
            if (gold > 0) ctx.emit(logLine, huntLine([{ label: 'gold', qty: gold, style: 'amount' }]));
            drops.push({ kind: 'gold', qty: gold });
            break;
          }
          case 'material': {
            // A graded material rolls a grade as it drops; loot luck tilts it.
            const got = ctx.request(grantMaterial, { id: pick.id!, qty, luck });
            ctx.emit(logLine, huntLine([{ label: huntMaterialLabel(pick.id!, got.quality), qty }]));
            drops.push({ kind: 'material', id: pick.id, qty, ...(got.quality ? { quality: got.quality } : {}) });
            break;
          }
          case 'rune': {
            // While runecarving is shut, a rune line that comes up pays nothing.
            if (!hasFlag(ctx.read(counters), RUNECARVING_FLAG)) break;
            ctx.request(grantRune, { id: pick.id!, qty });
            drops.push({ kind: 'rune', id: pick.id, qty });
            break;
          }
          case 'item': {
            // Gear is the size of what carried it, and the affix chance rises
            // with the rarity of what was killed.
            const item = ctx.request(grantItem, {
              defId: pick.id!,
              size: roll.size,
              affixChance: AFFIX_CHANCE[roll.rarity],
            });
            ctx.emit(itemLooted, { item, source });
            ctx.emit(logLine, {
              msg: fillText(TEXT.loot_item, { icon: ITEMS[pick.id!]?.icon ?? '', item: itemName(item) }),
              kind: 'loot',
            });
            drops.push({ kind: 'item', id: pick.id, qty: 1, item });
            break;
          }
        }
      }
      return drops;
    }),
  ],
});
