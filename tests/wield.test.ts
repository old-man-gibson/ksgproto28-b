import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import {
  allowedSlots,
  armCost,
  armsFrom,
  armsUsed,
  familySkillFor,
  floatingSlots,
  grantsOf,
  HAND_SLOTS,
  handsFrom,
  handSwingShare,
  handTakenBy,
  heldGrips,
  isTelekinetic,
  ITEMS,
  MAIN_HAND_PENALTY,
  OFF_HAND_PENALTY,
  OVERSIZE_FORGIVENESS_CAP,
  oversizeForgiveness,
  setBearer,
  telekineticFrom,
  twoHandedWeapon,
  wieldScale,
  type Equipment,
  type ItemInstance,
  type ItemsState,
  type SizeTag,
  type SlotId,
} from '../src/systems/items';
import type { SkillsState } from '../src/systems/skills';
import { PARRY_CAP, PARRY_RIPOSTE, statBlockOf } from '../src/systems/stats';
import { ask, equip, giveItem, makeGame, patch, slice, unequip } from './helpers';

/**
 * Port of the old tests/wield.test.ts, of "the slot model" and "weapon and
 * armour size" in tests/incoming.test.ts, and of "grips the mind holds" in
 * tests/mutagens.test.ts.
 *
 * Changed: the call shape. The wield functions take the equipment map where
 * the old ones took the game state. A body with more arms or another size was
 * a main gene in the old tests; mutagens are not ported, so the test states
 * the body with the `items/set-bearer` request, which is what the mutagens
 * port will call.
 *
 * The cases that need a fight are in `tests/combatStatuses.test.ts`. Left
 * behind, as `it.todo`: the cases that need a combat style (the styles port).
 */

/** A character strong enough for every requirement in this file, with an empty pack. */
function fighter(): Kernel {
  const kernel = makeGame();
  patch(kernel, (slices) => {
    const attrs = (slices.attributes as AttributesState).attrs;
    attrs.str.level = 25;
    attrs.dex.level = 25;
    attrs.con.level = 25;
    (slices.items as ItemsState).inventory = [];
  });
  return kernel;
}

const items = (kernel: Kernel) => slice<ItemsState>(kernel, 'items');
const worn = (kernel: Kernel) => items(kernel).equipment;
const inPack = (kernel: Kernel, uid: number) => items(kernel).inventory.some((i) => i.uid === uid);
const stats = (kernel: Kernel) => statBlockOf(kernel);
const sound = (kernel: Kernel) => expect(kernel.staleStats()).toEqual([]);
const body = (kernel: Kernel, grants: string[], size: SizeTag = 'medium') => ask(kernel, setBearer, { grants, size });
const train = (kernel: Kernel, skills: Record<string, number>) =>
  patch(kernel, (slices) => {
    for (const [id, level] of Object.entries(skills)) (slices.skills as SkillsState).skills[id] = { level, xp: 0 };
  });
/** Place a piece directly, as an old test wrote `state.equipment[slot]`. */
const wear = (kernel: Kernel, slot: SlotId, item: ItemInstance) =>
  patch(kernel, (slices) => ((slices.items as ItemsState).equipment[slot] = item));

