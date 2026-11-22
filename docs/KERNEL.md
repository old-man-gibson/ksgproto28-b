# Kernel

The kernel is step 1 of `docs/REBUILD.md`. It holds no game rules. It is the
skeleton every system plugs into. This document is the contract.

## 1. Layout

| Path | Holds | May import |
|---|---|---|
| `src/kernel/` | The kernel. No Svelte, no DOM, no build-tool globals. | Its own files only |
| `src/systems/<name>/` | One system: declaration, migrations, content, panel, doc | The kernel; another system's `index.ts`; `src/ui/` from the panel files only |
| `src/systems/index.ts` | The system list, built from the folders | - |
| `src/systems/panels.ts` | The panel list, built from the folders | - |
| `src/ui/` | The shell: frame loop, save timer, theme, layout | The kernel, the lists |
| `src/worker/` | The catch-up worker | The kernel, the system list |
| `forge/` | The dev-only content editor | The kernel, the system list, `src/ui/` |
| `tests/` | Tests and `tests/fixtures/<slice>/v<N>.json` | Anything |

`tests/structure.test.ts` enforces the import rules.

## 2. The system declaration

A system is a folder under `src/systems/`. Its `index.ts` default-exports
`defineSystem({...})`. The kernel reads the declaration; nothing else
registers a system. There is no shared state type: the system exports its own
slice type.

| Field | Meaning |
|---|---|
| `id` | Equals the folder name. Lower case letters, digits, hyphens. |
| `version` | Version of the slice shape. Starts at 1. |
| `initial()` | A new slice. Must be JSON. |
| `migrations` | Step N takes slice data from version N to N + 1. Imported from `./migrations`. |
| `stats` | Derived values the system owns, each with a base. Ids start with `<id>/`. |
| `modifiers` | Modifier sources. Ids start with `<id>/`. A source may list `dependsOn`. |
| `resolve(ctx)` | Optional. Computes every stat under `<id>/` that has no base (section 6). |
| `tick(ctx)` | Runs once per tick. |
| `commands` | `handle(commandDef, (ctx, payload) => result)`. Types start with `<id>/`. |
| `events` | `on(eventDef, (ctx, event) => void)`. Any system's events. |
| `requests` | `answer(requestDef, (ctx, payload) => result)`. Types start with `<id>/`. |
| `content` | Registry name to `registry(schema, data, title)`. |
| `view(ctx)` | What the UI reads. Returns new objects, never the slice. |
| `order` | Tick order, lower first. Ties run in id order. Default 0. |
| `newRun(ctx, previous)` | Optional. Runs after a new run replaced every slice (decision 30). `previous(system)` reads a slice as the old run left it. |

`defineSystem` throws on a bad id, a missing or extra migration step, and a
stat, source, command or request outside the system's namespace.

The context (`ctx`) given to `tick`, command handlers and event handlers:

| Member | Use |
|---|---|
| `state` | The system's own slice. Mutate in place. |
| `tick` | Current tick number. |
| `catchingUp` | True while the kernel runs offline catch-up (decision 34). |
| `rng` | The seeded generator: `next()`, `int(n)`, `chance(p)`. |
| `content` | `all<T>(registry)`, `get<T>(registry, id)`. |
| `derived(stat, entity?, variant?)` | A derived value. `entity` defaults to the player. |
| `stats(entity?, variant?)` | Every derived value of an entity, as a read-only map. |
| `modifiers(entity?)` | Every modifier collected for an entity, read-only. |
| `read(otherSystem)` | Another system's slice, read-only. |
| `emit(event, payload, source?)` | Queue an event. `source` defaults to the system id. |
| `request(request, payload)` | Ask the system that answers `request`. Returns its answer now. |
| `touch(sourceId, entity?)` | Bump a modifier source's change counter, for every entity or for one. |
| `dropEntity(entity)` | Forget the derived values of an entity that no longer exists. |
| `skip(action, reason)` | Log an action that did not happen, outside a command. |
| `endRun()` | End the run: after the current command or tick step drains, every slice starts new and each `newRun` runs (decision 30). |

## 3. State and commands

- The kernel owns one plain object: `{ kernel: { tick, rng }, slices: { <id>: ... } }`.
- State changes in two ways only: `kernel.dispatch(command)` and `kernel.tick()`.
- A command is `{ type, payload }`. `defineCommand<P>('counter/buy')` gives a
  typed builder. A handler returns `OK` or `skipped(reason)`.
- The UI never holds the state. It holds `kernel.view()`: a new object per
  call, built from each system's `view`. The shell stores it in a `$state.raw`
  field and replaces it after each batch of ticks and each command. In dev the
  view is deep-frozen.
- `src/ui/game.svelte.ts` is the only file that owns a kernel in the page.
  Panels call `send(command)` and `viewOf(system)`.

## 4. Tick and determinism

- 10 ticks per second (`TPS`, `MS_PER_TICK`).
- `TickAccumulator` turns frame time into ticks. One frame runs at most 30
  ticks; the remainder is dropped.
- A gap longer than 3 seconds goes to catch-up (section 8), not to the
  accumulator.
- The random generator is mulberry32. Its whole state is `state.kernel.rng`,
  so a save holds it.
- Kernel and system code may not use `Math.random`, `Date` or
  `performance.now`. A test scans for them. Wall-clock time enters only as an
  argument (`save(now)`).
- `tests/determinism.test.ts`: the same seed and commands give the same state;
  a run split by a save and a load gives the same state as the whole run.

