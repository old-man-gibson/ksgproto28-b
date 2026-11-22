# alchemy

The Alembic: ordinal sequence crafting, the flasks it makes, weapon oils,
and using a flask in and out of a fight. Step 3.

## Step 3 design

Written and committed before the code. Old sources: `systems/alchemy.ts`,
`data/alchemy.data.ts`, `text/alchemy.text.ts`, the `alchemy.*` lines of
`text/log.text.ts`, the alchemy record of `data/disciplines.data.ts`, the
discipline framework `systems/disciplines.ts` and the bench run
`systems/benchwork.ts` as far as the Alembic uses them, the non-food half of
`systems/consumables.ts`, `ui/lib/benchLayouts.ts`, the Alembic half of
`ui/panels/BenchPanel.svelte` and the Satchel of `ui/panels/EquipmentPanel.svelte`.
Spec: old `docs/ALCHEMY.md`, guide: old `docs/BREWING.md`. Old
`docs/ALCHEMY_REVIEW.md` is an unanswered review and is not ported.

### System folders

Three new systems.

| Folder | Holds | Why a system of its own |
|---|---|---|
| `benches` | The discipline registry, slots and placements, the layout check, the outcome match, spending a placement, novelty keys, and the bench run (old `benchwork.ts`). | Shared by alchemy, cooking, smithing, mutagens and runecarving in the old build. Cooking and the anvil plug in here later. |
| `alchemy` | Reagents, forms, formulas, `composeBrew`, the flask list, the coating, using a flask, the Alembic panel with the Satchel. | The system itself. |
| `consumables` | Using a held material that has a `consumable` record: restore, grants, cures, cooldowns, cards (recipe, word, technique, stamp, votive), `cardSpent`. A Provisions panel. | Shared by alchemy's shop goods (the healing salve), cooking's dishes, and the cards of martial, arcane and divine. |

### `benches`

Slice version 1: `{ job: BenchJob | null }`. `BenchJob` is the old
`state.benchWork`: `discipline`, `spot`, `placement`, `remaining` (null:
until stopped), `ticksLeft`, `ticksPer`, `batch`, `done`. `duration` and
`forge` wait for cooking and smithing.

Content: `disciplines`, one record now (`alchemy`, the old record with its six
`step` slots and its one outcome `brew`). A later port adds its records. The
schema carries the fields the old type had that the Alembic reads: `name`,
`benchName`, `icon`, `verb`, `skill`, `tag`, `ordered`, `work.skillScaled`,
`work.per`, `ticks`, `xp`, `slots[]` (`id`, `name`, `role`, `accepts`,
`optional`, `unlockLevel`, `station`, `picks`, `consumed`), `outcomes[]`
(`id`, `name`, `icon`, `requires[] { tag, count }`, `result.kind`,
`minLevel`, `recipe`, `minQuality`, `maxQuality`, `priority`). `timeline` and
`heat` (cooking), `assembles` and `refines` (smithing, mutagens) wait.

Reads, pure over a reads context: `openSlots`, `nextSlot`, `slotAccepts`,
`slotPicks`, `slotConsumes`, `checkCraft` (old, without heat windows),
`matchOutcome`, `consumedParts`, `noveltyKeys`, `benchJobTicks` (old,
without the timeline and the anvil), `benchPace`.

The owner of a bench registers it at module load:
`registerBench(discipline, { preview(reads, placement), craft })`. `preview`
answers `{ ok, reason? }` (old `benchPreview`); `craft` is a request
definition the owner answers with `{ placement } -> boolean` (old
`benchCraft`). `benches` does not import its owners.

Commands:

| Command | Old | Refused when |
|---|---|---|
| `benches/start { discipline, placement, count }` | `startBenchWork` | unknown discipline or no registered owner; the spot has no such bench; the owner's preview refuses (the reason is logged as the old `common.locked` line) |
| `benches/stop` | `stopBenchWork` | no run is going |

`benches/start` clears the activity with the new world request
`world/drop-activity` (old: `state.activity = null`, progress 0) and emits
`world/player-command`, which ends a knockout return in flight (old
`tickKnockoutReturn` dropped the return when it saw a bench run). It logs
the old "started" line for a run of more than one.

