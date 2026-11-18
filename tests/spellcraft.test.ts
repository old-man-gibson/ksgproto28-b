/**
 * Port of the old `tests/spellcraft.test.ts` (2,347 lines, 124 cases). Spine
 * port 5. Changed: the call shape only. Each old `describe` and `it` name is
 * kept.
 *
 * Call shape:
 * - `composeArcane`, `parseSentence` are the same functions, from
 *   `src/systems/arcane`.
 * - `applyStatus(state, bearer, app, source)` is the `statuses/apply` request;
 *   `findStatus(bearer, id)` reads the list an entity holds in the `statuses`
 *   slice; `tickStatuses`, `stripStatuses`, `amplifyStatuses` and
 *   `consumeMagnetCharge` are requests.
 * - A fight is staged (`stage`) where the old case wrote `state.combat`. A
 *   monster is read from the `combat` slice by slot, its stats with
 *   `enemyStats`, its conditions by its entity id.
 * - `healEnemy(state, index, amount, source, hostile)` is the request
 *   `combat/heal-enemy`.
 * - `castCraftedAttack(state, bus, id, spec)` is called with a context from
 *   `run`. Events it emits are delivered when the handler returns.
 * - The book is written by the test helper `inscribe` where the old case
 *   wrote it directly. `inscribeArcane(state, bus, words)` is the command
 *   `arcane/inscribe` (`scribe` below: true when it ran);
 *   `setPrepared`, `forgetSpell` are `spellcraft/*` commands;
 *   `checkSentence(state, words)` and `resolveSpellFor(state, spell)` take
 *   the reads of a kernel (`reads`); `grantCastWordXp(state, bus, uid)` is
 *   the event `spellcraft/practised`; `grantWordXp` is the amount
 *   `wordXpFor` paid through `skills/grant-xp-direct`.
 * - `mage(g)` writes the skills, attributes and word latches of the old
 *   helper through `patch`.
 * - `g.moveSkill(id, -1)` is `combat/set-rotation` with the order moved by one.
 * - `statsFromAttrs` is `monsterStatsFromAttrs` of `src/systems/stats`.
 * - `DEITY_TAG_CATEGORIES` is a list of ids here. `PANTHEONS` is empty in the
 *   old data and is not a registry here: a deity that claims a pantheon fails
 *   the content case, as it did.
 *
 * A monster changed: the old cases "a monster spends its turn on a working,
 * and it lands" and "a working is not a blow: a bulwark does not stop one"
 * used the psionic slime. The psionic school is not registered, so they use
 * the goblin firetongue: ranged, and a rotation of workings only.
 *
 * Left as `it.todo`, under the old `describe` name:
 * - step 3, divine: favour, `learnMiracle`, the veto at preparation, the
 *   pantheon shelf (`queryDeities`, `deityGroups`, `pantheonOf`).
 * - step 3, psionic: the whole `describe('psionic shaping')` and the psionic
 *   content cases.
 * - Old save migrations: the save here starts at version 1.
 *
 * A case that mixed a ported part with a part not ported is split: the
 * ported part keeps the old name, the rest is an `it.todo` with the old name
 * and what it waits for. Split cases: "a capped
 * condition says it is one dose from turning" (the tooltip line), "all three
 * schools reach the player through one path" and "every rotation entry
 * resolves" (the psionic entries).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import {
  ARCANE_WORDS,
  INTENSITY_FLOOR,
  WORD_MILESTONE_LEVELS,
  WORD_POWER_PER_LEVEL,
  checkSentence,
  composeArcane,
  inscribe as inscribeArcane,
  maxSentenceWords,
  parseSentence,
  wordSkillId,
  wordTag,
  wordXpFor,
} from '../src/systems/arcane';
import type { AttributesState } from '../src/systems/attributes';
import { totalTicksOf, type ClockState } from '../src/systems/clock';
import { activeRotation, healEnemy, hunt, setRotation, type Enemy } from '../src/systems/combat';
import { DEITIES, DEITY_TAGS, DEITY_TAG_CATEGORIES, MIRACLE_LIST, deityRelation, miracleSpec } from '../src/systems/divine';
import { TECHNIQUES } from '../src/systems/martial';
import { MONSTERS } from '../src/systems/monsters';
import type { ResourcesState } from '../src/systems/resources';
import { SKILLS, grantSkillXpDirect, skillXpNeeded, type SkillsState } from '../src/systems/skills';
import {
  BASE_PREPARED,
  castCraftedAttack,
  castUtility,
  isUtilityWorking,
  forgetSpell,
  preparedCap,
  preparedSpells,
  resolveSpell,
  resolveSpellFor,
  setPrepared,
  specForSource,
  spellKey,
  spellPractised,
  type SpellcraftState,
} from '../src/systems/spellcraft';
import { monsterStatsFromAttrs } from '../src/systems/stats';
import {
  STATUSES,
  amplifyStatuses,
  applyStatus,
  consumeMagnetCharge,
  escalationPrimed,
  findStatus,
  heldOf,
  magnetBypassesDodge,
  magnetCritChance,
  statusBlocksRangedType,
  statusIncomingMissChance,
  statusPacifiesFlankers,
  stripStatuses,
  tickStatuses,
  type StatusApplication,
  type StatusInstance,
  type StatusTickInput,
  type StatusesState,
} from '../src/systems/statuses';
import {
  SITES,
  combatOf,
  enemyStats,
  feedOf,
  inscribe,
  keepHunting,
  learn,
  patchFight,
  playerStats,
  setHp,
  setPool,
  stage,
} from './combatHelpers';
import { ask, emit, makeGame, patch, reads, run, setMods, slice } from './helpers';

const fresh = (seed = 1): Kernel => makeGame({ seed });

/** A mage competent enough that gating never gets in a test's way: Arcana, INT and WIS 20, the whole lexicon. */
function mage(g: Kernel, level = 12): void {
  patch(g, (slices) => {
    slices.skills.skills.arcana = { level, xp: 0 };
    slices.attributes.attrs.int.level = 20;
    slices.attributes.attrs.wis.level = 20;
    // The whole lexicon, not the starter eleven.
    for (const id of Object.keys(ARCANE_WORDS)) slices.counters.counts[`flag:word:${id}`] = 1;
  });
}

/** The old `inscribeArcane`: true when the table took the sentence. */
const scribe = (g: Kernel, words: string[]): boolean => g.dispatch(inscribeArcane({ words })).ok;
const book = (g: Kernel) => slice<SpellcraftState>(g, 'spellcraft').grimoire;
const lastSpell = (g: Kernel) => book(g)[book(g).length - 1];
const skillsOf = (g: Kernel) => slice<SkillsState>(g, 'skills').skills;
const setSkill = (g: Kernel, id: string, level: number) =>
  patch(g, (slices) => {
    slices.skills.skills[id] = { level, xp: 0 };
  });
const prepare = (g: Kernel, uid: number, on = true): boolean => g.dispatch(setPrepared({ uid, prepared: on })).ok;

const held = (g: Kernel, who: string = PLAYER) => heldOf(slice<StatusesState>(g, 'statuses'), who) as StatusInstance[];
const find = (g: Kernel, id: string, who: string = PLAYER) => findStatus(held(g, who), id);
/** The old `applyStatus(state, bearer, app, 'test')`: no stat block given, so the player does not resist. */
const apply = (g: Kernel, who: string, app: StatusApplication, source = 'test') =>
  ask(g, applyStatus, { entity: who, app, source });
const tickOf = (g: Kernel, who: string, input: StatusTickInput) => ask(g, tickStatuses, { entity: who, ...input });

const texts = (g: Kernel): string[] => feedOf(g).map((entry) => entry.text);
const mana = (g: Kernel): number => slice<ResourcesState>(g, 'resources').values.mana;
/** The enemy in a slot of the open fight, as it is now. */
const foeAt = (g: Kernel, slot = 0): Enemy => combatOf(g).fight!.enemies[slot]!;
const setFoeHp = (g: Kernel, slot: number, hp: number) =>
  patchFight(g, (state) => {
    state.fight!.enemies[slot]!.hp = hp;
  });

// ---------- The grammar ----------

