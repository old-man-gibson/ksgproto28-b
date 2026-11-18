# arcane

The arcane school: the grammar that composes a sentence of words into a
spell, who may speak which sentence, inscription at the Spellcrafting
Table, word mastery, and the word skills worn in by casting. The panel
`ArcanePanel.svelte` also shows the grimoire of `spellcraft`.

Port of: the word registry of old `data/spellcraft.data.ts` (`ARCANE_WORDS`,
`maxSentenceWords`), all of old `systems/arcane.ts`, the arcane half of old
`systems/spellcraft.ts` (`checkInscription`, `inscribeArcane`,
`grantCastWordXp`, the arcane case of `resolveSpellFor`), the starter
lexicon of old `systems/unlocks.ts`, `wordSkillId`, `wordTag` and
`WORD_MILESTONE_LEVELS` of old `data/wordskills.data.ts` (the word skills
themselves are `skills` content since spine port 3). Spine port 5 ported
the grammar; step 3 the rest.

Sections "Design" (port 5) and "Step 3 design" were written and committed
before their code.

## Design

### The cut

Evaluating the two monster sentences (`quickly fire pierce`, `fire pierce`)
needs the parser, the clause reader, the adverb rules, the stack tables and
the word records. The composer is one pure function with no state; there is
no smaller part of it that reads a sentence. The whole grammar engine and
the whole word registry are therefore ported now. What is left is the part
that decides whether this player may speak a sentence and what speaking it
teaches.

Ported now (spine port 5):

| Old | Here |
|---|---|
| `ARCANE_WORDS` | Content `arcane_words`, whole. `art` is a file name. |
| `parseSentence`, `ArcaneParse`, `ArcaneClause`, `SpokenWord`, `displayWord`, `splitWordId` | `grammar.ts` |
| `composeArcane`, every conjunction, adverb position rule, ward, mending, undoing and stacking rule, the signature | `grammar.ts` |
| `counterEfficiency`, `matchCeiling`, the undo constants | `src/systems/spellcraft/counter.ts`: they read a counter and a signature of any school. |
| `wordBonusFor`, `WORD_POWER_PER_LEVEL` | `grammar.ts`. `composeArcane` keeps the `levels` argument. |
| The arcane case of `specForSource` and of `spellKey` | Registered with `spellcraft` (`registerSchool('arcane')`). |

Waits for step 3 (the arcane port):

- `checkSentence`, `maxSentenceWords`, word unlocks, `minLevel` gates.
- Word mastery (`wordUses`, `masteredTier`, `WORD_MASTERY`).
- Word skills and `wordLevels`, `grantWordXp`.
- Inscription (`inscribeArcane`, `checkInscription`) and the bench.

### Why nothing ported now is rewritten then

- `composeArcane(words, levels?)` has the old signature. Step 3 passes the
  speaker's word levels from `resolveSpell` of `spellcraft`, the one place a
  spell is read in the caster's hands.
- The legality checks call the parser and the composer; they do not change
  them.
- No state: this system's slice is empty. Step 3 adds the novelty ledger
  and the word unlocks with a version bump.

### How the code was ported

`grammar.ts` is written by `scripts/port-arcane.py`: it copies the code of
the named line ranges of the old `systems/arcane.ts`, drops the old
comments, changes the imports and one text lookup, and adds new comments.
The parser and the composer are therefore the old statements, unchanged.
Run it again only against the old file it was written from.

Content: `content/arcane_words.json` (40 words), written by
`node scripts/convert-content.mjs arcane_words`.

### No rolls

The composer has no random draw. The same words in the same order give the
same spell.

## Step 3 design

Written before the code (2026-11-17). Old sources read at `7c1267b`:
`systems/arcane.ts` (the parts port 5 left: lines 1 to 68, 105 to 285,
343 to 357, 992 to 1041), `systems/spellcraft.ts` (all of it),
`systems/unlocks.ts` (the starter lexicon), `data/wordskills.data.ts`,
`maxSentenceWords` of `data/spellcraft.data.ts`, `systems/tutorial.ts` and
`data/tutorial.data.ts` (the spell step), the readied spell of
`systems/martial.ts` (848 to 905) and of `systems/combat.ts` (the buff slot
4160 to 4200, `fireCounter` 2150 to 2185, `pickActive` 2027 to 2045,
`pickCounterspell` 2570 to 2590, the close 5338), `game.ts` (the spellcraft
methods), `data/npcs.data.ts` and `text/npcs.text.ts` (`lectory_wizard`),
`data/quests.data.ts`, `ui/panels/SpellcraftPanel.svelte`,
`ui/panels/LocationPanel.svelte` (the Spellcrafting Table), `tests/john.ts`,
and the test files `spellcraft.test.ts`, `onboarding.test.ts`,
`tutorial.test.ts`, `martial.test.ts`, `prestige.test.ts`,
`antimagic.test.ts`, `john.test.ts`.

