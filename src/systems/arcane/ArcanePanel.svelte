<script lang="ts">
  import Button from '../../ui/components/Button.svelte';
  import { send, viewOf } from '../../ui/game.svelte';
  import spellcraft, { castUtility, forgetSpell, renameSpell, setPrepared, specLines } from '../spellcraft';
  import arcane, { ARCANE_WORDS, checkSentenceFor, inscribe, sentenceKey } from './index';

  // The arcane panel: the grimoire, the sentence bench of the Spellcrafting
  // Table, and the known words. Every block has a fixed height and scrolls
  // inside; a row's status line is reserved, so a running fight never moves
  // the page. Click opens a spell's options; nothing opens on hover.
  const view = $derived(viewOf(arcane));
  const book = $derived(viewOf(spellcraft));

  /** The spell whose options are open. */
  let open = $state<number | null>(null);
  let renameText = $state('');

  /** The sentence under construction: word ids, a deep form as `id:tier`. */
  let sentence = $state<string[]>([]);

  const KINDS = [
    { kind: 'noun', label: 'Nouns: the substance' },
    { kind: 'verb', label: 'Verbs: what it does' },
    { kind: 'adverb', label: 'Adverbs: how it is spoken' },
    { kind: 'conjunction', label: 'Conjunctions: how clauses relate' },
    { kind: 'target', label: 'Targets: where it is sent' },
  ] as const;

  const check = $derived.by(() => {
    if (sentence.length === 0) return null;
    const c = checkSentenceFor(view.facts, sentence);
    if (c.ok && view.bookKeys.includes(`arcane:${sentenceKey(sentence)}`)) {
      return { ...c, ok: false, reason: 'Already in your grimoire. Change or add a word to inscribe a new spell' };
    }
    return c;
  });
  const lines = $derived(check?.ok && check.spec ? specLines(check.spec) : []);
  const overPool = $derived(check?.ok && check.spec && check.spec.manaCost > view.manaMax ? check.spec.manaCost : null);

  function tokenName(token: string): string {
    const [id, t] = token.split(':');
    const w = ARCANE_WORDS[id];
    const tier = Number(t ?? 1);
    if (!w) return token;
    return tier > 1 ? (w.stacked?.[tier - 2] ?? `${w.word} ×${tier}`) : w.word;
  }

  function speak(token: string): void {
    if (sentence.length >= view.maxWords) return;
    sentence = [...sentence, token];
  }

  function doInscribe(): void {
    send(inscribe({ words: [...sentence] }));
    sentence = [];
  }

  function toggleOpen(uid: number, name: string): void {
    open = open === uid ? null : uid;
    renameText = name;
  }

  const secs = (ticks: number) => `${+(ticks / 10).toFixed(1)} s`;
</script>

