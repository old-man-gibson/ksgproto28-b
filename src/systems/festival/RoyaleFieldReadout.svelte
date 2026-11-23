<script lang="ts">
  import type { Command, DeepReadonly } from '../../kernel';
  import Button from '../../ui/components/Button.svelte';
  import { ROYALE_SECTIONS } from './royaleData';
  import { royaleMap } from './royaleMap';
  import type { RoyaleFieldView, RoyalePlanView } from './royalePublish';
  import { backToPlanCommand, nudgeCommand, planSlotCommand, walkAt } from './royaleControls';
  import { cameraBox, ISO_K, isoDirection, isoEllipse, isoPoint, sectionCentres } from './royaleView';
  import RoyaleMinimap from './RoyaleMinimap.svelte';

  /**
   * The royale's field, drawn isometrically (old `RoyaleField.svelte`, step
   * 4 port C5). The terrain is the field's map, rebuilt from the view's seed
   * (`royaleMap`), drawn as one image under the ground's transform, with its
   * sections named and the village's buildings outlined. The view follows
   * the player, or shows the whole field, with a minimap of the whole field.
   * Fog: the view carries only the fighters in the player's sight and the
   * radar's target; a cache or a den shows once its section is scouted or
   * stood in, or while it is in sight. A click on the ground sends the player
   * there by hand; the ranked plan below decides every other step. Props
   * only: `FestivalPanel.svelte` passes the game's view and `send`.
   *
   * Layout rule: the four status lines and the map frame have fixed heights;
   * a tick changes text and marks, never the height. The lists of who and
   * what is known scroll inside a fixed box. Differences from the old panel:
   * the fight is shown by the Combat panel, not under the field; no global
   * style rule (the old panel let clicks through every mark with one), so
   * each mark carries the class that lets clicks through.
   */
  interface Props {
    field: DeepReadonly<RoyaleFieldView>;
    plan: DeepReadonly<RoyalePlanView>;
    /** The terrain image (`mapImage.ts`); '' draws none. */
    image: string;
    onSend: (command: Command) => void;
  }

  let { field, plan, image, onSend }: Props = $props();

  const map = $derived(royaleMap(field.seed));
  const size = $derived(map.size);
  const K = ISO_K;
  const iso = isoPoint;

  // ---- camera ----

  let whole = $state(false);
  const me = $derived(iso(field.player.x, field.player.y));
  const view = $derived(cameraBox(me, size, whole));
  const viewBox = $derived(`${view.x} ${view.y} ${view.w} ${view.h}`);

  let boxW = $state(0);
  let boxH = $state(0);
  /** SVG units in one screen pixel. */
  const u = $derived(boxW > 0 && boxH > 0 ? 1 / Math.min(boxW / view.w, boxH / view.h) : 1.4);

  const ground = $derived([iso(0, 0), iso(size, 0), iso(size, size), iso(0, size)].map((p) => `${p.sx},${p.sy}`).join(' '));
  const grid = $derived.by(() => {
    const lines: { a: { sx: number; sy: number }; b: { sx: number; sy: number } }[] = [];
    for (let v = 10; v < size; v += 10) {
      lines.push({ a: iso(v, 0), b: iso(v, size) });
      lines.push({ a: iso(0, v), b: iso(size, v) });
    }
    return lines;
  });

  // ---- terrain ----

  const names = $derived(sectionCentres(map));
  const WALL = 10;
  /** Each building as a box on the ground: its footprint, its roof lifted by WALL, and the three corners facing the viewer. */
  const buildings = $derived(
    [...map.buildings]
      .sort((a, b) => a.x0 + a.y0 - (b.x0 + b.y0))
      .map((b) => {
        const base = [iso(b.x0, b.y0), iso(b.x1, b.y0), iso(b.x1, b.y1), iso(b.x0, b.y1)];
        const roof = base.map((p) => ({ sx: p.sx, sy: p.sy - WALL }));
        const pts = (ps: { sx: number; sy: number }[]) => ps.map((p) => `${p.sx},${p.sy}`).join(' ');
        return { id: b.id, base: pts(base), roof: pts(roof), posts: [base[3], base[2], base[1]] };
      }),
  );
  const sightRing = $derived(isoEllipse(field.sight));

  // ---- radar ----

  const arrow = $derived.by(() => {
    const r = field.radar;
    if (r.state !== 'on' || !r.target) return null;
    const d = isoDirection(r.target.dx, r.target.dy);
    return d ? (Math.atan2(d.uy, d.ux) * 180) / Math.PI : null;
  });
  const radarMark = $derived(field.radar.state === 'on' && field.radar.target ? field.radar.target : null);
  const target = $derived(field.player.target ? iso(field.player.target.x, field.player.target.y) : null);

  // ---- lines ----

  const fieldLine = $derived(`Field: ${field.standing} standing, ${field.bodies.length} on your map.`);
  const fightLine = $derived(
    field.last
      ? `Fights: the champion is the last one left${field.engaged ? '; fighting you' : ''}.`
      : `Fights: ${field.duelling} duelling each other, ${field.engaged} fighting you.`,
  );
  const groundLine = $derived(field.here ? `Ground: ${field.here.name}, pace ${field.here.pace}, sight ${field.here.sight}.` : 'Ground: open meadow.');

  // ---- walking by hand ----

  let svg: SVGSVGElement | undefined = $state();

  /** A screen point in the ground's space, from a mouse event. */
  function groundPoint(target: SVGSVGElement | undefined, e: MouseEvent): { sx: number; sy: number } | null {
    if (!target) return null;
    const ctm = target.getScreenCTM();
    if (!ctm) return null;
    const pt = target.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { sx: p.x, sy: p.y };
  }

  function walk(e: MouseEvent) {
    const p = groundPoint(svg, e);
    const command = p ? walkAt(p.sx, p.sy, size) : null;
    if (command) onSend(command);
  }

  function nudge(e: KeyboardEvent) {
    const command = nudgeCommand(e.key, field.player.target ?? field.player);
    if (!command) return;
    e.preventDefault();
    onSend(command);
  }

  function pickMini(sx: number, sy: number) {
    const command = walkAt(sx, sy, size);
    if (command) onSend(command);
  }

  // ---- the plan ----

  const optionOf = (id: string) => plan.options.find((o) => o.id === id);
  const slots = $derived(Array.from({ length: plan.slots }, (_, i) => i).filter((i) => i <= plan.ids.length));