## 5. Save

- One envelope: `{ format, savedAt, kernel: { version, data }, slices: { <id>: { version, data } } }`.
  Each slice has its own version.
- A system that changes its slice shape bumps `version`, adds one step to its
  `migrations.ts` and adds one fixture file. No other file changes.
- A migrations file may contain `import type` and no other import, no dynamic
  import, no `require`, no `import.meta`, no re-export. Ids and numbers it
  needs are written as literals. `tests/migrations.test.ts` enforces this for
  `src/kernel/migrations.ts` and every `src/systems/**/migrations.ts`, and
  checks that a system's `index.ts` takes `migrations` from `./migrations`.
- Fixtures: `tests/fixtures/<id>/v<N>.json`, one per version, slice data only.
  The tests check that each step turns fixture N into fixture N + 1, that
  every fixture loads, and that the game runs on it. Fixture N + 1 is the
  output of step N on fixture N; write it by running the step, then read it.
- `kernel.load(envelope)` builds the whole new state first and swaps it in
  only on success. On failure the running state is unchanged.
- Storage key: `ksgb:<mode>:save`, from `storageKey(mode)`. `mode` is Vite's
  build mode, so the dev server uses `ksgb:development:save` and a build uses
  `ksgb:production:save`.
- `SaveStore` locks itself when a read fails, and the shell locks it when
  `kernel.load` fails. A locked store refuses every write. The only way out is
  `setAsideBroken`, which copies the stored text to `<key>.broken.<time>`
  first. The shell shows the error and a button for this.

## 6. Derived values

- A modifier source is `{ id, dependsOn?, collect(ctx) => Modifier[] }`.
  `collect` reads state and content, and `ctx.entity`. It may not read
  derived values.
- Each source has a change counter. The cache key is built from the counters
  of every registered source. There is no list to maintain: a new source is
  in the key because it is registered.
- Rule for system code: when you change something a source's `collect` reads,
  call `ctx.touch(sourceId)`. Loading a save touches every source.
- `kernel.staleStats()` recomputes everything without the cache and returns
  the stats that differ. An empty list means no `touch` is missing. Call it in
  the tests of every system that has a source.

Entities:

- A derived value belongs to an entity. The player is `PLAYER` (`'player'`),
  the default of every read. Any other id is an entity too: a monster in a
  fight is one. The kernel does not know what an entity is; the system that
  owns it does.
- A source is collected once per entity. `collect` returns the modifiers of
  `ctx.entity`, and an empty list for an entity it has nothing to say about.
  The player and a monster go through the same sources, the same cache and
  the same resolver.
- `ctx.touch(sourceId)` bumps the source for every entity.
  `ctx.touch(sourceId, entity)` bumps it for one entity; the others keep
  their cache.
- An entity gets its record on first read or touch. `ctx.dropEntity(entity)`
  removes the record when the entity is gone (a monster dies). The player
  cannot be dropped. A load drops every entity but the player; their values
  are rebuilt on first read from the loaded state.
- `staleStats()` checks every entity that has a record. A stale stat of
  another entity is reported as `<entity> <stat>`. `kernel.entities()` lists
  the entities that have a record.

How a value is computed:

- **Default formula.** A stat a system declares in `stats` with a base is
  `(base + sum of add modifiers) * product of mult modifiers`.
- **Resolver.** A system that declares `resolve(ctx)` computes every stat
  under `<id>/` that has no base. It gets `ctx.mods`, every modifier
  collected for the entity that targets `<id>/`, from every source in source
  order, and returns a record of stat id to value. Every returned id starts
  with `<id>/`. It is a pure function of `mods`, `entity`, `variant` and
  `content`: the context has no slice and no `read` (decision 32).
- A modifier may carry more fields than `stat`, `kind` and `value` (a label,
  a gate, an origin). The kernel passes them through; the resolver reads them.
- A modifier must target a declared stat, or a target under the prefix of a
  system with a resolver. Any other target throws. A target under a
  resolver's prefix is the resolver's to check.
- **Variant.** `derived(stat, entity, variant)` asks the resolver for a
  second block from the same collected modifiers. The variant is an opaque
  string the resolver defines; `''` is the plain block. Variants are cached
  with the entity and rebuilt with it. The default formula ignores the
  variant.

Groups (decision 32):

- The collected modifiers of an entity are split by target into groups: one
  per resolver prefix, and one for the stats with a base.
- A touched source is collected again on the next read. Its modifiers are
  compared with what it returned before, group by group, by value. A group
  with no difference keeps its result: a resolver keeps its output for every
  variant. Only the groups that differ are computed again.
- `ctx.resolved(prefix, entity?, variant?)` returns a resolver's output. It
  is the same object while the group's modifiers are unchanged, so a reader
  may key its own cache on it: `statBlockOf` keys the stat block on the
  output of `stats/`. A key on `ctx.stats()` changes whenever any group
  changes.
- `ctx.stats()` returns a table that reads the groups in place; making one
  copies nothing.

Dependencies between sources:

- A source whose `collect` reads another system's slice lists the sources of
  that system that cover what it reads: `dependsOn: ['resources/locks']`. A
  touch of a listed source touches the dependent source in the same call.
- The kernel throws at creation on a dependency that names no registered
  source, and on a cycle.

## 7. Events

- `defineEvent<P>('counter/milestone')` declares a typed event.
- `ctx.emit(event, payload, source?)` queues it. Every event carries `type`,
  `source`, `tick` and `payload`.