Tick (`order: 15`, after `combat`): old `tickBenchWork`. Stops with "left
behind" when the spot changed or a journey is under way, "interrupted" when
a fight is open, else counts down, and at zero asks the owner's `craft`
request `batch` times; a refusal stops the run "out of stock"; `remaining`
reaching 0 stops it "finished". Each craft that returns true emits
`benches/crafted { discipline }` (the old bus event `craft`, which quests
heard).

Heard: `world/activity-changed` with an activity: the run is dropped with no
line (old `selectActivity` set `benchWork = null`).

`layouts.ts`: the last layout per bench for the session (old
`ui/lib/benchLayouts.ts`), pure, used by the panel.

### `alchemy`

Slice version 1:

| Field | Old |
|---|---|
| `flasks: { steps: GradedStack[] }[]` | `state.flasks` |
| `coating: { brew, weaponUid, blowsLeft } \| null` | `state.coating` |
| `flaskReady: number` | `state.useCooldowns.flask` (the tick the shared flask clock opens) |

The flask clock leaves the shared `useCooldowns` map: `consumables` owns
that map, and the old map never had another reader of the key `flask`.

Content: `reagents` (15 records: menstruum, essence, act, `minLevel`, `desc`),
`brew_forms` (7), `brew_formulas` (4), `alchemy_text` (log and reading
lines). Converted from the old literals.

Pure (`brew.ts`): `composeBrew`, `formOf`, `resolveBrew`, `brewGrade`,
`sequenceOf`, `knownReagents`, `formulaFor`, and `checkBrew(level, stock,
placement)`, which is `previewBrew` over plain inputs so the panel and the
request run the same check. The constants of the old file, unchanged.

Bench: `registerBench('alchemy', { preview, craft: brewRequest })`.
`alchemy/brew { placement }` answers the old `brew`: check, spend through
`materials/take-graded` (put back on a failed take), push the flask,
`skills/check-discovery ['alchemy']`, `skills/grant-xp ['craft','alchemy']`
`13 x (1 + 0.2 x steps)` with the novelty keys, the "Brewed" tally line
(`log/line` with `group` and `tally`).

Command `alchemy/use-flask { index }` (old `useFlask`). Refused: no such
flask; residue; an oil with no weapon in hand; a thrown form with no fight;
the clock. Otherwise the flask is taken off the list, the clock set
(`FLASK_COOLDOWN` 60 ticks), and:

- thrown (`hurl`): one feed line, then per enemy slot (front 1, others 0.5):
  each strike rolled `0.9 + next() x 0.2`, sliced with `monsterSlice` on the
  monster's stat block; strike riders applied with the strike's penetration
  when the slice dealt damage; then the form's afflictions with the brew's
  penetration; then the total lands through the new combat request
  `combat/land-burst` (bite of the target's conditions, at least 1, HP,
  `lastHit`, `damageTaken` fired with no detail: the old `hurl`, which did
  not write the ledger or run the graft harvest), and its feed line. Then
  `skills/grant-xp ['combat','craft','alchemy'] 4` and the new request
  `combat/sweep` (old `sweepDead`).
- oil (`anoint`): `coating` set on the wielded weapon's uid with the brew's
  blows; the log line names a wiped coating.
- the rest (`swallow`): cures first (`statuses/fire` `cure` with each tag,
  the names of what left), then restore (`hp` through `resources/heal-now`
  with kind `salve` or `draught`, the other pools through the new
  `resources/restore-now`), then grants (`statuses/apply`, not resisted),
  then the drank or applied line.
- `attributes/grant-xp int 1` for every use.

The coating: `registerBlowRider('alchemy/coating')`. `perHit` asks the
request `alchemy/spend-coating` (old `spendCoating`: one blow off the coating
on the weapon in hand, cleared at 0) and returns the brew's strikes as
slices named by the brew. `afterBlow` returns the brew's afflictions and the
source. The old weapon path also spent a blow in its second weapon path
(`combat.ts:4630`, floating grips); here there is one weapon path.

View: `level`, the open steps and the next one, every reagent with
`minLevel`, held grades and description, the flask list grouped by sequence
with the resolved spec and the use check, the coating, the clock, whether
the player stands at an Alembic, the current bench run of `alchemy`.

### `consumables`

Slice version 1: `{ cooldowns: Record<materialId, tick> }` (old
`useCooldowns` without `flask`).

