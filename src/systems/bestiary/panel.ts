import type { PanelDef } from '../../ui/panel';
import BestiaryPanel from './BestiaryPanel.svelte';

const panel: PanelDef = { systemId: 'bestiary', title: 'Bestiary', component: BestiaryPanel, order: -5.4 };

export default panel;
