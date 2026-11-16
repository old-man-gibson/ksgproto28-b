/**
 * The save envelope. One envelope holds one entry per slice, and each entry
 * has its own version. A system that changes its slice shape bumps its own
 * version and adds one migration; no other slice is affected.
 */
import { isRecord, type Json } from './json';

/** Version of the envelope layout itself, not of any slice. */
export const SAVE_FORMAT = 1;

export interface SliceEntry {
  version: number;
  data: Json;
}

export interface SaveEnvelope {
  format: number;
  /** Wall-clock time of the save, in milliseconds. Given by the caller. */
  savedAt: number;
  kernel: SliceEntry;
  slices: Record<string, SliceEntry>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function isEntry(value: unknown): value is SliceEntry {
  return isRecord(value) && Number.isInteger(value.version) && (value.version as number) >= 1 && 'data' in value;
}

/** Check the envelope layout. Slice contents are not checked here. */
export function checkEnvelope(value: unknown): Result<SaveEnvelope> {
  if (!isRecord(value)) return { ok: false, error: 'save is not an object' };
  if (value.format !== SAVE_FORMAT)
    return { ok: false, error: `save format ${String(value.format)} is not supported (expected ${SAVE_FORMAT})` };
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt))
    return { ok: false, error: 'save has no valid savedAt' };
  if (!isEntry(value.kernel)) return { ok: false, error: 'save has no valid kernel entry' };
  if (!isRecord(value.slices)) return { ok: false, error: 'save has no slices' };
  for (const [id, entry] of Object.entries(value.slices)) {
    if (!isEntry(entry)) return { ok: false, error: `slice "${id}" has no valid version and data` };
  }
  return { ok: true, value: value as unknown as SaveEnvelope };
}

export function parseEnvelope(raw: string): Result<SaveEnvelope> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `save is not valid JSON: ${(err as Error).message}` };
  }
  return checkEnvelope(value);
}

/**
 * Bring one slice entry to the current version. Throws when the entry is from
 * a newer build or a step is missing or fails.
 */
export function migrateEntry(
  label: string,
  entry: SliceEntry,
  currentVersion: number,
  migrations: Record<number, (data: Json) => Json>,
): Json {
  if (entry.version > currentVersion)
    throw new Error(`${label} is at version ${entry.version}; this build reads up to ${currentVersion}`);
  // Copy first: a migration may mutate its input, and the stored envelope must not change.
  let data = JSON.parse(JSON.stringify(entry.data)) as Json;
  for (let version = entry.version; version < currentVersion; version++) {
    const step = migrations[version];
    if (!step) throw new Error(`${label} has no migration from version ${version}`);
    try {
      data = step(data);
    } catch (err) {
      throw new Error(`${label} migration from version ${version} failed: ${(err as Error).message}`);
    }
  }
  return data;
}
