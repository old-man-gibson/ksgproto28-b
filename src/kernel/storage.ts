/**
 * Where the save is kept. Two rules live here:
 * 1. The storage key includes the build mode, so a dev server and a release
 *    build never share a save.
 * 2. After a read or load error the store is locked. A locked store refuses
 *    to write, so the stored save is still there to recover.
 */
import { parseEnvelope, type SaveEnvelope } from './save';

/** The subset of the Web Storage interface the store uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MODE = /^[a-z][a-z0-9-]*$/;

/** `mode` is the build mode: "development", "production", "test". */
export function storageKey(mode: string, name = 'save'): string {
  if (!MODE.test(mode)) throw new Error(`invalid build mode "${mode}"`);
  return `ksgb:${mode}:${name}`;
}

export type ReadResult = { ok: true; envelope: SaveEnvelope | null } | { ok: false; error: string };
export type WriteResult = { ok: true } | { ok: false; reason: string };

export class SaveStore {
  readonly key: string;
  private lockReason: string | null = null;

  constructor(
    private readonly storage: StorageLike,
    mode: string,
  ) {
    this.key = storageKey(mode);
  }

  get locked(): string | null {
    return this.lockReason;
  }

  /** `envelope` is null when nothing is stored. A failure locks the store. */
  read(): ReadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (err) {
      return this.fail(`storage read failed: ${(err as Error).message}`);
    }
    if (raw === null) return { ok: true, envelope: null };
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) return this.fail(parsed.error);
    return { ok: true, envelope: parsed.value };
  }

  /** Lock after an error found later than `read`, such as a failed migration. */
  lock(reason: string): void {
    this.lockReason = reason;
  }

  write(envelope: SaveEnvelope): WriteResult {
    if (this.lockReason !== null) return { ok: false, reason: `save is locked: ${this.lockReason}` };
    try {
      this.storage.setItem(this.key, JSON.stringify(envelope));
    } catch (err) {
      return { ok: false, reason: `storage write failed: ${(err as Error).message}` };
    }
    return { ok: true };
  }

  /**
   * The only way out of a lock. Copies the stored text to a backup key, then
   * unlocks. The broken save is kept under the returned key; the next write
   * replaces the main key.
   */
  setAsideBroken(now: number): string | null {
    const raw = this.storage.getItem(this.key);
    let backupKey: string | null = null;
    if (raw !== null) {
      backupKey = `${this.key}.broken.${now}`;
      this.storage.setItem(backupKey, raw);
    }
    this.lockReason = null;
    return backupKey;
  }

  private fail(error: string): ReadResult {
    this.lockReason = error;
    return { ok: false, error };
  }
}

/** In-memory storage for tests and for hosts without localStorage. */
export class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}
