/**
 * The vite config of the speed test's measuring process (`tests/speedRun.ts`,
 * started by `tests/speed.test.ts`): no plugins. The game code that process
 * runs imports no Svelte file. Under this config vite-node transforms each of
 * its 305 modules to the same code as under `vite.config.ts` (the two module
 * dumps of `VITE_NODE_DEBUG_DUMP` compared equal, 2026-11-22). The Svelte and
 * forge plugins cost about 1.5 s of start-up per process. A Svelte import
 * reaching that code fails the process, and the speed test with it.
 */
import { defineConfig } from 'vite';

export default defineConfig({});
