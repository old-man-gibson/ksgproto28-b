# divine

Miracles and the deities they come from: the registries, the spell a miracle
resolves to and how two deities stand toward one another.

Port of: `MIRACLES` of old `data/spellcraft.data.ts`, `data/deities.data.ts`,
`miracleSpec` of old `systems/divine.ts`, `deityRelation` of old
`systems/deities.ts`.

Section "Design" was written and committed before the code.

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

## Skip reasons

None: this system has no command, no request and no tick.
