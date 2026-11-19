import type { PanelDef } from '../../ui/panel';
import AnvilPanel from './AnvilPanel.svelte';

// The anvil panel also drives the bench run of the `benches` system for the
// `forging` bench (decision 29: a panel may mount another system's reads).
// Placed after the Alembic (-8.2) and the Kitchen (-8.1), before Equipment (-8).
const panel: PanelDef = { systemId: 'smithing', title: 'Anvil', component: AnvilPanel, order: -8.05 };

export default panel;
