<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import type { DeepReadonly } from '../../kernel';
  import type { NpcView } from './index';

  // The people at the spot: name, the Talk control, the description, and the
  // line said now (the old people card's rotating line, `dialogueLine`). The
  // list scrolls in its fixed box; the line has a fixed box of three lines
  // that scrolls when a line is longer.
  interface Props {
    people: readonly DeepReadonly<NpcView>[];
    onTalk: (npc: string) => void;
  }

  let { people, onTalk }: Props = $props();
</script>

<ul class="card list" aria-label="People here">
  {#each people as p (p.id)}
    <li>
      <div class="row">
        <span class="name">{p.icon} {p.name}</span>
        <Button disabled={p.met} onclick={() => onTalk(p.id)}><span data-npc={p.id}>{p.met ? 'Met' : 'Talk'}</span></Button>
      </div>
      <div class="dim clip">{p.desc}</div>
      {#if p.line}
        <div class="dim says" data-says={p.id}>Says: “{p.line}”</div>
      {/if}
    </li>
  {:else}
    <li class="dim">Nobody stands here.</li>
  {/each}
</ul>

<style>
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
    height: 12rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
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

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .says {
    flex: none;
    height: calc(3 * 1.5em);
    line-height: 1.5;
    overflow-y: auto;
  }
</style>