### What is ported, and where

| Old | Here |
|---|---|
| `checkSentence`, `SentenceCheck`, `arcaneLevel`, `knownWords`, `maxSentenceWords` | `legal.ts` in this folder. Reads `skills` (Arcana level) and `counters` (`flag:word:<id>`). |
| `STARTER_LEXICON`, `wordUnlockKey`, `wordUnlocked` (old `unlocks.ts`) | `legal.ts`. The latch stays the counter `flag:word:<id>`, so a find or a word slip (consumables port) unlocks a word by setting a counter. |
| `WORD_MASTERY`, `wordUses`, `masteredTier` | `legal.ts`. `wordUses` reads the novelty ledger of the skill `arcana` in the `skills` slice (the old `state.novelty.arcana`): same keys, same count. |
| `wordLevel`, `wordLevels`, `grantWordXp`, `WORD_XP_BASE`; `wordSkillId`, `wordTag` | `legal.ts` and the event handler below. The 40 word skills are content of `skills` already (spine port 3); `WORD_MILESTONE_LEVELS` is their data. |
| `checkInscription`, `inscribeArcane` | Command `arcane/inscribe { words }` in this folder. |
| `grantCastWordXp` | This system hears a new `spellcraft` event `spellcraft/practised { id }`, emitted at the three points where the old code called `grantCastWordXp`: the XP of a self cast, of an offensive cast, and of a counterspell's spring. |
| `resolveSpellFor` (the arcane case: word levels) | `registerSchool('arcane', { reading })`: a new optional member of a school, `reading(reads, source)`, the spec as this speaker reads it. `resolveSpellFor(reads, spell)` in `spellcraft` asks it. |
| `preparedCap`, `BASE_PREPARED`, `PREPARED_PER_LEVELS`, `PREPARED_SCHOOLS`, `addSpell`, `forgetSpell`, `renameSpell`, `setPrepared`, `deityConflict`, `hasSpell`, `hasDivine`, `findSpell`, `preparedSpells` | `spellcraft` (`book.ts`). `preparedCap` reads `legacyPreparedPages` of `prestige` (the boon `grimoire_page`, sold since port 7). |
| `isUtilityWorking`, `utilityCooldown`, `canCastUtility`, `castUtility` | `spellcraft` (`book.ts`), command `spellcraft/cast-utility { uid }`. |
| `chooseTutorialSpell`, `TUTORIAL_SPELLS`, `TUTORIAL_SPELL_INT` | `tutorial/choose-spell { word }` in `tutorial`. The step reader stops passing over the spell step (`WAITING_CHOICES` becomes empty). |
| `readyableSpell`, `spellIsHeld`, `releaseReadiedSpell`, the seat dropping the working, the Ready Spell form, the Spell Parry delivery | `martial` (readied spells), with two registrations: `registerHeldSpell` in `spellcraft` (the player kind and the counterspell pick pass over a held working) and `registerPositionWatch` in `combat` (the old `setPosition` dropped the working when the player left the seat). |
| `lectory_wizard` (Docent Marell, the Reading Hall, talk only) | A record in `npcs` content and its text. |
| The Spellcrafting Table (`benches: ['spelltable']`) | The arcane panel shows the sentence bench while the player stands at a spot whose `benches` holds `spelltable`. The command does not check the spot: old `inscribeArcane` did not either. |

### Slices

| Slice | Version | Change |
|---|---|---|
| `arcane` | 1 | None. Everything this system reads lives in `skills`, `counters` and `spellcraft`. |
| `spellcraft` | 2 | Adds `utilityReady: Record<string, number>`: grimoire uid to the clock tick it may be cast outside a fight again. The old `state.useCooldowns['spell:<uid>']`; the shared `useCooldowns` map is not ported (consumables), so the spell clock is this slice's own. Step 1 adds `{}`. Fixture `tests/fixtures/spellcraft/v2.json`. |
| `martial` | 2 | None: `readiedSpell` is in the slice since the martial port. |

### Commands

