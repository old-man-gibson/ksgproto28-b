/**
 * Whether this speaker may speak a sentence, and what speaking teaches. Port
 * of the legality, mastery and vocabulary parts of the old `systems/arcane.ts`
 * (`checkSentence`, `arcaneLevel`, `knownWords`, `WORD_MASTERY`, `wordUses`,
 * `masteredTier`, `wordLevel`, `wordLevels`, `WORD_XP_BASE`), of the starter
 * lexicon of the old `systems/unlocks.ts`, of `maxSentenceWords` of the old
 * `data/spellcraft.data.ts`, and of `wordSkillId`, `wordTag` and
 * `WORD_MILESTONE_LEVELS` of the old `data/wordskills.data.ts`.
 *
 * Everything here reads other systems: the Arcana level and the word levels
 * in `skills`, the novelty ledger of Arcana in `skills`, the word latches in
 * `counters`. The grammar (`grammar.ts`) is never told about any of it: a
 * monster speaks what it likes.
 */
import type { DeepReadonly, SystemDef } from '../../kernel';
import counters, { counterValue } from '../counters';
import skills from '../skills';
import type { SpellSpec } from '../spellcraft';
import { ARCANE_WORD_LIST, ARCANE_WORDS, type ArcaneWordDef } from './defs';
import { composeArcane, parseSentence, splitWordId, type ArcaneParse } from './grammar';

/** Reads of other systems' slices. */
export interface ArcaneReads {
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
}

// ---- the vocabulary as skills ----

/** Skill id of a word. */
export function wordSkillId(wordId: string): string {
  return `word_${wordId}`;
}

/** The tag a sentence emits for each word it spoke. */
export function wordTag(wordId: string): string {
  return `word:${wordId}`;
}

/** Levels at which a word skill grants its gift (the content of the word skills). */
export const WORD_MILESTONE_LEVELS = [10, 25, 45];

/** Base XP one casting pays each word it spoke. */
export const WORD_XP_BASE = 2;

/** How well this speaker knows one word: the level of its skill. */
export function wordLevel(reads: ArcaneReads, wordId: string): number {
  return reads.read(skills).skills[wordSkillId(wordId)]?.level ?? 0;
}

/** Every known word above level 0, in the shape `composeArcane` takes. */
export function wordLevels(reads: ArcaneReads): Record<string, number> {
  const held = reads.read(skills).skills;
  const out: Record<string, number> = {};
  for (const w of ARCANE_WORD_LIST) {
    const level = held[wordSkillId(w.id)]?.level ?? 0;
    if (level > 0) out[w.id] = level;
  }
  return out;
}

/**
 * What one cast pays each distinct word it spoke: rising with the mana the
 * working cost, logarithmically. The amount of the old `grantWordXp`.
 */
export function wordXpFor(manaCost: number, weight = 1): number {
  return WORD_XP_BASE * weight * (1 + Math.log2(1 + Math.max(0, manaCost)));
}

/** The distinct base words of a sentence that exist in the lexicon, in order. */
export function spokenWords(words: readonly string[]): string[] {
  return [...new Set(words.map((w) => splitWordId(w).id))].filter((id) => ARCANE_WORDS[id]);
}

// ---- the starter lexicon ----

/**
 * The words a new life opens with: three elements, three verbs, two
 * adverbs, three targets. Every other word needs its latch
 * (`flag:word:<id>`), set by a find or a word slip.
 */
export const STARTER_LEXICON: ReadonlySet<string> = new Set([
  'fire', 'ice', 'spark',
  'pierce', 'ward', 'mend',
  'quickly', 'slowly',
  'one', 'me', 'others',
]);

export const wordUnlockKey = (wordId: string): string => `flag:word:${wordId}`;

/** May this speaker see and speak the word? A base word id, never a deep form. */
export function wordUnlocked(reads: ArcaneReads, wordId: string): boolean {
  return STARTER_LEXICON.has(wordId) || counterValue(reads.read(counters), wordUnlockKey(wordId)) >= 1;
}

// ---- levels and length ----

export function arcaneLevel(reads: ArcaneReads): number {
  return reads.read(skills).skills.arcana?.level ?? 0;
}

/** Words the mage knows at an Arcana level, by `minLevel` alone. */
export function knownWords(level: number): ArcaneWordDef[] {
  return ARCANE_WORD_LIST.filter((w) => (w.minLevel ?? 0) <= level);
}

/** Most words in one sentence at an Arcana level. */
export function maxSentenceWords(level: number): number {
  return Math.min(8, 3 + Math.floor(level / 8));
}

// ---- mastery ----

/**
 * Distinct inscribed sentences that spoke a word before its deeper forms may
 * be spoken as one word: five for the second tier, fifteen for the third.
 */
