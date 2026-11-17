<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import items, { unequipSlot, type SlotId } from './index';
  import ItemFacts from './ItemFacts.svelte';

  const view = $derived(viewOf(items));

  let selected = $state<SlotId>('weapon');
  let lastReason = $state<string | null>(null);
  const current = $derived(view.slots.find((s) => s.slot === selected) ?? view.slots[0]);

  function takeOff(slot: SlotId) {
    const result = send(unequipSlot({ slot }));
    lastReason = result.ok ? null : result.reason;
  }
</script>

<section class="panel" aria-label="Equipment">
  <h2>Equipment <span class="dim num">{view.arms} arms</span></h2>
  <!-- One row per slot the body has, filled or not, each of one fixed height:
       a piece that comes or goes changes the text of a row and nothing else. -->
  <ul class="card list">
    {#each view.slots as row (row.slot)}
      <li class="slot" data-testid="slot-{row.slot}">
        <button
          type="button"
          class="pick"
          aria-pressed={row.slot === current?.slot}
          onclick={() => (selected = row.slot)}
        >
          <span class="dim label">{row.name}</span>
          {#if row.item}
            <span class="name">{row.item.icon} {row.item.name}</span>
          {:else if row.takenBy}
            <span class="name dim">Held by {row.takenBy}</span>
          {:else}
            <span class="name dim">Empty</span>
          {/if}
        </button>
        <Button disabled={!row.item} onclick={() => takeOff(row.slot)}>Take off</Button>
      </li>
    {/each}
  </ul>
  <div class="reason" role="status">{lastReason ?? ''}</div>

  <h3>{current?.name ?? ''}</h3>
  <!-- A fixed height that scrolls inside, so the page below does not move
       when the selected slot changes or its piece changes. -->
  <div class="card detail" data-testid="slot-detail">
    {#if current?.item}
      <div class="title">{current.item.icon} {current.item.name}</div>
      {#if current.note}<div class="warn">{current.note}</div>{/if}
      <ItemFacts facts={current.item.facts} />
    {:else if current?.takenBy}
      <p class="dim">No arm is free: {current.takenBy} takes both.</p>
    {:else}
      <p class="dim">Nothing worn here. Equip a piece from the Inventory panel.</p>
    {/if}
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 36rem;
  }

  h2,
  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  h3 {
    min-height: 1.4em;
    font-size: var(--text-md);
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

  .slot {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    height: var(--tap);
    min-width: 0;
  }

  .pick {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: 0 var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pick[aria-pressed='true'] {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }

  .pick:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .label {
    flex: none;
    width: 5.5rem;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .reason {
    min-height: 1.4em;
    color: var(--color-warn);
    font-size: var(--text-sm);
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 13rem;
    overflow-y: auto;
  }

  .detail p {
    margin: 0;
  }

  .title {
    font-size: var(--text-md);
  }

  .warn {
    color: var(--color-warn);
    font-size: var(--text-sm);
  }
</style>
