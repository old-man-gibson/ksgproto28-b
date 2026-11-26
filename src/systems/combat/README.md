# combat

The fight: spawning, the combat tick, kills, defeats, the fight ledger and
the rest-before-the-next-fight rule.

Port of: old `systems/combat.ts` (the parts listed under "Old to new"),
`systems/ledger.ts`, `systems/huntrest.ts`. The monster registry is in
`src/systems/monsters`; the monster formulas are the monster case of
`src/systems/stats`.

Section "Design" was written and committed before the code (`8639309`). It
was corrected where the build changed a name; those changes are listed under
"Changed while building".

## Files

| File | Holds |
|---|---|
| `types.ts` | The slice, `Enemy`, `Fight`, `EncounterSite`, the ledger types. |
| `damage.ts` | Typed damage, pure: `monsterSlice`, `incomingSlice`, `afterPenetration`, `heaviestType`, `POSITION_MODS`. |
| `spawn.ts` | `eligibleEncounters`, `spawnMonster`, `spawnGroup`, `dynamicLevelBonus`, kept wounds. |
| `ledger.ts` | The fight ledger and the notebook. |
| `actions.ts` | The registry of rotation kinds. |
| `engine.ts` | Fight start, the tick, the normal attack on both sides, kill, defeat, close, the rest rule. |
| `index.ts` | The declaration: slice, commands, requests, events, source, view. |
| `CombatPanel.svelte`, `panel.ts` | The panel. |

## Design

### Why the shape differs from the old file

Old `combat.ts` was 5,419 lines because every system hooked in by editing
it. Here the tick is a fixed sequence of phases. A later system attaches in
one of four ways and never edits a file in this folder:

1. it hears an event this system emits;
2. it moves a hook stat of this system from a modifier source of its own;
3. it registers a rotation kind (`actions.ts`);
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
| `fight` | The live fight or null. Old `state.combat`: `enemies` (5 slots), `playerBar`, `momentum`, `position`, `cooldowns`, `events`, `forced`, `prevented`, `introTicks`, `reported`, and since version 2 `buffs`. |
| `site` | The encounter site fights are rolled from, or null. Old `SPOTS[state.spot]`, as far as combat read it. |
| `hunting` | The hunt loop is on: a fight is rolled when the respawn timer runs out. |
| `respawnTimer` | Ticks until the next roll. |
| `ledger`, `lastFight`, `notebook` | The fight ledger (old `state.fight`, `state.lastFight`, `state.notebook`). |
| `huntRest` | `{ at, toFull, active }`. |
| `style` | `{ id, exertion }` as the styles system last stated it. Default: `balanced` with its old exertion (`on: attack`, cost 0.02, +10% damage). |
| `rotation` | The player's explicit order of actives. Old `state.skillOrder`. |
| `nextEntity` | Counter for monster entity ids. |

A fight is saved. The old build dropped the fight at save; its
`woundsForSave` is therefore not needed and not ported.

### The site

Combat does not read a location registry. It takes an `EncounterSite` as
data, which `world` builds from a spot (`siteOf`, spine port 6):

`{ id, name, encounters[], groupWeights?, modifierWeights?, fightLimit?,
stampOnClear?, levelStep?, dynamicLevel?, clearedMsg? }`.

An encounter line is the old `SpotEncounter`. `levelStep` is the old
`bandLevelStep` result and `dynamicLevel` the band's `{ factor, capShare }`;
`world` reads both from `ladder` when it sends the site. A `sky` line rolls
only under the weather kinds it lists: the reader of the sky over a site is
registered by `weather` (`registerSiteSky` in `spawn.ts`).

### Commands

| Command | Does |
|---|---|
| `combat/hunt` `{ site }` | Set the site and turn the hunt loop on. The panel sends it with a site built from one monster; the hunt activity of `world` uses the request `combat/set-hunt`. A fight open at another site is abandoned. |
| `combat/stop` | Turn the hunt loop off and walk away from the fight. |
| `combat/set-hunt-rest` `{ at, toFull }` | Old `setHuntRest`. |
| `combat/keep-fight`, `combat/drop-fight` `{ id }` | The notebook. |
| `combat/set-rotation` `{ order }` | The player's explicit order of actives. |

### Requests this system answers

