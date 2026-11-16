/**
 * Content registries. A registry is a list of records in one JSON file, with
 * one schema, declared by the system that owns it. `validateContent` is the
 * only validator: the tests, the kernel and the forge all call it.
 */
import { ID_PATTERN, validateValue, type FoundRef, type Infer, type ObjectSchema, type Schema } from './schema';
import type { AnySystem } from './system';

export interface RegistryDef<T = unknown> {
  schema: ObjectSchema;
  /** The parsed JSON file. Unchecked until validated. */
  data: unknown;
  title?: string;
  /** Type marker only. Never set. */
  readonly __record?: T;
}

/** Declare a registry. The record schema must have an `id` field. */
export function registry<F extends Record<string, Schema> & { id: Schema }>(
  schema: ObjectSchema<F>,
  data: unknown,
  title?: string,
): RegistryDef<Infer<ObjectSchema<F>>> {
  return { schema: schema as ObjectSchema, data, title };
}

export type RecordOf<R> = R extends RegistryDef<infer T> ? T : never;

export interface RegistryEntry {
  name: string;
  systemId: string;
  def: RegistryDef;
  /** Path of the data file from the repository root. Fixed by convention. */
  file: string;
}

export function registryFile(systemId: string, name: string): string {
  return `src/systems/${systemId}/content/${name}.json`;
}

const REGISTRY_NAME = /^[a-z][a-z0-9_]*$/;

/** Every registry of every system. Throws when two systems use one name. */
export function collectRegistries(systems: readonly AnySystem[]): RegistryEntry[] {
  const out: RegistryEntry[] = [];
  const owner = new Map<string, string>();
  for (const system of systems) {
    for (const [name, def] of Object.entries(system.content ?? {})) {
      if (!REGISTRY_NAME.test(name))
        throw new Error(`registry "${name}" of system "${system.id}" must match ${REGISTRY_NAME.source}`);
      const other = owner.get(name);
      if (other !== undefined)
        throw new Error(`registry "${name}" is declared by both "${other}" and "${system.id}"`);
      owner.set(name, system.id);
      out.push({ name, systemId: system.id, def, file: registryFile(system.id, name) });
    }
  }
  return out;
}

export interface Issue {
  registry: string;
  /** The record id, when the record has a usable one. */
  id?: string;
  /** Position in the file, when the issue belongs to one record. */
  index?: number;
  path: string;
  message: string;
}

const ID_RE = new RegExp(ID_PATTERN);

/**
 * Validate every registry and every reference between registries.
 * `override` replaces the data of the named registries, which is how the
 * forge checks an edit before it writes the file.
 */
export function validateContent(
  systems: readonly AnySystem[],
  override: Record<string, unknown> = {},
): Issue[] {
  const issues: Issue[] = [];
  const ids = new Map<string, Set<string>>();
  const refs: (FoundRef & { from: string; fromId?: string; index: number })[] = [];
  const entries = collectRegistries(systems);

  for (const { name, def } of entries) {
    const data = name in override ? override[name] : def.data;
    const seen = new Set<string>();
    ids.set(name, seen);
    if (!Array.isArray(data)) {
      issues.push({ registry: name, path: '', message: 'expected a list of records' });
      continue;
    }
    data.forEach((record: unknown, index) => {
      const rawId = (record as { id?: unknown } | null)?.id;
      const id = typeof rawId === 'string' ? rawId : undefined;
      const valueIssues: { path: string; message: string }[] = [];
      const found: FoundRef[] = [];
      validateValue(def.schema, record, '', valueIssues, found);
      for (const issue of valueIssues) issues.push({ registry: name, id, index, ...issue });
      for (const ref of found) refs.push({ ...ref, from: name, fromId: id, index });
      if (id === undefined) return;
      if (!ID_RE.test(id)) {
        // Reported once even when the schema's own id pattern also failed.
        if (!valueIssues.some((issue) => issue.path === 'id'))
          issues.push({ registry: name, id, index, path: 'id', message: `does not match ${ID_PATTERN}` });
      }
      if (seen.has(id)) issues.push({ registry: name, id, index, path: 'id', message: `duplicate id "${id}"` });
      seen.add(id);
    });
  }

  for (const ref of refs) {
    const target = ids.get(ref.registry);
    const where = { registry: ref.from, id: ref.fromId, index: ref.index, path: ref.path };
    if (!target) issues.push({ ...where, message: `refers to unknown registry "${ref.registry}"` });
    else if (!target.has(ref.id))
      issues.push({ ...where, message: `"${ref.id}" is not a record of "${ref.registry}"` });
  }
  return issues;
}

export function formatIssue(issue: Issue): string {
  const record = issue.id !== undefined ? `[${issue.id}]` : issue.index !== undefined ? `[#${issue.index}]` : '';
  const path = issue.path === '' ? '' : `.${issue.path}`;
  return `${issue.registry}${record}${path}: ${issue.message}`;
}

/** Read access to validated content, by registry name and record id. */
export class ContentIndex {
  private readonly lists = new Map<string, readonly unknown[]>();
  private readonly maps = new Map<string, Map<string, unknown>>();

  constructor(entries: readonly RegistryEntry[]) {
    for (const { name, def } of entries) {
      const list = Array.isArray(def.data) ? (def.data as unknown[]) : [];
      const map = new Map<string, unknown>();
      for (const record of list) {
        const id = (record as { id?: unknown } | null)?.id;
        if (typeof id === 'string' && !map.has(id)) map.set(id, record);
      }
      this.lists.set(name, list);
      this.maps.set(name, map);
    }
  }

  all<T = unknown>(registryName: string): readonly T[] {
    const list = this.lists.get(registryName);
    if (!list) throw new Error(`unknown registry "${registryName}"`);
    return list as readonly T[];
  }

  get<T = unknown>(registryName: string, id: string): T | undefined {
    const map = this.maps.get(registryName);
    if (!map) throw new Error(`unknown registry "${registryName}"`);
    return map.get(id) as T | undefined;
  }
}
