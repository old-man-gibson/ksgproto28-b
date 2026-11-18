<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import {
    DISCIPLINES,
    recallLayout,
    rememberLayout,
    slotAccepts,
    slotPicks,
    startBench,
    stopBench,
    type GradedStack,
    type Placement,
  } from '../benches';
  import { MATERIALS, QUALITY_TIERS, type MaterialsState, type QualityTier } from '../materials';
  import { STATUSES } from '../statuses';
  import cooking, {
    cookbook,
    cookLedger,
    exposureInfo,
    cookTimeRows,
    gapSentence,
    heatHint,
    ledgerSummary,
    trackRows,
    PREP_LIST,
    previewCook,
    type BookReads,
  } from './index';

  // The kitchen: a tab per bench at this spot, the slots (a slot opens its
  // picker on click), the stove's cook length, the preview and the grade
  // ledger, the run controls, the last dish, and the Cook's Book. Every box
  // has a fixed height; nothing opens on hover; no size follows the tick.
  const view = $derived(viewOf(cooking));
  const here = $derived(view.benches.filter((b) => b.here));
  let chosen = $state<string | null>(null);
  const benchId = $derived(here.find((b) => b.id === chosen)?.id ?? here[0]?.id ?? null);
  const disc = $derived(benchId ? DISCIPLINES[benchId] : null);
  const benchView = $derived(view.benches.find((b) => b.id === benchId) ?? null);

  let layouts = $state<Record<string, { placement: Placement; units: number | null }>>({});
  let picking = $state<string | null>(null);

  const layout = $derived(
    benchId ? (layouts[benchId] ?? recallLayout(benchId) ?? { placement: {}, units: null }) : { placement: {}, units: null },
  );
  const bench = $derived(layout.placement);
  const units = $derived(disc?.timeline ? (layout.units ?? disc.timeline.default) : undefined);

  function setLayout(placement: Placement, u: number | null): void {
    if (!benchId) return;
    layouts = { ...layouts, [benchId]: { placement, units: u } };
    rememberLayout(benchId, placement, u);
  }

  /** The stock the view lists, in the shape the bench check reads. */
  const reads = $derived.by(() => {
    const stock: MaterialsState['stock'] = {};
    for (const r of view.stock) stock[r.id] = Object.fromEntries(r.grades.map((g) => [g.quality, g.qty]));
    const known = new Set(view.known);
    return { level: view.level, materials: { counts: {}, stock } as MaterialsState, knowsRecipe: (id: string) => known.has(id) };
  });
  const book = $derived<BookReads>({ counters: { counts: view.book.counters }, carried: view.book.carried, rank: view.book.rank });

  const check = $derived(disc ? previewCook(reads, bench, disc, units) : null);
  const ledger = $derived(disc && !disc.outcomes.some((o) => o.result.kind === 'prepped') ? cookLedger(reads, bench, disc, units) : null);
  const hint = $derived.by(() => {
    if (!disc?.timeline || units === undefined || !check) return null;
    const rowsT = trackRows(reads, disc, bench, units);
    return heatHint(reads, disc, bench, units, rowsT, cookTimeRows(reads, disc, bench, units), check);
  });
  const gap = $derived(ledger ? gapSentence(ledger, view.level, 'Cooking', !!disc?.timeline) : null);
  const open = $derived(disc ? disc.slots.filter((s) => benchView?.openSlots.includes(s.id)) : []);
  const baseHeld = $derived.by(() => {
    const base = disc?.slots.find((s) => s.role === 'base');
    const put = base ? bench[base.id] : undefined;
    if (!put) return 0;
    return view.stock.find((r) => r.id === put.id)?.grades.find((g) => g.quality === put.quality)?.qty ?? 0;
  });

  function put(slotId: string, stack: GradedStack | undefined): void {
    setLayout({ ...bench, [slotId]: stack }, layout.units);
    picking = null;
  }

  function run(count: number | null): void {
    if (!benchId) return;
    send(startBench({ discipline: benchId, placement: bench, count, ...(units !== undefined ? { duration: units } : {}) }));
  }

  const nameOf = (id: string) => view.stock.find((r) => r.id === id)?.name ?? PREP_LIST.find((p) => p.id === id)?.name ?? id;
  const iconOf = (id: string) => view.stock.find((r) => r.id === id)?.icon ?? PREP_LIST.find((p) => p.id === id)?.icon ?? '?';
  const grade = (q: QualityTier) => QUALITY_TIERS[q].name;
  const sigNames = (dishId: string) => (MATERIALS[dishId]?.consumable?.signature ?? []).map((s) => STATUSES[s.id]?.name ?? s.id);
  const fix2 = (x: number) => x.toFixed(2);

  const rows = $derived(cookbook(book));
  const plate = $derived(view.plate);
  const benchName = (id: string) => view.benches.find((b) => b.id === id)?.benchName ?? id;
  const kitchenSpots = $derived([...new Set(view.benches.flatMap((b) => b.spots))]);
