<script lang="ts">
  import { viewOf } from '../../ui/game.svelte';
  import FestivalReadout from './FestivalReadout.svelte';
  import festival from './index';

  // Mounted in the Location panel (docs/KERNEL.md decision 29), where the
  // old build showed the festival's panel.
  const view = $derived(viewOf(festival));
</script>

<FestivalReadout attempt={view.attempt} />
