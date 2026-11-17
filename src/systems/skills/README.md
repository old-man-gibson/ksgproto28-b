# skills

Skill discovery, XP, levels, caps, novelty and the skill tree.

Port of: old `systems/skills.ts` and `data/skills.data.ts` (94 skills, the
word skills included), and the skill block of `collectBaseMods` in old
`systems/attributes.ts`.

## Rules

- **Training.** An action carries tags. It trains a skill when it matches the
  tags the skill adds to its parent, and everything the parent chain needs.
  Practice flows up the tree and never sideways.
- **Discovery.** During an action that trains it, a locked skill whose unlock
  conditions all hold manifests at level 1.
- **Manifesting by XP.** A skill gated only on attributes (Magic, Arcana,
  Devotion, Psionics) also banks XP while locked and manifests when the bank
  holds its first level's cost.
- **Caps.** A skill with `maxLevel` discards XP at its cap. The cap is
  `maxLevel` plus the raises this run earned plus the raises the legacy holds.
- **Novelty.** A skill with a `novelty` record pays `(k + n) / (c + n)` times
  the ordinary amount for an input seen n times. A grant with no input key
  pays 1. Several keys pay their mean.
- **Reveal.** A locked skill is shown when its parent is held and every
  threshold of its unlock list is at 90% (`REVEAL_FRACTION`), or with
  Foresight. A held skill under a locked parent shows the parent as hinted.

## Slice

`{ skills, latent, novelty }`: held skills (`{ level, xp, capRaised? }`), XP
banked for locked skills, and per skill the times each input was seen.

## Requests

| Event | Effect |
|---|---|
| `skills/check-discovery` `{ tags }` | Manifests every locked skill the tags train whose conditions hold. |
| `skills/grant-xp` `{ tags, amount, sourceKey?, scale? }` | XP to every held skill the tags train; banks for locked skills that manifest by XP. Multiplied by the `skillXp` stat. |
| `skills/grant-xp-direct` `{ skillId, amount, scale? }` | XP to one skill. |
| `skills/grant-discovery-xp` `{ domain, weight?, scale? }` | The flat `discovery` value to every skill that learns from the domain. |
| `skills/raise-cap` `{ id, by? }` | Raises the ceiling of a held, capped skill. |

Emitted: `skills/unlock { id }`, `skills/levelup { id, level }` once per
level, a log line on a manifest and on a cap raise, and a bump of the counter
`skill:levels` per level.

`scale` multiplies a grant to held skills and not what is banked, as the old
`scaledSkillXp` did (Shadow Clones).

## Modifier source

`skills/effects`: each held skill's effects at its level, marked
`scaleBy: 'talent:<id>'`, and its reached milestones.

## Conditions

`conditionReader(ctx)` builds the reader of the player for the condition
language of the counters system: skill levels from this slice, attributes and
wielded tags from the stat block, counters from the counters slice, quests
and boons from the named facts `quest:<id>` and `boon:<id>`.

## Content

`skills`, `skill_categories`, `skills_text`. A skill record carries its XP
curve inline.

## Skip reasons

- `skills/grant-xp`, `skills/grant-xp-direct`: the amount is not above 0.
- `skills/grant-xp-direct`: the skill is locked and does not manifest by XP.
- `skills/raise-cap`: the skill has no cap; it is not held; the raise is not
  above 0.

## Left behind

- Who grants XP and checks discovery: combat, actions, quests, the bestiary,
  the spell table. They emit the requests above.
- Practice shaping (`practiceXp`): no hook; the granting system shapes the
  amount.
- Talent, cap raises of the legacy, Foresight: read as facts the prestige
  port states (see the stats README).
- Unlock conditions on a wielded tag hold only for `unarmed` until the items
  port states what is wielded.
- A skill panel of its own. The character panel shows the tree.

## Differences from the old build

- The counter `skill:levels` and the log lines are written after the handler
  returns, not inside it. A discovery pass that manifests two skills sees the
  counter as it was before the first.
