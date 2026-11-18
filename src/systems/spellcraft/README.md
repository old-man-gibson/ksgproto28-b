# spellcraft

A working in a fight: what a spell source resolves to, and what the resolved
spell does to its target, for monsters and for the player.

Port of: `specForSource`, `spellKey`, `workingSignature`, `leadingElement`,
`undoWorking` of old `systems/spellcraft.ts`; `castMonsterWorking`,
`resolveMonsterWorking`, `castCraftedSelf`, `castCraftedAttack`, miracle
synergy, the counterspell functions (old `combat.ts` 2224 to 2792 and 3229
to 3520); the cast branch of `pickMonsterAction` and the grimoire branch of
`pickActive`.

Section "Design" was written and committed before the code. The arcane
port (step 3) added the book's writing side, casting outside a fight, the
reading in the caster's hands and the held working: section "Step 3 (the
arcane port)", designed in `src/systems/arcane/README.md` "Step 3 design".

## Design

### The cut

The old law: every school composes to one type, `SpellSpec`, and one
resolution reads it. `specForSource` is the single door. A monster's
authored cast and a spell in the player's book are both a `SpellSource`.

Ported now (spine port 5):

| Old | Here |
|---|---|
| `SpellSpec`, `SpellStrike`, `SpellCounter`, `SpellSource`, `CraftedSpell` | `types.ts` |
| `specForSource`, `spellKey`, the spec cache, the faded inscription | `spec.ts`, over a registry of schools (`registerSchool`). This folder imports no school. |
| `workingSignature`, `leadingElement`, `undoWorking` | `spec.ts` |
| `castMonsterWorking`, `resolveMonsterWorking` | `cast.ts`: monster kind `cast`, registered with combat. One kind for every school. |
| Cast branch of `pickMonsterAction` | `available` of that kind: a counterspell is never a turn's action; a working for kin only with no kin standing; a mind in debt; a sealed working. |
| `castCraftedAttack`, `castCraftedSelf`, `miracleSynergy`, `anyAfflicted`, `applySelfRiders` | `cast.ts`: player kind `grimoire:`, registered with combat. |
| Grimoire branch of `pickActive` | `pick` of that kind. |
| `pickCounterspell`, `springCounterspell`, `answerPlayerWorking`, `springEnemyCounter`, `counterPayload`, `layBurn` | `cast.ts` |
| `counterEfficiency`, `matchCeiling`, the undo constants, `OTHERS_POWER` (old `arcane.ts`) | `counter.ts`: they read a `SpellCounter` and a signature, whatever school made them. |
| `findSpell`, `preparedSpells` | Reads of the slice. |

Waits for step 3 (the arcane, divine and psionic ports):

- Writing the book: `addSpell`, `forgetSpell`, `renameSpell`, `setPrepared`,
  `preparedCap`, the deity conflict at preparation, `hasSpell`.
- The reading in the caster's hands (`resolveSpellFor`: word levels for an
  arcane sentence, the gear bias for a psionic shape). `resolveSpell` in
  `cast.ts` is the one place the player's spell is read; it returns the bare
  reading, which is what the old code gave a speaker with no word levels.
  Step 3 adds the school's contextual reading there.
- Casting outside a fight (`castUtility`).
- Word XP for a cast (`grantCastWordXp`): the arcane port hears
  `spellcraft/cast`.
- The refuting body (`refuteCast`, `isSealed` of old `mutagens.ts`): a
  registered refuter (`registerRefuter`). None is registered, so no working
  is refused or sealed.
- The psionic school. A source of an unregistered school is refused with a
  reason.

### Why nothing ported now is rewritten then

- The resolution functions are ported whole, with every field of
  `SpellSpec` the old ones read (`empowered`, `transfers`, `afflicts`,
  `grants`, `buff`, `heal`, `healsEnemy`, `counter`, alternatives, follow-ups,
  conditioned strikes, twin types, untyped strikes). The two monster
  sentences and the three workings use a part of it; the rest is tested
  through the player kind with a book written by the test.
- The slice holds the book in the old shape. Step 3 adds the commands that
  write it.
- A school plugs in with `registerSchool`. Arcane and divine do in this
  port; psionic does in step 3 without an edit here.

### Slice (version 1)

| Field | Holds |
|---|---|
| `grimoire` | `{ uid, source, name?, prepared? }[]`. Old `state.grimoire`. Empty in a new game. |
| `nextUid` | Counter for `uid`. |
| `casting` | The enemy working being cast: `{ entity, name, school, element?, tick }`. Old `CombatState.casting`. Cleared when a fight closes. |
| `lastMiracle` | `{ deity, tick }`. Old `CombatState.lastMiracle`. Cleared when a fight closes. |

### Schools

`registerSchool(school, { key(source), spec(source), relation?(a, b) })`.

- `spec` composes a source to a `SpellSpec`, or null for a source that no
  longer resolves (the faded inscription: no strikes, 1 mana, 200 ticks).
- `relation` is the standing between two deities, for miracle synergy.
- The cache is keyed by `spellKey`, as before. Content does not change at
  run time.

