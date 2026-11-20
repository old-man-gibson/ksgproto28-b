# facet

The run's unique ability, as FACET documents: step 3, port 10. Port of old
`src/core/facet/` (`host.ts`, `signal.ts`, `quantities.ts`, `load.ts` and
the core loader), the Facet parts of `game.ts` and `state.ts`, the Ability
tab (`AbilityPanel.svelte`), the evolution window (`EvolveModal.svelte`) and
the old tests `facet`, `solarCharge`, `zenkai`, `littleMoons`, `bramble`,
`basiliskHide`, `basiliskEvolve`, `weakestWeaponMaster`, `calorieBurn`,
`abilityReadout`. Source of truth: old KSG `main` (`7c1267b`), old
`docs/FACET.md`.

## The core is not in git

The FACET core (`facet.*.js`, `MANIFEST.json`) comes from the Facet
repository (`C:\Users\mersi\Documents\Facet`, private, no remote). This
repository is public, so the core is never committed: it lives in
`src/systems/facet/core/`, which `.gitignore` names, and `npm run
facet:install -- <source>` copies it in (docs/SETUP.md). No commit of this
repository holds a core file.

- `core.lock.json` (in git) holds the sha256 of each core file this build
  was tested with. The install script refuses another version unless told
  `--any-version`; `tests/facet.test.ts` checks the installed files against
  it.
- `load.ts` loads the folder with `import.meta.glob`, which is empty when
  the folder is missing. `CORE` says whether every core module and the bank
  loaded.
- Without the core: the build, the tests and the game run. `facet/switch`
  on, `facet/grant` and the other commands answer `Facet core not
  installed`; `?facet=on` shows that in a notice and stays off; the view
  reads off; every hook returns at its first line. A save switched on with a
  held ability, loaded in a build without the core, keeps its documents
  untouched and runs nothing; its carrier statuses have no definition and
  give no modifier. The tests that need the core are skipped and
  `tests/facet.test.ts` prints one test that says so;
  `tests/facetMissing.test.ts` runs only then.

## Tentative (user, 2026-11-20)

The user has not decided whether the rebuild includes Facet abilities. So:

- **Off by default.** A new save holds `{ on: false, docs: [], queued:
  null, fallen: null }`. Off, no ability can be granted, the Ability tab is
  not listed, and nothing calls a step of the core: every hook below
  returns at its first line when no document is held.
- **The switch.** Open the game at `?facet=on` (dev server:
  `http://localhost:5600/?facet=on`). The overlay sends `facet/switch`
  once; the switch is saved with the game. `?facet=off`, or the button
  "Switch Facet abilities off" on the Ability tab, turns it off: the held
  ability and its carrier statuses go. In code and tests: the command
  `facet/switch { on }`.
- **Removal.** Delete this folder, `tests/facet.test.ts`,
  `tests/facetAbilities.test.ts`, `tests/facetReplay.test.ts`,
  `tests/facetMissing.test.ts`, `tests/facetHelpers.ts`,
  `tests/fixtures/facet/` and `scripts/install-facet-core.mjs`, and revert
  the lines listed in "Lines outside this folder". Or revert the branch's
  commits.

## Lines outside this folder

Each hook is generic (a registry or an event) and does nothing until a
system registers or listens. Every one is marked "step 3, the Facet port"
in its comment.