</script>

<div class="royale" data-testid="royale-field">
  <p class="line" data-testid="royale-field-line">{fieldLine}</p>
  <p class="line" class:hot={field.engaged > 0 || field.last}>{fightLine}</p>
  <p class="line" class:hot={field.radar.state === 'on'} data-testid="royale-radar">{field.radarLine}</p>
  <p class="line ground-line" data-testid="royale-ground">{groundLine}</p>

  <div class="frame">
    <div class="whole">
      <Button pressed={whole} onclick={() => (whole = !whole)}><span data-action="whole-field">Whole field</span></Button>
    </div>
    <svg bind:this={svg} bind:clientWidth={boxW} bind:clientHeight={boxH} {viewBox} class="field" aria-label="The royale field">
      <!-- The ground is the control: everything drawn on it lets clicks through. -->
      <polygon
        class="ground"
        points={ground}
        role="button"
        tabindex="0"
        aria-label="Walk to a point on the field: click the ground, or use the arrow keys"
        data-action="walk"
        onclick={walk}
        onkeydown={nudge}
      />
      {#if image}
        <image class="terrain pass" href={image} x="0" y="0" width={size} height={size} transform="matrix({K} {K / 2} {-K} {K / 2} 0 0)" />
      {/if}
      <polygon class="edge pass" points={ground} stroke-width={2 * u} />
      {#each grid as line, i (i)}
        <line class="gridline pass" x1={line.a.sx} y1={line.a.sy} x2={line.b.sx} y2={line.b.sy} stroke-width={u} />
      {/each}

      {#each buildings as b (b.id)}
        <g class="building pass" stroke-width={1.5 * u}>
          <polygon class="base" points={b.base} />
          {#each b.posts as p, i (i)}
            <line x1={p.sx} y1={p.sy} x2={p.sx} y2={p.sy - WALL} />
          {/each}
          <polygon class="roof" points={b.roof} />
        </g>
      {/each}

      {#each names as n (n.id)}
        {@const p = iso(n.x, n.y)}
        <text class="name pass" transform="translate({p.sx} {p.sy}) scale({u})" text-anchor="middle">{ROYALE_SECTIONS[n.id]?.name ?? n.id}</text>
      {/each}

      {#each field.features as f (f.kind + f.id)}
        {@const p = iso(f.x, f.y)}
        {#if f.kind === 'den' && !f.spent && f.radius}
          {@const ring = isoEllipse(f.radius)}
          <ellipse
            class="den-ring pass"
            class:den-fight={f.fight}
            cx={p.sx}
            cy={p.sy}
            rx={ring.rx}
            ry={ring.ry}
            stroke-width={1.5 * u}
            stroke-dasharray="{5 * u} {4 * u}"
          />
        {/if}
        <g class="pass" class:spent={f.spent} transform="translate({p.sx} {p.sy}) scale({u})">
          <ellipse class="shadow" rx="8" ry="4" />
          <text class="feature" y="-3" text-anchor="middle">{f.icon}</text>
        </g>
      {/each}

      <ellipse class="sight pass" cx={me.sx} cy={me.sy} rx={sightRing.rx} ry={sightRing.ry} stroke-width={1.5 * u} stroke-dasharray="{3 * u} {6 * u}" />

      {#if target}
        <line class="path pass" x1={me.sx} y1={me.sy} x2={target.sx} y2={target.sy} stroke-width={1.5 * u} stroke-dasharray="{4 * u} {4 * u}" />
        <text class="flag pass" transform="translate({target.sx} {target.sy}) scale({u})" text-anchor="middle">🚩</text>
      {/if}

      {#each field.bodies as f (f.id)}
        {@const p = iso(f.x, f.y)}
        <g class="pass" class:duel={f.duel} class:engaged={f.engaged} transform="translate({p.sx} {p.sy}) scale({u})">
          <ellipse class="shadow" rx="9" ry="4.5" />
          {#if f.duel || f.engaged}<ellipse class="ring" rx="12" ry="6" />{/if}
          {#if f.radar}<ellipse class="ring radar-ring" rx="15" ry="7.5" />{/if}
          <text class="sprite" y="-4" text-anchor="middle" opacity={0.55 + 0.45 * f.hp}>{f.icon}</text>
        </g>
      {/each}

      {#if arrow !== null}
        <g class="arrow pass" transform="translate({me.sx} {me.sy}) scale({u}) rotate({arrow})">
          <line x1="30" y1="0" x2="76" y2="0" />
          <polygon points="86,0 72,-7 72,7" />
        </g>
      {/if}
      <g class="you pass" transform="translate({me.sx} {me.sy}) scale({u})">
        <ellipse class="ring" rx="15" ry="7.5" />
        <text class="sprite" y="-6" text-anchor="middle">🧍</text>
        <text class="you-label" y="-36" text-anchor="middle">you</text>
      </g>
    </svg>

    <svg class="compass" viewBox="0 0 48 48" aria-hidden="true">
      <polygon points="24,9 39,24 24,39 9,24" />
      <text x="38" y="12" text-anchor="middle">N</text>
      <text x="38" y="43" text-anchor="middle">E</text>
      <text x="10" y="43" text-anchor="middle">S</text>
      <text x="10" y="12" text-anchor="middle">W</text>
    </svg>

    <div class="minimap">
      <RoyaleMinimap
        {map}
        {image}
        features={field.features}
        player={field.player}
        radar={radarMark}
        {view}
        onpick={pickMini}
        label="Minimap of the whole field: click a point to walk there"
      />
    </div>
  </div>

  <details class="known">
    <summary>In sight: {field.sighted.length}</summary>
    <ul class="list">
      {#each field.sighted as s (s.id)}
        <li>{s.icon} {s.name}: {s.weapon}{s.tools ? `, ${s.tools} found` : ''}{s.engaged ? ', fighting you' : ''}</li>
      {/each}
    </ul>
  </details>

  <details class="known">
    <summary>Known on this field: {field.features.length}</summary>
    <ul class="list">
      {#each field.features as f (f.kind + f.id)}
        <li class:dim={f.spent}>
          {f.icon} {f.name}: {f.kind}{f.kind === 'den' ? (f.spent ? ', cleared' : '') : f.spent ? ', taken' : f.shut ? `, shut until ${f.guardName} is cleared` : ''}
          ({f.sectionName})
        </li>
      {/each}
    </ul>
  </details>

  <div class="plan">
    <p class="desc">
      <strong>Plan.</strong> The first strategy whose condition holds decides where you walk. A plan alone can win; a click
      on the field sends you there by hand, and the plan takes over again when you arrive.
    </p>
    {#each slots as i (i)}
      <label class="slot">
        <span class="dim">{i + 1}.</span>
        <select
          value={plan.ids[i] ?? ''}
          data-action="plan-{i + 1}"
          onchange={(e) => onSend(planSlotCommand(plan.ids, i, e.currentTarget.value))}
        >
          <option value="">None</option>
          {#each plan.options as s (s.id)}
            <option value={s.id} disabled={plan.ids.includes(s.id) && plan.ids[i] !== s.id}>{s.icon} {s.name} ({s.when})</option>
          {/each}
        </select>
      </label>
      {#if plan.ids[i] && optionOf(plan.ids[i])}
        <p class="dim strategy">{optionOf(plan.ids[i])?.desc}</p>
      {/if}
    {/each}
    <div class="row">
      <Button disabled={!plan.target} onclick={() => onSend(backToPlanCommand())}><span data-action="back-to-plan">Back to the plan</span></Button>
      <span class="dim">{plan.target ? 'Walking to a point set by hand.' : 'Walking by the plan.'}</span>
    </div>
  </div>

  <p class="line" data-testid="royale-fight">{field.fighting ? 'Fight: open; the Combat panel shows it.' : 'Fight: none.'}</p>
</div>

<style>
  .royale {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    container-type: inline-size;
  }

  /* The ground's name and numbers need two lines on a narrow panel: two fixed lines there. */
  @container (max-width: 520px) {
    .line.ground-line {
      height: 3rem;
      white-space: normal;
    }
  }

  /* "Whole field", over the map's top right corner; the compass is top left, the minimap bottom right. */
  .whole {
    position: absolute;
    top: 6px;
    right: 8px;
  }

  /* One line each, always present: the text changes, the height does not. */
  .line {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hot {
    color: var(--color-accent);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .desc {
    margin: var(--space-1) 0;
  }

  .frame {
    position: relative;
    container-type: inline-size;
  }

  .field {
    display: block;
    width: 100%;
    height: clamp(12rem, 50vw, 26rem);
    background: var(--color-bg);
    border: var(--border);
    border-radius: var(--radius);
    user-select: none;
  }

  /* Only the ground takes clicks; what stands on it lets them through. */
  .pass,
  .pass * {
    pointer-events: none;
  }

  .ground {
    fill: var(--color-surface);
    cursor: crosshair;
    outline: none;
  }

  .ground:focus-visible ~ .edge {
    stroke: var(--color-accent);
    stroke-width: 3;
  }

  .terrain {
    image-rendering: pixelated;
  }

  .edge {
    fill: none;
    stroke: var(--color-border);
  }

  .gridline {
    stroke: var(--color-text);
    opacity: 0.07;
  }

  .building {
    fill: none;
    stroke: var(--color-text-dim);
  }

  .building .base {
    fill: color-mix(in srgb, var(--color-bg) 55%, transparent);
  }

  .building .roof {
    fill: color-mix(in srgb, var(--color-surface-raised) 80%, transparent);
  }

  .name {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    fill: var(--color-text);
    opacity: 0.7;
    paint-order: stroke;
    stroke: var(--color-bg);
    stroke-width: 3px;
    stroke-linejoin: round;
  }

  .feature {
    font-size: 18px;
  }

  .spent {
    opacity: 0.35;
  }

  .den-ring {
    fill: color-mix(in srgb, var(--color-danger) 8%, transparent);
    stroke: var(--color-danger);
    opacity: 0.55;
  }

  .den-fight {
    opacity: 1;
  }

  .sight {
    fill: none;
    stroke: var(--color-text);
    opacity: 0.25;
  }

  .path {
    stroke: var(--color-accent);
  }

  .flag {
    font-size: 20px;
  }

  .shadow {
    fill: var(--color-overlay);
  }

  .ring {
    fill: none;
    stroke-width: 2px;
  }

  .duel .ring {
    stroke: var(--color-danger);
  }

  .engaged .ring {
    stroke: var(--color-warn);
  }

  .ring.radar-ring {
    stroke: var(--color-danger);
    stroke-dasharray: 4 3;
  }

  .you .ring {
    stroke: var(--color-accent);
    stroke-width: 2.5px;
  }

  .sprite {
    font-size: 18px;
  }

  .you .sprite {
    font-size: 28px;
  }

  .you-label {
    font-size: 13px;
    font-weight: 600;
    fill: var(--color-accent);
    paint-order: stroke;
    stroke: var(--color-bg);
    stroke-width: 3px;
  }

  .arrow line {
    stroke: var(--color-danger);
    stroke-width: 3px;
    stroke-linecap: round;
  }

  .arrow polygon {
    fill: var(--color-danger);
    stroke: var(--color-bg);
    stroke-width: 1px;
  }

  .compass {
    position: absolute;
    top: 6px;
    left: 8px;
    width: 52px;
    height: 52px;
    pointer-events: none;
  }

  .compass polygon {
    fill: none;
    stroke: var(--color-text-dim);
    stroke-width: 1;
    opacity: 0.6;
  }

  .compass text {
    font-size: 9px;
    font-weight: 600;
    fill: var(--color-text-dim);
  }

  .minimap {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: clamp(120px, 28%, 220px);
    opacity: 0.94;
  }

  /* A narrow map has no room to spare: the minimap goes under it instead of over it. */
  @container (max-width: 520px) {
    .minimap {
      position: static;
      width: min(100%, 240px);
      margin: var(--space-2) auto 0;
      opacity: 1;
    }
  }

  .known summary {
    min-height: var(--tap);
    line-height: var(--tap);
    cursor: pointer;
  }

  /* A fixed box: the lists change every tick, the height does not. */
  .list {
    height: 8rem;
    margin: var(--space-1) 0 0;
    padding-left: var(--space-4);
    overflow-y: auto;
    font-size: var(--text-sm);
  }

  .plan {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .slot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .slot select {
    flex: 1;
    min-width: 0;
    min-height: var(--tap);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: var(--border);
    border-radius: var(--radius);
  }

  .strategy {
    margin: 0 0 0 var(--space-4);
  }
</style>
