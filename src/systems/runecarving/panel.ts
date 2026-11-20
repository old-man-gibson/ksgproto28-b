import type { PanelDef } from '../../ui/panel';
import RunesPanel from './RunesPanel.svelte';

// The Rune Table, the loose runes and the socket editor. After the Anvil
// (-8.05) and the Chromosome panel (-8.02), before Equipment (-8).
const panel: PanelDef = { systemId: 'runecarving', title: 'Runes', component: RunesPanel, order: -8.01 };

export default panel;
