# divine

Miracles and the deities they come from: the registries, the spell a miracle
resolves to, how two deities stand toward one another, favour with each
deity, the gods a life knows, and receiving a miracle for favour. The panel
`DivinePanel.svelte` is the old Divine tab of the Spellcrafting Table.

Port of: `MIRACLES` of old `data/spellcraft.data.ts`, `data/deities.data.ts`,
all of old `systems/divine.ts` and `systems/deities.ts`, the known gods of
old `systems/unlocks.ts`, the favour of the old quest turn-in. Spine port 5
ported the registries and the relation; step 3 the rest, and the new system
`titles` (`src/systems/titles/README.md`).

Sections "Design" (port 5) and "Step 3 design" were written and committed
before their code.

## Design

### The cut

A miracle is not composed: its spell is stated whole in the registry.
Executing one in a fight needs the record, the deity id on the resolved
spell, and the relation between two deities (a miracle cast within 100 ticks
of a miracle of a friendly deity is multiplied by 1.25). Everything else in
the old modules is about standing with a deity.

Ported now (spine port 5):

| Old | Here |
|---|---|
| `MIRACLES` | Content `miracles`, whole. The spell is in the `spellSpecSchema` of `spellcraft`. |
| `DEITIES`, `DEITY_TAGS` | Content `deities`, `deity_tags`, whole. `art` is a file name. `PANTHEONS` is empty in the old data and is not a registry here. |
| `miracleSpec` | Registered with `spellcraft` (`registerSchool('divine')`). |
| `deityRelation`, `ruleMatches`, `declares` | `relation.ts`; given to the school registry as `relation`. |

Waits for step 3 (the divine port):

- Favour: `favorWith`, `grantFavor`, `spendFavor`, `grantFavorAll`,
  floating favour.
- Receiving a miracle: `checkMiracle`, `learnMiracle`, `devotionLevel`,
  `favorCost` and `minLevel` gates.
- The chapel and the pantheon shelf: `queryDeities`, `deityGroups`,
  `pantheonOf`, `deitiesInRelation`.
- The veto at preparation (`deityConflict`, a title that defies dogma).

### Why nothing ported now is rewritten then

- The registries are whole; step 3 adds no record field.
- `deityRelation` is ported whole and is the function the preparation veto
  will call.
- No state: this system's slice is empty. Step 3 adds favour with a version
  bump.

### The three workings of the witch doctor

`goblin_witch_doctor` (floor 6) casts `mud_poultice` (2 uses: heals every
other living enemy for 1.5 x its spell power), `vermin_swarm` (3 piercing
hits of 0.4, each with a 25% chance of `punctured`) and `cinder_curse` (one
heat strike of 1.2 with a 60% chance of `on_fire`). They resolve through
the monster kind `cast` of `spellcraft`. With no kin standing,
`mud_poultice` is passed over and the supply is not spent.

### Content

Written by `node scripts/convert-content.mjs miracles deities deity_tags`:
30 miracles, 11 deities, 44 deity tags.

- Three old deity tag ids hold a space (`goblin pantheon`, `foai pantheon`,
  `yolixoch pantheon`). A record id here is the slug; the field `tag` is the
  old id, which deities and relation rules name. `DEITY_TAGS` is keyed by
  `tag`.
- Seven miracles of the old data are stated with an empty spell name and a
  cooldown of 0 (`tuigamalas_mighty_stick`, `spear_and_fang`, `atomic_state`,
  `desired_sound`, `fourth_fire`, `fourth_twice`, `fourth_crush`), and
  `sproutbringer` with a cooldown of 0. They are ported as they are; the
  schema of a stated spell allows both.

## Step 3 design

Written before the code (2026-11-17). Old sources read at `7c1267b`:
`systems/divine.ts`, `systems/deities.ts` (all), `systems/titles.ts`,
`data/titles.data.ts`, `text/titles.text.ts`, the known gods of
`systems/unlocks.ts` (`STARTER_DEITIES`, `meetDeity`, `deityKnown`), the
turn-in of `systems/quests.ts`, the votive card of
`systems/consumables.ts`, `dogmaDefied` and `deityConflict` of
`systems/spellcraft.ts`, the title modifiers of `systems/attributes.ts`,
the title immunity of `systems/statuses.ts`, `HOLY_DAYS` of
`data/climate.data.ts` and its readers (`systems/clock.ts`,
`systems/chronosense.ts`), `data/npcs.data.ts` and `text/npcs.text.ts`
(`chapel_priest`), `data/quests.data.ts`, the Divine tab of
`ui/panels/SpellcraftPanel.svelte`, `ui/panels/AchievementsPanel.svelte`
(the titles half), the divine log texts of `text/log.text.ts`, and the
test files `spellcraft.test.ts` (browsing the powers, the pantheon),
`onboarding.test.ts` (the known gods), `rarefinds.test.ts` (the votive
token), `goblins.test.ts`, `titles.test.ts`, `training.test.ts`.

