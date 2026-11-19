<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import attributes from '../attributes';
  import benches, { benchPace, startBench, stopBench } from '../benches';
  import { familySkillFor, SLOT_NAMES, WIELD_NAMES } from '../items';
  import { MATERIALS } from '../materials';
  import smithing, {
    clonePlacement,
    FORGING,
    forgeTicks,
    ITEM_CLASS_LIST,
    neighbours,
    PART_KINDS,
    placementKey,
    previewForge,
    type ForgeSlot,
    type PartKindDef,
  } from './index';
  import {
    COMPARE_COLUMNS,
    cellsOfMaterial,
    compareKinds,
    distinctNeighbours,
    familiesOf,
    familyOf,
    kindLabel,
    kindRowLabel,
    kindsOfFamily,
    materialColor,
    materialLabel,
    neighbourLabel,
    offeredMaterials,
    pairStatLines,
    pieceLines,
    slotRole,
    ticksToTime,
    withPart,
    type PartFamilyId,
  } from './anvilView';
  import FormChart from './FormChart.svelte';
  import { anvil, setLayout, syncAnvil } from './layout.svelte';
  import Silhouette from './Silhouette.svelte';

  /**
   * The anvil: five slots, a part kind and a material in each, and the screen
   * says what the proportions make before anything is spent. Every number
   * comes from `previewForge`; this panel lays them out and edits the layout,
   * which lives in `anvil` (layout.svelte.ts) so leaving the panel keeps it.
   * Port of old `ui/panels/AnvilPanel.svelte`. A comparison row previews on
   * click (the old one previewed on hover); "Put on the anvil" applies it.
   */
  const view = $derived(viewOf(smithing));
  const benchView = $derived(viewOf(benches));
  const attrView = $derived(viewOf(attributes));

  // The layout is this run's: a prestige or a new sky since it was last used clears it.
  syncAnvil(viewOf(smithing).runKey);
  $effect.pre(() => syncAnvil(view.runKey));

  const reads = $derived(view.reads);
  const counts = $derived(view.reads.counts);
  const isKnown = (id: string) => view.known.includes(id);

  /** What is on the anvil. The forge buttons, their reason and "one change away" read this, never a preview. */
  const placement = $derived(anvil.placement);
  const preview = $derived(previewForge(reads, placement));
  /** Nothing placed: an empty layout still resolves (to the last class), but there is nothing to say about it. */
  const empty = $derived(preview.parts.length === 0);
  const knownCount = $derived(view.known.length);
  const totalCount = ITEM_CLASS_LIST.length;

  // ---- Previewing a kind from the comparison table ----
  /** The kind a row click picked in a table: drawn and priced everywhere, applied nowhere. */
  let picked = $state.raw<{ slot: ForgeSlot; kind: string } | null>(null);
  /**
   * The anvil with that kind in its slot; null when nothing is picked or it would change nothing.
   * A pick whose slot shut, or locked under it, ends the preview too.
   */
  const pickedPlacement = $derived.by(() => {
    if (!picked || anvil.open !== picked.slot || preview.slotLocks[picked.slot] !== undefined) return null;
    const next = withPart(placement, picked.slot, picked.kind);
    return next && placementKey(next) !== placementKey(placement) ? next : null;
  });
  const previewing = $derived(pickedPlacement !== null);
  /** The layout the drawing and the middle column show. */
  const shownPlacement = $derived(pickedPlacement ?? placement);
  const shown = $derived(pickedPlacement ? previewForge(reads, pickedPlacement) : preview);
  const cls = $derived(shown.class);
  const known = $derived(isKnown(cls.id));
  /** A previewed form is "?" until the save has made it, as in the table and "one change away". */
  const masked = $derived(previewing && !known);
  const shownName = $derived(masked ? '?' : shown.def.name);
  /** Every line of the middle column, a previewed value set against the current one. */
  const lines = $derived(pairStatLines(pieceLines(preview.stats, preview.def.mods), pieceLines(shown.stats, shown.def.mods)));

  /** The bench run underway at the anvil, if any. */
  const job = $derived(benchView.job?.discipline === FORGING.id ? benchView.job : null);
  /** The clock `benchJobTicks` gives an assembling bench, from the shared craft speed. */
  const pace = $derived(benchPace(view.craftSpeed, forgeTicks(shownPlacement)));
  /** How many pieces the pack could pay for. */
  const affordableCopies = $derived(preview.cost.length ? Math.min(...preview.cost.map((c) => Math.floor(c.held / c.qty))) : 0);
  const batchCopies = $derived(Math.min(5, affordableCopies));

  const slotName = (slot: ForgeSlot) => FORGING.slots.find((s) => s.id === slot)?.name ?? slot;

  // ---- The family chip and the requirement check ----
  const family = $derived(cls.slot === 'weapon' || cls.slot === 'offhand' ? cls.tags[0] : undefined);
  const familyClaimed = $derived(family ? familySkillFor(family) !== undefined : true);
  /** A forged piece's only requirement is an attribute level (STR). Read from the attributes view. */
  const meetsRequirement = $derived(
    (shown.def.requirements ?? []).every(
      (c) => c.type !== 'attr' || (attrView.attributes.find((a) => a.id === c.attr)?.value ?? 0) >= c.level,
    ),
  );

  // ---- One change away ----
  /** One-change buttons shown before "show all". */
  const NEAR_LIMIT = 10;
  let nearOpen = $state(false);
  let showAllNear = $state(false);
  const near = $derived(distinctNeighbours(neighbours(placement), preview.slotLocks));
  const nearShown = $derived(showAllNear ? near : near.slice(0, NEAR_LIMIT));

  // ---- The slot pickers ----
  /** The family a slot's table lists: the one picked by hand, else the held part's, else the role's only one. */
  function activeFamily(slot: ForgeSlot): PartFamilyId | undefined {
    const pickedFamily = anvil.family[slot];
    if (pickedFamily) return pickedFamily;
    const families = familiesOf(slotRole(slot));
    if (families.length === 1) return families[0].id;
    const held = placement[slot] ? PART_KINDS[placement[slot].kind] : undefined;
    return held ? familyOf(held).id : undefined;
  }

  /** Opens a slot's picker and shuts the one that was open; the open one shuts again. */
  function toggleSlot(slot: ForgeSlot) {
    picked = null;
    if (anvil.open === slot) {
      anvil.open = null;
      return;
    }
    anvil.open = slot;
    delete anvil.family[slot];
  }

  function pickFamily(slot: ForgeSlot, id: PartFamilyId) {
    picked = null;
    anvil.family[slot] = id;
  }

  /** A row click previews that kind; a second click on the same row ends the preview. */
  function previewKind(slot: ForgeSlot, kind: string) {
    picked = picked?.slot === slot && picked.kind === kind ? null : { slot, kind };
  }

  // ---- Edits: every edit replaces the layout, never mutates it ----
  function setPart(slot: ForgeSlot, kindId: string | null) {
    const next = withPart(placement, slot, kindId);
    if (!next) return;
    picked = null;
    anvil.placement = next;
    if (!kindId) delete anvil.family[slot];
  }

  function setMaterial(slot: ForgeSlot, mat: string) {
    const next = clonePlacement(placement);
    const part = next[slot];
    if (!part) return;
    next[slot] = { ...part, mat };
    anvil.placement = next;
  }

  function stepQty(slot: ForgeSlot, delta: number) {
    const next = clonePlacement(placement);
    const part = next[slot];
    const kind = part ? PART_KINDS[part.kind] : undefined;
    if (!part || !kind) return;
    const qty = Math.max(1, Math.min(kind.qtyMax ?? 1, (part.qty ?? 1) + delta));
    next[slot] = { kind: part.kind, mat: part.mat, ...(qty > 1 ? { qty } : {}) };
    anvil.placement = next;
  }

  function clear() {
    picked = null;
    setLayout({});
  }

  /** Start a run: `count` pieces, or until the stock runs out (null). The old `game.forge`. */
  function forge(count: number | null) {
    send(startBench({ discipline: FORGING.id, placement: {}, count, forge: clonePlacement(placement) }));
  }
