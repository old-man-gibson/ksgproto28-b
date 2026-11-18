import type { PanelDef } from '../../ui/panel';
import ArcanePanel from './ArcanePanel.svelte';

// The arcane panel also holds the grimoire of the spellcraft system, which
// has no panel of its own (decision 29: a panel may mount another system's reads).
const panel: PanelDef = { systemId: 'arcane', title: 'Arcane', component: ArcanePanel, order: -8.4 };

export default panel;
