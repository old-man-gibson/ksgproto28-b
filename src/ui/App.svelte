<script lang="ts">
  import { TPS } from '../kernel';
  import { panels } from '../systems/panels';
  import Button from './components/Button.svelte';
  import DevLog from './DevLog.svelte';
  import { MODE } from './env';
  import { game, setAsideBrokenSave } from './game.svelte';
  import { setTheme, theme, THEMES, type ThemeName } from './theme.svelte';

  const DEV = import.meta.env.DEV;

  let activeId = $state(panels[0]?.systemId ?? '');
  const active = $derived(panels.find((panel) => panel.systemId === activeId) ?? panels[0]);
  let backupNote = $state<string | null>(null);

  function gameTime(tick: number): string {
    const seconds = Math.floor(tick / TPS);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  }

  function setAside() {
    const key = setAsideBrokenSave();
    backupNote = key ? `The old save text is kept in browser storage under "${key}".` : null;
  }

  const percent = $derived(game.catchUp ? Math.floor((game.catchUp.done / game.catchUp.total) * 100) : 0);
</script>

<div class="shell">
  <header>
    <h1>ksgproto28-b</h1>
    <span class="clock" title="Game time">{gameTime(game.view.tick)}</span>
    <span class="spacer"></span>
    {#if DEV}
      <a class="link" href="/forge/">Forge</a>
    {/if}
    <label class="theme">
      <span>Theme</span>
      <select value={theme.current} onchange={(event) => setTheme(event.currentTarget.value as ThemeName)}>
        {#each THEMES as name (name)}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </label>
  </header>

  <nav aria-label="Panels">
    {#each panels as panel (panel.systemId)}
      <Button pressed={panel.systemId === active?.systemId} onclick={() => (activeId = panel.systemId)}>
        {panel.title}
      </Button>
    {/each}
  </nav>

  <main>
    {#if game.loadError}
      <div class="notice danger" role="alert">
        <p><strong>The stored save could not be loaded.</strong> {game.loadError}</p>
        <p>
          A new game is running. It is not being saved, so the stored save is unchanged. Storage key:
          <code>{game.storageKey}</code>.
        </p>
        <Button onclick={setAside}>Keep a backup of the stored save and save the new game</Button>
      </div>
    {:else if game.problem}
      <div class="notice warn" role="status">{game.problem}</div>
    {/if}
    {#if backupNote}
      <div class="notice" role="status">{backupNote}</div>
    {/if}

    {#if active}
      {@const Panel = active.component}
      <Panel />
    {:else}
      <p>No system has a panel.</p>
    {/if}
  </main>

  <footer>
    <span>Mode: {MODE}</span>
    <span>
      {#if game.loadError}Not saving{:else if game.savedAt}Saved {new Date(game.savedAt).toLocaleTimeString()}{:else}Not saved yet{/if}
    </span>
  </footer>

  {#if game.catchUp}
    <div class="catch-up" role="alertdialog" aria-label="Catching up">
      <div class="catch-up-box">
        <p>Simulating time away: {percent}%</p>
        <progress max={game.catchUp.total} value={game.catchUp.done}></progress>
      </div>
    </div>
  {/if}

  {#if DEV}
    <DevLog />
  {/if}
</div>

<style>
  /* Desktop: header on top, navigation on the left. Phone (640px and
     narrower): one column, navigation as a bar at the bottom. */
  .shell {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: var(--nav-width) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'header header'
      'nav main'
      'nav footer';
    min-height: 100vh;
    min-height: 100dvh;
  }

  header {
    grid-area: header;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border);
    background: var(--color-surface);
  }

  h1 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .clock {
    font-family: var(--font-mono);
    color: var(--color-text-dim);
  }

  .spacer {
    flex: 1;
  }

  .link {
    color: var(--color-accent);
  }

  .theme {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-dim);
  }

  select {
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
  }

  nav {
    grid-area: nav;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-right: var(--border);
    background: var(--color-surface);
  }

  main {
    grid-area: main;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
    padding: var(--space-4);
  }

  footer {
    grid-area: footer;
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-top: var(--border);
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .notice {
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow-wrap: anywhere;
  }

  .notice p {
    margin: 0 0 var(--space-2);
  }

  .notice.danger {
    border-color: var(--color-danger);
  }

  .notice.warn {
    border-color: var(--color-warn);
  }

  code {
    font-family: var(--font-mono);
  }

  .catch-up {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--color-overlay);
  }

  .catch-up-box {
    box-sizing: border-box;
    width: min(24rem, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-4);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    box-shadow: var(--shadow);
  }

  .catch-up-box p {
    margin: 0 0 var(--space-2);
  }

  progress {
    width: 100%;
  }

  @media (max-width: 640px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto auto;
      grid-template-areas:
        'header'
        'main'
        'footer'
        'nav';
    }

    nav {
      position: sticky;
      bottom: 0;
      flex-direction: row;
      overflow-x: auto;
      padding: var(--space-2);
      padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
      border-right: none;
      border-top: var(--border);
    }

    header {
      padding: var(--space-2) var(--space-3);
    }

    main {
      padding: var(--space-3);
    }
  }
</style>
