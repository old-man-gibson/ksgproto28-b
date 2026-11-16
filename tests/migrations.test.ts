import { describe, expect, it } from 'vitest';
import { createKernel, KERNEL_SLICE_VERSION, SAVE_FORMAT, type Json } from '../src/kernel';
import { kernelMigrations } from '../src/kernel/migrations';
import { systems } from '../src/systems';
import { exists, listFiles, readJson, readText, stripComments } from './helpers';

/** Each thing that has a versioned slice: the kernel and every system. */
const slices = [
  { id: 'kernel', version: KERNEL_SLICE_VERSION, migrations: kernelMigrations, file: 'src/kernel/migrations.ts' },
  ...systems.map((system) => ({
    id: system.id,
    version: system.version,
    migrations: system.migrations ?? {},
    file: `src/systems/${system.id}/migrations.ts`,
  })),
];

describe('migration purity', () => {
  const files = [
    'src/kernel/migrations.ts',
    ...listFiles('src/systems').filter((file) => /\/migrations(\.ts|\/.*\.ts)$/.test(file)),
  ];

  it.each(files)('%s has no imports other than import type', (file) => {
    const source = stripComments(readText(file));
    const imports = source.match(/^\s*import\b[^;]*;?/gm) ?? [];
    for (const statement of imports) {
      expect(statement.trim(), `${file}: only "import type" is allowed`).toMatch(/^import\s+type\b/);
    }
    expect(source, `${file}: no dynamic import`).not.toMatch(/\bimport\s*\(/);
    expect(source, `${file}: no require`).not.toMatch(/\brequire\s*\(/);
    expect(source, `${file}: no import.meta`).not.toMatch(/\bimport\.meta\b/);
    expect(source, `${file}: no re-export from another module`).not.toMatch(/\bexport\b[^;]*\bfrom\b/);
  });

  it.each(systems.map((system) => system.id))(
    'system %s takes its migrations from its migrations.ts',
    (id) => {
      const system = systems.find((candidate) => candidate.id === id)!;
      if (system.version === 1) return;
      expect(exists(`src/systems/${id}/migrations.ts`), `src/systems/${id}/migrations.ts must exist`).toBe(true);
      // The declaration file may not define steps inline, where they could reach imports.
      const index = stripComments(readText(`src/systems/${id}/index.ts`));
      expect(index).toMatch(/import\s*\{[^}]*\bmigrations\b[^}]*\}\s*from\s*'\.\/migrations'/);
      expect(index).toMatch(/^\s*migrations,?\s*$/m);
    },
  );
});

describe('golden fixtures', () => {
  it.each(slices)('$id has one fixture per slice version and no others', ({ id, version }) => {
    const found = listFiles(`tests/fixtures/${id}`).sort();
    const wanted = Array.from({ length: version }, (_, i) => `tests/fixtures/${id}/v${i + 1}.json`).sort();
    expect(found).toEqual(wanted);
  });

  it.each(slices)('$id: each step turns fixture N into fixture N + 1', ({ id, version, migrations }) => {
    for (let n = 1; n < version; n++) {
      const input = readJson(`tests/fixtures/${id}/v${n}.json`) as Json;
      const output = migrations[n](input);
      expect(output, `${id} step ${n}`).toEqual(readJson(`tests/fixtures/${id}/v${n + 1}.json`));
    }
  });

  it.each(systems.map((system) => ({ id: system.id, version: system.version })))(
    '$id: every fixture loads and the game runs on it',
    ({ id, version }) => {
      const current = readJson(`tests/fixtures/${id}/v${version}.json`);
      for (let n = 1; n <= version; n++) {
        const kernel = createKernel({ systems });
        const result = kernel.load({
          format: SAVE_FORMAT,
          savedAt: 0,
          kernel: { version: KERNEL_SLICE_VERSION, data: readJson(`tests/fixtures/kernel/v${KERNEL_SLICE_VERSION}.json`) },
          slices: { [id]: { version: n, data: readJson(`tests/fixtures/${id}/v${n}.json`) } },
        });
        expect(result.ok, `${id} v${n}: ${result.ok ? '' : result.error}`).toBe(true);
        expect(kernel.snapshot().slices[id]).toEqual(current);
        kernel.tick(100);
        // The slice is still JSON after the game ran on it.
        const after = kernel.snapshot().slices[id];
        expect(JSON.parse(JSON.stringify(after))).toEqual(after);
      }
    },
  );

  it.each(systems.map((system) => system.id))('%s: a new slice is JSON', (id) => {
    const system = systems.find((candidate) => candidate.id === id)!;
    const initial = system.initial();
    expect(JSON.parse(JSON.stringify(initial))).toEqual(initial);
    expect(system.initial()).not.toBe(initial);
  });
});