### What the old build had

- Favour per deity (`state.favor`), earned on every quest turn-in
  (`grantFavorAll(1 + rewards.favor)`, known gods only) and by the votive
  token (consumables), spent once per miracle.
- `learnMiracle`: the check (`checkMiracle`: exists, not held, Devotion
  level, favour), the spend, the grimoire entry, the counter
  `miracles:learned`, discovery and 20 skill XP to
  `['spellcraft', 'magic', 'divine']` with the novelty key
  `divine:<id>`, the log line.
- The known gods: `denjalle` and `usvylgr` from the start, the rest by the
  counter `met:deity:<id>` that `meetDeity` sets. `meetDeity` has no
  caller in the old build but tests.
- Floating favour: the counter `favor:floating`, placed one at a time on a
  known god (`assignFloatingFavor`).
- The shelf: `queryDeities`, `pantheonOf`, `deityGroups`,
  `deitiesInRelation`.
- Titles: a general system (11 titles), one of which (`iconoclast`,
  10 miracles learned) waives the deity veto while worn.
- Holy days: four dates of the calendar. Their only reader besides the
  clock is the chronosense line "a holy day". The old build applies no
  divine rule on a holy day. Nothing to port in divine.
- No prestige boon reads or writes anything divine.

### What is ported, and where

| Old | Here |
|---|---|
| `favorWith`, `grantFavor`, `spendFavor` | `divine` slice field `favor`, functions in `favor.ts`. |
| `grantFavorAll` | Request `divine/grant-favor-all { amount }`. Quests asks it at the old spot of the turn-in, so the favour line is logged before the "completed" line, as the old order. |
| `devotionLevel`, `checkMiracle`, `learnMiracle` | `favor.ts` (check), command `divine/learn { miracle }`. The book entry through `spellcraft/add`. |
| `STARTER_DEITIES`, `deityMetKey`, `deityKnown`, `meetDeity` | `favor.ts`; `meetDeity` is request `divine/meet { deity }` answering a boolean, for the later encounter and consumables ports. |
| `floatingFavor`, `assignFloatingFavor` | Read of the counter `favor:floating`; command `divine/assign-favor { deity }`. |
| `queryDeities`, `pantheonOf`, `deityGroups`, `deitiesInRelation`, `PANTHEONS` | `shelf.ts`. `PANTHEONS` stays an empty, writable record, as the old one (a test writes to it). A pantheon read from a membership tag carries the tag's old id (`goblin pantheon`), as the old one did. |
| `quests.ts` turn-in favour | `quests` asks `divine/grant-favor-all` with `1 + rewards.favor`. |
| `chapel_priest` (Prior Ashvane, the Nine Chapels, talk only) | A record in `npcs` content and its text. |
| Titles (`titles.ts`, `TITLES`, the title modifiers, the title immunity, `dogmaDefied`) | A new system `titles` (below). |
| The Divine tab | Panel `divine/panel.ts`, "Divine". |

### Titles

New system folder `src/systems/titles/`. Port of `systems/titles.ts`,
`data/titles.data.ts` with its text, the title half of
`collectBaseMods` (`systems/attributes.ts`), the title half of the player's
immunity (`systems/statuses.ts`) and `dogmaDefied`.

- Slice version 1: `{ earned: string[], worn: string | null }`. Fixture
  `tests/fixtures/titles/v1.json`.
- Content `titles` (11 records) with `unlock` (the condition schema of
  `counters`), `passive`, `equipped` (the modifier schema of `stats`),
  `immune { ids?, elements? }`, `secret`, `defiesDogma`, `desc`. Written by
  a new job of `scripts/convert-content.mjs`.