| Request | Old function | Answer |
|---|---|---|
| `combat/start-forced` `{ site }` | `startForcedFight` | true when a fight began |
| `combat/start-staged` `{ site, members }` | `startStagedGroup`, `startStagedFight` | void |
| `combat/set-hunt` `{ site }` | The hunt case of `tickAction` | The hunt loop on at the site, from a system. False when the site is unsound or the open fight cannot be left. Spine port 6. |
| `combat/stop-hunt` | - | The hunt loop off, without leaving a fight. Spine port 6. |
| `combat/abandon` | `abandonCombat` | true when there was a fight. Never refuses; the caller checks `inForcedFight` first. |
| `combat/damage-enemy` `{ entity, strikes[], source, penetration?, kind? }` | The body of a strike on an enemy from outside the normal attack (`abilityStrike`, each strike of `castCraftedAttack`): `monsterSlice` per strike, HP, `lastHit`, the ledger, `enemyTookDamage`, the graft harvest. | `{ dealt, killed, slices }`, or null for an entity that is not a living enemy |
| `combat/stamp-action` `{ entity, index, cooldown }` | `spendMonsterAction` and the clock stamp | false for an unknown entity |
| `combat/enable-action` `{ id, enabled }` | The `enabled` half of `benchTechnique` and `setTechniqueSlotted` (step 3, martial) | void. Creates the trigger `{ conditions: [] }` when the id has none. |

`combat/damage-enemy` does not sweep the dead. The tick sweeps at the point
the old tick swept after the strikes of the run's ability.

### Requests this system makes

`statuses/apply`, `apply-all`, `tick`, `fire`, `bar-damage`,
`consume-magnet`, `tend`, `graft-spread`; `resources/hit`, `exert-now`,
`draw-now`; `mercy/pick`, `mercy/proc`; `loot/roll`; `gold/add`;
`items/drop-worn`.

### Events this system emits

Every payload names entities by id and carries copies.

| Event | When | Payload |
|---|---|---|
| `combat/fight-started` | A fight begins (old `encounter` bus event and `onEncounterStart`) | `site`, `forced`, `enemies[] { entity, defId, name, level }` |
| `combat/bar-filled` | A combatant's action bar completes | `entity` |
| `combat/attack` | A normal attack was thrown, hit or not | `attacker`, `target`, `outcome`: `hit`, `evaded`, `fumbled`, `dodged`, `shrouded`, `blocked`, `parried`, `harmless` |
| `combat/hit` | Damage landed on a combatant | `attacker`, `target`, `total`, `crit`, `type`, `thrown?`, `kind`: `attack`, `graze`, `riposte`, `spill`, `condition`, `strike` |
| `combat/kill` | An enemy died (old `kill` bus event) | `entity`, `defId`, `name`, `level`, `rewardLevel`, `xp`, `tags`, `lastHit`, `site`, `boss`, `once` |
| `combat/fight-won` | The last enemy died (old `fight:won`) | `site`, `forced` |
| `combat/fight-closed` | A fight ended for any reason (old `fight:closed`) | `site`, `standing[]` (each with `hurt`: it lost HP in the fight, the old `lastHit` stamp; step 4 port C1, read by `wards`) |
| `combat/defeat` | The player went down (old `defeat` bus event, plus what `onDefeat` handed to the retreat) | `monster { entity, defId, name, level }` or null, `forced`, `outcome`, `cause`, `site`, `byCondition` |
| `combat/skipped-action` | A rotation entry of a kind nobody registered | `entity`, `kind` |

`combat/close-ledger` is sent by this system to itself (see "The ledger").

The trigger stamps of old `markCombatEvent` (`onEncounterStart`, `onCrit`,
`onDodge`, `onParry`, `onHit`, `onGraze`) are kept in `fight.events`, in
clock ticks; the events above carry the same moments.

To other systems: `statuses/situation { inCombat }`, `statuses/forget`,
`resources/set-pace { inCombat }` and, for the rest rule, `{ hpMult,
healKind }`; `counters/bump`, `set`, `clear`; `skills/grant-xp`,
`skills/check-discovery`; `attributes/grant-xp`; `levels/grant-xp`;
`log/line`, `log/feed`, `log/feed-repeat`, `log/feed-floating`,
`log/feed-settle`, `log/transcript-open`, `log/transcript-close`.

### Events this system hears

| Event | Does |
|---|---|
| `resources/damaged` | Attributes the damage in the ledger. `source: null` is already attributed; no source is recorded as `unknown`. |
| `statuses/damage` | Attributes a tick of the player's conditions, one row per condition. Closes an open fight as a knockout when the tick left the player at 0 HP. |
| `statuses/detonated`, `statuses/fatal` | Close an open fight as a knockout: a detonation that left the player at 0 HP, a fatal condition whatever the HP. |
| `resources/healed` | Records the heal by kind, and what a condition refused. |
| `combat/set-style` | The style fought in and its exertion, from the `styles` system (step 3). |

### Hook stats

Stats of this system under the kernel's default formula. A later system
moves them from its own modifier source.

