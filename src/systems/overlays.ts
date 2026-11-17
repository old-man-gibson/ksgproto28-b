/**
 * The list of overlays, built from the folders like the list of panels: a
 * src/systems/<name>/overlay.ts default-exports an OverlayDef. The shell
 * mounts every overlay on every view; the component decides when it shows.
 * A banner sits above the panel, a modal above everything. This file is the
 * UI side; the worker and the tests import index.ts and never this.
 */
import type { OverlayDef } from '../ui/panel';

const modules = import.meta.glob<{ default: OverlayDef }>('./*/overlay.ts', { eager: true });

export const overlays: OverlayDef[] = Object.entries(modules)
  .map(([path, module]) => {
    const folder = path.split('/')[1];
    const overlay = module.default;
    if (!overlay || overlay.systemId !== folder)
      throw new Error(`src/systems/${folder}/overlay.ts must default-export an overlay with systemId "${folder}"`);
    return overlay;
  })
  .sort((a, b) => (a.systemId < b.systemId ? -1 : 1));
