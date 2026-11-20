import type { PanelDef } from '../../ui/panel';
import AbilityPanel from './AbilityPanel.svelte';
import { facetListed } from './index';

// The old build drew the Ability tab on the tab bar while the run held an
// ability. Here it is listed while the switch is on, so the bank can be
// granted from it: the discovery moment is undecided (README).
const panel: PanelDef = { systemId: 'facet', title: 'Ability', component: AbilityPanel, order: 50, shown: facetListed };

export default panel;
