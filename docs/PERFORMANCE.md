# Performance: the rebuild against the old build

Measured on 2026-11-20 (evening, local time) on one machine. Rebuild: `main`
at `edbe69b`. Old build: old `main` at `7c1267b`. Measurement only: no game
code and no budget was changed. Both builds were driven to the same points by
John (seed 42) and measured from those states, alternating, five times each.

Summary (medians; details and ranges in section 1):

| Measure | Old build | Rebuild |
|---|---|---|
| 8 h catch-up, hunting floor 1 | 20.7 s | 5.6 s |
| 8 h catch-up, hunting floor 6 | 29.0 s | 11.5 s |
| 8 h catch-up, idle in town | 6.5 s | 1.8 s |
| 8 h catch-up, hunting floor 7 | 28.5 s | 7.6 s |
| Live tick, floor 6, headless | 124 µs | 86 µs tick + 2,027 µs view |
| Live play in a browser, floor 6, script per second | 224 ms | 36 ms |
| Cold dev server to the game rendered | 6.3 s | 4.0 s |
| Built app to the game rendered, floor 6 save, empty cache | 451 ms | 264 ms |
| Floor 6 save | 17,559 bytes, load 0.27 ms | 33,330 bytes, load 1.18 ms |
| JavaScript loaded at start, gzip | 626,223 bytes | 435,948 bytes |
| Browser JS heap after load, floor 6 save | 8.1 MB | 6.7 MB |

The rebuild is faster on every time measured except save and load of a save
(both under 2 ms), and its save is about twice the size. Its UI is not
finished, which favours it on startup, bundle and live-play rows.

## 1. Results

Medians of 5 runs, range in brackets. Ratio: rebuild divided by old build;
below 1 is faster.

### 1.1 Offline catch-up of 8 hours (288,000 ticks)

| State | Old build | Rebuild | Ratio |
|---|---|---|---|
| Hunting on floor 1 (John at the floor 1 clear, level 2) | 20,702 ms [20,306 to 21,506] | 5,590 ms [5,473 to 5,814] | 0.27 |
| Hunting on floor 6, the Tunnels (John at the floor 6 clear, level 9) | 29,043 ms [28,566 to 31,419] | 11,534 ms [11,258 to 12,278] | 0.40 |
| Idle in town, Chancery Arch (floor 6 state) | 6,545 ms [6,455 to 6,685] | 1,759 ms [1,734 to 1,772] | 0.27 |
| Hunting on floor 7, the Docks (John at the floor 7 clear, run 2, level 10) | 28,482 ms [28,146 to 28,672] | 7,594 ms [7,577 to 7,782] | 0.27 |

Ticks per second (median): floor 1 13,912 against 51,524; floor 6 9,916
against 24,970; town 44,000 against 163,768; floor 7 10,112 against 37,926.

Load before and save after the run: old 2.6 to 3.1 ms and 0.4 to 1.2 ms,
rebuild 5.0 to 5.3 ms and 1.0 to 1.8 ms. Not in the table: both are under
0.1% of a run.

The outcomes agree, which is the check that the two runs did the same work:

| State | Kills, old | Kills, rebuild | Level after, both |
|---|---|---|---|
| Floor 1 | 10,636 | 10,634 | 10 |
| Floor 6 | 11,605 | 11,536 | 26 |
| Town | 0 | 0 | 9 |
| Floor 7 | 13,008 | 12,959 | 24 |

The old build runs catch-up on the page's main thread: the page is frozen for
the whole run (29 s at floor 6). The rebuild runs it in a Web Worker
(`src/worker/catchup.worker.ts`); the page stays live and shows progress.

### 1.2 Live play, headless, microseconds per tick

After loading the state: 1,000 ticks to warm up, then 5,000 ticks timed.

| State | Old: `game.tick()` | Rebuild: `kernel.tick()` | Rebuild: `kernel.view()` | Rebuild: both |
|---|---|---|---|---|
| Floor 1 hunting | 94.7 [93.2 to 95.0] | 50.4 [49.5 to 54.3] | 1,320 [1,302 to 1,370] | 1,370 |
| Floor 6 hunting | 124.2 [122.7 to 127.6] | 86.4 [84.8 to 87.3] | 2,027 [2,025 to 2,042] | 2,113 |
| Idle in town | 35.6 [35.3 to 36.3] | 22.2 [21.2 to 22.5] | 1,875 [1,858 to 1,913] | 1,896 |
| Floor 7 hunting | 140.9 [139.8 to 142.8] | 80.7 [78.7 to 81.2] | 2,244 [2,223 to 2,255] | 2,325 |

The tick alone is 30 to 47% faster in the rebuild. The rebuild's page
publishes a view after every frame that ran a tick (`src/ui/game.svelte.ts`,
`frame` and `publish`), about once per tick at 10 ticks per second, and
`kernel.view()` rebuilds every system's view each time: 1.3 to 2.2 ms, 23 to
84 times the tick. The old page has no such step; its Svelte proxy updates
are not in the old column. Section 1.3 measures both pages in a browser.

### 1.3 Live play in a browser

Built app (`vite preview`), headless Edge, the floor 6 save (hunting the
Tunnels) loaded. A 20 s window starting 5 s after the game rendered;
main-thread time per second from the DevTools `Performance.getMetrics`
counters.

| Measure | Old build | Rebuild |
|---|---|---|
| Script, ms per second | 224 [223 to 227] | 36 [36 to 37] |
| All main-thread tasks, ms per second | 343 [339 to 346] | 54 [53 to 55] |
| Layout, ms per second | 9.5 [9.1 to 9.8] | 3.3 [3.3 to 3.4] |
| Style recalculation, ms per second | 10.4 [9.9 to 11.0] | 0.4 [0.4 to 0.4] |
| DOM nodes | 2,844 | 1,114 |