</script>

{#snippet glyph(kind: PartKindDef)}
  <!-- The kind's footprint at a glance: one small square per cell, capped at 4×10. -->
  <span class="glyph" style="grid-template-columns: repeat({Math.min(kind.w, 4)}, var(--cell))" aria-hidden="true">
    {#each { length: Math.min(kind.w, 4) * Math.min(kind.l, 10) } as _}<i></i>{/each}
  </span>
{/snippet}

<section class="anvil" aria-label="Anvil">
  <h2>Anvil <span class="dim num">Smithing {reads.level}</span></h2>

  {#if !view.atAnvil}
    <p class="dim line">Anvil: {view.anvils.length ? `at ${view.anvils.map((a) => a.name).join(', ')}` : 'none discovered'}</p>
  {:else}
    <div class="view-switch">
      <button type="button" class="btn" aria-pressed={anvil.view === 'anvil'} onclick={() => (anvil.view = 'anvil')}>Anvil</button>
      <button type="button" class="btn" aria-pressed={anvil.view === 'chart'} onclick={() => (anvil.view = 'chart')}>
        Form chart <span class="dim num">{knownCount} of {totalCount}</span>
      </button>
    </div>

    {#if anvil.view === 'chart'}
      <FormChart known={view.known} runKey={view.runKey} />
    {:else}
      <!-- Three columns that scroll on their own: the piece and the forge buttons,
           what it resolves to, and the parts. Changing a part never moves the
           numbers out of view. -->
      <div class="work">
        <div class="col col-piece">
          <div class="plate" class:previewing>
            <Silhouette placement={shownPlacement} label={empty ? 'Empty anvil' : previewing ? `Preview: ${shownName}` : preview.def.name} />
            {#if previewing}<span class="plate-caption">Preview</span>{/if}
          </div>

          <div class="run-bar">
            {#if job}
              {@const single = job.done === 0 && job.remaining === 1}
              <div class="run" aria-label="Forging">
                <div class="progress"><div class="progress-fill" style="width: {(job.progress * 100).toFixed(1)}%"></div></div>
                <span class="dim num">
                  {(Math.max(0, job.ticksLeft) / 10).toFixed(1)}s{#if !single}
                    · {job.done}{job.remaining != null ? ` / ${job.done + job.remaining}` : ''} done{/if}{#if job.batch > 1}
                    · ×{job.batch} per pass{/if}
                </span>
              </div>
              <Button onclick={() => send(stopBench(undefined))}>Stop</Button>
            {:else}
              <Button variant="primary" disabled={!preview.ok} onclick={() => forge(1)}>{FORGING.icon} {FORGING.verb}</Button>
              {#if affordableCopies >= 2}
                <Button disabled={!preview.ok} onclick={() => forge(batchCopies)}>×{batchCopies}</Button>
                <Button disabled={!preview.ok} onclick={() => forge(null)}>Until out of stock</Button>
              {/if}
              <Button onclick={clear}>Clear</Button>
            {/if}
          </div>
          <div class="reason">{!preview.ok && !job ? preview.reason : ''}</div>
        </div>

        <div class="col col-info">
          {#if empty}
            <div>
              <div class="dim">Resolves to</div>
              <h3 class="form-name">Nothing</h3>
            </div>
            <div class="dim">The anvil is empty. Open a slot in the list of parts and choose a part kind.</div>
          {:else}
            <div>
              <div class="dim">{previewing ? 'Would resolve to' : 'Resolves to'}</div>
              <h3 class="form-name">{shownName}</h3>
            </div>
            {#if previewing && picked}
              <div class="note">
                Preview, not applied: {kindLabel(PART_KINDS[picked.kind])} in the {slotName(picked.slot).toLowerCase()} slot.
                A changed line reads current → preview.
                <button type="button" class="btn" onclick={() => picked && setPart(picked.slot, picked.kind)}>Put on the anvil</button>
              </div>
            {/if}
            <!-- A previewed form still masked as "?" shows nothing that names it: no slot, hands,
                 family or degenerate chip and no description, as in the table and the chart. -->
            <div class="chips">
              {#if !masked}
                <span class="chip">{SLOT_NAMES[cls.slot]}</span>
                {#if cls.wield}<span class="chip">{WIELD_NAMES[cls.wield]}</span>{/if}
                {#if family}
                  {#if familyClaimed}
                    <span class="chip">family: {family}</span>
                  {:else}
                    <span class="chip warn">family: {family}, no combat skill claims it</span>
                  {/if}
                {/if}
                {#if cls.degenerate}<span class="chip deg">degenerate form</span>{/if}
              {/if}
              {#if !known}<span class="chip new">new form: added to the chart when forged</span>{/if}
            </div>
            {#if !masked && cls.degenerate && cls.desc}<div class="dim">{cls.desc}</div>{/if}

            <dl class="stats num">
              {#each lines as line}
                {@const unmet = line.label === 'Requires' && !meetsRequirement}
                <dt class="dim">{line.label}</dt>
                <dd class:short={unmet}>
                  {#if line.from !== undefined}<span class="was">{line.from} →</span>{/if}
                  {line.value}{unmet ? ' (not met)' : ''}
                </dd>
              {/each}
            </dl>
            <div class="dim">Drawn at Fair quality. The grade is rolled from Smithing when the piece is finished.</div>

            <div class="bill">
              <div class="dim">Bill</div>
              {#each shown.cost as line (line.id)}
                <div class="bill-line num" class:short={line.held < line.qty}>
                  <span>{line.qty} × {MATERIALS[line.id]?.name ?? line.id}</span>
                  <span class="dim">{cellsOfMaterial(shownPlacement, line.id)} cells</span>
                  <span class="held">held {line.held}</span>
                </div>
              {:else}
                <div class="dim">Nothing on the anvil.</div>
              {/each}
              <div class="num">
                <span class="dim">Time:</span>
                {ticksToTime(pace.ticksPer)}{#if pace.batch > 1}<span class="dim"> · ×{pace.batch} per pass</span>{/if}
              </div>
            </div>

            <details class="near" bind:open={nearOpen}>
              <summary class="dim">Other forms one change away ({near.length})</summary>
              <div class="near-list">
                {#each nearShown as n (n.to.id)}
                  <button
                    type="button"
                    class="btn"
                    onclick={() => {
                      picked = null;
                      setLayout(n.placement);
                    }}
                  >
                    {neighbourLabel(n, slotName(n.slot))} → {isKnown(n.to.id) ? n.to.name : '?'}
                  </button>
                {:else}
                  <span class="dim">No single change alters the form.</span>
                {/each}
                {#if near.length > NEAR_LIMIT}
                  <button type="button" class="btn" onclick={() => (showAllNear = !showAllNear)}>
                    {showAllNear ? 'show fewer' : `show all ${near.length}`}
                  </button>
                {/if}
              </div>
            </details>
          {/if}
        </div>

        <div class="col col-parts">
          <!-- The five slots as one row each; the open one shows its three steps. -->
          <div class="slots">
            {#each FORGING.slots as def (def.id)}
              {@const slot = def.id as ForgeSlot}
              {@const part = placement[slot]}
              {@const partKind = part ? PART_KINDS[part.kind] : undefined}
              {@const lock = preview.slotLocks[slot]}
              {@const isOpen = anvil.open === slot}
              <div class="slot">
                <button
                  type="button"
                  class="part-row"
                  class:selected={isOpen}
                  aria-expanded={isOpen}
                  aria-controls="slot-body-{slot}"
                  onclick={() => toggleSlot(slot)}
                >
                  <span class="part-row-name">{def.name}</span>
                  <span class="part-row-part">
                    {#if lock !== undefined}
                      <span class="dim">Smithing {lock}</span>
                      {#if partKind}<span class="dim">· holds {partKind.name}</span>{/if}
                    {:else if part && partKind}
                      {@render glyph(partKind)}
                      <span>{partKind.name}</span>
                      <span class="dim num">{partKind.w}×{partKind.l}</span>
                      <span><span class="swatch" style="background: {materialColor(part.mat)}"></span>{materialLabel(part.mat)}</span>
                      {#if (part.qty ?? 1) > 1}<span class="num">×{part.qty}</span>{/if}
                    {:else}
                      <span class="dim">empty</span>
                    {/if}
                  </span>
                  <span class="part-row-chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                </button>

                {#if isOpen}
                  <div class="slot-body" id="slot-body-{slot}">
                    {#if lock !== undefined}
                      <div class="dim">The {def.name.toLowerCase()} slot opens at Smithing {lock}.</div>
                      {#if part}<button type="button" class="btn" onclick={() => setPart(slot, null)}>Clear the slot</button>{/if}
                    {:else}
                      {@const families = familiesOf(slotRole(slot))}
                      {@const active = activeFamily(slot)}
                      {@const activeName = families.find((f) => f.id === active)?.name}
                      {@const rows = active ? compareKinds(reads, view.known, placement, slot, active) : []}

                      <div class="step">
                        <div class="dim">Shape family</div>
                        <div class="picks">
                          <button type="button" class="btn" aria-pressed={!part} onclick={() => setPart(slot, null)}>none</button>
                          {#if families.length > 1}
                            {#each families as fam (fam.id)}
                              <button type="button" class="btn" aria-pressed={active === fam.id} onclick={() => pickFamily(slot, fam.id)}>
                                {fam.name} <span class="dim num">{kindsOfFamily(fam.id).length}</span>
                              </button>
                            {/each}
                          {:else if active}
                            <span class="dim">{activeName}: {kindsOfFamily(active).length} kinds</span>
                          {/if}
                        </div>
                      </div>

                      {#if active}
                        <div class="step">
                          <div class="dim">
                            {activeName}: each row is the piece with that kind in the {def.name.toLowerCase()} slot. Click a row to preview it.
                          </div>
                          <div class="kind-table">
                            <div class="kind-head" aria-hidden="true">
                              <span>Kind</span>
                              <span>Makes</span>
                              {#each COMPARE_COLUMNS as col (col.key)}
                                <span class="kind-num-head">{col.label}</span>
                              {/each}
                            </div>
                            {#each rows as row (row.kind.id)}
                              {@const isPicked = picked?.slot === slot && picked.kind === row.kind.id}
                              <button
                                type="button"
                                class="kind-row"
                                class:selected={row.current}
                                class:picked={isPicked}
                                aria-pressed={isPicked}
                                aria-label={kindRowLabel(row)}
                                onclick={() => previewKind(slot, row.kind.id)}
                              >
                                <span class="kind-name">
                                  <span class="kind-title">
                                    {@render glyph(row.kind)}
                                    <span>{row.kind.name}</span>
                                  </span>
                                  <span class="dim num">{row.kind.w}×{row.kind.l}</span>
                                  {#if row.current}<span class="kind-tag">current</span>{/if}
                                  {#if isPicked && !row.current}<span class="kind-tag">preview</span>{/if}
                                </span>
                                <span class="kind-form">
                                  <span class="kind-num-label">Makes</span>
                                  <span class:dim={!row.known}>{row.form}</span>
                                </span>
                                {#each COMPARE_COLUMNS as col (col.key)}
                                  {@const cell = row.cells[col.key]}
                                  <span class="kind-num num">
                                    <span class="kind-num-label">{col.label}</span>
                                    <span>{cell.text}</span>
                                    {#if cell.delta}
                                      <span class="kind-delta" class:better={cell.tone === 'better'} class:worse={cell.tone === 'worse'}
                                        >({cell.delta})</span
                                      >
                                    {/if}
                                  </span>
                                {/each}
                              </button>
                            {/each}
                          </div>
                          <div class="apply">
                            {#if isOpen && picked?.slot === slot && previewing}
                              <button type="button" class="btn" onclick={() => picked && setPart(picked.slot, picked.kind)}>
                                Put on the anvil: {kindLabel(PART_KINDS[picked.kind])}
                              </button>
                              <button type="button" class="btn" onclick={() => (picked = null)}>End preview</button>
                            {:else}
                              <span class="dim">Preview: none. Click a row, then put it on the anvil.</span>
                            {/if}
                          </div>
                          <details class="legend">
                            <summary class="dim">Columns</summary>
                            <dl>
                              {#each COMPARE_COLUMNS as col (col.key)}
                                <dt>{col.label}</dt>
                                <dd class="dim">{col.hint}</dd>
                              {/each}
                            </dl>
                          </details>
                        </div>
                      {:else}
                        <div class="dim">Choose a shape family to list its kinds.</div>
                      {/if}

                      {#if part && partKind}
                        <div class="step">
                          <div class="dim">Material{(partKind.qtyMax ?? 1) > 1 ? ' and count' : ''}</div>
                          <div class="mats">
                            {#each offeredMaterials(partKind, counts, part.mat) as mat (mat.id)}
                              <button type="button" class="btn" aria-pressed={part.mat === mat.id} onclick={() => setMaterial(slot, mat.id)}>
                                <span class="swatch" style="background: {materialColor(mat.id)}"></span>
                                {mat.name}
                                <span class="dim num held">{counts[mat.id] ?? 0}</span>
                              </button>
                            {/each}
                            {#if (partKind.qtyMax ?? 1) > 1}
                              <span class="stepper">
                                <span class="dim">count</span>
                                <button type="button" class="btn" aria-label="Fewer" disabled={(part.qty ?? 1) <= 1} onclick={() => stepQty(slot, -1)}>−</button>
                                <span class="num">{part.qty ?? 1}</span>
                                <button
                                  type="button"
                                  class="btn"
                                  aria-label="More"
                                  disabled={(part.qty ?? 1) >= (partKind.qtyMax ?? 1)}
                                  onclick={() => stepQty(slot, 1)}>+</button
                                >
                              </span>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  /* The panel is the container the three columns ask about: the parts column
     needs about 47rem across all three before it fits. */
  .anvil {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    max-width: 72rem;
  }

  h2 {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  .line {
    margin: 0;
  }

  .view-switch {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .btn {
    box-sizing: border-box;
    min-height: var(--tap);
    min-width: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .btn[aria-pressed='true'] {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Three columns of fixed height, each scrolling on its own. */
  .work {
    display: grid;
    grid-template-areas: 'piece info parts';
    grid-template-columns: minmax(11rem, 0.7fr) minmax(19rem, 1fr) minmax(19rem, 1.3fr);
    grid-template-rows: minmax(0, 1fr);
    gap: var(--space-4);
    height: 40rem;
    min-height: 0;
  }

  .col {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding-right: var(--space-1);
  }

  .col-piece {
    grid-area: piece;
  }

  .col-info {
    grid-area: info;
  }

  .col-parts {
    grid-area: parts;
  }

  /* Narrower than the three columns need, a phone among them: one column, and
     the page scrolls instead. */
  @container (max-width: 52rem) {
    .work {
      grid-template-areas:
        'piece'
        'info'
        'parts';
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
      height: auto;
    }

    .col {
      overflow: visible;
      padding-right: 0;
    }
  }

  /* The drawing brings its own drafting grid (Silhouette), cell-aligned; the plate only frames it. */
  .plate {
    position: relative;
    display: grid;
    background-color: var(--color-bg);
    border: var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  /* A kind picked in a table is drawn here, not applied: dashed accent edge and a caption. */
  .plate.previewing {
    border-style: dashed;
    border-color: var(--color-accent);
  }

  .plate-caption {
    position: absolute;
    top: var(--space-1);
    left: var(--space-1);
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-accent);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-accent);
  }

  /* Fixed height: the run's bar and the forge buttons take the same box. */
  .run-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    align-content: flex-start;
    height: calc(3 * var(--tap) + 2 * var(--space-2));
    overflow: hidden;
  }

  .run {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 8rem;
  }

  .progress {
    height: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-bg);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-accent);
  }

  .reason {
    min-height: var(--tap);
    color: var(--color-danger);
    font-size: var(--text-sm);
  }

  .form-name {
    margin: 0;
    font-size: var(--text-lg);
    line-height: 1.2;
  }

  .note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    border-left: 2px solid var(--color-accent);
    padding: var(--space-1) var(--space-3);
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    font-size: var(--text-sm);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .chip {
    font-size: var(--text-sm);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    color: var(--color-text-dim);
    white-space: nowrap;
  }

  .chip.warn {
    color: var(--color-danger);
    border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border));
    white-space: normal;
  }

  .chip.deg {
    color: var(--color-warn);
    border-color: color-mix(in srgb, var(--color-warn) 55%, var(--color-border));
  }

  .chip.new {
    color: var(--color-ok);
    border-color: color-mix(in srgb, var(--color-ok) 55%, var(--color-border));
  }

  .stats {
    display: grid;
    grid-template-columns: max-content minmax(max-content, 1fr);
    gap: 1px var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
  }

  .stats dt,
  .stats dd {
    margin: 0;
  }

  .stats dd {
    text-align: right;
  }

  /* The anvil's own value on a previewed line, before the arrow. */
  .was {
    margin-right: var(--space-1);
    color: var(--color-text-dim);
  }

  .short {
    color: var(--color-danger);
  }

  .bill {
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  /* No wrap: a held count that changes while a run goes moves nothing. */
  .bill-line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: var(--space-3);
  }

  .held {
    display: inline-block;
    min-width: var(--space-6);
    text-align: right;
  }

  .bill-line .held {
    min-width: calc(2 * var(--space-6));
  }

  .near summary,
  .legend summary {
    min-height: var(--tap);
    line-height: var(--tap);
    cursor: pointer;
  }

  .near-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }

  .legend dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
  }

  .legend dd {
    margin: 0;
  }

  .slots {
    display: grid;
    gap: var(--space-1);
  }

  /* One row per slot: its name and what it holds. The open slot's steps hang under its row. */
  button.part-row {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 7.5em minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--tap);
    padding: var(--space-1) var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button.part-row.selected {
    border-color: var(--color-accent);
  }

  .part-row-name {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .part-row-part {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--space-2);
    min-width: 0;
    font-size: var(--text-sm);
  }

  .part-row-chev {
    color: var(--color-text-dim);
  }

  .slot-body {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    margin: 2px 0 var(--space-2);
    padding: var(--space-2) 0 var(--space-1) var(--space-3);
    border-left: 2px solid var(--color-accent);
  }

  .step {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .picks,
  .mats,
  .apply {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  /* Fixed height: picking a row and ending the preview move nothing below it. */
  .apply {
    height: calc(2 * var(--tap) + var(--space-1));
    align-content: flex-start;
    overflow: hidden;
  }

  /* The comparison table: one button per kind. Wide, the numbers are columns under a header;
     in a narrow column each row stacks its name, its form and a strip of labelled numbers. */
  .kind-table {
    container-type: inline-size;
    display: grid;
    gap: 3px;
  }

  .kind-head,
  button.kind-row {
    display: grid;
    grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.1fr) repeat(5, minmax(0, 0.8fr));
    align-items: center;
    gap: 0 var(--space-2);
  }

  .kind-head {
    padding: 0 var(--space-2);
    align-items: end;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }

  .kind-num-head {
    text-align: right;
  }

  button.kind-row {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--tap);
    padding: var(--space-1) var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  button.kind-row.selected {
    border-color: var(--color-accent);
  }

  button.kind-row.picked {
    border-style: dashed;
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }

  .kind-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1px var(--space-2);
    min-width: 0;
  }

  /* The glyph stays beside the first word of the name; the size and the tag wrap under them. */
  .kind-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .kind-tag {
    color: var(--color-accent);
  }

  .kind-form {
    display: flex;
    gap: var(--space-1);
    min-width: 0;
  }

  .kind-num {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.2;
  }

  .kind-num-label {
    display: none;
    color: var(--color-text-dim);
  }

  .kind-delta {
    color: var(--color-text-dim);
  }

  .kind-delta.better {
    color: var(--color-ok);
  }

  .kind-delta.worse {
    color: var(--color-danger);
  }

  /* Stack only when the column is genuinely narrow: one line per kind is what keeps the table scannable. */
  @container (max-width: 26rem) {
    .kind-head {
      display: none;
    }

    button.kind-row {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: var(--space-1) var(--space-1);
    }

    .kind-name,
    .kind-form {
      grid-column: 1 / -1;
    }

    .kind-num {
      align-items: flex-start;
    }

    .kind-num-label {
      display: block;
    }
  }

  /* The part's footprint at a glance: one square per cell, capped at 4×10. */
  .glyph {
    --cell: calc(var(--space-1) * 0.75);
    display: inline-grid;
    gap: 1px;
  }

  .glyph i {
    display: block;
    width: var(--cell);
    height: var(--cell);
    background: var(--color-text-dim);
  }

  .selected .glyph i {
    background: var(--color-accent);
  }

  .swatch {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    margin-right: var(--space-1);
    border: 1px solid var(--color-bg);
  }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: var(--space-2);
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
