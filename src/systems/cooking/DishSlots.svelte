<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import meals from '../meals';
  import cooking, { cancelMeal, dishHeading, dishRows, queuedRow } from './index';

  // The active dishes and the queued one. Every slot is drawn (an empty one
  // reads "Free") and each row has one height, so the box never changes size.
  const slots = $derived(viewOf(meals));
  const kitchen = $derived(viewOf(cooking));
  const rows = $derived(dishRows(slots.active));
  const queued = $derived(queuedRow(kitchen.queued, kitchen.recovering, kitchen.fight));
</script>

<div class="card dishes" aria-label="Active dishes">
  <div class="dim">{dishHeading(slots.active)}</div>
  <ol class="list num">
    {#each { length: slots.limit } as _, i (i)}
      {@const r = rows[i]}
      <li class="clip" title={r ? r.conditions.join('\n') : undefined}>
        {r ? `${r.icon} ${r.name}: ${r.time}${r.replacedFirst ? ' (replaced first)' : ''}` : 'Free'}
      </li>
    {/each}
  </ol>
  <div class="row">
    {#if queued}
      <span class="clip">{queued.label} {queued.icon} {queued.name}</span>
      <Button onclick={() => send(cancelMeal(undefined))}>Cancel</Button>
    {:else}
      <span class="dim">Queued: none</span>
    {/if}
  </div>
</div>

<style>
  .card {
    box-sizing: border-box;
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .dishes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .list {
    margin: 0;
    padding-left: 1.5em;
    font-size: var(--text-sm);
  }

  .list li {
    height: 1.5em;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--tap);
  }

  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
</style>