The game advanced in all 10 runs (the page text changed inside the window).
The old page spends about a third of one core on live play; its game ticks
are about 1.2 ms of that per second (section 1.2), the rest is its UI. The
rebuild spends about 5%, of which `kernel.view()` is about 20 ms per second.
The rebuild's UI is not finished (section 1.6), so this row will move.

### 1.4 Startup

Built app (`vite build`, then `vite preview`), headless Edge, the floor 6
save in localStorage stamped with the current time (no catch-up at load).
Times from navigation start, page clock.

| Measure | Old build | Rebuild |
|---|---|---|
| First frame with the game rendered, empty browser cache | 451 ms [450 to 483] | 264 ms [264 to 269] |
| Same, second visit (browser cache) | 257 ms [252 to 261] | 173 ms [171 to 177] |
| Load event, empty cache | 494 ms [493 to 527] | 264 ms [263 to 269] |
| Resources fetched at load | 6 to 7 | 2 (JS, CSS) |

"First frame with the game rendered": the first animation frame on which
`#app` holds more than 40 characters of text, checked every frame by a script
injected before the page's own. Both pages showed the loaded floor 6 save
(old: "Fight Through the Tunnels"; rebuild: game clock 0:26:31). The
`first-contentful-paint` entry was missing on empty-cache loads in both
builds, so it is not used; `first-paint` (an empty frame) came at 28 to 44 ms
in both.

Cold dev server: `node node_modules/vite/bin/vite.js --port <p>
--strictPort` (what `npm run dev` runs, without npm's own start), the
dependency cache `node_modules/.vite` deleted before each run, no save, empty
browser cache. Times from process start.

| Measure | Old build | Rebuild |
|---|---|---|
| Server answers HTTP | 1,578 ms [1,563 to 1,685] | 1,401 ms [1,391 to 1,409] |
| First frame with the game rendered | 6,325 ms [6,160 to 6,378] | 4,023 ms [3,989 to 4,061] |

The first page load includes Vite's dependency pre-bundling. Both
checkouts lack the licensed art, so the old build's 43 s art scan of
2026-11-01 (section 4) does not apply to either.

### 1.5 Save (the floor 6 state)

| Measure | Old build | Rebuild |
|---|---|---|
| Size | 17,559 bytes | 33,330 bytes |
| Size, gzip | 5,038 bytes | 7,478 bytes |
| Save: state to JSON text, median of 30 | 0.08 ms | 0.54 ms |
| Load: JSON text to a running game, median of 30 | 0.27 ms | 1.18 ms |
| Load, first in a fresh process | 3.2 ms | 5.3 ms |

Old save: `serialize` (`src/core/save/save.ts`). Rebuild: `JSON.stringify(kernel.save(now))`.
Old load: `new Game(deserialize(text))`; rebuild: `parseEnvelope`,
`createKernel` without content validation, `kernel.load`. The rebuild's
save is larger mostly by its log slice (13,358 bytes, 40%; the rebuild stores
log lines, the old build did not) and the combat slice (5,164 bytes; the old
`serialize` drops the fight).

### 1.6 Build

`vite build`, no licensed art in either checkout. Gzip at level 9.

| Measure | Old build | Rebuild |
|---|---|---|
| JavaScript, all files | 2,052,908 bytes, 4 files | 2,736,213 bytes, 2 files |
| JavaScript, all files, gzip | 629,834 bytes | 776,810 bytes |
| JavaScript loaded at start | 2,042,977 bytes (626,223 gzip) | 1,512,468 bytes (435,948 gzip) |
| Catch-up worker, loaded only for a gap over 3 s | none | 1,223,745 bytes (340,862 gzip) |
| CSS | 253,974 bytes (44,123 gzip) | 76,270 bytes (10,042 gzip) |
| Fonts | 112 files, 2,318,228 bytes | none |
| Build time, one run | 10.4 s | 9.7 s |

The worker bundle repeats the kernel and every system. The rebuild's UI is not
finished (the UI step): about 10,300 lines of Svelte and TypeScript (35
system panels and a 760-line shell) against the old 43,500. The startup and
bundle rows compare an unfinished UI with a finished one.

### 1.7 Memory

| Measure | Old build | Rebuild |
|---|---|---|
| Browser JS heap after load and garbage collection, floor 6 save | 8.09 MB [8.08 to 8.09] | 6.73 MB [6.73 to 6.74] |
| Node heap added by one loaded floor 6 game | 0.10 MB | 0.41 MB |

The Node figure is heap used after garbage collection with the game held,
minus the same with the modules loaded and no game. The browser figure is the
whole page (`Runtime.getHeapUsage`).

## 2. Method

### 2.1 Builds and machine

- Rebuild: this repository at `edbe69b`, a worktree, `npm ci`.
- Old build: `git archive 7c1267b` of the old repository extracted to a
  folder outside both repositories (`D:\ksgproto28-perf-old`), `npm ci`. A
  worktree of the old repository was not created: the old repository stays
  untouched.
- Neither checkout had licensed art. The rebuild had no Facet core; the old
  build has its core in git. John uses no Facet ability, so no run reached it.
- Vite 6.4.3 (old) and 6.4.6 (rebuild), Svelte 5.57.1 and 5.57.3, vite-node
  3.2.4 in both. Node 24.18.0 (the continuous integration runs Node 22).
- AMD Ryzen 7 7735HS, 8 cores, 16 threads, 63 GB, Windows 11. Headless
  Microsoft Edge with a new temporary profile per batch, driven over the
  DevTools protocol.
- Ports: old 5602, rebuild 5603, for both the dev server and the preview.
  Port 5173 was not used.

### 2.2 The states

John (`tests/john.ts` in each build), seed 42, weapon `skip`, `through: 7`
(run 1 to floor 6, the prestige, run 2 to floor 7). A copy of each build's
John with one added line called a hook when a segment closed (`record`),
which saved the state at the close of `floor1`, `floor6` and `floor7`. From
each snapshot a few ticks of the game's own commands set the scenario, then
the state was saved:

- Floor 1: walk to `f1_storerooms` (the Vermin Hall), select `hunt`. Its
  6-fight limit was lifted in both builds by deleting `fightLimit` from the
  spot definition in memory, in the set-up and in every measuring process,
  as `tests/budgetRuns.ts` floor1 does. Floor 1 has no other hunting spot;
  without the lift the 8 hours are idle after 6 fights.
- Floor 6: walk to `f6_tunnels`, select `hunt`.
- Town: from the floor 6 snapshot, leave the tower, walk to `chancery_arch`,
  no activity.
- Floor 7: walk to `f7_docks` (the ward's patrol, John's den), select `hunt`.

What differs between the two builds' states (each John is a port of the
other, not the same code):

