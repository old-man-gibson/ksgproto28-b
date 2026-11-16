<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    onclick?: () => void;
    disabled?: boolean;
    /** "primary" for the main action of a view, "plain" for the rest. */
    variant?: 'primary' | 'plain';
    /** Shown as pressed, for a toggle or the current navigation entry. */
    pressed?: boolean;
    title?: string;
    children: Snippet;
  }

  let { onclick, disabled = false, variant = 'plain', pressed, title, children }: Props = $props();
</script>

<button type="button" class={variant} {onclick} {disabled} {title} aria-pressed={pressed}>
  {@render children()}
</button>

<style>
  button {
    box-sizing: border-box;
    min-height: var(--tap);
    padding: var(--space-2) var(--space-4);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  button.primary {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-accent-text);
  }

  button[aria-pressed='true'] {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
