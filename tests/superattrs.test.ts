/**
 * Port of the old `tests/superattrs.test.ts`: super-attribute fusion. The
 * cases keep their old names.
 *
 * Call shape changes:
 * - The game is a kernel (`makeGame`). The old tests wrote `state.attrs`,
 *   `state.stats` and `state.fused`; here the slices are patched through a
 *   save and a load (`patch`).
 * - `attrValue(state, a)` and `effectiveAttrs(state)` read the stat block
 *   (`attrValue`, `effectiveAttr` of `stats`). `getDerivedStats` is
 *   `playerStats`. `conditionMet(state, c)` takes the player's
 *   `conditionReader`. `sellPrice(state, item)` takes the gold gain.
 * - `checkSuperUnlocks(state, bus)` is the event `superattrs/check`;
 *   `bus.on('superattr:unlock')` is a kernel listener on
 *   `superattrs/unlocked`; `bus.emit({ type: 'attr:levelup' })` and the kill
 *   are the events `attributes/levelup` and `combat/kill`, with the kill's
 *   `counters/bump` of `kills` after it, as combat sends them.
 *
 * Left out: "save migration v1 → v2" (2 cases). They test the old save's own
 * step from version 1 (Willpower renamed, the fused list added). The save
 * here starts at version 1 and has no importer (docs/REBUILD.md section 1);
 * the slice's fixture is `tests/fixtures/superattrs/v1.json`.
 *
 * New here: the title check on fusion, the log line, the stale check, a load
 * and a new run, no second fusion, and the readout rendered on the server.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AchievementsState } from '../src/systems/achievements';
import { attrLevelUp, type AttributesState } from '../src/systems/attributes';
import { enemyKilled } from '../src/systems/combat';
import { bumpCounter, conditionMet, counterValue, type Condition, type CountersState } from '../src/systems/counters';
import { sellPrice } from '../src/systems/items';
import type { LogState } from '../src/systems/log';
import { conditionReader } from '../src/systems/skills';
import { attrValue, effectiveAttr, type AttributeId } from '../src/systems/stats';
import FusionReadout from '../src/systems/superattrs/FusionReadout.svelte';
import {
  checkFusion,
  fusionUnlocked,
  SUPERATTR_LIST,
  SUPERATTRS,
  type FusedView,
  type SuperattrsState,
  type SuperattrsView,
} from '../src/systems/superattrs';
import { checkTitles, hasTitle, type TitlesState } from '../src/systems/titles';
import { playerStats } from './combatHelpers';
import { emit, makeGame, patch, reads, run, slice } from './helpers';

const fusedOf = (k: Kernel) => slice<SuperattrsState>(k, 'superattrs').fused;
const isFused = (k: Kernel, id: string) => fusedOf(k).includes(id);
const fusionView = (k: Kernel): SuperattrsView => k.view().systems.superattrs as SuperattrsView;
const attr = (k: Kernel, id: AttributeId) => attrValue(reads(k), id);
const eff = (k: Kernel, id: AttributeId) => effectiveAttr(reads(k), id);
const logLines = (k: Kernel) => slice<LogState>(k, 'log').log;

function withLevels(k: Kernel, levels: Partial<Record<AttributeId, number>>, fused: string[] = []): Kernel {
  patch(k, (slices) => {
    for (const [id, level] of Object.entries(levels)) (slices.attributes as AttributesState).attrs[id as AttributeId].level = level!;
    (slices.superattrs as SuperattrsState).fused = [...fused];
  });
  return k;
}

function setCounts(k: Kernel, counts: Record<string, number>): void {
  patch(k, (slices) => Object.assign((slices.counters as CountersState).counts, counts));
}

/** The kill as combat sends it: `combat/kill`, then the `kills` bump. */
function kill(k: Kernel): void {
  run(k, (ctx) => {
    ctx.emit(enemyKilled, {
      entity: 'm:test',
      defId: 'forest_rat',
      name: 'Forest Rat',
      level: 5,
      rewardLevel: 5,
      xp: 1,
      tags: [],
      lastHit: null,
      site: 'test',
      boss: false,
      once: false,
    });
    ctx.emit(bumpCounter, { key: 'kills' });
  });
}

