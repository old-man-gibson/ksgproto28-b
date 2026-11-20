import type { OverlayDef } from '../../ui/panel';
import FacetOverlay from './FacetOverlay.svelte';

// The switch from the address (`?facet=on`, `?facet=off`) and the evolution
// pick, over any panel.
const overlay: OverlayDef = { systemId: 'facet', place: 'modal', component: FacetOverlay };

export default overlay;
