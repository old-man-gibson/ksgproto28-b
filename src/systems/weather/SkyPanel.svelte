<script lang="ts">
  import { viewOf } from '../../ui/game.svelte';
  import weather from './index';
  import SkyReadout from './SkyReadout.svelte';

  // Mounted in the Location panel (docs/KERNEL.md decision 29). The old build
  // showed the forecast in the header weather chip's tooltip; the shell has
  // no header chip yet (the UI step). No control.
  const view = $derived(viewOf(weather));
</script>

<SkyReadout forecast={view.forecast} />
