<script lang="ts">
  // The forge shell. It lists the registries the systems declare, draws a
  // form for one record from the registry's schema, and checks every edit
  // with validateContent, the validator the tests and the kernel use. Saving
  // posts the registry to the dev server, which runs the same check again
  // and writes the JSON file.
  import { collectRegistries, formatIssue, validateContent, type Schema } from '../src/kernel';
  import { systems } from '../src/systems';
  import Button from '../src/ui/components/Button.svelte';

  type Row = Record<string, unknown>;

  const registries = collectRegistries(systems);

  /** Editable copies of every registry's records. */
  let working = $state<Record<string, Row[]>>(
    Object.fromEntries(
      registries.map((entry) => [
        entry.name,
        Array.isArray(entry.def.data) ? (JSON.parse(JSON.stringify(entry.def.data)) as Row[]) : [],
      ]),
    ),
  );
  let registryName = $state(registries[0]?.name ?? '');
  let recordIndex = $state(0);
  let status = $state<{ ok: boolean; text: string } | null>(null);
  let saving = $state(false);

  const entry = $derived(registries.find((candidate) => candidate.name === registryName));
  const records = $derived(working[registryName] ?? []);
  const record = $derived<Row | undefined>(records[recordIndex]);
  const issues = $derived(validateContent(systems, $state.snapshot(working) as Record<string, unknown>));
  const registryIssues = $derived(issues.filter((issue) => issue.registry === registryName));
  const fieldIssues = (key: string) =>
    registryIssues.filter(
      (issue) => issue.index === recordIndex && (issue.path === key || issue.path.startsWith(key + '.')),
    );
  const issueCount = (name: string) => issues.filter((issue) => issue.registry === name).length;

  function selectRegistry(name: string) {
    registryName = name;
    recordIndex = 0;
    status = null;
  }

  function setField(key: string, value: unknown) {
    if (!record) return;
    if (value === undefined) delete record[key];
    else record[key] = value;
    status = null;
  }

  function setJsonField(key: string, text: string) {
    if (text.trim() === '') return setField(key, undefined);
    try {
      setField(key, JSON.parse(text));
    } catch (err) {
      status = { ok: false, text: `${key}: not valid JSON (${(err as Error).message})` };
    }
  }

  const refIds = (name: string) => (working[name] ?? []).map((row) => String(row.id));

  async function save() {
    saving = true;
    try {
      const response = await fetch('/__forge/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registry: registryName, records: $state.snapshot(records) }),
      });
      const body = (await response.json()) as { ok?: boolean; file?: string; error?: string; issues?: unknown[] };
      if (body.ok) status = { ok: true, text: `Wrote ${body.file}` };
      else status = { ok: false, text: body.error ?? `The server refused the edit: ${body.issues?.length ?? 0} issue(s)` };
    } catch (err) {
      status = { ok: false, text: `Save failed: ${(err as Error).message}` };
    } finally {
      saving = false;
    }
  }
</script>

