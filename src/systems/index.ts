/**
 * The list of systems. It is built from the folders: every folder under
 * src/systems/ with an index.ts is a system, and that file's default export
 * is its declaration. Adding a system adds a folder and edits nothing here.
 *
 * This file is imported by the game, the catch-up worker, the forge and the
 * tests, so it must not import Svelte. Panels are listed in panels.ts.
 */
import type { AnySystem } from '../kernel';

const modules = import.meta.glob<{ default: AnySystem }>('./*/index.ts', { eager: true });

export const systems: AnySystem[] = Object.entries(modules).map(([path, module]) => {
  const folder = path.split('/')[1];
  const system = module.default;
  if (!system || system.id !== folder)
    throw new Error(`src/systems/${folder}/index.ts must default-export a system with id "${folder}"`);
  return system;
});
