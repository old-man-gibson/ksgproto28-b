/**
 * The list of panels, built from the folders like the list of systems: every
 * src/systems/<name>/panel.ts default-exports a PanelDef. This file is the UI
 * side; the worker and the tests import index.ts and never this.
 */
import type { PanelDef } from '../ui/panel';

const modules = import.meta.glob<{ default: PanelDef }>('./*/panel.ts', { eager: true });

export const panels: PanelDef[] = Object.entries(modules)
  .map(([path, module]) => {
    const folder = path.split('/')[1];
    const panel = module.default;
    if (!panel || panel.systemId !== folder)
      throw new Error(`src/systems/${folder}/panel.ts must default-export a panel with systemId "${folder}"`);
    return panel;
  })
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.systemId < b.systemId ? -1 : 1));
