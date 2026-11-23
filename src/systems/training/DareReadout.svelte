<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import Button from '../../ui/components/Button.svelte';
  import type { TrainingAction, TrainingView } from './index';

  /**
   * The keeper's dare (old `DareModal.svelte`). Props only, so a test renders
   * it with a view; `DareModal.svelte` passes the game's view and `send`.
   * Save state, not UI state: the question is a counter, so a reload brings it
   * back. No backdrop click and no Escape: the window stays until one of the
   * two buttons is pressed.
   */
  interface Props {
    view: DeepReadonly<TrainingView>;
    onAction: (action: DeepReadonly<TrainingAction>) => void;
  }

  let { view, onAction }: Props = $props();
</script>

{#if view.dare}
  {@const dare = view.dare}
  <div class="backdrop" data-testid="dare">
    <div class="box" role="dialog" aria-modal="true" aria-labelledby="dare-title">
      <h2 id="dare-title">⏸️ {dare.spot.icon} {dare.spot.name}: the keeper stops the cages</h2>
      <p class="line">“{dare.desc}”</p>

      <div class="foe">
        <div><b>{dare.foe.icon} {dare.foe.name}</b> · Lv {dare.foe.level} · {dare.sizeLine}</div>
        {#if dare.takesLess.length}<div class="small">Takes less: {dare.takesLess.join(', ')}</div>{/if}
        {#if dare.takesMore.length}<div class="small">Takes more: {dare.takesMore.join(', ')}</div>{/if}
        <div class="small">One fight, alone. It cannot be fled, and the keeper does not patch you up until it ends.</div>
      </div>

      <p class="small dim">
        Your HP: {dare.hp} / {dare.maxHp}. Play is held until you answer; the time is banked as bonus time (⏩
        {dare.banked}). Flee and the cages carry on; the keeper asks again after {dare.every} more wins.
      </p>

      <div class="row">
        {#each view.actions as action (action.id)}
          <span data-action={action.id}>
            <Button variant={action.id === 'fight' ? 'primary' : 'plain'} onclick={() => onAction(action)}>
              {action.label}
            </Button>
          </span>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
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
    max-width: 32rem;
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
  h2 {
    font-size: var(--text-lg);
  }
  .line {
    font-style: italic;
  }
  .foe {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
  }
  .small {
    font-size: var(--text-sm);
  }
  .dim {
    color: var(--color-text-dim);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
