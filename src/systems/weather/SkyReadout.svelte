<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import type { ForecastView } from './index';

  /**
   * What Weathersense reads where the player stands (the old header weather
   * chip's tooltip): the sky now, from level 5 the prognosis heading, and one
   * row per forecast row the level opens. Nothing below level 1. Props only,
   * so a test renders it with a view; `SkyPanel.svelte` passes the game's.
   *
   * Layout rule: every line is one fixed-height line. The sky changing over
   * time changes text, never the height; rows are added only by a level.
   */
  interface Props {
    forecast: DeepReadonly<ForecastView> | null;
  }

  let { forecast }: Props = $props();

  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
</script>

{#if forecast}
  <div class="card" data-testid="sky-readout">
    <h3>Sky</h3>
    <p class="line">Now: {forecast.now}</p>
    {#if forecast.prognosis}
      <p class="line dim">Prognosis: {forecast.region}</p>
    {/if}
    <ul class="rows">
      {#each forecast.rows as row (row.label)}
        <li class="line" class:dim={row.quality === 'rough'} data-quality={row.quality}>
          {capital(row.label)}: {row.text}{row.quality === 'rough' ? ' (rough)' : ''}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-md);
  }

  .dim {
    color: var(--color-text-dim);
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* One line each, always present while shown: the text changes, the height does not. */
  .line {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
