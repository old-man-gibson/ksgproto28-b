import type { PanelDef } from '../../ui/panel';
import AchievementsPanel from './AchievementsPanel.svelte';

const panel: PanelDef = { systemId: 'achievements', title: 'Achievements', component: AchievementsPanel, order: -5.45 };

export default panel;
