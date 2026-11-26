# mutagens

The chromosome: a body (the main gene in the centromere), mutations in
sockets, connections that route each mutation's effect to one of four arms,
the capacity pool, the kill harvest, refinement at the culture bench,
nucleases and fusion, and the gene's own ability in a fight. Step 3, port 7.

## Step 3 design

Written and committed before the code.

### What old `main` has for mutagens

Surveyed on old `main` at `7c1267b`. The branch `docs/mutagens-review` (body
layer, Allotment, Figures, Vivarium lift) is not an ancestor of `main`
(`git merge-base --is-ancestor` fails): not ported. Of `docs/plans/`,
`bearer-seam.md` is built on `main` (`genomeOf(bearer)`: every bearer has a
chromosome, a monster wears bare); `monster-def-genome.md`,
`monster-genomes.md`, `monster-gene-active.md`, `mutagenic-monsters.md` and
`genome-capability-rule.md` are not (`MonsterDef` has no `genome`): not
ported. `docs/MUTAGENS.md` is the spec; where it says "inert" and the code
on `main` reads a thing, the code wins (the Attacks arm re-types the swing
and reads `ignores_dodge` and `splits_target` since a later commit).

| Kind | Old file | Lines | What |
|---|---|---|---|
| Rules | `src/core/systems/mutagens.ts` | 2,298 | Pure: layouts, `expressedMain`, `genomeOf`, routing (`hopDistances`, `walk`, `amplification`), `resolveChromosome` (keyed memo of 8), capacity, `rekeyGene`, `weakPointsOf`, delivery (`contributionWeight`, `deliveredBy`, `armDelivery`), grants (`bearerGrants`, `liveGrants`, `grantIsLive`, `armGrants`), `applyActiveArm`, `geneAbility`, `priceGeneAbility`, `abilityCarries`, `pricesABlow`, `loudestType`, `routedType`, `perTargetInflictIntensity`, fasts (`fastOf`, `fastGuard`, `fastRegenBonus`), tongues (`spokenAs`), refuting (`refuteCast`, `isSealed`), `syncGeneStatuses`. State: `harvestKill`, `refine`, `fuse`, `slotMain`, `unslotMain`, `placeMutagen`, `removeMutagen`, `establish`, `cutEdge`, `restoreEdge`, `unlockMutagens`, settling, `chromosomeMods` |
| Data | `src/core/data/mutagens.data.ts` | 1,895 | Tuning, the baseline layout, 4 genera, 30 main genes and bare, 11 hand-written mutations, 11 element lines (generating 31 edges, brands and wards), 1 nuclease, the fused mutagens (nuclease x element, generated), `elementOf`, `startingKit`, `freshMutagenState` |
| Text | `text/mutagens.text.ts`, `text/log.text.ts` `mutagens.*` | 58, ~40 | Gene and nuclease descriptions; reason and log lines |
| Data | `disciplines.data.ts` `mutagens` | record | The culture bench: `refines`, one `subject` slot (gene, mutagen), 240 ticks, xp 10 |
| Data | `locations.data.ts` | `benches` | The Vivarium (Alembic Row) holds the culture bench; the base lab is shelved |
| Data | `materials.data.ts`, `recipes.data.ts` | records | `biomatter`, `histone`, every gene, mutation and fused id as a graded material (already in `materials.json` here); the histone recipe stands only at a shelved location |
| Seams | `combat.ts` | many | Gene active in the rotation (`GENE_ACTIVE`), the gene blow (pricing, stun, self delay, riders, size doubling, execute, splash), the Attacks arm (`routedType` re-types the swing; `ignores_dodge`, `splits_target`), refuting, tongues, incantation, volley, floating grips, on-crit riders |
| Seams | `derived.ts` | | `chromosomeMods` into the stat list; `playerSizeRank` |
| Seams | `equipment.ts`, `wield.ts` | | `bearerGrants`: `arms:+N`, `onehand:*`, `telekinetic:N` |
| Seams | `resources.ts`, `attributes.ts`, `actions.ts` | | The fast (regeneration, guard, ward) |
| Seams | `benchwork.ts` | | `refines` branch: `previewRefine`, `refineOnce` |
| Seams | `game.ts` | | `registerMutagenListeners` (the `kill` harvest), `syncGeneStatuses` every tick |
| UI | `src/ui/panels/ChromosomePanel.svelte` | 1,104 | The diagram, the body card, the ability card, arm cards with Delivers lines, routes, the picker, edges (establish, cut, restore), capacity |
| UI | `src/ui/panels/BenchPanel.svelte` | parts | The culture bench: subject picker, refine cost, Divine ceiling |
| UI | `src/ui/panels/DebugPanel.svelte` | parts | Fuse every pairing, skip settling, grant genes. Fusing has no player control on `main` |
| UI | `ui/lib/format.ts` | parts | `geneAbilityLanded`, `geneAbilityLines`, `describeGrant` |
| Tests | `tests/mutagens.test.ts` | 2,732, 214 cases | Laws, capacity, harvest, refinement, the bench, edits, delivery, amplifiers, pricing, nucleases, both arms, the asura genes, telekinesis, the bearer seam |
| Tests | `incoming.test.ts`, `wield.test.ts`, `combat.test.ts`, `conditionFixes.test.ts`, `gearcompare.test.ts`, `festival.test.ts` | cases | Size, giant throws, arms grants, per-target inflicts, the festival |

