<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import titles, { wearTitle } from './index';

  // The titles list of the old achievements panel: earned first, then the
  // unearned that are not secret. A row opens on click to Wear or Remove.
  const view = $derived(viewOf(titles));
  let open = $state<string | null>(null);
  const earnedCount = $derived(view.rows.filter((r) => r.earned).length);
</script>

<section class="panel" aria-label="Titles">
  <h2>
    Titles
    <span class="dim num">{earnedCount} earned, worn: {view.rows.find((r) => r.worn)?.name ?? 'none'}</span>
  </h2>
  <ul class="card list" aria-label="Titles">
    {#each view.rows as row (row.id)}
      <li class="title" class:locked={!row.earned}>
        <button type="button" class="head" aria-expanded={open === row.id} onclick={() => (open = open === row.id ? null : row.id)}>
          <span class="name">{row.icon} {row.name}</span>
          <span class="num dim">{row.worn ? 'Worn' : row.earned ? 'Earned' : 'Locked'}</span>
        </button>
        {#if open === row.id}
          <div class="opts">
            <p class="desc">{row.desc}</p>
            {#if row.earned}
              <div class="row">
                <Button pressed={row.worn} onclick={() => send(wearTitle({ title: row.worn ? null : row.id }))}>
                  {row.worn ? 'Remove' : 'Wear'}
                </Button>
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
  }

  h2 {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    list-style: none;
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .locked {
    opacity: 0.7;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .opts {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .desc {
    margin: 0;
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num {
    flex: none;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
</style>
