<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import log from '../log';
  import { MONSTER_LIST } from '../monsters';
  import resources from '../resources';
  import combat, { hunt, stopHunt, type EncounterSite } from './index';

  // The combat panel. Layout rule: nothing here changes size or position with
  // per-tick or per-fight state. The five enemy slots, the status line and
  // the log are reserved at fixed heights whether a fight is open or not.
  const view = $derived(viewOf(combat));
  const pools = $derived(viewOf(resources));
  const feed = $derived(viewOf(log).combatFeed);

  const hp = $derived(pools.pools.find((p) => p.id === 'hp')!);
  const stamina = $derived(pools.pools.find((p) => p.id === 'stamina')!);

  // Dev encounter: until the world port sends a site, the panel builds one
  // from a monster and a level picked here.
  let monsterId = $state('forest_rat');
  let level = $state(1);
  let lastReason = $state<string | null>(null);

  const monsters = [...MONSTER_LIST].sort((a, b) => a.name.localeCompare(b.name));

  function start() {
    const def = MONSTER_LIST.find((m) => m.id === monsterId);
    const lv = Math.max(1, Math.floor(level) || 1);
    const site: EncounterSite = {
      id: `dev_${monsterId}`,
      name: `Dev: ${def?.name ?? monsterId}`,
      encounters: [{ monsterId, weight: 1, level: [lv, lv] }],
    };
    const result = send(hunt({ site }));
    lastReason = result.ok ? null : result.reason;
  }

  function stop() {
    const result = send(stopHunt());
    lastReason = result.ok ? null : result.reason;
  }

  const share = (value: number, max: number) => `${Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0))}%`;
  const whole = (value: number) => Math.max(0, Math.ceil(value)).toLocaleString('en-US');

  const status = $derived(
    lastReason
      ? `Not done: ${lastReason}.`
      : view.inFight
        ? view.forced
          ? 'Forced fight. It cannot be left.'
          : `Fighting at ${view.site?.name ?? 'the site'}.`
        : view.resting
          ? 'Resting before the next fight.'
          : view.hunting
            ? `Hunting at ${view.site?.name ?? 'the site'}. Next fight in ${view.respawnIn.toFixed(1)} s.`
            : 'No hunt is on.',
  );

  // The log scrolls inside its box. It follows the newest line.
  let logBox: HTMLOListElement | undefined = $state();
  $effect(() => {
    void feed.length;
    void feed[feed.length - 1]?.text;
    if (logBox) logBox.scrollTop = logBox.scrollHeight;
  });
</script>

