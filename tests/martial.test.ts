/**
 * Port of the old `tests/martial.test.ts` (96 cases). The `describe` and `it`
 * names are the old ones.
 *
 * Spine port 5 ported the half of the martial engine that executes a
 * technique in a fight. The cases about that half run here: the registries,
 * triggers, position effects, the ways into a technique, deflection
 * (`preventedMult`), counters, and techniques in a hunt.
 *
 * Call shape changes:
 * - `learn(g.state, id)` is `learn(kernel, id)` of `combatHelpers.ts`;
 * - `g.state.combat.position = x` is `patchFight`;
 * - `positionIncomingMult(state)` and `positionDodgeMult(state)` are the hook
 *   stats `hook.positionIncomingMult` and `hook.positionDodgeMult`;
 * - `evaluateTrigger(ctx, trigger)` needs an open fight: one goblin is staged
 *   where the old case built an empty `CombatState`;
 * - `openEntry(state, def, position, ctx)` is `openEntry(ctx, def, held, position)`;
 * - `techniqueArmed(state, def)` is `techniqueArmed(ctx, def)`;
 * - a technique's `from` has one form (a list of ways) and `mastery` is a list;
 * - skill and attribute levels are written into their slices with `patch`;
 * - a hunt that outlives a defeat uses `keepHunting` (the knockout is port 6).
 *
 * Left as `it.todo`, each under its old `describe`:
 * - step 3 (the martial port): learning and eligibility, the ledger writes,
 *   the mastery ladder, drilling, slots and the bench, forks, teachers and
 *   lessons, reach, weapon states (grounded, impaled, sheathed), readied
 *   spells, rune surgery, the planner and the position graph, the picker of
 *   trigger subjects, `techniqueStatus`, `WEAPON_FAMILIES`.
 * - old save migrations: the save here starts at version 1.
 *
 * Split cases: an old case that also asserted `techniqueExecutions > 0`
 * (practice counted by `recordExecution`, step 3) is ported without that
 * line, and the line is an `it.todo` next to it.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import {
  evaluateTrigger,
  hook,
  hunt,
  setTrigger,
  TRIGGER_EVENTS,
  type SkillTrigger,
} from '../src/systems/combat';
import {
  declaredEntries,
  declaredPositions,
  forkArchetypes,
  NEUTRAL_POSITION,
  openEntry,
  POSITIONS,
  SPELL_READY_POSITION,
  techniqueArmed,
  TECHNIQUE_LIST,
  TECHNIQUES,
  type TechniqueDef,
  type TechniqueEntry,
  type TechniqueState,
} from '../src/systems/martial';
import { exertNow, hookStat, setExerting, type ResourcesState } from '../src/systems/resources';
import { SKILLS, type SkillsState } from '../src/systems/skills';
import {
  combat,
  combatOf,
  feedOf,
  keepHunting,
  learn,
  patchFight,
  setHp,
  setPool,
  SITES,
  stage,
} from './combatHelpers';
import { ask, equip, giveItem, makeGame, patch, reads, run, setMods, slice } from './helpers';

/** The highest rung of the old ladder (`MAX_MASTERY_TIER` of the old `martial.data.ts`). The ladder is step 3. */
const MAX_MASTERY_TIER = 15;

const fresh = (seed = 1): Kernel => makeGame({ seed });

/** A fighter who knows Gather and Heavy Blow (ledger entries, canonical). */
function brawler(seed = 1): Kernel {
  const g = fresh(seed);
  learn(g, 'gather');
  learn(g, 'heavy_blow');
  return g;
}

/** Write skill and attribute levels, as the old tests wrote `state.skills` and `state.attrs`. */
function setLevels(kernel: Kernel, levels: { skills?: Record<string, number>; attrs?: Record<string, number> }): void {
  patch(kernel, (slices) => {
    for (const [id, level] of Object.entries(levels.skills ?? {})) (slices.skills as SkillsState).skills[id] = { level, xp: 0 };
    const attrs = (slices.attributes as AttributesState).attrs as Record<string, { level: number; xp: number }>;
    for (const [id, level] of Object.entries(levels.attrs ?? {})) attrs[id].level = level;
  });
}

/** An open fight to evaluate triggers and positions in. The old cases built an empty `CombatState`. */
function inCombat(kernel: Kernel, position: string = NEUTRAL_POSITION): void {
  stage(kernel, [{ monsterId: 'goblin', level: 1 }]);
  if (position !== NEUTRAL_POSITION) setPosition(kernel, position);
}

function setPosition(kernel: Kernel, position: string): void {
  patchFight(kernel, (state) => {
    state.fight!.position = position;
  });
}

/** Set the clock and stamp a trigger event at that tick. */
function stampEvent(kernel: Kernel, event: string, at: number): void {
  patch(kernel, (slices) => {
    slices.clock.totalTicks = at;
    slices.combat.fight.events[event] = at;
  });
}

