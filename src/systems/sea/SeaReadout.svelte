<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import Button from '../../ui/components/Button.svelte';
  import type { SeaAction, SeaView } from './index';

  /**
   * The harbor band's readout (old `SeaPanel.svelte`): the run's side, crates
   * won, at a water the convoy in progress, the battery the next leg fires,
   * and the merchants' port price. Props only, so a test renders it with a
   * view; `SeaPanel.svelte` passes the game's view and `send`.
   *
   * Layout rule: every line is present at a fixed height while the block is
   * shown. A leg ending, a kill or a count changes text, never the height.
   * Lines come and go only when the player moves, picks a side or the side
   * changes the block (the port price is the merchants' only).
   */
  interface Props {
    view: DeepReadonly<SeaView>;
    onAction: (action: DeepReadonly<SeaAction>) => void;
  }

  let { view, onAction }: Props = $props();

  const DEAL_NAMES: Record<string, string> = { duty: 'Duty waived', buyer: 'A broker', price: 'Haggled price' };

  const time = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

  const convoyLine = $derived.by(() => {
    const c = view.convoy;
    if (!c) return '';
    return c.leg === null
      ? `Convoy ${c.number}: in port, the next sails in ${time(c.secondsToNext)}.`
      : `Convoy ${c.number}: leg ${c.leg} of ${c.legs}, ends in ${time(c.secondsToNext)}.`;
  });

  const rollLine = $derived.by(() => {
    const c = view.convoy;
    const flow = view.side?.flow;
    const label = flow === 'convoy' ? 'Threat' : flow === 'escort' ? 'Monsters' : flow === 'raid' ? 'Guard' : 'Pirate crew';
    if (!c?.roll) return `${label}: none in port.`;
    const r = c.roll;
    if (flow === 'convoy') return `${label}: ${r.raiders + r.monsters} (raiders ${r.raiders}, monsters ${r.monsters}).`;
    if (flow === 'escort') return `${label}: ${r.monsters}.`;
    if (flow === 'raid') return `${label}: ${r.guard}.`;
    return `${label}: ${r.raiders}.`;
  });

  const cargoLine = $derived.by(() => {
    const c = view.convoy;
    if (!c) return '';
    return view.side?.flow === 'recover'
      ? `Cargo: ${c.carried} crates aboard the pirate ships.`
      : `Cargo: ${c.crates} of 8 crates aboard the convoy.`;
  });
</script>

{#if view.shown}
  <div class="card" data-testid="sea-readout">
    <h3>The harbor</h3>
    {#if view.side}
      <p class="line"><strong>Side: {view.side.icon} {view.side.name}</strong></p>
      <p class="desc dim">{view.side.desc}</p>
    {:else}
      <p class="line"><strong>Side: none.</strong></p>
      <p class="desc dim">Accept a join quest at one of the four berths on floor 11 to pick a side. One side a run: the other berths withdraw their offers.</p>
    {/if}
    <p class="line">Crates won this run: {view.won.toLocaleString('en-US')}</p>
    <p class="line dim">Crates credited offline: {view.offline.toLocaleString('en-US')}, paid as cargo at 1 in {view.offlineShare}</p>

    {#if view.convoy}
      <h4>Convoy</h4>
      <p class="line" data-testid="sea-convoy">{convoyLine}</p>
      <p class="line">{rollLine}</p>
      <p class="line">Kills this leg: {view.convoy.kills}</p>
      <p class="line">{cargoLine}</p>
      <p class="line" class:warn={!view.convoy.present}>
        {view.convoy.present ? 'Sailing: yes.' : 'Sailing: no. Idle or away, a leg passes without you.'}
      </p>
    {/if}

    {#if view.actions.length > 0}
      <div class="acts" data-testid="sea-actions">
        {#each view.actions as a (a.id + a.label)}
          <Button variant="primary" disabled={a.blocked !== null} title={a.blocked ?? a.label} onclick={() => onAction(a)}>
            <span data-action={a.id}>{a.label}</span>
          </Button>
        {/each}
      </div>
    {/if}

    <h4>Battery, fired once a leg</h4>
    <p class="line">
      Rating: volleys {view.battery.volleys} x hit {view.battery.hit} + morale {view.battery.morale} = <strong>{view.battery.rating}</strong>
    </p>
    <ul class="hold">
      {#each view.hold as h (h.id)}
        <li><span class="item">{h.icon} {h.name}: {h.held}</span> <span class="dim">({h.note})</span></li>
      {/each}
    </ul>

    {#if view.deal}
      <h4>Port price</h4>
      <p class="line"><strong>{view.deal.price}</strong> gold a crate, Speechcraft {view.deal.level}</p>
      <ul class="hold">
        {#each view.deal.terms as t (t.id)}
          <li class:dim={!t.met}>{DEAL_NAMES[t.id] ?? t.id} at {t.level}: +{t.gold}, {t.met ? 'met' : 'not met'}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-md);
  }

  h4 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-sm);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .desc {
    margin: 0 0 var(--space-2);
  }

  /* One line each, always present while shown: the text changes, the height does not. */
  .line {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .warn {
    color: var(--color-danger);
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }

  .hold {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .hold li {
    min-height: 1.5rem;
    line-height: 1.5rem;
  }

  /* A narrow screen: the item and its count, then its note on its own line. A
     count growing a digit then moves nothing. */
  @media (max-width: 640px) {
    .hold li > .dim {
      display: block;
    }
  }
</style>