- Delivery happens after the current handler returns, in emit order, to the
  subscribers in system order. A handler may emit more events.
- More than 100,000 events in one drain throws; that is a loop.
- A system subscribes through `events` in its declaration. It does not edit
  the emitting system.
- `kernel.onEvent(listener)` is for the UI and tools. It runs after the
  systems and is not part of the simulation.

## 7a. Requests

- `defineRequest<P, R>('statuses/apply')` declares a typed request: a
  payload type and a result type.
- The owning system declares the answer: `requests: [answer(def, (ctx, payload) => result)]`.
  One answer per type. The type starts with the system id.
- `ctx.request(def, payload)` runs the answer at once, with the answering
  system's context, and returns its result to the caller. The answer changes
  its own slice only, and may `touch` its own sources.
- Events an answer emits are queued. They are delivered after the handler
  that made the request returns.
- A request no system answers throws. More than 32 nested requests throw;
  that is a loop.
- A view cannot make a request.

Which to use:

| Need | Use |
|---|---|
| Read another system's state | `ctx.read(system)` and that system's exported read functions. |
| Change another system, and the caller needs the outcome in the same handler (what landed, how much was paid) | A request the other system declares. |
| Change another system, no outcome needed | An event the other system declares and subscribes to (decision 27). |
| Tell whoever listens that something happened | An event the emitter declares. |

An answer returns copies, never a reference into its slice.

## 8. Headless runner and catch-up

- `runHeadless(kernel, { ticks, commands })` runs ticks and scheduled commands
  with no DOM. `commands` is a list of `{ at, command }`, `at` in ticks from
  the start of the run.
- `catchUp({ systems, envelope, ticks, commands, now })` loads an envelope
  into a new kernel, runs it with `runHeadless`, and returns the new envelope.
  JSON in, JSON out.
- `catchUp` creates its kernel with `catchingUp: true`: `ctx.catchingUp`
  is true in every handler of that run and false in every other kernel
  (decision 34).
- `src/worker/catchup.worker.ts` calls `catchUp` and nothing else. The page
  sends `kernel.save(now)` and loads the reply with `kernel.load`. If a worker
  cannot be created, `src/ui/catchup.ts` calls `catchUp` on the main thread.
- Offline time is capped at 8 hours (`OFFLINE_CAP_MS`).
- The offline budgets are in `tests/budgets.test.ts`, the vitest project
  `budget`. `npm test` and `npm run verify` run the project `unit` (every
  other test file, in parallel workers) and then `budget` alone, so a budget
  measures the simulation and not how many test files share the processor.
  Until spine port 5 the budget cases ran inside the parallel run, in
  `tests/runner.test.ts`, `tests/statusSystem.test.ts` and
  `tests/combatBudget.test.ts`; the "inside the full test run" numbers below
  are from that arrangement. Under machine load they failed with the code
  unchanged: floor 1 fights took 12,600 to 14,600 ms inside the run and
  4,400 ms alone.
- `tests/runner.test.ts` checks that catch-up equals running in place. The
  first budget was 2,000 ms for 8 hours (288,000 ticks). Measured with the
  systems of spine port 1: 470 to 530 ms alone, up to 840 ms inside the full
  test run (the toy system alone took about 60 ms). Measured on 2026-11-16
  with spine port 2, same machine and same hour: 700 ms alone, against 650 ms
  for port 1, and 1,150 ms inside the full test run. Spine port 3 (five more
  systems, none with a tick), same machine: 700 to 715 ms alone, 1,106 ms
  inside the full test run. Lower or raise the budget as real systems land;
  do not delete the test.
- That test runs a character with no condition. `tests/statusSystem.test.ts`
  has a second budget, 8,000 ms, for 8 hours with a condition that deals
  damage on every tick: measured 2,650 ms alone and 4,070 ms inside the full
  test run (1,450 ms alone with a condition that only changes stats). The cost is the events of the damage, four per
  tick. Spine port 3: 3,096 ms alone, 3,944 ms inside the full test run.
- Spine port 4 (combat), measured on 2026-11-17, same machine. No fight, no
  condition: 929 ms alone, 1,447 ms inside the full test run; the budget of
  `tests/runner.test.ts` was raised to 3,000 ms. With a bleed held: 3,561 ms
  alone, 5,577 ms inside the full run; budget 8,000 ms. A third budget,
  `tests/combatBudget.test.ts`: 8 hours of fights at a floor 1 table through
  `runHeadless`, 3,931 ms alone and 7,126 ms inside the full run for 9,673
  kills; budget 12,000 ms. Each budget test sets its own time limit above
  its budget, so the budget is what fails and not the test runner's default
  of 5,000 ms.
- Spine port 5 (techniques, casts, workings), measured on 2026-11-17, same
  machine. No fight, no condition: 918 ms alone, 1,348 ms inside the full
  test run. With a bleed held: 3,650 ms alone, 5,718 ms inside the full
  run. Floor 1 fights: 4,104 ms alone, 8,781 ms inside the full run, the
  same 9,673 kills. The three budgets are unchanged. A fourth run in
  `tests/combatBudget.test.ts`: 8 hours at the Tunnels of floor 6 (goblin,
  hobgoblin, firetongue, witch doctor, groups of up to three) with a
  character the probe makes fit for the floor: 11,500 to 12,400 ms alone,
  11,700 ms inside the full run, for 11,231 kills, 1 defeat, 1,954 casts
  and 1,615 techniques; budget 20,000 ms. A profile of that run puts about
  5 of 13.8 seconds in building stat tables (`build` of the kernel cache,
  `tableOf` and `computeBlock` of `stats`, `statBlockOf`): a group of up to
  three monsters is three entities to build, and each condition landing on
  either side rebuilds a block. The casts and the techniques are not in the
  first 30 entries of the profile. Decision 4 (one cache for all stats)
  left per-stat dependency tracking until a measurement asked for it; this
  one does. It is listed for port 7 in `docs/SPINE.md`.
