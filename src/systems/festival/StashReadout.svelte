<script lang="ts">
  import type { Command, DeepReadonly } from '../../kernel';
  import Button from '../../ui/components/Button.svelte';
  import type { ItemRow } from '../items';
  import type { FestivalStashView, StashAction } from './index';

  /**
   * The stronghold stash (old `StashPanel.svelte`): festival tokens and
   * keep-marked items, the one store a prestige keeps. Shown once it holds
   * anything, or once a token has bought something: before the hundredth
   * festival win of a run there is nothing to show. Props only, so a test
   * renders it with a view; `StashPanel.svelte` passes the game's views and
   * `send`. Each control sends the command its action carries.
   */
  interface Props {
    stash: DeepReadonly<FestivalStashView>;
    kept: readonly DeepReadonly<ItemRow>[];
    onSend: (command: DeepReadonly<Command>) => void;
  }

  let { stash, kept, onSend }: Props = $props();

  const press = (a: DeepReadonly<StashAction>) => onSend(a.command);
</script>

{#if stash.shown}
  <div class="card" data-testid="stash-readout">
    <h2>🏰 Stronghold stash</h2>
    <p class="desc dim">
      Kept through every prestige. It holds festival tokens and keep-marked items only; a kept item taken out comes back here at
      the next prestige, wherever it is.
    </p>
    <p class="line">Festival bonus: {stash.bonus.stacks} of {stash.bonus.cap} stacks</p>
    <p class="line dim">Per stack: {stash.bonus.text}</p>
    {#if stash.techniques.length === 0}
      <p class="line">Festival techniques: none</p>
    {:else}
      {#each stash.techniques as t (t.id)}
        <p class="line">Festival technique: {t.icon} {t.name}</p>
      {/each}
    {/if}

    {#each stash.tokens as token (token.index)}
      <div class="token" data-testid="stash-token">
        <p class="line"><strong>{stash.token.icon} {stash.token.name}</strong>: one of three</p>
        <div class="choice">
          {#each token.actions as a (a.id)}
            <Button disabled={a.blocked !== null} title={a.blocked ?? a.label} onclick={() => press(a)}>
              <span data-action={a.id} data-index={token.index}>{a.label}</span>
            </Button>
          {/each}
        </div>
        <p class="line dim">Bonus: one stack, up to {stash.bonus.cap}, kept</p>
        <p class="line dim">{token.noOffers ? 'Technique: every one is already yours' : 'Technique: learned in full, every run'}</p>
        <p class="line dim">Regalia: kept in this stash</p>
      </div>
    {/each}

    {#if kept.length > 0}
      <p class="line dim">{stash.holds ? 'Take out: shut during an attempt' : 'Take out: into the pack'}</p>
    {/if}
    {#each kept as item, i (i)}
      {@const a = stash.takeOut[i]}
      <div class="kept">
        <div class="what">
          <p class="line"><strong>{item.icon} {item.name}</strong></p>
          <!-- A kept item's facts never change in place: they wrap. -->
          {#each item.facts as f (f.label + f.fact)}
            <p class="fact dim">{f.label ? `${f.label}: ` : ''}{f.fact}</p>
          {/each}
        </div>
        {#if a}
          <Button disabled={a.blocked !== null} title={a.blocked ?? a.label} onclick={() => press(a)}>
            <span data-action={a.id} data-index={i}>{a.label}</span>
          </Button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .desc {
    margin: 0 0 var(--space-2);
  }

  /* One line each: the text changes, the height does not. */
  .line {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fact {
    margin: 0;
    line-height: 1.5rem;
  }

  .token {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-2) 0;
    padding: var(--space-2) var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
  }

  .choice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .kept {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  .what {
    flex: 1;
    min-width: 0;
  }
</style>
