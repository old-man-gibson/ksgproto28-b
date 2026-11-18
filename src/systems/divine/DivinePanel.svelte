<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import { specLines } from '../spellcraft';
  import divine, {
    assignFavor,
    DEITY_LIST,
    DEITY_TAG_CATEGORIES,
    DEITY_TAGS,
    deitiesInRelation,
    deityGroups,
    learnMiracle,
    miracleSpec,
    miraclesOf,
    queryDeities,
  } from './index';

  // The divine panel: standing with the gods, the shelf of known gods with a
  // filter, and each god's miracles, received for favour at a Spellcrafting
  // Table. A god opens on click and stays open until clicked again; nothing
  // opens on hover. No block depends on fight state.
  const view = $derived(viewOf(divine));

  let openGod = $state<string | null>(null);
  let chosen = $state<string[]>([]);
  let search = $state('');

  const known = $derived(DEITY_LIST.filter((d) => view.known.includes(d.id)));

  /** Per axis, the tags some known god carries. An axis nobody carries is not shown. */
  const axes = $derived(
    DEITY_TAG_CATEGORIES.map((axis) => {
      const carried = new Set(known.flatMap((d) => d.tags));
      return { axis, tags: Object.values(DEITY_TAGS).filter((t) => t.category === axis && carried.has(t.tag)) };
    }).filter((a) => a.tags.length > 0),
  );

  const groups = $derived(deityGroups(queryDeities({ search, tags: chosen }, known)));

  function toggleTag(tag: string): void {
    chosen = chosen.includes(tag) ? chosen.filter((t) => t !== tag) : [...chosen, tag];
  }

  const names = (ids: { name: string }[]) => ids.map((d) => d.name).join(', ');
  const label = (axis: string) => axis[0].toUpperCase() + axis.slice(1);
</script>

<section class="panel" aria-label="Divine">
  <h2>
    Standing
    <span class="dim num">Devotion {view.devotion}, unassigned favor {view.floating}</span>
  </h2>
  <p class="card dim note">
    Miracles are not composed. Each belongs to one god and costs favor with that god, spent once. Each quest turn-in
    earns favor with every god you know. Miracles of hostile gods cannot be prepared together.
  </p>
  {#if !view.atTable}
    <p class="card dim note">Miracles are received at a Spellcrafting Table: {view.tables.join(', ')}.</p>
  {/if}

  <h2>Gods <span class="dim num">{known.length} known</span></h2>
  <div class="card filters">
    <div class="row wrap">
      <input class="text" type="search" placeholder="Search names, epithets, descriptions" aria-label="Search the gods" bind:value={search} />
      <Button disabled={chosen.length === 0 && search.trim() === ''} onclick={() => ((chosen = []), (search = ''))}>Clear</Button>
    </div>
    {#each axes as a (a.axis)}
      <div class="axis">
        <span class="dim axis-name">{label(a.axis)}</span>
        <div class="row wrap">
          {#each a.tags as t (t.tag)}
            <Button pressed={chosen.includes(t.tag)} onclick={() => toggleTag(t.tag)}>{t.icon} {t.name}</Button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <div class="shelf">
    {#each groups as group (group.pantheon?.id ?? '')}
      <div class="group">
        <div class="dim">{group.pantheon ? `${group.pantheon.icon} ${group.pantheon.name}` : groups.length > 1 ? 'No pantheon' : ''}</div>
        <div class="grid">
          {#each group.deities as deity (deity.id)}
            {#if openGod === deity.id}
              {@const friends = deitiesInRelation(deity.id, 'synergy', known)}
              {@const foes = deitiesInRelation(deity.id, 'hostile', known)}
              <div class="card god-open">
                <button type="button" class="tile open" aria-expanded="true" onclick={() => (openGod = null)}>
                  <span class="glyph">{deity.icon}</span>
                  <span class="ident">
                    <span class="name">{deity.name}</span>
                    <span class="dim clip">{deity.epithet}</span>
                  </span>
                  <span class="num">Favor {view.favor[deity.id] ?? 0}</span>
                </button>
                <div class="row wrap">
                  {#each deity.tags as t (t)}
                    <span class="chip">{DEITY_TAGS[t]?.icon ?? ''} {DEITY_TAGS[t]?.name ?? t}</span>
                  {/each}
                </div>
                <p class="desc">{deity.desc}</p>
                <div class="dim">Friends: {friends.length ? names(friends) : 'none known'}</div>
                <div class="dim">Foes: {foes.length ? names(foes) : 'none known'}</div>
                {#if view.floating > 0}
                  <div class="row wrap">
                    <Button onclick={() => send(assignFavor({ deity: deity.id }))}>+1 favor (unassigned {view.floating})</Button>
                  </div>
                {/if}
                <ul class="miracles" aria-label="Miracles of {deity.name}">
                  {#each miraclesOf(deity.id) as m (m.id)}
                    {@const reason = view.checks[m.id]}
                    {@const spec = miracleSpec(m.id)}
                    <li class="miracle" class:owned={reason === 'Already received'}>
                      <div class="row">
                        <span class="name">{m.icon} {m.name}</span>
                        <span class="num dim">Favor {m.favorCost}{m.minLevel ? `, Devotion ${m.minLevel}` : ''}</span>
                      </div>
                      {#if m.desc}<div class="dim">{m.desc}</div>{/if}
                      {#if spec}
                        <div class="lines">{#each specLines(spec) as line (line)}<div class="dim">{line}</div>{/each}</div>
                      {/if}
                      <div class="row wrap">
                        {#if reason === 'Already received'}
                          <span class="dim">In your grimoire.</span>
                        {:else if view.atTable}
                          <Button variant="primary" disabled={reason !== null} onclick={() => send(learnMiracle({ miracle: m.id }))}>Receive</Button>
                          <span class="dim clip">{reason ?? 'Ready to receive.'}</span>
                        {:else}
                          <span class="dim clip">{reason ?? 'Affordable. Receive it at a Spellcrafting Table.'}</span>
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ul>
              </div>
            {:else}
              <button type="button" class="tile" aria-expanded="false" onclick={() => (openGod = deity.id)}>
                <span class="glyph">{deity.icon}</span>
                <span class="ident">
                  <span class="name">{deity.name}</span>
                  <span class="dim clip">{deity.epithet}</span>
                </span>
                <span class="num">{view.favor[deity.id] ?? 0}</span>
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {:else}
      <p class="dim">No known god matches.</p>
    {/each}
  </div>
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
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .note {
    margin: 0;
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .axis {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .axis-name {
    font-weight: 600;
  }

  .shelf {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-2);
  }

  .tile {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    min-height: calc(var(--tap) + var(--space-2));
    padding: var(--space-1) var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .tile.open {
    border-color: var(--color-accent);
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

  .god-open {
    display: flex;
    flex-direction: column;
    grid-column: 1 / -1;
    gap: var(--space-2);
  }

  .chip {
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    font-size: var(--text-sm);
    line-height: 1.8;
  }

  .desc {
    margin: 0;
  }

  .miracles {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .miracle {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
  }

  .owned {
    opacity: 0.75;
  }

  .lines {
    display: flex;
    flex-direction: column;
  }

  .text {
    box-sizing: border-box;
    flex: 1;
    min-width: 8rem;
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
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

  .name {
    font-weight: 600;
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
</style>
