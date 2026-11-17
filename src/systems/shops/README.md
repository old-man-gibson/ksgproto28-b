# shops

Buying at a person's counter. Port of the old `systems/shops.ts`. Selling is
the other half of the counter and lives with the goods: `items/sell`,
`materials/sell`, `materials/sell-batch`. Spine port 7; design in
`docs/SPINE.md` section 8.

Imports: `counters`, `gold`, `items`, `log`, `materials`, `npcs`, `skills`,
`stats`, `world`. Panel "Shop": every counter at the spot, its shelf, the
price per unit, Buy 1 and Buy 5. Sell buttons are in the pack and the
material list of the Inventory panel.

## Slice

Version 1, empty. Nothing about a shop is saved: stock is data, prices are
derived, the discount is the `met:` counter.

## Prices

- Asking price: `price`, else `ceil(value x BUY_MARKUP)` (2); a stranger pays
  `STRANGER_MARKUP` (1.5) on top. A graded ware is sold at one grade (default
  c) and valued at that grade.
- The price seal (`flag:chancery_seal`): 0.9 of the asking price.
- No arbitrage: the price paid is at least one coin over the best resale at
  the current gold gain (`stats/goldGain`). An item is priced as its best
  rune slot roll (`maxRuneSlots`).
- Resale: `sellPrice` (items), `materialSellPrice`, `gradedUnitPrice`
  (materials).

## Commands

| Command | Old function | Skip reasons |
|---|---|---|
| `shops/buy { npc, index, qty }` | `buy` | no counter, not here, no such line, quantity 0, purse short for one |

`index` is the line on the visible shelf: lines whose `requires` do not hold
are off it. A partial buy is allowed (buy 5 with gold for 3 buys 3). Bumps
`gold:spent`, `shop:buys`, `shop:buys:<npc>`.

## Left behind

- The counters of floors 11 to 20 and the broker (step 4).
