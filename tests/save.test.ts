import { describe, expect, it } from 'vitest';
import {
  createKernel,
  MemoryStorage,
  parseEnvelope,
  SAVE_FORMAT,
  SaveStore,
  storageKey,
  type SaveEnvelope,
} from '../src/kernel';
import { systems } from '../src/systems';
import counter, { buyStep } from '../src/systems/counter';
import { makeKernel } from './helpers';

function played(): ReturnType<typeof makeKernel> {
  const kernel = makeKernel();
  kernel.tick(300);
  kernel.dispatch(buyStep({ stepId: 'small_step' }));
  kernel.tick(50);
  return kernel;
}

describe('save envelope', () => {
  it('holds one entry per slice, each with its own version', () => {
    const envelope = played().save(1000);
    expect(envelope.format).toBe(SAVE_FORMAT);
    expect(envelope.savedAt).toBe(1000);
    expect(envelope.kernel.version).toBe(1);
    expect(Object.keys(envelope.slices).sort()).toEqual(systems.map((system) => system.id).sort());
    expect(envelope.slices.counter.version).toBe(counter.version);
  });

  it('round-trips through JSON text', () => {
    const a = played();
    const text = JSON.stringify(a.save(1));
    const b = makeKernel();
    const parsed = parseEnvelope(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(b.load(parsed.value)).toEqual({ ok: true, warnings: [] });
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.derived('counter/rate')).toBe(a.derived('counter/rate'));
  });

  it('is detached from live state', () => {
    const kernel = played();
    const envelope = kernel.save(1);
    const before = JSON.stringify(envelope);
    kernel.tick(100);
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('migrates an old slice and leaves the envelope it was given unchanged', () => {
    const envelope: SaveEnvelope = {
      format: SAVE_FORMAT,
      savedAt: 0,
      kernel: { version: 1, data: { tick: 10, rng: 99 } },
      slices: { counter: { version: 1, data: { value: 40, level: 2 } } },
    };
    const before = JSON.stringify(envelope);
    const kernel = makeKernel();
    expect(kernel.load(envelope).ok).toBe(true);
    expect(kernel.snapshot().slices.counter).toEqual({ count: 40, owned: { small_step: 2 }, milestones: 0, lucky: 0 });
    expect(kernel.derived('counter/rate')).toBe(3);
    expect(JSON.stringify(envelope)).toBe(before);
  });

  it('starts a missing slice new and reports it', () => {
    const kernel = makeKernel();
    const result = kernel.load({
      format: SAVE_FORMAT,
      savedAt: 0,
      kernel: { version: 1, data: { tick: 0, rng: 1 } },
      slices: { gone: { version: 3, data: {} } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One warning per system whose slice is missing, and one for the unknown slice.
    expect(result.warnings).toHaveLength(kernel.systems.length + 1);
    expect(result.warnings.filter((w) => w.includes('"gone"'))).toHaveLength(1);
    expect(kernel.snapshot().slices.counter).toEqual(counter.initial());
  });

  it.each([
    ['not an object', 5],
    ['wrong format', { format: 99, savedAt: 0, kernel: { version: 1, data: {} }, slices: {} }],
    ['no kernel entry', { format: SAVE_FORMAT, savedAt: 0, slices: {} }],
    ['bad kernel data', { format: SAVE_FORMAT, savedAt: 0, kernel: { version: 1, data: { tick: -1, rng: 0 } }, slices: {} }],
    [
      'slice from a newer build',
      {
        format: SAVE_FORMAT,
        savedAt: 0,
        kernel: { version: 1, data: { tick: 0, rng: 0 } },
        slices: { counter: { version: 999, data: {} } },
      },
    ],
    [
      'kernel slice from a newer build',
      { format: SAVE_FORMAT, savedAt: 0, kernel: { version: 2, data: { tick: 0, rng: 0 } }, slices: {} },
    ],
  ])('rejects a bad envelope (%s) and keeps the state', (_name, bad) => {
    const kernel = played();
    const before = kernel.snapshot();
    const result = kernel.load(bad);
    expect(result.ok).toBe(false);
    expect(kernel.snapshot()).toEqual(before);
  });
});

describe('storage', () => {
  it('uses a different key per build mode', () => {
    expect(storageKey('development')).not.toBe(storageKey('production'));
    expect(storageKey('test')).not.toBe(storageKey('production'));
    expect(storageKey('development')).toContain('development');
    expect(() => storageKey('')).toThrow();
  });

  it('keeps a dev save and a release save apart in one storage', () => {
    const storage = new MemoryStorage();
    const dev = new SaveStore(storage, 'development');
    const release = new SaveStore(storage, 'production');
    const kernel = played();
    expect(release.write(kernel.save(1)).ok).toBe(true);
    const releaseText = storage.getItem(release.key);

    expect(dev.read()).toEqual({ ok: true, envelope: null });
    kernel.tick(500);
    expect(dev.write(kernel.save(2)).ok).toBe(true);
    expect(storage.getItem(release.key)).toBe(releaseText);
    expect(storage.items.size).toBe(2);
  });

  it('reads back what it wrote', () => {
    const store = new SaveStore(new MemoryStorage(), 'test');
    const envelope = played().save(5);
    store.write(envelope);
    expect(store.read()).toEqual({ ok: true, envelope });
  });

  it.each([
    ['text that is not JSON', '{"format":1,"savedAt"'],
    ['JSON that is not an envelope', '{"hello":"world"}'],
  ])('does not overwrite a stored save that failed to read (%s)', (_name, raw) => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, 'test');
    storage.setItem(store.key, raw);

    expect(store.read().ok).toBe(false);
    const write = store.write(played().save(1));
    expect(write.ok).toBe(false);
    expect(storage.getItem(store.key)).toBe(raw);
  });

  it('does not overwrite a stored save that parsed but failed to load', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, 'test');
    const raw = JSON.stringify({
      format: SAVE_FORMAT,
      savedAt: 0,
      kernel: { version: 1, data: { tick: 0, rng: 0 } },
      slices: { counter: { version: 999, data: {} } },
    });
    storage.setItem(store.key, raw);

    // The boot sequence of the shell: read, load, lock on failure.
    const read = store.read();
    expect(read.ok).toBe(true);
    if (!read.ok || !read.envelope) return;
    const kernel = createKernel({ systems });
    const loaded = kernel.load(read.envelope);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) store.lock(loaded.error);

    kernel.tick(100);
    expect(store.write(kernel.save(1)).ok).toBe(false);
    expect(storage.getItem(store.key)).toBe(raw);
  });

  it('keeps a copy of the broken save when the player sets it aside', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, 'test');
    storage.setItem(store.key, 'broken');
    store.read();

    const backupKey = store.setAsideBroken(1234);
    expect(backupKey).not.toBeNull();
    expect(storage.getItem(backupKey!)).toBe('broken');
    expect(store.write(played().save(1)).ok).toBe(true);
    expect(storage.getItem(backupKey!)).toBe('broken');
  });
});
