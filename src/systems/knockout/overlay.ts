import type { OverlayDef } from '../../ui/panel';
import DefeatDialog from './DefeatDialog.svelte';

// The defeat summary opens over any panel when a lost fight is not followed
// by a return.
const overlay: OverlayDef = { systemId: 'knockout', place: 'modal', component: DefeatDialog };

export default overlay;