{#snippet field(key: string, schema: Schema)}
  {@const value = record?.[key]}
  <label class="field">
    <span class="label">{schema.label ?? key}{schema.optional ? ' (optional)' : ''}</span>
    {#if schema.kind === 'string'}
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        oninput={(event) =>
          setField(key, event.currentTarget.value === '' && schema.optional ? undefined : event.currentTarget.value)}
      />
    {:else if schema.kind === 'number'}
      <input
        type="number"
        step="any"
        value={typeof value === 'number' ? value : ''}
        oninput={(event) =>
          setField(key, event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value))}
      />
    {:else if schema.kind === 'boolean'}
      <input type="checkbox" checked={value === true} onchange={(event) => setField(key, event.currentTarget.checked)} />
    {:else if schema.kind === 'enum' || schema.kind === 'ref'}
      {@const options = schema.kind === 'enum' ? schema.values : refIds(schema.registry)}
      <select
        value={typeof value === 'string' ? value : ''}
        onchange={(event) => setField(key, event.currentTarget.value === '' ? undefined : event.currentTarget.value)}
      >
        <option value="">(none)</option>
        {#each options as option (option)}
          <option value={option}>{option}</option>
        {/each}
        {#if typeof value === 'string' && !options.includes(value)}
          <option {value}>{value} (not found)</option>
        {/if}
      </select>
    {:else}
      <textarea
        rows="4"
        value={value === undefined ? '' : JSON.stringify(value, null, 2)}
        onchange={(event) => setJsonField(key, event.currentTarget.value)}
      ></textarea>
    {/if}
    {#if schema.help}
      <span class="help">{schema.help}</span>
    {/if}
    {#each fieldIssues(key) as issue (issue.path + issue.message)}
      <span class="issue">{issue.message}</span>
    {/each}
  </label>
{/snippet}

<div class="forge">
  <header>
    <h1>Forge</h1>
    <a href="/">Back to the game</a>
  </header>

  <section class="column" aria-label="Registries">
    <h2>Registries</h2>
    {#if registries.length === 0}
      <p class="dim">No system declares a registry.</p>
    {/if}
    {#each registries as candidate (candidate.name)}
      <Button pressed={candidate.name === registryName} onclick={() => selectRegistry(candidate.name)}>
        {candidate.def.title ?? candidate.name}
        <span class="dim">
          · {candidate.systemId} · {working[candidate.name].length} records{issueCount(candidate.name) > 0
            ? ` · ${issueCount(candidate.name)} issues`
            : ''}
        </span>
      </Button>
    {/each}
  </section>

  {#if entry}
    <section class="column" aria-label="Records">
      <h2>{entry.name}</h2>
      <p class="dim file">{entry.file}</p>
      {#each records as row, index (index)}
        <Button pressed={index === recordIndex} onclick={() => (recordIndex = index)}>
          {String(row.id ?? `#${index}`)}
        </Button>
      {/each}
    </section>

    <section class="column editor" aria-label="Record">
      <h2>Record</h2>
      {#if record}
        {#each Object.entries(entry.def.schema.fields) as [key, schema] (key)}
          {@render field(key, schema)}
        {/each}
      {:else}
        <p class="dim">This registry has no records.</p>
      {/if}

      {#if registryIssues.length > 0}
        <ul class="issues" aria-label="Issues">
          {#each registryIssues as issue, index (index)}
            <li>{formatIssue(issue)}</li>
          {/each}
        </ul>
      {/if}

      <div class="actions">
        <Button variant="primary" disabled={saving || issues.length > 0} onclick={save}>
          Save {entry.name}
        </Button>
        {#if status}
          <span class={status.ok ? 'ok' : 'issue'} role="status">{status.text}</span>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .forge {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 16rem 12rem minmax(0, 1fr);
    gap: var(--space-4);
    min-height: 100vh;
    padding: var(--space-4);
    align-content: start;
  }

  header {
    grid-column: 1 / -1;
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
  }

  h1,
  h2 {
    margin: 0;
  }

  h1 {
    font-size: var(--text-lg);
  }

  h2 {
    font-size: var(--text-md);
  }

  a {
    color: var(--color-accent);
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .editor {
    max-width: 32rem;
  }

  .dim,
  .help {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .file {
    margin: 0;
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .label {
    font-size: var(--text-sm);
  }

  input[type='text'],
  input[type='number'],
  select,
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--tap);
    padding: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }

  textarea {
    font-family: var(--font-mono);
  }

  .issue,
  .issues {
    color: var(--color-danger);
    font-size: var(--text-sm);
  }

  .issues {
    margin: 0;
    padding-left: var(--space-4);
  }

  .ok {
    color: var(--color-ok);
    font-size: var(--text-sm);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  @media (max-width: 800px) {
    .forge {
      grid-template-columns: minmax(0, 1fr);
      padding: var(--space-3);
    }
  }
</style>
