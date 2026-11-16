import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel, type AnySystem, type Kernel, type KernelOptions } from '../src/kernel';
import { systems } from '../src/systems';

export const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** A kernel over the real system list, plus any test-only systems. */
export function makeKernel(extra: AnySystem[] = [], options: Partial<KernelOptions> = {}): Kernel {
  return createKernel({ systems: [...systems, ...extra], seed: 12345, ...options });
}

/** Every file under a folder of the repository, as paths from the root with forward slashes. */
export function listFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

export function readText(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

export function readJson(file: string): unknown {
  return JSON.parse(readText(file));
}

export function exists(file: string): boolean {
  return fs.existsSync(path.join(ROOT, file));
}

/** Source text with comments removed, for import and identifier scans. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
