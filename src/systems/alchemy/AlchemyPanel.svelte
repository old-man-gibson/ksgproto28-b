<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import { recallLayout, rememberLayout, startBench, stopBench, type GradedStack, type Placement } from '../benches';
  import type { MaterialsState, QualityTier } from '../materials';
  import { STATUSES } from '../statuses';
  import alchemy, { ALCHEMY, BREW_FORMS, checkBrew, composeBrew, sequenceOf, useFlask } from './index';

  // The Alembic: a strip of steps read left to right, a well that holds the
  // reagent picker or the reading (always the same height), the preview, the
  // run controls, and the Satchel. A step or a flask opens on click; nothing
  // opens on hover. No box changes size with the tick or with a fight.
  const view = $derived(viewOf(alchemy));

  let bench = $state<Placement>(recallLayout(ALCHEMY.id)?.placement ?? {});
  let picking = $state<string | null>(null);
  let openFlask = $state<number | null>(null);

  $effect(() => rememberLayout(ALCHEMY.id, bench, null));

  const open = $derived(view.steps.filter((s) => s.open));
  const coming = $derived(view.steps.find((s) => !s.open) ?? null);

  /** The stock the view lists, in the shape the bench check reads. */
  const reads = $derived.by(() => {
    const stock: MaterialsState['stock'] = {};
    for (const r of view.reagents) {
      if (!r.grades.length) continue;
      stock[r.id] = Object.fromEntries(r.grades.map((g) => [g.quality, g.qty]));
    }
    return { level: view.level, materials: { counts: {}, stock } as MaterialsState, knowsRecipe: () => false };
  });

  const check = $derived(checkBrew(reads, bench));
  const sequence = $derived(sequenceOf(bench));
  const reading = $derived(sequence.length ? composeBrew(sequence) : null);
  const emptySteps = $derived(Math.max(0, open.length - sequence.length));
  const baseHeld = $derived.by(() => {
    const base = bench[open[0]?.id ?? ''];
    if (!base) return 0;
    return view.reagents.find((r) => r.id === base.id)?.grades.find((g) => g.quality === base.quality)?.qty ?? 0;
  });

  const held = $derived(view.reagents.filter((r) => r.grades.length > 0));
  const reagentOf = (id: string) => view.reagents.find((r) => r.id === id);

  function put(slotId: string, stack: GradedStack | undefined): void {
    bench = { ...bench, [slotId]: stack };
    picking = null;
  }

  /** Move a filled step one place earlier or later among the filled steps. */
  function shift(slotId: string, dir: -1 | 1): void {
    const filled = open.filter((s) => bench[s.id]).map((s) => s.id);
    const at = filled.indexOf(slotId);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= filled.length) return;
    const other = filled[to];
    bench = { ...bench, [slotId]: bench[other], [other]: bench[slotId] };
  }

  function stepNumber(slotId: string): number {
    let n = 0;
    for (const s of view.steps) {
      if (bench[s.id]) n++;
      if (s.id === slotId) return n;
    }
    return n;
  }

  function run(count: number | null): void {
    send(startBench({ discipline: ALCHEMY.id, placement: bench, count }));
  }

  const fmt = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
  const statusName = (id: string) => STATUSES[id]?.name ?? id;
  const gradeOf = (q: QualityTier) => q.toUpperCase();
</script>

