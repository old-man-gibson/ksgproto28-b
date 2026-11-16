# ksgproto28-b

Rebuild of the idle RPG in `D:\ksgproto28`. Svelte 5, TypeScript, Vite,
vitest. Read `docs/REBUILD.md` (the plan and the user's decisions) and
`docs/KERNEL.md` (the contract and the "how to add a system" checklist)
before changing anything.

## Hard rules

- **This repository is public. No third-party art in git.** No licensed or
  free third-party pixels, and no screenshots that show them. All such files
  live under `src/assets/licensed/`, which is ignored. See `.gitignore`. A
  checkout without that folder must still run.
- **`D:\ksgproto28` is read-only.** It is the reference for every game rule.
  Never edit it, never start a server on port 5173, never touch its
  localStorage.
- **Strict port.** No game-rule changes and no redesign while porting. A rule
  question is answered by the old code and the old tests.
- **The save starts at version 1 here.** There is no importer from the old
  save.

## Commands

- `npm run verify`: svelte-check, vitest, build. Must pass before a commit.
- `npm run dev`: dev server on port 5600 (strict). `npm run forge` opens the
  forge at `/forge/` on the same server.
- `npm test`: vitest only.
- `.claude/launch.json` holds the dev server entry `ksgb-dev` for the browser
  preview tool.

## Environment

- Windows 11. PowerShell and Git Bash are both available.
- If `node` is not found in a tool shell, prefix PATH with the Node.js folder,
  usually `C:\Program Files\nodejs`.
- Git Bash `sed -i` rewrites line endings. Use the Edit tool for file edits.
- Keep only the tail of long command output.
- The dev server saves to `ksgb:development:save` in localStorage. A build
  saves to `ksgb:production:save`. They never share a slot.

## Code rules

- `src/kernel/` imports nothing outside itself: no Svelte, no DOM, no
  `import.meta`. Kernel and system code may not use `Math.random`, `Date` or
  `performance.now`.
- A system is one folder under `src/systems/`. Adding one edits no file
  outside that folder except tests and fixtures.
- State changes only through a command or the tick. The UI reads the
  published view and never the state.
- A migrations file has `import type` and no other import.
- When a modifier source's inputs change, call `ctx.touch(sourceId)`.
- An action that does not happen returns or logs a reason. No silent returns.
- `src/ui/tokens.css` is the only stylesheet. Every other style is
  component-scoped. No `:global`.
- Check every panel in a browser at desktop width and at phone width.

## Writing rule

For docs, comments, commit messages, UI strings and reports: blunt engineer
register. Facts only. No mood or praise language. No numeronyms: write
"accessibility", not the abbreviation with a number in it.
