# statuses

Status conditions (poison, burns, chills, wounds, buffs from dishes) of every
entity. The player and the monsters of a fight hold them in one slice and go
through one engine.

Port of: old `systems/statuses.ts` (`engine.ts`), `systems/conditionHarm.ts`
(`harm.ts`), `data/statuses.data.ts` (`content/statuses.json`, `defs.ts`),
and `tickPlayerStatuses` of old `systems/actions.ts` (the tick in
`index.ts`).

## Files

| File | Holds |
|---|---|
| `defs.ts` | Schema, record types, `STATUSES`, `StatusInstance`, `StatusApplication`. |
| `engine.ts` | The rules, as functions on the list one entity holds. No kernel context. |
| `harm.ts` | `harmOf`, `isHarmful`, `resistanceProblems` (the lint). |
| `index.ts` | The slice, the requests, the events, the modifier source, the player's tick, the view. |
| `StatusList.svelte` | The player's conditions. Mounted by the character panel. |

## Rules

- A condition is one entry per entity with an intensity. `stacking.mode`
  decides what a second dose does: `highest`, `absorb`, `sum`, `count`,
  `extend`.
- A first dose creates the entry and returns. The cap is consulted from the
  second dose on. At the cap a condition clamps, or escalates
  (`escalatesTo`); with `escalateFrom` every dose past it rolls, with odds
  that reach 1 at the cap.
- Removal rules belong to the instance: an application may bring its own
  `removal` and `duration`; the definition's are the default.
- Resistance answers the dose, by `element`: the resistance before the cap
  plus `resElemental` for the elemental types. At 1 or more, after the
  applier's penetration, nothing lands. Below that the dose is multiplied by
  `max(0.25, 1 - clamp(res, -1, 0.9))`. A condition with no element is not
  resisted. `unresistable` lands in full.
- A transformation (`reform`: escalation, `converts`, `expiresTo`,
  `becomes`, `baseForm`) is not resisted. `blockedBy` and immunity still
  refuse it.
- The tick reports damage, drains, restores, detonations and a fatal
  condition; the caller applies them.
- Thresholds that are shares (`dot.currentHp`, `dot.maxHp`, `ceilings`,
  `negativeHeadroom`, `ceilingPerTick`) scale with the bearer's pool.

## Slice

| Field | Holds |
|---|---|
| `held` | Entity id to the list of `StatusInstance`. An entity that holds none has no key. |
| `inCombat` | The player is in a fight. Old `state.combat !== null`. |
| `down` | The player is knocked out. Old `state.recovering`. Clocks run 5 ticks per tick. |

## The same-handler rule (docs/KERNEL.md decision 28)

- **Read**: any system, at any time, with the read functions on
  `heldOf(ctx.read(statuses), entity)`: `statusBlocks`, `statusMissChance`,
  `statusRetaliation`, `graftHarvest`, and the rest of the export list of
  `index.ts`. `magnetBypassesDodge` and `statusDisplacedExit` roll: the
  caller passes `(p) => ctx.rng.chance(p)`.
- **Change with a result**: `ctx.request(applyStatus, { entity, app, ... })`
  and the other requests. The answer is a copy; the list is changed only
  here.
- **Change with no result needed**: the events below.

Requests (old function of the same name, with `entity` in the payload):
`applyStatus`, `applyStatuses`, `reform`, `removeStatus`, `clearStatuses`,
`fireStatusEvent`, `tickStatuses`, `stripStatuses`, `amplifyStatuses`,
`statusBarDamage`, `consumeMagnetCharge`, `tendOnDamage`, `dueGraftSpread`,
`noteHealed`, `noteResourceSpent`.

`resist` in an application payload: for the player, true when the dose is
done to the player (a bite, an enemy working, spoiled food) and absent for
what the player grants to themselves. This is the old "pass the stat block"
rule. Any other entity always resists.

## Events this system subscribes to

| Event | Declared by | Emitted by | Does |
|---|---|---|---|
| `resources/healed` | resources | resources (port 1) | Records the heal against a heal cap; fires `heal` with the kind. |
| `resources/damaged` | resources | resources (port 1) | Fires `damageTaken` with type and amount lost. |
| `resources/spent` | resources | resources (port 1) | `noteResourceSpent`: a condition that eats effort grows its debt. |
| `statuses/hook` | here | Port 4 combat: `barFill`, `barDeplete`, `combatEnd`, `damageTaken` on a monster. Alchemy and consumables: `cure` with a tag. | `fireStatusEvent`. |
| `statuses/inflict` | here | Port 4: a monster's `wears` at spawn. Port 6 weather: the sky rules, with a source that starts with `Weather: `. Cooking, alchemy, mutagens: grants. | `applyStatuses`. |
| `statuses/situation` | here | Port 4: `inCombat` at fight start and end. Port 6: `down` at knockout and recovery. | Sets the two flags. |
| `statuses/forget` | here | Port 4: a monster entity is gone. The emitter also calls `ctx.dropEntity`. | Deletes the entity's list. |

