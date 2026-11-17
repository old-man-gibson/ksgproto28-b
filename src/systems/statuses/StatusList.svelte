<script lang="ts">
  import { viewOf } from '../../ui/game.svelte';
  import statuses from './index';

  // The player's conditions. Mounted by the character panel
  // (src/systems/attributes/CharacterPanel.svelte).
  const view = $derived(viewOf(statuses));

  const dose = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  function clock(seconds: number | null): string {
    if (seconds === null) return 'No timer';
    const whole = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
</script>

<h2>Conditions <span class="dim num" data-testid="status-count">{view.player.length}</span></h2>
<!-- The box has a fixed height and scrolls inside, so a condition that comes
     or goes does not move what is below it. -->
<ul class="card box" aria-label="Conditions">
  {#each view.player as status (status.id)}
    <li data-testid="status-{status.id}">
      <div class="row">
        <span class="name">{status.icon} {status.name}</span>
        <span class="num">{clock(status.seconds)}</span>
      </div>
      <div class="row dim">
        <span class="clip">Dose: {dose(status.intensity)}{#if status.effective !== status.intensity}&nbsp;(now {dose(status.effective)}){/if}</span>
        <span class="num">Stacks: {status.stacks}</span>
      </div>
      {#each status.facts as fact, i (i)}
        <p class="fact">{fact}</p>
      {/each}
    </li>
  {:else}
    <li class="dim">None.</li>
  {/each}
</ul>

<style>
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

  .box {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 14rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
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

  .fact {
    margin: var(--space-1) 0 0;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
</style>
