import type { PanelDef } from '../../ui/panel';
import CombatPanel from './CombatPanel.svelte';

const panel: PanelDef = { systemId: 'combat', title: 'Combat', component: CombatPanel, order: -9 };

export default panel;