| Point | Game tick, old | Game tick, rebuild | Level, both | Gold, old | Gold, rebuild | Save bytes, old | Save bytes, rebuild |
|---|---|---|---|---|---|---|---|
| Floor 1 clear | 2,326 | 2,394 | 2 | 206 | 164 | 12,634 | 28,864 |
| Floor 6 clear | 16,009 | 15,744 | 9 | 17,118 | 11,986 | 17,385 | 32,855 |
| Floor 7 clear (run 2) | 31,791 | 31,045 | 10 | 15,313 | 13,557 | 25,207 | 38,183 |

Set-up ticks after the snapshot (walking): floor 1 88 and 88, floor 6 62
and 165, town 203 and 328, floor 7 22 and 22. The old `serialize` drops a
fight in progress; the set-up let any fight end before saving, so neither
save holds one. John's climb to floor 7 took 2.8 s of wall clock in the old
build and 1.2 s in the rebuild.

### 2.3 What each number covers

- Catch-up, rebuild: the body of the kernel's `catchUp`
  (`src/kernel/runner.ts`): `createKernel` with `catchingUp`, `load`,
  `runHeadless` for 288,000 ticks, `save`. The table is the `runHeadless`
  part. Not included: the page's `kernel.save` before and `kernel.load`
  after, and the worker message.
- Catch-up, old: the boot path of `src/ui/state.svelte.ts` without the
  Svelte proxy: `new Game(deserialize(text))`, then `runOfflineProgress(game,
  OFFLINE_CAP_MS)` (`catchUpTicks`, log suppressed), then `serialize`. The
  table is the `runOfflineProgress` part. Not included: `$state.snapshot` and
  `Object.assign` back onto the proxy.
- One fresh Node process per run, so the compiler starts cold, as on a page
  load. Both builds' TypeScript ran through vite-node 3.2.4.
- Live, headless: the same, then 1,000 ticks of warm-up and 5,000 timed
  ticks. Rebuild: `kernel.tick()` then `kernel.view()` on a kernel created as
  the built page creates it (no view freezing). Old: `game.tick()`.
- Each batch: five rounds; in each round every scenario ran once per build;
  the order of the two builds alternated by round. CPU load was read over 3 s
  before each round (all processors, `os.cpus()`), with a wait of up to 5
  minutes while it was above 30%. It was 1 to 7% at every round start but
  one (17%, the first round of the cold dev server). No other program held
  the processor during the measurement.
- Scratch scripts, not committed (`.scratch-perf/` is ignored): the hooked
  John copies, `make-saves.ts` and `measure.ts` per build, a batch driver, a
  DevTools-protocol driver for the browser, a profile summary. Copies are with
  the session notes of this work.

## 3. Where the time goes: 8 hours on floor 6

`node --cpu-prof`, one run per build, samples under the catch-up loop only.
Shares are inclusive (a function and everything it calls). The `path:line` is
the definition in the source; the profile reports lines of the code vite-node
runs, which are shifted.

### 3.1 Rebuild (11.4 s under the profiler)

| Share | Function | What it is |
|---|---|---|
| 40.3% | `runCombatTick` `src/systems/combat/engine.ts:1475` | The combat tick. Inside: `playerPhase` (:1578) 13.3%, `pickActive` (:1344) 8.8% with `activeRotation` (:1321) 5.0%, `tickEnemyRegen` (:1119) 8.4%, the monster's `statsOf` (:312) 8.0%. |
| 26.6% | `drain` `src/kernel/kernel.ts:283` | Event delivery to subscribers. Of it: the resources damage handler and `applyDamage` (`src/systems/resources/index.ts`) 16%, status `mutate` (`src/systems/statuses/index.ts:445`) 11%, martial `checkTechniqueLearning` 8%, skills discovery about 7%, ladder `checkFloorClears` 5% (shares of `drain`). |
| 13.6% | `statBlockOf` `src/systems/stats/index.ts:43` | Stat blocks read through the kernel's derived cache (`resolved`, `fresh` in `src/kernel/derived.ts:338` and `:416`). Overlaps the two rows above. |
| 11.1% | `tickPlayer` `src/systems/statuses/index.ts:486` | The player's conditions each tick. |
| 7.6% | resources `tick` `src/systems/resources/index.ts:311` | Pools and regeneration each tick. |