| Command | Old | Notes |
|---|---|---|
| `arcane/inscribe { words }` | `inscribeArcane` | Discovery `['spellcraft', 'magic', 'arcane']`; the spell through `spellcraft/add`; `counters/bump spells:inscribed`; skill XP `14 x (1 + 0.15 x words)` to those tags with the novelty keys `[arcane:<key>, arcane:word:<id>...]`; discovery XP of the domain `arcana` the first time a key is seen, when Arcana is held after the discovery; the log line. |
| `spellcraft/set-prepared { uid, prepared }` | `setPrepared` | The cap, then the deity conflict (relation through the divine school's `relation`, names from the `deities` content). The title that defies dogma is not ported (titles); the veto always applies. |
| `spellcraft/forget { uid }` | `forgetSpell` | |
| `spellcraft/rename { uid, name }` | `renameSpell` | An empty name drops the name. |
| `spellcraft/cast-utility { uid }` | `castUtility` | Mana by `manaEff`, focus, the clock, `grants` through `statuses/apply`, the heal through `resources/heal-now` kind `spell` at `heal x spellPower`, the log line, discovery and 3 skill XP to `['magic', school]`. No word XP: the old one paid none. |
| `tutorial/choose-spell { word }` | `chooseTutorialSpell` | `spellcraft/add` with `prepared: true` (no cap check, as the old direct write), INT XP up to level 2, the flag, the log line. |

### Requests and events

New:

- `spellcraft/add { source, name?, prepared? }` (request): writes a spell,
  answers a copy with its `uid`. For `arcane/inscribe`, the tutorial, and
  the divine and psionic ports.
- `spellcraft/practised { id }` (event): a grimoire working paid its cast XP.
- `martial/hold-spell { uid }` (request, martial to itself from the
  combat context of its kinds): sets or clears `readiedSpell`.
- `combat`: `registerPositionWatch(fn)`, called inside `setPlayerPosition`
  with the old and new position, in the handler that moved the player.
- `spellcraft`: `registerHeldSpell(fn)`, `registerSchool(..., { reading })`.

Used: `skills/check-discovery`, `skills/grant-xp`, `skills/grant-xp-direct`,
`skills/grant-discovery-xp`, `counters/bump`, `attributes/grant-xp`,
`resources/spend-now`, `resources/heal-now`, `statuses/apply`,
`combat/stamp-cooldown`, `combat/move-player`, `log/line`, `log/feed`.

Heard: `spellcraft/practised` (arcane: word XP), `combat/fight-closed`
(martial: drop the held working).

### The readied spell

- Ready Spell (`readiesSpell`): the defensive-form path of the martial
  player kind. When no prepared working can be held and paid for, the form
  does not come; here that is a reason in the skip log, once per fight
  (old: silent). Else, in the cast: mana spent now (`readyableSpell` reads
  the bare spec, as the old), `martial/hold-spell`, the buff, the stamina,
  the clock, the exit, the feed line, the rung, 2 DEX XP and 3 skill XP.
- Spell Parry (`deliversSpell`): the interception's `fire`: release, the
  clock, the displaced exit, the rung, 3 INT XP and 3 skill XP to
  `['combat', 'magic']`, then the held working through `castCraftedAttack`
  with the rotation id `technique:<id>` and the spec read in the caster's
  hands. The old code paid the working's mana again there and stamped the
  working's cooldown on the technique's id over the technique's own; both
  are ported as they are.
- The seat: leaving `spell_ready` releases the working (position watch). A
  fight that closes releases it. The mana is not refunded.
- A held working is passed over by the rotation and by the counterspell
  pick (`registerHeldSpell`).

### Panel

`arcane/panel.ts`, "Arcane". Blocks with reserved heights:

- Grimoire: `prepared / cap`, one row per spell (name, sentence, mana and
  cooldown, a prepare switch). A row opens on click: rename, cast outside a
  fight (with the reason when it cannot), forget.
- Table: shown at a spot with the Spellcrafting Table, else one line saying
  where the tables are. The sentence strip (`n / max` words, a tap removes a
  word), the lexicon by kind (only unlocked words; a word above the Arcana
  level is shown disabled with its level), the check line (the reason, or
  the spec as "Label: fact" lines in a box of fixed height), Inscribe, Clear.
- Words: each unlocked word with its level, its XP bar, its mastery
  (distinct sentences, next tier) and its gift.

No hover cards. Phone layout: one column, tap targets at `--tap`.

### John

The rack climbs of `tests/john.test.ts` take the spell `fire` at the Field,
as the old ones. The skipping John (pacing, outcome digests of the John
climbs) does not play floor 0 and does not change; the state hash of the
budget runs changes with the spellcraft slice, and those digests are
recorded again in their own commit.

### Waits for a later port

- `faces_of_threshold` and `a_taste_of_everything` (`spells:inscribed` is
  bumped already): the last of the six system people.
- Word slips (`consumable.unlocksWord`): the consumables port sets
  `flag:word:<id>`.
- Divine: `learnMiracle` and the favour; the deity conflict is ported here
  with the book, and its test waits for `learnMiracle`.
- Psionic: `shapePsionic`, the gear bias reading (`reading` of the psionic
  school), `utility` for psionic workings.
- The title that defies dogma (titles).
- The yShicna miracles that act on words.
- The drag-to-reorder sentence strip and the word merge gestures of the old
  bench: the UI step. Deep forms are typed by tapping the word again when
  its tier is earned.

### Changed while building (step 3)

- Legality reads a plain object, `SpeakerFacts` (Arcana level, unlocked
  words, distinct sentences per word, word levels), built by
  `speakerFacts(reads)`. `checkSentence(reads, words)` is
  `checkSentenceFor(speakerFacts(reads), words)`. The view publishes the
  facts and the keys of the book, so the panel checks a draft sentence with
  the same function and never reads state.
- The discovery bonus of an inscription (`skills/grant-discovery-xp` of the
  domain `arcana`) was decided before the XP grant at first. The old code
  decided it after the grant, and the grant itself can manifest Arcana from
  banked XP (Arcana manifests by XP: its unlock is an attribute condition).
  A new event `arcane/inscribed { key, first }`, emitted after the grant,
  is heard by this system, which pays the bonus when Arcana is held then.
  Checked against the old build with a scratch script that imports the old
  modules (nothing in the old repository written): after the floor 0 spell
  and one inscription of "ice pierce quickly" at Intelligence 2, both builds
  hold Arcana 5 with 18.248 XP and Magic 1 with 0.706 XP; after a second
  sentence, Arcana 8 with 1.921 XP. One cast of each spell pays the same
  word XP to the digit (fire 5.273, ice, pierce, quickly 6.777 each).
- The deep forms are offered as their own buttons (the second and third
  tier names) once earned, not by merging tiles.
- Files: `legal.ts` (legality, mastery, the vocabulary), `index.ts`
  (registration, inscription, the view). The design named no files.

## Left behind

- `faces_of_threshold` and `a_taste_of_everything`: the last of the six
  system people. `lectory_wizard` is in `npcs`; `spells:inscribed` is
  bumped.
- Word slips (`consumable.unlocksWord`, the material `word_slip_stone`):
  the consumables port. It sets the counter `flag:word:<id>`.
- The yShicna miracles that act on words: divine.
- Compound words: shelved in the old build (`docs/LONGTERM.md`), not
  ported.
- The drag-to-reorder sentence strip, tile merging, the folded word cards
  and the full spell card of the old interface (`specLines` with condition
  totals and overgrowth thresholds): the UI step. `specLines` of
  `spellcraft` is a short form.
- The tutorial card's spell buttons were not looked at in a browser: the
  dev save had passed floor 0. The view that feeds them is tested.

## Old rules ported as they are

- Arcana manifests from the XP an inscription banks, whatever the
  Intelligence (its unlock is an attribute condition, and banked XP
  manifests a skill whose conditions are all attributes). The floor 0
  player at Intelligence 2 who inscribes one three-word sentence holds
  Arcana 5. The skill's description says "Manifests at Intelligence 10".
- An inscription that the table refuses (unknown word, level, length,
  unearned deep form, already written) logs the reason; one that runs pays
  no word XP. Only a cast pays word XP, and only the cast's XP points pay
  it: a working refused by a refuting body, or a cast whose retaliation
  leaves the player at 0 HP, pays none.
- Word XP is read from the bare reading's mana (`resolveSpell`), not the
  reading in the speaker's hands.
- The starter lexicon test of the old `onboarding.test.ts` checked that a
  refusal does not contain "do not know the word", a phrase no text has
  had since the refusal became "Unknown word". The case here checks
  against "Unknown word".

## Skip reasons

Command `arcane/inscribe { words }`, each also a log line "🔒 <reason>":

- the sentence is not a list of words;
- The sentence is empty;
- Word limit is <max> (Arcana <level>);
- No such word: <id>;
- Unknown word: "<word>" (its latch is not set);
- "<word>" needs Arcana <level>;
- "<deep form>" not yet earned: inscribe with "<word>" (<uses>/<need>);
- the grammar's own refusal (`parseSentence`), or "These words make no
  spell";
- Already in your grimoire. Change or add a word to inscribe a new spell.

No tick. A sentence that does not parse composes to null and `spellcraft`
reads it as a faded inscription.

## Files

| File | Holds |
|---|---|
| `defs.ts` | The word registry and its record type. |
| `grammar.ts` | The parser and the composer (port 5, written by `scripts/port-arcane.py`). |
| `legal.ts` | Legality over `SpeakerFacts`, the starter lexicon, mastery, word levels and word XP. |
| `index.ts` | The school registration, `sentenceKey`, `checkInscription`, the command and events, the view. |
| `ArcanePanel.svelte`, `panel.ts` | The panel. |
| `content/` | `arcane_words.json` (40), `arcane_text.json`. |
