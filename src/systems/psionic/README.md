# psionic

The psionic school: a shape is points on eight axes; the axes are read as
eight derived quantities, and every field of the resolved spell is a function
of those. The wheel at the Spellcrafting Table, shapes held in mind, the gear
bias on the reading, and the school's registration with `spellcraft`.

Port of the old `systems/psionic.ts`, the psionic part of
`data/spellcraft.data.ts` (`PSIONIC`, `PSI_AXES`, `PSI_QUANTITIES`,
`PSI_RECOGNITIONS`, `PSI_STARTING_AXES`) and of `systems/spellcraft.ts`
(`shapePsionic`, the psionic case of `specForSource`, `spellKey` and
`resolveSpellFor`), and the psionic tab of `ui/panels/SpellcraftPanel.svelte`.
Design spec of the old build: `D:\ksgproto28\docs\PSIONIC.md`.

## Inventory of old `main`

Old `main` at `7c1267b`. Every file that names psionics, and what of it is
here.

| Kind | Old file | What it holds | Here |
|---|---|---|---|
| Rules | `src/core/systems/psionic.ts` (600 lines) | `psionicsLevel`, `psiAxisCap`, `psiAxes`, `psiTier`, `axisPoints`, `shapeTotal`, `learnPsiAxis`, `raisePsiTier`, `MAX_PSI_MEMORIZED`, `psiMemorized`, `memorizePsiShape`, `forgetPsiShape`, `shapeKey`, `checkShape`, `psiBiasFrom`, `deriveShape`, `recogniseShape` (`inRegion`, `subsumes`, `beats`), the characters, `shapeName`, `describeDerived`, `shapeSpec` | This system |
| Data | `src/core/data/spellcraft.data.ts` 1111 to 1451 | `PSIONIC` tuning, `PSI_AXES` (8), `PSI_STARTING_AXES`, `PSI_QUANTITIES` (8), `PSI_RECOGNITIONS` (7) | `defs.ts` (tuning), `content/psi_*.json` |
| Text | `src/core/text/spellcraft.text.ts` | Axis, quantity and recognition descriptions | In the content records |
| Text | `src/core/text/log.text.ts` | `psionic.reason.*`, `spellcraft.already_shaped`, `spellcraft.recognition_locked`, `spellcraft.shaped`, `common.locked` | `content/psionic_text.json` |
| Book | `src/core/systems/spellcraft.ts` | `shapePsionic`; the psionic `spellKey`; `specForSource` case; `resolveSpellFor` with `psiBiasFrom`; `PREPARED_SCHOOLS` includes `psionics` | `psionic/shape`; `registerSchool('psionic')`. The cap was ported with arcane. |
| Facade | `src/core/game.ts` | `shapePsionic`, `memorizePsiShape`, `forgetPsiShape` | Commands |
| Combat | `src/core/systems/combat.ts` | The focus gate in `pickActive`, `castSpell` and `castCraftedSelf` spending focus, the reading in the caster's hands | Ported with spellcraft (spine port 5) |
| Stats | `src/core/systems/derived.ts` | `maxFocus`, `focusRegen`, the seven `psi*` bias stats at 1 | Ported with stats (spine) |
| Pool | `src/core/data/resources.data.ts` | `focus` | Ported with resources (spine) |
| Statuses | `src/core/data/statuses.data.ts` | `psionic_haste`, `psionic_bracing`, `psionic_root`, `psionic_foresight`, `psionic_compression`, `psionic_read`, `psionic_wide_sight`, `kinetic_bulwark`, `dazed`, `concussed` | Ported with statuses (spine) |
| Items | `items.data.ts`, `materials.data.ts` | `antipattern_bracers` (acuity, coherence, purchase down), `bronze_dagger` and the bronze head (acuity, coherence up) | Ported (spine, smithing) |
| Skill | `skills.data.ts` | `psionics` (tag `psionic`, focus regen per level, manifests by XP) | Ported (spine) |
| Monster | `monsters.data.ts` | `psionic_slime`: two psionic shapes. Stands on no spot. | Ported (spine); its shapes now resolve |
| NPC | `npcs.data.ts` | `psionic_shaper` (Ilex), Censer Walk, no quests, teaches nothing | Ported with npcs (spine) |
| Quest | `quests.data.ts` | `faces_of_threshold` talks to Ilex | Quests (step 3 people) |
| Shutter | `systems/unlocks.ts` | `psionics` among `LOCKABLE_SUBSYSTEMS`: a UI shutter (`flag:unlock_psionics`) on the psionic tab; nothing in content lifts it | The panel reads the flag |
| Location | `data/locations.data.ts` | `base_psionics_lab` (the player base) | Left behind |
| UI | `ui/panels/SpellcraftPanel.svelte` | The psionic tab: the wheel, the dials, the quantity bars, the preview, the tier warning, the focus warning, held shapes, Shape / Memorise / Clear | `PsionicPanel.svelte` |
| UI | `ui/panels/DebugPanel.svelte` | Open every axis, set the tier | Commands with no button |
| UI | `LocationPanel.svelte`, `CombatPanel.svelte`, `ResourceBars.svelte`, `ui/lib/format.ts` | "· Psionic" on the table label, a school icon, the focus bar tip, intensity lines | Table label left behind; the rest ported with their panels |
| Forge | `forge/panels/PsionicBench.svelte` | The wheel with no caps, for authoring monster shapes | Left behind |
| Tests | `tests/spellcraft.test.ts` | `describe('psionic shaping')` (35 cases), the psionic rows of "monsters that work" (4), two content cases | `tests/spellcraft.test.ts` |
| Tests | `antimagic.test.ts`, `combat.test.ts`, `conditionResist.test.ts`, `cookbook.test.ts`, `skills.test.ts` | The psionic slime as a fighter, its resistances and size, the native conditions, the psionics skill | Ported already; the antimagic cases that gave the slime an arcane kit go back to its own shapes |
| Tests | `themes.test.ts` | Axis colours apart in every theme | No themes test here (the themes are placeholders, kernel decision 16) |
| Docs | `docs/PSIONIC.md`, `docs/plans/psionic-overload.md` | Spec; overload plan (status draft, never built) | Not ported (plan) |

