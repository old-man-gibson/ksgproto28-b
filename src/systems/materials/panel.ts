import type { PanelDef } from '../../ui/panel';
import InventoryPanel from './InventoryPanel.svelte';

// The inventory panel shows more than materials: gold, the pack and the rune
// pile too. It lives here because a folder holds one panel, and the
// equipment panel is the one of the items folder.
const panel: PanelDef = { systemId: 'materials', title: 'Inventory', component: InventoryPanel, order: -7 };

export default panel;