describe('attrValue resolution', () => {
  // Training milestones (+1 at 5/15/25..., x1.01 at 10/20/30...) ride on top
  // of the trained level, so effective values are computed here rather than raw.
  const effStr15 = 17 * 1.01; // 15 + 2 flat milestones, x1.01
  const effCha9 = 10; // 9 + 1 flat milestone

  it('returns the effective value while unfused', () => {
    const k = withLevels(makeGame(), { str: 15, cha: 9 });
    expect(attr(k, 'str')).toBeCloseTo(effStr15, 5);
    expect(attr(k, 'cha')).toBeCloseTo(effCha9, 5);
  });

  it('returns the component sum for BOTH components once fused', () => {
    const k = withLevels(makeGame(), { str: 15, cha: 9 }, ['dominion']);
    expect(attr(k, 'str')).toBeCloseTo(effStr15 + effCha9, 5);
    expect(attr(k, 'cha')).toBeCloseTo(effStr15 + effCha9, 5);
    // Other attributes unaffected.
    expect(attr(k, 'dex')).toBe(1);
  });

  it('keeps growing as components keep leveling', () => {
    const k = withLevels(makeGame(), { int: 60, con: 60 }, ['force']);
    // Fusion sums the EFFECTIVE components: read them from the pipeline.
    expect(attr(k, 'int')).toBeCloseTo(eff(k, 'int') + eff(k, 'con'), 5);
    const conBefore = eff(k, 'con');
    withLevels(k, { con: 61 }, ['force']);
    expect(eff(k, 'con')).toBeGreaterThan(conBefore);
    expect(attr(k, 'int')).toBeCloseTo(eff(k, 'int') + eff(k, 'con'), 5);
  });
});

describe('fusion redirects every check', () => {
  function fusedVsUnfused(levels: Partial<Record<AttributeId, number>>): [Kernel, Kernel] {
    const a = withLevels(makeGame({ seed: 3 }), levels);
    const b = withLevels(makeGame({ seed: 3 }), levels, ['dominion', 'force', 'martial_prowess']);
    return [a, b];
  }

  it('derived stats jump on fusion', () => {
    const [unfused, fused] = fusedVsUnfused({ str: 30, cha: 30, con: 20, int: 20 });
    const before = playerStats(unfused);
    const after = playerStats(fused);
    // Damage = 2 base + 1.2 x (fused STR) + 2 from the STR-21 training rank.
    expect(after.damage).toBeCloseTo(2 + 1.2 * (eff(unfused, 'str') + eff(unfused, 'cha')) + 2, 5);
    expect(after.damage).toBeGreaterThan(before.damage * 1.8);
    expect(after.maxHp).toBe(Math.round(40 + 10 * (eff(unfused, 'con') + eff(unfused, 'int'))));
    // goldGain via cha 30 -> 60
    expect(after.goldGain).toBeGreaterThan(before.goldGain);
  });

  it('unlock conditions on either component use the super-attribute', () => {
    const k = withLevels(makeGame({ seed: 4 }), { dex: 12, wis: 15 });
    const dex20: Condition = { type: 'attr', attr: 'dex', level: 20 };
    expect(conditionMet(conditionReader(reads(k)), dex20)).toBe(false);
    withLevels(k, {}, ['martial_prowess']);
    expect(conditionMet(conditionReader(reads(k)), dex20)).toBe(true); // 12 + 15 = 27 >= 20
  });

  it('gold gain from charisma raises kill gold and sell prices', () => {
    const k = makeGame({ seed: 5 });
    const sword = { defId: 'rusty_sword', slots: 1 };
    const cheapskate = sellPrice(sword, playerStats(k).goldGain);
    withLevels(k, { cha: 50 });
    expect(sellPrice(sword, playerStats(k).goldGain)).toBeGreaterThan(cheapskate);
  });
});

