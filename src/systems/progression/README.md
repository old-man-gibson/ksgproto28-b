# progression

Banded XP curves. Attributes and skills level on them.

Port of: old `systems/progression.ts` and `data/progression.data.ts`.

The system holds no state. It exists as a folder so that attributes and
skills can both import it, and so its tables are content.

## The curve

A curve is a list of bands `{ from, base, rate }`. The cost of level L is

    scale x base(band of L) x product of rate(band of i), i = 1 .. L-1

never below 1. Inside a band the cost is `base x rate^n`. A band with a
costlier base multiplies the whole curve by the ratio of the bases.

- `bandedXpNeeded(bands, level)`: XP from `level` to the next.
- `settleLevels(progress, bands)`: turns banked XP into levels, at most 1,000
  per call. A cost that is not a finite positive number stops it and leaves
  the XP banked.
- `XP_SCALE` is 1.

## Content

| Registry | Holds |
|---|---|
| `xp_bases` | Base cost per tier: beginner 10 to legendary 100. |
| `xp_rates` | Cost multiplier per level: fast 1.15 to glacial 1.225. |
| `progressions` | Named shapes: `foundational`, `simple`, `specialist`, `insightful`, `perfectionist`, `esoteric`, and `attribute`. |

`DEFAULT_PROGRESSION` is `simple`. `ATTRIBUTE_PROGRESSION` is `attribute`.

A skill record carries its bands inline, as the old `SkillDef.progression`
did after `PROGRESSIONS.x` was resolved. Editing a named shape here does not
change a skill that already carries its own bands.
