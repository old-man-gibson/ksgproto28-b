<script lang="ts">
  import { send, viewOf } from '../../ui/game.svelte';
  import sea from './index';
  import SeaReadout from './SeaReadout.svelte';

  // Mounted in the Location panel (docs/KERNEL.md decision 29), where the
  // old build showed the harbor readout. Each control sends the command its
  // action carries.
  const view = $derived(viewOf(sea));
</script>

<SeaReadout {view} onAction={(a) => send(a.command)} />