describe('fusion unlock trigger', () => {
  function readyForDominion(): Kernel {
    const k = withLevels(makeGame({ seed: 6 }), { str: 60, cha: 60 });
    setCounts(k, { kills: 500, 'gold:earned': 25000 });
    return k;
  }

  it('fuses when all provisional conditions hold and an event fires', () => {
    const k = readyForDominion();
    expect(isFused(k, 'dominion')).toBe(false);
    let unlockEvent = false;
    k.onEvent((ev) => {
      if (ev.type === fusionUnlocked.type) unlockEvent = (ev.payload as { id: string }).id === 'dominion';
    });
    emit(k, checkFusion, undefined);
    expect(isFused(k, 'dominion')).toBe(true);
    expect(unlockEvent).toBe(true);
    expect(logLines(k).some((l) => l.kind === 'fusion')).toBe(true);
    // Other supers stay locked.
    expect(isFused(k, 'force')).toBe(false);
  });

  it('does not fuse below thresholds, and fires via the event bus wiring', () => {
    const k = readyForDominion();
    setCounts(k, { kills: 499 });
    emit(k, attrLevelUp, { attr: 'str', level: 60 });
    expect(isFused(k, 'dominion')).toBe(false);
    // The 500th kill (bumped by combat after the kill event) triggers fusion.
    kill(k);
    expect(counterValue(slice<CountersState>(k, 'counters'), 'kills')).toBe(500);
    expect(isFused(k, 'dominion')).toBe(true);
  });

  it('achievement thresholds catch the fused jump immediately', () => {
    const k = readyForDominion();
    // honed_body tiers at str 10/25/50: the counter is raised to the fused value.
    emit(k, checkFusion, undefined);
    expect(slice<AchievementsState>(k, 'achievements').claimed.honed_body).toBe(3);
  });

  it('the title check runs on fusion: the fused Strength earns Titan Incarnate (new)', () => {
    const k = readyForDominion();
    // Strength alone is under the title's 100: a title check earns nothing.
    expect(attr(k, 'str')).toBeLessThan(100);
    emit(k, checkTitles, undefined);
    expect(hasTitle(slice<TitlesState>(k, 'titles'), 'titan_incarnate')).toBe(false);
    // The fusion sends the check, and the fused value is over 100.
    emit(k, checkFusion, undefined);
    expect(attr(k, 'str')).toBeGreaterThanOrEqual(100);
    expect(hasTitle(slice<TitlesState>(k, 'titles'), 'titan_incarnate')).toBe(true);
  });

  it('logs the old line, with the value unformatted as the old build wrote it (new)', () => {
    const k = readyForDominion();
    // The value at fusion: the two effective values summed. Honed Body III
    // (+2 Strength), claimed off the raised counter, comes after the line.
    const sum = eff(k, 'str') + eff(k, 'cha');
    emit(k, checkFusion, undefined);
    const line = logLines(k).find((l) => l.kind === 'fusion')!;
    expect(line.msg).toBe(`👑 Fusion: Strength and Charisma merge into DOMINION (${sum}).`);
    expect(String(sum)).toMatch(/\.\d{5,}$/);
  });

  it('fuses once: later kills check nothing more for it (new)', () => {
    const k = readyForDominion();
    kill(k);
    expect(fusedOf(k)).toEqual(['dominion']);
    kill(k);
    kill(k);
    expect(fusedOf(k)).toEqual(['dominion']);
    expect(logLines(k).filter((l) => l.kind === 'fusion')).toHaveLength(1);
  });

  it('no source is stale; a load keeps the fusion; a new run starts unfused (new)', () => {
    const k = readyForDominion();
    emit(k, checkFusion, undefined);
    expect(k.staleStats()).toEqual([]);
    const sum = attr(k, 'str');
    const reloaded = makeGame({ seed: 6 });
    expect(reloaded.load(k.save(0)).ok).toBe(true);
    expect(isFused(reloaded, 'dominion')).toBe(true);
    expect(attr(reloaded, 'str')).toBeCloseTo(sum, 9);
    expect(reloaded.staleStats()).toEqual([]);
    // The old prestige built a new state with `fused: []`.
    run(reloaded, (ctx) => ctx.endRun());
    expect(fusedOf(reloaded)).toEqual([]);
    expect(attr(reloaded, 'str')).toBeCloseTo(eff(reloaded, 'str'), 9);
    expect(reloaded.staleStats()).toEqual([]);
  });
});

describe('content (the old content linter: super-attribute components)', () => {
  it('each super-attribute fuses two distinct attributes, and no attribute is in two', () => {
    const seen = new Set<string>();
    for (const def of SUPERATTR_LIST) {
      expect(def.components, def.id).toHaveLength(2);
      expect(def.components[0], def.id).not.toBe(def.components[1]);
      for (const c of def.components) {
        expect(seen.has(c), `${def.id}: ${c} is in two super-attributes`).toBe(false);
        seen.add(c);
      }
    }
    expect(Object.keys(SUPERATTRS)).toEqual(['dominion', 'force', 'martial_prowess']);
  });
});

describe('the fusion readout (old Sidebar fused chip and its tooltip)', () => {
  const html = (fused: readonly FusedView[]) => render(FusionReadout, { props: { fused } }).body;

  it('draws nothing while nothing is fused', () => {
    const k = makeGame();
    expect(fusionView(k).fused).toEqual([]);
    expect(html(fusionView(k).fused)).not.toContain('fusion-readout');
  });

  it('draws the fused pair: name, value, description and each component', () => {
    const k = withLevels(makeGame(), { str: 15, cha: 9 }, ['dominion']);
    const [view] = fusionView(k).fused;
    expect(view).toMatchObject({ id: 'dominion', name: 'Dominion', icon: '👑' });
    expect(view.value).toBeCloseTo(attr(k, 'str'), 9);
    expect(view.formula).toBeCloseTo(view.value, 9);
    expect(view.components.map((c) => [c.id, c.effective])).toEqual([
      ['str', eff(k, 'str')],
      ['cha', eff(k, 'cha')],
    ]);
    const body = html(fusionView(k).fused);
    expect(body).toContain('data-testid="fused-dominion"');
    expect(body).toContain('👑 Dominion');
    expect(body).toContain('27.2');
    expect(body).toContain(SUPERATTRS.dominion.desc);
    expect(body).toContain('Strength: <span class="num');
    expect(body).toContain('17.2');
    expect(body).toContain('Charisma: <span class="num');
    expect(body).not.toContain('Formulas read');
  });

  it('names the ceiling when the stat formulas read less than the fused value', () => {
    const k = withLevels(makeGame(), { str: 15, cha: 9 }, ['dominion']);
    const [view] = fusionView(k).fused;
    const body = html([{ ...view, formula: 20 }]);
    expect(body).toContain('Formulas read: <span class="num');
    expect(body).toContain('20.0');
  });
});