describe('arcane syntax', () => {
  it('composes deterministically — same sentence, same spell, every time', () => {
    const a = composeArcane(['fire', 'pierce', 'quickly']);
    const b = composeArcane(['fire', 'pierce', 'quickly']);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it('word order matters: noun-led hits harder, verb-led sharpens the verb', () => {
    const nounLed = composeArcane(['fire', 'pierce'])!;
    const verbLed = composeArcane(['pierce', 'fire'])!;
    // Same words, different spells — deterministically.
    expect(nounLed.strikes[0].power).toBeGreaterThan(verbLed.strikes[0].power);
    expect(verbLed.strikes[0].penetration!).toBeGreaterThan(nounLed.strikes[0].penetration!);
    // Both still speak fire.
    expect(nounLed.strikes[0].type).toBe('heat');
    expect(verbLed.strikes[0].type).toBe('heat');
  });

  it('a second noun opens a second clause, at a diminished share', () => {
    const two = composeArcane(['fire', 'pierce', 'ice', 'fly'])!;
    expect(two.strikes).toHaveLength(2);
    expect(two.strikes[0].type).toBe('heat');
    expect(two.strikes[1].type).toBe('cold');
    // The second clause lands at 1/1.5 of its solo weight.
    const solo = composeArcane(['ice', 'fly'])!;
    expect(two.strikes[1].power).toBeCloseTo(solo.strikes[0].power / 1.5, 5);
  });

  it('a bare noun is substance without shape — weaker than a shaped one', () => {
    const bare = composeArcane(['fire'])!;
    const shaped = composeArcane(['fire', 'pierce'])!;
    expect(bare.strikes[0].power).toBeLessThan(shaped.strikes[0].power);
  });

  it('adverbs weigh the clause: slowly trades cooldown for power, twice lands twice', () => {
    const plain = composeArcane(['fire', 'pierce'])!;
    const slow = composeArcane(['fire', 'pierce', 'slowly'])!;
    expect(slow.strikes[0].power).toBeGreaterThan(plain.strikes[0].power);
    expect(slow.cooldown).toBeGreaterThan(plain.cooldown);
    // Trailing, a landing-adverb is DEPTH: one blow at twice the weight.
    const doubled = composeArcane(['fire', 'pierce', 'twice'])!;
    expect(doubled.strikes[0].hits).toBeUndefined();
    expect(doubled.strikes[0].power).toBeCloseTo(plain.strikes[0].power * 2, 5);
    expect(doubled.manaCost).toBeGreaterThan(plain.manaCost);
  });

  it('targeting words address the whole spell, and the last one spoken wins', () => {
    expect(composeArcane(['fire', 'pierce'])!.target).toBe('one');
    expect(composeArcane(['fire', 'pierce', 'others'])!.target).toBe('others');
    expect(composeArcane(['others', 'fire', 'pierce', 'me'])!.target).toBe('self');
    // A broadside thins the pool.
    expect(composeArcane(['fire', 'pierce', 'others'])!.manaCost).toBeGreaterThan(
      composeArcane(['fire', 'pierce'])!.manaCost,
    );
  });

  it('ward and mend always land on the speaker', () => {
    const ward = composeArcane(['ice', 'ward'])!;
    expect(ward.strikes).toHaveLength(0);
    expect(ward.buff?.mods.some((m) => m.stat === 'resCold')).toBe(true);
    const mend = composeArcane(['water', 'mend'])!;
    expect(mend.strikes).toHaveLength(0);
    expect(mend.heal).toBeGreaterThan(0);
  });

  it('repetition deepens a word: stronger than the sum, costlier still', () => {
    const one = composeArcane(['fire', 'pierce'])!;
    const flame = composeArcane(['fire', 'fire', 'pierce'])!;
    const blaze = composeArcane(['fire', 'fire', 'fire', 'pierce'])!;
    // One clause throughout — repetition is not a second clause.
    expect(flame.strikes).toHaveLength(1);
    expect(blaze.strikes).toHaveLength(1);
    // Effect superlinear: flame > 2× fire, blaze > 3× fire.
    expect(flame.strikes[0].power).toBeGreaterThan(one.strikes[0].power * 2);
    expect(blaze.strikes[0].power).toBeGreaterThan(one.strikes[0].power * 3);
    // Cost grows FASTER than effect.
    expect(flame.manaCost / one.manaCost).toBeGreaterThan(flame.strikes[0].power / one.strikes[0].power);
    // The deepened word wears its deepened name.
    expect(flame.name).toBe('Flame Pierce');
    expect(blaze.name).toBe('Blaze Pierce');
    expect(composeArcane(['stone', 'stone'])!.name).toBe('Boulder');
    expect(composeArcane(['zero', 'zero', 'zero'])!.name).toBe('Null');
  });

  it('only ADJACENT repetition merges; a word said apart is two clauses', () => {
    const apart = composeArcane(['fire', 'pierce', 'fire'])!;
    expect(apart.strikes).toHaveLength(2);
    expect(apart.name).toBe('Fire Pierce Fire');
  });

  it('adverbs and verbs deepen too: thrice lands thrice, everything hits everyone', () => {
    // Leading, a landing-adverb is VOLUME: three separate landings.
    const thrice = composeArcane(['twice', 'twice', 'fire', 'pierce'])!;
    expect(thrice.strikes[0].hits).toBe(3);
    expect(thrice.name).toBe('Thrice Fire Pierce');
    const dragging = composeArcane(['fire', 'pierce', 'slowly', 'slowly'])!;
    const slow = composeArcane(['fire', 'pierce', 'slowly'])!;
    expect(dragging.strikes[0].power).toBeGreaterThan(slow.strikes[0].power);
    expect(dragging.cooldown).toBeGreaterThan(slow.cooldown);
    // Expand thrice: the working stops spilling and addresses everyone.
    const everything = composeArcane(['fire', 'expand', 'expand', 'expand'])!;
    expect(everything.target).toBe('others');
    expect(everything.splash).toBeUndefined();
    expect(everything.name).toBe('Fire Everything');
  });

  it('no mouth can hold a fourth, and addresses never deepen', () => {
    expect(composeArcane(['fire', 'fire', 'fire', 'fire'])).toBeNull();
    expect(parseSentence(['fire', 'fire', 'fire', 'fire']).reason).toMatch(/fourth/);
    // Repeated targets are just the address, said twice; last still wins.
    const spoken = composeArcane(['fire', 'me', 'me'])!;
    expect(spoken.target).toBe('self');
    expect(spoken.name).toBe('Fire Me Me');
  });

  it('deep words are earned: spoken enough, flame becomes a word of its own', () => {
    const g = fresh();
    mage(g);
    // Unearned, the deep form refuses to be spoken directly.
    expect(checkSentence(reads(g), ['fire:2', 'pierce']).reason).toMatch(/earned/);
    // Mastery counts DISTINCT sentences: inscribing and forgetting the same
    // one forever teaches nothing.
    for (let i = 0; i < 10; i++) {
      if (scribe(g, ['fire', 'fly'])) g.dispatch(forgetSpell({ uid: lastSpell(g).uid }));
    }
    expect(checkSentence(reads(g), ['fire:2', 'pierce']).reason).toMatch(/earned/);
    // Five genuinely different workings, though, earn the flame.
    for (const words of [['fire'], ['pierce', 'fire'], ['fire', 'quickly'], ['fly', 'fire']]) {
      scribe(g, words);
    }
    expect(checkSentence(reads(g), ['fire:2', 'pierce']).ok).toBe(true);
    // One slot, but exactly the spell that saying it twice makes.
    expect(composeArcane(['fire:2', 'pierce'])).toEqual(composeArcane(['fire', 'fire', 'pierce']));
    // The grimoire knows they are one spell.
    expect(scribe(g, ['fire', 'fire', 'pierce'])).toBe(true);
    expect(scribe(g, ['fire:2', 'pierce'])).toBe(false);
    // A mastered flame deepens with a plain fire — and two flames are a fourth.
    expect(composeArcane(['fire:2', 'fire'])!.name).toBe('Blaze');
    expect(composeArcane(['fire:2', 'fire:2'])).toBeNull();
  });

  it('"then" chains clauses: inherited opening, earned follow-through, no breadth tax', () => {
    const linked = composeArcane(['fire', 'pierce', 'then', 'ice', 'fly'])!;
    const apart = composeArcane(['fire', 'pierce', 'ice', 'fly'])!;
    expect(linked.strikes).toHaveLength(2);
    // The follow-up rides the opening the first strike made...
    expect(linked.strikes[1].penetration).toBe(linked.strikes[0].penetration);
    expect(apart.strikes[1].penetration).toBeUndefined();
    // ...hits harder when it landed (resolved per cast in combat)...
    expect(linked.strikes[1].followUp).toBe(1.3);
    expect(apart.strikes[1].followUp).toBeUndefined();
    // ...and is depth, not breadth: no second-clause dilution.
    expect(linked.strikes[1].power).toBeCloseTo(apart.strikes[1].power * 1.5, 5);
    // The word itself costs a slot and its mana.
    expect(linked.manaCost).toBe(apart.manaCost + 1);
    expect(linked.name).toBe('Fire Pierce Then Ice Fly');
  });

  it('a conjunction must sit between clauses, and never deepens', () => {
    expect(parseSentence(['then', 'fire']).reason).toMatch(/follows nothing/);
    expect(parseSentence(['fire', 'pierce', 'then']).reason).toMatch(/leads nowhere/);
    expect(parseSentence(['fire', 'then', 'then', 'ice']).reason).toMatch(/follows nothing/);
    // A target after "then" does not satisfy it — clauses do.
    expect(parseSentence(['fire', 'then', 'me']).reason).toMatch(/leads nowhere/);
    // A mending after "then" is legal grammar; it simply breaks the strike
    // chain (nothing for a later "then" to ride).
    const mendAfter = composeArcane(['fire', 'pierce', 'then', 'water', 'mend'])!;
    expect(mendAfter.strikes).toHaveLength(1);
    expect(mendAfter.heal).toBeGreaterThan(0);
  });

  it('"and" fuses two clauses into one twin-natured blow', () => {
    const fused = composeArcane(['fire', 'pierce', 'and', 'ice', 'fly'])!;
    expect(fused.strikes).toHaveLength(1);
    const blow = fused.strikes[0];
    expect(blow.type).toBe('heat');
    expect(blow.orType).toBe('cold');
    // Both riders travel; the joined clause adds its weight at 0.85.
    expect(blow.inflicts?.map((a) => a.id).sort()).toEqual(['chilled', 'on_fire']);
    const apartHead = composeArcane(['fire', 'pierce'])!.strikes[0].power;
    const apartJoin = composeArcane(['ice', 'fly'])!.strikes[0].power;
    expect(blow.power).toBeCloseTo(apartHead + apartJoin * 0.85, 5);
    expect(fused.name).toBe('Fire Pierce And Ice Fly');
  });

  it('nothing cannot launder a substance: "zero and fire" is fire', () => {
    // The exploit this closes: an untyped head fusing a typed clause would
    // have made the WHOLE blow untyped, buying a resistance-proof blaze for
    // the price of one extra word — a bypass that scaled with the target's
    // own defences and made elemental resistance meaningless.
    const laundered = composeArcane(['zero', 'and', 'fire:3', 'crush'])!;
    expect(laundered.strikes).toHaveLength(1);
    expect(laundered.strikes[0].untyped).toBeUndefined();
    expect(laundered.strikes[0].type).toBe('heat');
    // Zero alone is still nothing, and nothing still ignores everything.
    expect(composeArcane(['zero', 'crush'])!.strikes[0].untyped).toBe(true);
    // The other way round is harmless: a substance is not purified by
    // having nothing folded into it.
    const mixed = composeArcane(['fire', 'crush', 'and', 'zero', 'crush'])!;
    expect(mixed.strikes[0].untyped).toBeUndefined();
    expect(mixed.strikes[0].type).toBe('heat');
  });

  it('"but" transmutes: the first clause’s weight, the second’s bite', () => {
    // The user's canonical sentence: massive fire damage that poisons
    // instead of burning.
    const spoken = composeArcane(['slowly', 'slowly', 'fire', 'fire', 'fire', 'but', 'venom'])!;
    expect(spoken.name).toBe('Dragging Blaze But Venom');
    expect(spoken.strikes).toHaveLength(1);
    expect(spoken.strikes[0].type).toBe('heat');
    expect(spoken.strikes[0].inflicts?.map((a) => a.id)).toEqual(['poison']);
    // The venom clause struck nothing of its own; the blaze kept its weight.
    const plain = composeArcane(['slowly', 'slowly', 'fire', 'fire', 'fire'])!;
    expect(spoken.strikes[0].power).toBeCloseTo(plain.strikes[0].power, 5);
    // A riderless word strips the blow clean (stone carries shards now; zero
    // is the word for nothing).
    expect(composeArcane(['fire', 'pierce', 'but', 'zero'])!.strikes[0].inflicts).toBeUndefined();
  });

  it('adverbs on a "but"-clause deepen the transmutation, not a discarded strike', () => {
    // The user's find: "blaze but glacier fourfold" changed nothing but mana.
    // A transmuting clause's whole expression is its riders, so its adverbs
    // multiply THEM — fourfold chills four times as deep.
    const plain = composeArcane(['fire', 'pierce', 'but', 'venom'])!;
    const doubled = composeArcane(['fire', 'pierce', 'but', 'venom', 'twice'])!;
    const heavy = composeArcane(['fire', 'pierce', 'but', 'venom', 'slowly'])!;
    const base = plain.strikes[0].inflicts![0].intensity!;
    expect(doubled.strikes[0].inflicts![0].intensity).toBeCloseTo(base * 2, 5);
    // Trailing slowly spaces the venom: ×1.4 weight × ⅓ thinning, over a
    // tripled clock — a long, seeping poison.
    expect(heavy.strikes[0].inflicts![0].intensity).toBeCloseTo((base * 1.4) / 3, 5);
    expect(heavy.strikes[0].inflicts![0].duration).toBe(STATUSES.poison.duration! * 3);
    // The blow itself is untouched — the fire kept its own weight.
    expect(doubled.strikes[0].power).toBeCloseTo(plain.strikes[0].power, 5);
  });

  it('adverb POSITION in a "but"-clause: trailing deepens, leading multiplies', () => {
    // "venom twice" — about the substance: one application, twice as deep.
    const deep = composeArcane(['fire', 'pierce', 'but', 'venom', 'twice'])!;
    expect(deep.strikes[0].inflicts).toHaveLength(1);
    expect(deep.strikes[0].inflicts![0].intensity).toBeCloseTo(2, 5);
    // "twice venom" — about the applying: two applications at base depth,
    // which meet the condition's own stacking rules (and can cap a sum).
    const many = composeArcane(['fire', 'pierce', 'but', 'twice', 'venom'])!;
    expect(many.strikes[0].inflicts).toHaveLength(2);
    for (const app of many.strikes[0].inflicts!) expect(app.intensity).toBeCloseTo(1, 5);
    // Striking clauses read the same axis now: leading = a volley of
    // landings, trailing = one spike carrying the weight — blow AND riders.
    const volley = composeArcane(['twice', 'fire', 'pierce'])!.strikes[0];
    const spike = composeArcane(['fire', 'pierce', 'twice'])!.strikes[0];
    expect(volley.hits).toBe(2);
    expect(spike.hits).toBeUndefined();
    expect(spike.power).toBeCloseTo(volley.power * 2, 5);
    expect(spike.inflicts![0].intensity).toBeCloseTo(volley.inflicts![0].intensity! * 2, 5);
  });

  it('"or" makes alternatives at half price; "if" names a condition', () => {
    const either = composeArcane(['fire', 'pierce', 'or', 'ice', 'fly'])!;
    expect(either.strikes).toHaveLength(2);
    expect(either.strikes[0].altGroup).toBe(either.strikes[1].altGroup);
    // The or-linked clause pays half: (2+1) + (2+1)×0.5 + 1 = 5.5 → 6,
    // versus 7 had it been "and"-fused word-for-word.
    expect(either.manaCost).toBeLessThan(composeArcane(['fire', 'pierce', 'and', 'ice', 'fly'])!.manaCost);

    // "if fire" is satisfied by On Fire — or by the Blazing it escalates into.
    const gated = composeArcane(['gloom', 'burst', 'if', 'fire'])!;
    expect(gated.strikes).toHaveLength(1);
    expect(gated.strikes[0].onlyIf).toEqual(['on_fire', 'blazing']);
    // Conditioned on the word for nothing: it never fires, and says so.
    expect(composeArcane(['gloom', 'burst', 'if', 'zero'])!.strikes[0].onlyIf).toEqual([]);
    // The new physical nouns carry their signatures.
    expect(composeArcane(['stone'])!.strikes[0].inflicts?.[0].id).toBe('shardbound');
    expect(composeArcane(['cut'])!.strikes[0].type).toBe('slashing');
    expect(composeArcane(['iron'])!.strikes[0].type).toBe('piercing');
    expect(composeArcane(['iron'])!.strikes[0].inflicts?.[0].id).toBe('magnetized');
  });

  it('zero is untyped; arcane frays, and enough fraying catches fire', () => {
    // Zero: the raw number lands — no type roulette either way.
    const nothing = composeArcane(['zero', 'pierce'])!;
    expect(nothing.strikes[0].untyped).toBe(true);
    // A typed word stays typed.
    expect(composeArcane(['fire', 'pierce'])!.strikes[0].untyped).toBeUndefined();

    // Arcane: not manaburn on arrival — a precursor that builds to it.
    const fray = composeArcane(['arcane'])!;
    expect(fray.strikes[0].inflicts?.[0].id).toBe('unravelling');

    // Three stacks of unravelling catch: the escalation IS manaburn.
    const g = fresh();
    for (let i = 0; i < 3; i++) {
      apply(g, PLAYER, { id: 'unravelling', intensity: 1 });
    }
    expect(find(g, 'unravelling')).toBeUndefined();
    // The catch is a conflagration, not a candle: 3 threads × the ×8
    // escalation = a 24-point burn (manaburn's intensity is mana left to take).
    expect(find(g, 'manaburn')?.intensity).toBe(24);

    // And "if arcane" reads the whole chain: fraying or already burning.
    expect(composeArcane(['gloom', 'burst', 'if', 'arcane'])!.strikes[0].onlyIf).toEqual([
      'unravelling',
      'manaburn',
    ]);
  });

  it('slowly and quickly move the condition clock, position deciding what is conserved', () => {
    const baseDur = STATUSES.on_fire.duration!;
    const plain = composeArcane(['fire', 'pierce'])!.strikes[0].inflicts![0];
    expect(plain.duration).toBeUndefined(); // the condition's own clock

    // Leading: about time. The window moves, the per-tick bite keeps.
    const longBurn = composeArcane(['slowly', 'fire', 'pierce'])!.strikes[0].inflicts![0];
    expect(longBurn.duration).toBe(baseDur * 2);
    expect(longBurn.intensity).toBeCloseTo(plain.intensity!, 5);
    // Leading quickly is haste incarnate: a quarter of the window at triple
    // rate — the fastest delivery, a share of the total lost to hurry.
    const shortBurn = composeArcane(['quickly', 'fire', 'pierce'])!.strikes[0].inflicts![0];
    expect(shortBurn.duration).toBe(Math.round(baseDur * 0.25));
    expect(shortBurn.intensity).toBeCloseTo(plain.intensity! * 3, 5);

    // Trailing: about the substance, each with its own shape so neither
    // position dominates. Slowly stretches presence at a third the bite;
    // quickly compresses cleanly, nothing lost.
    const spaced = composeArcane(['fire', 'pierce', 'slowly'])!.strikes[0].inflicts![0];
    expect(spaced.duration).toBe(baseDur * 3);
    expect(spaced.intensity).toBeCloseTo(plain.intensity! / 3, 5);
    const dense = composeArcane(['fire', 'pierce', 'quickly'])!.strikes[0].inflicts![0];
    expect(dense.duration).toBe(Math.round(baseDur * 0.5));
    expect(dense.intensity).toBeCloseTo(plain.intensity! * 2, 5);
  });

  it('gently is cheap but never efficient; viciously buys crit with mana', () => {
    const plain = composeArcane(['fire', 'crush'])!;
    const soft = composeArcane(['gently', 'fire', 'crush'])!;
    const cruel = composeArcane(['viciously', 'fire', 'crush'])!;

    // Gently: less weight, less malice, less cost — but weight falls FASTER
    // than price, so it is cheap rather than efficient.
    expect(soft.strikes[0].power).toBeLessThan(plain.strikes[0].power);
    expect(soft.strikes[0].critBonus).toBeLessThan(0);
    expect(soft.manaCost).toBeLessThanOrEqual(plain.manaCost);
    const dmgDrop = soft.strikes[0].power / plain.strikes[0].power;
    const costDrop = soft.manaCost / plain.manaCost;
    expect(dmgDrop).toBeLessThan(costDrop);

    // Viciously: crit for coin, the weight untouched.
    expect(cruel.strikes[0].critBonus).toBeGreaterThan(0);
    expect(cruel.strikes[0].power).toBeCloseTo(plain.strikes[0].power, 5);
    expect(cruel.manaCost).toBeGreaterThan(plain.manaCost);

    // Crit ADDS per tier rather than compounding: murderously is 3 × 0.07.
    expect(composeArcane(['viciously', 'viciously', 'viciously', 'fire', 'crush'])!.strikes[0].critBonus)
      .toBeCloseTo(0.21, 5);
  });

  it('gently is a scaffold: full affliction, almost no force — safe on yourself', () => {
    const plain = composeArcane(['venom', 'cut', 'me'])!.strikes[0];
    const soft = composeArcane(['gently', 'venom', 'cut', 'me'])!.strikes[0];
    const softest = composeArcane(['gently:3', 'venom', 'cut', 'me'])!.strikes[0];

    // The weight collapses...
    expect(soft.power).toBeCloseTo(plain.power * 0.5, 5);
    expect(softest.power).toBeCloseTo(plain.power * 0.125, 5);
    // ...while the poison it carries is exactly as deep, and lands exactly
    // as readily. That is the whole of the scaffold.
    for (const s of [soft, softest]) {
      expect(s.inflicts![0].intensity).toBeCloseTo(plain.inflicts![0].intensity!, 5);
      expect(s.inflicts![0].chance).toBeCloseTo(plain.inflicts![0].chance!, 5);
    }
    // And it is addressed at the speaker, so it lands on them.
    expect(composeArcane(['gently:3', 'venom', 'cut', 'me'])!.target).toBe('self');
  });

  it('the scaffold hands off: self-poison, then Venom Feast spits it back', () => {
    const g = fresh(31);
    const [foe] = stage(g, [{ monsterId: 'forest_rat', level: 2 }], SITES.woods_edge);

    // Scaffold: poison yourself for a pittance.
    apply(g, PLAYER, { id: 'poison', intensity: 4 }, 'gently venom cut me');
    expect(find(g, 'poison')!.intensity).toBe(4);

    // The miracle that changes the rules: it strips YOUR poison, delivers it
    // with interest, and feeds on the poison in the room while doing it.
    const feast = miracleSpec('venom_feast')!;
    run(g, (ctx) => castCraftedAttack(ctx as never, 'venom_feast', feast));
    expect(find(g, 'poison')).toBeUndefined();
    expect(find(g, 'poison', foe.entity)!.intensity).toBeGreaterThanOrEqual(4 * 1.2);
  });

  it('intensely and dimly move the affliction alone, never the blow', () => {
    const plain = composeArcane(['venom', 'cut'])!;
    const deep = composeArcane(['intensely', 'venom', 'cut'])!;
    const faint = composeArcane(['dimly', 'venom', 'cut'])!;

    const bite = (s: typeof plain) => s.strikes[0].inflicts![0].intensity!;
    expect(bite(deep)).toBeCloseTo(bite(plain) * 1.6, 5);
    expect(bite(faint)).toBeCloseTo(bite(plain) * 0.6, 5);
    // The blow itself is untouched by either — that is the whole point.
    expect(deep.strikes[0].power).toBeCloseTo(plain.strikes[0].power, 5);
    expect(faint.strikes[0].power).toBeCloseTo(plain.strikes[0].power, 5);
    // Effort is paid for, restraint is cheap — though every word spoken
    // still costs its own breath, so dimming is not free in absolute terms.
    expect(deep.manaCost).toBeGreaterThan(plain.manaCost);
    expect(faint.manaCost).toBeLessThan(deep.manaCost);
  });

  it('dimming is restraint, never erasure — the affliction survives any depth', () => {
    const base = composeArcane(['venom', 'cut'])!.strikes[0].inflicts![0].intensity!;
    const scarce = composeArcane(['dimly:3', 'venom', 'cut'])!.strikes[0].inflicts![0];
    expect(scarce.intensity).toBeGreaterThan(0);
    // Floored: 0.6³ = 0.216 would apply, but never below the floor share.
    expect(scarce.intensity).toBeGreaterThanOrEqual(base * INTENSITY_FLOOR);
    expect(scarce.chance).toBeCloseTo(composeArcane(['venom', 'cut'])!.strikes[0].inflicts![0].chance!, 5);
  });

  it('spoken last they concentrate or dilute: the clock moves to match', () => {
    const baseDur = STATUSES.poison.duration!;
    // Leading: the pushing changes, the clock does not.
    expect(composeArcane(['intensely', 'venom', 'cut'])!.strikes[0].inflicts![0].duration).toBeUndefined();
    // Trailing: concentrated — hotter for less long.
    const concentrated = composeArcane(['venom', 'cut', 'intensely'])!.strikes[0].inflicts![0];
    expect(concentrated.duration).toBe(Math.round(baseDur * 0.6));
    // Trailing dimly: diluted — fainter, but it lingers.
    const diluted = composeArcane(['venom', 'cut', 'dimly'])!.strikes[0].inflicts![0];
    expect(diluted.duration).toBe(Math.round(baseDur * 1.6));
    expect(diluted.intensity!).toBeLessThan(concentrated.intensity!);
  });

  it('volume pays on conditions that COUNT, depth on ones that keep the worst', () => {
    // The rule that makes leading-fourfold worth its price — and worth
    // knowing. A condition that sums or counts its applications escalates on
    // VOLUME, so four landings can push it over the cap in a single cast.
    const g = fresh(41);
    const four = composeArcane(['twice:3', 'arcane', 'cut'])!.strikes[0];
    expect(four.hits).toBe(4);
    for (let i = 0; i < 3; i++) {
      apply(g, PLAYER, { ...four.inflicts![0], chance: 1 });
    }
    // unravelling sums to a cap of 3 and catches: one cast, one manaburn.
    expect(find(g, 'unravelling')).toBeUndefined();
    expect(find(g, 'manaburn')).toBeDefined();

    // A condition that keeps only the WORST dose ignores volume entirely —
    // there, depth (intensely, or a trailing landing adverb) is the answer.
    const g2 = fresh(43);
    for (let i = 0; i < 4; i++) {
      apply(g2, PLAYER, { id: 'poison', intensity: 1, chance: 1 });
    }
    expect(find(g2, 'poison')!.intensity).toBe(1);
    expect(find(g2, 'rotting')).toBeUndefined();
  });

  it('on a keeps-the-worst condition, DEPTH is the only road to escalation', () => {
    // "venom fourfold cut" folds the affliction into itself: one dose at x4,
    // which reaches poison's cap — and the second cast tips it septic. The
    // plain sentence never can, however many times it is spoken, because a
    // dose no deeper than the last teaches the body nothing.
    const deep = composeArcane(['venom', 'twice:3', 'cut'])!.strikes[0].inflicts![0];
    const g = fresh(7);
    apply(g, PLAYER, { ...deep, chance: 1 });
    expect(find(g, 'poison')!.intensity).toBe(4);
    apply(g, PLAYER, { ...deep, chance: 1 });
    expect(find(g, 'rotting')).toBeDefined();

    const flat = composeArcane(['venom', 'cut'])!.strikes[0].inflicts![0];
    const g2 = fresh(7);
    for (let i = 0; i < 5; i++) apply(g2, PLAYER, { ...flat, chance: 1 });
    expect(find(g2, 'poison')!.intensity).toBe(1);
    expect(find(g2, 'rotting')).toBeUndefined();
    // The one at its ceiling announces itself; the flat one has nothing to say.
    expect(escalationPrimed(held(g2), find(g2, 'poison')!)).toBe(false);
  });

  // The tooltip assertions of the old case (`statusTipLines`) are the todo below.
  it('a capped condition says it is one dose from turning', () => {
    // Below the ceiling: a stable equilibrium, and it says nothing.
    const mild = fresh(11);
    apply(mild, PLAYER, { id: 'poison', intensity: 2, chance: 1 });
    const light = find(mild, 'poison')!;
    expect(escalationPrimed(held(mild), light)).toBe(false);

    // AT the ceiling — which only a first dose can reach without turning, so
    // this is precisely the "venom fourfold cut" state: ticking along at x4,
    // looking exactly as it did, one dose from septic.
    const primed = fresh(11);
    apply(primed, PLAYER, { id: 'poison', intensity: 4, chance: 1 });
    const heldNow = find(primed, 'poison')!;
    expect(heldNow.intensity).toBe(4);
    expect(escalationPrimed(held(primed), heldNow)).toBe(true);

    // And the warning is honest: the very next dose does turn it.
    apply(primed, PLAYER, { id: 'poison', intensity: 1, chance: 1 });
    expect(find(primed, 'rotting')).toBeDefined();

    // A condition with nowhere worse to go never claims otherwise.
    const rotting = find(primed, 'rotting')!;
    expect(escalationPrimed(held(primed), rotting)).toBe(false);
  });
  it.todo(
    'a capped condition says it is one dose from turning (not ported: the tooltip line of statusTipLines, the format library of the interface)',
  );

  it('a ward reads every dial the rest of the grammar does', () => {
    const res = (words: string[]) =>
      composeArcane(words)!.buff!.mods.find((m) => m.stat === 'resCold')!.value;
    const secs = (words: string[]) => composeArcane(words)!.buff!.duration;
    const plain = res(['ice', 'ward']);
    const plainSecs = secs(['ice', 'ward']);

    // The SUBSTANCE's depth counts — a glacier wards harder than ice, which
    // it did not before: the coat was paying triple for nothing.
    expect(res(['ice:3', 'ward'])).toBeCloseTo(plain * 3.9, 5);
    // …and so does the verb's own depth.
    expect(res(['ice', 'ward:3'])).toBeCloseTo(plain * 3.9, 5);
    // Order still leads: warding-first sharpens the mechanic.
    expect(res(['ward', 'ice'])).toBeGreaterThan(plain);

    // Intensity thickens the coat; dimming thins it without removing it.
    expect(res(['intensely', 'ice', 'ward'])).toBeCloseTo(plain * 1.6, 5);
    expect(res(['dimly', 'ice', 'ward'])).toBeCloseTo(plain * 0.6, 5);

    // The clock adverbs move the CLOCK — and trailing thins what it stretches.
    expect(secs(['slowly', 'ice', 'ward'])).toBe(plainSecs * 2);
    expect(secs(['ice', 'ward', 'slowly'])).toBe(plainSecs * 3);
    expect(res(['ice', 'ward', 'slowly'])).toBeLessThan(res(['slowly', 'ice', 'ward']));
    expect(secs(['quickly', 'ice', 'ward'])).toBeLessThan(plainSecs);

    // Landing adverbs split the way they do everywhere: leading buys WEAR,
    // trailing buys thickness.
    expect(secs(['twice', 'ice', 'ward'])).toBe(plainSecs * 2);
    expect(res(['twice', 'ice', 'ward'])).toBeCloseTo(plain, 5);
    expect(res(['ice', 'ward', 'twice'])).toBeCloseTo(plain * 2, 5);
    expect(secs(['ice', 'ward', 'twice'])).toBe(plainSecs);
  });

  it('malice reads by position too: leading seeks the seam, trailing widens it', () => {
    const seeking = composeArcane(['viciously', 'venom', 'cut'])!.strikes[0];
    const widening = composeArcane(['venom', 'cut', 'viciously'])!.strikes[0];
    // Leading is about the casting: how OFTEN a vital spot is found.
    expect(seeking.critBonus).toBeCloseTo(0.07, 5);
    expect(seeking.critDamageBonus).toBeUndefined();
    // Trailing is about the substance: how WIDE the one found opens.
    expect(widening.critDamageBonus).toBeCloseTo(0.25, 5);
    expect(widening.critBonus).toBeUndefined();
    // Same for restraint, in the other direction.
    expect(composeArcane(['gently', 'venom', 'cut'])!.strikes[0].critBonus).toBeCloseTo(-0.05, 5);
    expect(composeArcane(['venom', 'cut', 'gently'])!.strikes[0].critDamageBonus).toBeCloseTo(-0.2, 5);
  });

  it('adverb position reads against the clause CORE, so verb-only clauses read both ways', () => {
    // A clause with no noun still has a substance — its verb. Before it is
    // volume, after it is depth, exactly as with a noun.
    const volley = composeArcane(['twice', 'cut'])!.strikes[0];
    const spike = composeArcane(['cut', 'twice'])!.strikes[0];
    expect(volley.hits).toBe(2);
    expect(spike.hits).toBeUndefined();
    expect(spike.power).toBeCloseTo(volley.power * 2, 5);

    // And in a verb-led clause the verb is the core: an adverb after it is
    // trailing even though the noun has not been spoken yet.
    const afterVerb = composeArcane(['pierce', 'twice', 'fire'])!.strikes[0];
    expect(afterVerb.hits).toBeUndefined();
    expect(composeArcane(['twice', 'pierce', 'fire'])!.strikes[0].hits).toBe(2);
  });

  it('a sentence of nothing but adverbs and targets fizzles', () => {
    expect(parseSentence(['slowly', 'me']).ok).toBe(false);
    expect(composeArcane(['slowly', 'me'])).toBeNull();
  });

  it('checkSentence gates on the mage, not the grammar', () => {
    const g = fresh();
    // Level 0: three words at most, and no high words.
    expect(maxSentenceWords(0)).toBe(3);
    expect(checkSentence(reads(g), ['fire', 'pierce', 'ice', 'fly']).reason).toBe('Word limit is 3 (Arcana 0)');
    // An unlearned word reads as UNKNOWN before any level talk: the starter
    // lexicon sits in front of the minLevel gate on purpose.
    expect(checkSentence(reads(g), ['zero']).reason).toBe('Unknown word: "zero"');
    patch(g, (slices) => {
      slices.counters.counts['flag:word:zero'] = 1;
    });
    expect(checkSentence(reads(g), ['zero']).reason).toMatch(/Arcana 10/);
    expect(checkSentence(reads(g), ['fire', 'pierce']).ok).toBe(true);
    mage(g);
    expect(checkSentence(reads(g), ['zero']).ok).toBe(true);
  });
});

// ---------- The grimoire ----------

describe('the grimoire', () => {
  it('inscribes a sentence once, and refuses the exact recomposition', () => {
    const g = fresh();
    mage(g);
    expect(scribe(g, ['fire', 'pierce'])).toBe(true);
    expect(book(g)).toHaveLength(1);
    expect(scribe(g, ['fire', 'pierce'])).toBe(false);
    // Different order is a different spell — that is the whole point.
    expect(scribe(g, ['pierce', 'fire'])).toBe(true);
    expect(book(g)).toHaveLength(2);
  });

  it('inscription manifests and pays the Arcana skill', () => {
    const g = fresh();
    patch(g, (slices) => {
      slices.attributes.attrs.int.level = 15; // over the unlock bar; skill not yet manifested
    });
    expect(skillsOf(g).arcana).toBeUndefined();
    scribe(g, ['fire', 'pierce']);
    expect(skillsOf(g).arcana).toBeDefined();
    expect(skillsOf(g).arcana.xp > 0 || skillsOf(g).arcana.level > 0).toBe(true);
  });

  // The book is written by the test helper; the assertions are about the resolution.
  it('a spell resolves to the same spec as its sentence, under any given name', () => {
    const g = fresh();
    inscribe(g, { school: 'arcane', words: ['ice', 'fly'] });
    const book = () => slice<SpellcraftState>(g, 'spellcraft').grimoire;
    const spec = resolveSpell(book()[0]);
    expect(spec).toEqual(composeArcane(['ice', 'fly'])!);
    patch(g, (slices) => {
      (slices.spellcraft as SpellcraftState).grimoire[0].name = 'Snowdart';
    });
    const renamed = resolveSpell(book()[0]);
    expect(renamed.name).toBe('Snowdart');
    expect(renamed.strikes).toEqual(spec.strikes);
  });

  it('holds at most the prepared cap', () => {
    const g = fresh();
    mage(g);
    const sentences = [['fire'], ['ice'], ['spark'], ['water']];
    const uids = sentences.map((words) => {
      scribe(g, words);
      return lastSpell(g).uid;
    });
    for (const uid of uids.slice(0, BASE_PREPARED)) expect(prepare(g, uid)).toBe(true);
    expect(prepare(g, uids[BASE_PREPARED])).toBe(false);
    expect(preparedSpells(slice<SpellcraftState>(g, 'spellcraft'))).toHaveLength(BASE_PREPARED);
  });

  it('every twenty levels of a school buys another page', () => {
    const g = fresh();
    expect(preparedCap(reads(g))).toBe(BASE_PREPARED);
    setSkill(g, 'arcana', 19);
    expect(preparedCap(reads(g))).toBe(BASE_PREPARED);
    setSkill(g, 'arcana', 40);
    expect(preparedCap(reads(g))).toBe(BASE_PREPARED + 2);
    // Each school counts on its own — a page earned anywhere is spendable
    // anywhere — but the shared `magic` parent behind them never counts.
    setSkill(g, 'devotion', 20);
    setSkill(g, 'psionics', 20);
    setSkill(g, 'magic', 60);
    expect(preparedCap(reads(g))).toBe(BASE_PREPARED + 4);
  });

  it('a wider mind holds the spell the base cap refused', () => {
    const g = fresh();
    mage(g);
    const uids = [['fire'], ['ice'], ['spark'], ['water']].map((words) => {
      scribe(g, words);
      return lastSpell(g).uid;
    });
    for (const uid of uids.slice(0, BASE_PREPARED)) prepare(g, uid);
    expect(prepare(g, uids[BASE_PREPARED])).toBe(false);
    setSkill(g, 'devotion', 20);
    expect(prepare(g, uids[BASE_PREPARED])).toBe(true);
  });

  // New (step 3): the pantheon's veto at preparation, with the book written
  // by the helper (learning a miracle is the divine port).
  it('a miracle of a deity hostile to a prepared one refuses the page', () => {
    const g = fresh();
    inscribe(g, { school: 'divine', litany: 'litany_retribution' }, { prepared: false });
    inscribe(g, { school: 'divine', litany: 'vermin_swarm' }, { prepared: false });
    const [denjalle, goblinHunt] = book(g);
    expect(deityRelation('denjalle', 'goblin_hunt')).toBe('hostile');
    expect(prepare(g, denjalle.uid)).toBe(true);
    const result = g.dispatch(setPrepared({ uid: goblinHunt.uid, prepared: true }));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(/refuses to share a page/);
    // Standing one down lets the other on.
    expect(prepare(g, denjalle.uid, false)).toBe(true);
    expect(prepare(g, goblinHunt.uid)).toBe(true);
  });

  // New (step 3): casting outside a fight, on an arcane mending.
  it('a mending can be cast with nobody to fight; a strike cannot', () => {
    const g = fresh();
    mage(g);
    scribe(g, ['water', 'mend']);
    const mend = lastSpell(g);
    scribe(g, ['fire', 'pierce']);
    const strike = lastSpell(g);
    setPool(g, 'mana', 20);
    setHp(g, 5);
    const spec = resolveSpellFor(reads(g), mend);
    expect(g.dispatch(castUtility({ uid: mend.uid })).ok).toBe(true);
    expect(mana(g)).toBeCloseTo(20 - spec.manaCost * playerStats(g).manaEff, 5);
    expect(slice<ResourcesState>(g, 'resources').values.hp).toBeGreaterThan(5);
    // On the clock now, the clock consumables use in the old build.
    const again = g.dispatch(castUtility({ uid: mend.uid }));
    expect(again.ok ? '' : again.reason).toMatch(/on cooldown/);
    const refused = g.dispatch(castUtility({ uid: strike.uid }));
    expect(refused.ok ? '' : refused.reason).toBe('Fire Pierce needs a target');
    // A ward is a buff, not a grant: the old `isUtilityWorking` reads grants and heals only.
    expect(isUtilityWorking(composeArcane(['ice', 'ward'])!)).toBe(false);
  });
});

// ---------- Divine ----------

describe('browsing the powers', () => {
  it.todo('tags OR within an axis and AND across them, like the bestiary (step 3: divine: queryDeities)');
  it.todo('search reads names, epithets and what the god is like (step 3: divine: queryDeities)');
  it.todo('a membership tag is the pantheon claim (step 3: divine: deityGroups)');
  it.todo('groups by pantheon, with everyone unaffiliated together at the end (step 3: divine: deityGroups, pantheonOf)');
});

describe('the pantheon', () => {
  it('resolves every relation the deities declared, and hostility always wins', () => {
    // Xima and Kenese court each other (Bestial/Tribal) — but Kenese despises
    // the Honorable, and Xima is exactly that. The grudge outweighs the tribes.
    expect(deityRelation('xima', 'kenese_paea')).toBe('hostile');
    // D'Enjalle befriends the honorable Cold Sun; Xima's fire-exception is an
    // exception to HIS OWN fondness, not a grudge, so the friendship stands.
    expect(deityRelation('denjalle', 'xima')).toBe('synergy');
    // Kenese despises the Honorable — and D'Enjalle is nothing else.
    expect(deityRelation('denjalle', 'kenese_paea')).toBe('hostile');
    // Both Organized; Usvýlgr's trickster grudge only covers tricksters.
    expect(deityRelation('usvylgr', 'denjalle')).toBe('synergy');
    // The Infinity is merely watching.
    for (const other of ['xima', 'denjalle', 'usvylgr', 'kenese_paea']) {
      expect(deityRelation('ikthelthe', other)).toBe('neutral');
    }
    expect(deityRelation('usvylgr', 'kenese_paea')).toBe('neutral');
    // A deity resonates with itself.
    expect(deityRelation('xima', 'xima')).toBe('synergy');
  });

  it.todo('favor is standing with ONE deity, spent there and nowhere else (step 3: divine: grantFavor, learnMiracle)');

  // The book is written by the test helper; the assertions are about the resolution.
  it('a miracle resolves to its declared spec, wearing school and deity', () => {
    const g = fresh();
    inscribe(g, { school: 'divine', litany: 'litany_mending' });
    const spec = resolveSpell(slice<SpellcraftState>(g, 'spellcraft').grimoire[0]);
    expect(spec.school).toBe('divine');
    expect(spec.deity).toBe('xima');
    expect(spec.heal).toBe(2);
  });

  it.todo(
    'hostile deities refuse to share a prepared page — unless dogma is defied (step 3: divine: learnMiracle; titles: the title that defies dogma. The veto itself is ported and tested in "the grimoire")',
  );
});

describe('miracle mechanics', () => {
  it("Xima's communion turns bleeding into feeding", () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'bleeding', intensity: 2 });
    const bleeding = tickOf(g, PLAYER, { hp: 100, maxHp: 100, inCombat: true });
    expect(bleeding.damage).toBeGreaterThan(0);

    apply(g, PLAYER, { id: 'blood_communion', intensity: 1 });
    const communed = tickOf(g, PLAYER, { hp: 100, maxHp: 100, inCombat: true });
    expect(communed.damage).toBe(0);
    expect(communed.restores.some((r) => r.resource === 'hp' && r.amount > 0)).toBe(true);
  });

  it('venom can be stripped from its bearer and redoubled on a victim', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'poison', intensity: 3 });
    const taken = ask(g, stripStatuses, { entity: PLAYER, ids: ['poison', 'rotting'] });
    expect(taken).toEqual([{ id: 'poison', intensity: 3 }]);
    expect(find(g, 'poison')).toBeUndefined();

    apply(g, PLAYER, { id: 'poison', intensity: 2 });
    expect(ask(g, amplifyStatuses, { entity: PLAYER, ids: ['poison'], mult: 2 })).toBe(1);
    expect(find(g, 'poison')?.intensity).toBe(4);
  });

  it('duels pacify flankers and shrouds turn blows aside', () => {
    const g = fresh();
    expect(statusPacifiesFlankers(held(g))).toBe(false);
    expect(statusIncomingMissChance(held(g))).toBe(0);
    apply(g, PLAYER, { id: 'honor_bound', intensity: 1 });
    apply(g, PLAYER, { id: 'night_shroud', intensity: 1 });
    expect(statusPacifiesFlankers(held(g))).toBe(true);
    expect(statusIncomingMissChance(held(g))).toBeCloseTo(0.12, 5);
  });
});

