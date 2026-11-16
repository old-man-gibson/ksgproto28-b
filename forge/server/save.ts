/**
 * Write one registry file. Runs on the dev server only. The check is
 * `validateContent`, the same function the tests and the kernel call. An
 * edit with any issue is not written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectRegistries, validateContent, type Issue } from '../../src/kernel/content';
import type { AnySystem } from '../../src/kernel/system';

export type SaveRegistryResult = { ok: true; file: string } | { ok: false; issues: Issue[] };

export function saveRegistry(
  root: string,
  systems: readonly AnySystem[],
  registryName: string,
  records: unknown,
): SaveRegistryResult {
  const entries = collectRegistries(systems);
  const target = entries.find((entry) => entry.name === registryName);
  if (!target)
    return { ok: false, issues: [{ registry: registryName, path: '', message: 'no such registry' }] };

  // The other registries are read from disk, so the check sees the files as
  // they are now, not as they were when the modules were loaded.
  const current: Record<string, unknown> = {};
  for (const entry of entries) {
    const file = path.join(root, entry.file);
    if (entry.name !== registryName && fs.existsSync(file)) {
      current[entry.name] = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }
  current[registryName] = records;

  const issues = validateContent(systems, current);
  if (issues.length > 0) return { ok: false, issues };

  const file = path.join(root, target.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n', 'utf8');
  return { ok: true, file: target.file };
}
