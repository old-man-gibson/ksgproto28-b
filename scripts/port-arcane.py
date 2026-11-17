"""Port the grammar half of the old arcane.ts: copy the code of the named
line ranges, drop the old comments, and apply the import and text changes.
The old file is read only."""
import re

old = open('D:/ksgproto28/src/core/systems/arcane.ts', encoding='utf-8').read().split('\n')


def take(a, b):
    return old[a - 1:b]


def strip_comments(lines):
    text = '\n'.join(lines)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    out = []
    for line in text.split('\n'):
        if re.match(r'^\s*//', line):
            continue
        line = re.sub(r'\s+// .*$', '', line)
        out.append(line.rstrip())
    # collapse runs of blank lines
    res = []
    for line in out:
        if line == '' and res and res[-1] == '':
            continue
        res.append(line)
    return '\n'.join(res).strip('\n')


parts = [
    ('tuning', strip_comments(take(69, 75) + take(80, 104))),
    ('tokens', strip_comments(take(286, 342))),
    ('parse', strip_comments(take(358, 471))),
    ('compose', strip_comments(take(475, 991))),
]
code = {k: v for k, v in parts}

for k in code:
    c = code[k]
    c = c.replace("text('arcane.reason.no_noun_or_verb')", "'A spell needs a noun or a verb'")
    c = c.replace('let wardMods: Modifier[] = [];', 'let wardMods: ContentMod[] = [];')
    code[k] = c

header = '''/**
 * The arcane grammar: a sentence of word ids parsed into clauses and composed
 * into a spell. Port of `parseSentence`, `composeArcane`, `splitWordId`,
 * `displayWord` and the tuning constants of the old `systems/arcane.ts`,
 * written by `scripts/port-arcane.py` from that file: the code is the old
 * code; the comments are new.
 *
 * Rules, in the order the composer reads them:
 *
 * - Words group into clauses. A clause holds one noun and one verb; a second
 *   noun or a second verb closes the clause and opens the next.
 * - Whichever core word came first leads the clause. Verb-led: power x0.85,
 *   mechanics (penetration, splash, grip, ward) x1.3. Noun-led: power x1.15,
 *   mechanics x0.8. A noun with no verb: power x0.8.
 * - An adverb belongs to the clause open when it is read. Before the core it
 *   is leading, after it trailing; `hits`, `crit` and `clock` read the
 *   position.
 * - A target word belongs to no clause; the last one spoken addresses the
 *   spell.
 * - A conjunction closes the clause before it and binds the one after:
 *   `then` (follow-through), `and` (fuse), `but` (transmute), `or`
 *   (alternatives), `if` (condition), `with` (accompany).
 * - Clause i that is not linked lands at share 1 / (1 + 0.5 i).
 * - A word repeated in a row deepens: power x1, x2.3, x3.9 and mana x1, x3,
 *   x6 for one, two and three. A fourth does not parse.
 *
 * There is no random draw: the same words in the same order give the same
 * spell.
 */
import type { SpellSpec, SpellStrike, SpellTarget } from '../spellcraft';
import { RES_STAT_BY_TYPE, type ContentMod, type DamageType } from '../stats';
import { STATUSES, type StatusApplication } from '../statuses';
import { ARCANE_WORDS, type ArcaneWordDef } from './defs';

// ---- tuning ----

'''

mid1 = '''

/** Sending a spell to `others` costs this multiple of its mana. */
export const OTHERS_MANA_MULT = 1.5;
/** How much of its own strength a word adds per level of its word skill, compounding per clause. */
export const WORD_POWER_PER_LEVEL = 0.015;

/** What one word's practice is worth to the clause it sits in. `levels` is absent for the bare reading. */
export function wordBonusFor(levels: Record<string, number> | undefined, wordId: string): number {
  return 1 + WORD_POWER_PER_LEVEL * (levels?.[wordId] ?? 0);
}

/**
 * The conditions a noun's signature affliction can be recognised as: the
 * inflicted ids and everything they escalate into.
 */
function signatureStatuses(apps: { id: string }[] | undefined): string[] {
  const out: string[] = [];
  for (const app of apps ?? []) {
    let id: string | undefined = app.id;
    while (id && !out.includes(id)) {
      out.push(id);
      id = STATUSES[id]?.escalatesTo;
    }
  }
  return out;
}

// ---- tokens ----

'''

body = (
    header
    + code['tuning']
    + mid1
    + code['tokens']
    + '\n\n// ---- parsing ----\n\n/** Read a sentence into clauses. Grammar only: no legality check beyond the words existing. */\n'
    + code['parse']
    + '\n\n// ---- composing ----\n\n'
    + code['compose']
    + '\n'
)
# OTHERS_MANA_MULT and OTHERS_POWER were in the tuning block of the old file.
body = body.replace('export const OTHERS_MANA_MULT = 1.5;\nexport const OTHERS_POWER = 0.5;\n', '')
DOCS = {
    'export const VERB_LED': 'How much the leading word of a clause dominates it.',
    'export const UNSHAPED_POWER': 'A noun spoken with no verb.',
    'export const clauseShare': 'Clause i (from 0) that is not linked lands at this share.',
    'export const BASE_COOLDOWN': 'Base cooldown in ticks, before verbs and adverbs.',
    'export const COOLDOWN_RANGE': 'The cooldown is held inside this range.',
    'export const MAX_STACK': 'A word may be spoken at most this many times in a row.',
    'export const INTENSITY_FLOOR': 'A dimmed condition keeps at least this share of its intensity.',
    'export const STACK_POWER': 'Power of a word spoken one, two and three times in a row.',
    'export const STACK_MANA': 'Mana of a word spoken one, two and three times in a row.',
    'export const EVERYTHING_SPLASH': 'Raw splash at which a working addresses every enemy.',
    'export function splitWordId': "A sentence token: 'fire' is tier 1, 'fire:2' is the word two deep.",
    'export interface SpokenWord': 'One token of a sentence: a word and how many times in a row it was said. `preCore` marks an adverb spoken before the noun and the verb of its clause.',
    'export function displayWord': 'What a token reads as: the word, or what repetition made of it.',
    'export interface ArcaneClause': 'One clause as the composer read it. `linked` is the conjunction that bound it to the clause before.',
    'export interface ArcaneParse': 'A parsed sentence.',
    'function scaleInflicts': 'Scale the intensity of applications, keeping their chance.',
    'function scaleChance': 'Scale how readily conditions take hold. Capped at 0.95.',
    'function shapeConditions': 'Stretch or compress how long inflicted conditions run and scale their intensity. A condition with no lifetime of its own is left alone.',
    'type Acting': 'What `with` can accompany: the last clause that acted.',
}
for needle, doc in DOCS.items():
    assert body.count(needle) == 1, needle
    body = body.replace(needle, '/** ' + doc + ' */\n' + needle)
body = body.replace(
    "export function composeArcane(",
    "/**\n * Compose a sentence into a spell, or null when it does not parse. Pure.\n * `levels` is how well the speaker knows each word (step 3); absent, the\n * bare reading.\n */\nexport function composeArcane(",
)
open('D:/ksgproto28-b/src/systems/arcane/grammar.ts', 'w', encoding='utf-8', newline='\n').write(body)
print(len(body.split('\n')), 'lines')
