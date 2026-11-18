import type { PanelDef } from '../../ui/panel';
import AlchemyPanel from './AlchemyPanel.svelte';

// The alchemy panel also drives the bench run of the `benches` system, which
// has no panel of its own (decision 29: a panel may mount another system's reads).
const panel: PanelDef = { systemId: 'alchemy', title: 'Alchemy', component: AlchemyPanel, order: -8.2 };

export default panel;
