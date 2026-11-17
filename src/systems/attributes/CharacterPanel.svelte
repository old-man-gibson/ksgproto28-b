<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import type { DeepReadonly } from '../../kernel';
  import { send, viewOf } from '../../ui/game.svelte';
  import clock from '../clock';
  import levels from '../levels';
  import resources, { setExerting } from '../resources';
  import skills, { type SkillNodeView } from '../skills';
  import StatusList from '../statuses/StatusList.svelte';
  import attributes from './index';

  const attrs = $derived(viewOf(attributes));
  const level = $derived(viewOf(levels));
  const pools = $derived(viewOf(resources));
  const tree = $derived(viewOf(skills));
  const time = $derived(viewOf(clock));

  let lastReason = $state<string | null>(null);

  function toggleExertion() {
    const result = send(setExerting({ on: !pools.exerting }));
    lastReason = result.ok ? null : result.reason;
  }

  const share = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0);
  const one = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const whole = (value: number) => Math.floor(value).toLocaleString('en-US');
</script>

{#snippet skillNode(node: DeepReadonly<SkillNodeView>, depth: number)}
  <li class="skill" style:--depth={depth}>
    <div class="row">
      <span class="name">
        {#if node.state === 'unlocked'}{node.icon} {node.name}{:else}❔ Unknown skill{/if}
      </span>
      <span class="num">
        {#if node.state === 'unlocked'}Lv {node.level}{#if node.cap !== null}&nbsp;/ {node.cap}{/if}{/if}
      </span>
    </div>
    {#if node.state === 'unlocked'}
      <div class="bar thin" role="presentation">
        <div class="fill xp" style:width="{share(node.xp, node.xpNeeded)}%"></div>
      </div>
    {/if}
  </li>
  {#each node.children as child (child.id)}
    {@render skillNode(child, depth + 1)}
  {/each}
{/snippet}

<section class="panel" aria-label="Character">
  <div class="card head">
    <div class="row">
      <span class="title">Level <span class="num" data-testid="character-level">{level.level}</span></span>
      <span class="dim num">{whole(level.levelXp)} / {whole(level.xpToNext)} XP</span>
    </div>
    <div class="bar" role="presentation">
      <div class="fill xp" style:width="{share(level.levelXp, level.xpToNext)}%"></div>
    </div>
    <div class="row dim">
      <span class="clip">{time.date}</span>
      <span class="num">{time.time}</span>
    </div>
  </div>

  <h2>Pools</h2>
  <ul class="card list">
    {#each pools.pools as pool (pool.id)}
      <li>
        <div class="row">
          <span class="name">{pool.icon} {pool.name}</span>
          <span class="num" data-testid="pool-{pool.id}">{one(pool.value)} / {whole(pool.max)}</span>
        </div>
        <div class="bar" role="presentation">
          <div class="fill {pool.id}" style:width="{share(pool.value, pool.max)}%"></div>
          {#if pool.reserve > 0}<div class="mark" style:margin-left="{pool.reserve * 100}%"></div>{/if}
        </div>
        <!-- One line is always reserved, so a lock appearing does not move the list. -->
        <div class="lock" role="status">{pool.lockName ?? ''}</div>
      </li>
    {/each}
  </ul>
  <div class="row actions">
    <Button pressed={pools.exerting} onclick={toggleExertion}>
      Exertion: {pools.exerting ? 'on' : 'off'}
    </Button>
    <span class="reason" role="status">{lastReason ?? ''}</span>
  </div>

  <StatusList />

  <h2>Attributes</h2>
  <ul class="card list">
    {#each attrs.attributes as attr (attr.id)}
      <li>
        <div class="row">
          <span class="name">{attr.icon} {attr.name}</span>
          <span class="num" data-testid="attr-{attr.id}">{one(attr.value)}</span>
        </div>
        <div class="row dim">
          <span class="clip">{attr.rank}</span>
          <span class="num">Trained {attr.level}</span>
        </div>
        <div class="bar thin" role="presentation">
          <div class="fill xp" style:width="{share(attr.xp, attr.xpNeeded)}%"></div>
        </div>
      </li>
    {/each}
  </ul>

  <h2>Skills <span class="dim num">{tree.held}</span></h2>
  {#if tree.categories.length === 0}
    <p class="card dim empty">No skill yet. A skill appears when an action trains it.</p>
  {:else}
    {#each tree.categories as category (category.id)}
      <h3>{category.icon} {category.name}</h3>
      <ul class="card list">
        {#each category.nodes as node (node.id)}
          {@render skillNode(node, 0)}
        {/each}
      </ul>
    {/each}
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 36rem;
  }

  h2,
  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  h3 {
    font-size: var(--text-md);
  }

  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .title {
    font-size: var(--text-lg);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .name,
  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Numbers that change every tick: fixed-width digits, never wrapping, so
     the text beside them does not move. */
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

  /* A grid with one cell, so the fill and the reserve mark overlap without
     positioning. A positioned bar would paint over the shell's navigation. */
  .bar {
    display: grid;
    height: var(--space-2);
    margin-top: var(--space-1);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    overflow: hidden;
  }

  .bar.thin {
    height: var(--space-1);
  }

  .fill,
  .mark {
    grid-area: 1 / 1;
    height: 100%;
  }

  .fill {
    background: var(--color-accent);
  }

  .fill.hp {
    background: var(--color-danger);
  }

  .fill.stamina {
    background: var(--color-ok);
  }

  .fill.spirit {
    background: var(--color-warn);
  }

  .fill.focus,
  .fill.xp {
    background: var(--color-text-dim);
  }

  .mark {
    width: 1px;
    background: var(--color-text);
  }

  .lock {
    min-height: 1.4em;
    color: var(--color-warn);
    font-size: var(--text-sm);
  }

  .actions {
    align-items: center;
    justify-content: flex-start;
  }

  .reason {
    min-height: 1.4em;
    color: var(--color-warn);
    font-size: var(--text-sm);
  }

  .skill {
    padding-left: calc(var(--depth) * var(--space-4));
  }

  .empty {
    margin: 0;
  }
</style>
