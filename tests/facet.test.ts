import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE, facetListed, grantFacet, NO_CORE, switchFacet, type FacetState } from '../src/systems/facet';
import { HOST, withReads } from '../src/systems/facet/host';
import { facetQuantities, readQuantity } from '../src/systems/facet/quantities';
import { resourceValue } from '../src/systems/resources';
import resources from '../src/systems/resources';
import { effectiveAttr, statBlockOf } from '../src/systems/stats';
import { heldOf, STATUSES } from '../src/systems/statuses';
import { aMinute, cell, facetOf, facetView, holding, moveTo, setShare } from './facetHelpers';
import { skipsOf } from './combatHelpers';
import { makeGame, patch, reads, slice } from './helpers';

/**
 * The FACET core in this game (old tests/facet.test.ts). Three layers:
 *
 *  - the copy in src/systems/facet/core/ is byte for byte the master's, per
 *    its own MANIFEST.json;
 *  - the core's own corpus (facet.cases.js) passes when loaded the way the
 *    game loads it;
 *  - this game's adapter installs, and a carrier a document holds reaches the
 *    player's derived stats.
 *
 * And the switch of the tentative port: off, a game has no trace of it.
 *
 * The core is not in git (docs/SETUP.md). Without it every block here is
 * skipped, and the one test below says so; `tests/facetMissing.test.ts`
 * covers a build without it.
 */

// The corpus is a core file too: loaded only when the folder is there.
import.meta.glob('../src/systems/facet/core/facet.cases.js', { eager: true });

it.runIf(!CORE)(`${NO_CORE}: the Facet tests that need it are skipped (npm run facet:install, docs/SETUP.md)`, () => {
  expect(CORE).toBe(false);
});

const DIR = path.resolve(__dirname, '../src/systems/facet/core');
const lf = (text: string) => text.replace(/\r\n/g, '\n');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe.skipIf(!CORE)('the installed core', () => {
  const lock = JSON.parse(readFileSync(path.resolve(__dirname, '../src/systems/facet/core.lock.json'), 'utf8')) as {
    order: string[];
    sha256: Record<string, string>;
  };
  const manifest = () => JSON.parse(readFileSync(path.join(DIR, 'MANIFEST.json'), 'utf8')) as typeof lock;

  it('is the version this build was tested with (core.lock.json), file for file', () => {
    for (const file of lock.order) {
      expect(sha(lf(readFileSync(path.join(DIR, file), 'utf8'))), file).toBe(lock.sha256[file]);
    }
    expect(manifest().sha256).toEqual(lock.sha256);
  });

  it('holds no core file the lock does not list', () => {
    const present = readdirSync(DIR).filter((f) => /^facet\.[\w-]+\.js$/.test(f));
    expect(present.sort()).toEqual([...lock.order].sort());
  });

  it('loads every core module through load.ts', () => {
    for (const m of Facet.MODULES) expect(Facet._mods[m], m).toBe(true);
  });

  it('uses no Math.random, Date or performance.now in a core file', () => {
    for (const file of lock.order) {
      const text = readFileSync(path.join(DIR, file), 'utf8');
      if (file === 'facet.cases.js') continue;
      expect(text, file).not.toMatch(/Math\.random\b|\bDate\b|performance\.now/);
    }
  });
});

describe.skipIf(!CORE)('the core corpus', () => {
  for (const [name, run] of Object.entries(globalThis.FacetCases ?? {})) {
    it(name, () => {
      Facet.uninstall();
      run((cond, msg) => {
        if (!cond) throw new Error(msg ?? 'assertion failed');
      }, FacetFakeHost());
    });
  }
});

describe.skipIf(!CORE)('this game as host', () => {
  it('installs with every member the core requires', () => {
    Facet.uninstall();
    expect(() => Facet.install(HOST)).not.toThrow();
    expect(Facet.ready()).toBe(true);
  });

  it('registers each quantity id once, and every one reads a finite number', () => {
    const kernel = makeGame({ seed: 1 });
    const ids = facetQuantities().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number.isFinite(readQuantity(reads(kernel), id)), id).toBe(true);
  });

  it('reads through the shared ids InfiniteGacha uses', () => {
    const kernel = makeGame({ seed: 1 });
    const r = reads(kernel);
    const read = (id: string) => withReads(r, facetOf(kernel), () => Facet.readQ('player', id));
    expect(read('fighter.hp')).toMatchObject({ ok: true, value: resourceValue(r.read(resources), 'hp') });
    expect(read('fighter.maxHpAbs').value).toBe(statBlockOf(r).maxHp);
    expect(read('stat.eff.con').value).toBe(effectiveAttr(r, 'con'));
    expect(read('res.heat').value).toBe(statBlockOf(r).resHeat);
    expect(read('pool.stamina.cur').value).toBe(resourceValue(r.read(resources), 'stamina'));
    expect(read('ksg.loot').value).toBe(statBlockOf(r).loot);
  });

  it('keeps hp out of reach: never written, never severed', () => {
    const hp = facetQuantities().find((q) => q.id === 'fighter.hp')!;
    expect(hp).toMatchObject({ writable: false, nullifiable: false, mortalRole: 'vitality' });
  });

  it('refuses a quantity override until the stat path takes it', () => {
    expect(() => (HOST.overrideQ as () => void)()).toThrow(/K3/);
  });

  it('defines every carrier of the bank at load, so a saved carrier always has its definition', () => {
    for (const doc of Object.values(Facet.bank!)) {
      const id = Facet.hydrate(doc).id!;
      for (const c of doc.cells ?? []) {
        if (c.carrier === false || (c.level === 'none' && c.hold !== 'many')) continue;
        expect(STATUSES[`fc_${id.replace('fc_', '')}_${c.key}`], `${doc.reading?.name} ${c.key}`).toBeTruthy();
      }
    }
  });
});

