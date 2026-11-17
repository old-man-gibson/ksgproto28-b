import { describe, expect, it } from 'vitest';
import { s, validateValue, type Kernel } from '../src/kernel';
import { counterValue, setCounter, type CountersState } from '../src/systems/counters';
import type { ItemInstance, ItemsState } from '../src/systems/items';
import type { LogView } from '../src/systems/log';
import {
  AFFIX_CHANCE,
  dropKey,
  dropRowsFor,
  dropTableIssues,
  dropTableSchema,
  itemLooted,
  rollDropTable,
  type Drop,
  type DropRoll,
  type DropTable,
} from '../src/systems/loot';
import { heldOf, type MaterialsState } from '../src/systems/materials';
import type { MercyState } from '../src/systems/mercy';
import { statMod, statOf } from '../src/systems/stats';
import { ask, emit, makeGame, setMods, slice } from './helpers';

/**
 * Drop tables. The old build had no test file for `rollDropTable`: it ran
 * inside a kill. Ported cases:
 * - the method-drop cases of the old tests/desert.test.ts ("method drops and
 *   the killing blow"), with the two tables of that test written here, since
 *   the monster registry arrived later, with spine port 4;
 * - the drop-table checks of the old tests/content.test.ts, as
 *   `dropTableIssues`.
 * The other cases are new and call the `loot/roll` request directly.
 *
 * The case that needs a kill in a fight is in `tests/combatStatuses.test.ts`.
 */

/** The mummy of floor 18 (old data/monsters.data.ts `ph_mummy`). */
const MUMMY: DropTable = {
  rolls: 2,
  entries: [
    { kind: 'material', id: 'bone_ash', weight: 6, killedBy: ['heat'] },
    { kind: 'material', id: 'bone_dust', weight: 6, killedBy: ['bludgeoning'] },
    { kind: 'nothing', weight: 18 },
  ],
};

/** The sand colossus of floor 18 (`ph_sand_colossus`). */
const COLOSSUS: DropTable = {
  rolls: 3,
  entries: [
    { kind: 'material', id: 'boss_token', weight: 10 },
    { kind: 'gold', weight: 20, qty: [60, 120] },
    { kind: 'material', id: 'copper_ore', weight: 15, qty: [2, 4] },
    { kind: 'material', id: 'tin_ore', weight: 10, qty: [2, 4] },
    { kind: 'material', id: 'quicksilver', weight: 6, qty: [1, 2], killedBy: ['bludgeoning'] },
    { kind: 'nothing', weight: 39 },
  ],
};

const kill = (table: DropTable, over: Partial<DropRoll> = {}): DropRoll => ({
  table,
  source: 'test_monster',
  tags: [],
  rewardMult: 1,
  rarity: 'common',
  rewardLevel: 1,
  ...over,
});

const roll = (kernel: Kernel, table: DropTable, over: Partial<DropRoll> = {}): Drop[] =>
  ask(kernel, rollDropTable, kill(table, over));

const gold = (kernel: Kernel) => slice<{ gold: number }>(kernel, 'gold').gold;
const pack = (kernel: Kernel) => slice<ItemsState>(kernel, 'items').inventory;
const held = (kernel: Kernel, id: string) => heldOf(slice<MaterialsState>(kernel, 'materials'), id);
const ledger = (kernel: Kernel) => slice<MercyState>(kernel, 'mercy').ledger;
const logLines = (kernel: Kernel) => (kernel.view().systems.log as LogView).log;
const only = (entry: DropTable['entries'][number], rolls = 1): DropTable => ({ rolls, entries: [entry] });