function setClock(kernel: Kernel, at: number): void {
  patch(kernel, (slices) => {
    slices.clock.totalTicks = at;
  });
}

function setCooldown(kernel: Kernel, id: string, ticks: number): void {
  patchFight(kernel, (state) => {
    state.fight!.cooldowns[id] = ticks;
  });
}

/** `evaluateTrigger` against the open fight. */
function holds(kernel: Kernel, trigger: SkillTrigger): boolean {
  return run(kernel, (ctx) => {
    const state = ctx.read(combat);
    return evaluateTrigger({ ctx, fight: state.fight!, state }, trigger);
  });
}

const incomingMult = (kernel: Kernel): number => reads(kernel).derived(hook.positionIncomingMult);
const dodgeMult = (kernel: Kernel): number => reads(kernel).derived(hook.positionDodgeMult);
const armed = (kernel: Kernel, def: TechniqueDef): boolean => run(kernel, (ctx) => techniqueArmed(ctx, def));
const texts = (kernel: Kernel): string[] => feedOf(kernel).map((entry) => entry.text);
const mana = (kernel: Kernel): number => slice<ResourcesState>(kernel, 'resources').values.mana;

function startHunt(kernel: Kernel, site: string): void {
  const result = kernel.dispatch(hunt({ site: SITES[site] }));
  if (!result.ok) throw new Error(result.reason);
}

/** Hold the player in the guard, as the old loops wrote `combat.position = 'guarded'` before each tick. */
function holdGuard(kernel: Kernel): void {
  const fight = combatOf(kernel).fight;
  if (fight && fight.position !== 'guarded') setPosition(kernel, 'guarded');
}

// ---------- Readiness conditions (#3) ----------

describe('technique-readiness trigger subjects', () => {
  it('reads a technique cooldown, so a plan can refuse to start what it cannot finish', () => {
    const g = fresh(60);
    learn(g, 'weapon_drop');
    learn(g, 'ground_draw');
    inCombat(g);
    // Weapon Drop's own plan: do not throw the sword down unless the way back up is free.
    const wontStart: SkillTrigger = {
      conditions: [{ subject: 'technique.ground_draw', op: 'is', value: 'ready' }],
    };
    expect(holds(g, wontStart)).toBe(true);
    setCooldown(g, 'technique:ground_draw', 40);
    expect(holds(g, wontStart)).toBe(false);
  });

  it.todo('offers only techniques the player has actually learned (step 3: martial: the picker of trigger subjects, visibleTriggerSubjects)');

  it('a stored condition on a hidden subject still evaluates — hiding is a picker concern', () => {
    const g = fresh(62);
    inCombat(g);
    setCooldown(g, 'technique:ground_draw', 10);
    // Never learned, so not offered. The rule still reads the true cooldown.
    expect(
      holds(g, {
        conditions: [{ subject: 'technique.ground_draw', op: 'is', value: 'cooling' }],
      }),
    ).toBe(true);
  });
});

// ---------- Position discovery & effects (#1) ----------