describe('wield classes', () => {
  it('each class allows the hands it should', () => {
    expect(allowedSlots(ITEMS.iron_dagger)).toEqual(['weapon', 'offhand']); // light
    expect(allowedSlots(ITEMS.iron_sword)).toEqual(['weapon', 'offhand']); // one-handed, at a cost
    expect(allowedSlots(ITEMS.steel_greatsword)).toEqual(['weapon']); // two-handed
    expect(allowedSlots(ITEMS.wooden_shield)).toEqual(['offhand', 'weapon']);
    expect(allowedSlots(ITEMS.leather_cap)).toEqual(['head']); // not hand gear at all
  });

  it('prices the awkward hands and leaves the right ones alone', () => {
    expect(wieldScale(ITEMS.iron_dagger, 'weapon')).toBe(1);
    expect(wieldScale(ITEMS.iron_dagger, 'offhand')).toBe(1); // light: at home either side
    expect(wieldScale(ITEMS.iron_sword, 'weapon')).toBe(1);
    expect(wieldScale(ITEMS.iron_sword, 'offhand')).toBeCloseTo(1 - OFF_HAND_PENALTY);
    expect(wieldScale(ITEMS.steel_greatsword, 'offhand')).toBe(0);
    expect(wieldScale(ITEMS.wooden_shield, 'offhand')).toBe(1);
    expect(wieldScale(ITEMS.wooden_shield, 'weapon')).toBeCloseTo(1 - MAIN_HAND_PENALTY);
    // A buckler built to be punched forward pays nothing for it.
    expect(wieldScale(ITEMS.warden_buckler, 'weapon')).toBe(1);
  });

  it('an off-hand sword contributes only part of itself', () => {
    const kernel = fighter();
    const sword = giveItem(kernel, 'iron_sword');
    equip(kernel, sword.uid); // main hand
    const full = stats(kernel).damage;
    unequip(kernel, 'weapon');
    const bare = stats(kernel).damage;

    equip(kernel, sword.uid, 'offhand');
    const offhand = stats(kernel).damage;
    expect(offhand).toBeGreaterThan(bare);
    expect(offhand - bare).toBeCloseTo((full - bare) * (1 - OFF_HAND_PENALTY));
    sound(kernel);
  });
});

describe('two-handed weapons', () => {
  it('clear the off hand when drawn, and are dropped for anything held there', () => {
    const kernel = fighter();
    const shield = giveItem(kernel, 'wooden_shield');
    const greatsword = giveItem(kernel, 'steel_greatsword');

    equip(kernel, shield.uid);
    expect(worn(kernel).offhand?.uid).toBe(shield.uid);

    equip(kernel, greatsword.uid);
    expect(worn(kernel).weapon?.uid).toBe(greatsword.uid);
    expect(worn(kernel).offhand).toBeUndefined();
    expect(inPack(kernel, shield.uid)).toBe(true);
    expect(twoHandedWeapon(worn(kernel), new Set())?.uid).toBe(greatsword.uid);

    // Taking the shield back up needs the greatsword hand free.
    equip(kernel, shield.uid);
    expect(worn(kernel).offhand?.uid).toBe(shield.uid);
    expect(worn(kernel).weapon).toBeUndefined();
    expect(inPack(kernel, greatsword.uid)).toBe(true);
    sound(kernel);
  });

  it('stop blocking the off hand for a body that can spare an arm', () => {
    const kernel = fighter();
    const greatsword = giveItem(kernel, 'steel_greatsword');
    equip(kernel, greatsword.uid);

    expect(twoHandedWeapon(worn(kernel), new Set())).not.toBeNull();
    // A grip that costs one arm leaves the other free...
    expect(twoHandedWeapon(worn(kernel), new Set(['onehand:*']))).toBeNull();
    // ...and so does having more arms than the weapon takes.
    expect(twoHandedWeapon(worn(kernel), new Set(['arms:+1']))).toBeNull();
  });

  it('a two-hander takes hands and nothing else', () => {
    const kernel = fighter();
    equip(kernel, giveItem(kernel, 'steel_greatsword').uid);
    const bare = new Set<string>();
    expect(handTakenBy(worn(kernel), bare, 'offhand')).not.toBeNull();
    for (const slot of ['head', 'chest', 'hands', 'legs', 'feet', 'back', 'accessory'] as const) {
      expect(handTakenBy(worn(kernel), bare, slot)).toBeNull();
    }
    // `hands` is gloves and reads like a hand slot; it is not one.
    expect(HAND_SLOTS.includes('hands' as SlotId)).toBe(false);
    // The main hand holds the thing, so it is never a hand the thing took.
    expect(handTakenBy(worn(kernel), bare, 'weapon')).toBeNull();
    // And a body with an arm to spare loses no hand at all.
    expect(handTakenBy(worn(kernel), new Set(['arms:+1']), 'offhand')).toBeNull();
  });

  it('leaves the armour slots equippable with a greatsword in hand', () => {
    const kernel = fighter();
    equip(kernel, giveItem(kernel, 'steel_greatsword').uid);
    const helm = giveItem(kernel, 'leather_cap');
    equip(kernel, helm.uid);
    expect(worn(kernel).head?.uid).toBe(helm.uid);
    expect(worn(kernel).weapon).toBeDefined();
  });

  it('lets a grown arm actually hold something', () => {
    const kernel = fighter();
    const greatsword = giveItem(kernel, 'steel_greatsword');
    const shield = giveItem(kernel, 'wooden_shield');
    const club = giveItem(kernel, 'oak_club');
    // The old test wore the asura gene: two more arms.
    body(kernel, ['arms:+2']);

    equip(kernel, greatsword.uid, 'weapon');
    equip(kernel, shield.uid, 'offhand');
    equip(kernel, club.uid, 'hand3');
    // Four arms: the greatsword takes two, the shield and club one each.
    expect(worn(kernel).weapon?.uid).toBe(greatsword.uid);
    expect(worn(kernel).offhand?.uid).toBe(shield.uid);
    expect(worn(kernel).hand3?.uid).toBe(club.uid);
    expect(armsUsed(worn(kernel), grantsOf(items(kernel)))).toBe(4);
    sound(kernel);
  });

  it('offers only the hands a body actually has', () => {
    const club = ITEMS.oak_club;
    expect(allowedSlots(club)).toEqual(['weapon', 'offhand']);
    expect(allowedSlots(club, 4)).toEqual(['weapon', 'offhand', 'hand3', 'hand4']);
    // A two-hander still belongs in one place however many arms there are.
    expect(allowedSlots(ITEMS.steel_greatsword, 6)).toEqual(['weapon']);
  });

  it('refuse the off hand outright', () => {
    const kernel = fighter();
    const greatsword = giveItem(kernel, 'steel_greatsword');
    const result = equip(kernel, greatsword.uid, 'offhand');
    expect(result).toEqual({ ok: false, reason: 'Steel Greatsword cannot go in the slot "offhand"' });
    expect(worn(kernel).offhand).toBeUndefined();
    expect(inPack(kernel, greatsword.uid)).toBe(true);
  });
});

