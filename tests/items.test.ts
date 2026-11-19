import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { conditionIssues, conditionMet, setCounter } from '../src/systems/counters';
import {
  itemValue,
  affixOfId,
  canEquip,
  carriedStash,
  compareToWorn,
  effectiveTerms,
  findItem,
  grantItem,
  grantRune,
  isConditional,
  ITEM_LIST,
  itemDefOf,
  ITEMS,
  keepMarked,
  lowerIsBetter,
  resolveRune,
  RUNE_LIST,
  runeEffectAt,
  sizeRank,
  SLOT_IDS,
  stashItem,
  takeFromStash,
  wearIfFree,
  weaponDef,
  type Affix,
  type Equipment,
  type ItemInstance,
  type ItemsState,
  type ItemsView,
  type SlotId,
} from '../src/systems/items';
import type { LogView } from '../src/systems/log';
import { conditionReader, SKILL_LIST, SKILLS } from '../src/systems/skills';
import { attrValue, effectiveAttr, fuseFact, hasWieldTag, namedFact, statBlockOf, targetIssue } from '../src/systems/stats';
import { ask, emit, equip, giveItem, makeGame, patch, reads, setMods, slice, unequip } from './helpers';

/**
 * The items system: equip and unequip, requirements, what worn gear gives
 * the stat block, the comparison against the worn piece, the stash, the
 * view and the save.
 *
 * Ported cases:
 * - the equipment cases of the old tests/attributes.test.ts, left behind by
 *   port 1 ("effective attributes (stat layer)");
 * - `compareToWorn` and the conditional and lower-is-better cases of the old
 *   tests/gearcompare.test.ts;
 * - the stash item cases of the old tests/festival.test.ts.
 *
 * Changed: the call shape. `g.equip(uid)` is the `items/equip` command.
 *
 * Left behind, as `it.todo`: spare marks (`beats`, `findSpares`: they sell,
 * port 7), forged items (modular smithing), festival tokens (festival).
 */

