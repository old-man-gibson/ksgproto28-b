<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import type { ItemFact } from './index';

  // The "Label: fact" lines of an item. A fact with no label prints as it is.
  let { facts }: { facts: DeepReadonly<ItemFact[]> } = $props();
</script>

<ul>
  {#each facts as line, i (i)}
    <li>{#if line.label}<b>{line.label}:</b>&nbsp;{/if}{line.fact}</li>
  {/each}
</ul>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  li {
    overflow-wrap: anywhere;
  }
</style>
