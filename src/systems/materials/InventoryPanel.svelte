<script lang="ts">
  import { viewOf } from '../../ui/game.svelte';
  import gold from '../gold';
  import items from '../items';
  import Pack from '../items/Pack.svelte';
  import materials from './index';

  // The inventory panel: gold, the pack (a component of the items system),
  // materials and the rune pile.
  const purse = $derived(viewOf(gold));
  const held = $derived(viewOf(materials));
  const gear = $derived(viewOf(items));

  const whole = (value: number) => Math.floor(value).toLocaleString('en-US');
</script>

<section class="panel" aria-label="Inventory">
  <div class="card row">
    <span class="title">Gold</span>
    <span class="num" data-testid="gold">{whole(purse.gold)}</span>
  </div>

  <Pack />

  <h2>Materials <span class="dim num" data-testid="material-count">{held.held.length}</span></h2>
  <!-- Fixed height, scrolling inside: a material that comes or goes does not
       move the page. -->
  <ul class="card list" aria-label="Materials">
    {#each held.held as material (material.id)}
      <li data-testid="material-{material.id}">
        <div class="row">
          <span class="name">{material.icon} {material.name}</span>
          <span class="num">×{whole(material.qty)}</span>
        </div>
        {#if material.grades.length > 0}
          <div class="dim clip">
            {#each material.grades as grade, i (grade.quality)}{i > 0 ? ', ' : ''}{grade.name} ×{grade.qty}{/each}
          </div>
        {/if}
      </li>
    {:else}
      <li class="dim">None.</li>
    {/each}
  </ul>

  {#if gear.runesOpen}
    <h2>Runes</h2>
    <ul class="card list short" aria-label="Runes">
      {#each gear.runes as rune (rune.id)}
        <li class="row">
          <span class="name">{rune.icon} {rune.name}</span>
          <span class="num">×{whole(rune.qty)}</span>
        </li>
      {:else}
        <li class="dim">None.</li>
      {/each}
    </ul>
  {/if}
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
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 12rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .short {
    height: 6rem;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .title {
    font-size: var(--text-lg);
  }

  .name,
  .clip {
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