- Spine port 6 (world, ladder, knockout, weather), measured on 2026-11-17,
  same machine, each alone. Four more systems tick. No fight, no condition:
  1,231 to 1,234 ms (port 5: 918). A condition held: the case holds a
  timerless poison now, 4,963 to 5,003 ms, with a knockout each time the
  recovery ends; the bleed of the earlier measurement is ended by the
  forced rest of the first knockout. Floor 1 fights sent to `combat`
  directly: 5,237 to 5,368 ms, the same 9,673 kills (port 5: 4,104).
  Floor 6 Tunnels sent to `combat` directly: 14,368 to 14,767 ms, 11,328
  kills, 1 defeat, 1,958 casts, 1,595 techniques (port 5: 11,500 to
  12,400). The four budgets are unchanged. Two new runs through the world
  system, the vitest project `budget-world` (`tests/budgetsWorld.test.ts`,
  a file of its own because one worker running all six passes the 60
  seconds vitest gives it to answer): the hunt activity at the Woods Edge
  of floor 4, a new character under the open sky, 18,923 to 19,656 ms, 9,834
  kills, 4 knockouts each followed by the return; the hunt activity at the
  Tunnels of floor 6 with the probe character, 18,608 to 19,636 ms, 11,360
  kills, 1 knockout. Budget 30,000 ms each. `npm test` and `npm run verify`
  run `unit`, then `budget`, then `budget-world`.
- Catch-up work (decision 32), measured on 2026-11-17, same machine, each
  run alone through `scripts/budget-runs.ts`, two rounds. Before is `main`
  at 7b59ba1 the same day.

  | Run of 8 hours | Before | After | Budget |
  |---|---|---|---|
  | No fight, no condition | 1,281 to 1,370 ms | 1,293 to 1,331 ms | 2,000 ms (was 3,000) |
  | A poison held | 4,841 to 4,939 ms | 4,857 ms | 7,500 ms (was 8,000) |
  | Floor 1 table sent to combat | 5,278 to 5,579 ms | 4,554 to 4,621 ms | 7,000 ms (was 12,000) |
  | Floor 6 Tunnels sent to combat | 14,383 to 15,643 ms | 9,386 to 9,777 ms | 15,000 ms (was 20,000) |
  | World: hunt, floor 4 Woods Edge | 19,226 to 19,293 ms | 9,157 to 9,515 ms | 15,000 ms (was 30,000) |
  | World: hunt, floor 6 Tunnels | 18,833 to 20,515 ms | 9,297 to 9,649 ms | 15,000 ms (was 30,000) |

  Every run ends on the same outcome digest as before (`tests/outcomeDigests.ts`).
  Profile before (`node --cpu-prof`, world floor 6, 19.9 s of simulation
  under the profiler): stat table builds 5.0 s (`statBlockOf` to the kernel
  `build`, the stats resolver, `tableOf`), the `skills/check-discovery`
  handler 3.2 s, the rest spread over combat, statuses, resources and event
  delivery. What changed: (1) decision 32: the player's `stats/` block is
  kept while only stats outside `stats/` change; on floor 6 the player's
  plain block is computed 206 times instead of 25,301, its target variants
  529 times instead of about 3,000 (`scripts/cache-census.ts`); (2) `skillsTrainedBy` in
  `skills` keeps the skills a tag list trains; (3) `tableOf` uses precomputed
  keys; (4) event delivery holds each subscriber's context. Profile after
  (same run, 10.3 s under the profiler): combat tick 4.5 s, event delivery
  2.3 s, the player's status tick 1.2 s, the resources tick 1.0 s; by file,
  `combat/engine.ts` 1.45 s, `statuses/index.ts` 1.26 s, `kernel/derived.ts`
  0.96 s, `kernel/kernel.ts` 0.82 s. Monster blocks are still built once per
  monster (11,500 on floor 6): each rolls its attributes.
- Not met: the target of 5,000 ms for the world runs and floor 6. What is
  left is no longer one hot spot: about 1.4 million events per 8 hours on
  floor 6 (a `resources/healed` every tick, three events per condition
  damage tick), the per-tick work of combat, statuses and resources, and one
  stat block per monster. Further gains need work in those systems' tick
  paths, each checked against the digests.
