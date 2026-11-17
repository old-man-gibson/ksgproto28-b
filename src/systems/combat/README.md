# combat

The fight: spawning, the combat tick, kills, defeats, the fight ledger and
the rest-before-the-next-fight rule.

Port of: old `systems/combat.ts` (the parts listed under "Old to new"),
`systems/ledger.ts`, `systems/huntrest.ts`. The monster registry and the
monster formulas are in `src/systems/monsters` and `src/systems/stats`.

This file was written before the code. Section "Design" is the contract the
code follows; the sections after it are filled in as the port lands.

## Design

### Why the shape differs from the old file

Old `combat.ts` was 5,419 lines because every system hooked in by editing
it. Here the tick is a fixed sequence of phases. A later system attaches in
one of four ways and never edits a file in this folder:

1. it hears an event this system emits;
2. it moves a hook stat of this system from a modifier source of its own;
3. it answers a request this system makes through a registered kind
   (rotation entries, below);
4. it sends an event or a request this system declares.

### Entities

A monster in a fight is a kernel entity. Its id is `m<n>`, `n` from a counter
in the slice, never reused. Its stat block comes from the shared stat path:
the source `combat/monsters` states its attributes and the monster fact, and
the resolver in `stats` runs the monster formulas for an entity that carries
that fact. Its conditions are in the `statuses` slice under the same id.
When it leaves the fight this system emits `statuses/forget` and calls
`ctx.dropEntity`.

### Slice

| Field | Holds |
|---|---|
| `fight` | The live fight or null. Old `state.combat`: `enemies` (5 slots), `playerBar`, `cooldowns`, `events`, `forced`, `prevented`. |
| `site` | The encounter site fights are rolled from, or null. Old `SPOTS[state.spot]`, as far as combat read it. |
| `hunting` | The hunt loop is on: a fight is rolled when the respawn timer runs out. |
| `respawnTimer` | Ticks until the next roll. |
| `ledger`, `lastFight`, `notebook` | The fight ledger (old `state.fight`, `state.lastFight`, `state.notebook`). |
| `huntRest` | `{ at, toFull, active }`. |
| `style` | `{ id, exertion }` as the styles system last stated it. Default: no exertion. |
| `nextEntity` | Counter for monster entity ids. |

A fight is saved. The old build dropped the fight at save; `woundsForSave`
is therefore not needed.

### The site

Locations arrive in port 6. Combat does not read a location registry. It
takes an `EncounterSite` as data:

`{ id, name, encounters[], groupWeights?, modifierWeights?, fightLimit?,
stampOnClear?, levelStep?, dynamicLevel? }`.

An encounter line is the old `SpotEncounter`. `levelStep` is the old
`bandLevelStep` result and `dynamicLevel` the band's `{ factor, capShare }`;
port 6 computes both from its floor and band data when it sends the site.

### Commands

| Command | Does |
|---|---|
| `combat/hunt` `{ site }` | Set the site and turn the hunt loop on. Port 6 sends it from the hunt activity; the dev panel sends it with a site built from one monster. |
| `combat/stop` | Turn the hunt loop off and walk away from the fight. Refused in a forced fight. |
| `combat/set-hunt-rest` `{ at, toFull }` | Old `setHuntRest`. |
| `combat/keep-fight`, `combat/drop-fight` | The notebook. |

### Requests this system answers

| Request | Old function | Answer |
|---|---|---|
| `combat/start-forced` `{ site }` | `startForcedFight` | true when a fight began |
| `combat/start-staged` `{ site, members }` | `startStagedGroup`, `startStagedFight` | void |
| `combat/abandon` | `abandonCombat` | true when there was a fight. Never refuses; the caller checks `inForcedFight` first. |
| `combat/damage-enemy` `{ entity, slices[], source, label? }` | The body of every "a strike lands on an enemy" site: `monsterSlice` per slice, HP, `lastHit`, the ledger, `enemyTookDamage`, the graft harvest. | `{ dealt, killed, slices }` |
| `combat/heal-enemy` | `healEnemy` | Not answered in this port. Listed for port 5. |

`combat/damage-enemy` does not sweep the dead. The caller's action ends, and
the tick sweeps before it goes on (old `sweepDead`).

### Requests this system makes

`statuses/*` (apply, tick, fire, bar-damage, consume-magnet, tend,
graft-spread), `resources/hit`, `resources/heal-now`, `resources/exert-now`,
`resources/draw-now` (new in this port, section "Earlier ports"),
`mercy/pick`, `mercy/proc`, `loot/roll`, `gold/add`, `items/drop-weapon`
(new in this port).

### Events this system emits

Every payload names entities by id and carries copies.