</script>

<section class="panel" aria-label="Kitchen">
  <h2>Kitchen <span class="dim num">Cooking {view.level}</span></h2>

  {#if disc && benchView}
    <div class="tabs" role="tablist">
      {#each here as b (b.id)}
        <button type="button" role="tab" class="tab" aria-selected={b.id === benchId} onclick={() => ((chosen = b.id), (picking = null))}>
          {b.icon} {b.benchName}
        </button>
      {/each}
    </div>

    {#if disc.timeline}
      <div class="tabs" aria-label="Cook length">
        {#each disc.timeline.options as opt (opt.units)}
          <button type="button" class="tab" aria-pressed={units === opt.units} onclick={() => setLayout(bench, opt.units)}>
            {opt.name} <span class="num">{opt.units}</span>
          </button>
        {/each}
      </div>
    {/if}

    <ul class="slots" aria-label="Slots">
      {#each disc.slots as slot (slot.id)}
        {@const isOpen = benchView.openSlots.includes(slot.id)}
        {@const stack = bench[slot.id]}
        {@const info = stack && units !== undefined ? exposureInfo(disc, slot, stack.id, units) : null}
        <li class="slot" class:locked={!isOpen}>
          {#if isOpen}
            <button type="button" class="cell" class:picked={picking === slot.id} aria-expanded={picking === slot.id} onclick={() => (picking = picking === slot.id ? null : slot.id)}>
              <span class="glyph">{stack ? iconOf(stack.id) : '+'}</span>
              <span class="ident">
                <span class="clip">{slot.name}{slot.optional ? '' : ' *'}</span>
                <span class="dim clip">{stack ? `${nameOf(stack.id)}${slotPicks(slot) === 'design' ? '' : `, ${grade(stack.quality)}`}` : 'Empty'}</span>
                <span class="dim clip num">{info ? `Heat: ${info.exposure.toFixed(1)} units, ${info.verdict}, ×${fix2(info.fit)}` : slot.at != null && units !== undefined ? `Enters at ${(units * slot.at).toFixed(1)} of ${units}` : ' '}</span>
              </span>
            </button>
          {:else}
            <span class="cell shut"><span class="glyph">🔒</span><span class="ident"><span class="clip">{slot.name}</span><span class="dim clip">Cooking {slot.unlockLevel}</span><span class="dim"> </span></span></span>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="dim line">{benchView.next ? `Next slot: ${disc.slots.find((s) => s.id === benchView.next?.slot)?.name} at Cooking ${benchView.next.level}.` : 'Every slot is open.'}</div>

    <div class="card well">
      {#if picking}
        {@const slot = open.find((s) => s.id === picking)}
        <div class="row">
          <b>{slot?.name}</b>
          <span class="row">
            <Button onclick={() => put(picking!, undefined)}>Clear slot</Button>
            <Button onclick={() => (picking = null)}>Close</Button>
          </span>
        </div>
        {#if slot && slotPicks(slot) === 'design'}
          <ul class="opts">
            {#each PREP_LIST as p (p.id)}
              <li>
                <button type="button" class="opt" style="--tint: var(--color-accent)" onclick={() => put(picking!, { id: p.id, quality: 'c' })}>
                  <span class="glyph">{p.icon}</span>
                  <span class="ident"><span class="clip">{p.name}</span><span class="dim clip">{(p.minLevel ?? 0) > view.level ? `Cooking ${p.minLevel}` : 'Known'}</span></span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if slot}
          {@const fits = view.stock.filter((r) => slotAccepts(slot, r.id))}
          {#if fits.length}
            <ul class="opts">
              {#each fits as r (r.id)}
                {#each r.grades as g (g.quality)}
                  <li>
                    <button type="button" class="opt" style="--tint: {QUALITY_TIERS[g.quality].color}" onclick={() => put(picking!, { id: r.id, quality: g.quality })}>
                      <span class="glyph">{r.icon}</span>
                      <span class="ident"><span class="clip">{r.name}</span><span class="dim clip">{grade(g.quality)}, {g.qty} held</span></span>
                    </button>
                  </li>
                {/each}
              {/each}
            </ul>
          {:else}
            <div class="dim">Nothing held fits this slot. It takes: {slot.accepts.join(', ')}.</div>
          {/if}
        {/if}
      {:else if ledger && ledger.rows.length}
        <div class="num">{ledgerSummary(ledger)}</div>
        <ul class="fx num">
          {#each ledger.rows as r (r.slotId)}
            <li>{nameOf(r.id)}, {grade(r.quality)}{r.tool ? ' (cookware)' : ''}: {fix2(r.lo)}{r.hi !== r.lo ? ` to ${fix2(r.hi)}` : ''}{r.fit !== 1 ? `, heat ×${fix2(r.fit)}` : ''}</li>
          {/each}
          <li>Mean: {fix2(ledger.mean[0])}{ledger.mean[1] !== ledger.mean[0] ? ` to ${fix2(ledger.mean[1])}` : ''}</li>
          <li>Cook's judgement: +{fix2(ledger.judgement)}</li>
          <li>Bench fit: +{fix2(ledger.benchFit)}</li>
        </ul>
        <div class="dim">{gap ?? 'Top grade.'}</div>
      {:else}
        <div class="dim">Select a slot to add an ingredient.{disc.timeline ? ' Each slot adds its ingredient at a set point in the cook.' : ''}</div>
      {/if}
    </div>

    <div class="card preview">
      {#if check?.ok}
        <b>{check.outcome?.icon} {check.label}</b>
        {#each check.heatExposure ?? [] as h (h.tag)}
          <div class="dim num">Heat: {h.tag} {h.mean.toFixed(1)} units</div>
        {/each}
        {#if hint}<div class="dim">{hint.text}</div>{/if}
        {#if check.outcome?.desc}<div class="dim">{check.outcome.desc}</div>{/if}
      {:else}
        <div class="dim">{check?.reason ?? 'Lay something out to begin.'}</div>
      {/if}
    </div>

    <div class="actions">
      {#if view.job}
        <div class="runbar" aria-label="Cooking">
          <div class="bar"><div class="fill" style="width: {(view.job.progress * 100).toFixed(1)}%"></div></div>
          <span class="dim num">{benchName(view.job.discipline)}: {view.job.secondsLeft.toFixed(1)}s, {view.job.done}{view.job.remaining !== null ? ` / ${view.job.done + view.job.remaining}` : ''} done</span>
        </div>
        <Button onclick={() => send(stopBench(undefined))}>Stop</Button>
      {:else}
        <Button variant="primary" disabled={!check?.ok} onclick={() => run(1)}>{benchView.icon} {benchView.verb}</Button>
        <Button disabled={!check?.ok || baseHeld < 2} onclick={() => run(Math.min(5, baseHeld))}>×{Math.min(5, Math.max(2, baseHeld))}</Button>
        <Button disabled={!check?.ok || baseHeld < 2} onclick={() => run(baseHeld)}>All {baseHeld > 1 ? baseHeld : ''}</Button>
        <Button disabled={!check?.ok} onclick={() => run(null)}>Keep going</Button>
        <Button onclick={() => (setLayout({}, layout.units), (picking = null))}>Clear</Button>
      {/if}
    </div>
  {:else}
    <p class="card dim note">Cooking needs a kitchen bench: {kitchenSpots.join(', ') || 'none in reach'}.</p>
  {/if}

  <div class="card plate num" aria-label="Last dish">
    {#if plate}
      {@const after = rows.find((r) => r.dishId === plate.cooked.dish)}
      <span>Last cooked: {grade(plate.cooked.quality)} {MATERIALS[plate.cooked.dish]?.name ?? plate.cooked.dish}{plate.cooked.low !== plate.cooked.high ? ` (range ${grade(plate.cooked.low)} to ${grade(plate.cooked.high)})` : ''}</span>
      <span class="dim">Made: {after?.made ?? 0}. Best: {after?.best ? grade(after.best) : '—'}.{after?.signature ? ' Signature dish.' : ''}</span>
    {:else}
      <span class="dim">Last cooked: nothing yet this run.</span>
    {/if}
  </div>

  <h2>Cook's Book <span class="dim num">{new Set(rows.filter((r) => r.made > 0).map((r) => r.dishId)).size} dishes made</span></h2>
  <div class="card bookbox">
    <table class="book">
      <thead><tr><th>Dish</th><th class="num">Made</th><th>Best</th><th>Cook time</th><th>Signature</th></tr></thead>
      <tbody>
        {#each rows as r (r.benchId + ':' + r.outcomeId)}
          {@const outcome = DISCIPLINES[r.benchId]?.outcomes.find((o) => o.id === r.outcomeId)}
          {@const blank = r.made === 0 && !!outcome?.recipe && !view.known.includes(outcome.recipe)}
          <tr>
            <td class="clip">{blank ? '—' : `${outcome?.icon ?? ''} ${outcome?.name ?? r.dishId}`} <span class="dim">{benchName(r.benchId)}</span></td>
            <td class="num">{r.made}</td>
            <td>{r.best ? grade(r.best) : '—'}</td>
            <td class="dim">{r.heat?.length ? r.heat.map((w) => `${w.tag} ${w.from ?? 0}${w.to !== undefined ? ` to ${w.to}` : '+'}`).join(', ') : outcome?.heat?.length ? 'after 25 cooks' : '—'}</td>
            <td class="dim">{sigNames(r.dishId).length ? (r.signature ? sigNames(r.dishId).join(' and ') : 'after 100 cooks') : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="dim note">Dishes are eaten from Provisions, between fights. At most three are active at once.</p>
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

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .tab {
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .tab[aria-selected='true'],
  .tab[aria-pressed='true'] {
    border-color: var(--color-accent);
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .cell {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 4.2rem;
    padding: var(--space-1) var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .cell.picked {
    border-color: var(--color-accent);
  }

  .cell.shut {
    cursor: default;
    opacity: 0.6;
  }

  .well {
    height: 15rem;
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

  .fx {
    margin: var(--space-1) 0;
    padding-left: 1.2em;
    font-size: var(--text-sm);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    height: 7rem;
    overflow-y: auto;
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

  .plate {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    height: 4.5rem;
    overflow: hidden;
  }

  .bookbox {
    height: 18rem;
    overflow: auto;
  }

  .book {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .book th,
  .book td {
    padding: var(--space-1);
    border-bottom: var(--border);
    text-align: left;
    white-space: nowrap;
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
    .slots {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
