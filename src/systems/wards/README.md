# wards

Band 3's ward windows: a threat that opens on a ward's position and stays
for a number of ticks of play. Step 4 port C1.

Port of the old `systems/wards.ts` (130 lines) and `data/wards.data.ts`
(24). The content lint (old `systems/wardValidation.ts`) is
`wardContentIssues` in this folder's `validation.ts`, called by
`tests/worldContent.test.ts` and the forge validator.

## Content

`content/ward_windows.json`: one window, `f7_demon`. Floor 7 (`ascent_f7`),
position 3 (floor 7 is the last ward left), 14,400 ticks (24 in-game hours),
the Camp Demon (`ph_camp_demon`) at the Burnt Camp (`f7_burnt_camp`).

| Field | Meaning |
|---|---|
| `doneKey` | The run counter the floor's clear reads (`ward:f7:done`). The spot's `stampOnClear` writes it on the kill. |
| `atKey` | The tick the window opened. |
| `goneKey` | 1 when the window closed unkilled, with `doneKey`. The threat's row reads it. |
| `foughtKey` | 1 once a fight with the threat took HP from it. |
| `flags` | `fought` or `unmet`: one is set at a lapse. No line, tracker or hint shows them. |

## Slice

None (an empty object). Every key is a run counter of `counters`, as in
the old build (`state.stats`). The clock is the counter `<atKey>:clock`
(`wardClockKey`).

## Rules

- **Open.** The floor's position (`band:pos:<floor>`, kept by the clear of
  `ladder`) reaches `position`, the floor is not cleared and `doneKey` is
  unset: `atKey` is set to the tick.
- **Clock.** One per tick while open, travel included, and not while the
  kernel catches up (`ctx.catchingUp`, docs/KERNEL.md decision 34).
  Offline time does not run the window down.
- **Fought.** `combat/fight-closed` with the threat standing and hurt at the
  window's spot, or `combat/kill` of the threat there, while open.
- **Lapse.** The clock reaches `ticks` with `doneKey` unset and no live
  fight with the threat at its spot: `goneKey`, `doneKey` and one flag are
  set (`fought` if `foughtKey` is set or the threat keeps wounds, else
  `unmet`), then `ladder/check`. The ladder's clear writes the lapse line
  (`levels` text `floor_lapsed`) and pays no clear XP; the harvest counts
  no floor for it (`clearLapsed`, registered here with `registerLapse`).

Tick order 16: after combat and benches, so a kill on the same tick that
ends the window beats the lapse (old `Game.advance` order).

## Events

| Event | Direction | Does |
|---|---|---|
| `combat/fight-closed` | heard | Marks the threat fought when it is standing and hurt |
| `combat/kill` | heard | Marks the threat fought |
| `counters/set` | emitted | Every window key |
| `ladder/check` | emitted | After a lapse |

`combat/fight-closed` carries `hurt` on each standing enemy since this
port (the old `lastHit` stamp read).

## Skip reasons

None: no command and no request. The window is secret content in the old
build, so it has no panel; the view lists each window's state for tests.

## Old rules ported as they are

- A window whose clock is full while the threat's fight is live waits the
  fight out; a kill then sets no flag.
- The open tick is the clock's `totalTicks` (old `totalTicks`), read after
  the clock's own tick, so it counts the tick the window opens on.