| Event | When | Payload |
|---|---|---|
| `combat/fight-started` | A fight begins (old `encounter` bus event and `onEncounterStart`) | `site`, `forced`, `enemies[] { entity, defId, level }` |
| `combat/bar-filled` | A combatant's action bar completes | `entity` |
| `combat/attack` | A normal attack was thrown, hit or not | `attacker`, `target`, `outcome`: `hit`, `evaded`, `fumbled`, `dodged`, `shrouded`, `blocked`, `parried`, `harmless` |
| `combat/hit` | Damage landed on a combatant | `attacker`, `target`, `total`, `crit`, `slices[]`, `kind`: `attack`, `graze`, `riposte`, `spill`, `condition`, `retaliation`, `strike` |
| `combat/kill` | An enemy died (old `kill` bus event) | `entity`, `defId`, `level`, `rewardLevel`, `xp`, `tags`, `lastHit`, `site`, `boss`, `once` |
| `combat/fight-won` | The last enemy died (old `fight:won`) | `site`, `forced` |
| `combat/fight-closed` | A fight ended for any reason (old `fight:closed`) | `site`, `standing[] { entity, defId }`, `outcome` |
| `combat/defeat` | The player went down (old `defeat` bus event, plus what `onDefeat` handed to the retreat) | `monster { defId, name, level }`, `forced`, `outcome`, `cause`, `site` |
| `combat/skipped-action` | A rotation entry of a kind nobody answers | `entity`, `kind` |

The trigger stamps of old `markCombatEvent` (`onEncounterStart`, `onCrit`,
`onDodge`, `onParry`, `onHit`, `onGraze`) are kept in `fight.events` and are
also the events above; port 5 reads either.

Status hooks, sent as `statuses/hook` or the request of the same meaning:
`barFill`, `barDeplete`, `combatEnd`, `damageTaken` on a monster, and
`statuses/situation { inCombat }`, `statuses/inflict` for `wears`,
`statuses/forget`.

### Hook stats

Stats of this system under the kernel's default formula. A later system
moves them from its own modifier source.

| Stat | Base | Replaces |
|---|---|---|
| `combat/darkness` | 0 | `darknessFactor(state)` of old `exposure.ts` (port 6) |
| `combat/positionDodgeMult` | 1 | `positionDodgeMult` of old `martial.ts` |
| `combat/positionIncomingMult` | 1 | `positionIncomingMult`, before `stumbleTaken` |
| `combat/sizeRank` | 3 (medium) | `playerSizeRank` of old `mutagens.ts` |
| `combat/incantFillMult` | 1 | `incantFillMult` (a wind-up drags the bar) |

### Rotations

Old `activeRotation` and `pickActive` walked one list for the player and
`pickMonsterAction` one list per monster. Both are ported. An entry has a
kind. This port executes one kind: the normal attack, which is what the
action bar does when the rotation offers nothing.

Other kinds are registered, not coded here:

- `registerActionKind(kind, handler)` in `combat/actions.ts` is called at
  module load by the system that owns the kind. The handler gets the combat
  context and the entry and returns what it did: `{ acted: true }`, or
  `{ acted: false }` to fall through to the next entry.
- Monster kinds: `technique` (port 5, the six monster techniques), `cast`
  (port 5, the two monster sentences). A monster technique shapes the normal
  attack: its handler returns a `shape` (`damageMult`, `damageType`, `hits`,
  `inflicts`, `cooldown`, `to`) and the enemy attack phase applies it.
- Player kinds: `technique:`, `grimoire:`, `facet:`, the gene active, skill
  actives (`strike`, `spell`, `buff`).
- An entry whose kind has no handler is skipped with
  `ctx.skip('combat/rotation', ...)` once per fight and entry, and
  `combat/skipped-action` is emitted. The combatant then does what the old
  code did when nothing in the rotation was available: a plain swing.

### Not ported, each an extension point and not a stub

| Old part | Lines | Attaches through |
|---|---|---|
| Floating weapons, telekinesis | 278-708 | A system with its own tick, ordered before combat, calling `combat/damage-enemy`; `handSwingShare` of `items` is already read by the swing. |
| Crafted self-casts, monster workings, `castCraftedAttack` | 2224-2539, 3229-3522 | Action kinds `grimoire:` and `cast`; `combat/damage-enemy`; `combat/heal-enemy`. |
| Counterspells | 2540-2803 | Hears `combat/attack` of kind cast; arcane port. |
| Counter techniques (`pickCounter`, `fireCounter`) | 2095-2223 | Action kind with a `counter` hook; martial port. `fight.prevented` is kept for it. |
| Facet ability strikes | 3523-3609 | `combat/damage-enemy`, `combat/bar-filled`, `combat/hit`. |
| Gene abilities, incantation, tongues | 2847-3085 | Action kind; hook stat `combat/incantFillMult`. |
| Statues and rubble | 1701-1777 | No monster on floors 0 to 6 has a statue rule. `statueOf` of `statuses` is read where the old tick read it so that a statue condition is not silently ignored: listed under "Left behind". |
| Coatings (`spendCoating`) | in 4217-4835 | Hears `combat/hit` of kind `attack`; alchemy port. |
| Toll golem, wards, festival, sea | - | Not ported. |

### Tick order

`order: 10`, so this system ticks after `resources` and `statuses`, as old
`tickAction` ran `tickResources`, `tickPlayerStatuses`, the health trickle
and then `tickCombat`.

One tick with a fight open, in old order: cooldowns; each enemy's conditions
(`statuses/tick`), which can kill; enemy regeneration; enemy minds; the
player's bar (reversal, bar damage, `barFill`, blocked action, the rotation,
the normal attack with dodge, miss, graze, crit, typed slices, spill,
retaliation, XP); each enemy's bar (reversal, jostle, bar damage, the
rotation, self-miss, the player's dodge, shroud, ranged block, parry and
riposte, the blow, riders, XP); defeat.

With no fight: settle the floating feed runs; the respawn timer; the rest
rule; roll the next fight from the site when `hunting`.