| Stat | Base | Replaces |
|---|---|---|
| `combat/darkness` | 0 | `darknessFactor(state)` of old `exposure.ts` (port 6) |
| `combat/positionDodgeMult` | 1 | `positionDodgeMult` of old `martial.ts` |
| `combat/positionIncomingMult` | 1 | `positionIncomingMult`, before `stumbleTaken` |
| `combat/barFillMult` | 1 | `incantFillMult` (a wind-up drags the player's bar) |

The player's size is `wielderRank` of `items`, which the body's owner states
with `items/set-bearer`.

### Rotations

Old `activeRotation` and `pickActive` walked one list for the player and
`pickMonsterAction` one list per monster. Both are ported (`engine.ts`). An
entry has a kind. This port executes one kind: the normal attack, which is
what the action bar does when the rotation offers nothing.

Other kinds are registered at module load by the system that owns them:

- `registerMonsterAction(kind, handler)`, kind `technique` or `cast`. The
  handler answers `available` (the old gates), and either `shape` (a
  technique: `damageMult`, `damageType`, `hits`, `inflicts`, `cooldown`,
  `to`, `watchKey`; the tick stamps the clock, moves the monster and throws
  the blow) or `perform` (a working: it replaces the swing, is not dodged or
  parried, and does everything itself, including `combat/stamp-action`).
- `registerPlayerAction(prefix, handler)`, prefix `technique:`, `grimoire:`,
  `facet:` or a whole id. The handler answers `known` (ids beyond the
  explicit order) and `pick(id, slot)`. A picked active has a `shape` (the
  tick throws the blow with `damageMult`, `hits`, `penetration`, `splash`,
  a named `crit`, `inflicts`, `staminaCost`, `momentum`, `prevented`, `to`)
  or a `cast` (it takes the swing's place and lands through
  `combat/damage-enemy`). `sure` and `approach` feed the to-hit sequence.
- A handler gets a narrow context: reads, the generator, `emit`, `request`,
  `skip`. It does not get the combat slice.
- An entry whose kind has no handler is passed over with
  `ctx.skip('combat/rotation', ...)` once per fight and entry, and
  `combat/skipped-action` is emitted. The combatant then does what the old
  code did when nothing in the rotation was available: a plain swing.

`tests/combatSystem.test.ts` registers each of the four shapes from a test.

### The ledger

A blow, a heal and a condition tick reach the ledger as events, after the
handler that caused them returns. The handler that ends a fight therefore
does not close the ledger itself: it emits `combat/close-ledger`, which
arrives after the damage events and the feed lines of that handler. The
close reads the conditions the player still holds (after `combatEnd`) and
copies the transcript the log system kept, without damage reports.

Walking away drops the tally at once.

### Tick order

`order: 10`, so this system ticks after `resources` and `statuses`, as old
`tickAction` ran `tickResources`, `tickPlayerStatuses`, the health trickle
and then `tickCombat`.

One tick with a fight open, in old order: the opening address; cooldowns;
each enemy's conditions (`statuses/tick`), which can kill; enemy
regeneration; enemy minds; the sweep of what a request killed; buff-slot
actives; the player's bar (reversal, bar damage, `barFill`, a blocked
action, the rotation, the to-hit sequence, graze, the blow with crit, typed
slices, spill, retaliation, XP); each enemy's bar (reversal, jostle, bar
damage, the rotation, self-miss, the player's dodge, shroud, ranged block,
parry and riposte, the blow, riders, XP); defeat.

With no fight: settle the floating feed runs; the respawn timer; the rest
rule; roll the next fight from the site when `hunting`.

### Changed while building

- `combat/sizeRank` was dropped: `items` already holds the body's size.
- `combat/incantFillMult` is named `combat/barFillMult`.
- `combat/heal-enemy` was not declared in port 4. Port 5 declares it
  ("Port 5 design").
- `combat/set-rotation`, `combat/stamp-action` and `combat/close-ledger`
  were added.
- `resources/heal-now` is declared in `resources` and not used here yet.

## Port 5 design

Written and committed before the code of spine port 5. The four systems of
that port (`martial`, `spellcraft`, `arcane`, `divine`) register their kinds
here. What they need from this folder, each the smallest addition that
keeps them out of the tick:

### Slice version 2

| Field | Holds |
|---|---|
| `fight.buffs` | `{ name, mods, ticksLeft }[]`. Old `CombatState.buffs`: a ward of a spell, the buff of a defensive form. Counted down each tick after the cooldowns. Stated by the source `combat/buffs`. |
| `Enemy.lastAction` | `{ name, icon, at }`: the last rotation entry the monster used, for the panel. |
| `triggers` | Rotation id to the player's own trigger. Old `state.skillTriggers`. |

### Registries added to `actions.ts`

- `registerInterception(handler)`: the hook inside the incoming blow that
  port 4 named. `arm(ctx, fight, event)` is asked once per exchange, at the
  point the old enemy phase called `pickCounter`. An armed interception
  states `reduce`, taken off each hit before the heavy stance and armour and
  counted in `prevented.onHit`, and `fire(ctx, entity)`, called after the
  exchange when the player still stands, at the point of `fireCounter`. A
  kill by the answer is processed by the tick.
