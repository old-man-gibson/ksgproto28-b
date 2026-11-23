import type { OverlayDef } from '../../ui/panel';
import DareModal from './DareModal.svelte';

// The keeper's dare opens over any panel while it waits for an answer.
const overlay: OverlayDef = { systemId: 'training', place: 'modal', component: DareModal };

export default overlay;