describe('the slot model — a hand kept while both are full', () => {
  const grants = (...ids: string[]) => new Set(ids);

  it('a two-hander costs both arms, everything else costs one', () => {
    expect(armCost(grants(), ITEMS.steel_greatsword)).toBe(2);
    expect(armCost(grants(), ITEMS.old_spear)).toBe(2);
    expect(armCost(grants(), ITEMS.iron_sword)).toBe(1);
    expect(armCost(grants(), ITEMS.wooden_shield)).toBe(1);
  });

  it('the two capabilities are orthogonal — arms grown, and arms needed', () => {
    expect(armsFrom(grants())).toBe(2);
    expect(armsFrom(grants('arms:+1'))).toBe(3);
    expect(armsFrom(grants('arms:+4'))).toBe(6);
    // Growing arms does not lighten the weapon...
    expect(armCost(grants('arms:+4'), ITEMS.steel_greatsword)).toBe(2);
    // ...and lightening it does not grow arms.
    expect(armsFrom(grants('onehand:*'))).toBe(2);
    expect(armCost(grants('onehand:greatsword'), ITEMS.steel_greatsword)).toBe(1);
    expect(armCost(grants('onehand:greatsword'), ITEMS.old_spear)).toBe(2);
  });

  it('six arms is three two-handers, needing no new concept', () => {
    const rana = grants('arms:+4');
    expect(Math.floor(armsFrom(rana) / armCost(rana, ITEMS.steel_greatsword))).toBe(3);
  });

  it('a third arm holds a shield beside a spear, with no rule for that case', () => {
    const kernel = fighter();
    // The old test wore the dvibahu gene: one more arm.
    body(kernel, ['arms:+1']);
    expect(armsFrom(grantsOf(items(kernel)))).toBe(3);

    wear(kernel, 'offhand', { uid: 90, defId: 'wooden_shield', slots: 0, runes: [] });
    const spear = giveItem(kernel, 'old_spear');
    expect(equip(kernel, spear.uid).ok).toBe(true);
    // Spear in one hand, shield still on the other.
    expect(worn(kernel).weapon?.defId).toBe('old_spear');
    expect(worn(kernel).offhand?.defId).toBe('wooden_shield');
  });

  it('and an ordinary body drops the shield to take the spear', () => {
    const kernel = fighter();
    wear(kernel, 'offhand', { uid: 90, defId: 'wooden_shield', slots: 0, runes: [] });
    const spear = giveItem(kernel, 'old_spear');
    expect(equip(kernel, spear.uid).ok).toBe(true);
    expect(worn(kernel).weapon?.defId).toBe('old_spear');
    expect(worn(kernel).offhand).toBeUndefined();
  });

  it.todo('a capability is never scaled — the cheap tier grows the same arm (mutagens)');
});

