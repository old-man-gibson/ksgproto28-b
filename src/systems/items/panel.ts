import type { PanelDef } from '../../ui/panel';
import EquipmentPanel from './EquipmentPanel.svelte';

const panel: PanelDef = { systemId: 'items', title: 'Equipment', component: EquipmentPanel, order: -8 };

export default panel;