A caller that needs the answer in its own handler (combat applying a bite
and reading what landed) uses the request of the same meaning instead.

## Events this system emits

`statuses/damage` (the player's condition damage of a tick, with the hits),
`statuses/detonated`, `statuses/fatal`, `statuses/expired`; and the
requests of other systems: `resources/drain`, `resources/heal`,
`resources/restore`, `resources/damage`, `log/line`, `log/feed-floating`,
`log/feed-settle`.

## Stats

- Source `statuses/held` (`HELD_SOURCE`), per entity. It returns: the `mods`
  scaled by effective intensity (origin `status`); `dampFact`;
  `resOverrideFact`; `resFloorFact` and `resFloorTakenFact`;
  `attrCeilingFact`; and the pool hooks of `resources` (`ceiling`,
  `costMult`, `regenBlocked`, `headroom`, `healCapped`, `healAllowance`).
- Every operation compares `sourceSignature` of the list before and after and
  touches the source for that entity when it differs. A condition the source
  returns nothing for (eyeless, buffeted) is not in the signature.
- Hook stat `statuses/ward` (base 0): the share of condition damage an entity
  sheds. The mutagens port moves it (old `fastGuard`).
- Immunity from another system: `namedFact('statusImmune:<status id>', 1)`
  or `namedFact('statusImmuneElement:<damage type>', 1)` for an entity. The
  titles port states an earned title's `immune` this way.

## Content

`statuses` (80 records, the whole old registry) and `statuses_text`.
Converted with `node scripts/convert-content.mjs statuses`. Three fields
differ from the old literals: an absent `duration` is the old `null`;
`overrideRes` is a list; an application writes `permanent: true`.

Fields that point at registries not ported yet are plain strings, not
references: `forceStyle` (combat styles), `displaces.to` (martial
positions), `damp.slot` (equipment slots), `art`.

## Skip reasons

- A request or `statuses/inflict` with an unknown status id: `unknown status "<id>"`.
- `statuses/forget` for the player: `the player cannot be forgotten`.

An application that does not land (immune, blocked, a failed roll) is an
outcome, not a skip: the request answers null.

## Left behind

- The knockout: `statuses/fatal`, `statuses/detonated` and
  `statuses/damage` are emitted; ending the fight, 1 HP, `recovering`, the
  retreat and the "knocks you out" line are port 6 and port 4.
- The fight ledger's attribution of condition damage (`noteConditionDamage`):
  port 4, from `statuses/damage`.
- Monster ticks: combat calls `tickStatuses` per monster and applies the
  result (old `combat.ts:3925-4030`), and `dueGraftSpread`.
- The surplus ledger (`data.surplus`): the engine sheds it; the writer is
  forced healing (`healEnemy`, port 4 or arcane), which needs a request that
  adds to it.
- Titles (`TitleDef.immune`), styles (`effectiveStyleId` reads
  `statusForcedStyle`), the fast's dulling of penalties and its ward
  (mutagens), `MonsterDef.wears`, weather doses, food grants.
- The full tooltip (`statusTipLines` of the old interface): the view carries
  the description and a few facts; per-second damage and modifier lines need
  the format library.
- Tests left behind are `it.todo` in `tests/statuses.test.ts`,
  `tests/conditionResist.test.ts` and `tests/derivedcache.test.ts`, each
  with the port it waits for.

## Differences from the old build

- The tick applies its results through events. They are handled after the
  status tick returns, in the same game tick. The old function returned
  early when a detonation knocked the player out; here the rest of the tick
  (expiry lines, the condition damage) is still sent.
- The player's resistances for one operation are read from the stat table as
  it stood when the operation began (the old callers passed one block per
  call). Another entity is read live (the old monster readers).
- `resources/healed` arrives after the heal: two heals in one handler both
  see the allowance as it was before the first.
- The resistance before the cap is a stat of the table. The old side table
  was lost by a copy of the block; there is no copy here.

## Old rules ported as they are

- `jolted` halves on any `damageTaken`, including the damage of another
  condition's tick. A poisoned or bleeding bearer loses a jolt in a few
  ticks.
- `tendOnDamage` runs for monsters only. The old comment says "wherever
  `damageTaken` is announced"; the player's damage door never called it.
- A removal rule with a bare `on: 'heal'` (no `healKinds`) would fire on the
  idle trickle of every tick. No record has one.
- `costMult`, the bar damage and `expireDamage` scale with the raw intensity;
  `mods`, `ceilings` and `damp` with the effective one.
- A fatal condition (`corrupted`) is reported on every tick the pool is at 0;
  only the `down` flag stops it from being cut again.
- `expireDamage` is floored at 0 after resistance and takes no ward and no
  pierce; the dot takes both.
