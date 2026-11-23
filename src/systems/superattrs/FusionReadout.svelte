<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import type { FusedView } from './index';

  /**
   * The fused super-attributes, above the attribute list of the Character
   * panel. Port of the old Sidebar's fused chip (icon, name, the value; the
   * attribute ceiling's value when the ceiling holds it) and of its tooltip
   * (the description, each component's effective value, the sum), shown as
   * lines: the shell has no tooltips. Props only, so a test renders it with
   * a view. No control. Nothing is drawn while nothing is fused.
   */
  interface Props {
    fused: readonly DeepReadonly<FusedView>[];
  }

  let { fused }: Props = $props();

  const one = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
</script>

{#if fused.length > 0}
  <ul class="card list" data-testid="fusion-readout">
    {#each fused as sup (sup.id)}
      <li data-testid="fused-{sup.id}">
        <div class="row">
          <span class="name">{sup.icon} {sup.name}</span>
          <span class="num" data-testid="fused-{sup.id}-value">{one(sup.value)}</span>
        </div>
        <p class="desc dim">{sup.desc}</p>
        {#each sup.components as part (part.id)}
          <p class="line dim">{part.icon} {part.name}: <span class="num">{one(part.effective)}</span></p>
        {/each}
        {#if sup.formula < sup.value}
          <p class="line warn">Formulas read: <span class="num">{one(sup.formula)}</span> (the attribute ceiling)</p>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

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
    margin: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .name {
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

  .desc,
  .line {
    margin: var(--space-1) 0 0;
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .warn {
    color: var(--color-warn);
    font-size: var(--text-sm);
  }
</style>
