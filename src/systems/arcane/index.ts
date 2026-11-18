/**
 * The arcane school: the lexicon, the grammar that composes a sentence into
 * a spell, who may speak which sentence, inscription at the Spellcrafting
 * Table, and the word skills worn in by casting. Port of the old
 * `systems/arcane.ts`, `ARCANE_WORDS`, the arcane half of
 * `systems/spellcraft.ts` (`checkInscription`, `inscribeArcane`,
 * `grantCastWordXp`) and the starter lexicon of `systems/unlocks.ts`. See
 * README.md in this folder.
 *
 * The school registers itself with `spellcraft` at module load. This system
 * holds no state: the levels, the novelty ledger and the word latches live in
 * `skills` and `counters`, the book in `spellcraft`.
 */
import { defineCommand, defineEvent, defineSystem, handle, on, OK, registry, skipped } from '../../kernel';
import { bumpCounter } from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import skills, { checkDiscovery, grantDiscoveryXp, grantSkillXp, grantSkillXpDirect, SKILLS } from '../skills';
import spellcraft, {
  addSpell,
  hasSpell,
  registerSchool,
  resolveSpell,
  spellKey,
  spellOfId,
  spellPractised,
  type SpellcraftReads,
} from '../spellcraft';
import textData from './content/arcane_text.json';
import { ARCANE_WORDS, arcaneWords } from './defs';
import { composeArcane, splitWordId } from './grammar';
import {
  checkSentence,
  maxSentenceWords,
  speakerFacts,
  spokenWords,
  tierFromUses,
  WORD_MASTERY,
  wordLevels,
  wordNoveltyKey,
  wordSkillId,
  wordTag,
  wordXpFor,
  type ArcaneReads,
  type SentenceCheck,
  type SpeakerFacts,
} from './legal';
import { migrations } from './migrations';
import { availableMax, poolHooks } from '../resources';
import { skillXpNeeded } from '../skills';
import { statBlockOf, type DerivedStats } from '../stats';
import world, { SPOTS } from '../world';

export * from './defs';
export * from './grammar';
export * from './legal';

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const arcaneText = registry(textSchema, textData, 'Arcane text');

/** The tags an inscription trains, and that its discovery checks. */
const INSCRIBE_TAGS = ['spellcraft', 'magic', 'arcane'];

/**
 * A sentence's identity: its tokens in order, in collapsed form, so `fire
 * fire pierce` and a mastered `fire:2 pierce` are one spell. The arcane case
 * of the old `spellKey`.
 */
export function sentenceKey(words: readonly string[]): string {
  const tokens: { id: string; n: number }[] = [];
  for (const raw of words) {
    const { id, tier } = splitWordId(raw);
    const last = tokens[tokens.length - 1];
    if (last && last.id === id && ARCANE_WORDS[id]?.kind !== 'target') last.n += tier;
    else tokens.push({ id, n: tier });
  }
  return tokens.map((t) => (t.n > 1 ? `${t.id}${t.n}` : t.id)).join(',');
}

registerSchool('arcane', {
  key: (source) => sentenceKey(source.words),
  spec: (source) => composeArcane([...source.words]),
  // The speaker's vocabulary: a practised word is heavier in this mouth.
  reading: (reads, source) => composeArcane([...source.words], wordLevels(reads)),
});

/**
 * Whether the table takes this sentence now: legal speech, and not a
 * sentence the book holds already. The old `checkInscription`.
 */
export function checkInscription(reads: ArcaneReads, book: SpellcraftReads, words: readonly string[]): SentenceCheck {
  const check = checkSentence(reads, words);
  if (check.ok && hasSpell(book, { school: 'arcane', words: [...words] })) {
    return { ...check, ok: false, reason: 'Already in your grimoire. Change or add a word to inscribe a new spell' };
  }
  return check;
}

/** Speak an arcane sentence into the grimoire. The old `inscribeArcane`. */
export const inscribe = defineCommand<{ words: string[] }>('arcane/inscribe');

/**
 * A sentence was inscribed. `first` when its key was new to the novelty
 * ledger of Arcana. Emitted after the inscription's skill XP, so a hearer
 * sees Arcana as that XP left it.
 */
export const inscribed = defineEvent<{ key: string; first: boolean }>('arcane/inscribed');

/** The bench that takes a sentence. */
export const SPELL_TABLE = 'spelltable';

/** One unlocked word as the panel lists it. */
export interface WordRow {
  id: string;
  word: string;
  icon: string;
  kind: string;
  minLevel: number;
  /** The Arcana level allows it. */
  usable: boolean;
  /** Its deep forms, spoken twice and three times. */
  stacked: string[];
  /** Distinct inscribed sentences that spoke it. */
  uses: number;
  /** The deepest tier earned (1 to 3). */
  tier: number;
  /** Distinct sentences the next tier needs, or null at the last. */
  nextNeed: number | null;
  /** Its skill: level, XP into the level, XP the level needs. */
  level: number;
  xp: number;
  xpNeeded: number;
  /** What the word skill gives at each milestone, as "stat +value". */
  gift: string;
}

export interface ArcaneView {
  level: number;
  maxWords: number;
  /** What legality reads, for a draft sentence. */
  facts: SpeakerFacts;
  /** `spellKey` of every arcane spell in the book. */
  bookKeys: string[];
  /** The player stands at a Spellcrafting Table. */
  atTable: boolean;
  /** Names of the spots that hold one. */
  tables: string[];
  /** The mana pool ceiling: a sentence dearer than this inscribes and never casts. */
  manaMax: number;
  words: WordRow[];
}

