<script lang="ts">
  // Ability text written as "Label: fact" lines joined by newlines (the bank's
  // `reading.desc`). One line each, the label in bold; a line with no short
  // label prints as it is. Port of old `ui/lib/FactLines.svelte`.
  let { text }: { text: string } = $props();

  const lines = $derived(
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf(': ');
        return at > 0 && at <= 20 ? { label: line.slice(0, at), fact: line.slice(at + 2) } : { label: '', fact: line };
      }),
  );
</script>

{#each lines as line, i (i)}
  <p class="line">{#if line.label}<b>{line.label}:</b>{/if} {line.fact}</p>
{/each}

<style>
  .line {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
