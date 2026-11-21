<script lang="ts">
  import { viewOf } from '../../ui/game.svelte';
  import achievements from './index';

  // The achievements list of the old achievements panel. A row opens on
  // click to list every tier with its threshold and bonus.
  const view = $derived(viewOf(achievements));
  let open = $state<string | null>(null);

  const share = (value: number, next: number | null) => (next ? Math.min(1, value / next) : 1);
</script>

<section class="panel" aria-label="Achievements">
  <h2>
    Achievements
    <span class="dim num">Tiers: {view.claimed} of {view.total}</span>
  </h2>
  <ul class="card list" aria-label="Achievements">
    {#each view.rows as row (row.id)}
      <li class="ach" class:done={row.next === null}>
        <button type="button" class="head" aria-expanded={open === row.id} onclick={() => (open = open === row.id ? null : row.id)}>
          <span class="name">{row.icon} {row.name}</span>
          <span class="num dim">{row.claimed}/{row.tiers}</span>
        </button>
        <div class="goal">
          <span class="dim">{row.goal ?? 'Goal: all tiers claimed'}</span>
          <span class="num dim">{row.value}{row.next === null ? '' : ` / ${row.next}`}</span>
        </div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(share(row.value, row.next) * 100)}>
          <div class="fill" style:width="{share(row.value, row.next) * 100}%"></div>
        </div>
        {#if open === row.id}
          <ul class="tiers">
            {#each row.tierLines as t, i (i)}
              <li class:claimed={t.claimed}>
                <span class="num">{t.claimed ? 'Claimed' : 'Open'}</span>
                <span>Tier {i + 1} at {t.threshold}: {t.bonus}</span>
              </li>
            {/each}
          </ul>
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
    gap: var(--space-3);
    margin: 0;
    list-style: none;
  }

  .ach {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
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

  .done .head {
    border-color: var(--color-ok);
  }

  .goal {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }

  .bar {
    height: var(--space-2);
    margin: 0 var(--space-2);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--color-accent);
  }

  .tiers {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2);
    list-style: none;
    font-size: var(--text-sm);
  }

  .tiers li {
    display: flex;
    gap: var(--space-3);
    color: var(--color-text-dim);
  }

  .tiers li.claimed {
    color: var(--color-text);
  }

  .tiers .num {
    width: 4.5em;
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