### A monster's working

`available`, in old order: not a counterspell; kin to tend if the working is
for kin only; the mind not in debt; not sealed. Each refusal but the first
carries a reason.

`perform`: the clock and the supply (`combat/stamp-action`, with the name
and icon for the panel); the refuter; the `casting` stamp and the
`onEnemyCast` mark (`combat/mark-event`); the player's counterspell, if one
is armed; the feed line; the resolution:

- its own side: a mending through `combat/heal-enemy` with `hostile: false`
  on the caster, or on every other living enemy for `target: 'others'`;
  `grants` on the same;
- the player: each strike `spellPower x power x (0.9 to 1.1)`, untyped as
  the rounded number, typed through `incomingSlice` with no bracing;
  `resources/hit` with the monster as the source; riders when the strike
  dealt damage, resisted, with the monster's penetration; then `afflicts`.

A monster pays no pool. `spec.buff` is not read for a monster.

### The player's working

`pick`: old gates in old order (sealed, held, a counterspell, offensive
against the slot, a condition that blocks spells, mana, focus). Not enough
mana or focus is refused with a reason once per fight (old build: silent,
`docs/PITFALLS.md` section 6).

An offensive working is a `cast` that takes the swing's place. A working on
the caster fires from the buff slot. Both pay mana by `manaEff`, focus and
stamina, stamp the clock, meet an enemy's counterspell, then resolve.
Damage lands through `combat/land-slices`: the slices are computed here
(crit, twin type, untyped, penetration), combat applies the target's
conditions' bite, the HP, the ledger and the harvest.

### Events

| Event | When | Payload |
|---|---|---|
| `spellcraft/cast` | A working was cast, by either side, refused or not | `caster`, `id?`, `school`, `name`, `deity?`, `manaCost` |
| `spellcraft/strike-landed` | A strike of the player's working dealt damage | `target`, `type`, `first` |

They replace the direct calls of the old code into systems that are not
ported: `noteTollSpell`, `reactTollGolem`, `facetSignal('miracleCast')`,
`grantCastWordXp`, `onCritLanded`.

### Changed while building

- The monster and player resolutions and the counterspells are one file,
  `cast.ts`: each calls the others.
- `counterEfficiency` and its constants are in `counter.ts` here, not in
  `arcane`: `cast.ts` reads them and this folder imports no school.
- `spellcraft/strike-landed` carries `defId`.
- Two requests of this system to itself were added for its own slice:
  `spellcraft/note-casting` and `spellcraft/note-miracle`.

## Step 3 (the arcane port)

Ported:

| Old | Here |
|---|---|
| `preparedCap`, `BASE_PREPARED`, `PREPARED_PER_LEVELS`, `PREPARED_SCHOOLS` | `book.ts`. The cap reads `legacyPreparedPages` of `prestige` (the boon `grimoire_page`) and the levels of `arcana`, `psionics` and `devotion` in `skills`. |
| `findSpell`, `preparedSpells`, `hasSpell`, `hasDivine` | `book.ts`, over the slice. |
| `setPrepared`, `deityConflict` | Command `spellcraft/set-prepared { uid, prepared }`. The veto reads the divine school's `relation` and the names of the `deities` content. |
| `forgetSpell`, `renameSpell` | Commands `spellcraft/forget { uid }`, `spellcraft/rename { uid, name }`. |
| `addSpell` | Request `spellcraft/add { source, name?, prepared? }`: answers a copy. |
| `isUtilityWorking`, `utilityCooldown`, `canCastUtility`, `castUtility` | `book.ts` and command `spellcraft/cast-utility { uid }`. The clock is the slice's `utilityReady` (version 2), the old `useCooldowns['spell:<uid>']`. |
| `resolveSpellFor` | `cast.ts`: a school's optional `reading(reads, source)`, else the bare reading. The arcane school reads the word levels; psionic will read the gear bias. |
| `grantCastWordXp` call sites | Event `spellcraft/practised { id }`, emitted where the old code called it: the XP of a self cast, of an offensive cast, of a counterspell's spring. |
| `spellIsHeld` in the pick and in `pickCounterspell` | `registerHeldSpell(reader)`, registered by `martial`; `heldSpell(reads)`. |
| `specLines`, `targetLabel` (old `ui/lib/format.ts`) | `lines.ts`, short form: "Label: fact" lines. |

Slice version 2: adds `utilityReady: Record<string, number>` (uid to the
clock tick it may be cast outside a fight again). Migration step 1 adds
`{}`. Fixture `tests/fixtures/spellcraft/v2.json`.

The view: `prepared` (uids), `cap`, `book` (one row per spell: name, icon,
school, source text, prepared, mana and cooldown in the caster's hands, the
wait and the reason it cannot be cast outside a fight now).

Combat now reads a prepared spell through `resolveSpellFor` (the pick, the
counterspell pick), as the old `pickActive` did. `readyableSpell` (martial)
and the veto read the bare `resolveSpell`, as the old code did.

### Left behind (step 3)

- The title that defies dogma, `learnMiracle` and favour: done in the
  divine port (below).
