import type { PanelDef } from '../../ui/panel';
import ShopPanel from './ShopPanel.svelte';

const panel: PanelDef = { systemId: 'shops', title: 'Shop', component: ShopPanel, order: -5 };

export default panel;
