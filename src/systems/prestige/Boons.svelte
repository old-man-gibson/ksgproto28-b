<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import prestige, { buyBoon } from './index';

  // The boon list, shared by the prestige panel and the review after a
  // prestige. A boon's text opens with a click; no hover card.
  const view = $derived(viewOf(prestige));
  let open = $state<string | null>(null);
</script>

<ul class="boons" aria-label="Boons">
  {#each view.boons as b (b.id)}
    <li data-testid="boon-{b.id}">
      <div class="row">
        <button type="button" class="name" aria-expanded={open === b.id} onclick={() => (open = open === b.id ? null : b.id)}>
          {b.icon} {b.name}
        </button>
        <span class="num">Rank {b.rank}/{b.maxRank}</span>
        <Button disabled={!b.canBuy} onclick={() => send(buyBoon({ boon: b.id }))}>
          {b.nextCost === null ? 'Max' : `Buy: ${b.nextCost}`}
        </Button>
      </div>
      {#if open === b.id}
        <p class="desc">{b.desc}</p>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .boons {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 18rem;
    margin: 0;
    padding: var(--space-3);
    overflow-y: auto;
    list-style: none;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    min-height: var(--tap);
    padding: 0;
    overflow: hidden;
    border: none;
    background: none;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .name:focus-visible {
    outline: 2px solid var(--color-accent);
  }

  .num {
    flex: none;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }

  .desc {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }
</style>