By file (own time): `combat/engine.ts` 13.9%, `statuses/index.ts` 11.5%,
`kernel/kernel.ts` 8.5%, `kernel/derived.ts` 7.6%, `resources/index.ts`
6.7%. Garbage collection 0.17 s. vite-node's module wrapper took 2.0% (it is
not in a built page).

### 3.2 Old build (28.5 s under the profiler)

| Share | Function | What it is |
|---|---|---|
| 56.4% | `runCombatTick` `src/core/systems/combat.ts:4068` | The combat tick. Inside: `pickActive` (:2011) 10.5%, `onKill` (:1778) 9.4%, `activeRotation` (:1962) 8.4%. |
| 16.0% | `getDerivedStats` `src/core/systems/derived.ts:713` | The stats cache. 10.0% of the run is `modFingerprint` (:615), the string key built on every call. |
| 10.4% | `checkDiscovery` `src/core/systems/skills.ts:83` | Skill discovery, every skill checked against every tag list. |
| 9.9% | `checkTechniqueLearning` `src/core/systems/martial.ts:295` | Technique learning; `entryPositions` (:530) 6.6%. |
| 6.3% | `monsterStats` `src/core/systems/monsterStats.ts:552` | Monster stat blocks, built on read. |

By file (own time): `combat.ts` 16.3%, `derived.ts` 12.9%, `skills.ts`
11.2%, `martial.ts` 10.3%, `actions.ts` 8.2%. Garbage collection 0.28 s.

### 3.3 Between the two

The combat tick is the largest cost in both: 16.1 s old, 4.6 s rebuild,
under the profiler. The old build's next two costs, the fingerprint key
and the skill discovery scan, are gone in the rebuild (kernel decision 32 and
`skillsTrainedBy`). The rebuild pays for event delivery (`drain`, 3.0 s) that
the old build spent in direct calls. Technique learning is in both: 2.8 s
old, about 0.26 s rebuild.

### 3.4 The rebuild's live view

`kernel.view()` (`src/kernel/kernel.ts:373`) calls every system's `view` on
each publish. Profile of 6,000 views at floor 6 (12.5 s under the profiler),
inclusive shares: bestiary `view` (`src/systems/bestiary/index.ts:357`) 23%,
nearly all in `spawnLevels` (:187) and the combat `dynamicLevelBonus`
(`src/systems/combat/spawn.ts:148`) it calls per monster; world `view`
(`src/systems/world/index.ts:426`) 19%, half of it the route search `reach`
(:213); skills `view` (`src/systems/skills/index.ts:621`) 11%; log `view`
(`src/systems/log/index.ts:461`) 10%; ladder `view`
(`src/systems/ladder/index.ts:558`) 8%. Every view is rebuilt whether its
slice changed or not.

## 4. The old "3 to 5 s" note

- In this repository it first appears in `docs/SPINE.md` in commit `7b59ba1`
  (port 7, 2026-11-17): "The old build took 3 to 5 s for the world runs." No
  method, state or machine is given. The catch-up session's brief repeated
  it as "3 to 5 s for the same 8 hours".
- The old repository's 'startup-speed' branch (merge `49a2fea`,
  2026-11-01) is about the dev server, not catch-up: the art folders (30,536
  files) held the first page 43 s on a cold start and were taken out of the
  file watcher (old `docs/ENGINEERING.md` section 5).
- The nearest figure in the old repository is old
  `docs/plans/knockout-return.md` line 192 (commit `3d639d1`, 2026-11-03, a
  plan card): "idle catch-up takes 1.6–2.9 s per 8 h and hunting about
  5.3 s". No method, state or machine is recorded.
- The old repository's measured figures disagree with it: old
  `docs/ENGINEERING.md` section 1.2 (2026-10-29, a probe with a developed
  save: attributes at 60, skills at 40, every achievement; a real
  `runOfflineProgress` of 8 hours) gives 17.6 s at `f4_woods_edge` and 28.6 s
  at `the_cages`; old `docs/ANDROID.md` says 17 to 29 s per 8 hours on a
  developed save.
- This measurement: 6.5 s idle in town and 20.7 to 29.0 s hunting. The 3 to
  5 s figure is not reproduced by the old build at `7c1267b` for any state
  measured here; the old ENGINEERING.md figures are.

## 5. Budgets tied to the old build

Proposed with this measurement on 2026-11-20. On 2026-11-21 the user set
the factor to 0.5: catch-up takes at most half the old build's time.
Built the same day:

| Item | State | Where |
|---|---|---|
| 1. A yardstick | built | `tests/reference.ts` |
| 2. John's states, built inside the test | built | `tests/speedStates.ts`; the `onRecord` option of `tests/john.ts` |
| 3. Catch-up at most 0.5 of the old build's time | held | `tests/speed.test.ts`, the vitest project `speed`; each attempt in its own process (`tests/speedRun.ts`, `tests/speedCatchUp.ts`) |
| 4. Live play, headless | reported, not held | `tests/speed.test.ts` |
| 5. Sizes | the floor 6 save reported, not held; the bundle check is not built | `tests/speed.test.ts` |
| 6. Startup | not built: a manual check before a release | - |

`npm test` and `npm run verify` run the project `speed` alone, after
`budget-world`. The absolute budgets (`tests/budgets.test.ts`,
`tests/budgetsWorld.test.ts`, `docs/KERNEL.md` section 8) stay: they cover
other runs (a new character, a poison held, the world system) and say
nothing about the old build.

### 5.1 The yardstick

