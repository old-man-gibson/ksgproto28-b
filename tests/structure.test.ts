import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createKernel, defineCommand, defineSystem, handle, OK, orderSystems } from '../src/kernel';
import { systems } from '../src/systems';
import { exists, listFiles, readText, ROOT, stripComments } from './helpers';

describe('kernel boundary', () => {
  const files = listFiles('src/kernel');

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.every((file) => file.endsWith('.ts'))).toBe(true);
  });

  it.each(files)('%s imports only kernel files', (file) => {
    const source = stripComments(readText(file));
    const targets = [...source.matchAll(/\bfrom\s+'([^']+)'/g), ...source.matchAll(/\bimport\s*\(\s*'([^']+)'/g)].map(
      (match) => match[1],
    );
    for (const target of targets) {
      expect(target, `${file} imports ${target}`).toMatch(/^\.\/[a-z]+$/);
    }
  });

  it.each(files)('%s uses no DOM and no build-tool globals', (file) => {
    const source = stripComments(readText(file));
    for (const name of [
      'window',
      'document',
      'localStorage',
      'sessionStorage',
      'navigator',
      'requestAnimationFrame',
      'HTMLElement',
      'Worker',
      'postMessage',
      'import.meta',
      '$state',
      '$derived',
      '$effect',
    ]) {
      const pattern = new RegExp(`(^|[^\\w.$'"])${name.replace(/[.$]/g, '\\$&')}\\b`);
      expect(pattern.test(source), `${file} uses ${name}`).toBe(false);
    }
  });

  it('does not use wall-clock time or Math.random, which would break replay', () => {
    for (const file of [...files, ...listFiles('src/systems').filter((f) => f.endsWith('.ts'))]) {
      const source = stripComments(readText(file));
      expect(source, `${file} uses Math.random`).not.toMatch(/Math\.random\b/);
      expect(source, `${file} uses Date`).not.toMatch(/\bDate\b/);
      expect(source, `${file} uses performance.now`).not.toMatch(/performance\.now\b/);
    }
  });
});