describe('grips the mind holds', () => {
  const grantSet = (...gs: string[]) => new Set(gs);
  const sword = (uid: number): ItemInstance => ({ uid, defId: 'iron_sword', slots: 0, runes: [] });

  it('counts against arms rather than on top of them', () => {
    const v = grantSet('arms:+4', 'telekinetic:6');
    expect(armsFrom(v)).toBe(6);
    expect(telekineticFrom(v)).toBe(6);
    expect(handsFrom(v)).toBe(0);
  });

  it('floats the LAST grips, so a partial grant leaves the main hand swinging', () => {
    const one = grantSet('telekinetic:1');
    expect(isTelekinetic(one, 'weapon')).toBe(false);
    expect(isTelekinetic(one, 'offhand')).toBe(true);
    // And never past the arms the body has.
    expect(isTelekinetic(one, 'hand3')).toBe(false);
  });

  it('never goes negative, however hard the grant overshoots', () => {
    expect(handsFrom(grantSet('telekinetic:99'))).toBe(0);
    expect(armsFrom(grantSet('telekinetic:99'))).toBe(2);
  });

  it('costs one grip for a two-hander, because a mind has no second hand', () => {
    const v = grantSet('arms:+4', 'telekinetic:6');
    const great = ITEMS.steel_greatsword;
    expect(armCost(v, great, 'weapon')).toBe(1);
    expect(armCost(grantSet(), great, 'weapon')).toBe(2);
  });

  it('splits your damage between the two clocks and never pays it twice', () => {
    const v = grantSet('arms:+4', 'telekinetic:6');
    // Three weapons on a six-grip body: all three float, so the hands swing
    // for nothing.
    const three: Equipment = { weapon: sword(1), offhand: sword(2), hand3: sword(3) };
    expect(heldGrips(three, v)).toBe(3);
    expect(floatingSlots(three, v).length).toBe(3);
    expect(handSwingShare(three, v)).toBe(0);

    // On an ordinary body with one float, the hand keeps its half.
    const one = grantSet('telekinetic:1');
    const two: Equipment = { weapon: sword(1), offhand: sword(2) };
    expect(handSwingShare(two, one)).toBe(0.5);
    expect(floatingSlots(two, one)).toEqual(['offhand']);
  });

  it('leaves bare fists alone — telekinesis is not the reason not to punch', () => {
    expect(handSwingShare({}, grantSet())).toBe(1);
    // A body with no hands does not punch, holding nothing or not.
    expect(handSwingShare({}, grantSet('arms:+4', 'telekinetic:6'))).toBe(0);
  });
});

