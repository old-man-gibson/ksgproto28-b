# martial

Techniques in a fight: the registry, the position rules and the execution of
a technique from a rotation, for monsters and for the player.

Port of: the execution half of old `systems/martial.ts`, the technique and
position registries of `data/martial.data.ts`, the technique branches of
`pickActive`, `pickMonsterAction` and the buff slot in `systems/combat.ts`,
`pickCounter` and `fireCounter` (old `combat.ts` 2095 to 2222).

Section "Design" was written and committed before the code.

## Design

### The cut

The old module is two things in one file. One half answers "what does this
technique do when it fires, and can it fire from here": that half runs in a
fight and is the same for a monster and the player. The other half answers
"how did the player come to hold it, and how has practice changed it": the
ledger, the planner and the teachers.

Ported now (spine port 5):

| Old | Here |
|---|---|
| `TECHNIQUES` (29), `POSITIONS` (7), `FORK_ARCHETYPES` (8) | Content, whole. `skill`, `family`, `requiresSheathed` and the unlock conditions point at registries of other ports and are plain strings or the counters condition schema. |
| `declaredEntries`, `declaredPositions` | `entries.ts` |
| `techniqueEntries`, `entryPositions`, `openEntry`, `techniqueExit`, `resolvedMove`, `techniqueArmed`, `weaponStateGate` | `entries.ts`, `move.ts`: each takes the ledger entry of the technique. With an entry at 0 executions, form `canonical` and no path, each returns what the registry declares. |
| Technique branch of `pickMonsterAction`; the technique block of the enemy phase | Monster kind `technique`, registered with combat. |
| Technique branches of `pickActive` (strike on the action bar, defensive form in the buff slot); the technique fields of the player attack | Player kind `technique:`, registered with combat. |
| `pickCounter`, `fireCounter` | An interception, registered with combat (`registerInterception`). |
| `positionIncomingMult`, `positionDodgeMult` | Source `martial/position`: moves `combat/positionIncomingMult` and `combat/positionDodgeMult` by the position the player stands in. |
| `watchStatKey` | `seen:technique:<id>` is the `watchKey` of a monster shape. Combat bumps it. |

Waits for step 3 (the martial port):

- Writing the ledger: `learnTechnique`, `checkTechniqueLearning` (self and
  watch counters), teachers and lessons, `eligibleToLearn`.
- Slots, the bench, drilling, `recordExecution`, the mastery ladder, forks,
  `techniqueDisplayName`.
- Rune surgery on a move (`weaponTechniqueMods`).
- Weapon states: grounded, impaled and sheathed weapons, the `equipment`
  effect of a move, `toggleSheathe`.
- Readied spells (`readiesSpell`, `deliversSpell`, the `spell_ready` seat).
- The planner, the position graph, `reachablePositions`, `techniqueStatus`,
  `positionKnown`.

### Why nothing ported now is rewritten then

- The execution functions already take the ledger entry. Step 3 fills the
  ledger and adds the mastery, fork and rune terms inside `moveOf`,
  `entriesOf` and `exitOf`; the callers do not change.
- The slice holds the ledger in the old shape (`techniques[id] = {
  executions, form, path? }`). Nothing in the running game writes it in this
  port. A test writes it directly.
- A technique whose gate reads a state step 3 owns (a grounded, impaled or
  sheathed weapon, a readied spell) is in the registry and is refused with a
  reason by the player kind. Step 3 replaces the refusal with the real gate.
- Counters go through a registry in combat (`registerInterception`), not
  through a branch in the tick. Step 3 adds nothing to combat for them.

### Slice (version 1)

| Field | Holds |
|---|---|
| `techniques` | The ledger: technique id to `{ executions, form, path? }`. Old `state.techniques`. Empty in a new game. |

### How a technique runs

Monster (`registerMonsterAction('technique')`):

- `available`: the technique exists and its declared positions admit where
  the monster stands (`Enemy.position`, absent is neutral). A monster reads
  the declared ways only: it has no ledger. An unknown technique id is
  refused with a reason.
- `shape`: name, icon, `damageMult`, `damageType` (the blow is thrown as
  the move's type when it names one, else as the kit's), `hits`, `inflicts`,
  `cooldown`, the exit `to`, and `watchKey`.
- The tick does the rest (port 4): the clock stamp with the default of 60
  ticks, the displaced exit, the feed line, the blow.

Player (`registerPlayerAction('technique:')`):

- `known`: the ledger's ids in registry order.
- `pick`, in old order: a counter is never picked; a strike (`damageMult`
  present) goes to the action bar, any other form to the buff slot; the
  weapon family in hand; the weapon-state gate; the baked trigger; an open
  entry from the position the player stands in; then the move.
