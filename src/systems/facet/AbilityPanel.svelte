<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import FactLines from './FactLines.svelte';
  import facet, {
    chooseOption,
    grantFacet,
    pressAction,
    recallClone,
    recallClones,
    switchFacet,
    type CellReadout,
    type FacetReadout,
  } from './index';

  // The run's ability in full (old `AbilityPanel.svelte`): what it does,
  // every cell its document marks for showing, the inputs it reads, the
  // conditions it puts on fighters and its evolution. The choice row (a
  // stance, a cutoff) is drawn here; the old build drew it on the Combat tab.
  // The grant rows stand in for the old debug panel's: the discovery moment
  // is undecided. Everything opens on click; no row changes height with the
  // state.
  const view = $derived(viewOf(facet));
  let granting = $state(false);

  /** The old `abilityValue`. */
  function valueOf(c: CellReadout): string {
    if (c.show === 'signedPct') return (c.value >= 0 ? '+' : '−') + Math.round(Math.abs(c.value) * 100) + '%';
    if (c.show === 'plusPct') return '+' + Math.round(c.value) + '%';
    if (c.show === 'minusPct') return '−' + Math.round(c.value) + '%';
    if (c.show === 'bar' || c.cap < 1e9) return `${Math.floor(c.value)} / ${Math.floor(c.cap)}`;
    return `${Math.round(c.value)}`;
  }

  const low = (c: CellReadout) => (c.show === 'signedPct' && c.value < 0) || (c.show === 'minusPct' && c.value > 0);

  /** What a pressed action waits on. One line always. */
  function actionState(act: { ready: boolean; queued: boolean }): string {
    if (!view.inFight) return 'In fights only.';
    if (act.queued) return 'Pressed: it takes your next action. Press again to cancel.';
    return act.ready ? 'Ready: it takes your next action.' : 'Not ready.';
  }
</script>

