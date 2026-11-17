<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import items, { arrangeInventory, equipItem, SORT_LABELS, SORT_MODES, type SlotId, type SortMode } from './index';
  import ItemFacts from './ItemFacts.svelte';

  // The pack: stacks of identical items, the facts of the selected one, where
  // it may go and how it differs from what is worn there. Mounted by the
  // inventory panel (src/systems/materials/InventoryPanel.svelte).
  const view = $derived(viewOf(items));

  let mode = $state<SortMode>('newest');
  let group = $state(true);
  let selectedUid = $state<number | null>(null);
  let lastReason = $state<string | null>(null);

  const stacks = $derived(arrangeInventory(view.inventory, mode, group));
  // The selected stack, or the first one when the selected item has left the pack.
  const selected = $derived(stacks.find((s) => s.items.some((i) => i.uid === selectedUid)) ?? stacks[0] ?? null);

  function equip(uid: number, slot: SlotId) {
    const result = send(equipItem({ uid, slot }));
    lastReason = result.ok ? null : result.reason;
  }
</script>

<div class="row head">
  <h2>Pack <span class="dim num" data-testid="pack-count">{view.inventory.length}</span></h2>
  <span class="controls">
    <label class="dim">
      Sort
      <select bind:value={mode}>
        {#each SORT_MODES as m (m)}
          <option value={m}>{SORT_LABELS[m]}</option>
        {/each}
      </select>
    </label>
    <Button pressed={group} onclick={() => (group = !group)}>Stack</Button>
  </span>
</div>

<!-- The list has a fixed height and scrolls inside, so an item that comes or
     goes does not move what is below it. -->
<ul class="card list" aria-label="Pack">
  {#each stacks as stack (stack.key)}
    <li>
      <button
        type="button"
        class="pick"
        data-testid="pack-{stack.item.defId}"
        aria-pressed={stack === selected}
        onclick={() => (selectedUid = stack.item.uid)}
      >
        <span class="name">{stack.item.icon} {stack.item.name}</span>
        <span class="dim num">{stack.item.slotName}{#if stack.items.length > 1}&nbsp;×{stack.items.length}{/if}</span>
      </button>
    </li>
  {:else}
    <li class="dim">The pack is empty.</li>
  {/each}
</ul>

<!-- Fixed height too: the facts and the comparison of one item differ in
     length from those of the next. -->
<div class="card detail" data-testid="pack-detail">
  {#if selected}
    {@const item = selected.item}
    <div class="title">{item.icon} {item.name}</div>
    <ItemFacts facts={item.facts} />
    {#if !item.canEquip}
      <div class="warn">Requirements not met: {item.requires}</div>
    {/if}
    {#each item.options as option (option.slot)}
      <div class="option">
        <Button disabled={!item.canEquip} onclick={() => equip(item.uid, option.slot)}>
          Equip: {option.slotName}
        </Button>
        <div class="compare">
          {#if option.note}<div class="warn">{option.note}</div>{/if}
          {#if option.compare}
            <div class="dim">Against {option.compare.wornName}:</div>
            {#each option.compare.lines as line, i (i)}
              <div class={line.better ? 'better' : 'worse'}>{line.text}</div>
            {:else}
              <div class="dim">No stat changes.</div>
            {/each}
            {#if option.compare.conditional}
              <div class="dim">A conditional bonus is not compared.</div>
            {/if}
          {:else}
            <div class="dim">The slot is empty.</div>
          {/if}
        </div>
      </div>
    {/each}
  {:else}
    <p class="dim">Select an item.</p>
  {/if}
</div>
<div class="reason" role="status">{lastReason ?? ''}</div>

<style>
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .head {
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  select {
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
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
    height: 14rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .pick {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    box-sizing: border-box;
    width: 100%;
    min-height: var(--tap);
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
    outline-offset: -2px;
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

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 20rem;
    overflow-y: auto;
  }

  .detail p {
    margin: 0;
  }

  .title {
    font-size: var(--text-md);
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .compare {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-sm);
  }

  .better {
    color: var(--color-ok);
  }

  .worse {
    color: var(--color-danger);
  }

  .warn {
    color: var(--color-warn);
    font-size: var(--text-sm);
  }

  .reason {
    min-height: 1.4em;
    color: var(--color-warn);
    font-size: var(--text-sm);
  }
</style>
