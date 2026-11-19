<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import { specLines } from '../spellcraft';
  import psionic, {
    PSI_AXIS_LIST,
    PSI_QUANTITY_LIST,
    deriveShape,
    forgetShape,
    memorize,
    recogniseShape,
    shape as shapeCommand,
    shapeKey,
    shapeSpec,
    shapeTotal,
    type PsiAxisId,
    type PsiQuantityId,
    type PsionicShape,
  } from './index';

  // The psionic wheel of the Spellcrafting Table. Every block has a fixed
  // height and scrolls inside, so a dial turned or a fight running never
  // moves the page. A description opens on click, in one fixed box.
  const view = $derived(viewOf(psionic));

  let shape = $state<PsionicShape>({});
  /** The axis or quantity whose description is open. */
  let detail = $state<string | null>(null);

  const spent = $derived(shapeTotal(shape));
  const open = (axis: string) => view.axes.includes(axis);

  /** The same check the command runs, against what the view states. */
  const check = $derived.by((): { ok: boolean; reason?: string } => {
    for (const axis of PSI_AXIS_LIST) {
      const points = shape[axis.id] ?? 0;
      if (!points) continue;
      if (!open(axis.id)) return { ok: false, reason: `${axis.name} needs a teacher` };
      if (points > view.cap) return { ok: false, reason: `${axis.name} cap is ${view.cap} points (Psionics milestones raise it)` };
    }
    if (spent === 0) return { ok: false, reason: 'Shape is empty' };
    return { ok: true };
  });

  // The preview reads the shape in the shaper's hands (the gear bias) at the
  // taught tier; the grimoire lists the bare shape. As the old bench.
  const reading = $derived(deriveShape(shape, view.bias));
  const preview = $derived(spent > 0 ? shapeSpec(shape, view.tier, view.bias) : null);
  const lines = $derived(preview ? specLines(preview) : []);
  const outOfReach = $derived.by(() => {
    if (spent === 0) return null;
    const full = recogniseShape(shape, 12, view.bias);
    return full && (full.tier ?? 0) > view.tier ? full : null;
  });
  const tooWide = $derived(preview && (preview.focusCost ?? 0) > view.maxFocus ? (preview.focusCost ?? 0) : null);
  const key = $derived(shapeKey(shape));
  const inBook = $derived(view.bookKeys.includes(key));
  const held = $derived(view.memorized.some((m) => m.key === key));

  /** Each quantity's bar against the widest value this mind could reach. */
  const QUANTITY_MAX: Record<PsiQuantityId, (cap: number) => number> = {
    pressure: (cap) => cap * 2,
    momentum: (cap) => cap * cap,
    inertia: (cap) => cap,
    acuity: (cap) => cap,
    awareness: (cap) => cap * cap,
    coherence: () => 3,
    purchase: (cap) => cap,
    inward: () => 1,
  };

  /** Click ring r of an axis: r points; the held ring again clears it. */
  function setAxis(axis: PsiAxisId, ring: number): void {
    if (!open(axis)) return;
    shape = { ...shape, [axis]: (shape[axis] ?? 0) === ring ? 0 : ring };
  }

  function stepAxis(axis: PsiAxisId, delta: -1 | 1): void {
    const now = shape[axis] ?? 0;
    const next = Math.max(0, Math.min(view.cap, now + delta));
    if (next !== now) shape = { ...shape, [axis]: next };
  }

  function doShape(): void {
    send(shapeCommand({ shape: { ...shape } }));
  }

  // ---- the wheel: 8 wedges, one ring per point ----
  const TAU = Math.PI * 2;
  const R0 = 8;
  const R1 = 38;
  const LABEL_R = 43;
  const N = PSI_AXIS_LIST.length;

  function labelAt(i: number): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
    const mid = -TAU / 4 + ((i + 0.5) * TAU) / N;
    const cos = Math.cos(mid);
    return {
      x: 50 + LABEL_R * cos,
      y: 50 + LABEL_R * Math.sin(mid) + 1.5,
      anchor: cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle',
    };
  }

  function arcPath(i: number, ring: number, rings: number): string {
    const gap = 0.035;
    const a0 = -TAU / 4 + (i * TAU) / N + gap;
    const a1 = -TAU / 4 + ((i + 1) * TAU) / N - gap;
    const step = (R1 - R0) / rings;
    const r0 = R0 + (ring - 1) * step + 0.5;
    const r1 = R0 + ring * step - 0.5;
    const p = (a: number, r: number) => `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
    return `M ${p(a0, r0)} L ${p(a0, r1)} A ${r1} ${r1} 0 0 1 ${p(a1, r1)} L ${p(a1, r0)} A ${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`;
  }

  const rings = $derived(Array.from({ length: view.cap }, (_, r) => r + 1));

  const detailText = $derived.by(() => {
    if (!detail) return null;
    const axis = PSI_AXIS_LIST.find((a) => a.id === detail);
    if (axis) return { head: `${axis.icon} ${axis.name}`, sub: open(axis.id) ? '' : 'Closed: a teacher must open this axis.', body: axis.desc };
    const q = PSI_QUANTITY_LIST.find((x) => x.id === detail);
    if (q) return { head: `${q.icon} ${q.name}`, sub: `Formula: ${q.formula}`, body: q.desc };
    return null;
  });
</script>

<section class="panel" aria-label="Psionic">
  <h2>
    Psionic bench
    <span class="dim num">Psionics {view.level}, cap {view.cap} per axis, tier {view.tier || 'none'}</span>
  </h2>
  {#if !view.unlocked}
    <p class="card dim note">Psionics is shut on this save. Nothing in the game opens it yet.</p>
  {:else if !view.atTable}
    <p class="card dim note">A shape is set at a Spellcrafting Table: {view.tables.join(', ')}.</p>
  {:else}
    <div class="card bench">
      <div class="aim num dim">
        Points: {spent}{#if spent > 0}, aimed {Math.round((1 - reading.inward) * 100)}% outward / {Math.round(reading.inward * 100)}% inward{/if}
      </div>

      <svg class="wheel" viewBox="-22 -3 144 108" role="group" aria-label="Psionic shaping wheel">
        {#each PSI_AXIS_LIST as axis, i (axis.id)}
          {#each rings as ring (ring)}
            <path
              d={arcPath(i, ring, view.cap)}
              class="seg"
              class:held={open(axis.id) && (shape[axis.id] ?? 0) >= ring}
              class:locked={!open(axis.id)}
              style:--axis={axis.color}
              role="button"
              tabindex={open(axis.id) ? 0 : -1}
              aria-label="{axis.name} {ring}"
              onclick={() => setAxis(axis.id, ring)}
              onkeydown={(e) => e.key === 'Enter' && setAxis(axis.id, ring)}
            />
          {/each}
        {/each}
        {#each PSI_AXIS_LIST as axis, i (axis.id)}
          {@const at = labelAt(i)}
          <text class="label" class:locked={!open(axis.id)} x={at.x} y={at.y} text-anchor={at.anchor}>
            {axis.icon} {axis.name} {open(axis.id) ? (shape[axis.id] ?? 0) : '🔒'}
          </text>
        {/each}
      </svg>

      <div class="axes">
        {#each PSI_AXIS_LIST as axis (axis.id)}
          <div class="axis" class:closed={!open(axis.id)}>
            <Button disabled={!open(axis.id) || (shape[axis.id] ?? 0) <= 0} title="Remove a point from {axis.name}" onclick={() => stepAxis(axis.id, -1)}>−</Button>
            <button type="button" class="pick" aria-pressed={detail === axis.id} onclick={() => (detail = detail === axis.id ? null : axis.id)}>
              <span class="dot" style:background={axis.color}></span>
              <span class="clip">{axis.icon} {axis.name}</span>
              <b class="num">{open(axis.id) ? (shape[axis.id] ?? 0) : '🔒'}</b>
            </button>
            <Button disabled={!open(axis.id) || (shape[axis.id] ?? 0) >= view.cap} title="Add a point to {axis.name}" onclick={() => stepAxis(axis.id, 1)}>+</Button>
          </div>
        {/each}
      </div>

      <div class="quantities">
        {#each PSI_QUANTITY_LIST as q (q.id)}
          {@const value = reading[q.id]}
          <button type="button" class="quantity" class:zero={value <= 0} aria-pressed={detail === q.id} onclick={() => (detail = detail === q.id ? null : q.id)}>
            <span class="row"><span class="clip">{q.icon} {q.name}</span><b class="num">{value.toFixed(q.decimals)}</b></span>
            <span class="bar" aria-hidden="true"><span class="fill" style:width="{Math.min(1, value / QUANTITY_MAX[q.id](view.cap)) * 100}%"></span></span>
          </button>
        {/each}
      </div>

      <div class="detail" aria-live="polite">
        {#if detailText}
          <div>{detailText.head}</div>
          {#if detailText.sub}<div class="dim">{detailText.sub}</div>{/if}
          <div class="dim">{detailText.body}</div>
        {:else}
          <div class="dim">Click an axis or a quantity for what it does.</div>
        {/if}
      </div>

      <div class="result" aria-live="polite">
        {#if !check.ok}
          <div class="warn">Refused: {check.reason}</div>
        {:else if preview}
          <div>{preview.icon} {preview.name}</div>
          {#if preview.desc}<div class="dim">{preview.desc}</div>{/if}
          {#each lines as line (line)}<div class="dim">{line}</div>{/each}
        {/if}
        {#if outOfReach}
          <div class="warn">Tier: matches {outOfReach.icon} {outOfReach.name}, which needs teacher tier {outOfReach.tier}. It cannot be shaped yet.</div>
        {/if}
        {#if tooWide !== null}
          <div class="warn">Focus: {tooWide.toFixed(2)} per cast, the pool holds {view.maxFocus}. It shapes and never casts until Charisma raises the pool.</div>
        {/if}
        {#if inBook}
          <div class="dim">Grimoire: this shape is in it already.</div>
        {/if}
      </div>

      <div class="held">
        <div class="dim">Held in mind: {view.memorized.length} / {view.max}. A held shape fills the wheel on click; it is not cast or inscribed.</div>
        <div class="row wrap">
          {#each view.memorized as mem, i (mem.key)}
            <span class="chip" class:active={mem.key === key}>
              <button type="button" class="load clip" title={mem.summary} onclick={() => (shape = { ...mem.shape })}>{mem.name}</button>
              <button type="button" class="drop" aria-label="Forget {mem.name}" onclick={() => send(forgetShape({ index: i }))}>×</button>
            </span>
          {/each}
        </div>
      </div>

      <div class="row wrap">
        <Button variant="primary" disabled={!check.ok || !!outOfReach || inBook} onclick={doShape}>Shape</Button>
        <Button disabled={!check.ok || held || view.memorized.length >= view.max} onclick={() => send(memorize({ shape: { ...shape } }))}>Memorise</Button>
        <Button disabled={spent === 0} onclick={() => (shape = {})}>Clear</Button>
      </div>
    </div>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
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
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .bench {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .note {
    margin: 0;
  }

  .aim {
    height: 1.4em;
    line-height: 1.4em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .wheel {
    display: block;
    width: 100%;
    max-width: 26rem;
    margin: 0 auto;
    aspect-ratio: 144 / 108;
  }

  .seg {
    fill: var(--color-surface-raised);
    stroke: var(--color-border);
    stroke-width: 0.3;
    cursor: pointer;
  }

  .seg.held {
    fill: var(--axis);
  }

  .seg.locked {
    opacity: 0.35;
    cursor: default;
  }

  .seg:focus-visible {
    outline: none;
    stroke: var(--color-accent);
    stroke-width: 0.8;
  }

  .label {
    fill: var(--color-text);
    font-size: 4.2px;
  }

  .label.locked {
    fill: var(--color-text-dim);
  }

  .axes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .axis {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-1);
    align-items: center;
  }

  .closed .pick {
    opacity: 0.6;
  }

  .pick,
  .quantity {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pick[aria-pressed='true'],
  .quantity[aria-pressed='true'] {
    border-color: var(--color-accent);
  }

  .pick .clip {
    flex: 1;
  }

  .dot {
    flex: none;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
  }

  .quantities {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .quantity {
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  .quantity.zero {
    color: var(--color-text-dim);
  }

  .bar {
    display: block;
    height: 0.3rem;
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
  }

  .detail {
    height: 7rem;
    overflow-y: auto;
    font-size: var(--text-sm);
  }

  .result {
    height: 11rem;
    overflow-y: auto;
    font-size: var(--text-sm);
  }

  .held {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: calc(var(--tap) * 2 + var(--space-2) * 2 + 2.8em);
    overflow-y: auto;
  }

  .chip {
    display: inline-flex;
    max-width: 12rem;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
  }

  .chip.active {
    border-color: var(--color-accent);
  }

  .load,
  .drop {
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: none;
    background: none;
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .drop {
    flex: none;
    min-width: var(--tap);
    color: var(--color-text-dim);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  .wrap {
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .clip {
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

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .warn {
    color: var(--color-warn);
  }

  @media (max-width: 30rem) {
    .axes {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