- Modifier source `titles/held`: every earned title's `passive` labelled
  `Title: <name>`, the worn title's `equipped` labelled
  `Title: <name> (worn)`, origin `title`; an earned title's `immune` as
  `namedFact('statusImmune:<id>', 1)` and
  `namedFact('statusImmuneElement:<type>', 1)`; the worn title's
  `defiesDogma` as `namedFact('defiesDogma', 1)`. Player only.
- The unlock check (`checkTitleUnlocks`) runs on the event `titles/check`.
  The old build checked on `attr:levelup`, `skill:levelup`, `kill`,
  `quest:complete`, `achievement`, `craft`, `arrive`,
  `superattr:unlock`, and by direct call from consumables and the festival.
  Here `titles` hears `attributes/levelup`, `skills/levelup`,
  `combat/kill`, `quests/completed`, `world/arrived` and emits
  `titles/check` for each, so the check runs after the counter bumps the
  same handler queued (combat bumps `kills` after it emits the kill). The
  later ports (achievements, crafting, super-attributes, consumables,
  festival) emit `titles/check`.
- Command `titles/wear { title: string | null }`: the old `setTitle`. An
  unearned title, an unknown id, or the title already worn returns a
  reason (old: silent).
- The veto: `spellcraft/set-prepared` skips `deityConflict` while the
  player's fact `defiesDogma` is 1. `spellcraft` reads the fact through
  `factValue` and imports nothing of `titles` (a `titles` import would make
  a module cycle: titles hears quests, quests asks divine, divine imports
  spellcraft).
- Panel `titles/panel.ts`, "Titles": the old titles list of the
  achievements panel. Earned first, then the unearned that are not
  secret. A row opens on click: what it gives, Wear or Remove.

### Slices

| Slice | Version | Change |
|---|---|---|
| `divine` | 2 | Adds `favor: Record<string, number>`. Step 1 turns `{}` into `{ favor: {} }`. Fixture `tests/fixtures/divine/v2.json`. |
| `titles` | 1 | New. |
| `quests`, `npcs`, `spellcraft` | unchanged | Code and content only. |

Counters used as in the old build: `miracles:learned`, `met:deity:<id>`,
`favor:floating`, `votive:baseline` (read; the consumables port writes it).

### Commands

| Command | Old | Notes |
|---|---|---|
| `divine/learn { miracle }` | `learnMiracle` | Reasons: "No such miracle", "Already received", "Needs Devotion <level>", "Needs <cost> favor with <deity> (you have <held>)", each also a log line "🔒 <reason>". The spot is not checked: old `learnMiracle` did not either. |
| `divine/assign-favor { deity }` | `assignFloatingFavor` | Old: false and silent. Here: "No unassigned favor", "No such deity", "<name> is not known yet". |
| `titles/wear { title }` | `setTitle` | Above. |

### Requests and events

New:

- `divine/grant-favor-all { amount }` (request, void): known gods only,
  the log line. Asked by quests.
- `divine/meet { deity }` (request, boolean): the counter, the baseline
  favour. No caller yet.
- `titles/check` (event): run the unlock check.
- `titles/earned { title }` (event): the old `title:unlock`.

Used: `spellcraft/add`, `skills/check-discovery`, `skills/grant-xp`,
`counters/bump`, `counters/set`, `log/line`.

### Panel

`divine/panel.ts`, "Divine". Blocks with reserved heights:

- Standing: Devotion level, unassigned favour (the line is always there;
  "0" when none).
- Shelf filters: a search box and one row of tag chips per axis that some
  known god carries. A tap toggles a chip. Tags OR within an axis and AND
  across them, by `queryDeities`.
- The shelf: known gods only, grouped by pantheon (`deityGroups`). A tile:
  icon, name, epithet, favour. A tap opens the god in place: tags, favour,
  Devotion, the description, friends and foes, "+1 favor (unassigned)"
  when there is any, and its miracles with cost, Devotion level, the spell
  as "Label: fact" lines (`specLines` of `spellcraft`), and Receive or the
  reason. Receive shows only at a spot with the Spellcrafting Table, as
  the old tab lived on the table; elsewhere one line names where the
  tables are.

No portraits: the art files are not in this repository; the icon stands
in. No hover cards. Phone layout: one column, tap targets at `--tap`.

### John

The skipping John turns in `the_first_ascent`; its turn-in now pays favour,
so the divine slice changes and the state hash of the John climbs and the
budget runs changes. Nothing John plays reads favour: the pacing table is
not expected to move. If it does, it is run on seeds 42, 7 and 1234 and
written here. The outcome digests are recorded again in their own commit.

