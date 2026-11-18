import type { PanelDef } from '../../ui/panel';
import MartialPanel from './MartialPanel.svelte';

// The martial panel also holds the stance control: the styles system has no
// panel of its own (decision 29: a panel may mount another system's reads).
const panel: PanelDef = { systemId: 'martial', title: 'Martial', component: MartialPanel, order: -8.5 };

export default panel;
