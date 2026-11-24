<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import npcs, { talkTo } from '../npcs';
  import PeopleList from '../npcs/PeopleList.svelte';
  import type { DeepReadonly } from '../../kernel';
  import quests, { acceptQuest, turnInQuest, type QuestView } from './index';

  // The quests panel: the people here (greeting), the work they offer, the
  // quests in hand with their progress, and what is done. Every list has a
  // fixed height and scrolls inside, so progress never moves the page.
  const people = $derived(viewOf(npcs));
  const book = $derived(viewOf(quests));

  let picked = $state<string | null>(null);
</script>

{#snippet quest(q: DeepReadonly<QuestView>, kind: 'offer' | 'active')}
  <li class="quest" data-testid="quest-{q.id}">
    <div class="row">
      <span class="name">{q.name}</span>
      {#if kind === 'offer'}
        <Button variant="primary" onclick={() => send(acceptQuest({ quest: q.id }))}>Accept</Button>
      {:else}
        <Button variant="primary" disabled={!q.canTurnIn} onclick={() => send(turnInQuest({ quest: q.id }))}>Turn in</Button>
      {/if}
    </div>
    <div class="dim">Giver: {q.giverName}, {q.giverSpotName}</div>
    {#if kind === 'active'}
      {#each q.objectives as o, i (i)}
        <div class="row dim">
          <span class="name">{o.desc}</span>
          <span class="num">{Math.min(o.current, o.target)} / {o.target}</span>
        </div>
      {/each}
      <div class="dim">
        Status: {q.canTurnIn ? 'complete, giver here' : q.complete ? `complete, return to ${q.giverSpotName}` : 'in progress'}
      </div>
    {/if}
    <Button onclick={() => (picked = picked === q.id ? null : q.id)}>{picked === q.id ? 'Hide details' : 'Details'}</Button>
    {#if picked === q.id}
      <p class="desc">{q.desc}</p>
    {/if}
  </li>
{/snippet}

<section class="panel" aria-label="Quests">
  <h2>People here</h2>
  <PeopleList people={people.here} onTalk={(npc) => send(talkTo({ npc }))} />

  <h2>Offered here</h2>
  <ul class="card list short" aria-label="Offered here">
    {#each book.offered as q (q.id)}
      {@render quest(q, 'offer')}
    {:else}
      <li class="dim">No work offered here.</li>
    {/each}
  </ul>

  <h2>Active <span class="dim num">{book.active.length}</span></h2>
  <ul class="card list" aria-label="Active quests">
    {#each book.active as q (q.id)}
      {@render quest(q, 'active')}
    {:else}
      <li class="dim">No active quest.</li>
    {/each}
  </ul>

  <h2>Done <span class="dim num">{book.done.length}</span></h2>
  <ul class="card list short" aria-label="Done quests">
    {#each book.done as q (q.id)}
      <li class="clip">{q.name}</li>
    {:else}
      <li class="dim">None.</li>
    {/each}
  </ul>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 36rem;
  }

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

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 16rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .short {
    height: 9rem;
  }

  .quest {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
    width: 100%;
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

  .desc {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