`tests/reference.ts`: seeded integer arithmetic, Map traffic, small
objects, a JSON round trip, a sort. No game code. The same code as the
baseline's `reference.mjs`. `measureYardstick()` runs one pass to warm up
and five timed passes, and returns the median, every pass and the spread
(slowest minus fastest, over the median). The test prints all three for
every yardstick it takes.

The old build's yardstick time is 200.7 ms: the median of three plain Node
processes on the measurement machine right after the batches of section 1
(medians 199.3, 200.7 and 203.5 ms).

The same workload in three environments, same machine, 2026-11-21, the
five low-load rounds of 5.3: plain Node (`reference.mjs`) 199.7 to 210.4
ms, median 208.7; vite-node 190.5 to 200.9 ms, median 197.0; the test's
worker, the yardsticks before floor 6, town and floor 7, 193.7 to 227.9 ms,
median 206.0. Since 2026-11-22 the yardstick runs in the measuring process
of each attempt, under vite-node (5.2). A yardstick lower than plain Node's
makes the rebuild's ratio higher against the old build's plain Node value:
the bar is at least as strict as with plain Node. While the attempts ran in
the worker, the first yardstick in it (before floor 1) read 5 to 15% above
the later ones in 4 of 5 rounds; the cause was not found.

Spread of the yardstick's own five passes: 3 to 14% at low load and under
load. Before the garbage collection step (5.2) the first yardstick after
John's climb had a spread of 27 to 46%: its passes alternated about 200 and
260 ms.

### 5.2 Catch-up: held

For each state of section 2.2, in `tests/speed.test.ts`:

    run ms / yardstick ms  <  0.5 x OLD_CATCHUP_MS / OLD_YARDSTICK_MS

| State | Old median | Old ratio | Limit | The limit at a 200 ms yardstick |
|---|---|---|---|---|
| Floor 1 hunting | 20,702 ms | 103.15 | 51.57 | 10,315 ms |
| Floor 6 hunting | 29,043 ms | 144.71 | 72.35 | 14,471 ms |
| Idle in town | 6,545 ms | 32.61 | 16.31 | 3,261 ms |
| Floor 7 hunting | 28,482 ms | 141.91 | 70.96 | 14,191 ms |

- The states are built inside the test (`tests/speedStates.ts`): John,
  seed 42, Skip tutorial, `through: 7`, keeps the state at the close of
  `floor1`, `floor6` and `floor7` (the `onRecord` option of `runJohn`);
  the set-up of section 2.2 follows. No stored saves: a save format change
  cannot break them. John's climb takes 1.3 to 1.6 s.
- The timed span is `runHeadless` for 288,000 ticks on a kernel created as
  `catchUp` creates it (section 2.3).
- Each attempt runs in a fresh Node process, as the baseline measured the
  old build (vite-node, one fresh process per run):
  `node --expose-gc node_modules/vite-node/vite-node.mjs --config
  tests/speedRun.config.ts tests/speedRun.ts -- <state>`, with the state's
  save envelope on standard input. In the process (`tests/speedCatchUp.ts`):
  a full garbage collection, the yardstick, a collection, the timed run, a
  collection, a yardstick of three passes. It prints the attempt as one
  line of JSON and exits. The worker builds the states, starts the
  processes one after the other and is idle while one runs.
- The measuring process's config has no plugins
  (`tests/speedRun.config.ts`). Its 305 modules transform to the same code
  as under `vite.config.ts`: the two module dumps (`VITE_NODE_DEBUG_DUMP`)
  compared equal on 2026-11-22. The Svelte and forge plugins cost about
  1.5 s of start-up per process. Its environment is the worker's without
  vitest's variables (`VITEST*`, `TEST`, `NODE_ENV`). A process still
  running after 150 s is stopped and the case fails.
- Kills must be within 10% of the old build's (town: none), so a run that
  stopped hunting cannot pass on speed. At `a72b168` they equal the
  baseline's rebuild column: 10,634, 11,536, 0 and 12,959.
- A state whose first attempt fails is measured again, in a new process.
  The case passes if the second attempt passes. The second attempt costs
  time only when the first fails.
- Each attempt prints the run, the yardstick with its passes, a yardstick
  of three passes taken after the run, the processor load of the whole
  machine over the attempt (all logical processors; the measuring process
  alone is about 6%) and the process's time from start to exit.
- Until 2026-11-22 the attempts ran in the worker, after John's climb and
  the states before them. That cost floor 6 about 4% of its ratio in the
  alternating rounds of 5.3 (about 6% by the fresh-process runs of 6.2).

### 5.3 Margins

The ratio as a share of its limit (below 100% passes), first attempts; in
brackets the rebuild ratio over the old ratio.

Now: one process per attempt, 2026-11-22, main `d75aaee` (speed pass 1
and port C3 merged) plus that change. Each round ran the speed test of
`d75aaee` (attempts in the worker) and of the change, alternating.
"Low load": the machine at 5% or less at the round start, 9 to 13% during
most attempts (the measuring process alone is about 6%); load arrived in
round 1 of `d75aaee` (12 to 29%) and in round 5 of the change (21 to 23%).
"Neighbour": a second process ran floor 6's catch-up in a loop
(`tests/speedRun.ts`) for the whole batch; 17 to 31% during the attempts.

