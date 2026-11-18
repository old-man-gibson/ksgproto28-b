import type { PanelDef } from '../../ui/panel';
import TitlesPanel from './TitlesPanel.svelte';

const panel: PanelDef = { systemId: 'titles', title: 'Titles', component: TitlesPanel, order: -5.5 };

export default panel;
