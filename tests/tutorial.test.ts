/**
 * Port of the old `tests/tutorial.test.ts` (floor 0, the steps, the rack, the
 * skip) and of the old `tests/tutorialfocus.test.ts`. The cases keep their
 * old names.
 *
 * Call shape changes:
 * - `g.chooseTutorialWeapon(w, shield)` and `g.skipTutorial()` are the
 *   commands `tutorial/choose-weapon` and `tutorial/skip`; the old boolean is
 *   the command result's `ok`.
 * - `g.travelTo` is one hop (`world/travel`), `g.selectActivity` the command
 *   `world/select-activity`, `g.climbTo` the command `world/climb`.
 * - `tutorialStep` and `tutorialActive` read the counters and the world
 *   slices. `tutorialStepIndex` is gone; the view's `step.index` is the same
 *   number over the steps shown.
 * - `retreatSpot`, `visibleEdges`, `spotCleared` and `towerAt` are the world
 *   reads. `monsterStats(...).maxHp` is `speciesStats(...)`.
 * - `prestigeNow(state)` is the command `prestige/now` on a run with the
 *   warchief counter set.
 *
 * The step list here passes over the spell step (`shownSteps`) until arcane
 * is ported. The walk through the floor runs the eight shown steps; its
 * spell lines are left out. `chooseTutorialStance` is the command
 * `tutorial/choose-stance` (the martial port).
 *
 * `it.todo`:
 * - spell: "step 3 (arcane: the spell step)": the Intelligence floor of the
 *   spell pick, the three offered words.
 * - the two save migrations: there is no importer of the old save.
 * - every case of the old `tutorialfocus.test.ts`: it tests the UI helper
 *   `tutorialFocus` ("UI step"), but for its stance case, ported here.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { CombatState } from '../src/systems/combat';
import { counterValue, type CountersState } from '../src/systems/counters';
import { ITEMS, type ItemsState } from '../src/systems/items';
import { MONSTERS, speciesStats } from '../src/systems/monsters';
import { prestigeNow } from '../src/systems/prestige';
import type { LogState } from '../src/systems/log';
import { statOf } from '../src/systems/stats';
import type { ResourcesState } from '../src/systems/resources';
import { STYLES, styleUnlocked, type StylesState } from '../src/systems/styles';
import {
  chooseStance,
  chooseWeapon,
  shownSteps,
  skipTutorial,
  TUTORIAL_DONE_KEY,
  TUTORIAL_EXIT,
  TUTORIAL_FLAGS,
  TUTORIAL_RACK,
  TUTORIAL_STANCES,
  TUTORIAL_STEP_LIST,
  tutorialActive,
  tutorialStep,
  type TutorialView,
} from '../src/systems/tutorial';
import {
  climb,
  retreatSpot,
  selectActivity,
  spotCleared,
  SPOTS,
  STARTING_SPOT,
  towerAt,
  visibleEdges,
} from '../src/systems/world';
import { makeGame, reads, run, slice } from './helpers';
import { counterOf, hop, setCounters, worldOf } from './worldHelpers';

const counts = (g: Kernel): CountersState => slice<CountersState>(g, 'counters');
const itemsOf = (g: Kernel): ItemsState => slice<ItemsState>(g, 'items');
const facts = (g: Kernel) => ({ counts: counts(g), world: worldOf(g) });
const stepId = (g: Kernel): string | undefined => tutorialStep(facts(g))?.id;
const active = (g: Kernel): boolean => tutorialActive(counts(g));

/** Run the current travel to arrival. */
function walk(g: Kernel): void {
  expect(worldOf(g).travel).toBeTruthy();
  for (let i = 0; i < 10_000 && worldOf(g).travel; i++) g.tick();
  expect(worldOf(g).travel).toBeNull();
}

