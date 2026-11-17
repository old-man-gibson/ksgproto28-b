import type { PanelDef } from '../../ui/panel';
import QuestsPanel from './QuestsPanel.svelte';

// The quests panel also shows the people at the spot: greeting a person is a
// command of `npcs`, which has no panel of its own.
const panel: PanelDef = { systemId: 'quests', title: 'Quests', component: QuestsPanel, order: -6 };

export default panel;
