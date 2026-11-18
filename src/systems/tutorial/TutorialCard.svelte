<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import tutorial, { chooseSpell, chooseStance, chooseWeapon, skipTutorial } from './index';

  // The floor 0 card, above every panel while the tutorial runs: the step,
  // the weapon rack while it is open, and the skip on the first step. The
  // card has a fixed height for the whole tutorial; it goes when the
  // tutorial ends.
  const view = $derived(viewOf(tutorial));
  let shield = $state(false);
</script>

{#if view.active}
  <aside class="card" aria-label="Floor 0">
    {#if view.step}
      <div class="head">
        <span class="title">{view.step.title}</span>
        <span class="dim num">Step {view.step.index} of {view.step.of}</span>
      </div>
      <p class="desc">{view.step.desc}</p>
    {:else}
      <div class="head"><span class="title">Floor 0</span></div>
      <p class="desc">Walk through the gate to the Foot.</p>
    {/if}
    <div class="actions">
      {#if view.rack.length > 0}
        {#each view.rack as pick (pick.id)}
          <Button onclick={() => send(chooseWeapon({ weapon: pick.id, shield: shield && pick.hands === 'one' }))}>
            {pick.icon} {pick.name}
          </Button>
        {/each}
        <label class="shield"><input type="checkbox" bind:checked={shield} /> Shield with a one-handed pick</label>
      {/if}
      {#if view.stances.length > 0}
        <div class="stances">
          {#each view.stances as st (st.id)}
            <div class="stance">
              <Button onclick={() => send(chooseStance({ style: st.id }))}>{st.icon} {st.name}</Button>
              <ul class="lines dim">
                {#each st.lines as line (line)}<li>{line}</li>{:else}<li>No modifiers</li>{/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
      {#if view.spells.length > 0}
        <div class="stances">
          {#each view.spells as sp (sp.word)}
            <div class="stance">
              <Button onclick={() => send(chooseSpell({ word: sp.word }))}>{sp.icon} {sp.name}</Button>
              <ul class="lines dim">
                {#each sp.lines as line (line)}<li>{line}</li>{/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
      {#if view.canSkip}
        <Button onclick={() => send(skipTutorial())}>Skip tutorial</Button>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 15rem;
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    overflow-y: auto;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .title {
    font-size: var(--text-lg);
  }

  .desc {
    margin: 0;
    font-size: var(--text-sm);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .stances {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-2);
    width: 100%;
  }

  .stance {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .lines {
    margin: 0;
    padding-left: var(--space-3);
  }

  .shield {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    font-size: var(--text-sm);
  }

  .shield input {
    width: 1.25rem;
    height: 1.25rem;
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
