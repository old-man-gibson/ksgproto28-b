<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import type { RoyaleMap } from './royaleMap';
  import { ROYALE_SECTIONS } from './royaleData';
  import { fieldBounds, ISO_K, isoPoint, sectionCentres, type FieldFeature, type ViewBox } from './royaleView';

  /**
   * The whole royale field in miniature (old `RoyaleMinimap.svelte`, step 4
   * port C5), drawn on the same isometric ground as the main map so a point
   * sits in the same direction on both. The terrain is the main map's
   * image; features, the player, the radar's target and the main view's
   * outline sit over it. Given `onpick`, a click on it names a point on the
   * field (in the ground's screen space; the caller turns it into a field
   * point); without it the map is read-only (the hub's preview). Marks are
   * sized in screen pixels. Props only.
   */
  interface Props {
    map: RoyaleMap;
    /** The terrain image (`mapImage.ts`); '' draws none. */
    image: string;
    features?: readonly DeepReadonly<FieldFeature>[];
    player?: { x: number; y: number };
    radar?: { x: number; y: number } | null;
    /** The main view's outline, in the ground's screen space. */
    view?: ViewBox;
    /** Features as their icons rather than dots. */
    icons?: boolean;
    /** Each section's name at its centre. */
    labels?: boolean;
    onpick?: (sx: number, sy: number) => void;
    label: string;
  }
  let { map, image, features = [], player, radar = null, view, icons = false, labels = false, onpick, label }: Props = $props();

  const K = ISO_K;
  const box = $derived(fieldBounds(map.size, K, 8));
  const viewBox = $derived(`${box.x} ${box.y} ${box.w} ${box.h}`);
  const ground = $derived(
    [isoPoint(0, 0), isoPoint(map.size, 0), isoPoint(map.size, map.size), isoPoint(0, map.size)]
      .map((p) => `${p.sx},${p.sy}`)
      .join(' '),
  );
  const names = $derived(labels ? sectionCentres(map) : []);

  let svg: SVGSVGElement | undefined = $state();
  let width = $state(0);
  /** SVG units in one screen pixel, so a mark keeps its pixel size at any width. */
  const u = $derived(width > 0 ? box.w / width : 8);

  function pick(e: MouseEvent) {
    if (!svg || !onpick) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    onpick(p.x, p.y);
  }
</script>

<svg bind:this={svg} bind:clientWidth={width} {viewBox} class="mini" class:live={!!onpick} aria-label={label} role="img">
  <!-- A pointer shortcut: the main map's ground is the keyboard control. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <polygon class="ground" points={ground} onclick={pick} data-action={onpick ? 'walk-mini' : undefined} />
  {#if image}
    <image
      class="terrain pass"
      href={image}
      x="0"
      y="0"
      width={map.size}
      height={map.size}
      transform="matrix({K} {K / 2} {-K} {K / 2} 0 0)"
    />
  {/if}
  <polygon class="edge pass" points={ground} stroke-width={u} />

  {#each names as n (n.id)}
    {@const p = isoPoint(n.x, n.y)}
    <text class="name pass" transform="translate({p.sx} {p.sy}) scale({u})" text-anchor="middle">{ROYALE_SECTIONS[n.id]?.name ?? n.id}</text>
  {/each}

  {#each features as f (f.kind + f.id)}
    {@const p = isoPoint(f.x, f.y)}
    <g class="pass" transform="translate({p.sx} {p.sy}) scale({u})" opacity={f.spent ? 0.4 : 1}>
      {#if icons}
        <text class="icon" y="5" text-anchor="middle">{f.icon}</text>
      {:else}
        <circle class="dot" class:den={f.kind === 'den'} r="3.5" />
      {/if}
    </g>
  {/each}

  {#if view}
    <rect class="frame pass" x={view.x} y={view.y} width={view.w} height={view.h} stroke-width={1.5 * u} />
  {/if}

  {#if radar}
    {@const p = isoPoint(radar.x, radar.y)}
    <circle class="radar pass" cx={p.sx} cy={p.sy} r={3.5 * u} stroke-width={2 * u} />
  {/if}
  {#if player}
    {@const p = isoPoint(player.x, player.y)}
    <circle class="you pass" cx={p.sx} cy={p.sy} r={4.5 * u} stroke-width={1.5 * u} />
  {/if}
</svg>

<style>
  .mini {
    display: block;
    width: 100%;
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

  .live .ground {
    cursor: crosshair;
  }

  .ground {
    fill: transparent;
  }

  .terrain {
    image-rendering: pixelated;
  }

  .edge {
    fill: none;
    stroke: var(--color-border);
  }

  .name {
    font-size: 9px;
    fill: var(--color-text);
    opacity: 0.8;
    paint-order: stroke;
    stroke: var(--color-bg);
    stroke-width: 2.5px;
  }

  .icon {
    font-size: 13px;
  }

  .dot {
    fill: var(--color-accent);
    stroke: var(--color-bg);
    stroke-width: 1px;
  }

  .den {
    fill: var(--color-danger);
  }

  .frame {
    fill: none;
    stroke: var(--color-text);
    opacity: 0.8;
  }

  .radar {
    fill: none;
    stroke: var(--color-danger);
  }

  .you {
    fill: var(--color-accent);
    stroke: var(--color-bg);
  }
</style>
