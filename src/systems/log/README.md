# log

The activity log and the fight feed.

Port of: old `systems/log.ts` and the `text()` helper of `text/log.ts`.

## Slice

| Field | Holds |
|---|---|
| `log` | Activity log lines, newest last, at most `LOG_MAX` (60). |
| `combatFeed` | Fight feed lines, at most `FEED_MAX` (40). |
| `floatingFeed` | Affliction runs that are still going. They own no line. |
| `transcript` | The open fight's own copy of the feed, at most `TRANSCRIPT_MAX` (60), or null. |

The old build kept the transcript on the fight ledger (`state.fight.transcript`).
It is here so that one function writes the feed and the transcript. The combat
port opens and closes it and copies it into its fight record.

## Requests

| Event | Effect |
|---|---|
| `log/line` `{ msg, kind?, group?, prefix?, tally? }` | Appends a line, stamped with the game clock. A line with a `group` folds into the newest line of the same group. |
| `log/feed` | Appends a feed line. |
| `log/feed-repeat` | Appends a groupable feed line. |
| `log/feed-floating` | Adds to a floating run. |
| `log/feed-settle` `{ group }` | Ends a run and puts its total on the newest line. |
| `log/transcript-open` | Opens an empty transcript. |
| `log/transcript-close` | Closes the transcript. |

`repeatLine(...)` and `huntLine(tally)` build `log/line` payloads. The hunt
group closes its line after `HUNT_WINDOW` (300 ticks) and shows at most
`LOG_LABELS_MAX` (4) labels.

The functions behind the requests (`appendLog`, `appendFeed`, `feedRepeat`,
`feedFloating`, `settleFloating`) are exported and take the slice.

## Text

`fillText(template, params)` fills `{name}` placeholders and leaves an unknown
one as written. A system that logs keeps its templates in a registry of its
own with `textSchema` (`levels_text`, `skills_text`). The `log_text` registry
holds the two templates this system uses.

## Skip reasons

- `log/feed-settle`: no floating run of that group is open.
- `log/transcript-close`: no transcript is open.

## Left behind

- Lines are stored during offline catch-up. The old build counted them and did
  not store them (`Game.suppressLog`). The kernel has no catching-up flag.
- The other templates of old `text/log.text.ts` (465 lines): each arrives with
  the system that fires it.
- The old test that every template has a call site and every call site
  supplies its placeholders (`tests/logtext.test.ts`).
- A log panel.
