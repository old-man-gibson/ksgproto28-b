import type { PanelDef } from '../../ui/panel';
import ProvisionsPanel from './ProvisionsPanel.svelte';

const panel: PanelDef = { systemId: 'consumables', title: 'Provisions', component: ProvisionsPanel, order: -6.9 };

export default panel;