describe.skipIf(!CORE)('the switch', () => {
  it('is off in a new game: no ability, no tab, an empty slice', () => {
    const kernel = makeGame({ seed: 3 });
    expect(slice<FacetState>(kernel, 'facet')).toEqual({ on: false, docs: [], queued: null, fallen: null });
    expect(facetView(kernel)).toEqual({ on: false, core: true, held: [], bank: [], evolution: null, inFight: false });
    expect(facetListed(kernel.view().systems)).toBe(false);
  });

  it('refuses a grant while off, with a reason', () => {
    const kernel = makeGame({ seed: 3 });
    expect(kernel.dispatch(grantFacet({ id: 'zenkai' }))).toEqual({ ok: false, reason: 'Facet abilities are switched off' });
    expect(skipsOf(kernel, 'facet/grant')).toEqual(['Facet abilities are switched off']);
  });

  it('on, the tab lists the bank; off again, the ability and its carriers go', () => {
    const kernel = holding('solar_charge');
    expect(facetListed(kernel.view().systems)).toBe(true);
    expect(facetView(kernel).bank.map((b) => b.key)).toContain('little_moons');
    expect(facetView(kernel).bank.map((b) => b.key)).not.toContain('shadow_clone');
    expect(heldOf(slice(kernel, 'statuses')).some((s) => s.id.startsWith('fc_'))).toBe(true);
    expect(kernel.dispatch(switchFacet({ on: false }))).toEqual({ ok: true });
    expect(facetOf(kernel).docs).toEqual([]);
    expect(heldOf(slice(kernel, 'statuses')).some((s) => s.id.startsWith('fc_'))).toBe(false);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('refuses Shadow Clone: its clones are not ported', () => {
    const kernel = holding(null);
    expect(kernel.dispatch(grantFacet({ id: 'shadow_clone' })).ok).toBe(false);
  });
});

/**
 * Solar Charge, the first bank ability: banks sunlight each game minute,
 * drains a little every minute, and sets a damage and spell power
 * multiplier from the charge, +20% from half charge up and -15% at empty.
 * The tiers and Sun Blast are in facetAbilities.test.ts.
 */
describe.skipIf(!CORE)('Solar Charge', () => {
  const plainTwin = (spot: string) => {
    const twin = makeGame({ seed: 7 });
    patch(twin, (slices) => {
      for (const a of ['str', 'dex', 'con', 'int', 'wis'] as const) slices.attributes.attrs[a].level = 25;
      slices.world.spot = spot;
    });
    return statBlockOf(reads(twin));
  };

  it('opens empty, at -15% damage and spell power', () => {
    const kernel = holding('solar_charge');
    expect(cell(kernel, 'charge')).toBe(0);
    expect(cell(kernel, 'power')).toBeCloseTo(-0.15);
    const spot = slice<{ spot: string }>(kernel, 'world').spot;
    expect(statBlockOf(reads(kernel)).damage).toBeCloseTo(plainTwin(spot).damage * 0.85);
    expect(statBlockOf(reads(kernel)).spellPower).toBeCloseTo(plainTwin(spot).spellPower * 0.85);
  });

  it('banks under open sky by day', () => {
    const kernel = holding('solar_charge');
    moveTo(kernel, 'open');
    for (let m = 0; m < 60; m++) aMinute(kernel);
    expect(cell(kernel, 'charge')).toBeGreaterThan(0);
  });

  it('sets power from the charge: +20% from half up, a straight line down to -15% at empty', () => {
    const kernel = holding('solar_charge');
    moveTo(kernel, 'roofed');
    setShare(kernel, 'charge', 0.5);
    aMinute(kernel);
    expect(cell(kernel, 'power')).toBeCloseTo(0.2);
    setShare(kernel, 'charge', 1);
    aMinute(kernel);
    expect(cell(kernel, 'power')).toBeCloseTo(0.2);
    setShare(kernel, 'charge', 0.25);
    aMinute(kernel);
    expect(cell(kernel, 'power')).toBeCloseTo(0.025, 2);
  });

  it('survives save and load: the document carries the charge, the carriers come back with the statuses', () => {
    const kernel = holding('solar_charge');
    setShare(kernel, 'charge', 0.6);
    aMinute(kernel);
    const damage = statBlockOf(reads(kernel)).damage;
    const envelope = JSON.parse(JSON.stringify(kernel.save(0)));
    const loaded = makeGame({ seed: 99 });
    expect(loaded.load(envelope).ok).toBe(true);
    expect(cell(loaded, 'charge')).toBeCloseTo(cell(kernel, 'charge'));
    expect(statBlockOf(reads(loaded)).damage).toBeCloseTo(damage);
    aMinute(loaded);
    expect(loaded.staleStats()).toEqual([]);
  });

  it('two games in one process each keep their own ability', () => {
    const a = holding('solar_charge');
    const b = holding('zenkai');
    setShare(a, 'charge', 0.9);
    aMinute(b);
    aMinute(a);
    expect(facetOf(a).docs[0].reading?.name).toBe('Solar Charge');
    expect(facetOf(b).docs[0].reading?.name).toBe('Zenkai');
    expect(cell(a, 'charge')).toBeGreaterThan(0);
  });
});