- A strike returns a `SwingShape`: label `"<icon> <name> strikes"`,
  `hitLabel`, `damageMult`, `hits`, `penetration`, `splash`, a named crit,
  `inflicts`, `staminaCost`, `momentum`, `prevented` (by `onParry` when the
  baked trigger's event is `onParry`, else `onHit`) and the exit.
- A defensive form returns a `cast` for the buff slot: the buff through
  `combat/add-buff`, the stamina, the exit through `combat/move-player`, the
  feed line, 2 dexterity XP and 3 skill XP to `combat` and the family.
- The overlay trigger of the player (`combat` slice, `triggers`) is checked
  by combat for every kind.

Interception (`registerInterception`), the player's side only, as in the old
code: armed once per exchange from the rotation, in rotation order, for the
event `onHit`. Gates as `pickCounter`. It takes `reduce` off each hit before
the heavy stance and armour. After the exchange, with the player standing,
it answers: the price, two slices (weapon damage in the weapon's type, the
returned share of what was stopped in the move's type), the clock, the exit,
2 dexterity XP and 3 skill XP.

### Requests and events

Makes: `combat/add-buff`, `combat/move-player`, `combat/stamp-cooldown`,
`combat/take-prevented`, `combat/damage-enemy`, `resources/draw-now`,
`resources/spend-now`. Emits `log/feed`, `attributes/grant-xp`,
`skills/grant-xp`.

### Changed while building

- The player's position outside a fight is neutral (`playerPosition` of
  combat). The source `martial/position` reads that, so closing a fight
  touches it only when the player was not standing neutral. Measured: a
  touch at every close cost 3,600 ms over 8 hours of floor 1 fights.
- `entriesOf`, `moveOf` and `exitOf` are in `index.ts`, not in files of
  their own.

## Files

| File | Holds |
|---|---|
| `defs.ts` | The three registries, their schemas, the record types, `TECHNIQUES`, `POSITIONS`. |
| `index.ts` | The ways in, the move, the gates, the three registrations with combat, the position source, the declaration. |
| `content/` | `techniques.json` (29), `positions.json` (7), `fork_archetypes.json` (8). Written by `node scripts/convert-content.mjs positions fork_archetypes techniques`. |

In the JSON a technique's `from` is a list of ways (`{ any: true }` or
`{ at: [...] }`, each with an optional trigger) and `mastery` is a list
keyed by `tier`: the kernel schema has no union and no map. A trigger
condition's value is a string.

## Skip reasons

All through `combat/rotation`, once per fight, entry and reason.

- A monster's entry: no technique has the id.
- The player's `technique:<id>`: no technique has the id; the technique is
  not known; it needs a grounded, an impaled or a sheathed weapon (weapon
  states: step 3); it needs a readied spell (step 3); its move changes a
  weapon state or readies or delivers a spell (step 3).

Not a skip, the ordinary rhythm of a fight: the clock, the position, a
trigger that does not hold, the weapon family not in hand, the slot (a
strike is not picked for the buff slot), an interception the pool cannot pay
for.

## Old rules ported as they are

- `goblin_raid_leader` (floor 4) has the rotation Pocket Sand, Dirty Stab,
  Gather. Dirty Stab starts from `extended`; nothing in that rotation exits
  to `extended`, and a displacement lands on `off_balance` only. The entry
  cannot fire.
- `hobgoblin` (floors 5, 6) has the rotation Hamstring, Dirty Stab, Lunge,
  Gather, Pocket Sand. Hamstring and Lunge both start from `coiled` and
  Hamstring is asked first; Pocket Sand is asked last. Each of the two
  fires only while the entry asked before it is on its clock. At the
  hobgoblin's own pace neither fired in 6,000 ticks at levels 6, 10 and 14;
  both fire for a hobgoblin given +1.5 attack speed
  (`tests/monsterActions.test.ts`).
- A monster reads no trigger and no weapon family: only the declared
  positions and the clock.
- A monster's technique is stamped, and its watch counter bumped, only when
  the blow was not dodged, shrouded, walled or parried: the stamp is after
  those rolls in the enemy phase.
- The answer of a counter does not write `outgoing.kills` and, as in port 4,
  is recorded by `combat/damage-enemy` in `outgoing.damage`.
- The incoming multiplier of a position is read with `|| 1`: a multiplier of
  0 would read as none. The dodge multiplier keeps an explicit 0. No record
  has an incoming multiplier of 0.

## Differences from the old build

- The answer of a counter lands through `combat/damage-enemy`, so the
  target's conditions are told of the damage (`enemyTookDamage`) and
  `combat/hit` is emitted. The old `fireCounter` took the HP off directly.
- A defensive form's clock is stamped by the tick before the form runs; the
  old buff slot stamped it after the buff and the stamina. Nothing reads the
  clock in between.