describe('method drops and the killing blow', () => {
  it('unmatched rows leave the table and their weight rolls as nothing', () => {
    const total = MUMMY.entries.reduce((sum, e) => sum + e.weight, 0);
    const ids = (rows: ReturnType<typeof dropRowsFor>) => rows.filter((r) => r.kind !== 'nothing').map((r) => r.id);
    const weight = (rows: ReturnType<typeof dropRowsFor>) => rows.reduce((sum, e) => sum + e.weight, 0);

    expect(ids(dropRowsFor(MUMMY, 'heat'))).toEqual(['bone_ash']);
    expect(ids(dropRowsFor(MUMMY, 'bludgeoning'))).toEqual(['bone_dust']);
    expect(ids(dropRowsFor(MUMMY, 'slashing'))).toEqual([]);
    expect(ids(dropRowsFor(MUMMY, undefined))).toEqual([]);
    // Every row keeps its authored share: the table weighs the same.
    for (const type of ['heat', 'bludgeoning', 'slashing', undefined] as const) {
      expect(weight(dropRowsFor(MUMMY, type))).toBe(total);
    }
  });

  // Ported in tests/combatStatuses.test.ts (spine port 4): damage over time sets lastHit to its type

  it('a kill by an unmatched type banks no drought miss for the keyed row', () => {
    // Quicksilver (6%) is keyed to bludgeoning, the boss token (10%) to
    // nothing. Both sit under the 15% line, so mercy tracks both.
    const kernel = makeGame();
    const keyed = 'loot:ph_sand_colossus:material:quicksilver';
    const plain = 'loot:ph_sand_colossus:material:boss_token';
    expect(dropKey('ph_sand_colossus', COLOSSUS.entries[4])).toBe(keyed);
    let plainSeen = false;
    for (let i = 0; i < 12; i++) {
      roll(kernel, COLOSSUS, { source: 'ph_sand_colossus', lastHit: 'poison' });
      expect(ledger(kernel)[keyed], `kill ${i}: a poison kill wrote the quicksilver ledger`).toBeUndefined();
      plainSeen ||= (ledger(kernel)[plain] ?? 0) > 0;
    }
    expect(plainSeen, 'the unkeyed rare row never banked a miss').toBe(true);
    expect(held(kernel, 'quicksilver')).toBe(0);
  });

  it('heat kills of mummies pay bone ash and never bone dust', () => {
    const kernel = makeGame();
    for (let kills = 0; kills < 40; kills++) roll(kernel, MUMMY, { source: 'ph_mummy', lastHit: 'heat' });
    expect(held(kernel, 'bone_ash')).toBeGreaterThan(0);
    expect(held(kernel, 'bone_dust')).toBe(0);
  });

  it('the matching kill keeps the row on its authored share', () => {
    // Bone ash is 6 of 30 on each of two rolls: about 40 per 100 heat kills.
    const kernel = makeGame();
    let paid = 0;
    const kills = 3000;
    for (let i = 0; i < kills; i++) paid += roll(kernel, MUMMY, { source: 'ph_mummy', lastHit: 'heat' }).length;
    expect(paid / kills).toBeGreaterThan(0.36);
    expect(paid / kills).toBeLessThan(0.44);
  });
});

describe('the drop table format', () => {
  it('the schema accepts the old tables as written', () => {
    for (const table of [MUMMY, COLOSSUS]) {
      const issues: { path: string; message: string }[] = [];
      validateValue(dropTableSchema, table, 'loot', issues, []);
      expect(issues).toEqual([]);
      expect(dropTableIssues(table)).toEqual([]);
    }
  });

  it('a registry of a later port can use the schema for its loot field', () => {
    const monster = s.object({ id: s.id(), loot: dropTableSchema });
    const issues: { path: string; message: string }[] = [];
    validateValue(monster, { id: 'wolf', loot: { rolls: 0, entries: [{ kind: 'treasure', weight: 1 }] } }, 'wolf', issues, []);
    expect(issues.map((i) => i.path)).toEqual(['wolf.loot.rolls', 'wolf.loot.entries.0.kind']);
  });

  it('reports what the schema cannot check', () => {
    const issues = dropTableIssues({
      rolls: 1,
      entries: [
        { kind: 'item', id: 'no_such_item', weight: 1 },
        { kind: 'material', id: 'no_such_material', weight: 1 },
        { kind: 'rune', id: 'no_such_rune', weight: 1 },
        { kind: 'material', id: 'slime_gel', weight: 0 },
        { kind: 'material', id: 'slime_gel', weight: 1, qty: [3, 2] },
        { kind: 'gold', weight: 1, qty: [1] },
        { kind: 'material', id: 'bone_ash', weight: 1, killedBy: [] },
        { kind: 'nothing', weight: 1 },
        { kind: 'nothing', weight: 1 },
      ],
    });
    expect(issues).toEqual([
      'drops item "no_such_item", which is not a record of "items"',
      'drops material "no_such_material", which is not a record of "materials"',
      'drops rune "no_such_rune", which is not a record of "runes"',
      'material:slime_gel: weight must be above 0',
      // The drought ledger keys a drop on kind and id: listed twice, it would escalate at double rate.
      'lists material:slime_gel twice',
      'material:slime_gel: qty lowest 3 is above highest 2',
      'gold:: qty must be a lowest and a highest number',
      'material:bone_ash: killedBy is empty, so the row never drops',
    ]);
  });
});

