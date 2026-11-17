# spellcraft

A working in a fight: what a spell source resolves to, and what the resolved
spell does to its target, for monsters and for the player.

Port of: `specForSource`, `spellKey`, `workingSignature`, `leadingElement`,
`undoWorking` of old `systems/spellcraft.ts`; `castMonsterWorking`,
`resolveMonsterWorking`, `castCraftedSelf`, `castCraftedAttack`, miracle
synergy, the counterspell functions (old `combat.ts` 2224 to 2792 and 3229
to 3520); the cast branch of `pickMonsterAction` and the grimoire branch of
`pickActive`.

Section "Design" was written and committed before the code.

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
| `castMonsterWorking`, `resolveMonsterWorking` | `monster.ts`: monster kind `cast`, registered with combat. One kind for every school. |
| Cast branch of `pickMonsterAction` | `available` of that kind: a counterspell is never a turn's action; a working for kin only with no kin standing; a mind in debt; a sealed working. |
| `castCraftedAttack`, `castCraftedSelf`, `miracleSynergy`, `anyAfflicted`, `applySelfRiders` | `player.ts`: player kind `grimoire:`, registered with combat. |
| Grimoire branch of `pickActive` | `pick` of that kind. |
| `pickCounterspell`, `springCounterspell`, `answerPlayerWorking`, `springEnemyCounter`, `counterPayload`, `layBurn` | `counter.ts` |
| `findSpell`, `preparedSpells` | Reads of the slice. |

Waits for step 3 (the arcane, divine and psionic ports):

- Writing the book: `addSpell`, `forgetSpell`, `renameSpell`, `setPrepared`,
  `preparedCap`, the deity conflict at preparation, `hasSpell`.
- The reading in the caster's hands (`resolveSpellFor`: word levels for an
  arcane sentence, the gear bias for a psionic shape). A school may register
  `specFor`; no school does in this port, so the bare reading is used, as
  the old code did for a speaker with no word levels.
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

`registerSchool(school, { spec(source), relation?(a, b), key?(source) })`.

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

## Skip reasons

Filled in with the code.