- `registerBlowRider(handler)`: the hook inside the player's blow for
  per-hit riders (the old `spendCoating`). `perHit(ctx, target)` is asked
  for each hit after the weapon's own typed bonuses and returns typed slices
  to add; `afterBlow(ctx, target)` returns conditions to apply and a line.
  No system registers one in port 5; a test does.
- `registerTriggerSubject(id, read)`: a subject of the trigger language
  owned by another system (`enemy.castSchool`, `enemy.castElement`).
- `MonsterActionKind.available` and `PlayerActionKind.pick` may answer with
  a reason. An entry that cannot run for a reason other than its clock, its
  position or its trigger is reported once per fight through
  `ctx.skip('combat/rotation', ...)`. A spent supply (`uses`) is reported by
  the tick.

### Triggers

`triggers.ts`: `evaluateTrigger` and the subjects of old
`systems/triggers.ts` that read what is ported (pools, conditions, the
front enemy, the position, the style id, a technique's clock). The player's
own trigger on a rotation id is checked by `pickActive` for every kind.
Command `combat/set-trigger { id, trigger }`.

### Requests added

| Request | Old | Answer |
|---|---|---|
| `combat/heal-enemy` `{ entity, amount, source, hostile?, penetration? }` | `healEnemy` | void. Kindness mends and settles an overgrowth; forced life accrues in the overgrowth ledger, escalates and bursts. |
| `combat/land-slices` `{ entity, slices, crit?, kind? }` | The landing of `castCraftedAttack` | `{ dealt, bite, killed }`. Slices are computed by the caller; this applies the bite of the target's conditions, the HP, `lastHit`, the ledger, `enemyTookDamage` and the harvest. |
| `combat/add-buff` `{ name, mods, duration }` | `c.buffs.push` | void |
| `combat/move-player` `{ to }` | `setPosition` | void |
| `combat/stamp-cooldown` `{ id, ticks }` | `c.cooldowns[id] = n` | void |
| `combat/mark-event` `{ event }` | `markCombatEvent` | void |
| `combat/take-prevented` `{ by }` | Reading and clearing `c.prevented` | The amount |
| `combat/hurt-enemy` `{ entity, amount, type }` | A backlash on a monster | void |

`combat/stamp-action` takes an optional `name` and `icon`, which become
`Enemy.lastAction`. The tick sets the same for a shaped swing.

`statuses` gains `statuses/feed-surplus` and `statuses/settle-surplus` for
the overgrowth ledger that `healEnemy` wrote on a status instance.

### The buff slot

`pickActive(ctx, 'buff')` stamps the clock of the active it performs, as
the old buff slot did for a spell and for a defensive form.

### Port 5: changed while building

- `registerInterception(key, handler)` and `registerBlowRider(key, handler)`
  take a key, so a test can drop what it registered (`unregisterHook`).
- `registerTriggerSubject` is in `triggers.ts`.
- `combat/attack-retaliation` was added: the cost of attacking under the
  player's conditions, for a working that takes the swing's place. The old
  `castCraftedAttack` called `applyRetaliation` itself.
- `combat/hurt-enemy` takes `outgoing?`: a backlash is written to the
  ledger, a spill is not, as in the old code.
- Two sources were added. `combat/buffs` states the buffs of the fight on
  the player, labelled `Buff: <name>`. `combat/position` states nothing: it
  is the change counter of the player's position, for a source of another
  system that reads it through `dependsOn`.
- `playerPosition(state)`: the position of the open fight, neutral with
  none. A fight starts neutral, so the position source is touched only when
  the position changes. A touch at every close of a fight rebuilt the
  player's stat block once per fight: 8 hours of floor 1 fights went from
  4,000 ms to 7,600 ms until this was changed.
- `Enemy.lastAction` is shown by the view for 30 ticks
  (`ACTION_SHOWN_TICKS`) as `EnemyView.action`. The panel has a box for it
  beside the enemy's action bar; the box is there with or without a name,
  so nothing moves. On a phone an enemy row is 3.75rem high (was 3.5rem).
- The tick reads the player's stat block again after a buff-slot active
  ran: a buff or a new position changes it.
- `statBlockOf` of `stats` builds the stat ids once, not per block: measured
  on the floor 6 run, 13,100 ms to 11,500 ms.

## Old to new

| Old `combat.ts` | Lines | Here |
|---|---|---|
| `stepsSmaller`, `stepsLarger`, `landGraze`, `shedCooldownsOnMiss`, `landMonsterGraze` | 109-277 | `engine.ts` |
| Floating weapons, telekinesis | 278-708 | Not ported (extension point) |
| `RESPAWN_DELAY`, `POSITION_MODS`, `feed`, `rollAgainst`, `markCombatEvent` | 709-760 | `engine.ts`, `damage.ts` |
| `slainKey`, `fightsKey`, `bossKey`, `isSpotBoss`, `isNightNow`, `encounterPowerRatio`, `eligibleEncounters`, `spotCleared`, `spawnMonster` | 761-949 | `spawn.ts` (`isSiteBoss`, `siteCleared`) |
| `feedTheFast`, `frontEnemy`, `liveEnemies`, `rollGroupSize`, `spawnGroup`, `warrantsAppearsLine` | 951-1102 | `engine.ts`, `spawn.ts` |
| `startEncounter`, `inForcedFight`, `startForcedFight`, `startStagedFight`, `startStagedGroup` | 1104-1276 | `engine.ts`; the approach (`pendingApproach`) is left behind |
| `combatTags`, `WEAPON_DAMAGE_TYPES`, `trackWeaponFamily`, `playerDamageType` | 1278-1352 | `engine.ts`, `damage.ts` |
| `monsterResistance`, `afterPenetration`, `monsterSlice`, `incomingSlice`, `incomingDamage`, `addSlice`, crit keys, `resNote` | 1354-1575 | `damage.ts`, `monsters` (`monsterResistance`) |
| Drop tables | 1586-1700 | `loot` (port 3) |
| Statues, rubble, `standAside`; `rattle` | 1701-1777 | `engine.ts` (step 4 port F); `rattle` in `engine.ts` |
| `onKill`, `onDefeat` | 1778-1946 | `engine.ts`, without the knockout; the statue rules since step 4 port F |
| `activeRotation`, `pickActive` | 1948-2093 | `engine.ts` over `actions.ts` |
| `pickCounter`, `fireCounter` | 2095-2222 | Not ported (extension point) |
| Crafted self-casts, monster workings, counterspells | 2224-2803 | Not ported (extension point) |
| `pickMonsterAction` | 2804-2845 | `engine.ts` over `actions.ts` |
| Incantation, tongues, gene abilities, `healEnemy`, `castCraftedAttack`, Facet strikes | 2847-3609 | Not ported (extension point); `spendMonsterAction` is `stampMonsterAction`; `sweepDead` in `engine.ts` |
| `answeredToDeath`, `applyBarDamage`, `applyMonsterBarDamage`, `applyRetaliation`, `applyMonsterRetaliation`, `enemyTookDamage`, `dealtByType`, `heaviestType` | 3610-3865 | `engine.ts`, `damage.ts` |
| `regenDoused`, `tickEnemyRegen`, `tickEnemyStatuses`, `burnMind`, `tickEnemyMinds`, `settleWhen` | 3867-4057 | `engine.ts` |
| `tickCombat`, `runCombatTick` head | 4061-4215 | `runCombatTick` |
| Player attack | 4217-4834 | `playerPhase`, `swing` |
| Enemy attacks | 4836-5303 | `enemyPhase` |
| `closeCombat`, `abandonCombat` | 5306-5360 | `engine.ts` |
| `KEPT_WOUND_CAP`, `spawnHp`, `pendingWounds` | 5362-5406 | `spawn.ts`; `woundsForSave` not needed |

Other old files: `ledger.ts` is `ledger.ts` whole. `huntrest.ts`:
`holdNextFight`, `restTarget`, `restingForFight`, `setHuntRest`,
`clearRest` are in `engine.ts` and `index.ts`; `returnRecoverTarget` is port
6. `monsterMind`, `mindInDebt` of `monsterStats.ts` are in `engine.ts`.
`naturalDarkness` of `exposure.ts` is in `spawn.ts`. `isPracticeFight` of
`practice.ts` is in `engine.ts`; the rest of `practice.ts` is the system
`practice` (step 3 gap): `runCombatTick` sends `practice/open` at its start
when the fight is a practice fight, and `startEncounter` emits
`practice/fight-started` when the practice clock holds a stamp. The kill and
defeat listeners of `achievements.ts` and the kill listener of `levels.ts`
are in `onKill` and `onDefeat`.

## Not ported, each an extension point and not a stub

| Old part | Attaches through |
|---|---|
| Floating weapons, telekinesis | A system with its own tick, ordered before combat, calling `combat/damage-enemy`. The swing already reads `handSwingShare` of `items`. `landGraze` takes the share. |
| Player techniques, monster techniques | Ported in spine port 5 by `src/systems/martial`: `registerPlayerAction('technique:')`, `registerMonsterAction('technique')`, the source `martial/position` on the two position hook stats. Learning and mastery are step 3. |
| Counter techniques (`pickCounter`, `fireCounter`) | Ported in spine port 5 by `src/systems/martial` through `registerInterception`. |
| Crafted spells, monster workings, `castCraftedAttack`, `castCraftedSelf`, `healEnemy` | Ported in spine port 5 by `src/systems/spellcraft`: `registerPlayerAction('grimoire:')`, `registerMonsterAction('cast')`, `combat/land-slices`, `combat/heal-enemy`. The book's writing side is step 3. |
| Counterspells | Ported in spine port 5 in `src/systems/spellcraft/cast.ts`. |
| The refuting body (`refuteCast`, `isSealed`) | `registerRefuter` of `spellcraft`; mutagens port. |
| Facet ability strikes and actions | `combat/damage-enemy`, `combat/bar-filled`, `combat/hit`, `registerPlayerAction('facet:')`. |
| Gene abilities, incantation, tongues | A player kind for the gene active; `combat/barFillMult`. |
| Coatings (`spendCoating`) | `registerBlowRider`: `perHit` for the typed slices of each hit, `afterBlow` for the conditions and the "used up" line; alchemy port. A test registers one. |
| Skill actives (`strike`, `spell`, `buff`) | No skill record in the registry is an active. A player kind for skill ids when one exists. Combat buffs exist since port 5 (`combat/add-buff`). |
| The approach (`pendingApproach`) | No road of floors 0 to 6 has one. Step 4: `world` applies it after `combat/fight-started`, or through a field of `combat/start-forced`. |
| Toll golem spell reactions, wards, festival, sea | Not ported. The 30-tick address of the toll golem is ported (`introTicks`); its reward is in `world` (spine port 6). |

## Skip reasons

- `combat/hunt`: the site has no id or no encounter list; the site names an
  unknown monster; a line lacks a level range; the fight cannot be left.
- `combat/stop`: the fight cannot be left; no hunt is on and no fight is
  open.
- `combat/set-hunt-rest`: the threshold is not a number.
- `combat/keep-fight`: no fight has ended yet; the fight is already kept.
- `combat/drop-fight`: no kept fight has the id.
- `combat/set-rotation`: the order is not a list of ids.
- `combat/start-forced`, `combat/start-staged`: a site or member issue, as
  for `combat/hunt`; a staged fight needs a member.
- `combat/damage-enemy`, `combat/stamp-action`, `combat/heal-enemy`,
  `combat/land-slices`, `combat/hurt-enemy`: no enemy has the entity id (for
  `damage-enemy` and `land-slices`: no living enemy).
- `combat/add-buff`, `combat/move-player`, `combat/stamp-cooldown`,
  `combat/mark-event`: no fight is open.
- `combat/set-trigger`: the rotation id is empty; the id has no trigger to
  remove; the trigger is not an object.
- `combat/rotation`: no system has registered the action kind; a monster's
  entry whose supply is spent; a reason the kind gave (listed in the README
  of `martial` and of `spellcraft`). One line per fight, entry and reason.
- `combat/encounter`: a line needs the sky and no weather system is
  registered.
- `combat/set-hunt`: the site has no id or no encounter list, or names an
  unknown monster.
- `combat/statue-landed`: no enemy of an open fight has the entity id.
- `combat/close-ledger`: no ledger is open.

A fight that does not start because the site is cleared, the table is empty
or a fight is open is an outcome of `combat/start-forced` (false), not a
skip.

## Left behind

- Filled by spine port 6: the knockout (`knockout` hears `combat/defeat`
  and the condition events: 1 HP, the retreat, the recovery, the return,
  the "knocks you out" line, `returnRecoverTarget`); `sky` lines (`weather`
  registers the reader with `registerSiteSky`); `combat/darkness` (stated by
  `weather`); the site (`world` builds it from a spot and sends it with
  `combat/set-hunt`); the floor clears (`ladder` hears `combat/kill` and
  `combat/fight-won`). This system still closes the fight, sets the respawn
  delay and turns the hunt loop off at a defeat.
- The bestiary (`recordEncounter`, `recordKill`, `spawnLevels`): hears
  `combat/fight-started` and `combat/kill`.
- The notebook has commands and no panel part.
- Monster portraits: the view carries the file name (`art`); the panel shows
  the emoji icon.

## Differences from the old build

- The save holds the fight. A load continues it.
- Monster cooldown stamps and trigger stamps are in clock ticks
  (`clock.totalTicks`), as the old ones were in `state.totalTicks`.
- XP grants, counter bumps and log lines are events: they are applied after
  the tick handler returns, in emit order. A level-up line of a skill
  therefore appears after the lines of the tick that earned it, not between
  them.
- A counter bumped in a handler is not readable in the same handler. The one
  place that needed it (`fights:<site>` against the fight limit) adds the
  bump it just sent.
- `wears` are applied when the fight starts, after every member is minted,
  not inside `spawnMonster`: a monster's stat block is read from the slice.
  No record has `wears` with a chance, so the order of draws is unchanged.
- The ledger closes one event later than the old `endFight` (see "The
  ledger").
- `hunting` replaces "the selected activity is a hunt". A defeat turns it
  off.

## Old rules ported as they are

- The feed line of a group reads "and 1 others attack!" for a group of two.
- `noteOutgoing` has a `kill` flag and no caller sets it: `outgoing.kills`
  of a ledger is always 0.
- The shroud roll (`statusIncomingMissChance`) draws from the generator on
  every enemy swing that was not dodged, also at a chance of 0. The self-miss
  roll and the parry roll draw only when there is a chance.
- A monster's riders are applied before the check that the player is still
  standing: the blow that ends a fight can leave a condition behind.
- Player XP for a swing (`str` 2, `dex` 1, skill XP by reward level) is paid
  before the kill is processed, also for the blow that kills.
- `applyMonsterBarDamage`, a retaliation that hits a monster, and a
  condition's bar damage take the slice unrounded and with no floor: a
  monster's HP can be fractional. Blows are rounded with a floor of 1.
- A blow on the player is rounded per hit (`max(1, round(slice x bite))`),
  so a flurry of small hits deals at least 1 each.
- `fixedDamage` ignores the bite of a surprise condition and every defence.
- In `onKill`, gold is `round(monster.gold x goldGain)`; `monster.gold` was
  already rounded at spawn.
- The rarity roll multiplies rewards by `rarity.statMult`, not by
  `rarity.lootMult`, at spawn (`xp`). `lootMult` is read by the drop roll.
- `rollGroupSize` clamps to the leader's `min` and `max` after the weighted
  roll, so a leader with `min: 5` always brings four, whatever the site's
  weights say.
- A dodge is rolled with `Math.min(0.9, ...)` although the dodge stat is
  held at 0.75; a stance's bought dodge can pass the stat's cap.
- The parry riposte and the spill do not tell the target's conditions
  (`enemyTookDamage` is not called for them), and do not write the ledger's
  `outgoing`.
- `combat:attacks` counts shaped blows and plain ones alike.
- A monster's graze that takes the player to 0 HP does not end the fight:
  the enemy phase stops, and the defeat follows on the next blow that lands.
  No monster record has the `graze` stat.
- The task text counted 146 monsters; the old registry holds 131. Counted
  in port 5: `MONSTERS` of the old `data/monsters.data.ts` has 131 keys and
  all 131 are in `monsters.json`. The file holds 146 lines with an `id:`
  field: the 131 monsters, 7 tiers, 4 modifier tiers and 4 rarities.
- The survey in `docs/SPINE.md` section 1 counted two monster spell
  sentences on floors 0 to 6. The old data also gives `goblin_witch_doctor`
  (floor 6) three divine workings.

## Step 3 (martial) additions

- `combat/enable-action` (above): martial's bench.
- `PickedActive.before(ctx)`: called when a shaped blow goes off, before its
  numbers are read (old `applyTechniqueEquipment` 'pre': a blade drawn back
  into the hand strikes). `after` was already there.
- Source `combat/momentum` (states nothing) and `playerMomentum(state)`:
  touched when `fight.momentum` changes, and when a fight that built
  momentum closes. The styles source turns momentum into its ramp stat.

## Step 3 (arcane) additions

- `registerPositionWatch(watch)` in `engine.ts`: `watch(ctx, from, to)` is
  called inside `setPlayerPosition`, in the handler that moved the player,
  with the combat context. The old `setPosition` dropped a readied working
  when the player left the spell-ready seat; martial registers the watch
  and asks `martial/hold-spell` from it. Called only when the position
  changes.

## Step 3 (alchemy) additions

- `registerBlowRider`: `perHit` answers `null` for "nothing rides" and a
  list, empty or not, for "spent". An oil of an essence with no damage type
  spends a blow and adds no slice; its `afterBlow` (riders, the used-up
  line) still runs, as the old `spendCoating` did. `alchemy/coating` is
  the first registered rider.
- Request `combat/land-burst { entity, slices }` (`landBurst` in
  `engine.ts`): a thrown flask's total lands on one enemy: the bite of its
  conditions, at least 1, HP, `lastHit`, `damageTaken` with no detail. No
  ledger line, no graft harvest, no `combat/hit`: the old `hurl` did none of
  these. Null for an entity that is not a living enemy.
- Request `combat/sweep`: the old `sweepDead`, for a flask thrown from a
  command between ticks.

## Step 3 (mutagens) additions

- `registerBody({ damageType, sureSwing, splitSplash })` in `actions.ts`: the
  body the player wears (the `mutagens` system registers it). Read by
  `playerDamageType` (old `routedType(state, 'attacks')`: a type in the
  Attacks arm replaces the weapon's and the fist's), the to-hit roll of the
  player phase (`ignores_dodge` in the Attacks arm: no swing is evaded) and
  the spill (`splits_target`: +0.35 splash, into every flank). Old
  `combat.ts` lines 1339, 4320-4340, 4765-4790.
- `PickedActive.blow(ctx, vs, target)`: the body's own blow (a gene ability,
  the old gene branch of the swing, lines 4412-4481 and 4651-4813). Not a
  weapon hit: no stamina upkeep, exertion, extra swings, hand share, weapon
  bonus damage, runes, unarmed rider, coating, position change, contact
  retaliation or `combat:attacks`. It carries its priced damage and steps,
  type, stun (off the target's bar), self delay (off the player's bar),
  riders per hit, size doubling, execute, splash and `splashAll`, the
  conditions it leaves on each target it reached (the spill included), its
  XP tags and CON 3. The kind `gene` registers at rank 10.

## Step 3 (the runecarving port)

- The weapon rune riders of a hit read `runeRiders`: a carved rune may carry
  several flat and percent riders, one per damage type, and each lands as
  its own slice, flat riders of every rune first, then percent riders (old
  `weaponRuneBonuses`). The source name reads `resolveRune`.

## Step 4 port C3

- Slice version 3: `approach`, the opening a road bought, waiting for the
  first fight at its spot (old `state.pendingApproach`). Saved. Migration
  step 2 adds `approach: null`.
- Request `combat/approach` (`stampApproach`): the world stamps it, or
  clears it with `null`.
- `startEncounter` spends it when the site is its spot, after the
  monsters' `wears` and before the tempo check: every enemy gets the
  enemy applications (`statuses/apply`, source "your approach", the
  player's penetration), the player gets the self applications
  (`statuses/apply-all`, source "the way in", resisted). The feed lines
  ("Your approach applied conditions to the enemies.", "You arrive
  flat-footed!") are sent after the fight's transcript opens. A surprised
  formation then opens the tempo, as before.
- Changed (no rule): the old advance ticked no fight on a tick of travel,
  so a forced fight took its first swing one tick after the arrival. Here
  combat ticks after the world in the same kernel tick, so a forced fight's
  first combat tick is the arrival tick (older than this port;
  `tests/approach.test.ts` reads the opening from the transcript).

## Step 4 port C7

- No code. The judge of floor 19 is the first live line with `levelRise`
  (spine port 4: `steppedLevel` applies `encounterLevel` of `levels` to
  a table roll, leader and fillers alike, never to a pinned override). Its
  counter `flag:tomb:taken` is read when the line spawns.
- The roadstead's crew is the second live approach after the harbor's
  picket: three reads on floor 18 leave the crew surprised. The first
  combat tick is the arrival tick (port C3), so the player's first blow,
  which a surprised formation hands the player, spends the front member's
  surprise in that tick.

## Step 4 port F: the statue rules

Port of old `combat.ts` 1700-1870 (`isStatue`, `standing`, `throwRubble`,
`standAside`, the statue half of `onKill`), 3950 (a statue whose condition
ran out leaves unbroken), 4145 (`standAside` after the ability's tick) and
4841 (a statue does nothing in the enemy phase). Only Facet's Basilisk Hide
and its branches apply a statue condition (`petrified`, `petrified_rubble`,
`petrified_standing` of `statuses`, field `statue`: `rocks`, `burst`,
`chunks`, `xp`, `stands`).

- **Behind a fight flag.** `Fight.statues` (optional, absent until set) says
  an enemy of this fight has held a statue condition. Every statue read is
  made only in such a fight, so a fight without one reads nothing more than
  before the port and draws the generator the same way. Set by the request
  `combat/statue-landed` (the ability's host makes it where its dose turns an
  enemy to stone, inside the handler) and, for a statue condition that came
  by another door, by the enemy condition tick, where the skip
  `combat/statue` of the spine port stood.
- **A statue does nothing**: the enemy phase skips it; its bar does not even
  fill.
- **Left alone**: when its condition runs out (the enemy condition tick), it
  leaves unbroken (`onKill` with `gone`): rocks at max HP x `burst` (Rubble
  0.5; the others 0, "crumbles away").
- **Broken**: killed while it holds the condition, it throws rocks at max
  HP x `rocks` (1; Stoneskin 0) at the living enemies behind it (higher
  slots, statues left out), split evenly, half Piercing and half Slashing,
  through each one's armour and resistance (`monsterSlice`); no condition
  bite, no graft harvest, no hit event, as the old `throwRubble`. Each enemy
  hit is told to the fight hooks (`FightHook.rocks`, the old
  `facetSignal('rocks')`); Rubble puts Stone on it. The rocks' kills are
  swept inside the kill, before the line is read for survivors.
- **Pay**: Stone Chunks are gold: the monster's gold x gold gain x `chunks`
  (0.5; Rubble 0). XP x `xp` (0.5), level XP from the same number. No drop
  table. The kill line is "🗿 The <name> (level <n>) is broken / bursts /
  crumbles away: Stone Chunks worth <g> gold."
- **Standing statues** (Stoneskin): one in the centre slot trades places
  with a random enemy still fighting (`standAside`, after the ability's
  tick, before the front is read). When only standing statues remain, the
  fight is won and each crumbles as it ends; the last closes the fight. After
  a kill in the centre, the enemy that steps forward is drawn from the
  enemies still fighting (without statues: every survivor, as before).

Spec: `tests/facetAbilities.test.ts`, "Basilisk Hide" (old
`basiliskHide.test.ts` and `basiliskEvolve.test.ts`).

