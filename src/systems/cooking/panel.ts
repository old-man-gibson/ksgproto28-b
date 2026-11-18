import type { PanelDef } from '../../ui/panel';
import KitchenPanel from './KitchenPanel.svelte';

// The kitchen panel also drives the bench run of the `benches` system (decision 29).
const panel: PanelDef = { systemId: 'cooking', title: 'Kitchen', component: KitchenPanel, order: -8.1 };

export default panel;