/** Hunt at the current spot until one fight is won (or the budget runs out). */
function winOneFight(g: Kernel, spot: string): void {
  const before = counterOf(g, `fights:${spot}`);
  expect(g.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
  for (let i = 0; i < 20_000 && counterOf(g, `fights:${spot}`) === before; i++) g.tick();
  expect(counterOf(g, `fights:${spot}`)).toBe(before + 1);
}

describe('floor 0 — where a life opens', () => {
  it('starts in the holding cell, which is a haven and the safety fallback', () => {
    const g = makeGame({ seed: 1 });
    expect(worldOf(g).spot).toBe('f0_cell');
    expect(STARTING_SPOT).toBe('f0_cell');
    expect(active(g)).toBe(true);
    expect(retreatSpot(reads(g), worldOf(g))).toBe('f0_cell');
  });

  it('the ladder does not answer from floor 0 — the gate is the only way up', () => {
    const g = makeGame({ seed: 1 });
    expect(towerAt(worldOf(g).spot)).toBeNull();
    expect(g.dispatch(climb({ floor: 'ascent_f1' })).ok).toBe(false);
    expect(worldOf(g).travel).toBeNull();
  });

  it('the gate is one-way: the Foot never lists a road back down', () => {
    const g = makeGame({ seed: 1 });
    const w = worldOf(g);
    expect(visibleEdges(reads(g), w, 'f0_gate').map((e) => e.to)).toContain(TUTORIAL_EXIT);
    expect(visibleEdges(reads(g), w, TUTORIAL_EXIT).map((e) => e.to)).not.toContain('f0_gate');
  });

  it('the Cell Slime deals exactly 1 per landed hit and takes a few from a starting sword', () => {
    const g = makeGame({ seed: 3 });
    expect(g.dispatch(chooseWeapon({ weapon: 'sword' })).ok).toBe(true);
    const dmg = statOf(reads(g), 'damage');
    expect(dmg).toBeGreaterThan(5);
    expect(MONSTERS.slime_cell.fixedDamage).toBe(1);
    // The old loop ran 20 seeds over the same fixed attributes; one call is the same check.
    const hp = speciesStats('slime_cell', { str: 0, dex: 2, con: 1.5, int: 1, wis: 1, cha: 1 }, 1).maxHp;
    expect(hp / dmg).toBeGreaterThan(1.5);
    expect(hp / dmg).toBeLessThan(8);
  });
});

describe('the tutorial — nine panels read off the world', () => {
  it('walks in order: rack, stance, cellblock, fight, field, spell, cast, gate, foot', () => {
    // The spell step is passed over here (arcane, step 3); the other eight
    // are walked in the old order.
    const g = makeGame({ seed: 7 });
    const view = () => g.view().systems.tutorial as TutorialView;

    expect(stepId(g)).toBe('arm');
    expect(view().step?.index).toBe(1);
    expect(g.dispatch(chooseWeapon({ weapon: 'spear', shield: true })).ok).toBe(true);
    // A spear takes both hands: the shield is refused quietly.
    expect(itemsOf(g).equipment.weapon?.defId).toBe('old_spear');
    expect(itemsOf(g).equipment.offhand).toBeUndefined();
    expect(g.dispatch(chooseWeapon({ weapon: 'sword' })).ok).toBe(false); // the rack is empty now
    expect(stepId(g)).toBe('stance');

    expect(g.dispatch(chooseStance({ style: 'aggressive' })).ok).toBe(true);
    expect(slice<StylesState>(g, 'styles').style).toBe('aggressive');
    expect(stepId(g)).toBe('cellblock');

    expect(hop(g, 'f0_cellblock')).toBe(true);
    walk(g);
    expect(stepId(g)).toBe('fight');

    winOneFight(g, 'f0_cellblock');
    expect(counterOf(g, 'slain:f0_cellblock:slime_cell')).toBe(1);
    expect(spotCleared(reads(g), SPOTS.f0_cellblock)).toBe(true);
    expect(stepId(g)).toBe('field');
    // The panel never lied: the slime's blows were 1 each.
    expect(slice<ResourcesState>(g, 'resources').values.hp).toBeGreaterThanOrEqual(statOf(reads(g), 'maxHp') - 40);

    g.dispatch(selectActivity({ activity: null }));
    expect(hop(g, 'f0_field')).toBe(true);
    walk(g);
    expect(stepId(g)).toBe('cast');

    winOneFight(g, 'f0_field');
    expect(stepId(g)).toBe('gate');

    g.dispatch(selectActivity({ activity: null }));
    expect(hop(g, 'f0_gate')).toBe(true);
    walk(g);
    expect(stepId(g)).toBe('leave');

    expect(hop(g, TUTORIAL_EXIT)).toBe(true);
    walk(g);
    expect(worldOf(g).spot).toBe(TUTORIAL_EXIT);
    expect(tutorialStep(facts(g))).toBeNull();
    expect(active(g)).toBe(false);
    expect(counterOf(g, TUTORIAL_DONE_KEY)).toBe(1);
    expect(slice<LogState>(g, 'log').log.some((l) => l.msg.includes('Tutorial complete'))).toBe(true);
  });

  it('the stance pick sets the style', () => {
    const g = makeGame({ seed: 4 });
    expect(g.dispatch(chooseStance({ style: 'defensive' })).ok).toBe(true);
    expect(slice<StylesState>(g, 'styles').style).toBe('defensive');
    expect(counterOf(g, TUTORIAL_FLAGS.stance)).toBe(1);
    expect(slice<LogState>(g, 'log').log.some((l) => l.msg.includes('Stance set: 🐢 Brace'))).toBe(true);
    // Stamped once: the card does not take a second pick.
    expect(g.dispatch(chooseStance({ style: 'crush' })).ok).toBe(false);
    expect(slice<StylesState>(g, 'styles').style).toBe('defensive');
  });
  it.todo('the spell pick prepares a one-word spell and raises Intelligence to 2 (step 3 (arcane: the spell step))');

  it('the sword pick equips the sword already in the pack, and a shield beside it', () => {
    const g = makeGame({ seed: 2 });
    expect(itemsOf(g).inventory.map((i) => i.defId)).toEqual(['rusty_sword']);
    expect(g.dispatch(chooseWeapon({ weapon: 'sword', shield: true })).ok).toBe(true);
    expect(itemsOf(g).equipment.weapon?.defId).toBe('rusty_sword');
    expect(itemsOf(g).equipment.offhand?.defId).toBe('wooden_shield');
    expect(itemsOf(g).inventory).toHaveLength(0);
  });

  it('every rack entry names a real item, and unarmed is a real pick', () => {
    for (const [id, pick] of Object.entries(TUTORIAL_RACK)) {
      if (pick.item) expect(ITEMS[pick.item], `${id} → ${pick.item}`).toBeTruthy();
    }
    const g = makeGame({ seed: 4 });
    expect(g.dispatch(chooseWeapon({ weapon: 'unarmed', shield: true })).ok).toBe(true);
    expect(itemsOf(g).equipment.weapon).toBeUndefined();
    expect(itemsOf(g).equipment.offhand).toBeUndefined();
    expect(counterOf(g, TUTORIAL_FLAGS.weapon)).toBe(1);
  });

  it.todo('the spell pick never lowers Intelligence a plaque-reader already earned (step 3 (arcane: the spell step))');

  it.todo('offers exactly the three words the user named, each a legal one-word sentence (step 3 (arcane: the spell step))');

  it('skip: defaults for every choice, the Foot, and the tutorial gone for good', () => {
    const g = makeGame({ seed: 8 });
    g.dispatch(chooseStance({ style: 'crush' }));
    expect(g.dispatch(skipTutorial()).ok).toBe(true);
    const w = worldOf(g);
    expect(w.spot).toBe(TUTORIAL_EXIT);
    expect(w.discovered).toContain(TUTORIAL_EXIT);
    expect(itemsOf(g).inventory.map((i) => i.defId)).toEqual(['rusty_sword']);
    expect(slice<StylesState>(g, 'styles').style).toBe('crush'); // a choice already made is kept
    // The skip stamps the stance and spell flags as the old skip did.
    expect(counterOf(g, TUTORIAL_FLAGS.stance)).toBe(1);
    expect(counterOf(g, TUTORIAL_FLAGS.spell)).toBe(1);
    expect(active(g)).toBe(false);
    expect(tutorialStep(facts(g))).toBeNull();
    expect(w.safeSpots.nearest).toBe(TUTORIAL_EXIT);
    expect(g.dispatch(skipTutorial()).ok).toBe(false);
    // Skipping in the middle of the slime fight abandons it rather than losing it.
    const h = makeGame({ seed: 9 });
    expect(hop(h, 'f0_cellblock')).toBe(true);
    walk(h);
    h.dispatch(selectActivity({ activity: 'hunt' }));
    for (let i = 0; i < 200 && !slice<CombatState>(h, 'combat').fight; i++) h.tick();
    expect(slice<CombatState>(h, 'combat').fight).toBeTruthy();
    expect(h.dispatch(skipTutorial()).ok).toBe(true);
    expect(slice<CombatState>(h, 'combat').fight).toBeNull();
    expect(worldOf(h).activity).toBeNull();
  });

  it('a step done early stays done: the panel shows the first thing still open', () => {
    // Out of order: the old case picked the spell first. That pick is step 3;
    // its flag is what the step reads, so the flag is set here.
    const g = makeGame({ seed: 10 });
    setCounters(g, { [TUTORIAL_FLAGS.spell]: 1 });
    expect(stepId(g)).toBe('arm');
    g.dispatch(chooseWeapon({ weapon: 'dagger' }));
    g.dispatch(chooseStance({ style: 'balanced' }));
    expect(stepId(g)).toBe('cellblock');
    expect(TUTORIAL_STEP_LIST.map((s) => s.id)).toEqual([
      'arm', 'stance', 'cellblock', 'fight', 'field', 'spell', 'cast', 'gate', 'leave',
    ]);
    expect(shownSteps().map((s) => s.id)).toEqual(['arm', 'stance', 'cellblock', 'fight', 'field', 'cast', 'gate', 'leave']);
  });
});

describe('the tutorial and older saves', () => {
  it.todo('migration to v54 stamps the tutorial done on any save that predates it (no importer of the old save)');

  it.todo('a save that lost its spot to the shelved countryside wakes at the Foot, not in the cell (no importer of the old save)');

  it('a second life opens at the Foot with the tutorial already done', () => {
    const g = makeGame({ seed: 13 });
    setCounters(g, { 'slain:f6_great_hall:goblin_warchief': 1, 'gold:earned': 1000 });
    expect(g.dispatch(prestigeNow()).ok).toBe(true);
    expect(worldOf(g).spot).toBe(TUTORIAL_EXIT);
    expect(active(g)).toBe(false);
    expect(counterValue(counts(g), TUTORIAL_DONE_KEY)).toBe(1);
  });
});

describe('the floor 0 screen — what each step shows and points at', () => {
  it.todo('has a screen for every step and none for a step that does not exist (UI step)');
  it.todo('points at each step’s control and adds tabs as the steps name them (UI step)');
  it.todo('points back at the place when the player walked past a fight step (UI step)');
  it('offers step 2’s three stances, every one open on a new save', () => {
    const g = makeGame({ seed: 13 });
    expect([...TUTORIAL_STANCES]).toEqual(['balanced', 'aggressive', 'defensive']);
    for (const id of TUTORIAL_STANCES) {
      expect(STYLES[id], id).toBeTruthy();
      expect(run(g, (ctx) => styleUnlocked(ctx, STYLES[id])), id).toBe(true);
    }
    g.dispatch(chooseWeapon({ weapon: 'sword' }));
    expect((g.view().systems.tutorial as TutorialView).stances.map((st) => st.id)).toEqual([...TUTORIAL_STANCES]);
  });
  it.todo('opens the tab a target is drawn on (UI step)');
});
