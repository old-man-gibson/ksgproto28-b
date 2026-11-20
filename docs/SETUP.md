# Setup

## A checkout

1. Node 22 (the continuous integration runs 22). On Windows, if `node` is not
   found in a tool shell, prefix PATH with `C:\Program Files\nodejs`.
2. `npm ci`
3. `npm run verify`: svelte-check, the unit tests, the budgets, John, the
   build.
4. `npm run dev`: the dev server on port 5600.

A checkout runs as it is. Two parts come from private sources and are not in
git; without them the game runs with fallbacks.

## Licensed art (optional)

`src/assets/licensed/`, one folder per source. Not in git (`.gitignore`).
Without it: emoji icons, the node diagram for maps, no portraits.

## The Facet core (optional)

Facet abilities (`src/systems/facet`) run on the FACET core: the files
`facet.*.js` and `MANIFEST.json` of the Facet repository's `core/` folder.
That repository is private. The core lives in `src/systems/facet/core/`,
which git ignores.

Without the core: the build, the tests and the game run; Facet abilities are
unavailable. `?facet=on` and the command `facet/switch` answer "Facet core
not installed" and stay off. The tests that need the core are skipped, and
`tests/facet.test.ts` prints one test saying so.

To install it:

```
npm run facet:install -- <source>
```

or set `FACET_CORE_SRC=<source>` and run `npm run facet:install`.
`<source>` is the Facet repository, its `core/` folder, or the old KSG
repository (its `src/core/facet/` holds a copy). The script checks every file
against `src/systems/facet/core.lock.json`, the version this build was
tested with, and copies nothing on a mismatch. `--any-version` copies a
different version anyway; the abilities then follow that version.

After installing: `npm run verify` runs the Facet tests too. Restart a
running dev server: the core is loaded at build time (`import.meta.glob` in
`src/systems/facet/load.ts`).

To update the core: copy the new version, run the tests, then write the new
hashes (the new `MANIFEST.json`'s `sha256`) into `core.lock.json` in the same
commit as any change the new version needs.
