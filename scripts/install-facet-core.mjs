// Copies the Facet core into src/systems/facet/core/, which git does not hold
// (the core comes from a private repository; .gitignore). docs/SETUP.md.
//
//   npm run facet:install -- <source>
//   FACET_CORE_SRC=<source> npm run facet:install
//
// <source> is any of:
//   - the Facet repository (its core/ folder holds MANIFEST.json),
//   - a folder that holds MANIFEST.json and the facet.*.js files,
//   - the old KSG repository (src/core/facet/).
//
// Every file is checked against src/systems/facet/core.lock.json, the hashes
// this build was tested with (sha256 over the text, CRLF folded to LF). A
// mismatch stops the copy and writes nothing. `--any-version` copies anyway;
// the behaviour then follows that version of the core, not this build's tests.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src/systems/facet/core');
const LOCK = JSON.parse(readFileSync(path.join(ROOT, 'src/systems/facet/core.lock.json'), 'utf8'));

const args = process.argv.slice(2).filter((a) => a !== '--');
const anyVersion = args.includes('--any-version');
const given = args.find((a) => !a.startsWith('--')) ?? process.env.FACET_CORE_SRC;

function fail(message) {
  console.error(`facet:install: ${message}`);
  process.exit(1);
}

if (!given) fail('name the source: npm run facet:install -- <path>, or set FACET_CORE_SRC (docs/SETUP.md)');

const source = [given, path.join(given, 'core'), path.join(given, 'src/core/facet')].find((dir) =>
  existsSync(path.join(dir, 'MANIFEST.json')),
);
if (!source) fail(`no MANIFEST.json in "${given}", its core/ or its src/core/facet/`);

const sha = (file) => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

const problems = [];
for (const file of LOCK.order) {
  const from = path.join(source, file);
  if (!existsSync(from)) problems.push(`${file}: missing`);
  else if (sha(from) !== LOCK.sha256[file]) problems.push(`${file}: differs from core.lock.json`);
}
if (problems.length && !(anyVersion && problems.every((p) => p.endsWith('core.lock.json')))) {
  fail(`not copied:\n  ${problems.join('\n  ')}${anyVersion ? '' : '\n(--any-version copies a different version anyway)'}`);
}

mkdirSync(TARGET, { recursive: true });
for (const file of [...LOCK.order, 'MANIFEST.json']) copyFileSync(path.join(source, file), path.join(TARGET, file));
console.log(`facet:install: ${LOCK.order.length} core files and MANIFEST.json copied from ${source}`);
if (problems.length) console.log(`facet:install: --any-version: ${problems.length} file(s) differ from core.lock.json`);
