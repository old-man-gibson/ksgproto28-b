import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveRegistry } from '../forge/server/save';
import {
  collectRegistries,
  createKernel,
  defineSystem,
  formatIssue,
  registry,
  registryFile,
  s,
  validateContent,
  type Infer,
} from '../src/kernel';
import { systems } from '../src/systems';
import { exists, readJson } from './helpers';

const steps = () => readJson('src/systems/counter/content/steps.json') as Record<string, unknown>[];

describe('content', () => {
  it('the shipped content has no issues', () => {
    expect(validateContent(systems).map(formatIssue)).toEqual([]);
  });

  it('every registry is a JSON data file at the path the convention gives', () => {
    const entries = collectRegistries(systems);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.file).toBe(registryFile(entry.systemId, entry.name));
      expect(exists(entry.file), `${entry.file} must exist`).toBe(true);
      // The declaration holds the same data as the file.
      expect(entry.def.data).toEqual(readJson(entry.file));
    }
  });

  it('fails on a duplicate id', () => {
    const data = steps();
    data.push({ ...data[0] });
    const issues = validateContent(systems, { steps: data });
    expect(issues.map(formatIssue)).toEqual(['steps[small_step].id: duplicate id "small_step"']);
  });

  it('fails on a wrong type, a missing field, an unknown field and a bad id', () => {
    const data = steps();
    data[0] = { ...data[0], cost: 'ten', extra: 1 };
    delete data[1].name;
    data[2] = { ...data[2], id: 'Bad Id' };
    const messages = validateContent(systems, { steps: data }).map(formatIssue);
    expect(messages).toContain('steps[small_step].cost: expected a finite number');
    expect(messages).toContain('steps[small_step].extra: unknown field');
    expect(messages).toContain('steps[big_step].name: missing');
    expect(messages.filter((message) => message.startsWith('steps[Bad Id].id'))).toHaveLength(1);
  });

  it('fails on a number out of range', () => {
    const data = steps();
    data[0] = { ...data[0], costGrowth: 0.5 };
    expect(validateContent(systems, { steps: data }).map(formatIssue)).toEqual([
      'steps[small_step].costGrowth: below the minimum 1',
    ]);
  });

  it('fails on a reference to a record that does not exist', () => {
    const data = steps();
    data[1] = { ...data[1], requires: 'missing_step' };
    expect(validateContent(systems, { steps: data }).map(formatIssue)).toEqual([
      'steps[big_step].requires: "missing_step" is not a record of "steps"',
    ]);
  });

  it('fails when the file is not a list', () => {
    expect(validateContent(systems, { steps: { id: 'x' } }).map(formatIssue)).toEqual([
      'steps: expected a list of records',
    ]);
  });

  it('resolves references across registries of different systems', () => {
    const a = defineSystem({
      id: 'a',
      version: 1,
      initial: () => ({}),
      content: { things: registry(s.object({ id: s.id() }), [{ id: 'one' }]) },
    });
    const b = (target: string) =>
      defineSystem({
        id: 'b',
        version: 1,
        initial: () => ({}),
        content: {
          users: registry(s.object({ id: s.id(), uses: s.array(s.ref('things')) }), [{ id: 'u', uses: ['one', target] }]),
        },
      });
    expect(validateContent([a, b('one')])).toEqual([]);
    expect(validateContent([a, b('two')]).map(formatIssue)).toEqual([
      'users[u].uses.1: "two" is not a record of "things"',
    ]);
  });

  it('rejects two systems that declare the same registry name', () => {
    const make = (id: string) =>
      defineSystem({ id, version: 1, initial: () => ({}), content: { things: registry(s.object({ id: s.id() }), []) } });
    expect(() => collectRegistries([make('a'), make('b')])).toThrow(/declared by both/);
  });

  it('the kernel refuses to start on invalid content', () => {
    const broken = defineSystem({
      id: 'broken',
      version: 1,
      initial: () => ({}),
      content: { things: registry(s.object({ id: s.id() }), [{ id: 'x' }, { id: 'x' }]) },
    });
    expect(() => createKernel({ systems: [broken] })).toThrow(/duplicate id "x"/);
  });

  it('infers the record type from the schema', () => {
    const schema = s.object({
      id: s.id(),
      kind: s.enum(['a', 'b']),
      tags: s.array(s.string()),
      note: s.optional(s.string()),
    });
    const record: Infer<typeof schema> = { id: 'x', kind: 'a', tags: [] };
    // @ts-expect-error "c" is not a value of the enum
    const wrong: Infer<typeof schema> = { id: 'x', kind: 'c', tags: [] };
    expect(record.note).toBeUndefined();
    expect(wrong.kind).toBe('c');
  });
});

describe('forge save', () => {
  const dirs: string[] = [];
  const tempRoot = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksgb-forge-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a valid edit to the registry file', () => {
    const root = tempRoot();
    const data = steps();
    data[0] = { ...data[0], name: 'Tiny step' };
    const result = saveRegistry(root, systems, 'steps', data);
    expect(result).toEqual({ ok: true, file: 'src/systems/counter/content/steps.json' });
    const written = fs.readFileSync(path.join(root, 'src/systems/counter/content/steps.json'), 'utf8');
    expect(JSON.parse(written)).toEqual(data);
    expect(written.endsWith('\n')).toBe(true);
  });

  it('uses the same validator and writes nothing when the edit has an issue', () => {
    const root = tempRoot();
    const data = steps();
    data.push({ ...data[0] });
    const result = saveRegistry(root, systems, 'steps', data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(validateContent(systems, { steps: data }));
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
  });

  it('refuses a registry that no system declares', () => {
    const root = tempRoot();
    expect(saveRegistry(root, systems, '../../etc/passwd', []).ok).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
