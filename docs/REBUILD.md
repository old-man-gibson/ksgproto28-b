# Rebuild plan

This repository is a rebuild of `ksgproto28` (the kitchen sink game, a Svelte 5
and TypeScript idle RPG). Goal: the same mechanics and feature extent on a
skeleton where adding a system touches one folder.

Written 2026-11-16. The old repository is the reference for every rule.

## 1. Decisions (user, 2026-11-16)

- Save: starts fresh at version 1. No importer from the old version 65 save.
- Old repository: frozen for features for now.
- Strict port: no rule changes during the port. Open design questions stay
  parked in the old repository's docs.
- Licensed art: all of it gitignored. This repository is public. See
  `.gitignore` for the folder rule.

## 2. What the old build cost

Surveyed on old `main` at `7c1267b`.

| Sync point | Old build | Cost |
|---|---|---|
| State | One flat `GameState`; `types.ts` 7,010 lines | Every system edits the same type file |
| Save | Version 65; about 64 steps in one 792-line file that imports live content | A migration changes meaning when content changes |
| Derived stats | Cache keyed by a hand-listed `modFingerprint` | A new modifier source is stale until added by hand |
| Core and UI | Core mutates the Svelte `$state` proxy | The `??=` trap; catch-up needs snapshot, worker, `Object.assign` |
| Combat | `combat.ts` 5,419 lines | Every system hooks in by editing it |
| Content | TypeScript literals; forge edits by AST; validation written twice | A new registry takes two steps; comments are load-bearing |
| Dev save | Same localStorage slot as the real save | A dev server can overwrite the real save |
| CSS | Global `.bar` and `.panel` selectors | Clipping that DOM checks cannot see |

Size of the old build: core 86,293 lines, UI 43,843, forge 16,969, tests
61,960 in 175 files.

## 3. The skeleton

Each rule below removes one row of the table.

- **System module.** A system is one folder. It declares: state slice, initial
  state, migrations, modifier sources, tick hook, event handlers, content
  schemas, panel, doc. The kernel reads the declarations. No shared type file.
- **Save.** Each slice has its own version number. A migration is a function
  from JSON to JSON with no imports. Each version keeps a golden fixture file
  in tests.
- **Dev slot.** The storage key includes the build mode. A dev server cannot
  read or write the release save.
- **Core boundary.** Core owns plain state. The UI reads a published view and
  sends commands. Core never runs inside a Svelte proxy.
- **Catch-up.** The same core runs in a worker and applies the same commands.
  No snapshot step. A time budget per 8 offline hours is a test.
- **Determinism.** The random seed lives in state. A headless runner replays a
  command list. Balance measurement uses the runner.
- **Derived stats.** Each modifier source carries a change counter. The cache
  key is built from the registered sources.
- **Fight events.** Combat emits typed events, each with a source. Statuses,
  techniques and Facet abilities subscribe. No system edits the combat file to
  hook in.
- **Content.** Data files, one schema per registry, declared by the owning
  system. The forge and the tests call the same validator. The forge edits
  data, not syntax trees.
- **Failures.** A skipped action returns a reason. A dev overlay lists them.
- **CSS.** Global design tokens only. Every other style is component-scoped.
  Themes and the phone layout exist from the first panel.

Unchanged from the old build: Svelte 5, TypeScript, Vite, vitest, 10 ticks
per second, the forge as the authoring path, Facet as an external runtime,
cross-system laws enforced by tests.

## 4. Build order

1. **Kernel.** The skeleton in section 3, an empty shell UI, the forge reading
   schemas, `npm run verify` in continuous integration.
2. **Spine.** Floor 0 and floors 1 to 3, up to first prestige. Needs combat,
   statuses, derived stats, attributes, skills, levels, navigation, quests,
   shops, prestige.
3. **Systems, one per port.** Martial, arcane, divine, alchemy, cooking,
   smithing, mutagens, psionic, runecarving, Facet abilities.
4. **Content.** Bands 2 to 20, festival, weather and moons, sea.
5. **Last.** Music (on hold in the old repository).

Not ported: everything in the old `docs/LONGTERM.md` and
`src/core/data/shelved/`.

## 5. Definition of a finished port

One system is ported when all of these hold:

- The system folder holds its slice, content, panel and doc.
- The old test files for that system pass here, changed only where the
  skeleton changed the call shape.
- `npm run verify` passes.
- The panel is checked in a browser at desktop and phone width.

## 6. Parity check

- The 175 old test files are the specification.
- A headless climb run on both builds reaches each floor in similar game
  time. The tolerance is set when the spine runs.

## 7. Risks

- **Size.** Combat is the largest single port.
- **Divergence.** The freeze on the old repository is "for now". Any feature
  added there after the spine runs here is owed twice.
- **Redesign creep.** A port that also changes rules has no test to pass.
  Section 1 forbids it.