- Catch-up pass 2, measured on 2026-11-17, same machine, each run alone,
  two rounds. Before is `main` at 243f981 (pass 1) the same day.

  | Run of 8 hours | Pass 1 | Pass 2 | Budget |
  |---|---|---|---|
  | No fight, no condition | 1,293 to 1,331 ms | 1,316 to 1,359 ms | 2,000 ms |
  | A poison held | 4,792 to 4,961 ms | 4,692 to 4,912 ms | 7,500 ms |
  | Floor 1 table sent to combat | 4,554 to 4,834 ms | 4,506 to 4,548 ms | 7,000 ms |
  | Floor 6 Tunnels sent to combat | 9,007 to 10,381 ms | 8,853 to 8,917 ms | 13,500 ms (was 15,000) |
  | World: hunt, floor 4 Woods Edge | 9,157 to 9,515 ms | 8,597 to 8,662 ms | 13,000 ms (was 15,000) |
  | World: hunt, floor 6 Tunnels | 9,272 to 10,638 ms | 8,578 to 8,817 ms | 13,000 ms (was 15,000) |

  Every outcome digest is unchanged. The poison run after pass 1, measured
  alone five times alternating with `main` at 7b59ba1 (a worktree at
  63bac7c, same source): 4,682 to 4,836 ms before, 4,792 to 4,961 ms after,
  about 2.6% slower in every pair. Cause: pass 1 made each status operation
  read the `stats/` resolver output at its start as well as the table. Pass
  2 reads it from the frozen table on first use (`resolvedOf`, decision
  33). Five pairs again: 4,656 to 4,825 ms before, 4,692 to 4,844 ms after,
  means 4,750 and 4,761, one pair in favour of the branch: no longer
  measurably slower.

  Profile at the start of pass 2 (floor 6, a wrapper timing every tick hook,
  event handler and request answer, inclusive and with its own overhead):
  combat tick 17.9 microseconds per tick, statuses tick 4.7, resources tick
  3.9; per event, `resources/damage` 3.0 and its subscribers 2 to 3 each
  (148,000 per 8 hours); per kill, `loot/roll` 33 and the ladder's floor
  check 18; about 1.9 million table reads and 1.8 million resolver-output
  reads. Pass 2 changes: resolver lookup by a map and the plain variant held
  in a slot; one shared empty split for sources that return nothing (most
  sources for a monster); a monster block built without the applied-modifier
  list the table does not read; the pool hooks read with precomputed ids;
  the swing's tag list built when the bar fills, not on every tick; the
  status operation fix above.

  Tried and dropped: a table that builds one merged map after 16 reads
  (floor 6 slower); a status operation that captures its frozen table on
  first read (a dirty record could then be collected after the operation
  changed the list, which changes results); the resolver's own block object
  handed to `statBlockOf` (its keys are not in `STAT_KEYS` order, so a
  reader that iterates it would see another order).

- Not met after pass 2: 5,000 ms for floor 6 and the world runs. The
  combat tick is half of each run, and it is many small steps per tick
  (cooldowns, enemy conditions and regeneration, the buff rotation asked of
  every action kind, the player's and each enemy's bar) and one stat block
  per new monster; the statuses and resources ticks and the event traffic
  are most of the rest. No step is above 10% of a run. Reaching 5 s needs a
  rework of those tick paths, for example combat keeping per-fight values
  that it now reads again each tick, with the digests as the check.

- Budgets raised 10% (user decision, 2026-11-18, step 3 cooking port).
  On this machine on 2026-11-18, `main` at 57912c9 failed four limits
  with no change: floor 1 7,043 ms (7,000), floor 6 13,963 ms (13,500),
  world floor 4 14,270 ms (13,000), world floor 6 14,952 ms (13,000). The
  cooking port adds two tick hooks (`cooking` at order -50, `meals` at 50;
  the old `Game.advance` ran meal steps before and after the conditions)
  and costs 3 to 6%, about 0.4 microseconds per tick; with both hooks
  removed the no-fight run equals `main`. Same hour, alternating,
  `scripts/budget-runs.ts`, ms:

  | Run of 8 hours | `main` | Cooking branch | Budget |
  |---|---|---|---|
  | No fight, no condition (5 pairs) | 1,796 to 1,888, mean 1,842 | 1,894 to 2,018, mean 1,952 | 2,200 (was 2,000) |
  | A poison held | 7,087 to 7,118 | 6,924 to 7,275 | 8,250 (was 7,500) |
  | Floor 1 table sent to combat | 6,333 to 6,708 | 6,716 to 7,496 | 7,700 (was 7,000) |
  | Floor 6 Tunnels sent to combat | 13,257 to 13,348 | 13,825 to 13,988 | 14,850 (was 13,500) |
  | World: hunt, floor 4 Woods Edge | 13,318 to 13,353 | 13,813 | 14,300 (was 13,000) |
  | World: hunt, floor 6 Tunnels | 13,187 to 15,082 | 13,804 to 16,405 | 14,300 (was 13,000) |

  The two-hook port is kept (folding the early step into the late hook of
  the tick before would change when a queued dish is eaten relative to a
  command between ticks). The machine's spread is wide: world floor 6 on
  `main` ran 13,187 to 15,082 ms within one hour.

- Speed test against the old build (2026-11-21; factor 0.5, user decision
  of the same day). `tests/speed.test.ts`, the vitest project `speed`, run
  alone after `budget-world` by `npm test` and `npm run verify`.
  - Held: 8 hours of catch-up (288,000 ticks) in four states built from
    John inside the test (seed 42, Skip tutorial, through floor 7;
    `tests/speedStates.ts`): hunting floor 1, hunting floor 6, idle in town,
    hunting floor 7. Each run is divided by a yardstick (`tests/reference.ts`:
    a fixed workload with no game code, about 200 ms) measured in the same
    worker right before it. The case fails when
    `run ms / yardstick ms >= 0.5 x old ms / old yardstick ms`, with the old
    build's medians of `docs/PERFORMANCE.md` section 1.1. A failing state is
    measured once more; the case passes if that attempt passes. The
    rebuild's kills must be within 10% of the old build's.
  - Reported, not held (printed, never fails): live play, `kernel.tick()`
    plus `kernel.view()` per tick against the old `game.tick()`; the floor 6
    save size against the old build's. Both fail the factor today.
  - The absolute budgets above stay. They cover other runs (a new
    character, a poison held, the world system) in this machine's
    milliseconds and say nothing about the old build.
  - Margins per state, run time, the spread idle and under load, and how to
    update the old-build constants: `docs/PERFORMANCE.md` section 5.