describe('weapon and armour size — gear made for a different body', () => {
  /** Holding `defId` at `size`, with a body of `bodySize`. */
  function holding(size: SizeTag | undefined, bodySize: SizeTag = 'medium', defId = 'iron_sword'): Kernel {
    const kernel = makeGame();
    wear(kernel, 'weapon', { uid: 50, defId, slots: 0, runes: [], ...(size ? { size } : {}) });
    // The old tests wore the jötunn gene for a gargantuan body.
    if (bodySize !== 'medium') body(kernel, [], bodySize);
    return kernel;
  }
  const levels = (kernel: Kernel) => (id: string) => slice<SkillsState>(kernel, 'skills').skills[id]?.level ?? 0;
  const forgiveness = (kernel: Kernel) => oversizeForgiveness(worn(kernel), familySkillFor, levels(kernel));

  it('an ordinary weapon fits an ordinary person and costs nothing', () => {
    const plain = stats(holding(undefined));
    const stated = stats(holding('medium'));
    expect(stated.attackSpeed).toBeCloseTo(plain.attackSpeed, 6);
    expect(stated.damage).toBeCloseTo(plain.damage, 6);
  });

  it('too big is AWKWARD — it costs speed, not damage', () => {
    const fits = stats(holding('medium'));
    const huge = stats(holding('gargantuan'));
    expect(huge.attackSpeed).toBeLessThan(fits.attackSpeed);
    expect(huge.damage).toBeCloseTo(fits.damage, 6);
  });

  it('too small is WEAK — it costs damage, not speed', () => {
    const giant = stats(holding('gargantuan', 'gargantuan'));
    const dagger = stats(holding('small', 'gargantuan'));
    expect(dagger.damage).toBeLessThan(giant.damage);
    expect(dagger.attackSpeed).toBeGreaterThanOrEqual(giant.attackSpeed);
  });

  it("a jötunn swings a jötunn's hammer as though it were made for them", () => {
    const person = stats(holding('gargantuan')).attackSpeed;
    const giant = stats(holding('gargantuan', 'gargantuan')).attackSpeed;
    expect(giant).toBeGreaterThan(person);
  });

  it('practice forgives part of the penalty, and caps by wield class', () => {
    // 5% of the oversize penalty forgiven every ten levels.
    const trained = (level: number, defId: string) => {
      const kernel = holding('huge', 'medium', defId);
      const skill = ITEMS[defId].tags.map(familySkillFor).find(Boolean)!;
      train(kernel, { [skill]: level });
      return forgiveness(kernel);
    };
    expect(trained(0, 'iron_dagger')).toBe(0);
    expect(trained(20, 'iron_dagger')).toBeCloseTo(0.1, 6);
    // Half for a greatsword, and no more.
    expect(trained(999, 'steel_greatsword')).toBeCloseTo(OVERSIZE_FORGIVENESS_CAP.two_handed, 6);
    expect(trained(999, 'iron_dagger')).toBeGreaterThan(trained(999, 'steel_greatsword'));
  });

  it('finds a family skill by what it CLAIMS, not by guessing its id', () => {
    expect(familySkillFor('sword')).toBe('swordsmanship');
    expect(familySkillFor('greatsword')).toBe('greatsword_combat');
    expect(familySkillFor('dagger')).toBe('dagger_combat');
    // The martial schools tag `style:*`, so they never shadow a family.
    expect(familySkillFor('metal')).toBeUndefined();
    expect(familySkillFor('twoHanded')).toBeUndefined();
  });

  it('so swordsmanship forgives a sword, which name-guessing missed entirely', () => {
    const kernel = holding('huge', 'medium', 'iron_sword');
    expect(forgiveness(kernel)).toBe(0);
    train(kernel, { swordsmanship: 30 });
    expect(forgiveness(kernel)).toBeCloseTo(0.15, 6);
  });

  it('so the swing genuinely speeds up as the skill climbs', () => {
    const at = (level: number) => {
      const kernel = holding('huge', 'medium', 'iron_dagger');
      train(kernel, { dagger_combat: level });
      sound(kernel);
      return stats(kernel).attackSpeed;
    };
    expect(at(40)).toBeGreaterThan(at(0));
  });

  it('armour that does not fit is barely armour, in either direction', () => {
    const armorWith = (size?: SizeTag) => {
      const kernel = makeGame();
      wear(kernel, 'chest', { uid: 51, defId: 'iron_breastplate', slots: 0, runes: [], ...(size ? { size } : {}) });
      return stats(kernel).armor;
    };
    const bare = stats(makeGame()).armor;
    const fits = armorWith('medium');
    expect(fits).toBeGreaterThan(bare);
    // A giant's breastplate, and a child's, are both nearly useless.
    expect(armorWith('large') - bare).toBeLessThan((fits - bare) * 0.5);
    expect(armorWith('small') - bare).toBeLessThan((fits - bare) * 0.5);
    expect(armorWith('gargantuan')).toBeCloseTo(bare, 6);
  });
});

