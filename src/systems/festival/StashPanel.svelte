<script lang="ts">
  import { send, viewOf } from '../../ui/game.svelte';
  import items from '../items';
  import festival from './index';
  import StashReadout from './StashReadout.svelte';

  // Mounted in the Prestige panel (docs/KERNEL.md decision 29), where the old
  // build showed the stronghold stash. Each control sends the command its
  // action carries.
  const view = $derived(viewOf(festival));
  const kept = $derived(viewOf(items).stash);
</script>

<StashReadout stash={view.stash} {kept} onSend={(command) => send(command)} />
