<script lang="ts">
  import { send, viewOf } from '../../ui/game.svelte';
  import DareReadout from './DareReadout.svelte';
  import training from './index';

  // The keeper's dare over any panel, while a dare waits for its answer.
  const view = $derived(viewOf(training));
</script>

<DareReadout {view} onAction={(a) => send(a.command)} />
