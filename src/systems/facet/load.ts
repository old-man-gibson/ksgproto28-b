/**
 * Loads the FACET core from `./core/`, a folder git does not hold (it comes
 * from a private repository; `npm run facet:install`, docs/SETUP.md).
 *
 * `import.meta.glob` with `eager` evaluates each file for its side effect
 * (each publishes into `globalThis.Facet`), and gives an empty result when
 * the folder is missing, so a checkout without the core builds and runs with
 * Facet abilities unavailable. Load order does not matter to the core.
 * `facet.cases.js` is the core's test corpus and is left out; the tests load
 * it themselves.
 */
const files = import.meta.glob(['./core/facet.*.js', '!./core/facet.cases.js'], { eager: true });

/** Why Facet abilities are unavailable in a build without the core. */
export const NO_CORE = 'Facet core not installed';

/** The core files this build loaded, by name. */
export const CORE_FILES: string[] = Object.keys(files).map((path) => path.slice('./core/'.length));

/**
 * True when every core module and the bank are loaded. Read once: the files
 * are part of the build, so this cannot change while the game runs.
 */
export const CORE: boolean = (() => {
  const F = (globalThis as { Facet?: Partial<FacetCore> }).Facet;
  return !!F?.MODULES && !!F._mods && F.MODULES.every((m) => F._mods![m]) && !!F.bank && !!F._mods.bank;
})();

type FacetCore = typeof globalThis.Facet;
