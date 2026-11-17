<script lang="ts">
  import { untrack } from 'svelte';
  import { TPS } from '../../kernel';
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import combat, { keepLastFight, type FightLedger } from '../combat';
  import knockout from './index';

  // The defeat summary: opens once per lost fight, and only when no return
  // or fallback follows it (`defeatDialogDue`), as the old `App.svelte` did.
  // A knockout the return handles is marked seen without opening, so the
  // dialog does not appear later when that return ends. The fight ledger is
  // the combat system's (`lastFight`). Which fight was seen is page state, not
  // save state: the old build kept it in the UI too.
  const fights = $derived(viewOf(combat));
  const down = $derived(viewOf(knockout));

  let seen = $state<number | null>(untrack(() => viewOf(combat).lastFight?.endedAt ?? null));
  let shown = $state<FightLedger | null>(null);

  $effect(() => {
    const led = fights.lastFight;
    if (!led || led.outcome === 'won' || led.endedAt === seen) return;
    seen = led.endedAt;
    if (down.defeatDialogDue) shown = led as FightLedger;
  });

  const took = $derived(shown ? shown.incoming.reduce((sum, s) => sum + s.amount, 0) : 0);
  const whole = (value: number) => Math.round(value).toLocaleString('en-US');
</script>

{#if shown}
  <div class="backdrop">
    <div class="box" role="dialog" aria-modal="true" aria-label="Defeat summary">
      <h2>{shown.outcome === 'dead' ? 'Died' : 'Knocked out'}</h2>
      <ul class="facts">
        <li><span>Cause:</span> <span>{shown.cause ?? 'the fight'}</span></li>
        <li><span>Foes:</span> <span>{shown.foes.map((f) => `${f.icon} ${f.name} L${f.level}${f.count > 1 ? ` ×${f.count}` : ''}`).join(', ')}</span></li>
        <li><span>Length:</span> <span>{Math.round(Math.abs(shown.ticks) / TPS)} s</span></li>
        <li><span>Damage dealt:</span> <span>{whole(shown.outgoing.damage)} in {shown.outgoing.hits} hits, {shown.outgoing.kills} kills</span></li>
        <li><span>Damage taken:</span> <span>{whole(took)}</span></li>
        <li>
          <span>Stopped:</span>
          <span>{whole(shown.stopped.absorbed)} absorbed, {whole(shown.stopped.parried)} parried, {whole(shown.stopped.dodged)} dodged</span>
        </li>
      </ul>
      <h3>Damage taken by source</h3>
      <ul class="sources">
        {#each shown.incoming as src (src.key)}
          <li class="row"><span class="name">{src.icon} {src.label}</span><span class="num">{whole(src.amount)} ({src.hits})</span></li>
        {:else}
          <li class="dim">None recorded.</li>
        {/each}
      </ul>
      <div class="actions">
        <Button variant="primary" onclick={() => (shown = null)}>Close</Button>
        <Button
          disabled={fights.lastFightKept}
          onclick={() => {
            send(keepLastFight());
          }}>{fights.lastFightKept ? 'Kept in the notebook' : 'Keep in the notebook'}</Button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 15;
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
    max-width: 30rem;
    max-height: 100%;
    padding: var(--space-4);
    overflow-y: auto;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow);
  }

  h2,
  h3 {
    margin: 0;
  }

  h2 {
    font-size: var(--text-lg);
  }

  h3 {
    font-size: var(--text-md);
  }

  .facts,
  .sources {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .facts li {
    display: grid;
    grid-template-columns: 8rem minmax(0, 1fr);
    gap: var(--space-2);
  }

  .sources {
    height: 8rem;
    overflow-y: auto;
  }

  .row {
    display: flex;
    gap: var(--space-3);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--color-text-dim);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
