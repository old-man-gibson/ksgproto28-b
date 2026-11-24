<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import knockout, { stayHere } from '../knockout';
  import ladder from '../ladder';
  import FestivalPanel from '../festival/FestivalPanel.svelte';
  import SeaPanel from '../sea/SeaPanel.svelte';
  import SkyPanel from '../weather/SkyPanel.svelte';
  import world, { cancelPlan, climb, climbHub, goAndDoCommand, selectActivity, setIntent, travelTo, type MapSpotView as SpotView } from './index';

  type MapSpotView = DeepReadonly<SpotView>;

  // The Location panel. Layout rule: nothing here changes size or position
  // with per-tick or per-fight state. The place line, the status line and the
  // progress bar are always present at fixed heights. The lists change only
  // when the character is somewhere else or the player picks a spot.
  const view = $derived(viewOf(world));
  const rungs = $derived(viewOf(ladder).towers);
  const ko = $derived(viewOf(knockout));

  let picked = $state<string | null>(null);
  let lastReason = $state<string | null>(null);

  const spotsShown = $derived(view.map.areas.flatMap((a) => a.spots));
  const pickedSpot = $derived<MapSpotView | null>(spotsShown.find((s) => s.id === picked) ?? null);

  function run(result: { ok: boolean; reason?: string }) {
    lastReason = result.ok ? null : (result.reason ?? 'refused');
  }

  const seconds = (ticks: number) => `${Math.max(1, Math.round(ticks / 10))} s`;

  const status = $derived(
    lastReason
      ? `Not done: ${lastReason}.`
      : view.recovering
        ? 'Knocked out. Resting until recovered.'
        : view.travel
          ? `Travelling to ${view.travel.endName}: ${view.travel.secondsLeft} s, ${view.travel.legsLeft} ${view.travel.legsLeft === 1 ? 'leg' : 'legs'} left.`
          : view.inForcedFight
            ? 'Forced fight. Travel and activities are refused until it ends.'
            : view.activity
              ? `Activity: ${view.activity.name}.`
              : 'Activity: none.',
  );

  const returnLine = $derived(
    !ko.pending
      ? 'Knockout return: none.'
      : ko.pending.phase === 'hold'
        ? `Knockout return: waiting ${ko.pending.minutesLeft ?? 0} min, then ${ko.pending.target ?? 'nothing'}.`
        : ko.pending.phase === 'fallback'
          ? `Knockout return: hunting ${ko.pending.fallback ?? ''} (${ko.pending.wins} wins), then ${ko.pending.target ?? 'nothing'}.`
          : `Knockout return: going back to ${ko.pending.target ?? ''}.`,
  );

  // One bar: the leg under way, else the cycle of the activity, else the search of the spot.
  const bar = $derived(view.travel ? view.travel.progress : view.activity && view.activity.progress > 0 ? view.activity.progress : (view.explore?.progress ?? 0));
  const barLabel = $derived(
    view.travel ? 'Leg' : view.activity && view.activity.progress > 0 ? 'Cycle' : view.explore ? `Explored${view.explore.gate ? ' (stalled)' : ''}` : 'Idle',
  );

  const badge = (s: MapSpotView) => (s.here ? 'Here' : !s.known ? 'Unknown' : s.cleared ? 'Cleared' : s.forced ? 'Forced fight' : '');
  const statusWord = { cleared: 'Cleared', open: 'Open', gated: 'Gated', sealed: 'Sealed' } as const;
</script>

