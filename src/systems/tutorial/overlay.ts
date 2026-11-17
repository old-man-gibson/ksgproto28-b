import type { OverlayDef } from '../../ui/panel';
import TutorialCard from './TutorialCard.svelte';

// The floor 0 card stands above every panel while the tutorial runs.
const overlay: OverlayDef = { systemId: 'tutorial', place: 'banner', component: TutorialCard };

export default overlay;
