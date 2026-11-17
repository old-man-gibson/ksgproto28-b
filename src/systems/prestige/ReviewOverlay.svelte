<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import Boons from './Boons.svelte';
  import prestige, { leaveReview } from './index';

  // The review after a prestige: what the harvest paid and the boons to spend
  // it on. It is save state (`review`): it survives a reload and closes only
  // through `prestige/leave-review`. Leaving with points unspent and nothing
  // bought asks once more, as in the old build.
  const view = $derived(viewOf(prestige));
  let confirming = $state(false);

  function leave() {
    if (view.spentThisReview === 0 && view.points > 0 && !confirming) {
      confirming = true;
      return;
    }
    confirming = false;
    send(leaveReview());
  }
</script>

{#if view.review}
  <div class="backdrop">
    <div class="box" role="dialog" aria-modal="true" aria-label="Prestige review">
      <h2>Prestige {view.count}</h2>
      {#if view.lastHarvest}
        <ul class="lines" aria-label="Harvest">
          {#each view.lastHarvest.lines as line (line.id)}
            <li class="row">
              <span class="name">{line.icon} {line.name}</span>
              <span class="num">+{line.points}</span>
            </li>
          {/each}
        </ul>
        <p class="row">
          <span class="name">Harvest total</span><span class="num">+{view.lastHarvest.total}</span>
        </p>
      {/if}
      <p class="row"><span class="name">Points to spend</span><span class="num">{view.points}</span></p>
      <Boons />
      <div class="actions">
        <Button variant="primary" onclick={leave}>{confirming ? `Leave with ${view.points} points unspent` : 'Start the run'}</Button>
        {#if confirming}
          <Button onclick={() => (confirming = false)}>Back</Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
    background: var(--color-overlay);
  }

  .box {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: 32rem;
    max-height: 100%;
    padding: var(--space-4);
    overflow-y: auto;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .lines {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    gap: var(--space-3);
    margin: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
  }

  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
