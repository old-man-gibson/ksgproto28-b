import type { OverlayDef } from '../../ui/panel';
import ReviewOverlay from './ReviewOverlay.svelte';

// The review after a prestige covers the page until it is left.
const overlay: OverlayDef = { systemId: 'prestige', place: 'modal', component: ReviewOverlay };

export default overlay;
