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

## 5. Proposal: budgets tied to the old build (not applied)

The existing budgets (`tests/budgets.test.ts`, `tests/budgetsWorld.test.ts`)
are absolute milliseconds from this machine. They were raised 10% on
2026-11-18 after failing with no code change (`docs/KERNEL.md` section 8),
and they say nothing about the old build. The old build cannot run in this
repository's tests. Proposal: compare against numbers recorded here, divided
by a yardstick measured in the same process, so a slower or a loaded machine
slows both sides.

1. **A yardstick.** `tests/reference.ts`: a fixed workload with no game code
   (seeded integer arithmetic, Map traffic, small objects, a JSON round trip,
   a sort; about 200 ms here). Each budget case times it, median of 5, in
   the same worker just before its run. Measured here in three processes
   after the batches: medians 199.3, 200.7 and 203.5 ms.
2. **John's states as fixtures.** A test helper builds the four states of
   section 2.2 from John (seed 42) with a hook on `record` in `tests/john.ts`
   (an `onRecord` option). No stored save files: a save format change cannot
   break them. John to floor 7 costs about 1.2 s.
3. **Catch-up, faster than the old build.** For each state, assert
   `runMs / referenceMs < factor × OLD_MS[state] / OLD_REFERENCE_MS` with the
   old medians of section 1.1 and the yardstick measured on this machine
   (`OLD_REFERENCE_MS` = 200). Current ratios: 0.27, 0.40, 0.27, 0.27. With factor
   1.0 the test says "faster than the old build"; with 0.5 it says "at most
   half", which passes today with room (worst 0.40, floor 6). The user picks
   the factor. The absolute budgets stay as the tighter tripwire for
   regressions.
4. **Live play.** Assert, per state, rebuild `tick + view` per tick against
   the old `game.tick()` per tick, the same way. This fails today by 15 to 53
   times (section 1.2) because of `kernel.view()` (section 3.4). Either the
   view is made incremental (a view rebuilt only when its slice or its reads
   changed; a kernel change and a design decision) or the bar is the browser
   measurement of section 1.3, which includes the old page's Svelte updates
   and passes today (36 against 224 ms of script per second). A headless
   check of `kernel.view()` alone, against its own recorded median, would
   still catch a view that grows.
5. **Sizes, with no machine in them.** A check after `vite build` in
   `npm run verify`: JavaScript loaded at start, gzip, at most the old
   build's 626,223 bytes (passes, 435,948; the UI is not finished); the
   floor 6 save at most the old 17,559 bytes (fails, 33,330: the log slice).
   Bytes are exact, so these never flake.
6. **Startup.** A browser driver does not fit `npm run verify`. Keep the
   DevTools-protocol script as a manual check before a release, with the old
   build's 451 ms (empty cache) and 257 ms (cached) from section 1.4 as the
   bar on this machine.

What a yardstick does not remove: processors differ in how they run
different code, so a ratio moves between machines by an unknown amount (to
be measured on a second machine before the factor is set below about 0.6).
