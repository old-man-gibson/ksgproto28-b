# consumables

Using a held material that has a `consumable` record. Step 3, the alchemy
port. Port of old `systems/consumables.ts`; its food half is eaten by
`cooking` (see Food). Design: `src/systems/alchemy/README.md`,
"Step 3 design".

## Slice (version 1)

`{ cooldowns: Record<materialId, tick> }`: the tick an item may be used
again. The old `useCooldowns` without the key `flask` (the flask clock is in
the `alchemy` slice).

## Command

`consumables/use { id, quality? }` (old `useConsumable`, not queued;
`quality` defaults to `c`). The check (`canUse`), in the old order:

| Reason | When |
|---|---|
| `Not usable` | the material has no `consumable` record |
| `None held` | none at that grade (a plain material ignores the grade) |
| `Recipe already known` / `Already done` | a card whose effect happened (`cardSpent`) |
| `No technique you know leads into <name>’s position yet` | a technique card whose position no known technique reaches |
| `Not during a fight.` | food while a fight is open |
| `Ready in <s>s` | the item's cooldown |

A refusal is logged as `🔒 <reason>` and spends nothing.

## Rules

- **Cards** (`teaches`, `unlocksWord`, `teachesTechnique`, `stamps`,
  `votive`): read or offered once, no grade.
  - `teaches`: bumps `recipe:<id>`; the line names the dish by the bench
    outcome of that recipe, else by the material.
  - `unlocksWord`: bumps `flag:word:<id>` (`arcane`).
  - `teachesTechnique`: the line, then `martial/learn` with `canonical`.
  - `stamps`: bumps the key, the line, `titles/check`.
  - `votive`: bumps `votive:tokens`; the first asks
    `divine/grant-favor-all` with 2 and bumps `votive:baseline` by 2; each
    later one bumps `favor:floating`.
- **The rest**, scaled by the grade multiplier:
  - restore `(flat + ofMax x availableMax) x grade`; health heals as kind
    `salve` (`resources/heal-now`), other pools through
    `resources/restore-now`; a negative amount (refuse grade) takes, never
    under 0;
  - at refuse grade the spoilage condition `queasy` at intensity `-grade`,
    resisted, in place of the grants; otherwise each grant at
    `intensity x grade`, resisted only when the condition is harmful;
  - each cure tag fired as a `cure` status event;
  - the cooldown; the line `<icon> <verb> <grade> <name>.` (kind `danger`
    at refuse grade).
- `cardSpent` is registered with `world` (`registerCardSpent`): a one-time
  card is not rolled as an activity drop once spent.

## Food (step 3, the cooking port)

Food passes the same check (`Not during a fight.` in a fight) and is
taken from stock here; then the eater `cooking` registered
(`registerEater`) eats it: the cook's scaling, the Signature, the eat line,
the spoiled counter, the dish slot. This system sets the item's cooldown
after the eater (no dish carries one). `canUseOutOfFight` is the check
without the fight rule (the queued dish). The request
`consumables/use-now { id, quality?, queued? }` is the command's body for a
system that uses an item inside its own handler (`cooking/eat`, the eating
queue). `applyRestore(ctx, spec, mult)` is shared with the eater.

The Provisions panel sends food rows through `cooking/eat` and
`cooking/cancel-meal`, reads their eat plan from the cooking view, and
mounts `cooking/DishSlots.svelte` (decision 29).

## Reads

`consumableSpec`, `isCard`, `cardSpent`, `canUse`, `cooldownLeft`,
`heldConsumables`, `VOTIVE_KEY`, `VOTIVE_FIRST_FAVOR`, `SPOILED`.

## View

`rows`: one per held stack, best grade first: id, quality, name, icon,
grade, colour, quantity, the use verb, the effects as "Label: fact" lines,
and the refusal reason or null.

## Panel

Provisions (`ProvisionsPanel.svelte`): one row per stack, a fixed row
height, a list box of fixed height that scrolls, the use button, the facts
on click.

## Old rules ported as they are

- A refuse-grade item takes from a pool by a direct write, never under 0:
  a refuse-grade healing salve can take health to 0 and no knockout follows.
- Restore of health by a consumable heals as kind `salve` whatever the item.
- `cures` is read from the record; no material carries it.

## Left behind

- Facet signals `itemUsed` and `eat`.