| State | Own process, low load, 5 runs | In the worker, low load, 5 runs | Own process, neighbour, 3 runs | In the worker, neighbour, 3 runs |
|---|---|---|---|---|
| Floor 1 hunting | 51 to 57%, median 54% (0.26 to 0.29) | 55 to 60%, median 58% | 60, 61, 65% | 57, 61, 62% |
| Floor 6 hunting | 75 to 83%, median 77% (0.37 to 0.41) | 78 to 83%, median 80% (0.39 to 0.42) | 79, 85, 89% (0.40 to 0.45) | 80, 87, 93% (0.40 to 0.47) |
| Idle in town | 58 to 64%, median 59% (0.29 to 0.32) | 59 to 63%, median 61% | 58, 60, 75% | 59, 66, 71% |
| Floor 7 hunting | 50 to 53%, median 52% (0.25 to 0.26) | 51 to 55%, median 54% | 52, 60, 61% | 50, 58, 60% |

- No first attempt failed in the 16 runs. Floor 6's 83% at low load is
  round 5, where load arrived; the other four rounds read 75 to 77%.
- In its own process floor 6 reads about 3 points of its limit lower than
  in the worker at low load. Under the neighbour the two methods read
  alike: the neighbour slows the run more than the yardstick, in either.
- The kills equal those at `a72b168`: 10,634, 11,536, 0 and 12,959.
- The yardstick in the measuring process at low load (rounds 1 to 4): 195.8
  to 205.6 ms, median 196.5. The first yardstick, before floor 1, reads as
  the others.

Before speed pass 1, the attempts in the worker, 2026-11-21: `a72b168` plus
this test. "Low load": the machine at 10% or less before the round; during the
attempts it was 9 to 22%, because the session porting C3 ran its timing
script (`scripts/budget-runs.ts`, one process) throughout. No round with
the machine idle was available. "Loaded": rounds started while that session
held the machine at 93 to 100%; during the attempts it was 9 to 32%.

| State | Low load, 5 runs | Loaded, 3 runs |
|---|---|---|
| Floor 1 hunting | 55 to 62%, median 60% (0.28 to 0.31) | 57 to 61% (0.29 to 0.31) |
| Floor 6 hunting | 82 to 100%, median 87% (0.41 to 0.50) | 99, 104, 109% (0.50 to 0.55); attempt 2: 90, 85% |
| Idle in town | 60 to 68%, median 62% (0.30 to 0.34) | 63 to 75% (0.31 to 0.37) |
| Floor 7 hunting | 57 to 65%, median 58% (0.28 to 0.33) | 50 to 59% (0.25 to 0.30) |

Every case passed in all 8 runs. Floor 6 failed its first attempt in 2 of
the 3 loaded runs; the second attempt passed both times. Its highest low-load
first attempt was 99.7% (72.11 against 72.35), with the yardstick at 202 ms
before and after the run.

The `npm run verify` of this change ran at the lowest load of the day (13
to 15% during the attempts, yardstick 193 to 195 ms): 57, 82, 62 and 55%
(0.29, 0.41, 0.31, 0.28).

From the section 1 medians (idle, fresh processes, `edbe69b`) the shares
would be 54, 79, 54 and 53%. The earlier version of this test (no garbage
collection, no second attempt), 5 runs at low load: floor 6 78 to 86%; 5
runs under load: floor 6 77 to 93%.

What moves floor 6: a second process running game code. At 9 to 11%
machine load the floor 6 run took 12.3 s; with the C3 session's catch-up
script running (17 to 21%) 13.0 to 16.5 s, while the yardstick read 194 to
231 ms. The yardstick's working set is small (a Map of 5,000 entries, an
array of 200,000 numbers) and is not slowed the same way by a neighbour
that competes for the processor's caches.

Cross-check of the method, the same evening and load: the old build (the
export of `7c1267b` of section 2.1) and the rebuild, each state in a fresh
process: a garbage collection, the yardstick, a collection, the run of 8
hours. The builds alternate; 3 rounds.

| State | Old ratio, constant | Old ratio, 3 rounds | Rebuild ratio, 3 rounds | Rebuild over old, same round |
|---|---|---|---|---|
| Floor 1 hunting | 103.15 | 95.2, 130.1, 102.5 | 27.8, 29.3, 28.2 | 0.29, 0.23, 0.28 |
| Floor 6 hunting | 144.71 | 156.5, 148.0, 150.2 | 66.2, 66.1, 64.8 | 0.42, 0.45, 0.43 |
| Idle in town | 32.61 | 36.0, 42.9, 37.7 | 9.7, 9.6, 10.2 | 0.27, 0.22, 0.27 |
| Floor 7 hunting | 141.91 | 155.3, 140.4, 149.1 | 43.3, 69.7, 39.1 | 0.28, 0.50, 0.26 |

- The old build's medians that evening (102.5, 150.2, 37.7, 149.1) are at or
  above the constants. Load slows the old build's game code against the
  yardstick as it slows the rebuild's. The constants, from an idle night,
  are the stricter choice.
- Floor 6 against the old build directly, same round: 0.42 to 0.45. Its
  margin under the factor is that thin in fact, not through the yardstick.
- A single run moves by up to a third when load arrives during it (floor
  7, round 2: 0.50).

### 5.4 Reported, not held

Printed in every run, never failing. Both fail the factor today; a later
speed pass is to fix them, and then they are held the same way. Both are
measured in the worker, after the held cases.

- Live play, headless. Per state, 100 ticks of warm-up, then 300 ticks of
  `kernel.tick()` followed by `kernel.view()`, against the old
  `game.tick()` of section 1.2, through the yardstick. Tick plus view: 37
  to 161 times the 0.5 bar (`kernel.view()`, section 3.4). The tick alone:
  0.6 to 3.4 times the bar; 300 ticks are few, so the tick figure moves
  with the fight in progress.
