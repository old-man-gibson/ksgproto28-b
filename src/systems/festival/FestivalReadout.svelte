<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import type { FestivalAttemptView } from './index';

  /**
   * The festival attempt in progress, on floors 15 and 16 (old
   * `FestivalPanel.svelte`, without the royale's field and the field
   * preview, which come with port C5): where the attempt stands, the
   * festival's own clock, the gear the door holds, and what leaving costs.
   * Shown only while an attempt holds the player. Props only, so a test
   * renders it with a view; `FestivalPanel.svelte` passes the game's view.
   *
   * Layout rule: every line is present at a fixed height while its phase is
   * shown. A wave falling or the clock running changes text, never the
   * height.
   *
   * No control in this port: the old panel's "Enter the royale now" climbs
   * to floor 16, which comes with port C5.
   */
  interface Props {
    attempt: DeepReadonly<FestivalAttemptView> | null;
  }

  let { attempt }: Props = $props();

  /** Seconds of play as hours and minutes, as the old `msToTime` read a long span. */
  function playTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
    return `${s} s`;
  }
</script>

{#if attempt}
  <div class="card" data-testid="festival-readout">
    <h3>🎪 The Vermin Festival</h3>
    {#if attempt.phase === 'dark'}
      <p class="desc"><strong>The dark room.</strong> The last one fights alone. The door opens when you are the only one left.</p>
      <p class="line" data-testid="festival-standing">Still standing: {attempt.standing}</p>
      <p class="line">Waves left: {attempt.wavesLeft}</p>
    {:else if attempt.phase === 'prep'}
      <p class="line" data-testid="festival-day">
        Festival day: {attempt.day} of {attempt.days}, {String(attempt.hour).padStart(2, '0')}:00
      </p>
      <p class="line">Royale opens in: {playTime(attempt.secondsLeft)} of play</p>
      <p class="line">Preparing until then: the other {attempt.survivors}</p>
      <p class="desc dim">The royale is on floor 16 and opens on its own when day {attempt.days} ends.</p>
    {:else}
      <p class="desc">
        <strong>The royale.</strong> The survivors fight each other and come at you one to three at a time; the last one
        standing is fought alone, and beating it wins the festival.
      </p>
    {/if}
    <p class="line">Held at the door: {attempt.heldPieces} piece{attempt.heldPieces === 1 ? '' : 's'} of gear</p>
    <p class="desc dim">
      The door holds your gear, flasks and provisions until the attempt ends, won or lost. Leaving by the ladder before the royale ends forfeits it: you
      land outside the tower and floors 15 and 16 shut for three days or until the next prestige. A knockout does the same.
      The festival's clock runs only while the game runs with you on its floors.
    </p>
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
    font-size: var(--text-sm);
  }

  .desc {
    margin: var(--space-1) 0 var(--space-2);
  }

  /* One line each, always present while its phase is shown: the text changes, the height does not. */
  .line {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
