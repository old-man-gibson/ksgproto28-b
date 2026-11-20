<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../../ui/components/Button.svelte';
  import { game, send, viewOf } from '../../ui/game.svelte';
  import FactLines from './FactLines.svelte';
  import facet, { chooseEvolution, switchFacet } from './index';

  // Two jobs, over any panel:
  // - The switch of the tentative port, from the address: `?facet=on` or
  //   `?facet=off`. It is saved with the game, so the address is needed once.
  // - The evolution pick (old `EvolveModal.svelte`). The offer is written onto
  //   the saved document, so a reload brings it back. The old build held play
  //   until a pick and banked the time; the hold of play is not ported, so
  //   play goes on under the window.
  const view = $derived(viewOf(facet));

  // What the address asks for, sent once. A command sent while catch-up runs
  // is refused, so it waits for catch-up to end, and for the first tick (the
  // view before that is the one from before the save loaded). After that the
  // address is not read again, so the tab's own button wins.
  let asked = $state<boolean | null>(null);

  onMount(() => {
    const word = new URLSearchParams(location.search).get('facet');
    if (word === 'on' || word === 'off') asked = word === 'on';
  });

  // The reason the switch was refused (the core not installed), shown once.
  let refused = $state<string | null>(null);

  $effect(() => {
    if (asked === null || game.catchUp || game.view.tick === 0) return;
    const on = asked;
    asked = null;
    if (view.on === on) return;
    const result = send(switchFacet({ on }));
    if (!result.ok) refused = result.reason;
  });
</script>

{#if refused}
  <div class="notice" role="status">
    <p><b>Facet abilities: {refused}.</b> They stay off. See docs/SETUP.md.</p>
    <Button onclick={() => (refused = null)}>Close</Button>
  </div>
{/if}

{#if view.evolution}
  <div class="backdrop">
    <div class="box" role="dialog" aria-modal="true" aria-labelledby="facet-evolve-title">
      <h2 id="facet-evolve-title">{view.evolution.icon} {view.evolution.from} evolves</h2>
      <p class="dim">Pick 1 branch. Progress carries over. The pick is final for this run.</p>
      <ul class="branches">
        {#each view.evolution.choices as c (c.key)}
          <li class="branch">
            <b>{c.icon} {c.name}</b>
            <FactLines text={c.desc} />
            <div><Button onclick={() => send(chooseEvolution({ key: c.key }))}>Take {c.name}</Button></div>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .notice {
    position: fixed;
    right: var(--space-3);
    bottom: var(--space-6);
    z-index: 16;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    max-width: min(30rem, calc(100% - 2 * var(--space-3)));
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow);
  }
  .notice p {
    margin: 0;
    flex: 1 1 14rem;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 16;
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
    max-width: 35rem;
    max-height: 100%;
    padding: var(--space-4);
    overflow-y: auto;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow);
  }
  h2,
  p {
    margin: 0;
  }
  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .branches {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .branch {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
  }
</style>