<section class="panel" aria-label="Alchemy">
  <h2>Alembic <span class="dim num">Alchemy {view.level}</span></h2>

  {#if view.atBench}
    <ol class="strip" aria-label="Steps, read left to right">
      {#each view.steps as step (step.id)}
        {@const stack = bench[step.id]}
        {@const r = stack ? reagentOf(stack.id) : undefined}
        <li class="step" class:locked={!step.open}>
          {#if step.open}
            <button
              type="button"
              class="cell"
              class:picked={picking === step.id}
              aria-expanded={picking === step.id}
              onclick={() => (picking = picking === step.id ? null : step.id)}
            >
              {#if stack}
                <span class="glyph">{r?.icon ?? '?'}</span>
                <span class="grade">{gradeOf(stack.quality)}</span>
              {:else}
                <span class="dim">+</span>
              {/if}
            </button>
            <span class="cap dim">{stack ? `#${stepNumber(step.id)} ${r?.name ?? stack.id}` : step.name}</span>
            <span class="nudge">
              <button type="button" class="tiny" disabled={!stack} aria-label="Earlier" onclick={() => shift(step.id, -1)}>◀</button>
              <button type="button" class="tiny" disabled={!stack} aria-label="Later" onclick={() => shift(step.id, 1)}>▶</button>
            </span>
          {:else}
            <span class="cell shut" aria-label="Locked">🔒</span>
            <span class="cap dim">Alchemy {step.unlockLevel}</span>
            <span class="nudge"></span>
          {/if}
        </li>
      {/each}
    </ol>
    <div class="dim line">{coming ? `Next step: ${coming.name} at Alchemy ${coming.unlockLevel}.` : 'Every step is open.'}</div>

    <div class="card well">
      {#if picking}
        {@const slot = open.find((s) => s.id === picking)}
        <div class="row">
          <b>{slot?.name}</b>
          <span class="row">
            <Button onclick={() => put(picking!, undefined)}>Clear step</Button>
            <Button onclick={() => (picking = null)}>Close</Button>
          </span>
        </div>
        {#if held.length}
          <ul class="opts">
            {#each held as r (r.id)}
              {#each r.grades as g (g.quality)}
                <li>
                  <button
                    type="button"
                    class="opt"
                    style="--tint: {g.color}"
                    onclick={() => put(picking!, { id: r.id, quality: g.quality as QualityTier })}
                  >
                    <span class="glyph">{r.icon}</span>
                    <span class="ident"><span class="clip">{r.name}</span><span class="dim clip">{g.grade}, {g.qty} held{r.known ? '' : `, Alchemy ${r.minLevel}`}</span></span>
                  </button>
                </li>
              {/each}
            {/each}
          </ul>
        {:else}
          <div class="dim">No reagent held. The Reagent Shelf at the Alembics sells them.</div>
        {/if}
      {:else if reading}
        <ol class="notes">
          {#each reading.notes as note, i (i)}<li>{note}</li>{/each}
          {#each { length: emptySteps } as _, i (i)}<li class="dim">—</li>{/each}
        </ol>
      {:else}
        <div class="dim">Select a step to add a reagent. Steps are read left to right.</div>
      {/if}
    </div>

    <div class="card preview">
      {#if check.ok && check.spec}
        {@const spec = check.spec}
        {@const kind = BREW_FORMS[spec.form]}
        <div class="row head">
          <b>{spec.icon} {spec.name}</b>
          <span class="dim num">{kind.name}, {kind.verb}{check.formula ? ', known formula' : ''}</span>
        </div>
        <div class="dim num">Volatility: {spec.volatility.toFixed(2)}. Potency: {spec.potency.toFixed(2)}. Worth: about {Math.round(spec.value)} gold.</div>
        <ul class="fx">
          {#each spec.strikes as s, i (i)}
            <li>Damage: {fmt(s.power)} {s.type}{spec.form === 'oil' ? ` per blow, ${spec.blows} blows` : kind.thrown ? ' to the front enemy, half to the rest' : ''}{s.penetration ? `, ${Math.round(s.penetration * 100)}% armour pierce` : ''}{#each s.inflicts ?? [] as inf, j (j)}, inflicts {statusName(inf.id)} ×{(inf.intensity ?? 1).toFixed(2)}{/each}</li>
          {/each}
          {#each spec.restore as r, i (i)}<li>Restores: {fmt(r.amount)} {r.resource}</li>{/each}
          {#each spec.grants as g, i (i)}<li>Grants: {statusName(g.id)} ×{(g.intensity ?? 1).toFixed(2)} for {((g.duration as number) / 10).toFixed(0)}s</li>{/each}
          {#each spec.inflicts as inf, i (i)}<li>Inflicts: {statusName(inf.id)} ×{(inf.intensity ?? 1).toFixed(2)}{spec.form === 'fume' ? ' on every enemy' : spec.form === 'oil' ? ' per blow' : ''}</li>{/each}
          {#each spec.cures as c (c)}<li>Clears: {c}</li>{/each}
        </ul>
      {:else}
        <div class="dim">{check.reason ?? 'Lay something out to begin.'}</div>
      {/if}
      {#if reading}
        <div class="sum">{#each reading.summary as line, i (i)}<div class="dim">{line}</div>{/each}</div>
      {/if}
    </div>

    <div class="actions">
      {#if view.job}
        <div class="runbar" aria-label="Brewing">
          <div class="bar"><div class="fill" style="width: {(view.job.progress * 100).toFixed(1)}%"></div></div>
          <span class="dim num">{view.job.secondsLeft.toFixed(1)}s, {view.job.done}{view.job.remaining !== null ? ` / ${view.job.done + view.job.remaining}` : ''} done</span>
        </div>
        <Button onclick={() => send(stopBench(undefined))}>Stop</Button>
      {:else}
        <Button variant="primary" disabled={!check.ok} onclick={() => run(1)}>⚗️ Brew</Button>
        <Button disabled={!check.ok || baseHeld < 2} onclick={() => run(Math.min(5, baseHeld))}>×{Math.min(5, Math.max(2, baseHeld))}</Button>
        <Button disabled={!check.ok || baseHeld < 2} onclick={() => run(baseHeld)}>All {baseHeld > 1 ? baseHeld : ''}</Button>
        <Button disabled={!check.ok} onclick={() => run(null)}>Keep going</Button>
        <Button onclick={() => ((bench = {}), (picking = null))}>Clear</Button>
      {/if}
    </div>
  {:else}
    <p class="card dim note">Brewing needs an Alembic: {view.benchSpots.join(', ')}.</p>
  {/if}

  <h2>Satchel <span class="dim num">{view.flasks.reduce((n, f) => n + f.qty, 0)} flasks</span></h2>
  <div class="card status">
    <div class="dim">Flasks and Fumes are thrown and need a fight. Elixirs, Draughts, Salves and Oils work anywhere. One shared cooldown.</div>
    <div class="num">Cooldown: {view.cooldown > 0 ? `${view.cooldown.toFixed(1)}s` : 'ready'}</div>
    <div class="num">Weapon oil: {view.coating ? `${view.coating.name}, ${view.coating.blowsLeft} blow${view.coating.blowsLeft === 1 ? '' : 's'} left` : 'none'}</div>
  </div>
  <ul class="card flasks" aria-label="Flasks">
    {#each view.flasks as f (f.index + ':' + f.steps.join('>'))}
      <li class="flask" style="--tint: {f.color}">
        <div class="row">
          <button type="button" class="name-btn" aria-expanded={openFlask === f.index} onclick={() => (openFlask = openFlask === f.index ? null : f.index)}>
            <span class="glyph">{f.icon}</span>
            <span class="clip">{f.name}{f.qty > 1 ? ` ×${f.qty}` : ''}</span>
          </button>
          <Button disabled={f.blocked !== null} title={f.blocked ?? undefined} onclick={() => send(useFlask({ index: f.index }))}>{f.verb}</Button>
        </div>
        {#if openFlask === f.index}
          <div class="detail">
            <div class="dim">Steps: {f.steps.join(' → ')}</div>
            <div class="dim">Form: {f.formName}. Grade: {f.grade}.</div>
            {#each f.lines as line (line)}<div class="dim">{line}</div>{/each}
            <div class="dim">{f.desc}</div>
            {#if f.blocked}<div class="dim">Blocked: {f.blocked}</div>{/if}
          </div>
        {/if}
      </li>
    {:else}
      <li class="dim">No flasks. Brew them at an Alembic.</li>
    {/each}
  </ul>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 48rem;
  }

  h2 {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  .card {
    box-sizing: border-box;
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .note,
  .line {
    margin: 0;
  }

  .strip {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .cell {
    position: relative;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: calc(var(--tap) + var(--space-2));
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .cell.picked {
    border-color: var(--color-accent);
  }

  .cell.shut {
    cursor: default;
    opacity: 0.6;
  }

  .grade {
    position: absolute;
    right: var(--space-1);
    bottom: 0;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
  }

  .cap {
    width: 100%;
    height: 1.4em;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nudge {
    display: flex;
    gap: var(--space-1);
    height: var(--tap);
  }

  .tiny {
    min-width: var(--tap);
    min-height: var(--tap);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .tiny:disabled {
    visibility: hidden;
  }

  .well {
    height: 14rem;
    overflow-y: auto;
  }

  .opts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .opt {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--tap);
    padding: var(--space-1) var(--space-2);
    border: var(--border);
    border-left: 4px solid var(--tint);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .notes {
    margin: 0;
    padding-left: 1.5em;
    font-size: var(--text-sm);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    height: 13rem;
    overflow-y: auto;
  }

  .head {
    flex-wrap: wrap;
  }

  .fx {
    margin: 0;
    padding-left: 1.2em;
    font-size: var(--text-sm);
  }

  .sum {
    display: flex;
    flex-direction: column;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-height: calc(2 * var(--tap) + var(--space-2));
    align-content: flex-start;
  }

  .runbar {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 10rem;
  }

  .bar {
    height: 0.6rem;
    border: var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--color-accent);
  }

  .status {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .flasks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 16rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .flask {
    padding: var(--space-1) var(--space-2);
    border: var(--border);
    border-left: 4px solid var(--tint);
    border-radius: var(--radius);
  }

  .name-btn {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--tap);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .detail {
    display: flex;
    flex-direction: column;
    padding: var(--space-1) 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  .glyph {
    font-size: var(--text-lg);
    text-align: center;
  }

  .ident {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .clip {
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
    font-size: var(--text-sm);
  }

  @media (max-width: 640px) {
    .strip {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