- Save size. The floor 6 state saved (`JSON.stringify(kernel.save(now))`)
  against the old 17,559 bytes: 33,437 bytes since port C3 (33,391
  before), 1.90 times the old. The log slice is 13,663 bytes of it.

### 5.5 Run time

`npx vitest run --project speed` on this machine at low load, one process
per attempt (the five low-load rounds of 5.3): 54.0 to 59.0 s, median 54.6
(the tests 48.3 to 52.9 s, median 48.6). The same rounds with the attempts
in the worker (`d75aaee`): 45.6 to 49.9 s, median 46.2 (the tests 39.6 to
43.7 s). One process per attempt adds about 8.5 s: each process takes
about 2.3 s to start (vite-node, the config, 305 modules transformed)
before its first yardstick. A process from start to exit: floor 1 9.6 to
9.7 s, floor 6 14.7 to 15.1 s, town 6.0 s, floor 7 11.3 to 11.5 s. John's
climb and the set-up in the worker 1.2 to 1.5 s; live play about 5 s. A
second attempt adds its process (floor 6: about 15 s). With the neighbour:
61.7 to 62.1 s.

In the `npm run verify` of the first version (attempts in the worker,
2026-11-21): `budget` 23.7 s, `budget-world` 20.8 s, `speed` 43.1 s (the
tests 39.9 s), `john` 18.2 s. In the `npm run verify` of one process per
attempt (2026-11-22, 202 s in all): `budget` 24.4 s, `budget-world` 29.4
s, `speed` 54.1 s (the tests 51.1 s), `john` 23.9 s; the speed test read
59, 71, 59 and 60% (0.30, 0.35, 0.29, 0.30) at 12 to 23% load. On the CI
runner
(ubuntu-latest, Node 22) the budget runs took 0.6 to 0.8 times the times
recorded on this machine on 2026-11-18 (`docs/KERNEL.md` section 8); the
speed test's ratios there are not measured yet.

### 5.6 Updating the old-build constants

The constants are at the top of `tests/speed.test.ts`: `OLD_CATCHUP_MS`,
`OLD_KILLS`, `OLD_YARDSTICK_MS`, `OLD_TICK_US`, `OLD_FLOOR_SIX_SAVE_BYTES`.
Each comment names its source. Update them together, from one session on
one machine:

1. Export the old build: `git archive <commit>` of the old repository into
   a folder outside both repositories, then `npm ci` there. No worktree of
   the old repository, no file written into it.
2. Build the four saves in both builds (each build's John with a hook on
   `record`, then the set-up of section 2.2) and measure as in section 2:
   one fresh process per run, five rounds, the builds alternating, the
   processor below 30% at each round start. The scripts of the 2026-11-20
   measurement are kept with the session notes of that work.
3. In the same session, idle: the yardstick (`workload` of
   `tests/reference.ts`), one warm-up and five timed passes, in three
   processes. The median of the three medians is `OLD_YARDSTICK_MS`.
4. Write the medians, the kills, the commit, the date and the machine into
   the constants and into section 1 of this file.

When `workload` in `tests/reference.ts` changes, only step 3 is needed, but
it must run on the machine and in the state the old medians came from;
otherwise repeat steps 1 to 4. The factor (`FACTOR`) is the user's
decision.

### 5.7 Not settled

- Floor 6 is the state nearest its bar. At `a72b168` it read 0.41 to 0.50
  of the old build's time at low load against 0.28 to 0.34 for the other
  states, and a process running game code next to it failed a first
  attempt. Speed pass 1 (section 6) took it to 0.39 to 0.40 in the worker;
  one process per attempt reads 0.37 to 0.39 at low load and up to 0.45
  with a neighbour (5.3), no first attempt failing in 16 runs. Proposed,
  not built:
  1. Before a second attempt, wait while other processes keep the machine
     busy, as the baseline batches did: up to a few minutes, until the
     machine's load without this process is below about 10%.
  2. A yardstick that also competes for the caches the way the game does
     (a working set of game size). It changes `OLD_YARDSTICK_MS` (5.6).
  3. Further speed work on floor 6 (6.4).
  A median of several attempts does not help: under a steady neighbour
  every attempt reads the same.
- A second machine: the ratio moves between processors by an unknown
  amount. The first CI run of this test measures it on the CI runner.
- Live play and save size (5.4).
- Bundle size (item 5) and startup (item 6) are not built.

## 6. Speed pass 1: floor 6 catch-up

2026-11-21, branch `claude/speed-test-f62037`, after the speed test
(`6322669`). The user's choice: speed up floor 6's catch-up before the
speed test merges; the factor stays 0.5. Strict port: the outcomes stay
identical and no rule or save format changes. Checked for each fix: the
outcome digests (`tests/outcome.test.ts`, the six budget digests), John's
pacing table for seeds 42, 7 and 1234 (`npm run pacing`, diffed with the
table before the pass), the speed test's kills, `npm run verify`.

### 6.1 The fixes

Gain: floor 6 catch-up in a fresh process, the yardstick then the run
(the method of the cross-check in 5.3), 4 alternating pairs against the
commit before; the median ratio after over the median ratio before. Another
session ran game code during most pairs: one pair moves by up to 10%.

