<script lang="ts">
  import { SLOT_NAMES } from '../items';
  import { PART_LIST, type PartKindDef } from './defs';
  import {
    adaptMaterials,
    chartEntries,
    classesForIndex,
    placementText,
    sameShape,
    type ChartEntry,
    type ChartSetup,
  } from './anvilView';
  import { anvil, loadOnAnvil } from './layout.svelte';

  /**
   * The form chart: head kind by haft kind, with the guard, the binding and the
   * head count set above. Each cell is the form that combination resolves to,
   * named once it has been forged on this save and "?" until then. The chart is
   * the way back to a form already found: a known cell loads on the anvil.
   * Port of old `ui/panels/FormChart.svelte`.
   */
  let { known, runKey }: { known: readonly string[]; runKey: string } = $props();

  const kinds = PART_LIST;
  const heads = kinds.filter((k) => k.role === 'head');
  const hafts = kinds.filter((k) => k.role === 'haft');
  const guards = kinds.filter((k) => k.role === 'guard');
  const binds = kinds.filter((k) => k.role === 'bind');
  /** Head counts offered: a coif is four rings, a mail shirt eight, a pair of greaves two bent pieces. */
  const COUNTS = [1, 2, 4, 8];

  const setup = $derived<ChartSetup>({ guard: anvil.chart.guard, bind: anvil.chart.bind, count: anvil.chart.count });
  const rows: (PartKindDef | null)[] = [null, ...heads];
  const cols: (PartKindDef | null)[] = [null, ...hafts];
  /** Every cell's forms. They depend on the selectors only, not on what has been forged. */
  const grid = $derived(rows.map((h) => cols.map((f) => chartEntries(h?.id ?? null, f?.id ?? null, setup))));

  const classes = classesForIndex();
  const isKnown = (id: string) => known.includes(id);
  const knownClasses = $derived(classes.filter((c) => isKnown(c.id)));

  function load(entry: ChartEntry) {
    loadOnAnvil(runKey, adaptMaterials(entry.placement, anvil.placement));
  }
</script>

<div class="chart">
  <p class="dim intro">
    A form shows its name once it has been forged on this save, and "?" until then. Click a known form to load it on
    the anvil.
  </p>

  <div class="tools">
    <div class="group">
      <span class="dim">Guard</span>
      <button type="button" class="pick" aria-pressed={anvil.chart.guard === null} onclick={() => (anvil.chart.guard = null)}>none</button>
      {#each guards as g (g.id)}
        <button type="button" class="pick" aria-pressed={anvil.chart.guard === g.id} onclick={() => (anvil.chart.guard = g.id)}>{g.name}</button>
      {/each}
    </div>
    <div class="group">
      <span class="dim">Binding</span>
      <button type="button" class="pick" aria-pressed={anvil.chart.bind === null} onclick={() => (anvil.chart.bind = null)}>none</button>
      {#each binds as b (b.id)}
        <button type="button" class="pick" aria-pressed={anvil.chart.bind === b.id} onclick={() => (anvil.chart.bind = b.id)}>{b.name}</button>
      {/each}
    </div>
    <div class="group">
      <span class="dim">Head count</span>
      {#each COUNTS as n (n)}
        <button type="button" class="pick" aria-pressed={anvil.chart.count === n} onclick={() => (anvil.chart.count = n)}>×{n}</button>
      {/each}
      <span class="dim">Applies to: rings and bent pieces, up to the most one slot takes.</span>
    </div>
    <span class="dim num">{knownClasses.length} of {classes.length} forms known</span>
  </div>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th class="corner">Head \ Haft</th>
          {#each cols as f (f?.id ?? 'none')}
            <th>
              {f ? f.name : 'none'}
              {#if f}<div class="size num">{f.w}×{f.l}</div>{/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as h, r (h?.id ?? 'none')}
          <tr>
            <th class="rowhead" scope="row">
              {h ? h.name : 'none'}
              {#if h}<span class="size num">{h.w}×{h.l}</span>{/if}
            </th>
            {#each cols as f, c (f?.id ?? 'none')}
              {@const entries = grid[r][c]}
              <td>
                {#each entries as entry (entry.cls.id)}
                  {@const knownForm = isKnown(entry.cls.id)}
                  <button
                    type="button"
                    class="cell"
                    class:unknown={!knownForm}
                    class:degenerate={knownForm && entry.cls.degenerate}
                    class:current={sameShape(entry.placement, anvil.placement)}
                    disabled={!knownForm}
                    aria-label={knownForm
                      ? `${entry.cls.name}. Slot: ${SLOT_NAMES[entry.cls.slot]}${entry.cls.degenerate ? ', degenerate form' : ''}. Load on the anvil.`
                      : 'Not forged on this save'}
                    onclick={() => load(entry)}
                  >
                    {knownForm ? entry.cls.name : '?'}
                  </button>
                {:else}
                  <span class="dim">–</span>
                {/each}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="forms">
    <div class="dim">
      Forms found
      {#if knownClasses.length < classes.length}
        <span>({classes.length - knownClasses.length} not forged yet)</span>
      {/if}
    </div>
    <div class="form-list">
      {#each knownClasses as c (c.id)}
        <button
          type="button"
          class="pick"
          aria-label="{c.name}. Exemplar: {placementText(c.exemplar)}. Load on the anvil."
          onclick={() => loadOnAnvil(runKey, adaptMaterials(c.exemplar, anvil.placement))}
        >
          {c.icon} {c.name}
        </button>
      {:else}
        <span class="dim">None yet. Forge a piece to record its form.</span>
      {/each}
    </div>
    <div class="dim">Forms that use a second head are not on the grid. They are listed here once found.</div>
  </div>
</div>

<style>
  .chart {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }

  .intro {
    margin: 0;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    align-items: center;
  }

  .group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
  }

  .pick {
    box-sizing: border-box;
    min-height: var(--tap);
    min-width: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .pick[aria-pressed='true'] {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }

  /* The grid is wider than a phone: it scrolls inside its own box, with the row
     names held at the left edge. */
  .scroll {
    overflow-x: auto;
    max-width: 100%;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    min-width: 35rem;
    font-size: var(--text-sm);
  }

  th,
  td {
    border: var(--border);
    padding: var(--space-1);
    text-align: center;
  }

  th {
    background: var(--color-surface-raised);
    color: var(--color-text-dim);
    font-weight: 500;
  }

  th.rowhead {
    position: sticky;
    left: 0;
    z-index: 1;
  }

  th.rowhead,
  th.corner {
    text-align: left;
    white-space: nowrap;
  }

  .size {
    color: var(--color-text-dim);
  }

  button.cell {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--tap);
    min-width: var(--tap);
    margin: 0;
    padding: var(--space-1);
    border: 0;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  button.cell:disabled {
    cursor: default;
  }

  /* A form not forged yet is shown as "?", dimmed rather than faded out. */
  button.cell.unknown {
    color: var(--color-text-dim);
  }

  button.cell.degenerate {
    color: var(--color-warn);
  }

  /* The cell that matches the piece on the anvil now. */
  button.cell.current {
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }

  .forms {
    display: grid;
    gap: var(--space-1);
  }

  .form-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
