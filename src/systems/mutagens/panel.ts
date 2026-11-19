import type { PanelDef } from '../../ui/panel';
import ChromosomePanel from './ChromosomePanel.svelte';

// The chromosome, and the culture bench when standing at one (it drives the
// bench run of `benches`, decision 29). After the Anvil (-8.05), before
// Equipment (-8).
const panel: PanelDef = { systemId: 'mutagens', title: 'Chromosome', component: ChromosomePanel, order: -8.02 };

export default panel;
