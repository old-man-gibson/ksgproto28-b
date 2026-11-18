<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import resources, { setExerting } from '../resources';
  import styles, { pickStyle } from '../styles';
  import martial, {
    chooseFork,
    learnFromTeacher,
    learnSchool,
    POSITIONS,
    setSlotted,
    toggleDrill,
    toggleSheathe,
  } from './index';

  // The martial panel: the stance, the teachers at this spot, the technique
  // slots with their drills, and the position graph as a list of edges. Every
  // block has a fixed height and scrolls inside; a technique's status line has
  // a reserved line, so a running fight never moves the page.
  const view = $derived(viewOf(martial));
  const style = $derived(viewOf(styles));
  const pools = $derived(viewOf(resources));

  /** The technique whose options are open. Click opens them; nothing opens on hover. */
  let open = $state<string | null>(null);

  const posName = (id: string) => (id === 'any' ? 'Any' : (POSITIONS[id]?.name ?? id));
  const fromText = (from: readonly string[] | 'any') => (from === 'any' ? 'Any' : from.map(posName).join(' / '));
  const kindText = { strike: 'Strike', form: 'Form', counter: 'Counter' } as const;
  const formText = { rough: 'Rough', canonical: 'Canonical', syncretic: 'Syncretic' } as const;
  const pct = (m: number | null) => (m === null ? '' : `${m > 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`);

  /** The edges, grouped by the position they leave from; reflexes ("Any") last. */
  const groups = $derived.by(() => {
    const out = new Map<string, { technique: string; to: string }[]>();
    for (const e of view.edges) {
      const key = e.from ?? 'any';
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push({ technique: e.technique, to: e.to });
    }
    return [...out.entries()].sort((a, b) => (a[0] === 'any' ? 1 : b[0] === 'any' ? -1 : 0));
  });
  const nameOf = (id: string) => view.known.find((t) => t.id === id)?.name ?? id;
</script>

<section class="panel" aria-label="Martial">
  <h2>Stance</h2>
  <div class="card stance">
    <div class="slots">
      {#each style.slots as slot (slot.stance)}
        <Button pressed={style.stance === slot.stance} disabled={!slot.unlocked} onclick={() => send(pickStyle({ style: slot.stance }))}>
          <span class="clip">{slot.activeIcon} {slot.activeName}</span>
        </Button>
      {/each}
    </div>
    <div class="line clip">Fighting in: {style.effective.icon} {style.effective.name}</div>
    <div class="line dim clip">Exertion: {style.effective.note || 'none'}</div>
    <div class="row">
      <span class="dim">Exerting: {pools.exerting ? 'on' : 'off'}</span>
      <Button pressed={pools.exerting} onclick={() => send(setExerting({ on: !pools.exerting }))}>
        {pools.exerting ? 'Stop exerting' : 'Exert'}
      </Button>
    </div>
  </div>

  <h2>Teachers here</h2>
  <ul class="card list short" aria-label="Teachers here">
    {#each view.lessons as l (l.npc + (l.technique ?? l.school))}
      <li class="row">
        <span class="name">{l.icon} {l.name} <span class="dim">({l.npcName})</span></span>
        {#if l.state === 'taught'}
          <span class="dim">Taught</span>
        {:else}
          <Button
            variant="primary"
            disabled={l.state !== 'open'}
            onclick={() =>
              send(l.technique ? learnFromTeacher({ npc: l.npc, technique: l.technique }) : learnSchool({ npc: l.npc, school: l.school ?? '' }))}
          >
            {l.state === 'open' ? 'Learn' : 'Held'}
          </Button>
        {/if}
      </li>
    {:else}
      <li class="dim">No teacher stands here.</li>
    {/each}
  </ul>

  <h2>
    Techniques
    <span class="dim num">slots {view.slots.used} / {view.slots.cap}, drills {view.slots.drilled} / {view.slots.drillCap}</span>
  </h2>
  {#if !view.unlocked}
    <p class="dim note">Self-learning is shut on this save: a teacher is the way in.</p>
  {/if}
  <ul class="card list tall" aria-label="Techniques">
    {#each view.known as t (t.id)}
      <li class="tech" class:benched={!t.slotted}>
        <button type="button" class="head" aria-expanded={open === t.id} onclick={() => (open = open === t.id ? null : t.id)}>
          <span class="name">{t.icon} {t.name}</span>
          <span class="num dim">{fromText(t.from)} → {posName(t.to)}</span>
        </button>
        <div class="line dim clip">{kindText[t.kind]}, {formText[t.form]}, {t.tierName ?? 'no rung'}, {t.executions} reps{t.toNext !== null ? `, next in ${t.toNext}` : ''}</div>
        <div class="line clip status">{t.status}</div>
        {#if open === t.id}
          <div class="opts">
            <p class="desc">{t.desc}</p>
            <div class="row wrap">
              <Button pressed={t.drilled} disabled={!t.slotted} onclick={() => send(toggleDrill({ technique: t.id }))}>
                {t.drilled ? 'Stop drilling' : 'Drill'}
              </Button>
              <Button onclick={() => send(setSlotted({ technique: t.id, on: !t.slotted }))}>
                {t.slotted ? 'Bench' : 'Slot'}
              </Button>
            </div>
            {#if t.path}
              <div class="dim">Fork: {t.path}</div>
            {/if}
            {#if t.forkOpen}
              <div class="dim">Honed fork, permanent:</div>
              <div class="row wrap">
                {#each t.forks as f (f.id)}
                  <Button onclick={() => send(chooseFork({ technique: t.id, fork: f.id }))}>{f.icon} {f.name}</Button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {:else}
      <li class="dim">No technique known.</li>
    {/each}
  </ul>

  <h2>Positions</h2>
  <ul class="card list short" aria-label="Positions">
    {#each view.positions as p (p.id)}
      <li class="row">
        <span class="name"><span class="dot" style:background={p.color}></span>{p.icon} {p.name}</span>
        <span class="dim num">
          {p.incomingMult !== null ? `Incoming: ${pct(p.incomingMult)}` : ''}
          {p.dodgeMult !== null ? `Dodge: ${pct(p.dodgeMult)}` : ''}
        </span>
      </li>
    {/each}
  </ul>

  <h2>The plan</h2>
  <ul class="card list" aria-label="Position graph">
    {#each groups as [from, edges] (from)}
      <li>
        <div class="dim">From {posName(from)}</div>
        {#each edges as e (e.technique + e.to)}
          <div class="row edge">
            <span class="name">{nameOf(e.technique)}</span>
            <span class="num dim">→ {posName(e.to)}</span>
          </div>
        {/each}
      </li>
    {:else}
      <li class="dim">No edge: learn a technique.</li>
    {/each}
  </ul>

  {#if view.canSheathe}
    <div class="row card">
      <span class="dim">Sheathed: {view.sheathed ?? 'nothing'}</span>
      <Button onclick={() => send(toggleSheathe())}>{view.sheathed ? 'Draw' : 'Sheathe'}</Button>
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

  .stance {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: var(--space-2);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 14rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .short {
    height: 8rem;
  }

  .tall {
    height: 22rem;
  }

  .tech {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .benched {
    opacity: 0.6;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
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

  .opts {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .wrap {
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .line {
    height: 1.4em;
    line-height: 1.4em;
  }

  .status {
    font-size: var(--text-sm);
  }

  .name,
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

  .dot {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    margin-right: var(--space-2);
    border-radius: 50%;
  }

  .edge {
    padding-left: var(--space-3);
  }

  .desc,
  .note {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