### Waits for a later port

- The votive token (`consumable.votive`): the consumables port. It bumps
  `votive:tokens`, asks `divine/grant-favor-all` with 2 and bumps
  `votive:baseline` on the first, bumps `favor:floating` after.
- `faces_of_threshold` and `a_taste_of_everything`: the last of the six
  system people.
- Titles whose deed is not ported: `friend_of_the_court` (the case file
  card, consumables), `david_and_goslimath` (the dare), `iron_stomach`
  (spoiled food), `first_through_the_door` (festival). The records and
  their modifiers are ported; nothing sets their counters yet.
- The worn title in the resource bars: the UI step.
- The yShicna miracles that act on words.

### Changed while building (step 3)

- The miracles, deities and tags moved from `index.ts` to `defs.ts`, so
  `favor.ts` and `shelf.ts` can read them without importing the system.
- `queryDeities`, `deityGroups` and `deitiesInRelation` take an optional
  list (default all deities); the panel passes the known gods. The old
  panel filtered the result of `queryDeities` the same way.
- The quest favour case of the old `onboarding.test.ts` ("quest 1's
  favor makes the cheapest miracle exactly affordable") stays an `it.todo`:
  it reads the record `faces_of_threshold`, which waits for the last of
  the six system people. The turn-in favour of `the_first_ascent` is
  tested in `tests/quests.test.ts`.

## Left behind

- The votive token (`consumable.votive`, `votive_token` drops at the Nine
  Chapels): the consumables port. It bumps `votive:tokens`, asks
  `divine/grant-favor-all` with 2 and bumps `votive:baseline` by 2 on the
  first token, and bumps `favor:floating` on each later one. The divine
  half (floating favour, the baseline paid by `divine/meet`) is tested.
- Meeting a god: nothing calls `divine/meet` yet, as in the old build
  ("future authored encounters").
- `faces_of_threshold` (its +4 favour) and `a_taste_of_everything` (the
  miracle objective at the Nine Chapels): the last of the six system
  people. `miracles:learned` is bumped.
- Titles whose deed is not ported: `friend_of_the_court` (the case file
  card), `david_and_goslimath` (the dare), `iron_stomach` (spoiled food),
  `first_through_the_door` (festival). Their records, modifiers and checks
  are ported and tested with the counter set directly.
- The worn title in the resource bars: the UI step.
- Deity portraits: the art files are licensed and not in this repository.
  The panel shows the icon.
- The yShicna miracles that act on words.

## Old rules ported as they are

- `checkMiracle` does not ask whether the god is known. Eight miracles cost
  0 favour (`sproutbringer`, `tuigamalas_mighty_stick`, `spear_and_fang`
  and the five of yShicna'), so the command receives them in a fresh life;
  the panel lists known gods only, so they are not offered there, as in
  the old interface. Six of them have an empty spell name and a cooldown
  of 0 (port 5, "Content").
- Devotion is checked before favour: a miracle short on both says
  "Needs Devotion <level>".
- `divine/meet` with an id no deity has stamps `met:deity:<id>`, pays
  nothing and answers true, as the old `meetDeity`.
- `iconoclast` latches at the next check after the tenth miracle (a kill,
  an arrival, a level-up, a quest), not when the tenth is received: the
  old `learnMiracle` called no title check.
- Holy days carry no divine rule in the old build. Nothing ported here.

## Skip reasons

Command `divine/learn { miracle }`, each also a log line "🔒 <reason>":

- No such miracle
- Already received
- Needs Devotion <level>
- Needs <cost> favor with <deity> (you have <held>)

Command `divine/assign-favor { deity }` (old: false and silent):

- No unassigned favor
- No such deity: <id>
- <name> is not known yet

No tick.

## Files

| File | Holds |
|---|---|
| `defs.ts` | The miracle, deity and tag registries, their record types, `deityRelation`. |
| `favor.ts` | The slice type, the known gods, favour reads and writes, `checkMiracle`. |
| `shelf.ts` | `PANTHEONS`, `queryDeities`, `pantheonOf`, `deityGroups`, `deitiesInRelation`. |
| `index.ts` | The school registration, `miracleSpec`, commands, requests, the view. |
| `DivinePanel.svelte`, `panel.ts` | The panel. |
| `content/` | `miracles.json` (30), `deities.json` (11), `deity_tags.json` (44), `divine_text.json`. |
