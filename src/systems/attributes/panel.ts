import type { PanelDef } from '../../ui/panel';
import CharacterPanel from './CharacterPanel.svelte';

// The character panel shows more than attributes: level, pools and skills
// too. It lives here because a panel belongs to one system folder.
const panel: PanelDef = { systemId: 'attributes', title: 'Character', component: CharacterPanel, order: -10 };

export default panel;