describe('system folders', () => {
  const folders = fs
    .readdirSync(path.join(ROOT, 'src/systems'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('every folder is a system and every system is a folder', () => {
    expect(systems.map((system) => system.id).sort()).toEqual([...folders].sort());
  });

  it.each(folders)('%s has a declaration and a doc', (folder) => {
    expect(exists(`src/systems/${folder}/index.ts`)).toBe(true);
    expect(exists(`src/systems/${folder}/README.md`)).toBe(true);
  });

  it('the kernel-side files of a system do not import Svelte or the UI', () => {
    // Files reachable from index.ts run in the worker and in node.
    const uiSide = (f: string) => f.endsWith('/panel.ts') || f === 'src/systems/panels.ts';
    for (const file of listFiles('src/systems').filter((f) => f.endsWith('.ts') && !uiSide(f))) {
      const source = stripComments(readText(file));
      expect(source, `${file} imports a Svelte file`).not.toMatch(/from\s+'[^']*\.svelte(\.ts)?'/);
      expect(source, `${file} imports svelte`).not.toMatch(/from\s+'svelte/);
      expect(source, `${file} imports the UI`).not.toMatch(/from\s+'[^']*\/ui\//);
    }
  });

  it('no file outside a system folder imports from inside one, except through its index or panel', () => {
    const outside = [...listFiles('src/ui'), ...listFiles('src/kernel'), ...listFiles('forge'), 'src/main.ts'].filter(
      (file) => exists(file) && /\.(ts|svelte)$/.test(file),
    );
    for (const file of outside) {
      const source = stripComments(readText(file));
      for (const match of source.matchAll(/from\s+'([^']*systems\/[^']+)'/g)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(/systems\/(panels|index|[a-z0-9-]+)$/);
      }
    }
  });
});

describe('styles', () => {
  const styleFiles = listFiles('src')
    .concat(listFiles('forge'))
    .filter((file) => /\.(css|scss|less)$/.test(file));

  it('the only stylesheet is the token file', () => {
    expect(styleFiles).toEqual(['src/ui/tokens.css']);
  });

  it('the token file styles only :root, html and body', () => {
    const css = readText('src/ui/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((match) => match[2].trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(',').map((p) => p.trim())) {
        expect(part, `selector "${part}"`).toMatch(/^(:root(\[data-theme='[a-z-]+'\])?|html|body)$/);
      }
    }
  });

  it('no component uses a global selector', () => {
    const components = listFiles('src')
      .concat(listFiles('forge'))
      .filter((file) => file.endsWith('.svelte'));
    expect(components.length).toBeGreaterThan(0);
    for (const file of components) {
      const source = readText(file);
      expect(source, `${file} uses :global`).not.toMatch(/:global/);
      expect(source, `${file} has a global style tag`).not.toMatch(/<style[^>]*\bglobal\b/);
    }
  });
});

describe('defineSystem', () => {
  const base = { version: 1, initial: () => ({}) };

  it('rejects a bad id', () => {
    expect(() => defineSystem({ ...base, id: 'Bad_Id' })).toThrow(/id must match/);
  });

  it('needs one migration per version step', () => {
    expect(() => defineSystem({ ...base, id: 'x', version: 3, migrations: { 1: (d) => d } })).toThrow(
      /needs migrations for exactly \[1, 2\]/,
    );
    expect(() => defineSystem({ ...base, id: 'x', version: 1, migrations: { 1: (d) => d } })).toThrow(/needs migrations/);
    expect(() =>
      defineSystem({ ...base, id: 'x', version: 3, migrations: { 1: (d) => d, 2: (d) => d } }),
    ).not.toThrow();
  });

  it('keeps stats, modifier sources and commands inside the system namespace', () => {
    expect(() => defineSystem({ ...base, id: 'x', stats: { 'y/rate': { base: 1 } } })).toThrow(/must start with "x\/"/);
    expect(() => defineSystem({ ...base, id: 'x', modifiers: [{ id: 'other/src', collect: () => [] }] })).toThrow(
      /must start with "x\/"/,
    );
    expect(() =>
      defineSystem({ ...base, id: 'x', commands: [handle(defineCommand('y/do'), () => OK)] }),
    ).toThrow(/must start with "x\/"/);
  });

  it('the kernel rejects a system listed twice and runs systems in order, then id', () => {
    const a = defineSystem({ ...base, id: 'a' });
    expect(() => createKernel({ systems: [a, a] })).toThrow(/listed twice/);
    const z = defineSystem({ ...base, id: 'z', order: -1 });
    const m = defineSystem({ ...base, id: 'm' });
    expect(orderSystems([m, a, z]).map((system) => system.id)).toEqual(['z', 'a', 'm']);
  });

  it('ticks systems in that order', () => {
    const log: string[] = [];
    const make = (id: string, order?: number) =>
      defineSystem({ ...base, id, order, tick: () => void log.push(id) });
    const kernel = createKernel({ systems: [make('b'), make('a'), make('c', -5)] });
    kernel.tick(2);
    expect(log).toEqual(['c', 'a', 'b', 'c', 'a', 'b']);
  });
});

describe('published view', () => {
  it('is a new object on every call and never the live slice', () => {
    const kernel = createKernel({ systems, freezeViews: true });
    const first = kernel.view();
    kernel.tick(10);
    const second = kernel.view();
    expect(second).not.toBe(first);
    expect((first.systems.counter as { count: number }).count).toBe(0);
    expect((second.systems.counter as { count: number }).count).toBeGreaterThan(0);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.systems.counter)).toBe(true);
    // Freezing the view froze nothing in the kernel: the game still runs.
    expect(() => kernel.tick(10)).not.toThrow();
    expect(() => {
      (second.systems.counter as { count: number }).count = 5;
    }).toThrow();
  });
});