- Speed pass 1 (2026-11-21, `docs/PERFORMANCE.md` section 6): six fixes,
  each with every outcome digest unchanged. In the kernel: the derived
  cache keeps the player's record and its plain table in fields, remembers
  the last resolver prefix, splits the clean-record check from the rescan,
  and indexes a record's per-source counters and collections by source
  position. Floor 6 catch-up: 0.88 of its time before the pass (fresh
  processes). The budget runs, 3 alternating rounds, medians in ms:

  | Run of 8 hours | Before | After | Budget |
  |---|---|---|---|
  | No fight, no condition | 1,646 | 1,646 | 2,200 |
  | A poison held | 4,907 | 4,202 | 8,250 |
  | Floor 1 table sent to combat | 5,012 | 4,750 | 7,700 |
  | Floor 6 Tunnels sent to combat | 8,746 | 8,178 | 14,850 |
  | World: hunt, floor 4 Woods Edge | 9,022 | 8,101 | 14,300 |
  | World: hunt, floor 6 Tunnels | 8,808 | 8,126 | 14,300 |

  The budgets are unchanged.

## 9. Content

- A registry is one JSON file: a list of records, each with an `id`.
- The file path is fixed: `src/systems/<system>/content/<registry>.json`.
- The owning system declares `content: { <registry>: registry(schema, data) }`
  with `data` imported from the JSON file. Registry names are unique across
  the game.
- A schema is plain data built with `s.string`, `s.id`, `s.number`,
  `s.boolean`, `s.enum`, `s.ref`, `s.array`, `s.object`, `s.optional`.
  `RecordOf<typeof registry>` gives the record type.
- `validateContent(systems, override?)` is the only validator. It checks each
  record against the schema, rejects unknown fields, duplicate ids and bad
  ids, and resolves every `s.ref` across registries. Callers: the tests, the
  kernel at creation, the forge page, and the forge server before a write.

## 10. Skipped actions

- A command that does not run returns `{ ok: false, reason }`. The kernel logs
  it with tick, source and action. `ctx.skip` logs one from a tick hook or an
  event handler.
- The log keeps the newest 50 entries. It is not saved.
- The published view carries the log. `src/ui/DevLog.svelte` lists it, with
  recent events. `App.svelte` mounts it only when `import.meta.env.DEV` is
  true.

## 11. Shell UI

- `src/ui/tokens.css` is the only stylesheet. It may style `:root`, `html`
  and `body` only. Every other style is in a component's `<style>` block.
  `:global` is not allowed. Tests enforce all three.
- A theme is a value of `data-theme` on `<html>`. `tokens.css` holds one block
  of colour tokens per theme. Adding a theme adds one block and one entry in
  `THEMES` in `src/ui/theme.svelte.ts`.
- Phone layout: 640 pixels wide and narrower. One column; the navigation is a
  bar at the bottom. Touch targets are at least `--tap` (44 pixels) high.
- A panel is `src/systems/<name>/panel.ts` default-exporting
  `{ systemId, title, component }`.
- An overlay is `src/systems/<name>/overlay.ts` default-exporting
  `{ systemId, place, component }` (decision 31). `src/systems/overlays.ts`
  builds the list. The shell mounts every overlay on every view: a `banner`
  above the panel, a `modal` over the page. The component reads the view and
  decides when it shows.

## 12. Forge

- `npm run forge` opens `/forge/` on the dev server. The page is not part of
  a build.
- It lists the registries from the system declarations, draws a form for one
  record from the schema, validates on every edit, and posts the registry to
  `/__forge/save`.
- The server (`forge/server/`) validates again with `validateContent` and
  writes the JSON file. An edit with an issue is not written.
- Not built yet: add record, delete record, reorder, form controls for nested
  lists and objects (they fall back to a JSON text box).

## 13. How to add a system

1. Create `src/systems/<name>/index.ts`. Default-export `defineSystem` with
   `id: '<name>'`, `version: 1`, `initial`. Export the slice type.
2. Add what the system needs, in the same folder:
   - commands: `defineCommand`, `handle`;
   - events: `defineEvent`, `on`, `ctx.emit`;
   - requests: `defineRequest`, `answer`, for a change whose outcome the
     caller needs in its own handler (section 7a);
   - stats and modifier sources, with `ctx.touch` at every change, and
     `dependsOn` on a source that reads another system's slice;
   - `tick`;
   - content: `content/<registry>.json`, a schema, `registry(...)`;
   - `view` and its type.
3. Add `tests/fixtures/<name>/v1.json`: slice data at version 1.
4. Add `README.md` in the folder: what the system does and its skip reasons.
5. For a panel: `panel.ts` and a `.svelte` file. The panel uses
   `viewOf(system)` and `send(command)`, tokens for every colour and size, and
   no `:global`.
6. Add tests under `tests/`. Use `runHeadless` for anything that takes time.
   Assert `kernel.staleStats()` is empty if the system has a modifier source.
   A system that owns entities calls `ctx.dropEntity` when one is gone; its
   tests assert that `kernel.entities()` holds no dead entity.
