<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import benches, { startBench, stopBench } from '../benches';
  import { QUALITY_TIERS, QUALITY_ORDER, type QualityTier } from '../materials';
  import { STAT_NAMES, type ContentMod, type DerivedStats, type StatKey } from '../stats';
  import CloneBenchButton from '../facet/CloneBenchButton.svelte';
  import { STATUSES } from '../statuses';
  import mutagens, {
    ARMS,
    armDelivery,
    capacityLimit,
    capacityUsed,
    CENTROMERE,
    contributionWeight,
    CULTURE_BENCH,
    cutEdge,
    edgeKey,
    establish,
    expressedMain,
    geneAbility,
    grantIsLive,
    histoneCost,
    isClamped,
    layoutOf,
    MAIN_GENES,
    MUTATIONS,
    nextGrade,
    placeMutagen,
    previewRefine,
    priceGeneAbility,
    pricesABlow,
    reaching,
    refineCost,
    REFINE_COPIES,
    removeMutagen,
    resolveChromosome,
    restoreEdge,
    settlingLeft,
    showsGrade,
    slotMain,
    swapBiomatterCost,
    unslotMain,
    type Chromosome,
    type MutagenArm,
    type RoutedContribution,
  } from './index';

  // The old ChromosomePanel and the culture bench of the old BenchPanel.
  // Every number is read from the same functions the stat pipeline and the
  // fight read (`armDelivery`, `deliveredBy`, `priceGeneAbility`).
  const view = $derived(viewOf(mutagens));
  const benchView = $derived(viewOf(benches));
  const chromo = $derived(view.state.chromosome as Chromosome);
  const layout = $derived(layoutOf(chromo));
  const res = $derived(resolveChromosome(chromo));
  const used = $derived(capacityUsed(chromo));
  const limit = $derived(capacityLimit(view.reads));
  const settling = $derived(settlingLeft(view.reads));
  const expressed = $derived(expressedMain(chromo));
  const body = $derived(res.main ?? MAIN_GENES.bare);
  const ability = $derived(geneAbility(chromo));

  /** The node picked on the diagram: a socket id or the centromere. */
  let picked = $state<string | null>(null);

  const ARM_NAMES: Record<MutagenArm, string> = { attacks: 'Attacks', defenses: 'Defenses', active: 'Active', special: 'Special' };
  const PERCENT = new Set(['crit', 'missRefund', 'dodge', 'critTaken', 'penetration', 'splash']);

  function modText(m: ContentMod): string {
    const name = STAT_NAMES[m.stat as StatKey] ?? m.stat.toUpperCase();
    const sign = m.value < 0 ? '-' : '+';
    const pct = m.op === 'mult' || m.stat.startsWith('res') || PERCENT.has(m.stat);
    const size = pct ? `${(Math.abs(m.value) * 100).toFixed(1).replace(/\.0$/, '')}%` : Math.abs(m.value).toFixed(2).replace(/\.?0+$/, '');
    const per = m.fromStat ? ` × ${STAT_NAMES[m.fromStat as StatKey]}` : '';
    const gate = m.requiresTag ? ` (with ${m.requiresTag})` : '';
    return `${name}: ${sign}${size}${per}${gate}`;
  }

  function grantText(g: string): string {
    if (g === 'ignores_dodge') return 'Ignores dodge';
    if (g === 'splits_target') return 'Spills into every flank';
    if (g.startsWith('inflicts_')) return `Inflicts ${STATUSES[g.slice(9)]?.name ?? g.slice(9)}`;
    return g;
  }

  const routeText = (c: RoutedContribution): string => [c.from, ...c.through, '◉'].join(' → ');

  /** Held stacks of a kind: genes for the centromere, mutations for a socket. */
  function held(kind: 'gene' | 'mutagen'): { id: string; quality: QualityTier; qty: number; name: string; icon: string }[] {
    const out = [];
    for (const [id, grades] of Object.entries(view.reads.stock)) {
      const def = kind === 'gene' ? (id !== 'bare' ? MAIN_GENES[id] : undefined) : MUTATIONS[id];
      if (!def) continue;
      for (const q of QUALITY_ORDER) {
        const qty = grades?.[q] ?? 0;
        if (qty > 0) out.push({ id, quality: q, qty, name: def.name, icon: def.icon });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const nodeEdges = $derived(
    picked ? layout.edges.filter((e) => e.a === picked || e.b === picked) : [],
  );
  const edgeState = (a: string, b: string): 'live' | 'cut' | 'none' => {
    const key = edgeKey(a, b);
    if (!chromo.established.includes(key)) return 'none';
    return chromo.cut.includes(key) ? 'cut' : 'live';
  };
  const pos = (node: string) => (node === CENTROMERE ? layout.centre : layout.sockets.find((s) => s.id === node)!);

  const priced = $derived(
    ability && ability.spec.type === 'gene' && pricesABlow(ability.spec)
      ? priceGeneAbility(ability.spec, view.stats as DerivedStats, ability.name, { attr: (a) => view.attrs[a] ?? 0 })
      : null,
  );

  // ---- the culture bench ----
  let subject = $state<{ id: string; quality: QualityTier } | null>(null);
  const subjects = $derived([...held('gene'), ...held('mutagen')]);
  const culture = $derived(subject ? previewRefine(view.reads, { subject }) : null);
  const job = $derived(benchView.job?.discipline === CULTURE_BENCH ? benchView.job : null);
  const target = $derived(subject ? nextGrade(subject.quality) : null);
</script>

<section class="panel" aria-label="Chromosome">
  <h2>
    Chromosome
    <span class="dim num">Capacity {used.total.toFixed(1)} / {limit.toFixed(1)}</span>
  </h2>

  <div class="card body">
    <div class="head">
      <span class="name">{body.icon} {body.name}</span>
      <span class="num dim">
        {showsGrade(expressed) ? QUALITY_TIERS[expressed.quality].name : 'Default body'}
      </span>
    </div>
    {#if body.desc}<p class="desc">{body.desc}</p>{/if}
    <p class="dim small">
      Ceiling: ×{res.ceiling.toFixed(2)}. Settling: {settling > 0 ? `${(settling / 10).toFixed(0)}s` : 'none'}.
      Size: {body.size ?? 'medium'}.
    </p>
    {#if ability}
      <div class="ability">
        <span class="name">{ability.icon} {ability.name}</span>
        <span class="dim small">
          {#if priced}
            {Math.round(priced.damage)} {ability.spec.damageType ?? 'bludgeoning'} damage now, cooldown {(ability.spec.cooldown / 10).toFixed(1)}s.
            {priced.steps.map((s) => (s.mult !== undefined ? `× ${s.mult.toFixed(2)} ${s.label}` : `${s.label} ${s.value?.toFixed(1)}`)).join(', ')}.
          {:else}
            Not a priced blow (waits for a later port).
          {/if}
          What the Active arm routes in lands as stats, not on this blow.
        </span>
      </div>
    {/if}
  </div>

  <div class="diagram card">
    <svg viewBox="-5 -5 110 110" role="img" aria-label="Chromosome diagram">
      {#each layout.edges as e (edgeKey(e.a, e.b))}
        {@const st = edgeState(e.a, e.b)}
        {@const p = pos(e.a)}
        {@const q = pos(e.b)}
        <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} class="edge {st}" />
        {#if e.arm}
          <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 1.5} class="door">{ARM_NAMES[e.arm]}</text>
        {/if}
      {/each}
      {#each layout.sockets as s (s.id)}
        {@const m = chromo.placed[s.id]}
        <g class="node" class:on={picked === s.id} class:stranded={res.stranded.includes(s.id)}>
          <circle cx={s.x} cy={s.y} r="5" role="button" tabindex="0" aria-label="Socket {s.id}"
            onclick={() => (picked = picked === s.id ? null : s.id)}
            onkeydown={(ev) => ev.key === 'Enter' && (picked = picked === s.id ? null : s.id)} />
          <text x={s.x} y={s.y + 1.5} class="label">{s.id}</text>
          {#if m}<text x={s.x + 6} y={s.y - 4} class="icon">{MUTATIONS[m.id]?.icon}</text>{/if}
        </g>
      {/each}
      <g class="node centre" class:on={picked === CENTROMERE}>
        <circle cx={layout.centre.x} cy={layout.centre.y} r="6.5" role="button" tabindex="0" aria-label="Centromere"
          onclick={() => (picked = picked === CENTROMERE ? null : CENTROMERE)}
          onkeydown={(ev) => ev.key === 'Enter' && (picked = picked === CENTROMERE ? null : CENTROMERE)} />
        <text x={layout.centre.x} y={layout.centre.y + 1.5} class="label">◉</text>
      </g>
    </svg>
    <p class="dim small legend">Solid: live. Dashed red: cut. Dotted: not established. Click a node.</p>
  </div>

  {#if picked}
    <div class="card picker">
      <div class="head">
        <span class="name">{picked === CENTROMERE ? 'Centromere' : `Socket ${picked}`}</span>
        <Button onclick={() => (picked = null)}>Close</Button>
      </div>
      {#if picked === CENTROMERE}
        {#if chromo.main}
          <div class="row"><Button onclick={() => send(unslotMain(undefined))}>Revert to Bare Sequence</Button></div>
        {/if}
        <ul class="list">
          {#each held('gene') as h (h.id + h.quality)}
            <li class="row">
              <span>{h.icon} {QUALITY_TIERS[h.quality].name} {h.name} ×{h.qty}</span>
              <span class="dim small num">{swapBiomatterCost(h)} biomatter</span>
              <Button onclick={() => send(slotMain({ id: h.id, quality: h.quality }))}>Wear</Button>
            </li>
          {:else}
            <li class="dim small">No main gene held.</li>
          {/each}
        </ul>
      {:else}
        {@const here = chromo.placed[picked]}
        {#if here}
          <div class="row">
            <span>{MUTATIONS[here.id]?.icon} {QUALITY_TIERS[here.quality].name} {MUTATIONS[here.id]?.name}</span>
            <Button onclick={() => send(removeMutagen({ socket: picked! }))}>Remove</Button>
          </div>
        {/if}
        <ul class="list">
          {#each held('mutagen') as h (h.id + h.quality)}
            <li class="row">
              <span>{h.icon} {QUALITY_TIERS[h.quality].name} {h.name} ×{h.qty}</span>
              <Button onclick={() => send(placeMutagen({ socket: picked!, id: h.id, quality: h.quality }))}>Place</Button>
            </li>
          {:else}
            <li class="dim small">No mutagen held.</li>
          {/each}
        </ul>
      {/if}
      <h3>Connections</h3>
      <ul class="list">
        {#each nodeEdges as e (edgeKey(e.a, e.b))}
          {@const st = edgeState(e.a, e.b)}
          <li class="row">
            <span>{e.a === CENTROMERE ? '◉' : e.a}–{e.b === CENTROMERE ? '◉' : e.b} · {e.length}μm{e.arm ? ` · ${ARM_NAMES[e.arm]}` : ''}</span>
            {#if st === 'none'}
              <Button onclick={() => send(establish({ a: e.a, b: e.b }))}>Establish ({histoneCost(e)} histones)</Button>
            {:else if st === 'live'}
              <Button onclick={() => send(cutEdge({ a: e.a, b: e.b }))}>Cut</Button>
            {:else}
              <Button onclick={() => send(restoreEdge({ a: e.a, b: e.b }))}>Restore</Button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="arms">
    {#each ARMS as arm (arm)}
      {@const got = armDelivery(res, arm)}
      {@const base = res.arms[arm].base ?? []}
      {@const spec = ability?.spec.type === 'gene' ? ability.spec : null}
      <div class="card arm">
        <div class="head"><span class="name">{ARM_NAMES[arm]}</span><span class="num dim">weight {res.arms[arm].weight.toFixed(2)}</span></div>
        {#if base.length}
          <div class="small">Body: {base.map(modText).join('; ')}</div>
        {/if}
        <div class="small">
          Delivers: {got.mods.length ? got.mods.map(modText).join('; ') : 'no modifiers'}
        </div>
        {#if got.grants.length || got.types.length}
          <div class="small">
            {#each got.grants as g (g)}
              <span class:inert={!grantIsLive(g, arm, spec)}>{grantText(g)}{grantIsLive(g, arm, spec) ? '' : ' (read by nothing here)'}; </span>
            {/each}
            {#each got.types as t (t)}
              <span class:inert={arm !== 'attacks' && arm !== 'active'}>Arrives as {t}{arm === 'attacks' || arm === 'active' ? '' : ' (read by nothing here)'}; </span>
            {/each}
          </div>
        {/if}
        {#each reaching(res, arm) as c, i (c.from + i)}
          <details class="route small">
            <summary>
              {MUTATIONS[c.gene.id]?.icon} {routeText(c)} · ×{contributionWeight(c, res.ceiling).toFixed(2)}{c.share < 1 ? ' · split' : ''}{isClamped(c, res.ceiling) ? ' · capped' : ''}
            </summary>
            <ul>{#each c.notes as n, k (k)}<li>{n}</li>{/each}</ul>
          </details>
        {/each}
      </div>
    {/each}
  </div>

  {#if res.stranded.length}
    <p class="small warn">Stranded (no live route): {res.stranded.join(', ')}.</p>
  {/if}

  <div class="card bench">
    <div class="head"><span class="name">🧫 Culture Bench</span></div>
    {#if !view.atBench}
      <p class="dim small">
        Stands at {view.benches.length ? view.benches.map((b) => b.name).join(', ') : 'the Vivarium (not yet found)'}.
      </p>
    {:else}
      <label class="small">
        Subject
        <select
          value={subject ? `${subject.id}:${subject.quality}` : ''}
          onchange={(ev) => {
            const v = (ev.currentTarget as HTMLSelectElement).value;
            if (!v) subject = null;
            else {
              const [id, quality] = v.split(':');
              subject = { id, quality: quality as QualityTier };
            }
          }}
        >
          <option value="">Choose a gene or mutagen</option>
          {#each subjects as h (h.id + h.quality)}
            <option value="{h.id}:{h.quality}">{h.icon} {QUALITY_TIERS[h.quality].name} {h.name} ×{h.qty}</option>
          {/each}
        </select>
      </label>
      <p class="small cost">
        {#if subject && target}
          {REFINE_COPIES} copies and {refineCost(target)} biomatter (held {view.reads.counts.biomatter ?? 0}) make one {QUALITY_TIERS[target].name}.
        {:else if subject}
          Nothing refines past Divine.
        {:else}
          Two copies of one grade plus biomatter make one copy a grade higher.
        {/if}
      </p>
      <div class="row">
        <Button disabled={!culture?.ok || !!job} onclick={() => subject && send(startBench({ discipline: CULTURE_BENCH, placement: { subject }, count: 1 }))}>Refine</Button>
        <Button disabled={!culture?.ok || !!job} onclick={() => subject && send(startBench({ discipline: CULTURE_BENCH, placement: { subject }, count: null }))}>Refine all</Button>
        <Button disabled={!job} onclick={() => send(stopBench(undefined))}>Stop</Button>
      </div>
      <!-- Shadow Clone: a clone keeps refining this grade from your stock (step 4 port F). -->
      <CloneBenchButton discipline={CULTURE_BENCH} placement={subject ? { subject } : {}} ok={!!subject && !!culture?.ok} />
      <div class="progress" aria-label="Refinement progress"><div class="progress-fill" style="width: {((job?.progress ?? 0) * 100).toFixed(1)}%"></div></div>
      <div class="reason small">{culture && !culture.ok && !job ? culture.reason : job ? `${(Math.max(0, job.ticksLeft) / 10).toFixed(1)}s · ${job.done} done` : ''}</div>
    {/if}
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 52rem;
  }
  h2 {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }
  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-md);
  }
  .card {
    padding: var(--space-3);
    background: var(--color-surface);
    border: var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .head,
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }
  .name {
    font-weight: 600;
  }
  .dim {
    color: var(--color-text-dim);
  }
  .small {
    font-size: var(--text-sm);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .desc {
    margin: 0;
    font-size: var(--text-sm);
  }
  .warn {
    color: var(--color-warn);
  }
  .inert {
    color: var(--color-text-dim);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .diagram svg {
    width: 100%;
    max-width: 26rem;
    align-self: center;
  }
  .edge {
    stroke-width: 0.8;
  }
  .edge.live {
    stroke: var(--color-accent);
  }
  .edge.cut {
    stroke: var(--color-danger);
    stroke-dasharray: 2 1.5;
  }
  .edge.none {
    stroke: var(--color-border);
    stroke-dasharray: 0.6 1.2;
  }
  .door {
    font-size: 3px;
    fill: var(--color-text-dim);
    text-anchor: middle;
  }
  .node circle {
    fill: var(--color-surface-raised);
    stroke: var(--color-border);
    stroke-width: 0.6;
    cursor: pointer;
  }
  .node.on circle {
    stroke: var(--color-accent);
    stroke-width: 1.2;
  }
  .node.stranded circle {
    stroke: var(--color-warn);
  }
  .label {
    font-size: 4px;
    fill: var(--color-text);
    text-anchor: middle;
    pointer-events: none;
  }
  .icon {
    font-size: 4px;
    pointer-events: none;
  }
  .legend {
    margin: 0;
    text-align: center;
  }
  .arms {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-3);
  }
  .route summary {
    cursor: pointer;
  }
  .route ul {
    margin: var(--space-1) 0 0;
    padding-left: var(--space-4);
  }
  select {
    min-height: var(--tap);
    width: 100%;
    background: var(--color-surface-raised);
    color: var(--color-text);
    border: var(--border);
    border-radius: var(--radius);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .progress {
    height: 0.5rem;
    background: var(--color-surface-raised);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--color-accent);
  }
  .cost {
    margin: 0;
    min-height: 2.6em;
  }
  .reason {
    height: 1.5em;
    line-height: 1.5em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-dim);
  }
</style>
