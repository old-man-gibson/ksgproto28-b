import type { PanelDef } from '../../ui/panel';
import LocationPanel from './LocationPanel.svelte';

const panel: PanelDef = { systemId: 'world', title: 'Location', component: LocationPanel, order: -10 };

export default panel;
