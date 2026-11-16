import type { PanelDef } from '../../ui/panel';
import CounterPanel from './CounterPanel.svelte';

const panel: PanelDef = { systemId: 'counter', title: 'Counter', component: CounterPanel };

export default panel;