const TABLE_SPOTS = Object.values(SPOTS).filter((spot) => spot.benches?.includes(SPELL_TABLE));

function giftOf(wordId: string): string {
  const bonus = SKILLS[wordSkillId(wordId)]?.milestones?.[0]?.bonus ?? [];
  return bonus.map((m) => `${m.stat} ${m.value >= 0 ? '+' : ''}${+m.value.toFixed(3)}${m.op === 'mult' ? ' (mult)' : ''}`).join(', ');
}

const arcane = defineSystem<Record<string, never>, ArcaneView>({
  id: 'arcane',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { arcane_words: arcaneWords, arcane_text: arcaneText },

  view: (ctx): ArcaneView => {
    const facts = speakerFacts(ctx);
    const held = ctx.read(skills).skills;
    const stats = statBlockOf(ctx) as DerivedStats;
    const spot = ctx.read(world).spot;
    const words: WordRow[] = [];
    for (const w of Object.values(ARCANE_WORDS)) {
      if (!facts.unlocked.includes(w.id)) continue;
      const uses = facts.uses[w.id] ?? 0;
      const tier = tierFromUses(w.id, uses);
      const skill = held[wordSkillId(w.id)];
      const level = skill?.level ?? 0;
      words.push({
        id: w.id,
        word: w.word,
        icon: w.icon,
        kind: w.kind,
        minLevel: w.minLevel ?? 0,
        usable: (w.minLevel ?? 0) <= facts.level,
        stacked: [...(w.stacked ?? [])],
        uses,
        tier,
        nextNeed: w.stacked && tier - 1 < WORD_MASTERY.length ? WORD_MASTERY[tier - 1] : null,
        level,
        xp: skill?.xp ?? 0,
        xpNeeded: skillXpNeeded(wordSkillId(w.id), Math.max(1, level)),
        gift: giftOf(w.id),
      });
    }
    return {
      level: facts.level,
      maxWords: maxSentenceWords(facts.level),
      facts,
      bookKeys: ctx
        .read(spellcraft)
        .grimoire.filter((spell) => spell.source.school === 'arcane')
        .map((spell) => spellKey(spell.source as { school: 'arcane'; words: string[] })),
      atTable: !!SPOTS[spot]?.benches?.includes(SPELL_TABLE),
      tables: TABLE_SPOTS.map((t) => t.name),
      manaMax: availableMax(stats, poolHooks(ctx), 'mana'),
      words,
    };
  },

  commands: [
    handle(inscribe, (ctx, { words }) => {
      if (!Array.isArray(words)) return skipped('the sentence is not a list of words');
      const check = checkInscription(ctx, ctx.read(spellcraft), words);
      if (!check.ok || !check.spec) {
        const reason = check.reason ?? 'These words make no spell';
        ctx.emit(logLine, { msg: fillText(TEXT.locked, { reason }), kind: 'danger' });
        return skipped(reason);
      }
      const source = { school: 'arcane' as const, words: [...words] };
      // Speaking at the table may be what manifests Arcana in the first place.
      ctx.emit(checkDiscovery, { tags: INSCRIBE_TAGS });
      const key = spellKey(source);
      const firstEver = !ctx.read(skills).novelty.arcana?.[key];
      ctx.request(addSpell, { source });
      ctx.emit(bumpCounter, { key: 'spells:inscribed' });
      ctx.emit(grantSkillXp, {
        tags: INSCRIBE_TAGS,
        amount: 14 * (1 + words.length * 0.15),
        // The sentence and every word in it, each wearing down at its own
        // rate. Word keys use the base word; word mastery reads these counts.
        sourceKey: [key, ...spokenWords(words).map(wordNoveltyKey)],
      });
      ctx.emit(inscribed, { key, first: firstEver });
      // Writing a sentence out teaches the grammar and counts toward
      // mastery. It does not practise the words: only a cast does.
      ctx.emit(logLine, { msg: fillText(TEXT.inscribed, { icon: check.spec.icon, name: check.spec.name }), kind: 'item' });
      return OK;
    }),
  ],

  events: [
    // A sentence new to the ledger pays the discovery bonus when Arcana is
    // held after the inscription's XP (held already, manifested by the
    // discovery check, or by the XP it banked). The old `inscribeArcane`.
    on(inscribed, (ctx, event) => {
      if (event.payload.first && ctx.read(skills).skills.arcana) ctx.emit(grantDiscoveryXp, { domain: 'arcana' });
    }),
    // Pay the vocabulary for a casting: every distinct word, the same amount,
    // rising with the bare reading's mana. The old `grantCastWordXp`.
    on(spellPractised, (ctx, event) => {
      const spell = spellOfId(ctx.read(spellcraft), event.payload.id);
      if (spell?.source.school !== 'arcane') return;
      const words = spokenWords(spell.source.words);
      if (words.length === 0) return;
      const amount = wordXpFor(resolveSpell(spell).manaCost);
      for (const id of words) {
        // The whole chain manifests (Arcana and Magic behind the word); the
        // XP goes to the one word skill by name, so Arcana is not paid once
        // per word.
        ctx.emit(checkDiscovery, { tags: [...INSCRIBE_TAGS, wordTag(id)] });
        ctx.emit(grantSkillXpDirect, { skillId: wordSkillId(id), amount });
      }
    }),
  ],
});

export default arcane;