// ---------- Psionic ----------

describe('psionic shaping', () => {
  it.todo('axes have caps, closed axes await teachers, and an empty shape is nothing (step 3: psionic)');
  it.todo('output outruns input: the point curve is superlinear (step 3: psionic)');
  it.todo('the same two axes build a wall or swing a hammer, depending only on the product (step 3: psionic)');
  it.todo('acuity is a RATIO: spreading a working is what makes it missable (step 3: psionic)');
  it.todo('inward is an AIM: the same quantity is a hammer out and speed in (step 3: psionic)');
  it.todo('every quantity has both faces, and the share splits them (step 3: psionic)');
  it.todo('coherence buys how long an inward working is worn (step 3: psionic)');
  it.todo('inward is a SHARE: a divided will does both, and worse (step 3: psionic)');
  it.todo('purchase: a grab made at speed does not hold, and zero grip is slippery (step 3: psionic)');
  it.todo('a daze is spent, not held, so purchase never puts a clock on it (step 3: psionic)');
  it.todo('matter argues with a working, and can rob it of its name (step 3: psionic)');
  it.todo('a bias reaches the shape through ordinary equipment, and only psionics feels it (step 3: psionic)');
  it.todo('zero survives the rewrite, because every product carries it (step 3: psionic)');
  it.todo('a recognition is a NAME for a region, not the content of one (step 3: psionic)');
  it.todo('an inward face is granted by the PATTERN, and a name changes nothing (step 3: psionic)');
  it.todo('an unrecognised shape is named and described by what it came out as (step 3: psionic)');
  it.todo('an untaught region refuses to be inscribed; a teacher unlocks it (step 3: psionic)');
  it.todo('shapes can be held in mind and recalled, without being inscribed (step 3: psionic)');
  it.todo('the mind holds only so many shapes, and old saves hold none (step 3: psionic)');
  it.todo('a working is paid for in focus, never the arcane pool (step 3: psionic)');
  it.todo('a working wider than the mind holding it never fires (step 3: psionic)');
  it.todo('a working that lands on you can be cast with nobody to fight (step 3: psionic)');
  it.todo('a working with nothing to give the caster refuses to be cast idly (step 3: psionic)');
  it.todo('a shape is held once; the same shape again is refused (step 3: psionic)');
  it.todo('overlapping regions resolve by nesting, never by declaration order (step 3: psionic)');
  it.todo('no legal shape costs points and does nothing (step 3: psionic)');
  it.todo('sight and structure reach the enemy without a blow to ride on (step 3: psionic)');
  it.todo('psionics borrows no other school’s signature condition (step 3: psionic)');
  it.todo('every legal shape resolves to a total spec — old grimoires cannot break (step 3: psionic)');
  it.todo('v23 saves keep the grip they always had; the wall stops what is thrown (step 3: psionic)');
});

