# counters

Named numbers that gates, quests, achievements and prestige read, and the
condition language that reads them.

Port of: the counter half of old `systems/achievements.ts` (`state.stats`,
`bumpStat`, `raiseStat`, `setStat`) and `systems/conditions.ts`.

Note: old `systems/ledger.ts` is the fight ledger, not the counters. It is not
ported here; it belongs to the combat port.

## Slice

`{ counts: Record<string, number> }`. A key that was never written is absent
and reads 0. Keys are free-form strings with a colon-separated prefix, as in
the old build: `kills`, `kills:<monster>`, `kills:tag:<tag>`,
`slain:<spot>:<monster>`, `gold:earned`, `attr:<id>`, `skill:levels`,
`level:floor:<floor>`.

`flag:*` is not a separate mechanism. A flag is a counter that holds 0 or 1
under the `flag:` prefix (`flagKey`, `hasFlag`).

## Requests (events this system subscribes to)

| Event | Effect |
|---|---|
| `counters/bump` `{ key, amount? }` | Adds `amount` (default 1). |
| `counters/raise` `{ key, value }` | Sets the counter if `value` is higher. No effect otherwise. |
| `counters/set` `{ key, value }` | Overwrites. The reset path. |
| `counters/clear` `{ key }` | Removes the key. |

Each write emits `counters/changed { key, value }`. The achievements port
subscribes to it for tier checks.

A system bumps a counter by emitting the request itself. The old build wired
these in one place (`registerAchievementListeners`); here the emitting system
does it: attributes raise `attr:<id>`, skills bump `skill:levels`.

## Conditions

`conditions.ts`. A condition is data, one of seven kinds: `skill`, `attr`,
`stat`, `statMax`, `equippedTag`, `quest`, `boon`. All seven are ported.

`conditionMet`, `conditionProgress`, `conditionsMet` and `conditionsProgress`
take a `ConditionReader`, an object with one function per kind. This file
imports no system. The reader of the player is `conditionReader(ctx)` in the
skills system, which takes each kind from the system that owns it.

`conditionSchema` is the schema of a condition in a content file. The kernel
schema has no union type, so every field but `type` is optional in it;
`conditionIssues` checks that a record has exactly the fields its type needs.

## Skip reasons

- `counters/clear`: the counter is not set.

## Left behind

- Bumps on kill, arrival and defeat (`kills`, `kills:<id>`, `kills:tag:<tag>`,
  `travel:trips`, `defeats`): the combat and world ports emit them.
- Achievement tiers (`checkAchievements`): the achievements port.
