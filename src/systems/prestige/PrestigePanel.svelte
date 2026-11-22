<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import StashPanel from '../festival/StashPanel.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import Boons from './Boons.svelte';
  import prestige, { prestigeNow } from './index';

  // The prestige panel: what a prestige would pay now (the same harvest the
  // command banks), the button, and the boons. Before the warchief falls on a
  // first run, the panel says what opens it and nothing else.
  const view = $derived(viewOf(prestige));
  let confirming = $state(false);
</script>

<section class="panel" aria-label="Prestige">
  <div class="card row">
    <span class="title">Points</span>
    <span class="num" data-testid="prestige-points">{view.points}</span>
  </div>
  <div class="dim">Prestiges: {view.count}</div>

  {#if !view.visible}
    <p class="card">Prestige opens when the goblin warchief of floor 6 is dead.</p>
  {:else}
    <h2>Harvest {view.harvest.ordinal}: {view.harvest.total} points</h2>
    <ul class="card lines" aria-label="Harvest">
      {#each view.harvest.lines as line (line.id)}
        <li class="row">
          <span class="name">{line.icon} {line.name}</span>
          <span class="num">{line.points}</span>
          <span class="detail dim">{line.detail}</span>
        </li>
      {/each}
    </ul>
    <div class="row actions">
      {#if !confirming}
        <Button variant="primary" disabled={!view.canPrestige} onclick={() => (confirming = true)}>Prestige</Button>
        <span class="dim">{view.canPrestige ? 'Ends this run. The legacy carries.' : 'Opens when the warchief of floor 6 is dead.'}</span>
      {:else}
        <Button
          variant="primary"
          onclick={() => {
            confirming = false;
            send(prestigeNow());
          }}>Confirm: end the run</Button
        >
        <Button onclick={() => (confirming = false)}>Cancel</Button>
      {/if}
    </div>

    <h2>Boons</h2>
    <Boons />
  {/if}

  <StashPanel />
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 36rem;
  }

  h2 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  .card {
    margin: 0;
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .lines {
    display: grid;
    gap: var(--space-2);
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .actions {
    min-height: var(--tap);
  }

  .lines .row {
    flex-wrap: wrap;
  }

  .title {
    flex: 1;
    font-size: var(--text-lg);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    flex-basis: 100%;
  }

  .num {
    flex: none;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
</style>
