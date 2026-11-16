<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import counter, { buyStep } from './index';

  const view = $derived(viewOf(counter));
  let lastReason = $state<string | null>(null);

  function buy(stepId: string) {
    const result = send(buyStep({ stepId }));
    lastReason = result.ok ? null : result.reason;
  }

  const whole = (value: number) => Math.floor(value).toLocaleString('en-US');
  const rate = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
</script>

<section class="panel" aria-label="Counter">
  <div class="total">
    <span class="count" data-testid="counter-count">{whole(view.count)}</span>
    <span class="rate">{rate(view.rate)} per second</span>
  </div>

  <dl class="facts">
    <div>
      <dt>Milestones</dt>
      <dd>{view.milestones}</dd>
    </div>
    <div>
      <dt>Lucky ticks</dt>
      <dd>{view.lucky}</dd>
    </div>
  </dl>

  <h2>Steps</h2>
  <ul class="steps">
    {#each view.steps as step (step.id)}
      <li>
        <div class="step-text">
          <span class="step-name">{step.name}</span>
          <span class="step-detail">
            Owned {step.owned}
            {#if step.blockedBy}· requires {step.blockedBy}{/if}
          </span>
        </div>
        <Button variant="primary" onclick={() => buy(step.id)}>Buy for {whole(step.cost)}</Button>
      </li>
    {/each}
  </ul>

  <p class="reason" role="status">{lastReason ?? ''}</p>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 36rem;
  }

  .total {
    display: flex;
    flex-direction: column;
    padding: var(--space-4);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    overflow-wrap: anywhere;
  }

  .rate,
  .step-detail,
  dt {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .facts {
    display: flex;
    gap: var(--space-5);
    margin: 0;
  }

  dd {
    margin: 0;
    font-family: var(--font-mono);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .step-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .reason {
    min-height: 1.4em;
    margin: 0;
    color: var(--color-warn);
    font-size: var(--text-sm);
  }
</style>
