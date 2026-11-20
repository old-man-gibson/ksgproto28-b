<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import type { DeepReadonly } from '../../kernel';
  import { send, viewOf } from '../../ui/game.svelte';
  import { recallLayout, rememberLayout, slotConsumes, slotPicks, type GradedStack, type Placement } from '../benches';
  import { RUNE_CONTEXTS, type RuneContext } from '../items';
  import type { MaterialsState } from '../materials';
  import runecarving, {
    adornmentEffectAt,
    composeCarved,
    describeRuneEffect,
    discardRune,
    patternEffectAt,
    previewCarve,
    RUNECARVING,
    carveRune,
    sellRune,
    socketRune,
    unsocketRune,
    type HeldRuneView,
  } from './index';

  // The Rune Table: one row per open station, a picker well of fixed height,
  // the preview box of fixed height, Carve. Below: the loose runes (sell,
  // discard) and the gear with rune slots (socket, remove). Everything opens
  // on click. No box changes size with what is picked.
  const view = $derived(viewOf(runecarving));

  let bench = $state<Placement>(recallLayout(RUNECARVING.id)?.placement ?? {});
  let picking = $state<string | null>(null);
  let context = $state<RuneContext>('weapon');
  let selectedGear = $state<number | null>(null);

  $effect(() => rememberLayout(RUNECARVING.id, bench, null));

  const stations = $derived(RUNECARVING.slots.filter((s) => view.open.includes(s.id)));

  /** The stock the view lists, in the shape the bench check reads. */
  const reads = $derived.by(() => {
    const stock: MaterialsState['stock'] = {};
    for (const m of view.stock) stock[m.id] = Object.fromEntries(m.grades.map((g) => [g.quality, g.qty]));
    return { level: view.level, materials: { counts: {}, stock } as MaterialsState, knowsRecipe: () => false };
  });

  const check = $derived(previewCarve(reads, bench));
  const rune = $derived(check.ok && check.preview ? composeCarved(check.preview) : null);

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const gradeLetter = (q: string) => q.toUpperCase();

  function nameOf(slotId: string, put: GradedStack | undefined): string {
    if (!put) return 'empty';
    const slot = RUNECARVING.slots.find((s) => s.id === slotId);
    if (slot && slotPicks(slot) === 'design') return view.patterns.find((p) => p.id === put.id)?.name ?? put.id;
    const m = view.stock.find((s) => s.id === put.id);
    return `${m?.icon ?? ''} ${m?.name ?? put.id} (${gradeLetter(put.quality)})`;
  }

  interface Option {
    stack: GradedStack;
    label: string;
    note: string;
  }

  const options = $derived.by((): Option[] => {
    const slot = RUNECARVING.slots.find((s) => s.id === picking);
    if (!slot) return [];
    if (slotPicks(slot) === 'design') {
      return view.patterns.map((p) => ({
        stack: { id: p.id, quality: 'c' },
        label: `${p.icon} ${p.name}`,
        note: describeRuneEffect(patternEffectAt(p.id, bench.slab?.quality ?? 'c', context)),
      }));
    }
    const out: Option[] = [];
    for (const m of view.stock) {
      if (!slot.accepts.some((t) => m.tags.includes(t))) continue;
      for (const g of m.grades) {
        out.push({
          stack: { id: m.id, quality: g.quality },
          label: `${m.icon} ${m.name} · ${g.name} ×${g.qty}`,
          note: slot.role === 'adornment' ? describeRuneEffect(adornmentEffectAt(m.id, g.quality, context)) : '',
        });
      }
    }
    return out;
  });

  function put(slotId: string, stack: GradedStack | undefined): void {
    bench = { ...bench, [slotId]: stack };
    picking = null;
  }

  function carve(): void {
    const result = send(carveRune({ placement: bench }));
    if (!result.ok) return;
    // What was spent leaves the bench; patterns and the tool stay (old `clearConsumed`).
    const keep: Placement = {};
    for (const s of stations) if (!slotConsumes(s) && bench[s.id]) keep[s.id] = bench[s.id];
    bench = keep;
  }

  const loose = $derived([...view.pile, ...view.carved]);
  const gear = $derived(view.gear.find((g) => g.uid === selectedGear) ?? null);
  const lineFor = (r: DeepReadonly<HeldRuneView>, ctx: RuneContext) => r.effects.find((e) => e.context === ctx)?.text ?? 'inert';
</script>