{#snippet action(act: FacetReadout['actions'][number])}
  <div class="act">
    <Button pressed={act.queued} disabled={!view.inFight || (!act.ready && !act.queued)} onclick={() => send(pressAction({ key: act.key }))}>
      {act.icon} {act.name}
    </Button>
    <span class="dim">{actionState(act)}</span>
  </div>
  {#if act.desc}<FactLines text={act.desc} />{/if}
{/snippet}

<section class="panel" aria-label="Ability">
  {#each view.held as ab (ab.name)}
    <h2>{ab.icon} {ab.name}</h2>
    {#if ab.desc}<div class="facts"><FactLines text={ab.desc} /></div>{/if}

    <ul class="rows">
      {#each ab.cells as cell (cell.key)}
        <li class="row">
          <div class="head">
            <span>{cell.icon} {cell.label}</span>
            {#if cell.line}
              <b class="num">{cell.value > 0 ? cell.line : 'Not in effect'}</b>
            {:else}
              <b class="num" class:low={low(cell)}>{valueOf(cell)}</b>
            {/if}
          </div>
          {#if cell.show === 'bar'}
            <div class="bar" role="meter" aria-valuemin={0} aria-valuemax={cell.cap} aria-valuenow={cell.value} aria-label={cell.label}>
              <div class="fill" style="width: {cell.cap > 0 ? Math.min(100, (100 * cell.value) / cell.cap) : 0}%"></div>
            </div>
          {/if}
          {#if cell.desc}<p class="dim">{cell.desc}</p>{/if}
          {#each ab.actions.filter((a) => a.under === cell.key) as act (act.key)}
            {@render action(act)}
          {/each}
        </li>
      {/each}
      {#each ab.actions.filter((a) => !ab.cells.some((c) => c.key === a.under)) as act (act.key)}
        <li class="row">{@render action(act)}</li>
      {/each}
      {#each ab.inputs as input (input.label)}
        <li class="row">
          <div class="head">
            <span>{input.label}</span>
            <b class="num">{input.show === 'pct' ? `${Math.round(input.value * 100)}%` : input.value}</b>
          </div>
        </li>
      {/each}
    </ul>

    {#if ab.choice}
      <h3>{ab.choice.label}</h3>
      <div class="choices" role="group" aria-label={ab.choice.label}>
        {#each ab.choice.options as opt (opt.v)}
          <Button pressed={ab.choice.want === opt.v} onclick={() => send(chooseOption({ v: opt.v }))}>{opt.icon} {opt.name}</Button>
        {/each}
      </div>
      <p class="dim">
        {ab.choice.want === ab.choice.active
          ? `In effect: ${ab.choice.options.find((o) => o.v === ab.choice!.active)?.name ?? ''}.`
          : `Picked: ${ab.choice.options.find((o) => o.v === ab.choice!.want)?.name ?? ''}, from your next action.`}
      </p>
      <div class="facts">
        {#each ab.choice.options as opt (opt.v)}
          <p class="line"><b>{opt.name}:</b> {opt.desc}</p>
        {/each}
      </div>
    {/if}

    {#if ab.conditions.length}
      <h3>Conditions</h3>
      <ul class="rows">
        {#each ab.conditions as cond (cond.name)}
          <li class="row">
            <b>{cond.icon} {cond.name}</b>
            <p class="line">{cond.desc}</p>
            {#if cond.becomes}
              <p class="line"><b>At cap:</b> becomes {cond.becomes.icon} {cond.becomes.name}. {cond.becomes.desc}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if ab.evolves}
      <h3>Evolution</h3>
      <div class="facts">
        <FactLines
          text={[
            `Trigger: ${ab.evolves.at} ${ab.evolves.label}.`,
            'Pick: You pick 1 branch. The pick is final for this run.',
            'Keeps: Progress carries over.',
          ].join('\n')}
        />
      </div>
      <ul class="rows">
        {#each ab.evolves.into as branch (branch.key)}
          <li class="row">
            <b>{branch.icon} {branch.name}</b>
            {#if branch.desc}<FactLines text={branch.desc} />{/if}
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="dim">No ability this run.</p>
  {/each}

  <!-- Shadow Clone: who is working where, and the way back (old AbilityPanel, "Clones at work"). -->
  {#if view.clones}
    {@const clones = view.clones}
    <h3>Clones at work</h3>
    {#if clones.out.length}
      <ul class="rows" data-testid="clones-out">
        {#each clones.out as c (c.order)}
          <li class="row">
            <div class="head">
              <span>👥 {c.task} · {c.spotName}</span>
              <Button onclick={() => send(recallClone({ order: c.order }))}>Recall</Button>
            </div>
            {#if c.nextIn !== null}<p class="dim num">Next craft in {c.nextIn} s</p>{/if}
          </li>
        {/each}
      </ul>
      <div class="facts">
        <FactLines text={`Reach: They stop when you are more than ${clones.reach} floors away. Threshold is floor 0.`} />
      </div>
      <div class="grant"><Button onclick={() => send(recallClones())}>Recall all</Button></div>
    {:else}
      <p class="dim">None out. Send one from a job, gathering or a bench.</p>
    {/if}
  {/if}

  <h3>Grant</h3>
  <p class="dim">One ability per run. A grant replaces the one held. Tentative port: switch it off with the button below or <code>?facet=off</code>.</p>
  <div class="grant">
    <Button pressed={granting} onclick={() => (granting = !granting)}>{granting ? 'Hide the bank' : 'Show the bank'}</Button>
    <Button onclick={() => send(switchFacet({ on: false }))}>Switch Facet abilities off</Button>
  </div>
  {#if granting}
    <ul class="rows">
      {#each view.bank as entry (entry.key)}
        <li class="row">
          <div class="head">
            <b>{entry.icon} {entry.name}</b>
            <Button onclick={() => send(grantFacet({ id: entry.key }))}>Grant</Button>
          </div>
          {#if entry.desc}<FactLines text={entry.desc} />{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  h2,
  h3 {
    margin: var(--space-3) 0 0;
  }
  h2 {
    margin-top: 0;
  }
  p {
    margin: 0;
  }
  .line {
    font-size: var(--text-sm);
  }
  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 2px var(--space-3);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .low {
    color: var(--color-danger);
  }
  .bar {
    height: 0.5rem;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--color-accent);
  }
  .act {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
  }
  .act > span {
    flex: 1 1 12em;
    min-width: 0;
  }
  .choices,
  .grant {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
