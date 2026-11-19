import type { PanelDef } from '../../ui/panel';
import PsionicPanel from './PsionicPanel.svelte';

// The psionic wheel of the Spellcrafting Table. The old table's tabs ran
// Arcane, Divine, Psionic: after Divine (-8.3), before Alchemy (-8.2). The
// book it writes into is listed on the Arcane panel.
const panel: PanelDef = { systemId: 'psionic', title: 'Psionic', component: PsionicPanel, order: -8.25 };

export default panel;
