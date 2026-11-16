<script lang="ts">
  // Dev-only overlay. Lists the actions the kernel skipped, with the reason
  // each gave, and the most recent events. App.svelte mounts it only when
  // import.meta.env.DEV is true, so a release build does not contain it.
  import Button from './components/Button.svelte';
  import { game } from './game.svelte';

  let open = $state(false);
  let tab = $state<'skips' | 'events'>('skips');

  const skips = $derived([...game.view.skips].reverse());
  const events = $derived([...game.events].reverse());
</script>

<div class="dev-log" class:open>
  {#if open}
    <div class="box" role="log" aria-label="Development log">
      <div class="tabs">
        <Button pressed={tab === 'skips'} onclick={() => (tab = 'skips')}>Skipped ({skips.length})</Button>
        <Button pressed={tab === 'events'} onclick={() => (tab = 'events')}>Events ({events.length})</Button>
        <span class="spacer"></span>
        <Button onclick={() => (open = false)}>Close</Button>
      </div>
      {#if tab === 'skips'}
        {#if skips.length === 0}
          <p class="empty">No action has been skipped.</p>
        {:else}
          <ul>
            {#each skips as skip, index (index)}
              <li>
                <span class="meta">tick {skip.tick} · {skip.source} · {skip.action}</span>
                <span>{skip.reason}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if events.length === 0}
        <p class="empty">No event yet.</p>
      {:else}
        <ul>
          {#each events as event, index (index)}
            <li>
              <span class="meta">tick {event.tick} · {event.source} · {event.type}</span>
              <span>{JSON.stringify(event.payload)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <Button onclick={() => (open = true)} title="Skipped actions and recent events">
      Dev log ({skips.length})
    </Button>
  {/if}
</div>

<style>
  .dev-log {
    position: fixed;
    right: var(--space-3);
    bottom: var(--space-3);
    z-index: 10;
  }

  .box {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(28rem, calc(100vw - 2 * var(--space-3)));
    max-height: min(24rem, 60vh);
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    box-shadow: var(--shadow);
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .spacer {
    flex: 1;
  }

  ul {
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) 0;
    border-top: var(--border);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .meta {
    color: var(--color-text-dim);
    font-family: var(--font-mono);
  }

  .empty {
    margin: 0;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  @media (max-width: 640px) {
    /* Clear of the navigation bar and the footer line at the bottom of the
       phone layout. */
    .dev-log {
      bottom: calc(var(--tap) + var(--space-6) + 2.5rem + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