<section class="panel" aria-label="Combat">
  <div class="card controls">
    <label class="field">
      <span class="dim">Monster</span>
      <select bind:value={monsterId} data-testid="combat-monster">
        {#each monsters as m (m.id)}
          <option value={m.id}>{m.name} ({m.tier})</option>
        {/each}
      </select>
    </label>
    <label class="field narrow">
      <span class="dim">Level</span>
      <input type="number" min="1" max="99" bind:value={level} data-testid="combat-level" />
    </label>
    <div class="buttons">
      <Button variant="primary" onclick={start}>Start</Button>
      <Button onclick={stop}>Abandon</Button>
    </div>
  </div>

  <p class="status" role="status" data-testid="combat-status">{status}</p>

  <div class="card you" aria-label="You">
    <div class="bar-row">
      <span class="label">HP</span>
      <span class="bar"><span class="fill hp" style:width={share(hp.value, hp.max)}></span></span>
      <span class="num" data-testid="combat-hp">{whole(hp.value)} / {whole(hp.max)}</span>
    </div>
    <div class="bar-row">
      <span class="label">Stamina</span>
      <span class="bar"><span class="fill stamina" style:width={share(stamina.value, stamina.max)}></span></span>
      <span class="num">{whole(stamina.value)} / {whole(stamina.max)}</span>
    </div>
    <div class="bar-row">
      <span class="label">Action</span>
      <span class="bar"><span class="fill action" style:width={share(view.playerBar, 1)}></span></span>
      <span class="num">{Math.round(view.playerBar * 100)}%</span>
    </div>
  </div>

  <ol class="enemies" aria-label="Enemies">
    {#each view.enemies as enemy, slot (slot)}
      <li class="card enemy" class:empty={!enemy} data-testid="enemy-slot-{slot}">
        {#if enemy}
          <div class="head">
            <span class="name">{enemy.icon} {enemy.name}</span>
            <span class="num"><span class="conditions">{enemy.conditions.join('')}</span> Lv {enemy.level}</span>
          </div>
          <div class="bar-row">
            <span class="bar"><span class="fill hp" style:width={share(enemy.hp, enemy.maxHp)}></span></span>
            <span class="num">{whole(enemy.hp)} / {whole(enemy.maxHp)}</span>
          </div>
          <div class="bar-row">
            <span class="bar thin"><span class="fill action" style:width={share(enemy.bar, 1)}></span></span>
          </div>
        {:else}
          <div class="head"><span class="name dim">{slot === 0 ? 'Centre slot' : `Slot ${slot + 1}`}</span></div>
          <div class="bar-row"><span class="bar"></span><span class="num dim">empty</span></div>
          <div class="bar-row"><span class="bar thin"></span></div>
        {/if}
      </li>
    {/each}
  </ol>

  <h2>Fight log</h2>
  <ol class="card log" aria-label="Fight log" bind:this={logBox}>
    {#each feed as line, i (i)}
      <li>
        {line.text}
        {#each line.afflictions ?? [] as run, j (j)}
          <span class="dim"> · {run.prefix} {run.tally.map((t) => (t.style === 'amount' ? `${Math.round(t.qty)} ${t.label}` : `${t.label} x${t.qty}`)).join(', ')}</span>
        {/each}
      </li>
    {:else}
      <li class="dim">No fight yet.</li>
    {/each}
  </ol>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 48rem;
  }

  h2 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }

  .card {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex: 1 1 12rem;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .field.narrow {
    flex: 0 0 5rem;
  }

  select,
  input {
    box-sizing: border-box;
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    width: 100%;
  }

  .buttons {
    display: flex;
    gap: var(--space-2);
  }

  /* One line, always present: the text changes, the height does not. */
  .status {
    height: 1.5rem;
    margin: 0;
    overflow: hidden;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .you {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 1.25rem;
    min-width: 0;
  }

  .label {
    flex: 0 0 4rem;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .bar {
    position: relative;
    flex: 1 1 auto;
    height: 0.75rem;
    min-width: 0;
    overflow: hidden;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
  }

  .bar.thin {
    height: 0.4rem;
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
  }

  .fill.hp {
    background: var(--color-danger);
  }

  .fill.stamina {
    background: var(--color-ok);
  }

  .fill.action {
    background: var(--color-warn);
  }

  .num {
    flex: 0 0 7.5rem;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  /* Five slots, always. Each slot has a fixed height. */
  .enemies {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .enemy {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    height: 6.5rem;
    min-width: 0;
    padding: var(--space-2);
    overflow: hidden;
  }

  .enemy.empty {
    border-style: dashed;
  }

  .enemy .num {
    flex: 0 0 auto;
    max-width: 60%;
  }

  .enemy .bar-row {
    flex: none;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    height: 2.5rem;
    min-width: 0;
  }

  .name {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.25rem;
  }

  .conditions {
    font-family: var(--font-body);
  }

  /* Fixed height, scrolling inside: a new line does not move the page. */
  .log {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    height: 16rem;
    margin: 0;
    overflow-y: auto;
    font-size: var(--text-sm);
    list-style: none;
  }

  .dim {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  @media (max-width: 640px) {
    /* One column of five rows on a phone. The rows keep a fixed height. */
    .enemies {
      grid-template-columns: minmax(0, 1fr);
    }

    .enemy {
      gap: 0;
      height: 3.5rem;
      padding: var(--space-1) var(--space-2);
    }

    .enemy .bar-row {
      height: 1rem;
    }

    .enemy .bar-row:last-child {
      height: 0.75rem;
    }

    .head {
      height: 1.25rem;
    }

    .name {
      display: block;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .num {
      flex-basis: 6.5rem;
    }

    .log {
      height: 12rem;
    }
  }
</style>