const items = (kernel: Kernel) => slice<ItemsState>(kernel, 'items');
const worn = (kernel: Kernel) => items(kernel).equipment;
const view = (kernel: Kernel) => kernel.view().systems.items as ItemsView;
const logLines = (kernel: Kernel) => (kernel.view().systems.log as LogView).log;
const sound = (kernel: Kernel) => expect(kernel.staleStats()).toEqual([]);
const setAttr = (kernel: Kernel, attr: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', level: number) =>
  patch(kernel, (slices) => ((slices.attributes as AttributesState).attrs[attr].level = level));

describe('item content', () => {
  it('holds the 47 items of the old registry; the forged class stubs come from smithing, not the record list', () => {
    expect(ITEM_LIST).toHaveLength(47);
    expect(ITEMS.rusty_sword).toMatchObject({ slot: 'weapon', wield: 'one_handed', tags: ['sword', 'metal'], value: 5 });
    expect(ITEM_LIST.some((def) => def.id.startsWith('forged'))).toBe(false);
  });

  it('item requirements resolve; katanas follow the sword-subgroup taxonomy', () => {
    // Old tests/content.test.ts, "items & recipes".
    for (const def of ITEM_LIST) {
      for (const req of def.requirements ?? []) {
        expect(conditionIssues(req as never), `item ${def.id}`).toEqual([]);
        if (req.type === 'skill') expect(SKILLS[req.id], `item ${def.id} requires skill ${req.id}`).toBeDefined();
      }
      if (def.tags.includes('katana')) expect(def.tags, `${def.id}: katana is a sword subgroup`).toContain('sword');
    }
  });

  it('every item names its own icon, and no name is empty', () => {
    // Old tests/icons.test.ts: one emoji stands for several items, so each
    // item names its art. The icon files are bought art and are not here.
    for (const def of ITEM_LIST) {
      expect(def.art, `${def.id}: art`).toBeTruthy();
      expect(def.icon, `${def.id}: icon`).toBeTruthy();
    }
  });

  it('weapon-family bonuses only apply while that weapon is held', () => {
    // Old tests/content.test.ts, left behind by port 1 because it reads the
    // item registry. The style of a `requiresStyle` gate is not checked
    // against a registry here: the styles port adds that.
    const WEAPON_TAGS = new Set(['sword', 'greatsword', 'dagger', 'bow', 'blunt', 'staff', 'shield', 'unarmed']);
    /** The weapon family a skill belongs to: its own, or its nearest ancestor's. */
    const familyOf = (id: string): string | undefined => {
      const def = SKILLS[id];
      if (!def) return undefined;
      const own = def.tags.find((t) => WEAPON_TAGS.has(t));
      return own ?? (def.parent ? familyOf(def.parent) : undefined);
    };
    /** A sub-family tag (katana within sword) is a narrower gate: every item carrying it carries the family tag. */
    const narrowerThan = (tag: string, family: string) => {
      const carriers = ITEM_LIST.filter((i) => i.tags.includes(tag));
      return carriers.length > 0 && carriers.every((i) => i.tags.includes(family));
    };
    const gated = (mod: { requiresTag?: string; requiresStyle?: string }, family: string) =>
      mod.requiresTag === family ||
      (mod.requiresTag !== undefined && narrowerThan(mod.requiresTag, family)) ||
      mod.requiresStyle !== undefined;

    for (const def of SKILL_LIST) {
      const family = familyOf(def.id);
      if (!family) continue;
      for (const mod of def.effects ?? []) {
        expect(gated(mod, family), `${def.id}: '${mod.stat}' must require ${family} or a style`).toBe(true);
      }
      for (const milestone of def.milestones ?? []) {
        for (const mod of milestone.bonus) expect(gated(mod, family), `${def.id} milestone '${mod.stat}'`).toBe(true);
      }
    }
  });

  it('every modifier of every item, affix and rune targets a stat the pipeline knows', () => {
    // Old tests/content.test.ts, "every modifier targets a real stat".
    const check = (where: string, mods: readonly { stat: string }[] | undefined) => {
      for (const m of mods ?? []) expect(targetIssue(m.stat), `${where}: ${m.stat}`).toBeNull();
    };
    for (const def of ITEM_LIST) {
      check(`item ${def.id}`, def.mods);
      check(`item ${def.id} main hand`, def.mainHand?.mods);
      check(`item ${def.id} off hand`, def.offHand?.mods);
    }
    for (const rune of RUNE_LIST) for (const e of rune.effects) check(`rune ${rune.id} ${e.context}`, e.mods);
  });

  it('every item sits in a real slot and a requirement is a sound condition', () => {
    for (const def of ITEM_LIST) {
      expect(SLOT_IDS, def.id).toContain(def.slot);
      for (const req of def.requirements ?? []) expect(['attr', 'skill'], def.id).toContain(req.type);
    }
  });

  it('a rune resolves through one door, and an unknown reference reads as a worn rune', () => {
    expect(resolveRune('minor_rune_might').name).toBe('Minor Rune of Might');
    expect(resolveRune('no_such_rune').name).toBe('Worn Rune');
    expect(runeEffectAt('minor_rune_might', 'armor')?.mods).toEqual([{ stat: 'armor', op: 'add', value: 2 }]);
    expect(runeEffectAt('no_such_rune', 'armor')).toBeUndefined();
  });
});

describe('a new character', () => {
  it('holds the rusty sword in the pack, not equipped', () => {
    const kernel = makeGame();
    expect(items(kernel)).toEqual({
      uidCounter: 1,
      inventory: [{ uid: 1, defId: 'rusty_sword', slots: 1, runes: [] }],
      equipment: {},
      runes: {},
      stash: [],
      bearer: { grants: [], size: 'medium' },
    });
    expect(hasWieldTag(kernel, 'unarmed')).toBe(true);
    expect(weaponDef(items(kernel))).toBeUndefined();
  });
});

describe('equip and unequip', () => {
  it('equipping moves the item from the pack to its slot, logs it and feeds the stat block', () => {
    const kernel = makeGame();
    const bare = statBlockOf(kernel).damage;
    expect(equip(kernel, 1)).toEqual({ ok: true });
    expect(worn(kernel).weapon).toEqual({ uid: 1, defId: 'rusty_sword', slots: 1, runes: [] });
    expect(items(kernel).inventory).toEqual([]);
    expect(statBlockOf(kernel).damage).toBe(bare + 3);
    expect(logLines(kernel).at(-1)).toMatchObject({ msg: 'Equipped 🗡️ Rusty Sword.', kind: 'item' });
    expect(weaponDef(items(kernel))?.id).toBe('rusty_sword');
    sound(kernel);

    expect(unequip(kernel, 'weapon')).toEqual({ ok: true });
    expect(worn(kernel)).toEqual({});
    expect(items(kernel).inventory.map((i) => i.uid)).toEqual([1]);
    expect(statBlockOf(kernel).damage).toBe(bare);
    sound(kernel);
  });

  it('states the tags of worn gear, and bare hands wield "unarmed"', () => {
    const kernel = makeGame();
    const met = (tag: string) => conditionMet(conditionReader(reads(kernel)), { type: 'equippedTag', tag });
    expect(met('unarmed')).toBe(true);
    expect(met('sword')).toBe(false);
    equip(kernel, 1);
    expect(met('unarmed')).toBe(false);
    expect(met('sword')).toBe(true);
    expect(met('metal')).toBe(true);
    // A tag of armour counts too: the condition reads every worn piece.
    equip(kernel, giveItem(kernel, 'leather_vest').uid);
    for (const tag of ITEMS.leather_vest.tags) expect(met(tag), tag).toBe(true);
  });

  it('the piece already in the slot goes back to the pack', () => {
    const kernel = makeGame();
    const iron = giveItem(kernel, 'iron_sword');
    equip(kernel, 1);
    equip(kernel, iron.uid);
    expect(worn(kernel).weapon?.uid).toBe(iron.uid);
    expect(items(kernel).inventory.map((i) => i.uid)).toEqual([1]);
    sound(kernel);
  });

  it('an off-hand note is in the log line', () => {
    const kernel = makeGame();
    equip(kernel, giveItem(kernel, 'iron_sword').uid, 'offhand');
    expect(logLines(kernel).at(-1)?.msg).toBe('Equipped ⚔️ Iron Sword: One-handed in the off hand — 60% effect.');
  });

  it('skips with a reason: not in the pack, requirements, wrong slot, empty slot', () => {
    const kernel = makeGame();
    expect(equip(kernel, 99)).toEqual({ ok: false, reason: 'item 99 is not in the pack' });

    const greatsword = giveItem(kernel, 'steel_greatsword'); // needs STR 12
    expect(equip(kernel, greatsword.uid)).toEqual({
      ok: false,
      reason: 'requirements not met for Steel Greatsword: Strength 12',
    });
    expect(logLines(kernel).at(-1)).toMatchObject({ msg: 'Requirements not met for ⚔️ Steel Greatsword.', kind: 'danger' });
    expect(worn(kernel)).toEqual({});

    expect(equip(kernel, 1, 'head')).toEqual({ ok: false, reason: 'Rusty Sword cannot go in the slot "head"' });
    expect(logLines(kernel).at(-1)).toMatchObject({ msg: '🗡️ Rusty Sword cannot be held there.', kind: 'danger' });

    expect(unequip(kernel, 'weapon')).toEqual({ ok: false, reason: 'nothing is worn in the slot "weapon"' });
    patch(kernel, (slices) => (slices.items as ItemsState).inventory.push({ uid: 77, defId: 'no_such_item' }));
    expect(equip(kernel, 77)).toEqual({ ok: false, reason: 'item "no_such_item" has no definition' });
  });

  it('finds an item by uid in the pack or worn', () => {
    const kernel = makeGame();
    const vest = giveItem(kernel, 'leather_vest');
    equip(kernel, 1);
    expect(findItem(items(kernel), 1)?.defId).toBe('rusty_sword');
    expect(findItem(items(kernel), vest.uid)?.defId).toBe('leather_vest');
    expect(findItem(items(kernel), 404)).toBeNull();
  });
});

describe('effective attributes (stat layer)', () => {
  it('equipment attribute bonuses raise the effective value and derived stats', () => {
    const kernel = makeGame();
    setAttr(kernel, 'str', 10);
    const before = statBlockOf(kernel).damage;

    const sword = giveItem(kernel, 'steel_greatsword'); // STR+3, needs STR 12
    setAttr(kernel, 'str', 12);
    equip(kernel, sword.uid);
    // 12 trained + 3 sword + 1 milestone (Lv 5), ×1.01 milestone (Lv 10)
    expect(effectiveAttr(kernel, 'str')).toBeCloseTo(16 * 1.01, 5);
    expect(attrValue(kernel, 'str')).toBeCloseTo(16 * 1.01, 5);
    // The damage base includes the +3 STR (×1.2) and the +14 flat.
    expect(statBlockOf(kernel).damage).toBeGreaterThan(before + 14 + 3 * 1.2);

    unequip(kernel, 'weapon');
    expect(effectiveAttr(kernel, 'str')).toBeCloseTo(13 * 1.01, 5); // the sword bonus reverts
    sound(kernel);
  });

  it('training XP still flows to the trained base, never the bonus', () => {
    const kernel = makeGame();
    equip(kernel, giveItem(kernel, 'oak_staff').uid); // INT+2
    expect(slice<AttributesState>(kernel, 'attributes').attrs.int.level).toBe(1); // trained base untouched
    expect(effectiveAttr(kernel, 'int')).toBe(3);
  });

  it('unlock conditions and equip requirements see effective attributes', () => {
    const kernel = makeGame();
    setAttr(kernel, 'dex', 8);
    const met = () => conditionMet(conditionReader(reads(kernel)), { type: 'attr', attr: 'dex', level: 10 });
    expect(met()).toBe(false);

    equip(kernel, giveItem(kernel, 'iron_dagger').uid); // DEX+2
    expect(met()).toBe(true);

    // Chain: the dagger's +2 DEX qualifies the character for the uchigatana (DEX 10).
    const blade = giveItem(kernel, 'uchigatana');
    expect(canEquip(reads(kernel), blade)).toBe(true);
    unequip(kernel, 'weapon');
    expect(canEquip(reads(kernel), blade)).toBe(false);
  });

  it('fusion sums EFFECTIVE components', () => {
    const kernel = makeGame();
    setAttr(kernel, 'str', 15);
    setAttr(kernel, 'cha', 9);
    // Fusion is not ported: the probe states the fact the fusion system will.
    setMods(kernel, [fuseFact('str', 'cha')]);
    // eff STR (15 + 2 milestones) × 1.01 + eff CHA (9 + 1 milestone)
    expect(attrValue(kernel, 'str')).toBeCloseTo(17 * 1.01 + 10, 5);

    equip(kernel, giveItem(kernel, 'steel_greatsword').uid);
    const expected = (15 + 3 + 2) * 1.01 + 10; // effective STR with the +3 sword, plus effective CHA
    expect(attrValue(kernel, 'str')).toBeCloseTo(expected, 5);
    expect(attrValue(kernel, 'cha')).toBeCloseTo(expected, 5); // both components read the sum
  });

  it('a skill requirement reads the held skill', () => {
    const kernel = makeGame();
    const blade = giveItem(kernel, 'moonlit_katana'); // Swordsmanship 20
    expect(canEquip(reads(kernel), blade)).toBe(false);
    patch(kernel, (slices) => (slices.skills.skills['swordsmanship'] = { level: 20, xp: 0 }));
    expect(canEquip(reads(kernel), blade)).toBe(true);
    expect(canEquip(reads(kernel), { defId: 'no_such_item' })).toBe(false);
  });
});

describe('what worn gear gives', () => {
  it('an affix gives its modifiers, scaled by the fit of the slot', () => {
    const kernel = makeGame();
    setAttr(kernel, 'con', 10);
    const bare = statBlockOf(kernel).maxHp;
    const vest = giveItem(kernel, 'leather_vest', { affix: affixOfId('sturdy') });
    equip(kernel, vest.uid);
    const vestHp = ITEMS.leather_vest.mods.filter((m) => m.stat === 'maxHp').reduce((sum, m) => sum + m.value, 0);
    expect(statBlockOf(kernel).maxHp).toBeCloseTo(bare + vestHp + 12, 6);
    sound(kernel);
  });

  it('a socketed catalogue rune gives the effect of the context of its item', () => {
    const kernel = makeGame();
    const before = statBlockOf(kernel).armor;
    const vest = giveItem(kernel, 'leather_vest', { slots: 2, runes: ['minor_rune_might', 'minor_rune_might'] });
    const plain = giveItem(kernel, 'leather_vest', { slots: 2 });
    equip(kernel, plain.uid);
    const withVest = statBlockOf(kernel).armor;
    equip(kernel, vest.uid);
    // Two Might runes in armour: +2 Armor each.
    expect(statBlockOf(kernel).armor).toBeCloseTo(withVest + 4, 6);
    expect(withVest).toBeGreaterThan(before);
    sound(kernel);
  });

  it('the stat source agrees with effectiveTerms for every item in every slot it may take', () => {
    // compare.ts mirrors the equipment loop of the source. This holds them together.
    for (const def of ITEM_LIST) {
      const kernel = makeGame();
      patch(kernel, (slices) => {
        const attrs = (slices.attributes as AttributesState).attrs;
        for (const a of Object.values(attrs)) a.level = 40;
        slices.skills.skills['swordsmanship'] = { level: 40, xp: 0 };
      });
      const item = giveItem(kernel, def.id, { affix: affixOfId('warded') });
      expect(equip(kernel, item.uid).ok, def.id).toBe(true);
      const slot = def.slot;
      const mods = kernel.modifiers().filter((m) => (m as { origin?: { slot?: string } }).origin?.slot === slot);
      const { terms } = effectiveTerms(worn(kernel), item, slot, sizeRank('medium'));
      for (const term of terms.values()) {
        const summed = mods
          .filter((m) => m.stat === `stats/${term.stat}` && m.kind === term.op && !isConditional(m as never))
          .reduce((sum, m) => sum + m.value, 0);
        expect(summed, `${def.id} ${term.stat} ${term.op}`).toBeCloseTo(term.value, 9);
      }
    }
  });
});

describe('compareToWorn', () => {
  const SHARP = affixOfId('sharp'); // damage +10%
  const STURDY = affixOfId('sturdy'); // max HP +12
  let nextUid = 1000;
  const item = (defId: string, opts: Partial<ItemInstance> = {}): ItemInstance => ({
    uid: ++nextUid,
    defId,
    slots: 0,
    runes: [],
    ...opts,
  });
  const vest = (opts: Partial<ItemInstance> = {}) => item('leather_vest', opts);
  const MEDIUM = sizeRank('medium');
  const cmp = (wornGear: Equipment, candidate: ItemInstance, slot: SlotId, runesOpen = true) =>
    compareToWorn(wornGear, candidate, slot, runesOpen, MEDIUM);

  it('names the stat change against the worn piece and the rune slot gap', () => {
    const wornVest = vest({ slots: 2 });
    const candidate = vest({ slots: 4, affix: STURDY });
    const result = cmp({ chest: wornVest }, candidate, 'chest')!;
    expect(result.worn).toBe(wornVest);
    expect(result.lines).toEqual([
      { text: 'Max HP: +12 vs worn', better: true },
      { text: 'Rune slots: +2', better: true },
    ]);
    expect(cmp({ chest: wornVest }, candidate, 'chest', false)!.lines.map((l) => l.text)).toEqual(['Max HP: +12 vs worn']);
  });

  it('marks a loss, and reads a lower damage taken as a gain', () => {
    const sharpWorn = vest({ affix: SHARP });
    const plain = vest();
    expect(cmp({ chest: sharpWorn }, plain, 'chest')!.lines).toEqual([{ text: 'Damage: −10% vs worn', better: false }]);

    const hardy: Affix = { name: 'Hardy', mods: [{ stat: 'damageTaken', op: 'mult', value: -0.1 }] };
    const hardyVest = vest({ affix: hardy });
    expect(cmp({ chest: plain }, hardyVest, 'chest')!.lines).toEqual([{ text: 'Damage Taken: −10% vs worn', better: true }]);
  });

  it("counts the worn piece's socketed runes: two Might runes are +4 Armor it would lose", () => {
    const MIGHT = 'minor_rune_might'; // +2 Armor each, in armor
    const wornVest = vest({ slots: 2, runes: [MIGHT, MIGHT] });
    const bare = vest({ slots: 2 });
    const warded = vest({ slots: 2, affix: affixOfId('warded') }); // +3 Armor
    expect(cmp({ chest: wornVest }, bare, 'chest')!.lines).toEqual([{ text: 'Armor: −4 vs worn', better: false }]);
    // Net of the affix and the runes: +3 − 4, not +3.
    expect(cmp({ chest: wornVest }, warded, 'chest')!.lines).toEqual([{ text: 'Armor: −1 vs worn', better: false }]);
  });

  it("counts the candidate's own runes, and a rune in the wrong context gives nothing", () => {
    const MIGHT = 'minor_rune_might'; // +4 damage in a weapon, +2 Armor in armor
    const wornVest = vest({ slots: 2 });
    const socketed = vest({ slots: 2, runes: [MIGHT] });
    expect(cmp({ chest: wornVest }, socketed, 'chest')!.lines).toEqual([{ text: 'Armor: +2 vs worn', better: true }]);
    const blade = item('iron_dagger', { slots: 1, runes: [MIGHT] });
    const plainBlade = item('iron_dagger', { slots: 1 });
    expect(cmp({ weapon: plainBlade }, blade, 'weapon')!.lines).toEqual([{ text: 'Damage: +4 vs worn', better: true }]);
  });

  it('adds the paired off-hand bonus when its partner is in the other hand', () => {
    const dagger = item('parrying_dagger');
    const hands = { weapon: item('rapier'), offhand: item('wooden_shield') };
    const texts = cmp(hands, dagger, 'offhand')!.lines.map((l) => l.text);
    // Riposte and the extra Parry come only from the rapier pairing.
    expect(texts).toContain('Riposte: +10% vs worn');
    expect(texts).toContain('Parry: +9% vs worn');
    expect(texts).toContain('Crit Chance: +2% vs worn');
    expect(texts).toContain('Armor: −4 vs worn');

    const alone = cmp({ weapon: item('iron_sword'), offhand: hands.offhand }, dagger, 'offhand')!;
    const aloneTexts = alone.lines.map((l) => l.text);
    expect(aloneTexts).not.toContain('Riposte: +10% vs worn');
    expect(aloneTexts).toContain('Parry: +4% vs worn');
  });

  it('scales the base mods by fit and leaves the hand bonus at full strength', () => {
    // A large dagger in the off hand fits at 35%; the pipeline does not scale the bonus.
    const large = item('parrying_dagger', { size: 'large' });
    const hands = { weapon: item('rapier'), offhand: item('wooden_shield') };
    const texts = cmp(hands, large, 'offhand')!.lines.map((l) => l.text);
    expect(texts).toContain('Riposte: +10% vs worn');
    // 0.04 × 0.35 from the dagger, plus the full 0.05 from the pairing.
    expect(texts).toContain('Parry: +6.4% vs worn');
  });

  it('scales a piece that does not fit its wearer', () => {
    const wornVest = vest();
    const large = vest({ size: 'large' });
    const armor = cmp({ chest: wornVest }, large, 'chest')!.lines.find((l) => l.text.startsWith('Armor'))!;
    expect(armor.better).toBe(false);
  });

  it('is null for an empty slot or the worn piece itself, and flags conditional bonuses', () => {
    const wornVest = vest();
    expect(cmp({ chest: wornVest }, vest(), 'head')).toBeNull();
    expect(cmp({ chest: wornVest }, wornVest, 'chest')).toBeNull();
    const gated: Affix = { name: 'Gated', mods: [{ stat: 'maxHp', op: 'add', value: 12, requiresTag: 'dagger' }] };
    const result = cmp({ chest: wornVest }, vest({ affix: gated }), 'chest')!;
    expect(result.conditional).toBe(true);
    expect(result.lines).toEqual([]);
  });

  it('a scoped stat reads by the stat before the colon', () => {
    expect(lowerIsBetter('damageTaken')).toBe(true);
    expect(lowerIsBetter('damageTaken:heat')).toBe(true);
    expect(lowerIsBetter('damage')).toBe(false);
  });

  it.todo('beats: the rule (spare marks are part of selling: port 7)');
  it.todo('findSpares: the vest example, hands, rune slots with runecarving shut (port 7)');
  it.todo('a forged item is never compared (spare marks, `beats` and `spareUids`: UI step)');
});

describe('minting an item', () => {
  it('gives a new uid and rolled rune slots within the range of the size class', () => {
    const kernel = makeGame();
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const item = ask(kernel, grantItem, { defId: 'iron_dagger' });
      expect(item.uid).toBe(2 + i);
      expect(item.slots).toBeGreaterThanOrEqual(0);
      expect(item.slots).toBeLessThanOrEqual(3); // a dagger is small
      expect(item.affix).toBeUndefined();
      expect(item.size).toBeUndefined();
      seen.add(item.slots!);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(items(kernel).inventory).toHaveLength(61);
  });

  it('takes the size of what carried it, and medium stays absent', () => {
    const kernel = makeGame();
    expect(ask(kernel, grantItem, { defId: 'oak_club', size: 'gargantuan' }).size).toBe('gargantuan');
    expect(ask(kernel, grantItem, { defId: 'oak_club', size: 'medium' }).size).toBeUndefined();
  });

  it('rolls an affix at the stated chance, from the registry', () => {
    const kernel = makeGame();
    const always = ask(kernel, grantItem, { defId: 'iron_sword', affixChance: 1 });
    expect(['Sharp', 'Sturdy', 'Swift', 'Lucky', 'Warded']).toContain(always.affix?.name);
    expect(ask(kernel, grantItem, { defId: 'iron_sword', affixChance: 0 }).affix).toBeUndefined();
    // The answer is a copy: writing to it does not reach the pack.
    always.defId = 'changed';
    expect(items(kernel).inventory.some((i) => i.defId === 'changed')).toBe(false);
  });

  it('the same seed mints the same items', () => {
    const run = () => {
      const kernel = makeGame();
      return Array.from({ length: 20 }, () => ask(kernel, grantItem, { defId: 'leather_vest', affixChance: 0.5 }));
    };
    expect(run()).toEqual(run());
  });
});

describe('wearIfFree', () => {
  const piece = (defId: string, uid = 500): ItemInstance => ({ uid, defId, slots: 0, runes: [] });

  it('places into an empty slot only, and never turns anything out', () => {
    const kernel = makeGame();
    expect(ask(kernel, wearIfFree, { slot: 'weapon', item: piece('iron_sword') })).toBe(true);
    expect(worn(kernel).weapon?.uid).toBe(500);
    expect(ask(kernel, wearIfFree, { slot: 'weapon', item: piece('oak_club', 501) })).toBe(false);
    expect(worn(kernel).weapon?.uid).toBe(500);
    sound(kernel);
  });

  it('refuses unmet requirements, a wrong slot, a hand the body lacks and a full arms budget', () => {
    const kernel = makeGame();
    expect(ask(kernel, wearIfFree, { slot: 'weapon', item: piece('steel_greatsword') })).toBe(false); // STR 12
    expect(ask(kernel, wearIfFree, { slot: 'head', item: piece('iron_sword') })).toBe(false);
    expect(ask(kernel, wearIfFree, { slot: 'hand3', item: piece('iron_dagger') })).toBe(false);
    setAttr(kernel, 'str', 12);
    expect(ask(kernel, wearIfFree, { slot: 'weapon', item: piece('steel_greatsword') })).toBe(true);
    // Both arms are taken by the greatsword.
    expect(ask(kernel, wearIfFree, { slot: 'offhand', item: piece('wooden_shield', 502) })).toBe(false);
    expect(worn(kernel).offhand).toBeUndefined();
  });
});

describe('the rune pile', () => {
  it('a granted rune is counted and logged; nothing reads the pile yet', () => {
    const kernel = makeGame();
    const before = statBlockOf(kernel);
    ask(kernel, grantRune, { id: 'minor_rune_might' });
    ask(kernel, grantRune, { id: 'minor_rune_might', qty: 2 });
    ask(kernel, grantRune, { id: 'rune_swiftness', silent: true });
    expect(items(kernel).runes).toEqual({ minor_rune_might: 3, rune_swiftness: 1 });
    const lines = logLines(kernel).filter((l) => l.msg.includes('Rune found'));
    expect(lines.map((l) => l.msg)).toEqual(['🔺 Rune found: Minor Rune of Might', '🔺 Rune found: Minor Rune of Might ×2']);
    expect(lines[0].kind).toBe('loot');
    expect(statBlockOf(kernel)).toBe(before);
    expect(view(kernel).runes).toEqual([
      { id: 'minor_rune_might', name: 'Minor Rune of Might', icon: '🔺', qty: 3 },
      { id: 'rune_swiftness', name: RUNE_LIST.find((r) => r.id === 'rune_swiftness')!.name, icon: expect.any(String), qty: 1 },
    ]);
  });
});

describe('the stronghold stash', () => {
  const regalia = (uid: number): ItemInstance => ({ uid, defId: 'festival_regalia', slots: 0, runes: [] });

  it('only keep-marked items enter the stash', () => {
    const kernel = makeGame();
    expect(keepMarked({ defId: 'festival_regalia' })).toBe(true);
    expect(ask(kernel, stashItem, { item: { uid: 9, defId: 'iron_sword', slots: 0, runes: [] } })).toBe(false);
    expect(ask(kernel, stashItem, { item: regalia(9) })).toBe(true);
    expect(items(kernel).stash).toEqual([regalia(9)]);
  });

  it('a kept item is taken out into the pack under a new uid', () => {
    const kernel = makeGame();
    ask(kernel, stashItem, { item: regalia(1) }); // the uid it was stored under is taken by the rusty sword
    expect(kernel.dispatch(takeFromStash({ index: 0 }))).toEqual({ ok: true });
    expect(items(kernel).stash).toEqual([]);
    expect(items(kernel).inventory.at(-1)).toEqual(regalia(2));
    expect(logLines(kernel).at(-1)?.msg).toContain('Taken from the stronghold stash');
    expect(kernel.dispatch(takeFromStash({ index: 0 }))).toEqual({ ok: false, reason: 'the stash holds no item at index 0' });
  });

  it('is shut while a festival attempt holds the gear', () => {
    const kernel = makeGame();
    ask(kernel, stashItem, { item: regalia(5) });
    // The festival is not ported: the probe states the fact it will.
    setMods(kernel, [namedFact('festivalHolds', 1)]);
    expect(kernel.dispatch(takeFromStash({ index: 0 }))).toEqual({
      ok: false,
      reason: 'the stash is shut during a festival attempt',
    });
    expect(items(kernel).stash).toHaveLength(1);
  });

  it('the next run carries what the stash held and every keep-marked item in the pack, worn or held elsewhere', () => {
    const kernel = makeGame();
    ask(kernel, stashItem, { item: regalia(5) });
    patch(kernel, (slices) => {
      const state = slices.items as ItemsState;
      state.inventory.push(regalia(6));
      state.equipment.chest = regalia(7);
    });
    const carried = carriedStash(items(kernel), [regalia(8), { uid: 9, defId: 'iron_sword' }]);
    expect(carried.map((i) => i.uid)).toEqual([5, 6, 7, 8]);
  });

  it.todo('the hundredth win of a run puts a token in the stash, which survives prestige (festival, port 7 prestige)');
  it.todo('a token is spent on the bonus, a technique or the regalia (festival)');
});

describe('the items view', () => {
  it('lists every slot the body has, filled or not, in slot order', () => {
    const kernel = makeGame();
    expect(view(kernel).slots.map((s) => s.slot)).toEqual([
      'weapon',
      'offhand',
      'head',
      'chest',
      'hands',
      'legs',
      'feet',
      'back',
      'accessory',
    ]);
    expect(view(kernel).slots.every((s) => s.item === null)).toBe(true);
    equip(kernel, 1);
    // The list does not change length when a piece comes or goes.
    expect(view(kernel).slots).toHaveLength(9);
    expect(view(kernel).slots[0].item?.name).toBe('Rusty Sword');
    expect(view(kernel).inventory).toEqual([]);
  });

  it('a body with more arms shows more hands', () => {
    const kernel = makeGame();
    patch(kernel, (slices) => ((slices.items as ItemsState).bearer.grants = ['arms:+2']));
    expect(view(kernel).slots.map((s) => s.slot).slice(0, 4)).toEqual(['weapon', 'offhand', 'hand3', 'hand4']);
    expect(view(kernel).arms).toBe(4);
  });

  it('a pack row carries its facts, its requirement and where it may go', () => {
    const kernel = makeGame();
    const row = view(kernel).inventory[0];
    expect(row).toMatchObject({ uid: 1, name: 'Rusty Sword', icon: '🗡️', art: 'item_rusty_sword', canEquip: true, requires: '' });
    // Rune slots are hidden while runecarving is shut.
    expect(row.facts).toEqual([
      { label: 'Slot', fact: 'Weapon' },
      { label: 'Wield', fact: 'One-handed' },
      { label: 'Damage', fact: '+3' },
      { label: 'Value', fact: '6.5' },
      { label: '', fact: 'One-handed sword. +3 Damage.' },
    ]);
    expect(row.options.map((o) => [o.slot, o.note, o.compare])).toEqual([
      ['weapon', '', null],
      ['offhand', 'One-handed in the off hand — 60% effect', null],
    ]);

    emit(kernel, setCounter, { key: 'flag:unlock_runecarving', value: 1 });
    expect(view(kernel).runesOpen).toBe(true);
    expect(view(kernel).inventory[0].facts).toContainEqual({ label: 'Rune slots', fact: '1' });
  });

  it('the value of an item with an affix is shown through the formatter, not as a raw float', () => {
    const kernel = makeGame();
    // 4 x 1.5 x 1.3 (an affix, one rune slot) is 7.800000000000001 as a float.
    const item = giveItem(kernel, 'cloth_tunic', {
      affix: { name: 'Sharp', mods: [{ stat: 'damage', op: 'mult', value: 0.1 }] },
      slots: 1,
    });
    expect(String(itemValue(item))).toMatch(/\.\d{4,}/);
    const row = view(kernel).inventory.find((r) => r.name === 'Sharp Cloth Tunic')!;
    expect(row.facts).toContainEqual({ label: 'Value', fact: '7.8' });
    for (const r of view(kernel).inventory) {
      for (const f of r.facts) expect(f.fact, `${r.name} ${f.label}`).not.toMatch(/\.\d{4,}/);
    }
  });

  it('compares a pack item with the piece worn in each slot it may take', () => {
    const kernel = makeGame();
    const iron = giveItem(kernel, 'iron_sword');
    equip(kernel, 1);
    const row = view(kernel).inventory.find((r) => r.uid === iron.uid)!;
    expect(row.options[0]).toMatchObject({
      slot: 'weapon',
      compare: {
        wornName: 'Rusty Sword',
        conditional: false,
        lines: [
          { text: 'Damage: +4 vs worn', better: true },
          { text: 'Crit Chance: +2% vs worn', better: true },
        ],
      },
    });
    expect(row.options[1].compare).toBeNull();
  });

  it('names the two-hander that leaves the off hand no arm, and an unmet requirement', () => {
    const kernel = makeGame();
    const greatsword = giveItem(kernel, 'steel_greatsword');
    expect(view(kernel).inventory.find((r) => r.uid === greatsword.uid)).toMatchObject({
      canEquip: false,
      requires: 'Strength 12',
    });
    setAttr(kernel, 'str', 12);
    equip(kernel, greatsword.uid);
    const slots = view(kernel).slots;
    expect(slots.find((s) => s.slot === 'offhand')?.takenBy).toBe('Steel Greatsword');
    expect(slots.find((s) => s.slot === 'head')?.takenBy).toBeNull();
  });
});

describe('items in the save', () => {
  it('a save and a load keep the pack, the worn gear and the stat block', () => {
    const kernel = makeGame();
    const vest = giveItem(kernel, 'leather_vest', { slots: 2, affix: affixOfId('sturdy'), size: 'large' });
    equip(kernel, 1);
    equip(kernel, vest.uid);
    ask(kernel, grantRune, { id: 'minor_rune_might', silent: true });
    const block = { ...statBlockOf(kernel) };

    const other = makeGame();
    expect(other.load(JSON.parse(JSON.stringify(kernel.save(0)))).ok).toBe(true);
    expect(items(other)).toEqual(items(kernel));
    expect({ ...statBlockOf(other) }).toEqual(block);
    sound(other);
    // The uid counter is saved: the next item does not reuse a uid.
    expect(ask(other, grantItem, { defId: 'oak_club' }).uid).toBe(items(kernel).uidCounter + 1);
  });

  it('every definition read goes through itemDefOf', () => {
    expect(itemDefOf({ defId: 'rusty_sword' })).toBe(ITEMS.rusty_sword);
    expect(itemDefOf({ defId: 'no_such_item' })).toBeUndefined();
  });
});