Not built on old `main` and not ported: sustained workings, overload and
backlash, the ward and ceiling attack, composed statuses. `PSIONIC.md`
section 8 lists them as banked.

## Step 3 design

### What of it reaches floors 0 to 6

- The shutter is shut on a new save and nothing lifts it. The engine is not
  gated (old: a UI shutter only), so a save whose flag is set, or a test,
  shapes freely.
- A new mind holds force and reach, tier 0. No teacher opens an axis or a
  tier (Ilex teaches nothing). Tier 4 and 8 recognitions cannot be
  inscribed; Still Mind (no tier) needs vitality, which is closed.
- The axis cap is `min(10, 3 + floor(Psionics level / 8))`.
- The psionic slime stands on no spot. No John climb shapes.

### Slice (version 1)

| Field | Holds |
|---|---|
| `axes` | Open axes, in the order opened. `['force', 'reach']` new. The old `state.psi.axes`. |
| `tier` | Teacher tier. 0 new. The old `state.psi.tier`. |
| `memorized` | `{ name, shape }[]`, at most 8. The old optional `state.psi.memorized`. |

A shape in a command and in `memorized` is `Record<axis, points>`, as the
old `PsionicShape`. In the book (`spellcraft` slice) the source is the
content form of a monster's cast: `{ school: 'psionic', shape: { axis,
value }[] }`. `toShape` and `toShapeList` convert. The key is the old one:
axes with points, sorted, `axis<n>` joined by commas.

A new run (prestige) starts the slice new, as the old `createInitialState`
did; `prestige` carries the opened shutter flag.

### Content

| Registry | Records |
|---|---|
| `psi_axes` | id, name, icon, color, desc. Eight, old order. |
| `psi_quantities` | id, name, icon, formula, decimals, desc. Eight. |
| `psi_recognitions` | id, name, icon, desc, `region` as a list of `{ key, min?, max? }`, `tier?`, `priority?`. Seven. |
| `psionic_text` | Log templates and reasons. |

`PSIONIC` holds functions (`axisCap`, `pointCurve`, `inwardDuration`,
`adhesion`) and stays in `defs.ts` with the other numbers.

### The school

`registerSchool('psionic', { key, spec, reading })`:

- `spec(source)`: `shapeSpec(shape)` at tier 12 with no bias, memoised by
  `spellcraft` under the key. The old `specForSource`.
- `reading(reads, source)`: `shapeSpec(shape, 12, psiBiasFrom(stat block))`.
  The old `resolveSpellFor`. Needs the stat block, so `SchoolReads` of
  `spellcraft` gains `resolved` (every caller passes a context, which has
  it). That is the one edit in `spellcraft/spec.ts`.

`spellcraft/index.ts` gets the psionic case of the book's source text
("force 3 · reach 1", as the old `sourceLine`).

### Commands

| Command | Old | Skip reasons |
|---|---|---|
| `psionic/shape { shape }` | `shapePsionic` | `checkShape`'s reason; already in the grimoire; the shape matches a recognition above the taught tier. Each also logged, as old. |
| `psionic/memorize { shape, name? }` | `memorizePsiShape` | `checkShape`'s reason; already held; the mind holds 8. Old: `false`, no reason. |
| `psionic/forget { index }` | `forgetPsiShape` | no held shape at that index. Old: `false`. |
| `psionic/learn-axis { axis }` | `learnPsiAxis` | no such axis; already open. Old: silent. |
| `psionic/raise-tier { tier }` | `raisePsiTier` | not above the current tier. Old: silent (`max`). |

`psionic/shape`, in old order: the check; the duplicate; the tier gate
(recognition at tier 12, no bias); `skills/check-discovery` with
`['spellcraft', 'magic', 'psionic']`; `spellcraft/add`; 16 skill XP to the
same tags with the spell key as source; the log line "Shaped".

No tick hook, no modifier source, no event subscriber.

### View and panel

View: whether the shutter is open, whether the player stands at a table and
the table names, Psionics level, axis cap, tier, open axes, held shapes,
the gear bias (from the stat block), `maxFocus`, the book's psionic keys.

Panel "Psionic", after Arcane. Shut: one line ("Psionics is shut on this
save"). Not at a table: one line naming the tables. Otherwise, as the old
tab: the wheel (SVG, 8 wedges, a ring per point, click a ring to set,
click the held ring to clear), a row per axis with − and + (open axes;
closed ones show the lock), the eight quantity bars, the preview spec as
"Label: fact" lines (`specLines` of `spellcraft`), the tier line, the focus
line, held shapes (click fills the wheel, × forgets), Shape, Memorise,
Clear. The preview reads the shape at the taught tier with the gear bias,
as old. Descriptions open on click, not hover. Casting a shaped spell is
the book's (Arcane panel: prepare, Cast).

### Tests

The old `describe('psionic shaping')`, the psionic rows of "monsters that
work" and the two content cases replace their `it.todo` lines in
`tests/spellcraft.test.ts`, changed only in call shape. The two cases that
used the goblin firetongue in place of the slime and the antimagic case
that gave the slime an arcane kit go back to the slime's own shapes. New:
`tests/psionic.test.ts` for the slice, the fixture, the commands' reasons
and the view.