<section class="panel" aria-label="Arcane">
  <h2>
    Grimoire
    <span class="dim num">prepared {book.prepared.length} / {book.cap}</span>
  </h2>
  <ul class="card list tall" aria-label="Grimoire">
    {#each book.book as spell (spell.uid)}
      <li class="spell" class:unprepared={!spell.prepared}>
        <div class="row">
          <button type="button" class="head" aria-expanded={open === spell.uid} onclick={() => toggleOpen(spell.uid, spell.name)}>
            <span class="name">{spell.icon} {spell.name}</span>
            <span class="num dim">{spell.manaCost} mana</span>
          </button>
          <span class="toggle">
            <Button pressed={spell.prepared} onclick={() => send(setPrepared({ uid: spell.uid, prepared: !spell.prepared }))}>
              {spell.prepared ? 'Prepared' : 'Prepare'}
            </Button>
          </span>
        </div>
        <div class="line dim clip">{spell.school}: {spell.source}, cooldown {secs(spell.cooldown)}</div>
        {#if open === spell.uid}
          <div class="opts">
            <div class="row wrap">
              <input class="text" aria-label="Name" bind:value={renameText} maxlength="40" />
              <Button onclick={() => send(renameSpell({ uid: spell.uid, name: renameText }))}>Rename</Button>
            </div>
            <div class="row wrap">
              <Button disabled={spell.utility !== null} onclick={() => send(castUtility({ uid: spell.uid }))}>Cast now</Button>
              <span class="dim clip">{spell.utility ?? 'Ready to cast outside a fight.'}</span>
            </div>
            <div class="row wrap">
              <Button onclick={() => send(forgetSpell({ uid: spell.uid }))}>Forget</Button>
            </div>
          </div>
        {/if}
      </li>
    {:else}
      <li class="dim">The grimoire is empty.</li>
    {/each}
  </ul>

  <h2>
    Spellcrafting Table
    <span class="dim num">Arcana {view.level}, {sentence.length} / {view.maxWords} words</span>
  </h2>
  {#if view.atTable}
    <div class="card bench">
      <div class="strip" aria-label="Sentence">
        {#each sentence as token, i (i)}
          <button type="button" class="tile" title="Remove" onclick={() => (sentence = sentence.filter((_, j) => j !== i))}>
            {tokenName(token)}
          </button>
        {:else}
          <span class="dim">Tap words below to build a sentence. Tap a word in the sentence to remove it.</span>
        {/each}
      </div>
      <div class="check" aria-live="polite">
        {#if check === null}
          <div class="dim">No sentence.</div>
        {:else if !check.ok}
          <div class="warn">Refused: {check.reason}</div>
        {:else if check.spec}
          <div>{check.spec.icon} {check.spec.name}</div>
          {#each lines as line (line)}<div class="dim">{line}</div>{/each}
          {#if overPool !== null}
            <div class="warn">Mana: {overPool} per cast, the pool holds {Math.floor(view.manaMax)}. It inscribes and never casts.</div>
          {/if}
        {/if}
      </div>
      <div class="row wrap">
        <Button variant="primary" disabled={!check?.ok} onclick={doInscribe}>Inscribe</Button>
        <Button disabled={sentence.length === 0} onclick={() => (sentence = [])}>Clear</Button>
      </div>
      <div class="lexicon">
        {#each KINDS as k (k.kind)}
          {@const ws = view.words.filter((w) => w.kind === k.kind)}
          {#if ws.length > 0}
            <div class="dim">{k.label}</div>
            <div class="row wrap">
              {#each ws as w (w.id)}
                <Button disabled={!w.usable || sentence.length >= view.maxWords} title={w.usable ? undefined : `Needs Arcana ${w.minLevel}`} onclick={() => speak(w.id)}>
                  {w.icon} {w.word}{w.usable ? '' : ` (Arcana ${w.minLevel})`}
                </Button>
                {#each w.stacked.slice(0, w.tier - 1) as deep, d (deep)}
                  <Button disabled={!w.usable || sentence.length >= view.maxWords} onclick={() => speak(`${w.id}:${d + 2}`)}>
                    {w.icon} {deep}
                  </Button>
                {/each}
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {:else}
    <p class="card dim note">A sentence is inscribed at a Spellcrafting Table: {view.tables.join(', ')}.</p>
  {/if}

  <h2>Words</h2>
  <ul class="card list" aria-label="Words">
    {#each view.words as w (w.id)}
      <li class="word">
        <div class="row">
          <span class="name">{w.icon} {w.word} <span class="dim">({w.kind})</span></span>
          <span class="num dim">Lv {w.level}</span>
        </div>
        <div class="bar" aria-hidden="true"><div class="fill" style:width="{Math.min(100, (w.xp / Math.max(1, w.xpNeeded)) * 100)}%"></div></div>
        <div class="line dim clip">
          Sentences: {w.uses}{w.nextNeed !== null ? `, next form at ${w.nextNeed}` : ''}{w.stacked.length ? `, forms: ${w.stacked.join(', ')}` : ''}
        </div>
        <div class="line dim clip">Gift at 10, 25, 45: {w.gift || 'none'}</div>
      </li>
    {:else}
      <li class="dim">No word known.</li>
    {/each}
  </ul>
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

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 16rem;
    margin: 0;
    overflow-y: auto;
    list-style: none;
  }

  .tall {
    height: 18rem;
  }

  .spell,
  .word {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .unprepared {
    opacity: 0.7;
  }

  .head {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
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

  .toggle {
    display: grid;
    flex: none;
    width: 7.5rem;
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

  .bench {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .strip {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: var(--space-2);
    min-height: calc(var(--tap) * 2 + var(--space-2));
  }

  .tile {
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .check {
    height: 9rem;
    overflow-y: auto;
    font-size: var(--text-sm);
  }

  .lexicon {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 18rem;
    overflow-y: auto;
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

  .line {
    height: 1.4em;
    line-height: 1.4em;
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

  .warn {
    color: var(--color-warn);
  }

  .note {
    margin: 0;
  }

  .bar {
    height: 0.35rem;
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--color-accent);
  }
</style>
