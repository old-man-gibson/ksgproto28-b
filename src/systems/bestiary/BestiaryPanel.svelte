<script lang="ts">
  import type { DeepReadonly } from '../../kernel';
  import { viewOf } from '../../ui/game.svelte';
  import { ITEMS, RUNES } from '../items';
  import { MATERIALS } from '../materials';
  import { MONSTER_TAGS, MONSTERS, monsterTagsOf, TAG_CATEGORIES, TIERS, type MonsterDef, type MonsterTagCategory } from '../monsters';
  import { damageTypeName } from '../mutagens';
  import { PHYSICAL_TYPES } from '../combat';
  import type { DropEntry } from '../loot';
  import bestiary, {
    BESTIARY_FACTS,
    COMMON_DROP_WEIGHT,
    dropChance,
    factChanceAt,
    groupByTaxon,
    monsterProfile,
    queryMonsters,
    tagsInUse,
    type BestiaryFactDef,
    type EntryView,
  } from './index';

  const CATEGORY_NAMES: Record<MonsterTagCategory, string> = {
    material: 'Material',
    taxon: 'Taxonomy',
    element: 'Element',
    tier: 'Tier',
    trait: 'Trait',
    size: 'Size',
  };
  // The old material picker took one tag; the others take several.
  const SINGLE: ReadonlySet<MonsterTagCategory> = new Set(['material']);

  const view = $derived(viewOf(bestiary));
  const tagGroups = tagsInUse();
  const pickers = TAG_CATEGORIES.filter((c) => tagGroups[c]?.length).map((c) => ({ id: c, tags: tagGroups[c]! }));

  let search = $state('');
  let selectedTags = $state<string[]>([]);
  let filtersOpen = $state(false);
  let selectedId = $state<string | null>(null);
  let shownTag = $state<string | null>(null);
  let collapsed = $state<string[]>([]);

  const known = $derived(new Map(view.entries.map((e) => [e.id, e])));
  const filtering = $derived(selectedTags.length > 0 || search.trim().length > 0);
  // Filters narrow what is known only: an unknown species answers nothing.
  // The query reruns on a filter change only; the view changes every frame.
  const matches = $derived(queryMonsters({ search, tags: selectedTags }));
  const results = $derived(matches.filter((d) => known.has(d.id)));
  const shelves = $derived(groupByTaxon(results));
  const entry = $derived<DeepReadonly<EntryView> | undefined>(selectedId ? known.get(selectedId) : undefined);
  const selected = $derived<MonsterDef | null>(entry ? MONSTERS[entry.id] : null);
  const profile = $derived(entry ? monsterProfile(entry.id, [entry.levels[0], entry.levels[1]]) : null);

  function toggleTag(cat: MonsterTagCategory, tag: string): void {
    if (selectedTags.includes(tag)) {
      selectedTags = selectedTags.filter((t) => t !== tag);
      return;
    }
    const rest = SINGLE.has(cat) ? selectedTags.filter((t) => MONSTER_TAGS[t]?.category !== cat) : selectedTags;
    selectedTags = [...rest, tag];
  }

  function toggleShelf(tag: string): void {
    collapsed = collapsed.includes(tag) ? collapsed.filter((t) => t !== tag) : [...collapsed, tag];
  }

  const shelfOpen = (tag: string): boolean => filtering || !collapsed.includes(tag);
  const knows = (id: string): boolean => entry?.facts.includes(id) ?? false;
  const fact = (id: string): BestiaryFactDef => BESTIARY_FACTS.find((f) => f.id === id)!;
  const pct = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)}%`;

  function range(lo: number, hi: number, digits = 0): string {
    const a = lo.toFixed(digits);
    const b = hi.toFixed(digits);
    return a === b ? a : `${a} to ${b}`;
  }

  /** What learning a locked fact takes. */
  function lockText(f: BestiaryFactDef): string {
    const kills = entry?.kills ?? 0;
    if (kills < f.minKills) return `Locked: ${kills} of ${f.minKills} kills before it can roll`;
    if (kills >= f.sureKills) return 'Locked: certain on the next kill';
    return `Locked: ${pct(factChanceAt(view.insight, f))} per kill, certain at ${f.sureKills} kills (${kills} so far)`;
  }

  function dropLabel(d: DropEntry): string {
    switch (d.kind) {
      case 'item':
        return `${ITEMS[d.id!]?.icon ?? '📦'} ${ITEMS[d.id!]?.name ?? d.id}`;
      case 'material':
        return `${MATERIALS[d.id!]?.icon ?? '🧩'} ${MATERIALS[d.id!]?.name ?? d.id}`;
      case 'rune':
        return `${RUNES[d.id!]?.icon ?? '🔷'} ${RUNES[d.id!]?.name ?? d.id}`;
      case 'gold':
        return `🪙 Gold ${d.qty ? `${d.qty[0]} to ${d.qty[1]}` : ''}`;
      default:
        return 'Nothing';
    }
  }

  function dropRows(def: MonsterDef, common: boolean) {
    return def.loot.entries
      .map((e, index) => ({ entry: e as DropEntry, index }))
      .filter(({ entry: e }) => e.kind !== 'nothing' && (common ? e.weight >= COMMON_DROP_WEIGHT : e.weight < COMMON_DROP_WEIGHT))
      .sort((a, b) => b.entry.weight - a.entry.weight)
      .map(({ entry: e, index }) => ({
        label: `${dropLabel(e)}${e.qty && e.kind !== 'gold' ? ` x${e.qty[0]} to ${e.qty[1]}` : ''}${
          e.killedBy?.length ? ` (${e.killedBy.map((t) => damageTypeName(t).toLowerCase()).join(' or ')} kill)` : ''
        }`,
        chance: pct(dropChance(def, index)),
      }));
  }

  function resistanceRows(def: MonsterDef) {
    return Object.entries(def.resistances ?? {})
      .filter(([, v]) => v !== 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([type, v]) => ({
        name: damageTypeName(type as never),
        text: (v ?? 0) > 0 ? `${pct(v ?? 0, 0)} less taken` : `${pct(-(v ?? 0), 0)} more taken`,
        weak: (v ?? 0) < 0,
      }));
  }

  function offenceNotes(def: MonsterDef): string[] {
    const out: string[] = [];
    if (def.passive) out.push('Harmless: attacks, deals no damage.');
    if (!PHYSICAL_TYPES.has(def.damageType))
      out.push(`${damageTypeName(def.damageType)} strikes: armour does not apply; ${damageTypeName(def.damageType).toLowerCase()} resistance does.`);
    return out;
  }

  function defenceNotes(def: MonsterDef): string[] {
    const out: string[] = [];
    if (def.tags.includes('incorporeal')) out.push('Immaterial: most of a weapon passes through it.');
    if (def.escorts?.length) out.push('Guarded: spawns with escorts.');
    return out;
  }

  function behaviourNotes(def: MonsterDef): string[] {
    const group =
      def.group?.max === 1
        ? 'Group: always alone.'
        : (def.group?.min ?? 1) > 1
          ? `Group: packs of ${def.group!.min} to ${def.group!.max ?? 5}.`
          : 'Group: alone, or with other monsters of the same area.';
    const out = [group];
    if (def.escorts?.length) out.push(`Escorts: ${def.escorts.map((id) => MONSTERS[id]?.name ?? id).join(', ')}.`);
    out.push(
      def.range === 'ranged'
        ? 'Rank: fights from the back row; in the front row its attacks are delayed.'
        : 'Rank: fights in melee; from the back row it deals less damage and attacks slower.',
    );
    return out;
  }
</script>

{#snippet locked(f: BestiaryFactDef)}
  <p class="dim">{f.hint}</p>
  <p class="dim">{lockText(f)}</p>
{/snippet}

<section class="panel" aria-label="Bestiary">
  <h2>
    Bestiary
    <span class="dim num">Recorded: {view.known} of {view.total}</span>
  </h2>
  <p class="dim line">
    Insight: {pct(view.insight)} per kill at difficulty 1 (Hunting, Intelligence, Wisdom). Habitat: {view.habitatNeeded} sightings.
  </p>

  <div class="card filters">
    <div class="row">
      <input class="search" type="search" placeholder="Search name or tag" aria-label="Search name or tag" bind:value={search} />
      <button type="button" class="btn" aria-expanded={filtersOpen} onclick={() => (filtersOpen = !filtersOpen)}>
        Tags ({selectedTags.length})
      </button>
      <button type="button" class="btn" disabled={!filtering} onclick={() => ((selectedTags = []), (search = ''))}>Clear</button>
    </div>
    {#if filtersOpen}
      {#each pickers as p (p.id)}
        <div class="picker">
          <span class="dim cat">{CATEGORY_NAMES[p.id]}</span>
          <div class="chips">
            {#each p.tags as tag (tag)}
              <button type="button" class="chip" aria-pressed={selectedTags.includes(tag)} onclick={() => toggleTag(p.id, tag)}>
                {MONSTER_TAGS[tag]?.icon} {MONSTER_TAGS[tag]?.name ?? tag}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="split">
    <div class="card shelves">
      {#if results.length === 0}
        <p class="dim">{filtering ? 'No recorded species matches.' : 'Empty. The first kill of a species opens its entry.'}</p>
      {/if}
      {#each shelves as shelf (shelf.tag)}
        {@const open = shelfOpen(shelf.tag)}
        <div class="shelf">
          <button type="button" class="shelfhead" aria-expanded={open} onclick={() => toggleShelf(shelf.tag)}>
            <span>{open ? '▾' : '▸'} {shelf.icon} {shelf.name}</span>
            <span class="num dim">{shelf.defs.length}</span>
          </button>
          {#if open}
            <div class="cards">
              {#each shelf.defs as def (def.id)}
                {@const e = known.get(def.id)}
                <button type="button" class="mon" aria-pressed={selectedId === def.id} onclick={() => ((selectedId = def.id), (shownTag = null))}>
                  <span class="icon">{def.icon}</span>
                  <span class="name">{def.name}</span>
                  <span class="num dim">{e?.facts.length ?? 0}/{BESTIARY_FACTS.length}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if !filtering && view.total > view.known}
        <p class="dim">Unrecorded: {view.total - view.known} species.</p>
      {/if}
    </div>

    <div class="detail">
      {#if !selected || !entry || !profile}
        <div class="card"><p class="dim">Select an entry.</p></div>
      {:else}
        {@const def = selected}
        <div class="card">
          <h3>{def.icon} {def.name}</h3>
          <p class="dim">
            Tier: {TIERS[def.tier].name}. Level: {range(profile.levels[0], profile.levels[1])}. Killed: {entry.kills}.
          </p>
          <div class="chips">
            {#each monsterTagsOf(def) as tag (tag)}
              <button type="button" class="chip" aria-pressed={shownTag === tag} onclick={() => (shownTag = shownTag === tag ? null : tag)}>
                {MONSTER_TAGS[tag]?.icon ?? ''} {MONSTER_TAGS[tag]?.name ?? tag}
              </button>
            {/each}
          </div>
          <p class="dim taginfo">
            {shownTag ? (MONSTER_TAGS[shownTag]?.desc ?? MONSTER_TAGS[shownTag]?.name ?? shownTag) : 'Tag: select one for its rule.'}
          </p>
        </div>

        <div class="grid">
          <div class="card" class:lock={!knows('rewards')}>
            <h4>🪙 Worth</h4>
            {#if knows('rewards')}
              <p>Experience: <b>{range(profile.xp[0], profile.xp[1])}</b></p>
              <p>Coin: <b>{profile.gold[1] > 0 ? range(profile.gold[0], profile.gold[1]) : 'none'}</b></p>
            {:else}
              {@render locked(fact('rewards'))}
            {/if}
          </div>

          <div class="card">
            <h4>🗺️ Haunts</h4>
            {#if entry.haunts.length === 0}
              <p class="dim">Sightings: none.</p>
            {:else}
              {#each entry.haunts as h (h.spot)}
                <p class="kv" class:dim={!h.confirmed}>
                  <span>{h.icon} {h.name}</span>
                  <b class="num">{h.confirmed ? `den, ${h.count} seen` : `${h.count}/${view.habitatNeeded} seen`}</b>
                </p>
              {/each}
            {/if}
          </div>

          <div class="card" class:lock={!knows('vitals')}>
            <h4>❤️ Vitals</h4>
            {#if knows('vitals')}
              <p>Health: <b>{range(profile.hp[0], profile.hp[1])}</b></p>
              <p>Evasion: <b>{pct(profile.dodge)}</b></p>
            {:else}
              {@render locked(fact('vitals'))}
            {/if}
          </div>

          <div class="card" class:lock={!knows('defenses')}>
            <h4>🛡️ Defences</h4>
            {#if knows('defenses')}
              {@const rows = resistanceRows(def)}
              {#if rows.length === 0}<p class="dim">Resistances: none declared.</p>{/if}
              {#each rows as r (r.name)}
                <p class="kv" class:weak={r.weak}><span>{r.name}</span><b>{r.text}</b></p>
              {/each}
              {#each defenceNotes(def) as n (n)}<p class="dim">{n}</p>{/each}
            {:else}
              {@render locked(fact('defenses'))}
            {/if}
          </div>

          <div class="card" class:lock={!knows('offense')}>
            <h4>⚔️ Offence</h4>
            {#if knows('offense')}
              <p>Damage: <b>{range(profile.damage[0], profile.damage[1], 1)}</b></p>
              <p>Type: <b>{damageTypeName(def.damageType)}</b></p>
              <p>Interval: <b>{profile.attackInterval.toFixed(1)} s</b></p>
              <p>Reach: <b>{def.range === 'ranged' ? 'Ranged' : 'Melee'}</b></p>
              {#each offenceNotes(def) as n (n)}<p class="dim">{n}</p>{/each}
            {:else}
              {@render locked(fact('offense'))}
            {/if}
          </div>

          <div class="card" class:lock={!knows('behavior')}>
            <h4>🧠 Behaviour</h4>
            {#if knows('behavior')}
              {#each behaviourNotes(def) as n (n)}<p>{n}</p>{/each}
            {:else}
              {@render locked(fact('behavior'))}
            {/if}
          </div>

          <div class="card" class:lock={!knows('loot_common')}>
            <h4>🎒 Common Spoils</h4>
            {#if knows('loot_common')}
              {@const rows = dropRows(def, true)}
              {#if rows.length === 0}<p class="dim">Drops: none in this bracket.</p>{/if}
              {#each rows as r, i (i)}<p class="kv"><span>{r.label}</span><b class="num">{r.chance}</b></p>{/each}
            {:else}
              {@render locked(fact('loot_common'))}
            {/if}
          </div>

          <div class="card" class:lock={!knows('loot_rare')}>
            <h4>💎 Rare Spoils</h4>
            {#if knows('loot_rare')}
              {@const rows = dropRows(def, false)}
              {#if rows.length === 0}<p class="dim">Drops: none in this bracket.</p>{/if}
              {#each rows as r, i (i)}<p class="kv"><span>{r.label}</span><b class="num">{r.chance}</b></p>{/each}
            {:else}
              {@render locked(fact('loot_rare'))}
            {/if}
          </div>
        </div>

        <div class="card" class:lock={!knows('lore')}>
          <h4>📝 Field Notes</h4>
          {#if knows('lore')}
            <p>{def.desc ?? 'Notes: none.'}</p>
          {:else}
            {@render locked(fact('lore'))}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  h2 {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  h3,
  h4 {
    margin: 0 0 var(--space-2);
  }

  h3 {
    font-size: var(--text-lg);
  }

  h4 {
    font-size: var(--text-md);
  }

  p {
    margin: 0 0 var(--space-1);
  }

  .line {
    margin: 0;
  }

  .card {
    min-width: 0;
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .lock {
    opacity: 0.75;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .search {
    flex: 1 1 12rem;
    min-width: 0;
    min-height: var(--tap);
    box-sizing: border-box;
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
  }

  .btn,
  .chip,
  .shelfhead,
  .mon {
    box-sizing: border-box;
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .chip {
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .chip[aria-pressed='true'],
  .mon[aria-pressed='true'] {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-text);
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .cat {
    font-size: var(--text-sm);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .taginfo {
    min-height: 2.6em;
    margin-top: var(--space-2);
  }

  .split {
    display: grid;
    grid-template-columns: minmax(14rem, 20rem) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
  }

  .shelves {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .shelf {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .shelfhead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-align: left;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-left: var(--space-2);
  }

  .mon {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: left;
  }

  .mon .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .kv {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .weak b {
    color: var(--color-danger);
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

  @media (max-width: 640px) {
    .split,
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
