<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import type { AssembledPlacement, Placement } from '../benches';
  import facet, { sendCloneToBench } from './index';

  // "Send a clone" under a bench's run buttons (old `BenchPanel.svelte` and
  // `AnvilPanel.svelte`): a clone keeps working this layout from your stock,
  // at its share of your speed. Mounted by the bench panels (docs/KERNEL.md
  // decision 29). Shown while the held ability has clones; `ok` is the
  // panel's own check of the layout.
  let {
    discipline,
    placement,
    ok,
    duration,
    forge,
  }: { discipline: string; placement: Placement; ok: boolean; duration?: number; forge?: AssembledPlacement } = $props();

  const clones = $derived(viewOf(facet).clones);
  let refused = $state<string | null>(null);

  function sendOne() {
    const result = send(
      sendCloneToBench({
        discipline,
        placement,
        ...(duration !== undefined ? { duration } : {}),
        ...(forge ? { forge } : {}),
      }),
    );
    refused = result.ok ? null : (result.reason ?? 'refused');
  }
</script>

{#if clones}
  <div class="clone" data-testid="clone-bench">
    <Button disabled={!ok || clones.blocked !== null} onclick={sendOne}>👥 Send a clone</Button>
    <span class="dim">
      {refused
        ? `Not done: ${refused}.`
        : clones.blocked
          ? `Cannot send: ${clones.blocked}.`
          : `A clone makes this from your stock at ${clones.yieldPct}% of your speed.`}
    </span>
  </div>
{/if}

<style>
  .clone {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
  }
  .clone > span {
    flex: 1 1 12em;
    min-width: 0;
  }
  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
</style>