<section class="panel" aria-label="Runes">
  {#if !view.unlocked}
    <p class="card dim">Runecarving: shut. The flag unlock_runecarving opens it; nothing in play sets it yet.</p>
  {:else}
    <div class="card bench">
      <h2>💎 Rune Table <span class="dim small">Runecarving {view.level}</span></h2>
      {#if !view.atTable}
        <p class="note dim">Stands at: {view.tables.join(', ')}.</p>
      {:else}
        <p class="note dim small">
          {view.next ? `Next station: ${view.next.name} at Runecarving ${view.next.level}.` : 'Every station is open.'}
        </p>
        <div class="row" role="group" aria-label="Effects shown for">
          {#each RUNE_CONTEXTS as c (c)}
            <Button pressed={context === c} onclick={() => (context = c)}>{c}</Button>
          {/each}
        </div>
        <ul class="stations">
          {#each stations as slot (slot.id)}
            <li>
              <button
                type="button"
                class="line"
                aria-pressed={picking === slot.id}
                onclick={() => (picking = picking === slot.id ? null : slot.id)}
              >
                <span class="label">{slot.name}{slot.optional ? '' : ' *'}:</span>
                <span>{nameOf(slot.id, bench[slot.id])}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="well" aria-label="Picker">
          {#if picking}
            <Button onclick={() => put(picking!, undefined)}>Clear the station</Button>
            {#each options as opt (opt.stack.id + opt.stack.quality)}
              <button type="button" class="option" onclick={() => put(picking!, opt.stack)}>
                <span>{opt.label}</span>
                {#if opt.note}<span class="dim small">{opt.note}</span>{/if}
              </button>
            {:else}
              <p class="dim small">Nothing held fits this station.</p>
            {/each}
          {:else}
            <p class="dim small">Pick a station to fill it.</p>
          {/if}
        </div>
        <div class="preview" aria-live="polite">
          {#if rune && check.ok}
            <div class="strong">{rune.icon} {rune.name}</div>
            {#each RUNE_CONTEXTS as c (c)}
              <div class="small">
                <span class="dim">{c}:</span>
                {describeRuneEffect(rune.effects.find((e) => e.context === c))}
              </div>
            {/each}
            <div class="small" class:risky={(check.failure ?? 0) > 0.35}>Split chance: {pct(check.failure ?? 0)}</div>
          {:else}
            <div class="dim small">Cannot carve: {check.reason}</div>
          {/if}
        </div>
        <div class="row">
          <Button variant="primary" disabled={!check.ok} onclick={carve}>💎 Carve</Button>
        </div>
      {/if}
    </div>

    <div class="card">
      <h2>Loose runes</h2>
      <ul class="list" aria-label="Loose runes">
        {#each loose as r (r.ref)}
          <li class="held">
            <div>
              <span>{r.icon} {r.name}{r.qty > 1 ? ` ×${r.qty}` : ''}</span>
              {#if r.grade}<span class="dim small">· {r.grade} slab</span>{/if}
            </div>
            <div class="dim small">{context}: {lineFor(r, context)}</div>
            <div class="row">
              <Button onclick={() => send(sellRune({ ref: r.ref }))}>Sell: {r.sell} g</Button>
              <Button onclick={() => send(discardRune({ ref: r.ref }))}>Discard</Button>
            </div>
          </li>
        {:else}
          <li class="dim">None.</li>
        {/each}
      </ul>
    </div>

    <div class="card">
      <h2>Rune slots</h2>
      <ul class="list short" aria-label="Gear with rune slots">
        {#each view.gear as g (g.uid)}
          <li>
            <button
              type="button"
              class="line"
              aria-pressed={selectedGear === g.uid}
              onclick={() => (selectedGear = selectedGear === g.uid ? null : g.uid)}
            >
              {g.icon} {g.name} · {g.worn ? `worn: ${g.worn}` : 'pack'} · {g.runes.length}/{g.slots}
            </button>
          </li>
        {:else}
          <li class="dim">No item with a rune slot.</li>
        {/each}
      </ul>
      <div class="sockets" aria-label="Sockets">
        {#if gear}
          <div class="dim small">{gear.icon} {gear.name}: effects read as {gear.context}.</div>
          {#each gear.runes as r, i (i)}
            <div class="socket">
              <span>{r.icon} {r.name}: {r.text}</span>
              <Button onclick={() => send(unsocketRune({ uid: gear.uid, index: i }))}>Remove</Button>
            </div>
          {/each}
          {#each { length: gear.slots - gear.runes.length } as _, i (i)}
            <select
              class="socket-select"
              disabled={loose.length === 0}
              onchange={(e) => {
                const picked = e.currentTarget.value;
                e.currentTarget.value = '';
                if (picked) send(socketRune({ uid: gear.uid, ref: picked }));
              }}
            >
              <option value="">{loose.length === 0 ? 'Empty rune slot: no runes held' : 'Empty rune slot'}</option>
              {#each loose as r (r.ref)}
                <option value={r.ref}>{r.icon} {r.name}{r.qty > 1 ? ` ×${r.qty}` : ''}: {lineFor(r, gear.context)}</option>
              {/each}
            </select>
          {/each}
        {:else}
          <p class="dim small">Pick an item to see its sockets.</p>
        {/if}
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
    min-width: 0;
  }

  h2 {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
  }

  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    min-width: 0;
  }

  .bench {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .note {
    margin: 0;
  }

  .dim {
    color: var(--color-text-dim);
  }

  .small {
    font-size: var(--text-sm);
  }

  .strong {
    font-weight: 600;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .stations,
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--tap);
    padding: var(--space-1) var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .line[aria-pressed='true'] {
    border-color: var(--color-accent);
  }

  .label {
    color: var(--color-text-dim);
  }

  .well {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    height: 14rem;
    overflow-y: auto;
    padding: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
  }

  .option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: var(--tap);
    padding: var(--space-1) var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .preview {
    height: 7.5rem;
    overflow-y: auto;
    padding: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
  }

  .risky {
    color: var(--color-warn);
  }

  .list {
    max-height: 18rem;
    overflow-y: auto;
  }

  .list.short {
    max-height: 12rem;
  }

  .held {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) 0;
    border-bottom: var(--border);
  }

  .sockets {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 12rem;
    overflow-y: auto;
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
  }

  .socket {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }

  .socket-select {
    min-height: var(--tap);
    max-width: 100%;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
  }
</style>
