# arcane

The arcane grammar: a sentence of words composed into a spell.

Port of: the word registry of old `data/spellcraft.data.ts` (`ARCANE_WORDS`),
`parseSentence`, `composeArcane`, `counterEfficiency`, `matchCeiling`,
`splitWordId`, `displayWord` and the tuning constants of old
`systems/arcane.ts`.

Section "Design" was written and committed before the code.

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
| `composeArcane`, every conjunction, adverb position rule, ward, mending, undoing and stacking rule, the signature | `compose.ts` |
| `counterEfficiency`, `matchCeiling`, the undo constants | `counter.ts` |
| `wordBonusFor`, `WORD_POWER_PER_LEVEL` | `compose.ts`. `composeArcane` keeps the `levels` argument. |
| The arcane case of `specForSource` and of `spellKey` | Registered with `spellcraft` (`registerSchool('arcane')`). |

Waits for step 3 (the arcane port):

- `checkSentence`, `maxSentenceWords`, word unlocks, `minLevel` gates.
- Word mastery (`wordUses`, `masteredTier`, `WORD_MASTERY`).
- Word skills and `wordLevels`, `grantWordXp`.
- Inscription (`inscribeArcane`, `checkInscription`) and the bench.

### Why nothing ported now is rewritten then

- `composeArcane(words, levels?)` has the old signature. Step 3 passes the
  speaker's word levels through `specFor` of the school registry.
- The legality checks call the parser and the composer; they do not change
  them.
- No state: this system's slice is empty. Step 3 adds the novelty ledger
  and the word unlocks with a version bump.

### No rolls

The composer has no random draw. The same words in the same order give the
same spell.

## Skip reasons

None: this system has no command, no request and no tick. A sentence that
does not parse composes to null and `spellcraft` reads it as a faded
inscription.