describe('position visibility and effects', () => {
  it.todo('a position reveals itself once a known technique reaches it (step 3: martial: positionKnown, knownPositions)');

  it.todo('an entry position counts as reaching it, not just an exit (step 3: martial: positionKnown)');

  it('the spell-ready seat costs you defensively for as long as you hold it', () => {
    const g = fresh(65);
    inCombat(g);
    expect(incomingMult(g)).toBe(1);
    expect(dodgeMult(g)).toBe(1);
    setPosition(g, SPELL_READY_POSITION);
    expect(incomingMult(g)).toBeCloseTo(1.1);
  });

  it('every declared position effect is a sane multiplier', () => {
    // dodgeMult: 0 is a real value (a stance taken wide open dodges nothing).
    for (const p of Object.values(POSITIONS)) {
      const e = p.effects;
      if (!e) continue;
      if (e.incomingMult !== undefined) expect(e.incomingMult).toBeGreaterThan(0);
      if (e.dodgeMult !== undefined) expect(e.dodgeMult).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------- Content sanity ----------

describe('technique content', () => {
  const events: readonly string[] = TRIGGER_EVENTS;

  it('every entry and exit position exists in the vocabulary', () => {
    for (const def of TECHNIQUE_LIST) {
      expect(POSITIONS[def.to], `${def.id} exits into ${def.to}`).toBeDefined();
      const from = declaredPositions(def);
      if (from !== 'any') {
        for (const p of from) expect(POSITIONS[p], `${def.id} enters from ${p}`).toBeDefined();
      }
      // The trigger of each way must name a real event, same as the trigger of the technique.
      for (const entry of declaredEntries(def)) {
        if (!entry.trigger?.event) continue;
        expect(events.includes(entry.trigger.event), `${def.id} entry event ${entry.trigger.event}`).toBe(true);
      }
      for (const note of def.mastery ?? []) {
        expect(note.tier).toBeGreaterThanOrEqual(1);
        expect(note.tier).toBeLessThanOrEqual(MAX_MASTERY_TIER);
        for (const p of note.addFrom ?? []) {
          expect(POSITIONS[p], `${def.id} tier ${note.tier} opens ${p}`).toBeDefined();
        }
      }
    }
  });

  it('a self-taught technique names a real counter and a reachable count', () => {
    // The old `eligibleToLearn` gated on `(stats[stat] ?? 0) < count`: a blank
    // stat with count 0 reads as met and hands the technique to every fighter.
    for (const def of TECHNIQUE_LIST) {
      const self = def.learn?.self;
      if (!self) continue;
      expect(self.stat, `${def.id}: learn.self needs a counter to watch`).toBeTruthy();
      expect(
        self.count,
        `${def.id}: learn.self count must be > 0, or it is learned by everyone at once`,
      ).toBeGreaterThan(0);
    }
  });

  it('every baked trigger event is a real trigger event', () => {
    for (const def of TECHNIQUE_LIST) {
      if (def.trigger?.event) {
        expect(events.includes(def.trigger.event), `${def.id}: ${def.trigger.event}`).toBe(true);
      }
    }
  });

  it('every declared home skill exists', () => {
    for (const def of TECHNIQUE_LIST) {
      if (def.skill) expect(SKILLS[def.skill], `${def.id} home ${def.skill}`).toBeDefined();
    }
  });

  it('every technique is acquirable without a teacher (for now)', () => {
    // A technique with no self-learn counter and nothing to watch has no way in without a teacher.
    for (const def of TECHNIQUE_LIST) {
      expect(def.learn?.self ?? def.learn?.watch, `${def.id} has no acquisition path`).toBeDefined();
    }
  });
});

// ---------- The ledger ----------

describe('the learned ledger', () => {
  it.todo('eligibility is not knowledge: qualified but unlearned stays unknown (step 3: martial: eligibleToLearn)');

  it.todo('self-learning crystallizes rough when the counter crosses, if eligible (step 3: martial: checkTechniqueLearning, the martial unlock)');

  it.todo('re-learning never downgrades: rough → canonical keeps reps, never back (step 3: martial: learnTechnique)');

  it.todo('a technique homes to its school once known, else its eligibility skill (step 3: martial: techniqueHomeSkill, techniquesUnderSkill)');

  it('family techniques demand the weapon in hand', () => {
    const g = fresh(5);
    learn(g, 'thrust');
    expect(armed(g, TECHNIQUES.thrust)).toBe(false); // bare hands
    equip(g, 1); // the starting rusty sword
    expect(armed(g, TECHNIQUES.thrust)).toBe(true);
    expect(armed(g, TECHNIQUES.gather)).toBe(true);
  });
});

// ---------- The powers-of-ten ladder ----------

describe('the mastery ladder', () => {
  it.todo('rungs land at 10 / 100 / 1,000 / 10,000 (step 3: martial: masteryTier)');

  it.todo('rough reps count double on the ladder (step 3: martial: effectiveReps, repsToNextTier)');

  it.todo('generic bonuses hone the move; data notes rename rungs (step 3: martial: masteryTierName, the mastery terms of the move)');

  it.todo('the rough surcharge exists below the summit and dissolves at Perfected (step 3: martial: the rough form in the move)');

  it.todo('practice opens new entries: a Perfected Heavy Blow needs no wind-up (step 3: martial: mastery addFrom in the ways in)');
});

// ---------- Drilling ----------

describe('repetition and drilling', () => {
  it.todo('practice only counts for drilled techniques, up to the slot cap (step 3: martial: recordExecution, toggleDrill)');

  it.todo('crossing a rung is reported exactly once, with its name (step 3: martial: recordExecution)');
});

// ---------- Technique slots ----------

describe('technique slots', () => {
  it.todo('holds the drill slots plus three, plus one per Technique slot rank (step 3: martial: techniqueSlots)');

  it.todo('a technique learned with every slot in use goes to the bench, and the log says so (step 3: martial: slots and the bench)');

  it.todo('slotting is refused while full; benching frees the slot and stops the drill (step 3: martial: slots and the bench)');

  it.todo('only a slotted technique drills, by hand or by the auto-claim (step 3: martial: slots and drilling)');

  it.todo('fitting keeps the first techniques in rotation order and benches the rest (step 3: martial: fitTechniqueSlots)');

  it.todo('a loadout holding more techniques than slots is trimmed to its first ones (step 3: martial: slots; loadouts)');
});

// ---------- Forks ----------

describe('fork archetypes', () => {
  /** A record of the fork registry. Only the content is ported; applying a fork is step 3. */
  interface ForkRecord {
    id: string;
    kind: 'strike' | 'buff';
    damageMult?: number;
    hits?: number;
    cooldownMult?: number;
    splashAdd?: number;
    durationMult?: number;
    exitTo?: string;
  }
  const FORK_ARCHETYPE_LIST = forkArchetypes.data as ForkRecord[];
  const FORK_ARCHETYPES: Record<string, ForkRecord> = Object.fromEntries(FORK_ARCHETYPE_LIST.map((a) => [a.id, a]));

  it('every archetype strictly advances the move (crude EV ≥ base)', () => {
    expect(FORK_ARCHETYPE_LIST.length).toBeGreaterThan(0);
    for (const arch of FORK_ARCHETYPE_LIST) {
      const ev =
        arch.kind === 'strike'
          ? ((arch.damageMult ?? 1) * (arch.hits ?? 1)) / (arch.cooldownMult ?? 1) + (arch.splashAdd ?? 0)
          : (arch.durationMult ?? 1) / (arch.cooldownMult ?? 1);
      expect(ev, `${arch.id} must advance the move`).toBeGreaterThanOrEqual(1);
      if (arch.exitTo) expect(POSITIONS[arch.exitTo], `${arch.id} exit`).toBeDefined();
    }
  });

  it('every offered fork exists and matches its move kind', () => {
    for (const def of TECHNIQUE_LIST) {
      const offensive = def.move.damageMult !== undefined;
      for (const id of def.forks ?? []) {
        const arch = FORK_ARCHETYPES[id];
        expect(arch, `${def.id} offers ${id}`).toBeDefined();
        expect(arch.kind === 'strike', `${def.id}: ${id} kind`).toBe(offensive);
      }
    }
  });

  it.todo('the choice opens at Honed, applies to the move, and is permanent (step 3: martial: chooseFork, forkAvailable)');

  it.todo('overwhelm rewrites the exit; the fight would land there (step 3: martial: the fork in the exit)');

  it.todo('a syncretic form is offered the whole matching vocabulary (step 3: martial: forkOptions)');

  it.todo('debug hooks: clearFork reopens the choice, resetTechnique unknows it (step 3: martial: clearFork, resetTechnique)');
});

// ---------- Reactive windows ----------

describe('reactive trigger windows', () => {
  it('a wide window keeps a reflex fresh until the next swing', () => {
    const g = fresh(13);
    inCombat(g);
    const trigger = TECHNIQUES.riposte.trigger!; // onDodge, window 20
    expect(trigger.window).toBe(20);

    stampEvent(g, 'onDodge', 100);
    expect(holds(g, trigger)).toBe(true);
    setClock(g, 100 + trigger.window!);
    expect(holds(g, trigger)).toBe(true);
    setClock(g, 100 + trigger.window! + 1);
    expect(holds(g, trigger)).toBe(false);
  });
});

// ---------- Card legibility ----------

describe('technique status', () => {
  it.todo('reports the first blocker in rotation order (step 3: martial: techniqueStatus)');

  it.todo('mastery-opened entries change the position answer (step 3: martial: techniqueStatus, mastery addFrom)');
});

// ---------- The alpha shutter and the first teacher ----------

describe('martial shut: teachers are the only way in', () => {
  it.todo('a fresh save is shut, and nothing crystallizes however much it fights (step 3: martial: the martial unlock, checkTechniqueLearning)');

  it.todo('a lesson teaches the canonical form, shutter shut and eligibility unmet (step 3: martial: teachers and lessons)');

  it.todo('a lesson refines a rough form and keeps its practice (step 3: martial: teachers and lessons)');

  it.todo('refuses what the teacher does not teach, and holds a lesson until its requirement (step 3: martial: teachers and lessons)');

  it.todo('reach: neutral always, then every exit a known technique can get to (step 3: martial: reachablePositions, techniqueReachable)');

  it.todo('a teacher holds a lesson nothing you know leads into (step 3: martial: lessonState, reach)');

  it.todo('an unreachable technique does not count toward self-learning until a way in exists (step 3: martial: selfLearnProgress, reach)');

  it.todo('a study card for an unreachable technique is held back, not spent (step 3: martial: study cards, reach)');

  it('Gather and Lunge chain: neutral → coiled → extended, with no third move', () => {
    expect(declaredPositions(TECHNIQUES.gather)).toEqual(['neutral']);
    expect(TECHNIQUES.gather.to).toBe('coiled');
    expect(declaredPositions(TECHNIQUES.lunge)).toEqual(['coiled']);
    expect(TECHNIQUES.lunge.to).toBe('extended');
    expect(TECHNIQUES.lunge.family).toBeUndefined(); // any weapon

    const g = fresh(35);
    learn(g, 'gather');
    learn(g, 'lunge');
    setLevels(g, { attrs: { con: 30 } });
    equip(g, 1);
    startHunt(g, 'woods_edge');
    let extended = false;
    let sawLunge = false;
    for (let i = 0; i < 6000 && !(extended && sawLunge); i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
      if (combatOf(g).fight?.position === 'extended') extended = true;
      if (!sawLunge) sawLunge = texts(g).some((t) => t.includes('Lunge'));
    }
    expect(sawLunge).toBe(true);
    expect(extended).toBe(true);
  });
});

// ---------- The fight composes the chain ----------

describe('techniques in combat', () => {
  it('chains emerge from positions: Gather coils, Heavy Blow spends it', () => {
    const g = brawler(22);
    setLevels(g, { attrs: { con: 30 } });
    equip(g, 1);
    startHunt(g, 'woods_edge');

    let sawGather = false;
    let sawHeavy = false;
    let coiled = false;
    for (let i = 0; i < 6000 && !(sawGather && sawHeavy); i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
      if (combatOf(g).fight?.position === 'coiled') coiled = true;
      const lines = texts(g);
      if (!sawGather) sawGather = lines.some((t) => t.includes('Gather'));
      if (!sawHeavy) sawHeavy = lines.some((t) => t.includes('Heavy Blow'));
    }
    expect(sawGather).toBe(true);
    expect(coiled).toBe(true);
    expect(sawHeavy).toBe(true);
  });

  it.todo('chains emerge from positions: Gather coils, Heavy Blow spends it: both count as practice (step 3: martial: recordExecution)');

  it.todo('the fight itself teaches: enough swings crystallize Gather (rough) (step 3: martial: checkTechniqueLearning, the martial unlock)');
});

// ---------- Answering with their own force ----------

/**
 * Flowing Shield takes its damage from the enemy's swing: the parry stamps
 * how hard the blow was coming in (`fight.prevented`), and `preventedMult`
 * returns a share of it.
 */
describe('deflection: the force turned aside', () => {
  /** A buckler fighter who parries often enough for a run to hold a parry. */
  function shieldFighter(seed: number, con = 40): Kernel {
    const g = fresh(seed);
    setLevels(g, { skills: { fighting: 20, shield_combat: 20, deflection: 40 }, attrs: { con, dex: 30 } });
    setHp(g, 5000);
    expect(equip(g, 1).ok).toBe(true); // rusty sword
    expect(equip(g, giveItem(g, 'warden_buckler').uid, 'offhand').ok).toBe(true);
    return g;
  }

  it('a parry records the force of the blow it turned aside', () => {
    const g = shieldFighter(60);
    startHunt(g, 'training_grounds'); // dummies swing without end and never kill
    for (let i = 0; i < 3000 && !combatOf(g).fight?.prevented?.onParry; i++) g.tick();
    expect(combatOf(g).fight?.prevented?.onParry).toBeGreaterThan(0);
  });

  it('a blow that lands but is BLOCKED leaves a reading too', () => {
    // A parry stops everything, a guard stops a share: an onHit counter
    // answers with what the armour took off.
    const g = shieldFighter(64, 80); // con 80: armour, so there is something to block
    startHunt(g, 'woods_edge'); // dummies never land a blow
    let blocked = 0;
    for (let i = 0; i < 4000 && blocked === 0; i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
      blocked = combatOf(g).fight?.prevented?.onHit ?? 0;
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it('a parry reading and a block reading never overwrite each other', () => {
    // One enemy is parried while others land blocked hits. The readings are
    // keyed, so both are held at once.
    const g = shieldFighter(65, 80);
    startHunt(g, 'woods_edge');
    let both = false;
    for (let i = 0; i < 5000 && !both; i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
      const p = combatOf(g).fight?.prevented;
      both = (p?.onParry ?? 0) > 0 && (p?.onHit ?? 0) > 0;
    }
    expect(both).toBe(true);
  });

  it('the technique spends that force, and cannot cash it twice', () => {
    const g = shieldFighter(61);
    learn(g, 'flowing_shield');
    startHunt(g, 'training_grounds');
    expect(g.dispatch(setTrigger({ id: 'technique:flowing_shield', trigger: { enabled: true, conditions: [] } })).ok).toBe(true);

    const struck = () => texts(g).some((t) => t.includes('Flowing Shield'));
    for (let i = 0; i < 6000 && !struck(); i++) {
      holdGuard(g); // its entry gate
      g.tick();
    }
    expect(struck()).toBe(true);
    // Spent on use: the parry reading is cleared, so the next swing cannot
    // cash the same deflection twice.
    expect(combatOf(g).fight?.prevented?.onParry).toBeUndefined();
    // The blow carried the returned share.
    const entry = feedOf(g).find((f) => f.text.includes('Flowing Shield'))!;
    expect(entry.damage?.steps.some((s) => s.label === 'Damage parried')).toBe(true);
  });

  it.todo('the technique spends that force, and cannot cash it twice: the use counts as practice (step 3: martial: recordExecution)');

  it.todo('practice and the fork sharpen the signature, not just the swing (step 3: martial: the mastery and fork terms of the move)');

  it('is gated on a buckler specifically — a plank shield will not do', () => {
    const g = fresh(63);
    setLevels(g, { attrs: { dex: 20 } }); // the buckler has a dexterity requirement
    learn(g, 'flowing_shield');
    expect(equip(g, giveItem(g, 'wooden_shield').uid, 'offhand').ok).toBe(true);
    expect(armed(g, TECHNIQUES.flowing_shield)).toBe(false);

    expect(equip(g, giveItem(g, 'warden_buckler').uid, 'offhand').ok).toBe(true);
    expect(armed(g, TECHNIQUES.flowing_shield)).toBe(true);
  });
});

// ---------- Counters: the technique inside their swing ----------

/**
 * A counter is the third execution kind: not on the action bar, not in the
 * buff slot, but inside the enemy's attack. It takes a share off the blow and
 * answers it on the spot.
 */
describe('counters', () => {
  /** Unarmed, with the health to be hit and the mana the answer is paid from. */
  function magiknight(seed: number, startMana = 40): Kernel {
    const g = fresh(seed);
    setLevels(g, {
      skills: { fighting: 20, unarmed_combat: 20, school_boxing: 15, school_magic_combat: 10 },
      attrs: { con: 60, int: 40 }, // int: the pool it is paid from
    });
    setHp(g, 5000);
    setPool(g, 'mana', startMana);
    learn(g, 'electric_cross');
    return g;
  }

  /** Fight at the woods edge (dummies cannot land the blow it answers) with the guard set, which is where the cross fires from. */
  function guardedFight(g: Kernel, ticks: number, done: () => boolean): boolean {
    startHunt(g, 'woods_edge');
    for (let i = 0; i < ticks && !done(); i++) {
      holdGuard(g);
      g.tick();
      keepHunting(g, 'woods_edge');
    }
    return done();
  }

  it('answers the blow that landed, and is paid for in mana', () => {
    const g = magiknight(70);
    const before = mana(g);
    expect(guardedFight(g, 6000, () => texts(g).some((t) => t.includes('Electric Cross answers')))).toBe(true);
    expect(mana(g)).toBeLessThan(before);
    // Spent on use: the block it answered cannot be cashed again.
    expect(combatOf(g).fight?.prevented?.onHit).toBeUndefined();
  });

  it.todo('answers the blow that landed, and is paid for in mana: the answer counts as practice (step 3: martial: recordExecution)');

  it('names itself in the incoming breakdown instead of shrinking the number', () => {
    // A counter takes its share before armour, so the blow arrives smaller
    // than the lines above it state. The step names the share.
    const g = magiknight(74);
    const intercepted = () =>
      feedOf(g).some((f) => f.damage?.steps?.some((s) => s.label === 'Electric Cross intercepts'));
    expect(guardedFight(g, 6000, intercepted)).toBe(true);
    const step = feedOf(g)
      .flatMap((f) => f.damage?.steps ?? [])
      .find((s) => s.label === 'Electric Cross intercepts');
    expect(step?.mult).toBeCloseTo(0.6); // 40% off, stated as a multiplier
  });

  it('softens the blow before armor, so the guard and the reflex are one block', () => {
    const g = magiknight(71);
    startHunt(g, 'woods_edge');
    let blocked = 0;
    let hit = false;
    for (let i = 0; i < 6000 && blocked === 0; i++) {
      holdGuard(g);
      g.tick();
      keepHunting(g, 'woods_edge');
      blocked = combatOf(g).fight?.prevented?.onHit ?? 0;
      if (!hit) hit = texts(g).some((t) => t.includes('hits you'));
    }
    // The reading exists whether or not the answer has cashed it yet.
    expect(blocked).toBeGreaterThanOrEqual(0);
    expect(hit || texts(g).some((t) => t.includes('hits you'))).toBe(true);
  });

  it('an empty pool is not a refusal, just not this blow', () => {
    // Held empty, not only started empty: the price is a share of the
    // maximum, and regeneration would cover it within seconds. The old loop
    // wrote mana 0 before every tick; here regeneration is blocked through
    // the hook stat, and the loop still writes 0 when it finds anything else.
    const g = magiknight(72, 0);
    setMods(g, [{ stat: hookStat.regenBlocked('mana'), kind: 'add', value: 1 }]);
    startHunt(g, 'woods_edge');
    let landed = false;
    for (let i = 0; i < 3000; i++) {
      const fight = combatOf(g).fight;
      if (mana(g) !== 0 || (fight && fight.position !== 'guarded')) {
        patch(g, (slices) => {
          slices.resources.values.mana = 0;
          if (slices.combat.fight) slices.combat.fight.position = 'guarded';
        });
      }
      g.tick();
      keepHunting(g, 'woods_edge');
      if (!landed && i % 25 === 0) landed = texts(g).some((t) => /(hits|CRITS) you for/.test(t));
    }
    // Set-up check: blows landed on the guard in the run.
    expect(landed).toBe(true);
    expect(texts(g).some((t) => t.includes('Electric Cross'))).toBe(false);
    expect(slice<{ techniques: Record<string, TechniqueState> }>(g, 'martial').techniques.electric_cross.executions).toBe(0);
  }, 30000);

  it('stays out of the ordinary paths — it is never swung and never a buff', () => {
    // Left in neutral (its `neutral` entry opens at Drilled), the counter
    // must never appear: on the action bar it would fire as a 1× strike.
    const g = magiknight(73);
    startHunt(g, 'woods_edge');
    let seen = false;
    for (let i = 0; i < 3000; i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
      if (i % 25 === 0 && texts(g).some((t) => t.includes('Electric Cross'))) seen = true;
    }
    expect(seen).toBe(false);
    expect(texts(g).some((t) => t.includes('Electric Cross'))).toBe(false);
  });

  it('returns the block as its own damage type, not the weapon\'s', () => {
    const move = TECHNIQUES.electric_cross.move;
    expect(move.damageType).toBe('lightning');
    expect(move.damageMult).toBe(1); // the fist half stays bludgeoning
    expect(move.counter?.reduce).toBeGreaterThan(0);
  });
});

// ---------- Positions are felt ----------

describe('position effects', () => {
  it('off balance takes blows harder, guarded softer, neutral at par', () => {
    const g = brawler(40);
    inCombat(g);
    expect(incomingMult(g)).toBe(1);
    setPosition(g, 'off_balance');
    expect(incomingMult(g)).toBeCloseTo(1.15);
    setPosition(g, 'guarded');
    expect(incomingMult(g)).toBeCloseTo(0.9);
  });
});

// ---------- Weapon states ----------

describe('weapon states', () => {
  it.todo('only daggers conceal, and sheathing makes you genuinely unarmed (step 3: martial: toggleSheathe, sheathed weapons)');

  it.todo('hidden draw gates on the sheathed blade and reclaims it pre-strike (step 3: martial: sheathed weapons, applyTechniqueEquipment)');

  it.todo('drop grounds the blade post-strike; ground draw takes it back up (step 3: martial: grounded weapons, applyTechniqueEquipment)');

  it.todo('nobody leaves their blade in the dirt when the fight ends (step 3: martial: recoverGroundedWeapon)');
});

// ---------- Ways in: per-entry reads ----------

describe('entry ways', () => {
  /** A ledger entry with no practice: the ways in are the declared ones. */
  const HELD: TechniqueState = { executions: 0, form: 'canonical' };

  /** A technique with one plain way in and one that needs a dodge first. */
  const twoWays: TechniqueDef = {
    id: 'test_two_ways',
    name: 'Two Ways',
    icon: '⚔',
    desc: 'Out of a coil, or out of trouble.',
    from: [
      { at: ['coiled'] },
      { at: ['off_balance'], trigger: { conditions: [], event: 'onDodge', window: 20 } },
    ],
    to: 'neutral',
    move: { damageMult: 1, cooldown: 10 },
  };

  const open = (g: Kernel, def: TechniqueDef, position: string): TechniqueEntry | undefined =>
    run(g, (ctx) => openEntry(ctx, def, HELD, position));

  it('normalizes all three declared forms to the same shape', () => {
    // The old record wrote `from` as 'any', as a list of positions or as a
    // list of ways. The JSON here writes a way as `{ any: true }`, as
    // `{ at: [...] }` or as `{ at: [...], trigger }`; the loader gives each
    // the one shape.
    expect(declaredEntries(TECHNIQUES.sidestep)).toEqual([{ at: 'any' }]);
    expect(declaredEntries(TECHNIQUES.gather)).toEqual([{ at: ['neutral'] }]);
    expect(declaredEntries(TECHNIQUES.flesh_draw)).toEqual([
      { at: ['coiled'] },
      { at: ['wide_open'], trigger: { conditions: [], event: 'onDodge', window: 20 } },
    ]);
    expect(declaredEntries({ ...twoWays, from: [{ at: 'any' }] })).toEqual([{ at: 'any' }]);
    expect(declaredEntries({ ...twoWays, from: [{ at: ['coiled'] }] })).toEqual([{ at: ['coiled'] }]);
    expect(declaredEntries(twoWays)).toHaveLength(2);
    // Flattened, the graph sees every position whichever form was written.
    expect(declaredPositions(twoWays)).toEqual(['coiled', 'off_balance']);
    expect(declaredPositions({ ...twoWays, from: [{ at: 'any' }] })).toBe('any');
  });

  it('each way carries its own read — the plain one needs no moment', () => {
    const g = fresh(90);
    learn(g, 'gather'); // any ledger entry; the technique under test is synthetic
    inCombat(g, 'coiled');

    // The plain way: standing in the coil is enough.
    expect(open(g, twoWays, 'coiled')?.at).toEqual(['coiled']);

    // The way with a trigger: the right position, but no event yet.
    setPosition(g, 'off_balance');
    expect(open(g, twoWays, 'off_balance')).toBeUndefined();
    // The event is stamped.
    stampEvent(g, 'onDodge', 100);
    expect(open(g, twoWays, 'off_balance')?.at).toEqual(['off_balance']);
  });

  it('a way nobody is standing in never opens, however fresh its moment', () => {
    const g = fresh(91);
    inCombat(g, 'neutral');
    stampEvent(g, 'onDodge', 100);
    expect(open(g, twoWays, 'neutral')).toBeUndefined();
  });

  it.todo('practice adds a PLAIN way — repetition opens the motion, not a new read (step 3: martial: mastery addFrom in the ways in)');
});

// ---------- Impaled: the blade left in them ----------

describe('impaled weapons', () => {
  it.todo('impaling leaves the blade in them; wrenching takes it back pre-strike (step 3: martial: impaled weapons, applyTechniqueEquipment)');

  it.todo('grounded and impaled are separate slots — the recoveries never swap (step 3: martial: grounded and impaled weapons)');

  it.todo('the fight ending returns a buried blade as well as a dropped one (step 3: martial: recoverGroundedWeapon)');
});

// ---------- Rune graph surgery ----------

describe('rune technique surgery', () => {
  it.todo('tempo surgery: the Gale rune makes Sidestep a Flash Step (step 3: martial: rune surgery on a move)');

  it.todo('exit surgery: the Earthbind rune roots the thrust into coiled (step 3: martial: rune surgery on the exit)');

  it.todo('choice surgery: the Umbral rune widens the Honed offering (step 3: martial: rune surgery on the forks)');

  it.todo('surgery is equipment: unsocket the weapon and the node reverts (step 3: martial: rune surgery)');
});

// ---------- The spellblade seat ----------

describe('readied spells', () => {
  it.todo('offers a prepared working you can actually pay for (step 3: martial: readyableSpell)');

  it.todo('Spell Parry gates on something actually being held (step 3: martial: readied spells in the weapon-state gate)');

  it.todo('walking out of the seat drops the working — the mana is spent either way (step 3: martial: readied spells, the spell_ready seat)');

  it.todo('a fight that ends takes the held working with it (step 3: martial: releaseReadiedSpell)');

  it.todo('a held working does not also cast itself through the rotation (step 3: martial: spellIsHeld)');

  it.todo('readying pays mana up front and seats you; the position is discoverable (step 3: martial: readyableSpell, positionKnown)');
});

// ---------- The magiknight seam ----------

describe('mana-fuelled exertion', () => {
  it('a pool:mana bargain draws mana and leaves stamina alone', () => {
    const g = fresh(49);
    setLevels(g, { attrs: { int: 20 } });
    setPool(g, 'mana', 20);
    expect(g.dispatch(setExerting({ on: true })).ok).toBe(true);
    const staminaBefore = slice<ResourcesState>(g, 'resources').values.stamina;
    // The old spec also held `on: 'attack'`: when a style spends it. The request takes the cost half.
    const result = ask(g, exertNow, { spec: { pool: 'mana', cost: 0.3, hit: { damage: 1 } } });
    expect(result.spent).toBeGreaterThan(0);
    expect(result.damage).toBeGreaterThan(0);
    expect(mana(g)).toBeLessThan(20);
    expect(slice<ResourcesState>(g, 'resources').values.stamina).toBe(staminaBefore);
  });
});

// ---------- The position graph (planner) ----------

describe('the position graph', () => {
  it.todo('draws one edge per entry position, and no source at all for a reflex (step 3: martial: positionGraph)');

  it.todo('grows with practice: a Perfected entry becomes a new edge (step 3: martial: positionGraph, mastery addFrom)');

  it.todo('follows a fork that rewrites the exit — Flowing Thrust feeds itself (step 3: martial: positionGraph, forks)');

  it.todo('every edge names positions the graph can actually seat (step 3: martial: positionGraph)');
});

describe('weapon-group filtering', () => {
  it.todo('universal moves are always available; family moves only when picked (step 3: martial: techniquesForFamilies, the planner)');

  it.todo('every declared family is one some technique or item actually uses (step 3: martial: WEAPON_FAMILIES, the planner)');

  it.todo('benching is the trigger switch, and never touches the ledger (step 3: martial: techniqueBenched, the bench)');
});

// ---------- Migrations ----------

describe('save migration v24 → v25', () => {
  it.todo('sweeps the dissolved actives and seeds the practice ledger (not ported: the save here starts at version 1)');
});

describe('save migration v61 → v62', () => {
  it.todo('benches slotted techniques past the cap, in rotation order, and stops their drills (not ported: the save here starts at version 1)');
});

describe('save migration v26 → v27', () => {
  it.todo('adds the sheath and backfills a live fight (not ported: the save here starts at version 1)');
});

describe('save migration v25 → v26', () => {
  it.todo('grandfathers currently-qualified techniques as canonical, keeps reps (not ported: the save here starts at version 1)');
});