7. Run `npm run verify`. Open the panel in a browser at desktop width and at
   phone width.

No file outside the folder changes, except tests and fixtures. The system
list, the panel list, the forge registry list and the save envelope pick the
system up from its declaration.

To change a slice shape later: bump `version`, add the step to
`migrations.ts`, add `tests/fixtures/<name>/v<new>.json`.

## 14. Decisions

Made while building the kernel, where `docs/REBUILD.md` did not settle the
point. Each took the simpler option.

1. **System list from folders.** `import.meta.glob` builds the system list
   and the panel list. Alternative: a hand-written list. The glob keeps
   "adding a system touches one folder" literally true. Tick order is `order`
   then id, so it does not depend on file-system order.
2. **Panel declared apart from the system.** `index.ts` must load in the
   worker and in node, so it cannot import a Svelte file. The panel is
   `panel.ts` in the same folder.
3. **Explicit `touch`.** A source's counter is bumped by the system, not
   detected by the kernel. Detection would need proxies or a state diff every
   tick. `staleStats()` is the check against a missing `touch`.
4. **One cache for all stats.** Any touched source rebuilds the whole stat
   table, but only touched sources are collected again. Per-stat dependency
   tracking is left until a measurement asks for it. Revised by decision 32:
   the measurement came, and the cache is split into groups.
5. **Change counters are not saved.** They are cache bookkeeping. A load
   touches every source.
6. **Events are queued.** Delivery is after the emitting handler returns, not
   inside `emit`. A handler never runs in the middle of another handler.
7. **Unknown slices are dropped at load, with a warning.** A slice in the
   save with no system in the build is not carried forward. A missing slice
   starts new, with a warning.
8. **No slice validation hook.** After migration the data is trusted to have
   the slice shape. A system that needs a check can do it in its last
   migration step.
9. **Migrations may use `import type`.** Types are erased at build time, so
   they cannot change what a step does.
10. **Catch-up hands state over as a save envelope.** The worker gets
    `kernel.save()` and returns the same shape; the page calls `kernel.load`.
    No second serialisation format.
11. **Catch-up threshold.** A frame gap over 3 seconds (the 30-tick frame
    cap) goes to catch-up. Under that, the accumulator handles it.
12. **Save stamp.** `savedAt` is the wall-clock time the state is simulated up
    to, not the time of the write. A timer that fires in a hidden tab
    therefore cannot erase offline time.
13. **Content validated at kernel creation.** The kernel throws on invalid
    content. `validateContent: false` turns it off; catch-up uses that because
    the page already validated.
14. **Registry names are global.** `ctx.content.all('steps')`, not
    `'counter/steps'`. Two systems declaring one name is an error.
15. **Stylesheet rule.** `tokens.css` may also style `html` and `body`
    (margin, background, font), because no component owns those elements.
16. **Three themes.** `dark`, `light`, `parchment`. The third exists to show
    that a theme is tokens only. Colours are placeholders, not a port of the
    old themes.
17. **The forge does not reload pages for its own writes.** A file the forge
    wrote within the last 3 seconds does not trigger a reload, so the status
    line and other edits survive. The game page needs a manual reload to see
    the new content.
18. **No component tests.** The UI was checked by hand in a browser. jsdom
    was not added.
19. **Ports.** Dev server 5600, preview 5601, both strict. Port 5173 belongs
    to the old repository.
20. **Line endings.** `.gitattributes` sets LF for all text files.
21. **Stats per entity (spine port 1).** A derived value is read for an
    entity, the player by default. Alternative: a second stat table inside
    the combat system for monsters. That would give monsters a second code
    path for modifiers, cache and the stale check, which the monster-side
    parity law of the old build forbids. The entity is a plain string id, so
    the kernel needs no registry of entities and no list to maintain.
22. **Entity records are made on first use and dropped by the owner.** An
    entity other than the player lives for one fight. The system that owns it
    calls `ctx.dropEntity`. Not dropping leaks a cache record; it does not
    give a wrong value. A load drops all of them.
23. **Resolvers.** The old stat pipeline is not `(base + add) * mult`: bases
    depend on attributes, attack speed converges, values are clamped, and one
    layer of modifiers is scaled by other stats. A system may therefore
    declare `resolve`, which computes its whole block from the collected
    modifiers. Alternative: make every stat a small formula with declared
    dependencies. That would spread one ordered pipeline over 67 declarations
    and make "same order as the old code" unreadable. The default formula
    stays for stats that are plain numbers.
24. **Modifiers carry extra fields.** The kernel type has `stat`, `kind` and
    `value`. A source returns objects with more fields and the kernel passes
    them through. The resolver owns their meaning.
25. **Variants.** A read may name a variant: a second block from the same
    collected modifiers, for the old target-gated bonuses (a bonus against
    beasts). Alternative: one entity per pair of player and target, which
    would collect every source again per target.
26. **Source dependencies.** A source may read another system's slice. That
    system cannot touch a source it does not know. Alternative: an event
    from one system to the other, which arrives after the current handler
    returns and leaves the stat stale until then. `dependsOn` makes the touch
    reach the dependent source in the same call.
