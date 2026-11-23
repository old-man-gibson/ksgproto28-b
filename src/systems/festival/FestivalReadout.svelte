<script lang="ts">
  import type { Command, DeepReadonly } from '../../kernel';
  import Button from '../../ui/components/Button.svelte';
  import type { FestivalAttemptView, FestivalView } from './index';
  import { royaleMap } from './royaleMap';
  import { enterRoyaleCommand } from './royaleControls';
  import RoyaleFieldReadout from './RoyaleFieldReadout.svelte';
  import RoyaleMinimap from './RoyaleMinimap.svelte';

  /**
   * The festival attempt in progress, on floors 15 and 16 (old
   * `FestivalPanel.svelte`): where the attempt stands, the festival's own
   * clock, the hub's preview of this attempt's field, the royale's field
   * (`RoyaleFieldReadout.svelte`), the gear the door holds, and what leaving
   * costs. Shown only while an attempt holds the player. Props only, so a
   * test renders it with a view; `FestivalPanel.svelte` passes the game's
   * view, the terrain images and `send`.
   *
   * Layout rule: every line is present at a fixed height while its phase is
   * shown. A wave falling or the clock running changes text, never the
   * height.
   */
  interface Props {
    attempt: DeepReadonly<FestivalAttemptView> | null;
    royale?: DeepReadonly<FestivalView['royale']>;
    preview?: DeepReadonly<FestivalView['preview']>;
    plan?: DeepReadonly<FestivalView['plan']>;
    enter?: DeepReadonly<FestivalView['enter']>;
    /** The terrain images of the field and of the preview (`mapImage.ts`); '' draws none. */
    fieldImage?: string;
    previewImage?: string;
    onSend?: (command: Command) => void;
  }

  let { attempt, royale = null, preview = null, plan = null, enter = null, fieldImage = '', previewImage = '', onSend = () => {} }: Props = $props();

  /** Seconds of play as hours and minutes, as the old `msToTime` read a long span. */
  function playTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
    return `${s} s`;
  }

  const previewMap = $derived(preview ? royaleMap(preview.seed) : null);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
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
      {#if enter}
        <div class="row">
          <Button variant="primary" disabled={enter.blocked !== null} title={enter.blocked ?? undefined} onclick={() => onSend(enterRoyaleCommand())}>
            <span data-action="enter-royale">🏟️ Enter the royale now</span>
          </Button>
          <span class="dim">{enter.blocked ?? `Jumps the festival clock to day ${attempt.days}. The survivors finish preparing either way.`}</span>
        </div>
      {/if}
      {#if preview && previewMap}
        <h4>This attempt's field</h4>
        <p class="desc dim">
          The royale opens on this field. A section you scout shows its caches and dens here, and on the royale's map before
          you walk in. Scouted: {preview.scouted} of {preview.sections.length}.
        </p>
        <div class="preview" data-testid="festival-preview">
          <div class="preview-map">
            <RoyaleMinimap
              map={previewMap}
              image={previewImage}
              features={preview.features}
              icons
              labels
              label="This attempt's field, with the caches and dens of scouted sections"
            />
          </div>
          <ul class="sections">
            {#each preview.sections as r (r.id)}
              <li class:dim={!r.scouted}>
                {r.icon} <strong>{r.name}</strong>:
                {#if !r.scouted}not scouted
                {:else if r.caches + r.dens === 0}scouted, nothing on it
                {:else}scouted, {[r.caches ? plural(r.caches, 'cache') : '', r.dens ? plural(r.dens, 'den') : ''].filter(Boolean).join(' and ')}
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {:else}
      <p class="desc">
        <strong>The royale.</strong> The survivors fight each other and come at you one to three at a time; the last one
        standing is fought alone, and beating it wins the festival.
      </p>
      {#if royale && plan}
        <RoyaleFieldReadout field={royale} {plan} image={fieldImage} {onSend} />
      {:else}
        <p class="line">Field: on the way up; {attempt.survivors} survivors wait there.</p>
      {/if}
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

  h4 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-md);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .desc {
    margin: var(--space-1) 0 var(--space-2);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0;
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

  .preview {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .preview-map {
    flex: 1 1 20rem;
    max-width: 30rem;
  }

  .sections {
    flex: 1 1 12rem;
    margin: 0;
    padding-left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
</style>