describe('rolling a table', () => {
  it('gold is the quantity times the reward level times gold gain, rounded, and counts as earned', () => {
    const kernel = makeGame();
    const gain = statOf(kernel, 'goldGain');
    const drops = roll(kernel, only({ kind: 'gold', weight: 1, qty: [10, 10] }), { rewardLevel: 3 });
    const paid = Math.round(10 * 3 * gain);
    expect(drops).toEqual([{ kind: 'gold', qty: paid }]);
    expect(gold(kernel)).toBe(paid);
    expect(counterValue(slice<CountersState>(kernel, 'counters'), 'gold:earned')).toBe(paid);
    expect(logLines(kernel).at(-1)).toMatchObject({ msg: `☠️ Hunt: ${paid} gold`, kind: 'combat' });
  });

  it('a quantity is drawn inside its range, both ends included', () => {
    const kernel = makeGame();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const [drop] = roll(kernel, only({ kind: 'material', id: 'copper_ore', weight: 1, qty: [2, 4] }));
      seen.add(drop.qty);
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('a plain material is counted; one graded unit names its grade in the answer and in the log', () => {
    const kernel = makeGame();
    expect(roll(kernel, only({ kind: 'material', id: 'slime_gel', weight: 1 }))).toEqual([
      { kind: 'material', id: 'slime_gel', qty: 1 },
    ]);
    expect(held(kernel, 'slime_gel')).toBe(1);
    expect(logLines(kernel).at(-1)?.msg).toBe('☠️ Hunt: 🫧 Slime Gel');

    const [graded] = roll(kernel, only({ kind: 'material', id: 'warm_slime_gel', weight: 1 }));
    expect(graded.quality).toBeDefined();
    expect(slice<MaterialsState>(kernel, 'materials').stock['warm_slime_gel']).toEqual({ [graded.quality!]: 1 });
    expect(logLines(kernel).at(-1)?.msg).toMatch(/Warm Slime Gel \((Refuse|Poor|Common|Fair|Fine|Superb|Divine)\)/);
  });

  it('a hunt line folds consecutive drops into one tally', () => {
    const kernel = makeGame();
    roll(kernel, only({ kind: 'material', id: 'slime_gel', weight: 1 }, 3));
    const lines = logLines(kernel).filter((l) => l.msg.startsWith('☠️ Hunt:'));
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('☠️ Hunt: 🫧 Slime Gel ×3');
  });

  it('an item drops into the pack with rolled slots, logs, and raises loot/item', () => {
    const kernel = makeGame();
    const looted: ItemInstance[] = [];
    kernel.onEvent((event) => {
      if (event.type === itemLooted.type) looted.push((event.payload as { item: ItemInstance }).item);
    });
    const [drop] = roll(kernel, only({ kind: 'item', id: 'wolf_fang_blade', weight: 1 }), { source: 'forest_wolf' });
    expect(drop).toMatchObject({ kind: 'item', id: 'wolf_fang_blade', qty: 1 });
    expect(pack(kernel).at(-1)).toEqual(drop.item);
    expect(drop.item!.uid).toBe(2);
    expect(looted).toEqual([drop.item]);
    const line = logLines(kernel).at(-1)!;
    expect(line.kind).toBe('loot');
    expect(line.msg).toMatch(/^📦 Loot: 🐺 (Sharp |Sturdy |Swift |Lucky |Warded )?Wolf-Fang Blade$/);
  });

  it('a dropped item is the size of what carried it', () => {
    const kernel = makeGame();
    const table = only({ kind: 'item', id: 'jotunshamarr', weight: 1 });
    expect(roll(kernel, table, { size: 'gargantuan' })[0].item!.size).toBe('gargantuan');
    expect(roll(kernel, table, { size: 'medium' })[0].item!.size).toBeUndefined();
    expect(roll(kernel, table)[0].item!.size).toBeUndefined();
  });

  it('the affix chance rises with the rarity of what was killed', () => {
    expect(AFFIX_CHANCE).toEqual({ common: 0.08, uncommon: 0.25, rare: 0.5, epic: 0.9 });
    const share = (rarity: DropRoll['rarity']) => {
      const kernel = makeGame();
      const drops = roll(kernel, only({ kind: 'item', id: 'iron_dagger', weight: 1 }, 400), { rarity });
      return drops.filter((d) => d.item!.affix).length / 400;
    };
    expect(share('common')).toBeLessThan(0.16);
    expect(share('rare')).toBeGreaterThan(0.4);
    expect(share('rare')).toBeLessThan(0.6);
    expect(share('epic')).toBeGreaterThan(0.82);
  });

  it('a rune line pays nothing while runecarving is shut, and a rune once it is open', () => {
    const kernel = makeGame();
    const table = only({ kind: 'rune', id: 'minor_rune_might', weight: 1 });
    expect(roll(kernel, table)).toEqual([]);
    expect(slice<ItemsState>(kernel, 'items').runes).toEqual({});

    emit(kernel, setCounter, { key: 'flag:unlock_runecarving', value: 1 });
    expect(roll(kernel, table)).toEqual([{ kind: 'rune', id: 'minor_rune_might', qty: 1 }]);
    expect(slice<ItemsState>(kernel, 'items').runes).toEqual({ minor_rune_might: 1 });
    expect(logLines(kernel).at(-1)?.msg).toBe('🔺 Rune found: Minor Rune of Might');
  });

  it('a table that comes up nothing pays nothing', () => {
    const kernel = makeGame();
    expect(roll(kernel, only({ kind: 'nothing', weight: 1 }, 5))).toEqual([]);
    expect(gold(kernel)).toBe(0);
    expect(pack(kernel)).toHaveLength(1);
  });
});

describe('loot luck', () => {
  const HALF: DropTable = {
    rolls: 1,
    entries: [
      { kind: 'material', id: 'slime_gel', weight: 50 },
      { kind: 'nothing', weight: 50 },
    ],
  };
  const paidShare = (kernel: Kernel, over: Partial<DropRoll> = {}, n = 4000) => {
    let paid = 0;
    for (let i = 0; i < n; i++) paid += roll(kernel, HALF, over).length;
    return paid / n;
  };

  it('divides the weight of nothing, and leaves a luck under 1 alone', () => {
    // Luck 1: 50 of 100. Luck 2: nothing weighs 25, so 50 of 75.
    expect(paidShare(makeGame())).toBeCloseTo(0.5, 1);
    expect(paidShare(makeGame(), { rewardMult: 2 })).toBeCloseTo(2 / 3, 1);
    // The divisor is held at 1 or more: a luck under 1 does not grow nothing.
    expect(paidShare(makeGame(), { rewardMult: 0.25 })).toBeCloseTo(0.5, 1);
  });

  it('reads the loot stat, and scoped loot only for the tags of what was killed', () => {
    const lucky = makeGame();
    setMods(lucky, [statMod('loot', 'mult', 1)]);
    expect(paidShare(lucky)).toBeCloseTo(2 / 3, 1);

    const hunter = makeGame();
    setMods(hunter, [statMod('loot:beast', 'mult', 1)]);
    expect(paidShare(hunter, { tags: ['beast'] })).toBeCloseTo(2 / 3, 1);
    expect(paidShare(hunter, { tags: ['construct'] })).toBeCloseTo(0.5, 1);
  });

  it('tilts the grade of a graded material', () => {
    const fine = (rewardMult: number) => {
      const kernel = makeGame();
      roll(kernel, only({ kind: 'material', id: 'warm_slime_gel', weight: 1 }, 3000), { rewardMult });
      const stock = slice<MaterialsState>(kernel, 'materials').stock['warm_slime_gel'];
      return (stock.b ?? 0) + (stock.a ?? 0) + (stock.s ?? 0);
    };
    expect(fine(4)).toBeGreaterThan(fine(1) * 1.5);
  });
});

describe('drought protection on a table', () => {
  const RARE: DropTable = {
    rolls: 1,
    entries: [
      { kind: 'material', id: 'slime_gel', weight: 60 },
      { kind: 'item', id: 'wolf_fang_blade', weight: 2 },
      { kind: 'nothing', weight: 38 },
    ],
  };

  it('tracks the rare row per source, and never the common row or nothing', () => {
    const kernel = makeGame();
    for (let i = 0; i < 30; i++) roll(kernel, RARE, { source: 'forest_wolf' });
    for (let i = 0; i < 30; i++) roll(kernel, RARE, { source: 'boar' });
    const keys = Object.keys(ledger(kernel));
    for (const key of keys) expect(['loot:forest_wolf:item:wolf_fang_blade', 'loot:boar:item:wolf_fang_blade']).toContain(key);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('reads whether a row is rare off the authored share, not the luck-adjusted one', () => {
    // At luck 20 nothing weighs 1.9 and the blade is 2 of 63.9: still under
    // the 15% line. A 14-of-100 row would pass the line at this luck, and it
    // stays tracked because the authored share decides.
    const table: DropTable = {
      rolls: 1,
      entries: [
        { kind: 'material', id: 'slime_gel', weight: 14 },
        { kind: 'nothing', weight: 86 },
      ],
    };
    const kernel = makeGame();
    let missed = false;
    for (let i = 0; i < 40 && !missed; i++) {
      roll(kernel, table, { source: 'slime', rewardMult: 20 });
      missed = (ledger(kernel)['loot:slime:material:slime_gel'] ?? 0) > 0;
    }
    expect(missed).toBe(true);
  });

  it('bounds the wait for a rare drop', () => {
    const kernel = makeGame();
    let dry = 0;
    let worst = 0;
    let hits = 0;
    const kills = 20_000;
    for (let i = 0; i < kills; i++) {
      if (roll(kernel, RARE, { source: 'forest_wolf' }).some((d) => d.kind === 'item')) {
        worst = Math.max(worst, dry);
        dry = 0;
        hits++;
      } else dry++;
    }
    // 2% authored. Plain geometric would pass 300 dry kills in a run this long.
    expect(hits / kills).toBeGreaterThan(0.02 * 0.85);
    expect(hits / kills).toBeLessThan(0.02 * 1.15);
    expect(worst).toBeLessThan(250);
  });
});

describe('determinism', () => {
  it('the same seed and the same kills give the same drops and the same state', () => {
    const run = () => {
      const kernel = makeGame();
      const drops: Drop[][] = [];
      for (let i = 0; i < 60; i++) {
        drops.push(roll(kernel, COLOSSUS, { source: 'ph_sand_colossus', lastHit: i % 2 ? 'bludgeoning' : 'heat', rewardLevel: 18 }));
        drops.push(roll(kernel, { rolls: 1, entries: [{ kind: 'item', id: 'iron_dagger', weight: 1 }] }, { rarity: 'rare' }));
      }
      return { drops, state: kernel.snapshot() };
    };
    expect(run()).toEqual(run());
  });

  it('a roll split by a save and a load continues the same stream', () => {
    const whole = makeGame();
    for (let i = 0; i < 20; i++) roll(whole, COLOSSUS, { source: 'ph_sand_colossus' });

    const first = makeGame();
    for (let i = 0; i < 10; i++) roll(first, COLOSSUS, { source: 'ph_sand_colossus' });
    const second = makeGame();
    expect(second.load(JSON.parse(JSON.stringify(first.save(0)))).ok).toBe(true);
    for (let i = 0; i < 10; i++) roll(second, COLOSSUS, { source: 'ph_sand_colossus' });
    for (const id of ['gold', 'items', 'materials', 'mercy']) expect(slice(second, id), id).toEqual(slice(whole, id));
  });
});