### What of it reaches floors 0 to 6

- The chromosome starts open with the kit (`d`-centre special, `g`-centre
  attacks), as on `main` (the "alpha" default).
- The harvest rolls on every kill: biomatter (25%), the gene of the species
  (`slime_base_basic` gives `slime_gene`; no other gene's species stands on
  a spot through floor 6), mutations by tag (`beast`, `construct`, `earth`,
  `slime`, `vermin`, `toxic`, `wind`, `water`, `dark`, `undead`, ...), and
  the Vulnerability Nuclease (`undead`: `slime_zombie`).
- The Vivarium stands in Threshold: refinement runs there.
- Histones have no source through floor 6 (the recipe's only location is
  shelved), so establishing an edge is refused with the histone reason.
- Slime Bounce (the slime gene's ability) is the only gene ability a player
  can wear.

### System folder

One system, `mutagens`. The old file splits into a pure half and a state
half, both of which only this system uses.

| File | Holds |
|---|---|
| `defs.ts` | Schemas and registries (`genes`, `mutations`, `element_lines`, `nucleases`, `genera`, `layouts`, `mutagens_text`), the tuning numbers, the generated blocks and fused mutagens (`elementalBlocks`, `fusedMutagens`), `elementOf`, `edgeKey`, `startingKit` |
| `engine.ts` | The pure half of old `mutagens.ts`, one function each |
| `index.ts` | Slice, commands, the harvest, the bench owner, the stat source, the combat registrations, the view |
| `ChromosomePanel.svelte`, `panel.ts` | The Chromosome panel, with the culture bench when standing at one |
| `content/*.json` | The registries, converted from the old literals with their texts |

Slice (version 1): `{ unlocked, chromosome: { layout, main, placed,
established, cut }, known: { genes, mutagens }, settleUntil }`. The old
settling clock lived in `state.useCooldowns.centromere`; here it is the
slice field `settleUntil` (a clock tick). A new run (prestige) starts the
slice new, as old `createInitialState` did.

Content: all 30 genes and bare, all mutations, the nucleases and the
genera are ported as data, though one gene drops through floor 6: the pure
tests read the giants, the asura and the slime ladder, and the content
tests check every `from`. Gene fields read by nothing ported (fasts,
tongues, refutes, on-crit riders, conferred conditions, incantation,
volley, `clearsField`, the self `grants`) stay in the data and are listed
under Left behind. The edge, brand and ward blocks and the fused mutagens
are generated in code from `element_lines` and `nucleases`, as the old
module generated them: a fused id must be its own material, and three
parents meaning "poison" must not become three records.

Pure functions take what they read as arguments: the resolution reads the
registries only; pricing takes the stat block, an attribute reader and the
target's stack count. The resolution memo is a keyed LRU of 8, as the old
one (the view and the combat hooks ask it often).

### Commands, requests, events

| Command | Old | Refused when (logged with the old `🔒` line where the old code logged) |
|---|---|---|
| `mutagens/slot-main { id, quality }` | `slotMain` | not a main gene; none held; settling (seconds left); short of biomatter; over capacity |
| `mutagens/unslot-main` | `unslotMain` | already your own sequence; settling |
| `mutagens/place { socket, id, quality }` | `placeMutagen` | no such socket; not a mutagen; none held; over capacity |
| `mutagens/remove { socket }` | `removeMutagen` | socket empty |
| `mutagens/establish { a, b }` | `establish` | no such edge; already established; histones short; over capacity |
| `mutagens/cut { a, b }` | `cutEdge` | not established; already cut; over capacity |
| `mutagens/restore { a, b }` | `restoreEdge` | not cut |
| `mutagens/fuse { nuclease, id, quality }` | `fuse` | shut; not a nuclease; no element; no nuclease held; none held; short of biomatter |
| `mutagens/unlock { lowerArm }` | `unlockMutagens` | already open (old: silent return; here a reason) |

Request `mutagens/refine { placement }`: the bench run's craft, old
`refineOnce`. Event heard: `combat/kill` (old `kill` listener, the harvest).
Each edit of the chromosome touches the stat source and asks `items/set-bearer`
for the body's grants and size, which old `equipment.ts` read live through
`bearerGrants` and `playerSizeRank`.

### Other folders

- `benches`: the `mutagens` record (Culture Bench) with its `desc`; schema
  field `refines`. `mutagens` registers the owner.
- `combat`: `registerBody({ damageType, sureSwing, splitSplash })`, read by
  `playerDamageType`, the to-hit roll and the spill (old `routedType`,
  `armGrants(state, 'attacks', ...)`); `PickedActive.blow`, the gene blow of
  the old swing (not a weapon hit: no upkeep, exertion, extra swings, hand
  share, weapon riders, coating, position change, contact retaliation or
  `combat:attacks`; XP to `combat` and `geneshaping`, CON 3). The gene active
  registers as the kind `gene` at rank 10, as old `activeRotation` placed it.
- `world`: none (the Vivarium already lists `mutagens`).

### Stats

Source `mutagens/chromosome` (player only): the gene's base mods per arm,
then each route's delivered mods, labelled as the old (`<gene>` and
`<mutation> → <arm>`), no origin (the old list carried none). A monster
wears bare, whose every value is 0: the source returns nothing for it.