| Commit | Fix | Floor 6, after / before |
|---|---|---|
| `0f67eae` | Combat rotation. `pickActive` asks for the rotation on every tick of a fight. The sorted player action kinds and the rotation id to kind lookup are kept until the registry changes; the dedupe uses a Set; martial keeps one `technique:<id>` string per technique. | 0.92 |
| `2c4df14` | Status operations. Each operation built `sourceSignature` text twice; `sourceSnapshot` compares the same fields in place in a reused array. | 0.98 |
| `087be42` | Stat reads, about 14 per tick. The player's record in a field as well as in the entity map, the plain table in the record, the last resolver prefix remembered, the clean-record check apart from the rescan so it inlines; `statBlockOf` compares with the last output before its weak map. | 0.97 |
| `92aa8fd` | Skills. Tag lists of one and two tags (the hunt tick asks for `combat`, `hunt` on every tick) found by tag with no joined key; the XP grant tests held skills against a set of ids. | 0.976 |
| `8816692` | Stat cache rescan. A record's per-source counters and collections in arrays by source position, not maps by id. | 0.986 |
| `822e9e2` | Statuses. No operation for `resources/damaged` (211,000 per 8 hours) when no held condition has a rule on damage taken, as the heal handler already did. | 0.992 |

Tried and dropped: the tick loop and requests holding each system's
context instead of looking it up in a map (`kernel.ts`): 1.007, no gain.
Lazy reach in martial's technique check: at most 1.3% of floor 6, not
built.

The product of the per-fix medians, 0.84, overstates the whole; 6.2
measures the whole.

### 6.2 Before and after

All four states in fresh processes, 6 alternating pairs, `6322669` against
`822e9e2`, the machine at about 5% at the start. Median ratios:

| State | Before | After | After / before | Run, ms |
|---|---|---|---|---|
| Floor 1 hunting | 27.46 | 26.33 | 0.959 | 5,585 to 5,163 |
| Floor 6 hunting | 59.16 | 52.32 | 0.884 | 11,602 to 10,774 |
| Idle in town | 9.35 | 9.29 | 0.994 | 1,913 to 1,845 |
| Floor 7 hunting | 39.51 | 35.24 | 0.892 | 8,082 to 7,428 |

The speed test, the share of each limit (below 100% passes), first
attempts, `6322669` and `822e9e2` alternating. Low load: no other process
ran game code; the machine was at 10 to 23% during the attempts.
Neighbour: a second process ran floor 6 catch-up in a loop; 16 to 30%.

| State | Low load, before, 4 runs | Low load, after, 4 runs | Neighbour, before, 3 runs | Neighbour, after, 3 runs |
|---|---|---|---|---|
| Floor 1 hunting | 56 to 61% | 54 to 56% | 55, 70, 70% | 49, 53, 64% |
| Floor 6 hunting | 83 to 90%, median 86% | 79 to 80% | 81, 90, 93% | 76, 82, 90% |
| Idle in town | 61 to 64% | 57 to 61% | 61, 66, 68% | 56, 63, 67% |
| Floor 7 hunting | 57 to 59% | 53 to 55% | 56, 60, 61% | 48, 52, 56% |

No first attempt failed in these 14 runs. Floor 6 over the old build in the
speed test: 0.42 to 0.45 before, 0.39 to 0.40 after (low load).

The same code reads lower in fresh processes: floor 6 at 70 to 74% of its
limit after the pass (78 to 89% before), against 79 to 80% (83 to 90%) in
the speed test. In the test, floor 6 runs in the worker that ran John's
climb and the floor 1 state first; that costs both builds about 6% on
floor 6. The old build's medians were taken in fresh processes. Since
2026-11-22 the test runs each attempt in its own process (5.2); in its
alternating rounds the worker cost floor 6 about 4% (5.3).

### 6.3 The budget runs

`scripts/budget-runs.ts`, all six runs in one process per side, 3
alternating rounds, `6322669` against `822e9e2`. Every digest equal.

| Run of 8 hours | Before, ms | After, ms | After / before |
|---|---|---|---|
| No fight, no condition | 1,633 to 1,672 | 1,614 to 1,647 | 1.000 |
| A poison held | 4,899 to 4,963 | 4,029 to 4,326 | 0.856 |
| Floor 1 table sent to combat | 4,999 to 5,045 | 4,750 to 5,062 | 0.948 |
| Floor 6 Tunnels sent to combat | 8,578 to 8,885 | 8,056 to 8,339 | 0.935 |
| World: hunt, floor 4 Woods Edge | 8,940 to 9,236 | 8,053 to 8,449 | 0.898 |
| World: hunt, floor 6 Tunnels | 8,767 to 8,858 | 7,908 to 8,137 | 0.923 |

The absolute budgets are unchanged.

### 6.4 What is left

After the pass no function has more than 4% of floor 6's time as its own;
what is left is spread. Further steps need structure, each proven equal by
the digests:

- The damage of a condition goes `statuses/damage`, `resources/damage`,
  `resources/damaged` (206,000 times per 8 hours on floor 6), each event
  with its subscribers and the log's floating run. A request path where the
  event order allows it.
- Monster stat blocks: about 11,800 per 8 hours, each collecting about 45
  modifier sources, most of which return nothing for a monster, then the
  stats resolver. A source that declares it reads the player only would
  skip those collections.
- The buff slot's pick on every tick of a fight.
- The speed test's method: each state in a fresh process, as the old
  build was measured. A change of method, not of speed; the user chose
  it, and it is built since 2026-11-22 (5.2, 5.3).
- A push model for the play holds (docs/KERNEL.md decisions 36, 37):
  built in step 4 port F, when the Facet evolution became the second play
  holder. Before it `kernel.tick()` asked each play holder and catch-up
  asked each catch-up holder before every tick (the dare alone: about 1% of
  an idle tick; the evolution added about 2.5% of the idle catch-up). Now a
  holder says when its hold may have changed, the kernel asks it after that
  step drains and keeps the answer, and a tick reads one field.
