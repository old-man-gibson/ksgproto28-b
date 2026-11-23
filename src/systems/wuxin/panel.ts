import type { PanelDef } from '../../ui/panel';
import type { WuxinView } from './index';
import WuxinPanel from './WuxinPanel.svelte';

// The Wuxin sandbox, listed only while its shutter is open. The old
// navigation put it last in the build group, before the records: after
// Provisions (-6.9), before Quests (-6).
const panel: PanelDef = {
  systemId: 'wuxin',
  title: 'Wuxin',
  component: WuxinPanel,
  order: -6.5,
  shown: (view) => (view.wuxin as WuxinView | undefined)?.open === true,
};

export default panel;