### Panel

One panel, Chromosome: capacity, the diagram (sockets, live, cut and
unestablished edges, the arm doors), the body card, the ability card
(`priceGeneAbility` against the current block), the four arm cards with
their Delivers lines and routes, the socket and centromere picker, edge
actions, stranded sockets. At a spot with the culture bench, a Culture
Bench block: subject picker from held genes and mutations, cost, Refine
and Refine all, the run bar.

### Tests

`tests/mutagens.test.ts` ports the old file case by case. Cases on parts
left behind (tongues, refuting, Nirākṣa, Vashkāra, telekinesis, the fast,
`syncGeneStatuses`, the old save migration) become `it.todo` with the
reason. Fixture `tests/fixtures/mutagens/v1.json`.

### Left behind

- Shadow Clones at the bench, the festival, the player base lab, the
  unlock quest (the gate is ported and starts open).
- Gene abilities other than a priced blow: buff abilities (slime guardian),
  `incant` (Nirākṣa), `volley` and floating grips (Vashkāra), `clearsField`
  and self `grants` (Kritavya), tongues (Tarunavāk), refuting (Kritavya),
  the fast (Anupama), on-crit riders, conferred conditions
  (`syncGeneStatuses`: troll's knitting, Nirākṣa's eyeless). None of their
  species stands on a spot through floor 6.
- `arms:+N`, `onehand:*`, `telekinetic:N` reach `items` through
  `items/set-bearer` (already ported there); nothing through floor 6 grants
  them.