<section class="panel" aria-label="Location">
  <div class="card head">
    <p class="place" data-testid="location-place">
      <span class="icon" aria-hidden="true">{view.spot.icon}</span>
      <strong>{view.spot.name}</strong>
      <span class="dim">{view.spot.region}, {view.spot.area}</span>
    </p>
    <p class="status" role="status" data-testid="location-status">{status}</p>
    <div class="bar" title={barLabel}>
      <div class="fill" style:width={`${Math.round(bar * 100)}%`}></div>
      <span class="barlabel">{barLabel}: {Math.round(bar * 100)}%</span>
    </div>
    <p class="status" data-testid="location-return">{returnLine}</p>
    <div class="row">
      <Button onclick={() => run(send(stayHere()))} disabled={!ko.pending}>Stay here</Button>
      <Button onclick={() => run(send(cancelPlan()))} disabled={!view.travel || view.travel.legsLeft < 2}>Stop at next halt</Button>
    </div>
  </div>

  <h2>Activities</h2>
  <div class="card">
    <p class="desc">{view.spot.desc}</p>
    <div class="acts" data-testid="location-activities">
      {#each view.activities as a (a.id)}
        <Button
          variant={view.activity?.id === a.id ? 'primary' : 'plain'}
          pressed={view.activity?.id === a.id}
          disabled={a.blocked !== null || view.recovering}
          title={a.blocked ?? a.kind}
          onclick={() => run(send(selectActivity({ activity: view.activity?.id === a.id ? null : a.id })))}
        >
          {a.icon} {a.name}{#if a.detail}<span class="detail">{a.detail}</span>{/if}
        </Button>
      {/each}
      {#if view.travel}
        <span class="dim">On the road. Pick a spot on the map to set what the journey is for.</span>
      {:else if view.activities.length === 0}
        <span class="dim">No activity here.</span>
      {/if}
    </div>
  </div>

  <SeaPanel />
  <FestivalPanel />
  <SkyPanel />

  <h2>Map: {view.map.region}</h2>
  <div class="card picked" data-testid="location-picked">
    {#if pickedSpot}
      <p class="place">
        <span class="icon" aria-hidden="true">{pickedSpot.icon}</span>
        <strong>{pickedSpot.name}</strong>
        <span class="dim">
          {pickedSpot.here ? 'You are here.' : pickedSpot.ticks === null ? 'No known route.' : `Route: ${seconds(pickedSpot.ticks)} at base speed, ${pickedSpot.legs} ${pickedSpot.legs === 1 ? 'leg' : 'legs'}.`}
          {pickedSpot.forced ? ' Arriving starts a fight that cannot be fled.' : ''}
        </span>
      </p>
      <p class="desc">{pickedSpot.desc || 'Not discovered. One road leads there.'}</p>
      <div class="acts">
        <Button
          variant="primary"
          disabled={pickedSpot.here || pickedSpot.ticks === null || !!view.travel || view.recovering}
          onclick={() => run(send(travelTo({ to: pickedSpot.id })))}
        >
          Go
        </Button>
        {#each pickedSpot.activities as a (a.id)}
          <Button
            disabled={(pickedSpot.ticks === null && !pickedSpot.here) || view.recovering}
            title={a.kind}
            onclick={() =>
              run(
                view.travel
                  ? send(setIntent({ activity: a.id }))
                  : send(goAndDoCommand({ spot: pickedSpot.id, activity: a.id })),
              )}
          >
            {pickedSpot.here ? '' : 'Go and '}{a.icon} {a.name}{pickedSpot.resumes === a.id ? ' (resumes)' : ''}
          </Button>
        {/each}
      </div>
    {:else}
      <p class="dim">Pick a spot below. Its card opens here with "Go" and one button per activity.</p>
    {/if}
  </div>

  {#each view.map.areas as area (area.id)}
    <div class="card">
      <h3>{area.name}</h3>
      <div class="grid">
        {#each area.spots as s (s.id)}
          <button
            type="button"
            class="spot"
            class:here={s.here}
            class:unknown={!s.known}
            class:forced={s.forced}
            aria-pressed={picked === s.id}
            data-testid={`spot-${s.id}`}
            onclick={() => (picked = picked === s.id ? null : s.id)}
          >
            <span class="spotname">{s.icon} {s.name}</span>
            <span class="tag">{badge(s)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/each}

  {#if view.map.exits.length > 0}
    <div class="card" data-testid="location-exits">
      <h3>Exits</h3>
      <div class="acts">
        {#each view.map.exits as e (`${e.from}|${e.to}`)}
          <Button
            variant="primary"
            disabled={!!view.travel || view.recovering || view.inForcedFight}
            title={`Travel toward ${e.region}, by the road from ${e.fromName}`}
            onclick={() => run(send(travelTo({ to: e.to })))}
          >
            → {e.region}
          </Button>
        {/each}
      </div>
    </div>
  {/if}

  {#each rungs as tower (tower.id)}
    <h2>{tower.icon} {tower.name}</h2>
    <div class="card" data-testid="location-ladder">
      <p class="dim">
        {view.tower === tower.id ? 'The ladder answers here.' : 'The ladder answers at its hub and on its floors.'}
        {tower.endNotice ?? ''}
      </p>
      <ol class="rungs">
        {#each tower.rungs as r (r.id)}
          {#if r.hub}
            <li class="rung" data-testid="location-hub">
              <div class="runghead">
                <span><strong>Hub: {r.hub.status === 'sealed' ? 'not reached' : `${r.hub.icon} ${r.hub.name}`}</strong></span>
                <span class={`state ${r.hub.status}`}>{statusWord[r.hub.status]}</span>
              </div>
              <ul class="terms">
                {#each r.hub.gate as t (t.text)}
                  <li>Gate: {t.text} ({t.current.toLocaleString('en-US')} of {t.needed.toLocaleString('en-US')}){t.met ? ', met' : ''}</li>
                {/each}
              </ul>
              <!-- Every band hub is outside the festival: the hub's verdict, as for the tower's hub. -->
              <Button
                disabled={view.tower !== tower.id || r.hub.status !== 'open' || view.recovering || r.hub.spot === view.spot.id}
                title={view.rideVerdicts['']?.msg || undefined}
                onclick={() => run(send(climbHub({ band: r.hub!.band })))}
              >
                {view.rideVerdicts['']?.kind === 'forfeit' ? 'Forfeit: ride' : 'Ride'} to the hub of {r.band}
              </Button>
            </li>
          {/if}
          <li class="rung">
            <div class="runghead">
              <span><strong>Floor {r.index}: {r.status === 'sealed' ? 'not reached' : r.name}</strong></span>
              <span class={`state ${r.shut ? 'sealed' : r.status}`}>{r.shut ? 'Shut' : statusWord[r.status]}</span>
            </div>
            <ul class="terms">
              {#if r.shut}
                <li>Shut: a festival attempt was lost; three days or the next prestige</li>
              {:else if view.rideVerdicts[r.id]?.kind === 'refuse' && (r.status === 'open' || r.status === 'cleared')}
                <!-- The old ladder card's terms for the royale: no door of its own, or the dark room still fighting. -->
                <li>Refused: {view.rideVerdicts[r.id]?.msg}</li>
              {/if}
              {#each r.gate as t (t.text)}
                <li>Gate: {t.text} ({t.current.toLocaleString('en-US')} of {t.needed.toLocaleString('en-US')}){t.met ? ', met' : ''}</li>
              {/each}
              {#if r.status !== 'sealed'}
                {#each r.clear as t (t.text)}
                  <li>Clear: {t.text}{t.met ? ', done' : ''}</li>
                {/each}
              {/if}
            </ul>
            <Button
              disabled={view.tower !== tower.id ||
                r.shut ||
                (r.status !== 'open' && r.status !== 'cleared') ||
                view.rideVerdicts[r.id]?.kind === 'refuse' ||
                view.recovering ||
                r.landing === view.spot.id}
              title={view.rideVerdicts[r.id]?.msg || undefined}
              onclick={() => run(send(climb({ floor: r.id })))}
            >
              {view.rideVerdicts[r.id]?.kind === 'forfeit'
                ? 'Forfeit: ride'
                : view.rideVerdicts[r.id]?.kind === 'enter'
                  ? 'Enter the royale: ride'
                  : 'Ride'} to floor {r.index}
            </Button>
          </li>
        {/each}
      </ol>
      <Button
        disabled={view.tower !== tower.id || view.spot.id === tower.hub || view.recovering}
        title={view.rideVerdicts['']?.msg || undefined}
        onclick={() => run(send(climb({ floor: null })))}
      >
        {view.rideVerdicts['']?.kind === 'forfeit' ? 'Forfeit: ride' : 'Ride'} to the hub
      </Button>
    </div>
  {/each}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 48rem;
  }

  h2 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-md);
  }

  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  /* One line each, always present: the text changes, the height does not. */
  .place,
  .status {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .icon {
    display: inline-block;
    width: 1.5rem;
  }

  .bar {
    position: relative;
    height: 1.25rem;
    overflow: hidden;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
  }

  .fill {
    height: 100%;
    background: var(--color-accent);
    opacity: 0.45;
  }

  .barlabel {
    position: absolute;
    inset: 0;
    font-size: var(--text-sm);
    line-height: 1.25rem;
    text-align: center;
  }

  .row,
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  /* A row of buttons keeps the height of a button with none in it: on the road, or at a spot with no activity. */
  .acts {
    min-height: var(--tap);
  }

  /* Four lines, whatever the text: a longer description scrolls inside. */
  .detail {
    display: block;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .desc {
    height: 5rem;
    margin: 0 0 var(--space-2);
    overflow-y: auto;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
    line-height: 1.25rem;
  }

  /* The card of the picked spot keeps a height, picked or not. */
  .picked {
    min-height: 12rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: var(--space-2);
  }

  .spot {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-height: var(--tap);
    padding: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .spot[aria-pressed='true'] {
    border-color: var(--color-accent);
    outline: 2px solid var(--color-accent);
  }

  .spot.here {
    border-color: var(--color-ok);
  }

  .spot.unknown {
    color: var(--color-text-dim);
  }

  .spotname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The badge line is always there, empty or not. */
  .tag {
    height: 1rem;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
    line-height: 1rem;
  }

  .spot.forced .tag {
    color: var(--color-danger);
  }

  .spot.here .tag {
    color: var(--color-ok);
  }

  .rungs {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-2) 0;
    padding: 0;
    list-style: none;
  }

  .rung {
    padding: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
  }

  .runghead {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .terms {
    margin: var(--space-1) 0 var(--space-2);
    padding-left: var(--space-4);
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .state.cleared {
    color: var(--color-ok);
  }

  .state.open {
    color: var(--color-accent);
  }

  .state.gated {
    color: var(--color-warn);
  }

  .state.sealed {
    color: var(--color-text-dim);
  }

  @media (max-width: 640px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    }
  }
</style>
