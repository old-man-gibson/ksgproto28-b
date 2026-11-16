# counter

A toy system. It has no game rules and is not a port of anything in the old
repository. It exists to use every part of the system contract once, so the
kernel has something to run and the tests have something to check. Delete it
when the first real system is ported, or keep it as the worked example.

## What it does

- A number, `count`, grows every tick by `counter/rate / 10`.
- Each tick has a 1 in 100 chance, drawn from the kernel's seeded generator,
  of a gain 10 times as large.
- Steps are bought with `count`. A step adds to the rate or multiplies it.
- Each time `count` passes a multiple of 100 the system emits
  `counter/milestone`, and counts the events it handles.

## Contract parts used

| Part | Where |
|---|---|
| Slice, version 2 | `CounterState` in `index.ts` |
| Migration 1 to 2 | `migrations.ts`; fixtures in `tests/fixtures/counter/` |
| Stat and modifier source | `counter/rate`, source `counter/steps` |
| Tick hook | `tick` in `index.ts` |
| Command | `counter/buy`, built with `buyStep({ stepId })` |
| Event | `counter/milestone`, emitted and handled here |
| Content registry | `steps`, data in `content/steps.json` |
| View | `CounterView`, built by `view` |
| Panel | `panel.ts` and `CounterPanel.svelte` |

## Skip reasons

`counter/buy` is skipped, with a reason, when the step id is unknown, when the
required step is not owned, or when `count` is below the cost.