Command `consumables/use { id, quality }` (old `useConsumable`, not
queued). Reads `consumableSpec`, `isCard`, `cardSpent(reads, spec)`,
`canUse(reads, id, quality)`, `heldConsumables`.

- Cards: `teaches` bumps `recipe:<id>` (cooking reads it); `unlocksWord`
  bumps `flag:word:<id>`; `teachesTechnique` asks `martial/learn` with
  `canonical`, held back while no known technique reaches its position;
  `stamps` bumps the key and emits `titles/check`; `votive` bumps
  `votive:tokens`, and on the first asks `divine/grant-favor-all 2` and bumps
  `votive:baseline` by 2, else bumps `favor:floating`.
- Not food: restore `(flat + ofMax x availableMax) x grade` (hp heals as kind
  `salve`; a negative amount at refuse grade takes, never under 0); at
  refuse grade the spoilage condition `queasy` is applied, resisted, in
  place of the grants; else each grant scaled by grade; cures; the
  cooldown; the used line.
- Food (`food: true`): refused with a reason. Eating (cook scaling,
  signatures, meal slots, the eating queue, Iron Stomach's counter) is the
  cooking port.

`cardSpent` is handed to `world` through the new hook
`registerCardSpent(check)` in `world/engine.ts`, so an activity drop of a
one-time card is not rolled once its effect happened (old
`rollActivityDrops`). `world` cannot import `consumables`: `martial` imports
`world`.

### Requests and events between the systems

New in other folders (each the smallest addition):

| Folder | Addition | For |
|---|---|---|
| `world` | request `world/drop-activity` (activity null, progress 0, pace, `world/activity-changed`); `registerCardSpent` | `benches/start`; `consumables` |
| `resources` | request `resources/restore-now { id, amount }` answering the signed change; a negative amount takes, never under 0 | flasks, consumables |
| `combat` | requests `combat/land-burst { entity, slices, source }` and `combat/sweep` | the thrown flask |
| `quests` | heard: `benches/crafted` advances `craft` objectives by discipline | old `bus.on('craft')` |

### Panels

- Alchemy (`alchemy/panel.ts`): at a spot with an Alembic, the strip of open
  steps (click a step, then a reagent and grade from the list), the next step
  and its level, the reading (one line per step, the summary, the
  effects), Brew, x5, All, Keep going, Stop, Clear, the run's bar in a fixed
  box. Away from an Alembic, the names of the spots that have one. Always:
  the Satchel (grouped flasks, one use button each, the coating line, the
  clock). Every box has a fixed height; the run bar and the clock have
  reserved slots.
- Provisions (`consumables/panel.ts`): held consumables, best grade first,
  with a Use button and the refusal reason. Fixed row height.

Phone layout from the start; checked at desktop width and 375 px.

### Person and quests

`row_alchemist` (Odri Venn, the Reagent Shelf) and `row_apothecary` (Sister
Nim) are ported with `npcs` and `shops`. Neither has a quest or a lesson in
the old build. `faces_of_threshold` and `a_taste_of_everything` wait for
the last of the six system people.

No prestige boon belongs to alchemy. A new run starts with no flasks and no
coating (old `createInitialState`).

### Waits

- Cooking: food, the eating queue, meal slots, signatures, the cook's
  scaling, heat windows and the timeline, the `preparing` bench, recipe
  cards' effect on a bench (`recipe:<id>` is written here).
- Smithing, mutagens, runecarving: their benches and records in
  `disciplines`.
- Shadow Clones at a bench (`cloneCraft`), bonus time, performances.
- The festival's hold on flasks and the coating.
- Facet signals `flaskUsed`, `itemUsed`, `eat`.

## Files

| File | Holds |
|---|---|
| `defs.ts` | The registries `reagents`, `brew_forms`, `brew_formulas`, `alchemy_text`; `formulaFor`; the base and longest durations |
| `brew.ts` | The tuning constants, `composeBrew`, `formOf`, `resolveBrew`, `brewGrade`, `sequenceOf`, `knownReagents`, `checkBrew` (pure) |
| `index.ts` | The slice, the bench and blow-rider registrations, the requests, the command, hurl, anoint, swallow, the view |
| `AlchemyPanel.svelte`, `panel.ts` | The Alchemy panel: the Alembic and the Satchel |
| `content/*.json` | 15 reagents, 7 forms, 4 formulas, the text lines |

## Slice (version 1)

`{ flasks: { steps }[], coating: { brew, weaponUid, blowsLeft } | null,
flaskReady }`. Fixture `tests/fixtures/alchemy/v1.json`.

## Requests and commands

| Name | Kind | Old | Refused when |
|---|---|---|---|
| `alchemy/brew { placement }` | request (for `benches`) | `brew` | the check fails (logged as `🔒 <reason>`): `An alembic needs at least two reagents`; `<name> is not a reagent`; `<name> needs Alchemy <n>`; the bench reasons of `benches`; a take that fails puts back what was taken |
| `alchemy/spend-coating` | request (for the blow rider) | `spendCoating` | null: no coating on the blade in hand |
| `alchemy/use-flask { index }` | command | `useFlask` | `No such flask`; `Residue has no use`; `No weapon in hand to oil`; `Thrown flasks need a fight`; `Flask cooldown: <s>s left` (each also logged) |

## Changed while building (step 3)

- The design named `benches/crafted` as emitted by `benches` after a craft;
  the owner emits it inside its craft instead (the old order: the quest
  heard `craft` before the Brewed line).
- The design listed "the spot has no such bench" as a refusal of
  `benches/start`. The old `startBenchWork` did not check the spot; the
  rule is ported as it was (see the benches README).
- `combat`'s blow rider learned `null` against `[]`, so an oil of an
  essence with no damage type still reaches `afterBlow`.
- `materials` gained `consumable.cures` in its schema.
- The Satchel is in the Alchemy panel, not on the equipment panel as in the
  old build: one folder holds one panel.
- The Provisions button reads "Use"; the record's verb is the log line's.

## Old rules ported as they are

- The form text of Residue says "Discard or sell". No command discards or
  sells a flask, in the old build or here; residue stays in the Satchel.
- An oil of an essence with no damage type (Mendroot, Bloodwort) coats the
  blade, spends a blow per hit and does nothing else; its reading says so
  ("Not used by an Oil").
- Fixing Salt banks `quenched x max(0.2, grade)` and an ignite multiplies by
  `1 + (mult - 1) x max(0.2, grade)`: at refuse grade both still act at 20%.
- Mendroot's Elixir grants Well Fed, a food condition, at 0.5 x weight.
- Odri Venn sells Grain Spirit and Brimstone from the start; they need
  Alchemy 4 and 7 at the Alembic.
- A thrown flask's afflictions on a strike land only when that strike dealt
  damage; the Fume's afflictions land on every enemy regardless.
- The recipe card names its dish by the bench outcome of the recipe; with
  no cooking bench ported it names the dish material (same name).
- A thrown flask writes no fight-ledger line and sends no `combat/hit`
  (old `hurl`).

## Left behind

- The festival's hold on flasks and the coating (`festival.ts`).
- Shadow Clones at the Alembic, Facet signals `flaskUsed`.
- The `preparing` bench at the Alembics (cooking).
- `base_alchemy_lab` and its training activity: the player base is not in
  scope.
- `faces_of_threshold` and `a_taste_of_everything` (Odri Venn's talk
  objective, the Alembic's craft objective): after the last of the six
  system people. Odri Venn and Sister Nim have no quest or lesson.

## Step 3 (the cooking port)

- `brewRequest` takes an optional `duration` (the bench owner's craft
  payload since the stove); the Alembic ignores it.
- `alchemy/use-flask` emits `alchemy/flask-used { grants }` after the use,
  for every form. `meals` records the doses as claims (old `Game.useFlask`
  called `noteForeignDoses`).
- The `preparing` bench at the Alembics is ported with cooking.

## Tests

`tests/alchemy.test.ts` (the old file, 55 cases, plus one thrown-flask
case), `tests/benches.test.ts` (the bench run, the clock, the old
`benchLayouts` cases), `tests/consumables.test.ts` (the old rarefinds
consumable cases, the study card, the salve, food), the bench case of
`tests/knockoutReturn.test.ts`.


## Step 4 port C4

- `alchemy/hold`: takes the flasks and the coating off the player (the
  festival's door). `alchemy/return { held, weaponUid }`: the held flasks
  go before the ones the attempt left; the held coating comes back unless
  the blade in hand (`weaponUid`) carries the attempt's own.