- The debug controls (skip settling is a module flag for tests, as old).

### John and budgets

The harvest rolls the generator on every kill, as the old build did, so
John's climbs and every outcome digest change from here on. No tick hook:
the old `syncGeneStatuses` ran every tick only for conferred conditions,
which are left behind. The source joins the stat-group fingerprint by being
registered (kernel decision 32).

## Changed while building (step 3)

- The content registries are named `main_genes` and `chromosome_layouts`
  (file names follow registry names); the design said `genes`, `layouts`.
- Niraksa's on-crit `duration: 'permanent'` is `permanent: true`, the
  application shape of this repository's `statuses`.
- `priceGeneAbility(spec, stats, name, reads)`: the old took the state and
  the target; here an attribute reader and a reader of the target's stacks.
  `perTargetInflictIntensity(spec, gene, stacks)` takes the stack count.
- The body hooks of `combat` are one registration, `registerBody`; the
  splash hook returns the extra splash (`SPLIT_SPLASH`) or 0.
- The settling clock is the slice field `settleUntil`, not the old shared
  `useCooldowns.centromere`.
- `mutagens/unlock` on an open system answers a reason; the old
  `unlockMutagens` returned silently.
- The stat source returns nothing for a monster. The old pipeline pushed
  bare's six zero-valued attribute lines for every bearer; they change no
  number. For the player bare's zero lines are still pushed, as old.
- A buff gene ability, a volley and a wind-up answer a skip reason from the
  rotation ("waits for a later port") instead of acting.
- The Chromosome panel is smaller than the old one: no per-hop chips, no
  rate resolution of `fromStat` lines against the sheet, no ability card
  wording of old `format.ts` (`geneAbilityLines`). Each route opens on
  click to its notes.

## Old rules ported as they are

- The kit and the system start open (the old "alpha" default); the unlock
  quest was never built.
- Histones have no source the player can reach (old: only the shelved
  basement spools them), so no edge beyond the kit can be established.
- Fusing has no player control on old `main` (the debug panel only). The
  command `mutagens/fuse` is ported; the panel has no button for it.
- A stun takes `stun` off the target's action bar value, which the gene
  descriptions call ticks ("loses two ticks of action bar").
- Slime Bounce keeps its own type when the Attacks arm re-types the plain
  swing; only the Active arm re-types the ability.
- The spill loop walks the flank indices taken before any spill kill; a
  kill inside the loop can shift the line-up under it (old combat did the
  same).
- Bare's base is six attribute lines of value 0 (the old entry says why).
- Refusals of place, remove, cut, restore and unslot are not logged; only
  the over-capacity refusal of an edit, a refused swap, refine and fuse log
  the `🔒` line, as old.
- The old tests read grade `'S'` (upper case) for an approach of 1; ported.

## Panel as built

Header with capacity used and the limit; the body card (name, grade,
description, ceiling, settling, size) and the ability card (damage priced
against the current stat block, its working, cooldown); the diagram (live,
cut and unestablished edges, the four arm doors, a click on a node opens
it); the node picker (Wear, Revert to Bare Sequence, Place, Remove, and per
edge Establish with its histone cost, Cut, Restore); four arm cards (body
lines, Delivers, capabilities with "read by nothing here" where no system
reads them, routes that open to their notes); stranded sockets; the
Culture Bench block (where it stands, subject select, cost, Refine, Refine
all, Stop, a fixed-height bar and reason line).

## Left behind (as built)

As listed under "Left behind" in the design, plus: the ability card text
of old `format.ts`, the debug panel controls (grant genes, fuse every
pairing, skip settling; `setSkipSettling` remains for tests).

## Step 4 port F

- The craft request takes `xpScale` (a Shadow Clone's share of the skill
  XP, `benches` README, port F) and passes it as `scale` on its skill XP
  events. A clone's craft is otherwise the player's craft: the same preview,
  spend, roll and lines.
- The Chromosome (Culture Bench) panel mounts `facet/CloneBenchButton.svelte` ("Send a clone"),
  shown only while the held ability has clones.
