/**
 * The psionic system as built here (step 3): the slice, the commands'
 * reasons, the school's registration, the view the panel reads, a new run.
 * The old cases are in `tests/spellcraft.test.ts`, `describe('psionic
 * shaping')`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import {
  PSIONICS_UNLOCK,
  forgetShape,
  learnAxis,
  memorize,
  raiseTier,
  shape as shapeCommand,
  shapeKey,
  shapeSpec,
  shapeSummary,
  toShape,
  toShapeList,
  type PsionicState,
  type PsionicView,
} from '../src/systems/psionic';
import { schoolOf, specForSource, spellKey, type SpellcraftState } from '../src/systems/spellcraft';
import type { SkillsState } from '../src/systems/skills';
import { logOf } from './combatHelpers';
import { equip, giveItem, makeGame, patch, slice } from './helpers';

const fresh = (seed = 1): Kernel => makeGame({ seed });
const psi = (g: Kernel) => slice<PsionicState>(g, 'psionic');
const book = (g: Kernel) => slice<SpellcraftState>(g, 'spellcraft').grimoire;
const viewOf = (g: Kernel) => g.view().systems.psionic as PsionicView;
const reason = (r: { ok: true } | { ok: false; reason: string }) => (r.ok ? '' : r.reason);

describe('psionic slice', () => {
  it('a new mind holds force and reach, tier 0, nothing in mind', () => {
    expect(psi(fresh())).toEqual({ axes: ['force', 'reach'], tier: 0, memorized: [] });
  });

  it('the teacher commands open an axis and raise the tier, and say why when they do not', () => {
    const g = fresh();
    expect(g.dispatch(learnAxis({ axis: 'grip' })).ok).toBe(true);
    expect(psi(g).axes).toEqual(['force', 'reach', 'grip']);
    expect(reason(g.dispatch(learnAxis({ axis: 'grip' })))).toBe('Grip is open already');
    expect(reason(g.dispatch(learnAxis({ axis: 'wings' })))).toBe('no psionic axis has the id "wings"');
    expect(g.dispatch(raiseTier({ tier: 4 })).ok).toBe(true);
    expect(reason(g.dispatch(raiseTier({ tier: 4 })))).toMatch(/tier is 4 already/);
    expect(psi(g).tier).toBe(4);
  });

  it('memorise and forget answer a reason when nothing happens', () => {
    const g = fresh();
    expect(reason(g.dispatch(memorize({ shape: { grip: 1 } })))).toBe('Grip needs a teacher');
    expect(reason(g.dispatch(memorize({ shape: {} })))).toBe('Shape is empty');
    expect(reason(g.dispatch(memorize({ shape: { force: 4 } })))).toBe('Force cap is 3 points (Psionics milestones raise it)');
    expect(g.dispatch(memorize({ shape: { force: 2 }, name: '  Jab  ' })).ok).toBe(true);
    expect(psi(g).memorized[0].name).toBe('Jab');
    expect(reason(g.dispatch(memorize({ shape: { force: 2, reach: 0 } })))).toBe('this shape is held in mind already');
    expect(reason(g.dispatch(forgetShape({ index: 3 })))).toBe('no shape is held at index 3');
  });
});

describe('shaping into the grimoire', () => {
  it('writes the shape in list form, pays the Psionics tags, and logs it', () => {
    const g = fresh();
    expect(g.dispatch(shapeCommand({ shape: { reach: 1, force: 3 } })).ok).toBe(true);
    const [spell] = book(g);
    expect(spell.source).toEqual({ school: 'psionic', shape: [{ axis: 'force', value: 3 }, { axis: 'reach', value: 1 }] });
    expect(spellKey(spell.source)).toBe('psionic:force3,reach1');
    expect(logOf(g).some((t) => t === '👊 Shaped: Mind Spike')).toBe(true);
    // 16 XP to the tags spellcraft, magic, psionic. A new character holds
    // neither Magic nor Psionics, so both bank it (16 times the novelty of
    // the first shaping), as the old `grantSkillXp` did.
    const latent = (slice<SkillsState>(g, 'skills') as unknown as { latent: Record<string, number> }).latent;
    expect(latent.psionics).toBeGreaterThanOrEqual(16);
    expect(latent.magic).toBeGreaterThanOrEqual(16);
  });

  it('a refused shape logs the old line and answers the reason', () => {
    const g = fresh();
    expect(reason(g.dispatch(shapeCommand({ shape: { force: 9 } })))).toMatch(/cap is 3/);
    expect(logOf(g).at(-1)).toBe('🔒 Force cap is 3 points (Psionics milestones raise it)');
    g.dispatch(shapeCommand({ shape: { force: 1 } }));
    expect(reason(g.dispatch(shapeCommand({ shape: { force: 1 } })))).toBe('That shape is already in your grimoire');
    expect(logOf(g).at(-1)).toBe('🔒 That shape is already in your grimoire.');
    expect(reason(g.dispatch(shapeCommand({ shape: [] as never })))).toBe('the shape is not a record of axis points');
  });

  it('a recognition above the taught tier is refused with its name', () => {
    const g = fresh();
    patch(g, (s) => {
      s.skills.skills.psionics = { level: 40, xp: 0 };
    });
    for (const axis of ['clairvoyance', 'space']) g.dispatch(learnAxis({ axis }));
    const r = g.dispatch(shapeCommand({ shape: { force: 4, clairvoyance: 2, space: 2 } }));
    expect(reason(r)).toBe('Shape matches Unerring Needle, which needs a teacher (tier 4)');
    expect(logOf(g).at(-1)).toBe('🔒 Shape matches Unerring Needle, which needs a teacher.');
  });
});

describe('the school', () => {
  it('is registered: a list source keys and resolves as the record shape', () => {
    const kind = schoolOf('psionic')!;
    expect(kind).toBeDefined();
    const list = toShapeList({ space: 3, force: 6, clairvoyance: 4 });
    expect(list).toEqual([
      { axis: 'force', value: 6 },
      { axis: 'clairvoyance', value: 4 },
      { axis: 'space', value: 3 },
    ]);
    expect(toShape(list)).toEqual({ force: 6, clairvoyance: 4, space: 3 });
    expect(spellKey({ school: 'psionic', shape: list })).toBe(`psionic:${shapeKey(toShape(list))}`);
    expect(specForSource({ school: 'psionic', shape: list })).toEqual(shapeSpec(toShape(list)));
  });
});

describe('the view', () => {
  it('states the shutter, the table and the mind', () => {
    const g = fresh();
    let v = viewOf(g);
    expect(v.unlocked).toBe(false);
    expect(v.atTable).toBe(false);
    // The hold's Arcane Library holds a Spellcrafting Table since step 4 port C2.
    expect(v.tables).toEqual(['The Reading Hall', 'The Nine Chapels', 'Arcane Library']);
    expect(v.cap).toBe(3);
    expect(v.axes).toEqual(['force', 'reach']);
    patch(g, (s) => {
      s.counters.counts[PSIONICS_UNLOCK] = 1;
      s.world.spot = 'the_reading_hall';
    });
    g.dispatch(memorize({ shape: { force: 2, reach: 1 } }));
    g.dispatch(shapeCommand({ shape: { force: 1 } }));
    v = viewOf(g);
    expect(v.unlocked).toBe(true);
    expect(v.atTable).toBe(true);
    expect(v.memorized).toEqual([
      { name: 'Mind Spike', shape: { force: 2, reach: 1 }, key: 'force2,reach1', summary: 'Force 2 · Reach 1' },
    ]);
    expect(v.bookKeys).toEqual(['force1']);
    expect(v.bias.acuity).toBe(1);
  });

  it('reads the gear bias off the stat block', () => {
    const g = fresh();
    const bracers = giveItem(g, 'antipattern_bracers');
    expect(equip(g, bracers.uid).ok).toBe(true);
    expect(viewOf(g).bias.acuity).toBeLessThan(1);
    expect(shapeSummary({})).toBe('an empty shape');
  });
});
