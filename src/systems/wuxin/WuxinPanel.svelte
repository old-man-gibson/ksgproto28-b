<script lang="ts">
  import { untrack } from 'svelte';
  import Button from '../../ui/components/Button.svelte';
  import {
    alignment,
    classify,
    discord,
    eligibleElements,
    formatWuxin,
    harmonyDistance,
    HINDERS,
    landmarks,
    NOURISHES,
    SEVERED,
    shapeOf,
    validateWuxin,
    type WuxinConfig,
    type WuxinRelation,
  } from './cycle';
  import {
    CLASSICAL,
    clone,
    connect,
    edgesOf,
    FULL,
    INNER_RIM,
    K_NOTE,
    KIND_NOTE,
    nameOf,
    NODE_R,
    pct,
    preset,
    PRESETS,
    problemText,
    readout,
    RIM,
    SANDBOX_CHARGE,
    SANDBOX_HABIT,
    seats,
    setArrow,
    setElement,
    tapSeat,
    toward,
    VIEW,
    wordOf,
  } from './sandbox';

  /**
   * The wuxin cycle, to look at (old `WuxinPanel.svelte`). A sandbox: nothing
   * here reads or writes the save. Rewire it, break it, read what it calls
   * itself. Every edit is a function of `sandbox.ts`; this file holds the
   * state and the drawing.
   *
   * The props set the starting state, for a test rendering on the server; the
   * navigation mounts the panel with none.
   *
   * Differences from the old panel: the readout follows the picked element
   * only (the old one also followed the pointer: controls here answer clicks,
   * not hover); Escape drops a pick or a drag (the old overlay stack also took
   * the Android back button, which this build has no shell for).
   */
  interface Props {
    cfg?: WuxinConfig;
    picked?: number | null;
    aim?: WuxinRelation;
    relaxed?: boolean;
  }

  let props: Props = $props();

  let cfg = $state<WuxinConfig>(untrack(() => clone(props.cfg ?? CLASSICAL)));
  let picked = $state<number | null>(untrack(() => props.picked ?? null));
  /** Which arrow a tap or a drag draws; Shift on a drag overrides it for that drag. */
  let aim = $state<WuxinRelation>(untrack(() => props.aim ?? 'nourishes'));
  /** Out of combat, dispersing harmlessly: a full node rests instead of leaking. */
  let relaxed = $state(untrack(() => props.relaxed ?? false));
  /** Sandbox values: charge against capacity and habituation per slot. Nothing feeds them. */
  let charge = $state<number[]>([...SANDBOX_CHARGE]);
  let habit = $state<number[]>([...SANDBOX_HABIT]);

  const elements = $derived(cfg.slots.map((s) => s.element));
  const problems = $derived(validateWuxin(cfg));
  const kind = $derived(classify(cfg));
  const off = $derived(discord(cfg));
  const gen = $derived(shapeOf(cfg, 'nourishes'));
  const des = $derived(shapeOf(cfg, 'hinders'));
  const k = $derived(alignment(cfg));
  const far = $derived(harmonyDistance(cfg));
  const marks = $derived(landmarks(cfg));
  const SEATS = $derived(seats(cfg.slots.length));
  const genEdges = $derived(edgesOf(cfg, 'nourishes', SEATS));
  const desEdges = $derived(edgesOf(cfg, 'hinders', SEATS));
  const choices = eligibleElements();

  const isFull = (i: number) => charge[i] >= FULL;
  const isJaded = (i: number) => habit[i] >= FULL;
  /** Full and under pressure: the only state that moves. */
  const isStrained = (i: number) => isFull(i) && !relaxed;
  const list = (ids: string[]) => ids.map(nameOf).join(', ');

  // ---------- Drawing arrows by hand ----------
  //
  // Click and target: click an element (it is picked), then the element it
  // should act on. The Nourishes / Hinders switch says which arrow; Sever cuts
  // the picked element's arrow of that kind; clicking the picked element again,
  // or open ground, drops the pick.
  //
  // Drag: drag a node onto another to make it nourish it; hold Shift (or set
  // the switch to Hinders) to make it hinder it. Dropping on open ground, or
  // back on the starting element after moving, severs that arrow. A press that
  // never moved is a click. The lists in the clause table stay the keyboard path.

  let svgEl = $state<SVGSVGElement | null>(null);
  let drag = $state<{
    from: number;
    x: number;
    y: number;
    hinders: boolean;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  /** Travel under this many client pixels is a click. */
  const TAP_SLOP = 8;

  function toSvg(e: PointerEvent): { x: number; y: number } {
    const ctm = svgEl?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  /** Which seat the pointer is over, or null for open ground. */
  function seatUnder(at: { x: number; y: number }): number | null {
    for (let i = 0; i < SEATS.length; i++) {
      if (Math.hypot(SEATS[i].x - at.x, SEATS[i].y - at.y) <= NODE_R) return i;
    }
    return null;
  }

  function startDrag(e: PointerEvent, from: number): void {
    e.preventDefault();
    const at = toSvg(e);
    drag = { from, x: at.x, y: at.y, hinders: e.shiftKey || aim === 'hinders', startX: e.clientX, startY: e.clientY, moved: false };
  }

  function moveDrag(e: PointerEvent): void {
    if (!drag) return;
    const at = toSvg(e);
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= TAP_SLOP;
    drag = { ...drag, x: at.x, y: at.y, hinders: e.shiftKey || aim === 'hinders', moved };
  }

  function endDrag(e: PointerEvent): void {
    if (!drag) return;
    const { from, hinders, moved } = drag;
    const onto = seatUnder(toSvg(e));
    drag = null;
    if (!moved && onto === from) {
      tap(from);
      return;
    }
    picked = null;
    cfg = connect(cfg, from, onto, hinders ? 'hinders' : 'nourishes');
  }

  function tap(seat: number): void {
    const next = tapSeat(cfg, picked, seat, aim);
    cfg = next.cfg;
    picked = next.picked;
  }

  /** Cut the picked element's arrow of the chosen kind. */
  function severPicked(): void {
    if (picked === null) return;
    const from = picked;
    picked = null;
    cfg = connect(cfg, from, null, aim);
  }

  /** A click on open ground, not on a seat, drops the pick. */
  function groundTap(e: MouseEvent): void {
    if (picked !== null && !(e.target as Element).closest('.node')) picked = null;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || (picked === null && drag === null)) return;
    picked = null;
    drag = null;
  }

  const dragPath = $derived.by(() => {
    if (!drag) return null;
    const a = SEATS[drag.from];
    const to = { x: drag.x, y: drag.y };
    const s = toward(a, to, NODE_R);
    return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
  });
</script>

<!--
  The drag is tracked on the window: releasing outside the graph is a drop on
  open ground (sever), and the gesture cannot be stranded by the pointer
  leaving the picture mid-drag.
-->
<svelte:window onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={() => (drag = null)} onkeydown={onKey} />

<section class="wuxin" data-testid="wuxin">
  <header>
    <div>
      <h2>☯️ Wuxin</h2>
      <span class="chip dim">sandbox — nothing here touches your save</span>
    </div>
    <div class="presets">
      {#each PRESETS as p (p.id)}
        <span data-action="preset-{p.id}"><Button onclick={() => (cfg = preset(p.id))}>{p.label}</Button></span>
      {/each}
    </div>
  </header>

  <div class="board">
    <div class="graph-wrap">
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <svg bind:this={svgEl} viewBox="0 0 {VIEW} {VIEW}" class="graph" class:dragging={drag !== null} aria-label="Wuxin cycle" onclick={groundTap}>
        <defs>
          <marker id="wx-gen" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" class="head gen" />
          </marker>
          <marker id="wx-des" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" class="head des" />
          </marker>
        </defs>

        {#each desEdges as e (e.key)}
          <path class="edge des" class:hot={picked === e.from} d={e.d} marker-end="url(#wx-des)" />
        {/each}
        {#each genEdges as e (e.key)}
          <path class="edge gen" class:hot={picked === e.from} d={e.d} marker-end="url(#wx-gen)" />
        {/each}

        {#if dragPath}
          <path class="edge rubber" class:des={drag?.hinders} class:gen={!drag?.hinders} d={dragPath} />
        {/if}

        {#each cfg.slots as slot, i (i)}
          <g
            class="node"
            class:source={drag?.from === i}
            class:picked={picked === i}
            role="presentation"
            data-action="seat-{i}"
            onpointerdown={(e) => startDrag(e, i)}
          >
            <!-- The pulse ring sits under the node and exists only while the element is full under pressure. -->
            {#if isStrained(i)}
              <circle class="pulse" cx={SEATS[i].x} cy={SEATS[i].y} r={NODE_R} />
            {/if}
            <circle cx={SEATS[i].x} cy={SEATS[i].y} r={NODE_R} />
            <!-- Charge as an arc round the rim from the top, clockwise: a dash on a rotated circle. -->
            <circle
              class="fill"
              class:full={isStrained(i)}
              cx={SEATS[i].x}
              cy={SEATS[i].y}
              r={NODE_R}
              stroke-dasharray="{RIM * charge[i]} {RIM}"
              transform="rotate(-90 {SEATS[i].x} {SEATS[i].y})"
            />
            {#if habit[i] > 0.02}
              <circle
                class="jaded"
                class:full={isJaded(i)}
                cx={SEATS[i].x}
                cy={SEATS[i].y}
                r={NODE_R - 5}
                stroke-dasharray="{INNER_RIM * habit[i]} {INNER_RIM}"
                transform="rotate(-90 {SEATS[i].x} {SEATS[i].y})"
              />
            {/if}
            <text class="node-icon" x={SEATS[i].x} y={SEATS[i].y - 3}>{wordOf(slot.element)?.icon ?? '❓'}</text>
            <text class="node-name" x={SEATS[i].x} y={SEATS[i].y + 15}>{nameOf(slot.element)}</text>
            <title>{nameOf(slot.element)} — charge {pct(charge[i])}, habituation {pct(habit[i])}</title>
          </g>
        {/each}
      </svg>

      <p class="legend">
        <span class="key gen">{NOURISHES} nourishes</span>
        <span class="key des">{HINDERS} hinders</span>
        <span class="dim">generation rides the outside; destruction crosses the middle</span>
      </p>

      <!-- The click path's controls. Always drawn; Sever and Drop pick are disabled while nothing is picked. -->
      <div class="draw">
        <div class="aim" role="group" aria-label="Arrow to draw">
          <span data-action="aim-nourishes">
            <Button pressed={aim === 'nourishes'} onclick={() => (aim = 'nourishes')}>{NOURISHES} Nourishes</Button>
          </span>
          <span data-action="aim-hinders">
            <Button pressed={aim === 'hinders'} onclick={() => (aim = 'hinders')}>{HINDERS} Hinders</Button>
          </span>
        </div>
        <div class="aim">
          <span data-action="sever"><Button disabled={picked === null} onclick={severPicked}>Sever</Button></span>
          <span data-action="drop-pick"><Button disabled={picked === null} onclick={() => (picked = null)}>Drop pick</Button></span>
        </div>
        <p class="pick-status small" class:dim={picked === null} aria-live="polite">
          {#if picked === null}
            Pick an element, then the element it should {aim === 'hinders' ? 'hinder' : 'nourish'}.
          {:else}
            {wordOf(cfg.slots[picked].element)?.icon} {nameOf(cfg.slots[picked].element)} is picked: pick the element it should
            {aim === 'hinders' ? 'hinder' : 'nourish'}, or Sever its {aim === 'hinders' ? 'hinders' : 'nourishes'} arrow.
          {/if}
        </p>
      </div>
      <p class="legend dim">With a mouse: drag one element onto another, <kbd>Shift</kbd>-drag to hinder, drop on open ground to sever.</p>

      <!-- The readout of the picked element, in a box of fixed height. -->
      <div class="detail" class:idle={picked === null}>
        {#if picked === null}
          <span class="dim">Pick an element for what it is holding.</span>
        {:else}
          {@const slot = cfg.slots[picked]}
          <div class="detail-head">
            <b>{wordOf(slot.element)?.icon} {nameOf(slot.element)}</b>
            <span class="chip" class:warn={isStrained(picked)}>charge {pct(charge[picked])}</span>
            <span class="chip" class:warn={isJaded(picked)}>habituation {pct(habit[picked])}</span>
          </div>
          {#each readout(cfg, picked, charge[picked], habit[picked], relaxed) as line, n (n)}
            <p>{line}</p>
          {/each}
        {/if}
      </div>

      <label class="relaxed" data-action="relaxed">
        <input type="checkbox" bind:checked={relaxed} />
        <span>Relaxed — out of combat, dispersing harmlessly. Full nodes rest instead of leaking.</span>
      </label>

      <details class="sandbox">
        <summary>sandbox values — nothing feeds these yet</summary>
        <div class="sliders">
          {#each cfg.slots as slot, i (i)}
            <label>
              <span>{wordOf(slot.element)?.icon}</span>
              <input type="range" min="0" max="1" step="0.01" bind:value={charge[i]} aria-label="{nameOf(slot.element)} charge" data-action="charge-{i}" />
              <input
                type="range"
                class="jaded-slider"
                min="0"
                max="1"
                step="0.01"
                bind:value={habit[i]}
                aria-label="{nameOf(slot.element)} habituation"
                data-action="habit-{i}"
              />
            </label>
          {/each}
        </div>
        <p class="dim small">Outer ring is charge, inner ring is habituation.</p>
      </details>
    </div>

    <div class="side">
      <div class="verdict" class:bad={problems.length > 0} data-testid="verdict">
        <strong>{kind}</strong>
        {#if k !== null}
          <span class="chip" class:good={far === 0}>hinders = nourishes<sup>{k}</sup></span>
          <span class="chip" class:good={far === 0}>{far === 0 ? 'the classical relation' : `${far} from harmony`}</span>
        {:else}
          <span class="chip dim">unaligned</span>
        {/if}
        <p>{KIND_NOTE[kind]}</p>
        {#if k !== null}
          <p class="small dim">{K_NOTE[k] ?? 'a regular relation with no name yet'}</p>
        {:else}
          <p class="dim small">
            No single power of generation reaches destruction — the two rings are unrelated, so there is no distance to report.
          </p>
        {/if}

        {#if marks.orphans.length || marks.pivot || marks.sinks.length || marks.sources.length || marks.doubled.length}
          <ul class="marks">
            {#if marks.pivot}
              <li><b>pivot</b> — {nameOf(marks.pivot)} is in both triangles and neither pair: the only element in no mutual bond of either kind</li>
            {/if}
            {#each marks.orphans as e (e)}
              <li><b>orphan</b> — {nameOf(e)} has no arrows at all, in or out</li>
            {/each}
            {#each marks.sinks as e (e)}
              <li><b>sink</b> — both lines end at {nameOf(e)}, which passes nothing on</li>
            {/each}
            {#each marks.sources as e (e)}
              <li><b>source</b> — both lines start at {nameOf(e)}, which nothing reaches</li>
            {/each}
            {#if marks.doubled.length}
              <li>
                <b>doubled</b> — {list(marks.doubled)} feed{marks.doubled.length === 1 ? 's' : ''} and fight{marks.doubled.length === 1 ? 's' : ''} the same thing
              </li>
            {/if}
          </ul>
        {/if}

        <p class="dim small">
          generation: {gen.cycles.length} loop{gen.cycles.length === 1 ? '' : 's'}, {gen.chains.length} chain{gen.chains.length === 1 ? '' : 's'},
          {gen.severed} cut · destruction: {des.cycles.length} loop{des.cycles.length === 1 ? '' : 's'}, {des.severed} cut
        </p>
        <!-- Discord is a yes or no about the classical relation, not a gradient; the exponent above is. -->
        <p class="dim small">
          {off === 0 ? 'every slot matches the classical relation' : `${off} of ${cfg.slots.length} slots differ from the classical relation`}
        </p>
      </div>

      <ul class="problems" data-testid="problems">
        {#each problems as p, i (i)}
          <li>{problemText(p)}</li>
        {/each}
      </ul>

      <table class="clauses">
        <tbody>
          {#each cfg.slots as slot, i (i)}
            <tr class:hot={picked === i}>
              <td>
                <select value={slot.element} onchange={(e) => (cfg = setElement(cfg, i, e.currentTarget.value))} data-action="element-{i}" aria-label="Element {i + 1}">
                  {#each choices as id (id)}
                    <option value={id}>{wordOf(id)?.icon} {nameOf(id)}</option>
                  {/each}
                </select>
              </td>
              <td class="arrow gen">{NOURISHES}</td>
              <td>
                <select
                  value={slot.nourishes ?? SEVERED}
                  onchange={(e) => (cfg = setArrow(cfg, i, 'nourishes', e.currentTarget.value))}
                  data-action="nourishes-{i}"
                  aria-label="{nameOf(slot.element)} nourishes"
                >
                  <option value={SEVERED}>{SEVERED} severed</option>
                  {#each elements as id (id)}
                    <option value={id}>{nameOf(id)}</option>
                  {/each}
                </select>
              </td>
              <td class="arrow des">{HINDERS}</td>
              <td>
                <select
                  value={slot.hinders ?? SEVERED}
                  onchange={(e) => (cfg = setArrow(cfg, i, 'hinders', e.currentTarget.value))}
                  data-action="hinders-{i}"
                  aria-label="{nameOf(slot.element)} hinders"
                >
                  <option value={SEVERED}>{SEVERED} severed</option>
                  {#each elements as id (id)}
                    <option value={id}>{nameOf(id)}</option>
                  {/each}
                </select>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <pre class="grammar">{formatWuxin(cfg)}</pre>
      <p class="dim small">The grammar above is the whole authored form — a sect, a master or a great beast is five of these lines and nothing else.</p>
    </div>
  </div>
</section>

<style>
  .wuxin {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  header h2 {
    display: inline;
    margin: 0 var(--space-2) 0 0;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .board {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-start;
  }
  .graph-wrap {
    flex: 1 1 380px;
    min-width: min(320px, 100%);
  }
  .graph {
    display: block;
    width: 100%;
    height: auto;
    background: var(--color-surface);
    border: var(--border);
    border-radius: var(--radius);
  }
  .side {
    flex: 1 1 320px;
    min-width: min(300px, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .edge {
    fill: none;
    stroke-width: 2;
    opacity: 0.75;
  }
  .edge.gen {
    stroke: var(--color-ok);
  }
  .edge.des {
    stroke: var(--color-danger);
    stroke-dasharray: 5 4;
    opacity: 0.5;
  }
  .edge.hot {
    opacity: 1;
    stroke-width: 3;
  }
  .edge.rubber {
    opacity: 1;
    stroke-width: 3;
    stroke-dasharray: 2 5;
    stroke-linecap: round;
    pointer-events: none;
  }
  .head.gen {
    fill: var(--color-ok);
  }
  .head.des {
    fill: var(--color-danger);
  }

  .graph.dragging {
    cursor: grabbing;
  }
  .node {
    cursor: grab;
    touch-action: none;
  }
  .node circle {
    fill: var(--color-surface-raised);
    stroke: var(--color-border);
    stroke-width: 2;
  }
  .node.source circle,
  .node.picked circle {
    stroke: var(--color-accent);
    stroke-width: 3;
  }
  .node .fill {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 4;
    stroke-linecap: round;
    opacity: 0.85;
  }
  .node .fill.full {
    stroke: var(--color-warn);
  }
  .node .jaded {
    fill: none;
    stroke: var(--color-text-dim);
    stroke-width: 2;
    stroke-linecap: round;
    opacity: 0.7;
  }
  .node .jaded.full {
    stroke: var(--color-danger);
    opacity: 0.9;
  }
  /* A full node under pressure breathes; nothing else on the graph moves. */
  .node .pulse {
    fill: none;
    stroke: var(--color-warn);
    stroke-width: 2;
    transform-box: fill-box;
    transform-origin: center;
    animation: wx-breathe 2.2s ease-in-out infinite;
  }
  @keyframes wx-breathe {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.22);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .node .pulse {
      animation: none;
      opacity: 0.5;
    }
  }
  .node text {
    text-anchor: middle;
    pointer-events: none;
  }
  .node-icon {
    font-size: 1.1rem;
  }
  .node-name {
    font-size: 0.62rem;
    fill: var(--color-text-dim);
  }

  .draw {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-top: var(--space-2);
  }
  .aim {
    display: flex;
    gap: var(--space-1);
  }
  .pick-status {
    flex: 1 1 100%;
    margin: 0;
    /* Two lines at phone width, so a pick moves nothing below it. */
    height: 4.4em;
    overflow: hidden;
  }

  .detail {
    box-sizing: border-box;
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    font-size: var(--text-sm);
    /* A head and four lines, so a pick moves nothing below it. */
    height: 9rem;
    overflow-y: auto;
  }
  .detail.idle {
    font-style: italic;
  }
  .detail-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-1);
  }
  .detail p {
    margin: var(--space-1) 0 0;
  }

  .relaxed {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .relaxed input {
    width: 22px;
    height: 22px;
    flex: none;
  }
  .sandbox {
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }
  .sandbox summary {
    min-height: var(--tap);
    line-height: var(--tap);
    cursor: pointer;
  }
  .sliders {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: var(--space-1) 0;
  }
  .sliders label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .sliders input {
    flex: 1 1 auto;
    min-width: 60px;
    min-height: var(--tap);
    accent-color: var(--color-accent);
  }
  .sliders input.jaded-slider {
    accent-color: var(--color-text-dim);
  }
  kbd {
    padding: 0 var(--space-1);
    border: var(--border);
    border-radius: 3px;
    background: var(--color-surface-raised);
    font-size: 0.7rem;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }
  .key.gen {
    color: var(--color-ok);
  }
  .key.des {
    color: var(--color-danger);
  }

  .verdict {
    box-sizing: border-box;
    /* Room for the longest verdict: the notes, five landmarks and the two counts. */
    min-height: 16rem;
    padding: var(--space-2) var(--space-3);
    border: var(--border);
    border-left: 3px solid var(--color-ok);
    border-radius: var(--radius);
    background: var(--color-surface);
  }
  .verdict.bad {
    border-left-color: var(--color-danger);
  }
  .verdict strong {
    text-transform: capitalize;
    margin-right: var(--space-1);
  }
  .verdict p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }

  .chip {
    display: inline-block;
    padding: 0.05rem var(--space-2);
    border: var(--border);
    border-radius: 10px;
    background: var(--color-surface-raised);
    font-size: 0.72rem;
  }
  .chip.good {
    color: var(--color-ok);
    border-color: var(--color-ok);
  }
  .chip.warn {
    color: var(--color-warn);
    border-color: var(--color-warn);
  }

  .marks {
    margin: var(--space-1) 0 0;
    padding-left: 1.1rem;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }
  .marks b {
    color: var(--color-warn);
    font-weight: 600;
  }

  .problems {
    /* Two lines reserved: an illegal edit moves nothing below it. */
    min-height: 2.6em;
    margin: 0;
    padding-left: 1.1rem;
    color: var(--color-danger);
    font-size: var(--text-sm);
  }

  .clauses {
    width: 100%;
    border-collapse: collapse;
  }
  .clauses tr.hot {
    outline: 1px solid var(--color-accent);
  }
  .clauses td {
    padding: 0.15rem 0.2rem;
  }
  .clauses select {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--tap);
    padding: 0.15rem 0.25rem;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
  }
  .arrow {
    width: 1.4rem;
    text-align: center;
    font-weight: 700;
  }
  .arrow.gen {
    color: var(--color-ok);
  }
  .arrow.des {
    color: var(--color-danger);
  }

  .grammar {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    overflow-x: auto;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .small {
    font-size: var(--text-sm);
  }
  .dim {
    color: var(--color-text-dim);
  }
</style>