describe('hand bonuses', () => {
  it('the parrying dagger only wakes up beside a rapier', () => {
    const kernel = fighter();
    const dagger = giveItem(kernel, 'parrying_dagger');
    const rapier = giveItem(kernel, 'rapier');
    const plain = giveItem(kernel, 'iron_sword');

    equip(kernel, dagger.uid);
    const alone = stats(kernel).parry; // its own +4%
    expect(alone).toBeCloseTo(0.04);

    equip(kernel, plain.uid); // a sword, but not a rapier
    expect(stats(kernel).parry).toBeCloseTo(0.04);

    equip(kernel, rapier.uid); // the rapier's own guard (+3%) and the +5% pairing
    expect(stats(kernel).parry).toBeCloseTo(0.12);
    expect(stats(kernel).crit).toBeGreaterThan(0.04 + 0.02); // rapier + pairing
    // The pairing: the dagger catches, the rapier answers harder.
    expect(stats(kernel).riposte).toBeCloseTo(PARRY_RIPOSTE + 0.1);
    sound(kernel);
  });

  it('a hand bonus belongs to its hand only', () => {
    const kernel = fighter();
    const buckler = giveItem(kernel, 'warden_buckler');

    equip(kernel, buckler.uid, 'offhand');
    const held = stats(kernel);
    expect(held.parry).toBeCloseTo(0.03); // off-hand bonus

    unequip(kernel, 'offhand');
    equip(kernel, buckler.uid, 'weapon');
    const punched = stats(kernel);
    expect(punched.parry).toBeCloseTo(0.04); // main-hand bonus instead
    expect(punched.damage).toBeGreaterThan(held.damage); // +3 damage, and no misfit penalty
    sound(kernel);
  });
});

describe('parrying in a fight', () => {
  // Ported in tests/combatStatuses.test.ts (spine port 4): turns blows aside and answers them, without spending the action bar
});

describe('the parry line', () => {
  it('Deflection trains from any parrying tool, and raises both axes', () => {
    const kernel = fighter();
    equip(kernel, giveItem(kernel, 'parrying_dagger').uid, 'offhand');
    const untrained = stats(kernel);

    train(kernel, { deflection: 40 });
    const trained = stats(kernel);
    expect(trained.parry).toBeCloseTo(untrained.parry + 0.08); // 40 × 0.002
    expect(trained.riposte).toBeCloseTo(untrained.riposte + 0.24); // 40 × 0.006

    // Mastery that cannot be used pays nothing: drop the tool, lose the bonus.
    unequip(kernel, 'offhand');
    expect(stats(kernel).parry).toBeCloseTo(0);
    expect(stats(kernel).riposte).toBeCloseTo(PARRY_RIPOSTE);
    sound(kernel);
  });

  it('a buckler is both a shield and a parrying tool', () => {
    const kernel = fighter();
    train(kernel, { deflection: 20, shield_combat: 20 });
    equip(kernel, giveItem(kernel, 'warden_buckler').uid, 'offhand');
    const block = stats(kernel);
    expect(block.parry).toBeCloseTo(0.03 + 0.04); // off-hand bonus + Deflection 20
    expect(block.armor).toBeGreaterThan(0); // Shield Combat still applies

    // A plank shield is not a parrying tool, so Deflection pays nothing for it.
    unequip(kernel, 'offhand');
    equip(kernel, giveItem(kernel, 'wooden_shield').uid, 'offhand');
    expect(stats(kernel).parry).toBeCloseTo(0);
  });

  it.todo('Destreza and Bolognese supplant the two defensive stances (styles)');
  it.todo('a fencing stance buys parry with breath, and never past the cap (styles)');
  // Ported in tests/combatStatuses.test.ts (spine port 4): Deflection manifests from fighting with a parrying tool — any stance
  it.todo('Bolognese manifests by bracing behind a sword and buckler (styles: a school takes the stance slot)');

  it('the riposte answers for whatever the stat says, not a constant', () => {
    const kernel = fighter();
    equip(kernel, giveItem(kernel, 'rapier').uid);
    equip(kernel, giveItem(kernel, 'parrying_dagger').uid, 'offhand');
    train(kernel, { deflection: 50 });
    const block = stats(kernel);
    // Base 30% + 10% pairing + 30% from Deflection 50.
    expect(block.riposte).toBeCloseTo(PARRY_RIPOSTE + 0.1 + 0.3);
    expect(block.parry).toBeLessThanOrEqual(PARRY_CAP);
  });
});