// ---------- Monsters using the player's systems ----------

describe('monsters that work', () => {
  /** Drop one specimen in front of the player, ready to act. */
  function facing(defId: string, seed = 5) {
    const g = fresh(seed);
    const [foe] = stage(g, [{ monsterId: defId, level: 3 }], SITES.woods_edge);
    return { g, foe };
  }

  it('a monster’s mind is worth something — spellPower reads INT', () => {
    // It was decorative before: `damage` reads STR alone, so a caster statted
    // with a high mind and low arm was simply harmless.
    const dull = monsterStatsFromAttrs({ str: 10, int: 1 });
    const bright = monsterStatsFromAttrs({ str: 10, int: 20 });
    expect(bright.spellPower).toBeGreaterThan(dull.spellPower);
    expect(bright.damage).toBe(dull.damage); // the arm is untouched by the mind
  });

  // The arcane and divine rows of the old case. The psionic row is the todo below.
  it('all three schools reach the player through one path', () => {
    /*
     * The point of `MonsterDef.rotation`: a sentence, a miracle and a shape
     * sit in ONE ordered list beside techniques, because each composes to a
     * SpellSpec from pure inputs. If this passes for all three, adding a
     * fourth school costs a monster nothing.
     */
    const schools: [string, string][] = [
      ['death_knight', 'arcane'],
      ['paladin_x', 'divine'],
    ];
    for (const [defId, school] of schools) {
      const casts = (MONSTERS[defId].rotation ?? []).flatMap((a) => ('cast' in a ? [a.cast] : []));
      expect(casts.length, `${defId} has no workings`).toBeGreaterThan(0);
      for (const src of casts) {
        const spec = specForSource(src);
        expect(src.school, `${defId} school`).toBe(school);
        // It composed into something real rather than falling back to FADED.
        expect(spec.name).not.toBe('Faded Inscription');
        expect(spec.cooldown).toBeGreaterThan(0);
      }
    }
  });
  it.todo('all three schools reach the player through one path (step 3: psionic: the psionic_slime row)');

  // Every technique entry and every arcane and divine cast. The psionic casts are the todo below.
  it('every rotation entry resolves — a typo would be a monster that does nothing', () => {
    for (const m of Object.values(MONSTERS)) {
      for (const entry of m.rotation ?? []) {
        if ('technique' in entry) {
          expect(TECHNIQUES[entry.technique], `${m.id} -> ${entry.technique}`).toBeDefined();
        } else if (entry.cast.school !== 'psionic') {
          expect(specForSource(entry.cast).name, `${m.id} cast`).not.toBe('Faded Inscription');
        }
      }
    }
  });
  it.todo('every rotation entry resolves — a typo would be a monster that does nothing (step 3: psionic: the psionic casts)');

  it.todo('a psionic slime shapes a working, and the space decides what it is (step 3: psionic)');

  /** Run the staged fight. The old helper called `tickCombat` directly. */
  const fight = (g: Kernel, ticks: number, until?: () => boolean) => {
    for (let i = 0; i < ticks; i++) {
      if (until?.()) return;
      g.tick();
      if (!combatOf(g).fight) return;
    }
  };

  const hp = (g: Kernel): number => slice<ResourcesState>(g, 'resources').values.hp;

  // The goblin firetongue stands in for the psionic slime: its rotation is nothing but workings.
  it('a monster spends its turn on a working, and it lands', () => {
    const { g } = facing('goblin_firetongue');
    const hpBefore = hp(g);
    fight(g, 600, () => hp(g) < hpBefore);
    expect(
      texts(g).some((t) => / casts /.test(t)),
      'never cast a working',
    ).toBe(true);
    expect(hp(g)).toBeLessThan(hpBefore);
  });

  // The goblin firetongue stands in for the psionic slime: it is `ranged` too.
  it('a working is not a blow: a bulwark does not stop one', () => {
    // kinetic_bulwark stops anything THROWN, and the firetongue is `ranged` — so a
    // rote shot would be blocked outright. The cast branch sits AHEAD of that
    // check because a working is not thrown, and this is what proves the order.
    expect(MONSTERS.goblin_firetongue.range).toBe('ranged');
    const { g } = facing('goblin_firetongue');
    apply(g, PLAYER, { id: 'kinetic_bulwark', intensity: 1 });
    expect(statusBlocksRangedType(held(g), 'heat')).toBe(true);
    fight(g, 600, () => texts(g).some((t) => / casts /.test(t)));
    expect(texts(g).some((t) => / casts /.test(t))).toBe(true);
  });

  it('a monster walks the position graph on its own, with nothing scripting it', () => {
    /*
     * The whole claim about techniques for monsters: give it a loadout and the
     * graph runs itself. The Death Knight starts at neutral, so only Gather is
     * open (neutral → coiled); coiled is the only door Heavy Blow has. Nothing
     * anywhere states that order — it falls out of `from`/`to` once each
     * specimen keeps its own position.
     */
    const { g } = facing('death_knight');
    expect(TECHNIQUES.gather.from.map((way) => way.at)).toEqual([['neutral']]);
    expect(TECHNIQUES.gather.to).toBe('coiled');
    expect(TECHNIQUES.heavy_blow.from.map((way) => way.at)).toEqual([['coiled']]);

    // Collected from the whole feed, not the last line — the blow it shapes is
    // reported after it, so the technique line is never the most recent one.
    const moves = () =>
      texts(g)
        .map((t) => t.match(/moves into (Gather|Heavy Blow)/)?.[1])
        .filter((n): n is string => !!n);
    let last: Enemy | undefined;
    for (let i = 0; i < 1200 && moves().length < 2; i++) {
      g.tick();
      if (!combatOf(g).fight) break;
      last = foeAt(g);
      // Kept upright on purpose: a Death Knight kills a fresh character in
      // about three blows, and the chain needs longer than that to show.
      setHp(g, playerStats(g).maxHp);
    }
    const seen = moves();
    // It wound up before it swung hard — the order the graph forces.
    expect(seen[0], `saw ${JSON.stringify(seen)}`).toBe('Gather');
    expect(seen).toContain('Heavy Blow');
    // Position is per-specimen: it ends up somewhere a technique put it, and
    // the player's own position on the fight was never touched.
    expect(last?.position).toBeDefined();
    expect(['coiled', 'off_balance', 'neutral']).toContain(last?.position);
  });

  it('order is character: a knight fights first and curses second', () => {
    /*
     * Workings and techniques share one ordered list precisely so neither
     * category outranks the other. The Death Knight leads with Gather, so its
     * OPENING is martial; the sentences come out only once the graph has
     * walked somewhere neither technique can enter from. Split into two fields
     * this was impossible — every spell fired before the first swing.
     */
    const { g } = facing('death_knight');
    const opening: string[] = [];
    for (let i = 0; i < 900 && opening.length < 1; i++) {
      g.tick();
      if (!combatOf(g).fight) break;
      setHp(g, playerStats(g).maxHp);
      for (const t of texts(g)) {
        if (/moves into/.test(t)) opening.push('technique');
        else if (/ casts /.test(t)) opening.push('cast');
        if (opening.length) break;
      }
    }
    expect(opening[0], 'the knight opened by casting').toBe('technique');
  });

  it('a monster’s working runs on its own clock, per specimen', () => {
    const { g } = facing('paladin_x');
    let cooldowns: Record<number, number> | undefined;
    fight(g, 600, () => {
      cooldowns = combatOf(g).fight?.enemies[0]?.cooldowns ?? cooldowns;
      return !!cooldowns;
    });
    expect(cooldowns, 'no cooldown recorded').toBeDefined();
    // Keyed by index into `casts`, so authoring order reads as preference.
    expect(Object.keys(cooldowns!)).toContain('0');
    expect(cooldowns![0]).toBeGreaterThan(totalTicksOf(slice<ClockState>(g, 'clock')));
  });
});