27. **Requests are events.** A system that wants another system to change
    emits an event the other system declares and subscribes to
    (`counters/bump`, `skills/grant-xp`, `resources/heal`). The kernel has no
    call from one system into another that returns a value. A caller that
    needs the result (what an exertion bought, what a heal restored) reads it
    from the event the other system emits afterwards. Combat will need some
    of these results inside one handler; spine port 4 decides whether the
    kernel gets a synchronous request. Decided in port 2: decision 28.
28. **Requests (spine port 2).** A system may declare requests, and
    `ctx.request` returns the answer inside the caller's handler (section
    7a). The old status module returned what an application landed and what
    a tick dealt, and combat reads both in the middle of resolving one blow.
    Alternatives: (a) the caller owns the list and calls pure functions on
    it; then the player's list would sit in the slice of whichever system
    calls, and the status source could not read it without importing its
    callers; (b) results as events (decision 27), which arrive after the
    handler that needs them. Rule for a later port: read with `ctx.read`
    and the owner's read functions; change through a request when the
    outcome is needed in the same handler, through an event otherwise. A
    request is the one case where a handler of one system runs inside a
    handler of another (decision 6 holds for events). `resources` still
    takes heals, damage and exertion as events; port 4 adds requests there
    for the results it needs.
29. **A panel may mount a component of another system.** The character
    panel is in `attributes` and mounts `statuses/StatusList.svelte`, as it
    already imports the index of `resources`, `skills`, `levels` and
    `clock`. Adding the status list added two lines to that panel.
30. **A new run (spine port 7).** A prestige replaces every slice but the
    legacy. `ctx.endRun()` asks for it; after the asking command or tick step
    has drained, the kernel replaces every slice with `initial()`, keeps the
    tick and the generator, drops every entity but the player, touches every
    source, then runs each system's `newRun(ctx, previous)` in system order
    and drains. What carries is each system's own rule, in its own
    `newRun`: `prestige` copies its slice (the legacy block) and sets the
    counters a run starts with, `items` keeps the stash, `weather` keeps the
    seed and the first-calm flag. Alternatives: (a) the prestige system
    writes every slice (no system may write another's slice); (b) every
    system hears a reset event and resets itself (every folder edited for
    prestige, and a new system that forgets to listen keeps its run state).
    `tests/newRun.test.ts`.
31. **Overlays (spine port 7).** The shell shows one panel at a time. The
    defeat summary, the review after a prestige and the floor 0 card must
    show whatever panel is open, as the old `App.svelte` mounted them. A
    folder may export `overlay.ts` beside `panel.ts`; the shell mounts the
    list. Alternative: the shell imports the three components, which breaks
    "the shell imports the kernel and the lists only".
32. **Stat groups (catch-up work).** Decision 4 rebuilt the whole player
    table on any touch. The profile of the floor 6 run (section 8) put 5 to
    6 of 15 seconds in stat table builds, about 145 microseconds each: 25,000
    rebuilds of the player, one per change of `statuses/held`, and 11,500
    monster blocks. Census of the touches: nearly all player rebuilds came
    from a condition whose stamina ceiling (`resources/ceiling.stamina`, a
    stat with a base) decays every few ticks; the 70 stats under `stats/`
    did not change. Change: the collected modifiers are split into groups by
    target (one per resolver prefix, one for stats with a base); a
    re-collected source is compared with its last collection group by group,
    by value; a resolver's output is kept while its group is equal. The
    resolver now receives only the modifiers of its own prefix; the stats
    pipeline already skipped every other target, so its output is the same.
    Determinism: a resolver is a pure function of its group, the entity, the
    variant and the content (its context lost `state` and `read`), so a kept
    output equals what a new computation would give. Equality is by value
    (numbers by `Object.is`, plain objects and arrays by content, anything
    else by identity), so a source that returns new objects with the same
    content keeps the output, and any difference recomputes it. Tests:
    `tests/outcome.test.ts` and the budget files compare an outcome digest
    (tick, generator, kills, defeats, level, gold, a hash of every slice)
    with values recorded on `main` before the change;
    `tests/staleSources.test.ts` checks one case per source of change.
    Alternatives: (a) per-stat dependencies declared by each source; the
    pipeline is one ordered computation (decision 23), so a stat cannot be
    computed apart from the others; (b) a memo of whole blocks keyed by the
    modifier content; measured 269 hits in 39,829 builds on floor 6, because
    every monster rolls its attributes and the decaying ceiling never
    repeats. Monster blocks are still built once per monster; they were made
    cheaper (precomputed table keys), not avoided.
33. **`resolvedOf` (catch-up pass 2).** A reader that holds a table from
    `ctx.stats()` across a change, as a status operation holds the player's
    table from its start, can ask which resolver output that table was
    built from: `resolvedOf(table, prefix)`. Alternative: read
    `ctx.resolved` at the start as well, which cost the poison run about
    2.6%; or read it on first use, which gives a later block when the
    record was dirty at the start.
34. **`ctx.catchingUp` (step 4 port C1, request K1).** Old content keeps
    clocks that run in play only: the ward window counts live ticks (old
    `tickWards(state, catchingUp)`), the sea pays offline convoys by a
    share, the festival clock reads the same flag. The context of every
    handler carries `catchingUp`, read-only. `catchUp` creates its kernel
    with `catchingUp: true`; every other kernel, including one run by
    `runHeadless`, has it false. `tests/runner.test.ts` keeps the
    equality of catch-up and running in place for content with no such
    clock and names each system that reads the flag, with a case showing
    the difference. Alternative: a mode argument on `tick()`; rejected,
    because a command or event handler inside a catch-up tick must see the
    same value.