export const WORD_MASTERY = [5, 15];

/** The novelty key of an inscribed sentence. */
export const sentenceNoveltyKey = (key: string): string => `arcane:${key}`;
/** The novelty key of a word in an inscribed sentence. */
export const wordNoveltyKey = (wordId: string): string => `arcane:word:${wordId}`;

/**
 * Distinct inscribed sentences that spoke the word, from the novelty ledger
 * of Arcana: one key per sentence ever inscribed, forgotten or not. The old
 * `wordUses`.
 */
export function wordUses(reads: ArcaneReads, wordId: string): number {
  const ledger = reads.read(skills).novelty.arcana ?? {};
  let n = 0;
  for (const key of Object.keys(ledger)) {
    if (!key.startsWith('arcane:') || key.startsWith('arcane:word:')) continue;
    // Collapsed tokens read `fire2`: strip the depth to get the word back.
    if (key.slice(7).split(',').some((t) => t.replace(/\d+$/, '') === wordId)) n++;
  }
  return n;
}

/** The deepest tier of a word this mage may speak as a single word (1 to 3). */
export function masteredTier(reads: ArcaneReads, wordId: string): number {
  return tierFromUses(wordId, ARCANE_WORDS[wordId]?.stacked ? wordUses(reads, wordId) : 0);
}

// ---- legality ----

/**
 * What legality reads of a speaker, as plain data, so the panel can check a
 * draft sentence from the published view: the Arcana level, the unlocked
 * words, the distinct sentences per word, the word levels.
 */
export interface SpeakerFacts {
  level: number;
  unlocked: readonly string[];
  uses: Readonly<Record<string, number>>;
  levels: Readonly<Record<string, number>>;
}

export function speakerFacts(reads: ArcaneReads): SpeakerFacts {
  const uses: Record<string, number> = {};
  for (const w of ARCANE_WORD_LIST) if (w.stacked) uses[w.id] = wordUses(reads, w.id);
  return {
    level: arcaneLevel(reads),
    unlocked: ARCANE_WORD_LIST.filter((w) => wordUnlocked(reads, w.id)).map((w) => w.id),
    uses,
    levels: wordLevels(reads),
  };
}

/** The deepest tier earned, from the facts. */
export function tierFromUses(wordId: string, uses: number): number {
  if (!ARCANE_WORDS[wordId]?.stacked) return 1;
  let tier = 1;
  for (let i = 0; i < WORD_MASTERY.length; i++) if (uses >= WORD_MASTERY[i]) tier = i + 2;
  return tier;
}

export interface SentenceCheck {
  ok: boolean;
  reason?: string;
  spec?: SpellSpec;
  parse?: ArcaneParse;
}

/** Whether this mage may speak this sentence, and what it would make. The old `checkSentence`. */
export function checkSentence(reads: ArcaneReads, wordIds: readonly string[]): SentenceCheck {
  return checkSentenceFor(speakerFacts(reads), wordIds);
}

/** `checkSentence` over the facts of a speaker. */
export function checkSentenceFor(facts: SpeakerFacts, wordIds: readonly string[]): SentenceCheck {
  const level = facts.level;
  if (wordIds.length === 0) return { ok: false, reason: 'The sentence is empty' };
  const max = maxSentenceWords(level);
  if (wordIds.length > max) return { ok: false, reason: `Word limit is ${max} (Arcana ${level})` };
  for (const raw of wordIds) {
    const { id, tier } = splitWordId(raw);
    const w = ARCANE_WORDS[id];
    if (!w) return { ok: false, reason: `No such word: ${raw}` };
    // A locked word is not yours at all, and the refusal does not name what unlocks it.
    if (!facts.unlocked.includes(id)) return { ok: false, reason: `Unknown word: "${w.word}"` };
    if ((w.minLevel ?? 0) > level) return { ok: false, reason: `"${w.word}" needs Arcana ${w.minLevel}` };
    // A deepened word must be earned: spoken enough in its plain form first.
    const uses = facts.uses[id] ?? 0;
    if (tier > 1 && tierFromUses(id, uses) < tier) {
      const name = w.stacked?.[tier - 2] ?? `${w.word} ×${tier}`;
      const need = WORD_MASTERY[tier - 2];
      return { ok: false, reason: `"${name}" not yet earned: inscribe with "${w.word}" (${uses}/${need})` };
    }
  }
  const parse = parseSentence([...wordIds]);
  if (!parse.ok) return { ok: false, reason: parse.reason, parse };
  // The sentence as this speaker would say it, practice and all.
  const spec = composeArcane([...wordIds], { ...facts.levels });
  if (!spec) return { ok: false, reason: parse.reason ?? 'These words make no spell', parse };
  return { ok: true, spec, parse };
}
