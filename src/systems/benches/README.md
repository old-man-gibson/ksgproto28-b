# benches

The discipline registry, the rules of a layout on a bench, and the bench
run: the same layout worked over and over on the clock. Step 3, written for
the Alembic (the alchemy port); cooking, the anvil, the culture bench and
the rune table plug in here later.

Port of old `systems/disciplines.ts` (`openSlots`, `nextSlot`,
`slotAccepts`, `slotPicks`, `slotConsumes`, `placed`, `combinedQuality`,
`bestQuality`, `matchOutcome`, `checkCraft`, `consumedParts`,
`noveltyKeys`, `recipeKey`), old `systems/benchwork.ts` (`benchPace`,
`benchJobTicks`, `startBenchWork`, `stopBenchWork`, `tickBenchWork`), the
alchemy record of `data/disciplines.data.ts`, and `ui/lib/benchLayouts.ts`.
Design: `src/systems/alchemy/README.md`, "Step 3 design".

## Files

| File | Holds |
|---|---|
| `defs.ts` | The `disciplines` registry and schema, `Placement`, `GradedStack`, `BenchReads`, the pure rules |
| `layouts.ts` | The last layout per bench for the session (UI state, never saved) |
| `index.ts` | The slice, `registerBench`, the commands, the tick, the event, the view |
| `content/disciplines.json`, `content/benches_text.json` | One discipline (`alchemy`); the log and reason lines |

## Slice (version 1)

`{ job: BenchJob | null }`. `BenchJob`: `discipline`, `spot`, `placement`
(a copy), `remaining` (null: until stopped), `ticksLeft`, `ticksPer`,
`batch`, `done`. The old `duration` (timed benches) and `forge` (the anvil)
wait for cooking and smithing.

## Owners

`registerBench(discipline, { preview, craft })` at module load.
`preview(ctx, placement)` answers `{ ok, reason? }`; `craft` is a request
definition the owner answers with `{ placement } -> boolean`. This system
never imports an owner. `alchemy` registers `alchemy`.

## Commands

| Command | Old | Refused when |
|---|---|---|
| `benches/start { discipline, placement, count }` | `startBenchWork` | `no bench has the id "<id>"`; `no system works the bench "<id>"`; the owner's preview reason (also logged as `🔒 <reason>`) |
| `benches/stop` | `stopBenchWork` | `no bench run is going` |

Start: `world/drop-activity`, the job, `world/player-command` (a bench run
ends a knockout return), and the line `▶️ <bench>: working ×<n>` or
`working until stopped` for any count but 1. The clock: `ticks`, times the
parts with `work.per: 'ingredient'`; `work.skillScaled: false` keeps it;
otherwise `benchPace` over the `craftSpeed` stat (floor 10 ticks; speed past
the floor batches).

## Tick

`order: 15`, after `combat`. Old `tickBenchWork`: the spot changed or a
journey is under way: stop `left behind`; a fight is open: stop
`interrupted`; else count down, and at 0 ask the owner's `craft` `batch`
times. A refusal stops `out of stock` (the owner logged why); `remaining`
at 0 stops `finished`. The stop line is `⏹️ <bench>: <reason> (<n> done)`,
not written for a single craft that finished.

## Events

- Declared: `benches/crafted { discipline, recipe? }`, the old bus event
  `craft`. The owner emits it inside its craft, where the old code did.
  `quests` hears it.
- Heard: `world/activity-changed` with an activity: the run is dropped with
  no line (old `selectActivity`).

## View

`job`: discipline, spot, ticks left and per craft, `progress` 0 to 1, done,
remaining, batch. The alchemy view repeats it for its panel.

## Differences from the old build

- The old bench tick ran only when no journey was under way at the start of
  the tick, so a run left by walking away logged "left behind" on arrival.
  Here the tick sees the journey and stops at once. The run is lost either
  way; only the time of the line differs.
- The owner emits `benches/crafted`; the old `craft` event came from the
  same place.

## Old rules ported as they are

- `benches/start` does not check that the spot has the bench (old
  `startBenchWork` did not). The Alchemy panel offers the Alembic only at a
  spot whose `benches` holds `alchemy`.
- `checkCraft` reads graded stock only (`stockOf`); a plain material laid on
  a bench reads as none held. Every reagent is graded.

## Step 3 (the cooking port)

- Records `cooking` (Cooking Stove), `grilling`, `baking`, `assembling`,
  `preparing` (Cutting Board), converted from the old literals with their
  `desc` texts. Schema: slot role `adornment`, slot `at`, `favoredPrep`,
  `timeline`, outcome `heat`, result `qty`, `desc`.
- Heat rules: `timelineUnits`, `meanExposure`, `inHeatWindow`,
  `HeatOverride`, `describeHeatWindow`, `heatWindowProblems`.
  `matchOutcome(reads, disc, placement, duration?, override?)` and
  `checkCraft(..., duration?)` as the old ones. `foodProblems` lives in
  `cooking` (it reads the condition registry).
- `benchJobTicks(disc, placement, craftSpeed, duration?)`: a timed bench
  runs `duration x UNIT_TICKS` (10) ticks.
- The job carries `duration`; `benches/start` takes `duration`; the owner's
  `preview` gets it and its `craft` request gets `{ placement, duration }`.
- `cooking` registers the five kitchen benches.

## Left behind

- `assembles` (the anvil, `forgeTicks`), `refines` (the culture bench):
  smithing and mutagens.
- Shadow Clones at a bench (`cloneCraft`), bonus time, performances.
- Records of the other benches in `disciplines`.
