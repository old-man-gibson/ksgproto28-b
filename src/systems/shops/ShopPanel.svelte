<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import { talkTo } from '../npcs';
  import shops, { buy } from './index';

  // The shop panel: every counter at the spot the player stands on, with its
  // shelf and the price per unit. Selling is on the Inventory panel (the
  // goods sell anywhere, as in the old build). The shelf list has a fixed
  // height and scrolls inside.
  const view = $derived(viewOf(shops));
  const whole = (value: number) => Math.floor(value).toLocaleString('en-US');
</script>

<section class="panel" aria-label="Shop">
  <div class="card row">
    <span class="title">Gold</span>
    <span class="num" data-testid="shop-gold">{whole(view.gold)}</span>
  </div>

  {#each view.counters as c (c.npc)}
    <h2>{c.icon} {c.name}</h2>
    <div class="dim row">
      <span class="clip">{c.npcName}. Prices: {c.met ? 'known customer' : 'stranger, half again the price until greeted'}</span>
      {#if !c.met}
        <Button onclick={() => send(talkTo({ npc: c.npc }))}>Talk</Button>
      {/if}
    </div>
    <ul class="card list" aria-label="Shelf of {c.name}">
      {#each c.lines as line (line.index)}
        <li class="row" data-testid="line-{c.npc}-{line.id}">
          <span class="name">{line.icon} {line.name}</span>
          <span class="num">{whole(line.price)} g</span>
          <span class="buttons">
            <Button disabled={view.gold < line.price} onclick={() => send(buy({ npc: c.npc, index: line.index, qty: 1 }))}>Buy 1</Button>
            <Button disabled={view.gold < line.price} onclick={() => send(buy({ npc: c.npc, index: line.index, qty: 5 }))}>Buy 5</Button>
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="card dim">No counter here. Counters stand at the district gates of Threshold, at the Forges, the Granary Kitchens, the Alembics and in the Quartermaster's Cage on floor 2.</p>
  {/each}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
  }

  h2 {
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
    height: 20rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .title {
    font-size: var(--text-lg);
  }

  .name,
  .clip {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num {
    flex: none;
    min-width: 4rem;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .buttons {
    display: flex;
    flex: none;
    gap: var(--space-2);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  p {
    margin: 0;
  }

  @media (max-width: 640px) {
    li.row {
      flex-wrap: wrap;
    }

    li.row .name {
      flex-basis: 100%;
    }
  }
</style>
