import type { PanelDef } from '../../ui/panel';
import PrestigePanel from './PrestigePanel.svelte';

const panel: PanelDef = { systemId: 'prestige', title: 'Prestige', component: PrestigePanel, order: 20 };

export default panel;