| File | Lines | What |
|---|---|---|
| `src/systems/combat/actions.ts` | `PickedActive.takesFill`; section "the run's ability": `FightHook`, `registerFightHook`, `fightHooks` (+37) | The three points the old tick called the ability by name. |
| `src/systems/combat/engine.ts` | import `fightHooks`; `runCombatTick`: the hook `tick` after the enemies' minds and the defeat it names after the sweep (+9); `playerPhase`: the hook `barFill` after the `barFill` condition hook, `takeFill` and `takesFill` before the fast, hand and to-hit checks (+9); `ABILITY_RUN` and `abilityStrike` before `landBurst` (+40) | Old `facetCombatTick`, `facetSignal('barFill')`, `queuedAct`, `useFacetAction`, `abilityStrike`. |
| `src/systems/combat/index.ts` | import `abilityStrike`; request `combat/ability-strike` and its answer (+17) | Damage an ability deals to an enemy. |
| `src/systems/resources/index.ts` | `DamageWatch`, `registerDamageWatch`, one loop in `applyDamage` (+18) | Old `facetSignal('hitTaken')` in `damagePlayer`: told inside the handler that dealt the blow, so an answer lands before the enemy phase goes on. |
| `src/systems/attributes/index.ts` | `type Ctx` import; `XpRouter`, `registerXpRouter`; one line in the `attributes/grant-xp` handler (+18) | Old `setXpRouter` (Weakest Weapon Master's XP past the ceiling). |
| `src/systems/consumables/index.ts` | `defineEvent` import; event `consumables/used`; `useItem` takes `direct` and emits it; the command passes `direct` (+13, -3) | Old `facetSignal('itemUsed')` in `Game.useConsumable` and `facetSignal('eat')` in `useConsumable`. |
| `src/ui/panel.ts` | `PanelDef.shown` (+2) | A panel listed only while its view says so (old: the Ability tab was on the tab bar while an ability was held). |
| `src/ui/App.svelte` | `listed` filters `panels` by `shown` (+3, -2) | The navigation and the active panel read `listed`. |
| `.gitignore` | `src/systems/facet/core/` and its comment (+5) | The core stays out of git. |
| `package.json` | script `facet:install` (+1) | Runs `scripts/install-facet-core.mjs`. |
| `scripts/install-facet-core.mjs` | new file | Copies and checks the core. |
| `docs/SETUP.md` | new file; section "The Facet core" | How to install the core. |

Tests outside this port's own files: `tests/conditionResist.test.ts`, "exactly
these thirteen are marked" leaves out ids that start with `fc_` (+2, -1);
`tests/outcomeDigests.ts`, the state hashes recorded again (the new slice).

The existing hooks the port uses without a change: `registerPlayerAction`
(`facet:` entries), `combat/fight-started`, `combat/kill`,
`combat/fight-won`, `combat/fight-closed`, `alchemy/flask-used`,
`spellcraft/cast`, `statuses/apply`, `statuses/remove`, `statuses/set-dose`,
`resources/heal-now`, `resources/spend-now`, `mercy/proc`, the `STATUSES`
table (old `defineStatus` wrote the old table the same way), and the status
fields `combat`, `martial` and `stats` already read (`pureBlows`,
`unarmedRider`, `parryContest`, `blowCut`, `drillsAll`, `repMult`,
`attrCeiling`, `contest`, `escalatesTo`).

## Files

| File | Holds |
|---|---|
| `core/` | Not in git. The core files and their `MANIFEST.json`, copied by `npm run facet:install`. Never edited here. |
| `core.lock.json` | The hashes of the core version this build was tested with. |
| `load.ts` | Loads `core/` with `import.meta.glob`; `CORE`, `NO_CORE`, `CORE_FILES`. `facet.cases.js` (the core's corpus) is loaded by `tests/facet.test.ts` only. |
| `facet.d.ts` | Types for the members of `globalThis.Facet` this game calls (old `src/core/facet/facet.d.ts`). |
| `state.ts` | The slice and the refs (`player`, `foe:<slot>`, `facet:<key>`). |
| `quantities.ts` | Every number a document may read, by shared id. One row per stat key. |
| `host.ts` | The adapter `Facet.install` takes, the context stack, `bind`, the bank's status definitions. |
| `index.ts` | The declaration: commands, requests, events, the hooks registered with other systems, the tick, the view. |
| `AbilityPanel.svelte`, `panel.ts` | The Ability tab. |
| `FacetOverlay.svelte`, `overlay.ts` | The switch from the address; the evolution window. |
| `FactLines.svelte` | "Label: fact" lines. |

## Slice

| Field | Holds |
|---|---|
| `on` | The switch. |
| `docs` | The run's ability, at most one (old `state.facets`). A document carries its cells' values, so the slice saves the ability. A new run starts empty (old: prestige started a new state). |
| `queued` | The action pressed for the next bar fill (old `CombatState.queuedAct`). Cleared when a fight closes. |
| `fallen` | A defeat the ability asked for (old `CombatState.fallen`), settled by the next fight tick. Cleared when a fight closes. |

Version 1, `tests/fixtures/facet/v1.json` (the new slice: the fixture
holds no bank document, so no core text is in git). `migrations.ts` is
empty.

## The core and the host

The core is one global, `globalThis.Facet`, with one installed host. A
host member reads and writes through the context of the handler that
called into the core: `withCtx(ctx, fn)` pushes it, the members read the
top. A view pushes a read-only frame (`withReads`); a member that changes
the game throws there.

The core keeps the attached documents per ref. `bind` attaches the slice's
documents when the core holds another slice's: a load, a new run, or a
second kernel in the same process (the tests, catch-up on the main thread)
hands it another slice object (old `bindFacets`). Attaching changes nothing
saved: cell values live in the documents, carrier statuses in `statuses`.
Its runtime record (`once`, `events`) is not saved and starts empty at each
attach; no bank document reads it.

Every status the bank's documents define is registered in `STATUSES` at
module load (`registerBankStatuses`), so a saved carrier has its definition
before anything reads it. The old build rebuilt the definitions at attach
and dropped every `fc_` status when the core failed to install.

The core uses no `Math.random`, `Date` or `performance.now`
(`tests/facet.test.ts` scans the files). Chance goes through the kernel
generator (`rand`, `pick`, `weightedPick`) and the mercy ledger (`proc`,
`curveRate`); no bank document draws.

| Member | Here |
|---|---|
| `now` | Clock ticks (`clock.totalTicks`). |
| `resolve` | `self`/`party`: the player. `enemy`: living enemies in slot order, statues left out. `arena`: both. |
| `readQ` | The player: `quantities.ts`. An enemy: `fighter.boss`, `fighter.level`, else 0. |
| `applyStatus` | `statuses/apply` on the entity a ref names. A dose that turns an enemy to stone raises `statue`. |
| `setStatusIntensity` | `statuses/set-dose`, keeping the clock. |
| `setStatusStacks`, `setStatusData` | Skip log `facet/stacks`: no bank document holds a set. |
| `applyDamage` | `combat/ability-strike` on an enemy; 0 on the player. |
| `applyHeal` | `resources/heal-now`, kind `other`. |
| `spendPool` | `resources/spend-now`: stamina, mana, spirit, focus. |
| `defeat` | Marks `fallen` while a fight is open. |
| `overrideQ` | Throws (old K3). |
| `log`, `offerEvolution` | `log/line`. |

## Events the ability hears

| id | Raised from |
|---|---|
| `fightStart` | `combat/fight-started` (`enemies`, `maxLevel`) |
| `kill` | `combat/kill` (`level`, `boss`) |
| `fightWon` | `combat/fight-won` |
| `fightEnd` | `combat/fight-closed` (`won`) |
| `hitTaken` | the damage watch of `resources`, inside the handler that dealt the blow (`amount`, `blow`, `type`, `attacker`, `self`, `boss`) |
| `barFill` | the fight hook `barFill` |
| `act` | `facet/use-action`: the rotation's `facet:<key>` or the pressed button |
| `flaskUsed` | `alchemy/flask-used` |
| `itemUsed` | `consumables/used` with `direct` (the command) |
| `eat` | `consumables/used` of a dish with calories (`dishCalories` of `cooking`) |
| `miracleCast` | `spellcraft/cast` by the player, school divine, with a deity, in a fight |
| `statue` | the host's `applyStatus` |
| `hit`, `crit`, `dodge`, `parry`, `graze`, `enemyCast`, `rocks` | Not raised. No bank document listens to the first six; `rocks` needs the statue rules (Left behind). |

`kill`, `fightWon`, `fightEnd`, `fightStart`, `flaskUsed`, `itemUsed`,
`eat` and `miracleCast` arrive after the handler that raised them returns,
in the same tick (the old bus called the listener at once). No bank
document reads them in a way that changes within one tick.

## Requests this system answers

`facet/fight-tick`, `facet/bar-fill`, `facet/take-pressed`,
`facet/use-action`, `facet/hit-taken`, `facet/route-xp`. Each is made by a
hook this system registered with another system, inside that system's
handler.

## Commands and skip reasons

| Command | Refused when |
|---|---|
| `facet/switch { on }` | on without the core (`Facet core not installed`); it is already in that position |
| `facet/grant { id }` | the core is not installed; the switch is off; the id needs a system not ported (`shadow_clone`); the bank has no such id |
| `facet/choose-option { v }` | the held ability offers no choice; no option `v`; the choice cells are missing |
| `facet/press { key }` | no fight is open; no ability is held; the action is not ready |
| `facet/evolve { key }` | no evolution is on offer; the key is not on the offer |
| `facet/set-cell { key, share }` | no held ability has the cell (old `debugSetCell`; the tests use it) |

The other commands answer `Facet core not installed` first when the core
is missing. `facet/stacks` (skip log): a document wrote a set cell.

## Ported

- Solar Charge with its tiers (20% Cold and Poison resistance, 40% Heat on
  unarmed blows through `unarmedRider`, 60% the minute heal, 80% Sun Blast as
  a rotation entry and a pressed button).
- Zenkai, with the fight events and its taints (flask, consumable, miracle).
- Little Moons (strikes through `combat/ability-strike`, the boss count).
- Bramble (thorns from blows, seconds and your own Poison spells; the
  answer through `combat/ability-strike`; the slow through the carrier; the
  attacker the thorns kill is swept by `answeredToDeath` in the enemy
  phase).
- Basilisk Hide: Stone on the attacker (Earth resistance, the CON contest),
  the slow, the escalation into the statue condition, the `statue` count,
  the evolution offer and pick (saved on the document), the three branches
  as documents (Gorgon's Gaze acts in full).
- Weakest Weapon Master: the ceiling (the `attrCeiling` fact of `stats`),
  XP past it into hidden levels (`registerXpRouter`), the reps carrier
  (read by `martial`), Power, the four stances (read by `combat`), the
  stance picked at the next bar fill.
- Calorie Burn: calories from a dish, the store, too full, the burn, the
  bonus, the cutoff choice, the max HP debt, the collapse as a knockout with
  its cause.
- The Ability tab: description, cells, bars, inputs, actions, conditions,
  evolution, the choice row, the grant rows. One ability per run.

## Left behind

- **Statue rules in combat** (old `combat.ts` 1700 to 1870, `isStatue` in
  the enemy phase, the crumble on expiry, `throwRubble`, `standAside`, the
  Stone Chunks payout, the win when only standing statues remain). The
  combat port left them as an extension point because no monster of floors
  0 to 6 has the rule; only Basilisk Hide applies the statue conditions.
  Without them a Petrified enemy is blocked and slowed to 0 for 3 s (the
  condition's own `blocks` and `mods`), then fights again; nothing breaks
  into rocks, nothing pays Chunks, Rubble's rocks and Stoneskin's standing
  statues do nothing, and `world.statues` stays 0. Combat still reports a
  statue condition once per fight (`combat/statue`). The old tests are
  `it.todo` in `tests/facetAbilities.test.ts`.
- **Shadow Clone**: its clones are old `systems/clones.ts` (deployment,
  `tickClones`, bench and activity buttons, recall), a system not ported.
  The grant refuses it.
- **The hold of play** while an evolution waits (old `Game.tick`, bonus
  time banked). The window shows; play goes on under it.
- **The sidebar lines** of the cells that act now: the rebuild has no
  sidebar. The Ability tab shows every cell; the status list leaves the
  carriers of shown cells out, as the old sidebar did.
- **The debug panel's Charge and Statues buttons**: `facet/set-cell` exists
  as a command; no button sends it.
- `hit`, `crit`, `dodge`, `parry`, `graze`, `enemyCast` events: no bank
  document listens.

## Differences from the old build

- The choice row (stances, the cutoff) is on the Ability tab; the old build
  drew it on the Combat tab under the stance grid.
- The switch exists (old: none; the debug panel granted).
- The status definitions of the bank are registered at load, not at attach.
  A carrier whose definition harms (`harmOf` of `statuses`) carries `unresistable: "the run's ability holds it on you"`, so the status
  lint reads it as marked. A carrier is only ever applied to the player by
  the ability, which no resistance answers, so the field changes no
  outcome. The carrier of a cell the Ability tab shows is `hidden`.
- Ability strikes go through a request, so the kill is swept at the old
  sweep points, the same as before.

## Old rules ported as they are

- Calorie Burn's `defeat` with outcome `dead` ends the fight as a death with
  knockout consequences; no document uses it.
- `itemUsed` is raised for any direct use of a consumable, a recipe card
  included; Zenkai counts that as a consumable in the fight.
- `miracleCast` is raised for a divine cast with a deity in a fight, also
  one that is not prepared as a miracle by name (old `miracleSynergy`).
- A carrier with value 0 is held at intensity 0; the stance fields act only
  above 0 (`heldWith`), so a stance with Power 0 does nothing.
- `spendPool` is in the host though no bank document spends since Little
  Moons' cost was removed (user, 2026-11-03).

## Tests

`tests/facet.test.ts` (the installed core against `core.lock.json`, the
corpus, the host, the switch, save and load, two kernels in one process,
Solar Charge), `tests/facetAbilities.test.ts` (every ability),
`tests/facetReplay.test.ts` (determinism with an ability held): skipped
without the core. `tests/facetMissing.test.ts`: only without the core. Changed from the old tests
where the skeleton changed the call: a blow goes through `resources/hit`,
events through `emit`, a minute through ten ticks, `debugSetCell` through
`facet/set-cell`. Not ported: the old host-member tests for `spendPool`
and `applyDamage` on the player (no document reaches them); the martial
rung tests (in `tests/martial.test.ts`); `nav.test.ts` parts for the tab
(the shell lists panels by `shown`, read through `facetListed`).