- `shapePsionic`, the psionic school and its `reading`: psionic.
- Loadouts that re-prepare spells: the UI step (the old `applyLoadout`
  called `setPrepared`).
- The refuting body (`registerRefuter`): mutagens.

### Old rules ported as they are (step 3)

- `isUtilityWorking` counts grants and a heal of the caster only. A ward
  (a buff, `spec.buff`) cannot be cast outside a fight, though the old
  comment named "a haste, a ward, a mending".
- Casting outside a fight checks no condition that blocks spells, and pays
  no word XP and no Intelligence XP: 3 skill XP to `['magic', school]`.
- The tutorial's spell is written prepared with no cap check, as the old
  direct write.
- `forgetSpell` leaves a rotation entry and a held working that name the
  uid; both are inert.

### Skip reasons (step 3)

| Command | Skip reasons |
|---|---|
| `spellcraft/set-prepared` | no spell has the uid; all <cap> prepared pages are in use (also the log line "🔒 Prepared spell limit is <cap>."); "<deity> refuses to share a page with <deity>." (also a log line) |
| `spellcraft/forget`, `spellcraft/rename` | no spell has the uid |
| `spellcraft/cast-utility` | No such spell; <name> needs a target; In combat: prepare it instead; <name> on cooldown; Not enough mana; Not enough focus. Each also a log line "🔒 <reason>". |

## Step 3 (the divine port)

- `spellcraft/set-prepared` skips the deity veto while the player's fact
  `defiesDogma` is 1. The `titles` source states it while a title with
  `defiesDogma` is worn (`iconoclast`). The old `dogmaDefied`. This system
  reads the fact through `factValue` and imports nothing of `titles`.
- `divine/learn` writes a miracle through `spellcraft/add`, unprepared.
- The old veto case ("hostile deities refuse to share a prepared page,
  unless dogma is defied") runs in `tests/spellcraft.test.ts`.

## Files

| File | Holds |
|---|---|
| `book.ts` | The prepared cap, the book reads, casting outside a fight, the veto. |
| `lines.ts` | A spell as "Label: fact" lines. |
| `content/spellcraft_text.json` | Log templates. |
| `types.ts` | `SpellSpec` and its parts, `SpellSource`, `CraftedSpell`, `spellSpecSchema` for a spell stated in content. |
| `spec.ts` | The school registry, `specForSource`, `spellKey`, `sourceIssue`, the signature, `undoWorking`. |
| `counter.ts` | `counterEfficiency` and its constants. |
| `state.ts` | The slice, the two events, the requests to itself, the refuter registry. |
| `cast.ts` | The resolutions, the counterspells, the two registrations with combat. |
| `index.ts` | The declaration and the two trigger subjects `enemy.castSchool`, `enemy.castElement`. |

## Skip reasons

All through `combat/rotation`, once per fight, entry and reason.

- A monster's cast entry: no system has registered the school; the source
  does not resolve to a spell; the working is for its kin only and no kin is
  standing; its mind is in debt; the working is sealed for this fight.
- The player's `grimoire:<uid>`: the spell is sealed for this fight; the
  school is not registered or the source does not resolve; a condition
  blocks casting; not enough mana; not enough focus.

Not a skip: the clock, a counterspell waiting for a casting, a spell that is
not prepared, the slot.

## Old rules ported as they are

- The damage of the player's working is not written to the fight ledger's
  `outgoing`. The old `castCraftedAttack` called `noteOutgoing` for the
  graft harvest only; a weapon blow writes its damage. The spill of a
  working is not written either.
- The spill of a working takes HP off the flanker and tells its conditions
  nothing.
- A monster's working is not dodged, shrouded, walled or parried, and the
  player's bracing does not apply to it (`incomingSlice` with no bonus
  armour).
- A strike of a monster's working is rounded with a floor of 1 per landing,
  so the three hits of Vermin Swarm deal at least 1 each.
- `afflicts` of a monster's working are applied after the check that the
  player still stands; riders of a strike before it.
- Miracle synergy records the cast also when nothing resonates, so a
  neutral or hostile miracle between two friendly ones breaks the chain.
- The feed line of `empowered` and of `transfers` says "poison" whatever
  conditions the spell names.
- A cast's XP is not paid when the per-attack retaliation of a condition
  leaves the player at 0 HP.

## Differences from the old build

- A spell that cannot be paid for, that a condition blocks or that is
  sealed is reported in the skip log. The old build passed it over silently
  (`docs/PITFALLS.md` section 6).
- The dead are swept by the tick after the handler returns, not inside the
  cast. A counterspell's payload that kills is processed at the same point
  of the tick as the old sweep that followed it.
- The player's own burn from "undo me" and a monster's burn go through
  `statuses/apply` with `resist: true`; a monster always resists, as before.
- `noteTollSpell`, `reactTollGolem`, `facetSignal`, `grantCastWordXp` and
  `onCritLanded` are not called: their systems hear `spellcraft/cast`,
  `spellcraft/strike-landed` and `combat/hit` when they are ported.
