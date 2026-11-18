<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import consumables, { useConsumable } from './index';

  // Held consumables, best grade first, one row each. A row opens its facts
  // on click; nothing opens on hover. Rows have one height whether or not a
  // use is refused, and the list scrolls inside a box of fixed height.
  const view = $derived(viewOf(consumables));
  let open = $state<string | null>(null);
  const key = (r: { id: string; quality: string }) => `${r.id}:${r.quality}`;
</script>

<section class="panel" aria-label="Provisions">
  <h2>Provisions <span class="dim num">{view.rows.length} stacks</span></h2>
  <p class="card dim note">Salves, cards and offerings are used here. Flasks are in the Satchel of the Alchemy panel.</p>
  <ul class="card list" aria-label="Held consumables">
    {#each view.rows as r (key(r))}
      <li class="item" style="--tint: {r.color}">
        <div class="row">
          <button type="button" class="name-btn" aria-expanded={open === key(r)} onclick={() => (open = open === key(r) ? null : key(r))}>
            <span class="glyph">{r.icon}</span>
            <span class="ident">
              <span class="clip">{r.name}{r.qty > 1 ? ` ×${r.qty}` : ''}</span>
              <span class="dim clip">{r.blocked ?? (r.grade ? `Grade: ${r.grade}` : 'Ready')}</span>
            </span>
          </button>
          <Button disabled={r.blocked !== null} onclick={() => send(useConsumable({ id: r.id, quality: r.quality }))}>Use</Button>
        </div>
        {#if open === key(r)}
          <div class="detail">
            {#each r.lines as line (line)}<div class="dim">{line}</div>{/each}
          </div>
        {/if}
      </li>
    {:else}
      <li class="dim">Nothing usable is held.</li>
    {/each}
  </ul>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 48rem;
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
    box-sizing: border-box;
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .note {
    margin: 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 24rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .item {
    padding: var(--space-1) var(--space-2);
    border: var(--border);
    border-left: 4px solid var(--tint);
    border-radius: var(--radius);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  .name-btn {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--tap);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .glyph {
    width: 2rem;
    font-size: var(--text-lg);
    text-align: center;
  }

  .ident {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    display: flex;
    flex-direction: column;
    padding: var(--space-1) 0;
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