// ---------- The physical triangle ----------

describe('cut, crush and pierce as verbs', () => {
  it('each buys one leg at the other two’s expense', () => {
    const cut = composeArcane(['fire', 'cut'])!.strikes[0];
    const crush = composeArcane(['fire', 'crush'])!.strikes[0];
    const pierce = composeArcane(['fire', 'pierce'])!.strikes[0];

    // All three carry the SUBSTANCE — fire stays fire, however delivered.
    for (const s of [cut, crush, pierce]) expect(s.type).toBe('heat');

    // Damage: crush > pierce > cut.
    expect(crush.power).toBeGreaterThan(pierce.power);
    expect(pierce.power).toBeGreaterThan(cut.power);

    // Status rate: cut > pierce > crush (base chance 0.35).
    const rate = (s: typeof cut) => s.inflicts![0].chance!;
    expect(rate(cut)).toBeGreaterThan(rate(pierce));
    expect(rate(pierce)).toBeGreaterThan(rate(crush));
    expect(rate(cut)).toBeGreaterThan(0.35); // readier than the bare word

    // Penetration: pierce alone.
    expect(pierce.penetration).toBeGreaterThan(0);
    expect(cut.penetration).toBeUndefined();
    expect(crush.penetration).toBeUndefined();
  });

  it('spoken bare, a physical verb IS its own substance', () => {
    const cut = composeArcane(['cut'])!.strikes[0];
    expect(cut.type).toBe('slashing');
    expect(cut.inflicts?.[0].id).toBe('bleeding');
    expect(composeArcane(['crush'])!.strikes[0].type).toBe('bludgeoning');
    expect(composeArcane(['pierce'])!.strikes[0].inflicts?.[0].id).toBe('punctured');
    // A noun still overrides: the verb only supplies what is missing.
    expect(composeArcane(['ice', 'crush'])!.strikes[0].inflicts?.[0].id).toBe('chilled');
  });

  it('delivery never reaches certainty, however deep the verb is stacked', () => {
    const deep = composeArcane(['fire', 'cut', 'cut', 'cut'])!.strikes[0];
    expect(deep.inflicts![0].chance).toBeLessThanOrEqual(0.95);
    expect(deep.inflicts![0].chance).toBeGreaterThan(composeArcane(['fire', 'cut'])!.strikes[0].inflicts![0].chance!);
  });
});

