<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import FactLines from './FactLines.svelte';
  import facet, { sendCloneCommand } from './index';

  // Shadow Clone in the Location panel (docs/KERNEL.md decision 29): one
  // "Clone" button per gathering or job activity of the spot, and the clones
  // already working here (old `LocationPanel.svelte`). Shown while the held
  // ability has clones. The status line is one line, always present.
  const clones = $derived(viewOf(facet).clones);
  let refused = $state<string | null>(null);

  function sendTo(activity: string) {
    const result = send(sendCloneCommand({ activity }));
    refused = result.ok ? null : (result.reason ?? 'refused');
  }

  const status = $derived.by(() => {
    if (!clones) return '';
    if (refused) return `Not done: ${refused}.`;
    if (clones.blocked) return `Cannot send: ${clones.blocked}.`;
    return clones.atSpot.length ? `Here: ${clones.atSpot.join(', ')}.` : 'Here: none.';
  });
</script>

{#if clones}
  <h2>Shadow clones</h2>
  <div class="card" data-testid="clone-activities">
    <div class="acts">
      {#each clones.here as a (a.id)}
        <Button disabled={clones.blocked !== null} onclick={() => sendTo(a.id)}>👥 Clone: {a.icon} {a.name}</Button>
      {:else}
        <span class="dim">No job or gathering here.</span>
      {/each}
    </div>
    <p class="status dim" role="status">{status}</p>
    <FactLines
      text={[
        `Yield: A clone works the task on its own for ${clones.yieldPct}% of the materials or pay, and ${clones.xpPct}% of the skill XP.`,
        `Count: ${clones.out.length} of ${clones.max} out. With every clone out, the next one replaces the oldest.`,
      ].join('\n')}
    />
  </div>
{/if}

<style>
  h2 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--tap);
  }
  p {
    margin: 0;
  }
  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  /* One line, always present: the text changes, the height does not. */
  .status {
    height: 1.5rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