// ---------- Overgrowth: the grammar's darkest gift ----------

describe('healing enemies into overgrowth', () => {
  it('a mending follows a SPOKEN address; unspoken stays the caster’s', () => {
    // Every sentence written before this rule means what it always meant.
    expect(composeArcane(['water', 'mend'])!.healsEnemy).toBeUndefined();
    expect(composeArcane(['water', 'mend', 'me'])!.healsEnemy).toBeUndefined();
    const cruel = composeArcane(['water', 'mend', 'one'])!;
    expect(cruel.healsEnemy).toBe(true);
    expect(cruel.heal).toBeGreaterThan(0);
  });

  /** Two monsters of the woods edge in a staged fight. The old `arena` drew two from the site's table. */
  function arena(seed = 3) {
    const g = fresh(seed);
    const [a, b] = stage(
      g,
      [
        { monsterId: 'forest_rat', level: 2 },
        { monsterId: 'young_wolf', level: 3 },
      ],
      SITES.woods_edge,
    );
    return { g, a, b };
  }

  const heal = (g: Kernel, e: Enemy, amount: number, hostile?: boolean) =>
    ask(g, healEnemy, { entity: e.entity, amount, source: 'test', ...(hostile === undefined ? {} : { hostile }) });

  it('overflow healing feeds the ledger, swells, escalates, and bursts', () => {
    const { g, a } = arena();
    const maxHp = enemyStats(g, a).maxHp;
    setFoeHp(g, 0, maxHp); // already whole: every drop overflows

    // A first overdose: overgrown, ledger open.
    heal(g, a, maxHp * 0.3);
    let ledger = find(g, 'overgrowth', a.entity)!;
    expect(ledger).toBeDefined();
    expect(ledger.data!.surplus).toBeCloseTo(maxHp * 0.3, 3);

    // Past half its max HP in surplus: the growth takes on a will of its own.
    heal(g, a, maxHp * 0.3);
    expect(find(g, 'overgrowth', a.entity)).toBeUndefined();
    ledger = find(g, 'proliferating', a.entity)!;
    expect(ledger.data!.surplus).toBeCloseTo(maxHp * 0.6, 3);

    // A full max HP of surplus: the body cannot hold it.
    const otherHpBefore = foeAt(g, 1).hp;
    heal(g, a, maxHp * 0.5);
    expect(find(g, 'proliferating', a.entity)).toBeUndefined();
    expect(foeAt(g, 0).hp).toBeLessThan(0); // took its own ledger
    expect(foeAt(g, 1).hp).toBeLessThan(otherHpBefore); // showered its ally
  });

  it('a strikeless working deals no chip damage and prints no strike line', () => {
    const { g } = arena(5);
    const before = foeAt(g, 0).hp;
    const spec = composeArcane(['water', 'mend', 'one'])!;
    run(g, (ctx) => castCraftedAttack(ctx as never, 'test', spec));
    // The mending is the whole event: no blow, no "strikes for 1".
    expect(texts(g).some((t) => t.includes('strikes'))).toBe(false);
    expect(foeAt(g, 0).hp).toBeGreaterThanOrEqual(before);
  });

  it('the ledger sheds on its own — a swelling left alone subsides', () => {
    const { g, a } = arena(11);
    const maxHp = enemyStats(g, a).maxHp;
    setFoeHp(g, 0, maxHp);
    heal(g, a, maxHp * 0.05);
    const opened = find(g, 'overgrowth', a.entity)!.data!.surplus!;

    const input = { hp: foeAt(g, 0).hp, maxHp, inCombat: true };
    tickOf(g, a.entity, input);
    expect(find(g, 'overgrowth', a.entity)!.data!.surplus).toBeLessThan(opened);

    // Left entirely alone, it eventually empties and the condition ends.
    for (let i = 0; i < 2000 && find(g, 'overgrowth', a.entity); i++) tickOf(g, a.entity, input);
    expect(find(g, 'overgrowth', a.entity)).toBeUndefined();
  });

  it('forced life accrues in full, wounded or not — the healing is the price', () => {
    const { g, a } = arena(17);
    const maxHp = enemyStats(g, a).maxHp;
    // A wounded target: the working closes the wound AND still accrues the
    // whole of what was forced in. This is what makes it worth speaking at
    // anything that is not already whole.
    setFoeHp(g, 0, maxHp * 0.5);
    heal(g, a, maxHp * 0.3);
    expect(foeAt(g, 0).hp).toBeCloseTo(maxHp * 0.8, 3);
    expect(find(g, 'overgrowth', a.entity)!.data!.surplus).toBeCloseTo(maxHp * 0.3, 3);

    // And it never over-fills: the wound closes, the rest simply arrives —
    // and 0.7 of a max HP in forced life has already taken on a will.
    heal(g, a, maxHp * 0.4);
    expect(foeAt(g, 0).hp).toBeCloseTo(maxHp, 3);
    const ledger = find(g, 'proliferating', a.entity) ?? find(g, 'overgrowth', a.entity)!;
    expect(ledger.id).toBe('proliferating');
    expect(ledger.data!.surplus).toBeCloseTo(maxHp * 0.7, 3);
  });

  it('a modest ledger survives on an enormous body — the floor is absolute', () => {
    // The Benchmark Post case: ~1M max HP. A few hundred points of forced
    // life is a real swelling on it, not a rounding error, so nothing about
    // getting rid of the ledger may scale with the body it rides.
    const { g, a } = arena(23);
    // The old case set the specimen's constitution to 143,000.
    setMods(g, [{ stat: 'stats/maxHp', kind: 'add', value: 1_000_000 }], a.entity);
    const maxHp = enemyStats(g, a).maxHp;
    expect(maxHp).toBeGreaterThan(500_000);
    setFoeHp(g, 0, maxHp);

    heal(g, a, 300);
    const input = { hp: foeAt(g, 0).hp, maxHp, inCombat: true };
    // A minute of ticking barely dents it, and it is certainly still there.
    for (let i = 0; i < 600; i++) tickOf(g, a.entity, input);
    const ledger = find(g, 'overgrowth', a.entity);
    expect(ledger, 'a 300 ledger must not be discarded as a sliver').toBeDefined();
    expect(ledger!.data!.surplus).toBeGreaterThan(50);
  });

  it('kindness from their own side settles the growth instead of feeding it', () => {
    const { g, a } = arena(13);
    const maxHp = enemyStats(g, a).maxHp;
    // Open a ledger far deeper than the mending that follows, so the cure
    // is visible rather than total.
    setFoeHp(g, 0, maxHp);
    heal(g, a, maxHp * 4);
    const ledger = find(g, 'proliferating', a.entity) ?? find(g, 'overgrowth', a.entity)!;
    const before = ledger.data!.surplus!;

    // Wound it, then have its OWN side mend it: two thirds lands as health,
    // and the ledger falls by the WHOLE amount (the withheld third undoing
    // three apiece). Hostile healing would have added instead.
    setFoeHp(g, 0, maxHp * 0.5);
    heal(g, a, maxHp * 0.45, false);
    expect(foeAt(g, 0).hp).toBeCloseTo(maxHp * 0.5 + maxHp * 0.3, 3);
    const after = (find(g, 'proliferating', a.entity) ?? find(g, 'overgrowth', a.entity))!.data!.surplus!;
    expect(after).toBeCloseTo(before - maxHp * 0.45, 3);
  });

  it('kindness toward an unswollen enemy is simply healing', () => {
    const { g, a } = arena(9);
    const maxHp = enemyStats(g, a).maxHp;
    setFoeHp(g, 0, maxHp * 0.4);
    heal(g, a, maxHp * 0.3, false);
    expect(foeAt(g, 0).hp).toBeCloseTo(maxHp * 0.7, 3);
    expect(find(g, 'overgrowth', a.entity)).toBeUndefined();
  });
});

// ---------- Magnetism ----------

describe('magnetized iron', () => {
  /** One monster of the woods edge. The old `dummy` minted it outside a fight. */
  const dummy = () => {
    const g = fresh(21);
    const [foe] = stage(g, [{ monsterId: 'forest_rat', level: 2 }], SITES.woods_edge);
    return { g, m: foe.entity };
  };
  /** A dodge-ignore roll that always fails: what is true below is true whatever the roll says. */
  const never = () => false;

  it('lightning never misses magnetized flesh; iron finds the seam', () => {
    const { g, m } = dummy();
    expect(magnetBypassesDodge(never, held(g, m), 'lightning')).toBe(false);
    apply(g, m, { id: 'magnetized', intensity: 2 });
    // Always-hit is absolute for its element, whatever the roll says.
    for (let i = 0; i < 20; i++) expect(magnetBypassesDodge(never, held(g, m), 'lightning')).toBe(true);
    // Iron knows where the iron is: +5% crit per point, piercing only.
    expect(magnetCritChance(held(g, m), 'piercing')).toBeCloseTo(0.1, 5);
    expect(magnetCritChance(held(g, m), 'heat')).toBe(0);
  });

  it('the lock nullifies evasion outright and discharges into one crit', () => {
    const { g, m } = dummy();
    apply(g, m, { id: 'magnet_lock', intensity: 3 });
    // Nothing they do avoids anything, of any element.
    for (const type of ['heat', 'slashing', 'dark'] as const) {
      expect(magnetBypassesDodge(never, held(g, m), type)).toBe(true);
    }
    // The charge collapses into the next crit — once.
    const charge = ask(g, consumeMagnetCharge, { entity: m });
    expect(charge).toBeGreaterThan(0);
    expect(find(g, 'magnet_lock', m)).toBeUndefined();
    expect(ask(g, consumeMagnetCharge, { entity: m })).toBe(0);
  });

  it('enough iron locks on its own', () => {
    const { g, m } = dummy();
    for (let i = 0; i < 6; i++) apply(g, m, { id: 'magnetized', intensity: 1 });
    expect(find(g, 'magnetized', m)).toBeUndefined();
    expect(find(g, 'magnet_lock', m)).toBeDefined();
  });
});

// ---------- Content sanity ----------

describe('spellcraft content', () => {
  it('every word carries exactly the payload its kind promises', () => {
    for (const w of Object.values(ARCANE_WORDS)) {
      expect(w.id).toBeTruthy();
      if (w.kind === 'noun') {
        expect(w.element).toBeTruthy();
        expect(w.power).toBeGreaterThan(0);
      }
      if (w.kind === 'verb') expect(w.verb).toBeTruthy();
      if (w.kind === 'adverb') expect(w.adverb).toBeTruthy();
      if (w.kind === 'target') expect(w.target).toBeTruthy();
      if (w.kind === 'conjunction') expect(w.conjunction).toBeTruthy();
      if (w.kind === 'target' || w.kind === 'conjunction') {
        // Addresses and conjunctions never deepen — tier names here are bugs.
        expect(w.stacked, `${w.id} must not stack`).toBeUndefined();
      } else {
        // Everything else deepens, and owns both of its deepened names.
        expect(w.stacked, `${w.id} needs stacked names`).toHaveLength(2);
      }
    }
  });

  it('every condition a word or miracle touches actually exists', () => {
    for (const w of Object.values(ARCANE_WORDS)) {
      for (const app of w.inflicts ?? []) expect(STATUSES[app.id], `${w.id} inflicts ${app.id}`).toBeTruthy();
    }
    for (const m of MIRACLE_LIST) {
      for (const s of m.spec.strikes) {
        for (const app of s.inflicts ?? []) expect(STATUSES[app.id], `${m.id} inflicts ${app.id}`).toBeTruthy();
      }
      for (const app of m.spec.grants ?? []) expect(STATUSES[app.id], `${m.id} grants ${app.id}`).toBeTruthy();
      for (const list of [m.spec.transfers?.statuses, m.spec.amplify?.statuses, m.spec.empowered?.statuses]) {
        for (const id of list ?? []) expect(STATUSES[id], `${m.id} references ${id}`).toBeTruthy();
      }
    }
  });

  it('every miracle belongs to a real deity, and every deity tag is registered', () => {
    for (const m of MIRACLE_LIST) {
      expect(DEITIES[m.deity], `${m.id} deity ${m.deity}`).toBeTruthy();
      expect(m.spec.deity, `${m.id} spec must not hardcode a deity — divine.ts stamps it`).toBeUndefined();
    }
    for (const d of Object.values(DEITIES)) {
      for (const t of d.tags) expect(DEITY_TAGS[t], `${d.id} tag ${t}`).toBeTruthy();
      for (const rule of [...(d.synergies ?? []), ...(d.hostilities ?? [])]) {
        for (const t of [...rule.anyOf, ...(rule.unless ?? []), ...(rule.waiver ?? [])]) {
          expect(DEITY_TAGS[t], `${d.id} rule tag ${t}`).toBeTruthy();
        }
      }
      // A deity with no miracles is a shrine to nothing.
      expect(MIRACLE_LIST.some((m) => m.deity === d.id), `${d.id} grants no miracles`).toBe(true);
      // A tag with no axis cannot be filtered on, so it would be invisible on
      // the shelf however faithfully it described the god.
      for (const t of d.tags) {
        const axis = DEITY_TAGS[t]?.category;
        expect(
          (DEITY_TAG_CATEGORIES as readonly string[]).includes(axis),
          `${d.id} tag ${t} has unknown axis '${axis}'`,
        ).toBe(true);
      }
      // A pantheon claimed must exist, or the claimant quietly stands alone.
      // No pantheon exists: the old `PANTHEONS` is empty and is not a registry here.
      expect(d.pantheon, `${d.id} claims unknown pantheon ${d.pantheon}`).toBeUndefined();
    }
  });

  it('every sentence of known starter words composes or fizzles, never throws', () => {
    const ids = Object.keys(ARCANE_WORDS);
    for (const a of ids) {
      for (const b of ids) {
        expect(() => composeArcane([a, b])).not.toThrow();
      }
    }
  });

  it.todo('no two psionic recognitions claim the same region (step 3: psionic)');
  it.todo('every recognition names a region that some shape actually reaches (step 3: psionic)');

  it('spell keys preserve order for arcane and identity for the rest', () => {
    expect(spellKey({ school: 'arcane', words: ['fire', 'pierce'] })).not.toBe(
      spellKey({ school: 'arcane', words: ['pierce', 'fire'] }),
    );
    expect(spellKey({ school: 'divine', litany: 'litany_mending' })).toBe('divine:litany_mending');
  });
});

// ---------- Saves ----------

describe('save migration', () => {
  it.todo('v21 saves arrive with an empty grimoire and no standing anywhere (not ported: the save here starts at version 1)');
  it.todo('v22 pooled favor is honoured by every deity (not ported: the save here starts at version 1)');
});

// ---------- Casting ----------

describe('casting in combat', () => {
  /** The old `battleMage`: Intelligence 30, Wisdom 20, Arcana 12, 30 mana. The word flags are step 3. */
  function battleMage(seed = 7) {
    const g = fresh(seed);
    patch(g, (slices) => {
      const attrs = (slices.attributes as AttributesState).attrs;
      attrs.int.level = 30;
      attrs.wis.level = 20;
      slices.skills.skills.arcana = { level: 12, xp: 0 };
    });
    setPool(g, 'mana', 30);
    return g;
  }

  it('a prepared offensive spell casts on the swing and spends mana', () => {
    const g = battleMage();
    inscribe(g, { school: 'arcane', words: ['fire', 'pierce'] });
    expect(g.dispatch(hunt({ site: SITES.woods_edge })).ok).toBe(true);

    let cast = false;
    let spentSomething = false;
    for (let i = 0; i < 4000 && !cast; i++) {
      const before = mana(g);
      g.tick();
      if (texts(g).some((t) => t.includes('Fire Pierce'))) {
        cast = true;
        // The cast tick spends far more than a tick of regen gives back.
        spentSomething = mana(g) < before;
      }
      // Stand-in for the knockout and its recovery (the world port).
      keepHunting(g, 'woods_edge');
    }
    expect(cast).toBe(true);
    expect(spentSomething).toBe(true);
  });

  // This case found two differences in port 4's `activeRotation` (the default
  // order of kinds and stale ids of the saved order). Both were corrected in
  // spine port 5 to the old rule.
  it('prepared spells join the rotation and reorder like any entry', () => {
    const g = fresh();
    // A known technique to order against.
    learn(g, 'gather');
    const tid = 'technique:gather';
    const gid = inscribe(g, { school: 'arcane', words: ['fire', 'pierce'] });
    const activeOrder = (): string[] => run(g, (ctx) => activeRotation(ctx as never, combatOf(g).rotation));
    const setPrepared = (prepared: boolean) =>
      patch(g, (slices) => {
        const spell = (slices.spellcraft as SpellcraftState).grimoire[0];
        if (prepared) spell.prepared = true;
        else delete spell.prepared;
      });

    // In the rotation, after techniques by default.
    let rotation = activeOrder();
    expect(rotation).toContain(gid);
    expect(rotation.indexOf(gid)).toBeGreaterThan(rotation.indexOf(tid));

    // A nudge materialises the order and moves it like any entry would.
    const order = activeOrder();
    const from = order.indexOf(gid);
    order.splice(from - 1, 0, order.splice(from, 1)[0]);
    expect(g.dispatch(setRotation({ order })).ok).toBe(true);
    rotation = activeOrder();
    expect(rotation.indexOf(gid)).toBeLessThan(rotation.indexOf(tid));

    // Standing it down removes it from the rotation; its slot in the saved
    // order stays inert until it is prepared again.
    setPrepared(false);
    expect(activeOrder()).not.toContain(gid);
    setPrepared(true);
    expect(activeOrder().indexOf(gid)).toBeLessThan(activeOrder().indexOf(tid));
  });

  it('a ward casts from the buff slot and is worn as a buff', () => {
    const g = battleMage(11);
    inscribe(g, { school: 'arcane', words: ['ice', 'ward'] });
    expect(g.dispatch(hunt({ site: SITES.woods_edge })).ok).toBe(true);

    let warded = false;
    for (let i = 0; i < 4000 && !warded; i++) {
      g.tick();
      if (combatOf(g).fight?.buffs.some((b) => b.name === 'Ward')) warded = true;
      keepHunting(g, 'woods_edge');
    }
    expect(warded).toBe(true);
  });
});

// ---------- Skilling the vocabulary ----------

describe('word skills', () => {
  it('every word has one, parented to Arcana, tagged only to itself', () => {
    for (const w of Object.values(ARCANE_WORDS)) {
      const skill = SKILLS[wordSkillId(w.id)];
      expect(skill, `${w.id} has no word skill`).toBeDefined();
      expect(skill.parent).toBe('arcana');
      // Saying "fire" must never teach "ice": one tag, its own.
      expect(skill.tags).toEqual([wordTag(w.id)]);
    }
  });

  it('practice makes a word heavier — and only that word', () => {
    const bare = composeArcane(['fire', 'crush'])!;
    const practised = composeArcane(['fire', 'crush'], { fire: 20 })!;
    expect(practised.strikes[0].power).toBeCloseTo(
      bare.strikes[0].power * (1 + WORD_POWER_PER_LEVEL * 20),
      5,
    );
    // A level in a word this sentence never spoke changes nothing.
    expect(composeArcane(['fire', 'crush'], { ice: 40 })!.strikes[0].power)
      .toBeCloseTo(bare.strikes[0].power, 5);
    // Every word in the clause compounds, so a practised sentence beats a
    // practised word.
    const both = composeArcane(['fire', 'crush'], { fire: 20, crush: 20 })!;
    expect(both.strikes[0].power).toBeGreaterThan(practised.strikes[0].power);
    // Mendings and wards read the same practice as strikes do.
    expect(composeArcane(['water', 'mend'], { mend: 30 })!.heal!).toBeGreaterThan(
      composeArcane(['water', 'mend'])!.heal!,
    );
  });

  it('the grimoire lists the BARE reading; the caster reads their own', () => {
    const g = fresh();
    mage(g);
    scribe(g, ['fire', 'crush']);
    const bare = resolveSpell(lastSpell(g)).strikes[0].power;
    setSkill(g, wordSkillId('fire'), 30);
    // The cache still holds the sentence as the grammar has it…
    expect(resolveSpell(lastSpell(g)).strikes[0].power).toBeCloseTo(bare, 5);
    // …while the speaker's own reading counts what they know.
    expect(resolveSpellFor(reads(g), lastSpell(g)).strikes[0].power).toBeGreaterThan(bare);
  });

  it('inscribing practises nothing; only a cast wears a word in', () => {
    const g = fresh();
    mage(g);
    const before = { ...skillsOf(g) };
    scribe(g, ['fire', 'crush']);
    // The grammar learned something; the words did not — nobody spoke them.
    expect(skillsOf(g)[wordSkillId('fire')]).toBeUndefined();
    expect(skillsOf(g)[wordSkillId('crush')]).toBeUndefined();
    expect(skillsOf(g).arcana?.xp ?? 0).toBeGreaterThanOrEqual(before.arcana?.xp ?? 0);
    emit(g, spellPractised, { id: `grimoire:${lastSpell(g).uid}` });
    expect(skillsOf(g)[wordSkillId('fire')]?.xp ?? 0).toBeGreaterThan(0);
    expect(skillsOf(g)[wordSkillId('crush')]?.xp ?? 0).toBeGreaterThan(0);
  });

  it('a costly sentence teaches more, but logarithmically', () => {
    const xpFor = (mana: number) => {
      const g = fresh();
      setSkill(g, 'magic', 1);
      setSkill(g, 'arcana', 1);
      setSkill(g, wordSkillId('fire'), 1);
      // The old `grantWordXp(state, bus, ['fire'], mana)`: the amount, paid to the one word skill.
      emit(g, grantSkillXpDirect, { skillId: wordSkillId('fire'), amount: wordXpFor(mana) });
      // Total practice, not the residue in the current level.
      const sk = skillsOf(g)[wordSkillId('fire')];
      let total = sk.xp;
      for (let l = 1; l < sk.level; l++) total += skillXpNeeded(wordSkillId('fire'), l);
      return total;
    };
    const cheap = xpFor(4);
    const dear = xpFor(80);
    expect(dear).toBeGreaterThan(cheap);
    // Twenty times the cost is worth far less than twenty times the practice.
    expect(dear).toBeLessThan(cheap * 4);
  });

  it('milestones give back the word\u2019s own nature', () => {
    const lightning = SKILLS[wordSkillId('spark')];
    expect(lightning.milestones?.length).toBe(WORD_MILESTONE_LEVELS.length);
    expect(lightning.milestones![0].bonus[0].stat).toBe('speed');
    expect(SKILLS[wordSkillId('stone')].milestones![0].bonus[0].stat).toBe('armor');
    expect(SKILLS[wordSkillId('gust')].milestones![0].bonus[0].stat).toBe('dodge');
  });
});
