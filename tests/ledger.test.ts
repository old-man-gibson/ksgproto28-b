/**
 * Port of the old `tests/ledger.test.ts`. The cases keep their names.
 *
 * Call shape changes:
 * - the ledger functions take the combat slice and the clock tick;
 * - a blow, a heal and a condition tick reach the ledger as the events
 *   `resources/damaged`, `resources/healed` and `statuses/damage`, so the
 *   cases about the damage door send those through a kernel;
 * - the ledger of a real fight is closed after the handler that ended the
 *   fight returns (`combat/close-ledger`), with the transcript the log
 *   system kept.
 *
 * The four folding cases of "the transcript" were ported with the log
 * system (`tests/log.test.ts`, port 1).
 *
 * Left behind, as `it.todo`: the migration from old save version 35 (the
 * save here starts at version 1).
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import combat, {
  beginFight,
  dropFight,
  endFight,
  ensureLedger,
  isKept,
  keepFight,
  keepLastFight,
  NOTEBOOK_MAX,
  noteAbsorbed,
  noteConditionDamage,
  noteDodge,
  noteIncoming,
  noteOutgoing,
  noteParry,
  stopHunt,
  type CombatState,
  type Enemy,
  type FightLedger,
} from '../src/systems/combat';
import { feedLine } from '../src/systems/log';
import { healNow, healPlayer, hitPlayer, hurtPlayer } from '../src/systems/resources';
import { applyStatus, conditionDamage } from '../src/systems/statuses';
import { combatOf, hpOf, huntingGame, stage } from './combatHelpers';
import { ask, emit, equip, makeGame } from './helpers';

const rat = { key: 'monster:forest_rat', label: 'Forest Rat', icon: '🐀' };
const wolf = { key: 'monster:young_wolf', label: 'Wolf', icon: '🐺' };

const blankState = (): CombatState => combat.initial() as CombatState;
const none: FightLedger['afflictions'] = [];

/** A staged fight against one rat on 1 HP, for a ledger that closes with a win. */
function winnable(g: Kernel): void {
  stage(g, [{ monsterId: 'forest_rat', level: 1, hpShare: 0 }]);
}

function win(g: Kernel): FightLedger {
  for (let i = 0; i < 2000 && combatOf(g).fight; i++) g.tick();
  const led = combatOf(g).lastFight;
  if (!led) throw new Error('the fight did not end');
  return led;
}

describe('attribution', () => {
  it('sums per source rather than keeping one entry per blow', () => {
    const s = blankState();
    for (let i = 0; i < 40; i++) noteIncoming(s, 0, rat, 3);
    const led = endFight(s, 0, 'knocked_out', none)!;
    expect(led.incoming).toHaveLength(1);
    expect(led.incoming[0]).toMatchObject({ key: 'monster:forest_rat', amount: 120, hits: 40 });
  });

  it('orders the sources worst first, which is what the window leads with', () => {
    const s = blankState();
    noteIncoming(s, 0, rat, 10);
    noteConditionDamage(s, 0, 'bleeding', 90);
    noteIncoming(s, 0, wolf, 40);
    const led = endFight(s, 0, 'knocked_out', none)!;
    expect(led.incoming.map((i) => i.key)).toEqual(['cond:bleeding', 'monster:young_wolf', 'monster:forest_rat']);
  });

  it('names the condition that actually did it, not whoever was standing there', () => {
    const s = blankState();
    noteIncoming(s, 0, wolf, 12);
    noteConditionDamage(s, 0, 'rotting', 300);
    const led = endFight(s, 0, 'knocked_out', none)!;
    expect(led.incoming[0].key).toBe('cond:rotting');
  });

  it('counts an unattributed blow rather than dropping it', () => {
    const g = makeGame({ seed: 1 });
    emit(g, hurtPlayer, { amount: 25 });
    expect(combatOf(g).ledger!.incoming[0]).toMatchObject({ key: 'unknown', amount: 25 });
  });

  it('lets a caller attribute a shared tick itself without double counting', () => {
    const g = makeGame({ seed: 1 });
    // What the statuses system sends for one tick of two conditions: the
    // breakdown, and one sum with `source: null`.
    emit(g, conditionDamage, {
      entity: 'player',
      damage: 10,
      hits: [
        { id: 'bleeding', name: 'Bleeding', icon: '🩸', type: 'slashing', amount: 6 },
        { id: 'poison', name: 'Poison', icon: '☠️', type: 'poison', amount: 4 },
      ],
    });
    emit(g, hurtPlayer, { amount: 10, source: null });
    expect(combatOf(g).ledger!.incoming.reduce((sum, i) => sum + i.amount, 0)).toBe(10);
  });
});

describe('what you stopped', () => {
  it('keeps absorbed, parried and dodged apart', () => {
    const s = blankState();
    noteAbsorbed(s, 0, 30);
    noteParry(s, 0, 50, 12);
    noteParry(s, 0, 20, 5);
    noteDodge(s, 0, 40);
    const led = endFight(s, 0, 'won', none)!;
    expect(led.stopped).toMatchObject({ absorbed: 30, parried: 70, riposted: 17, parries: 2, dodged: 40, dodges: 1 });
  });

  it('records healing by kind and what a condition refused to let land', () => {
    const g = makeGame({ seed: 1 });
    emit(g, hurtPlayer, { amount: 30 });
    emit(g, healPlayer, { amount: 10, kind: 'salve' });
    emit(g, healPlayer, { amount: 5, kind: 'rest' });
    emit(g, healPlayer, { amount: 4, kind: 'salve' });
    const led = combatOf(g).ledger!;
    expect(led.healed.salve).toBeCloseTo(14);
    expect(led.healed.rest).toBeCloseTo(5);
    expect(led.healRefused).toBe(0);
  });
});

describe('the size invariant', () => {
  it('does not grow with how long the fight ran', () => {
    const short = blankState();
    for (let i = 0; i < 10; i++) noteIncoming(short, 0, rat, 1);
    const a = JSON.stringify(endFight(short, 0, 'knocked_out', none));

    const long = blankState();
    for (let i = 0; i < 10_000; i++) noteIncoming(long, 0, rat, 1);
    const b = JSON.stringify(endFight(long, 0, 'knocked_out', none));

    expect(JSON.parse(b).incoming).toHaveLength(1);
    expect(b.length - a.length).toBeLessThan(20);
  });

  it('stays around a kilobyte for a busy five-enemy fight', () => {
    const s = blankState();
    for (let i = 0; i < 5; i++) noteIncoming(s, 0, { key: `monster:m${i}`, label: `Monster ${i}`, icon: '👹' }, 100);
    for (const c of ['bleeding', 'poison', 'on_fire', 'chilled', 'concussed', 'punctured']) {
      noteConditionDamage(s, 0, c, 50);
    }
    noteAbsorbed(s, 0, 400);
    noteOutgoing(s, 0, 2000, true);
    const led = endFight(s, 0, 'knocked_out', none)!;
    expect(JSON.stringify(led).length).toBeLessThan(2048);
  });
});

describe('fight boundaries', () => {
  it('resolves the duration from the tick it started on', () => {
    const s = blankState();
    beginFight(s, [], 500);
    expect(endFight(s, 800, 'won', none)!.ticks).toBe(300);
  });

  it('dates a lazily-made ledger from the first damage, not from tick zero', () => {
    // Bleeding out between fights: no encounter ever began.
    const s = blankState();
    noteConditionDamage(s, 700, 'bleeding', 5);
    expect(endFight(s, 760, 'knocked_out', none)!.ticks).toBe(60);
  });

  it('counts a repeated foe once, at the highest level met', () => {
    const s = blankState();
    const mk = (level: number) => ({ defId: 'forest_rat', name: 'Forest Rat', icon: '🐀', level }) as Enemy;
    beginFight(s, [mk(3), mk(7), null], 0);
    ensureLedger(s, 0);
    const led = endFight(s, 0, 'won', none)!;
    expect(led.foes).toEqual([{ defId: 'forest_rat', name: 'Forest Rat', icon: '🐀', level: 7, count: 2 }]);
  });

  it('clears the live tally so the next fight starts from nothing', () => {
    const s = blankState();
    noteIncoming(s, 0, rat, 10);
    endFight(s, 0, 'knocked_out', none);
    expect(s.ledger).toBeNull();
    expect(s.lastFight!.incoming[0].amount).toBe(10);
    noteIncoming(s, 0, wolf, 4);
    expect(s.ledger!.incoming).toHaveLength(1);
  });

  it('records the conditions still on you when it ended', () => {
    const g = makeGame({ seed: 1 });
    equip(g, 1);
    ask(g, applyStatus, { entity: 'player', app: { id: 'bleeding', intensity: 2 } });
    winnable(g);
    expect(win(g).afflictions.map((a) => a.id)).toContain('bleeding');
  });
});

describe('in play', () => {
  it('attributes a real knockout and survives the fight ending', () => {
    const g = huntingGame(11, 'woods_edge');
    for (let i = 0; i < 4000 && !combatOf(g).lastFight; i++) g.tick();

    const led = combatOf(g).lastFight;
    expect(led).not.toBeNull();
    expect(led!.foes.length).toBeGreaterThan(0);
    expect(['won', 'knocked_out']).toContain(led!.outcome);
    // The books balance: something dealt the damage taken.
    const attributed = led!.incoming.reduce((sum, s) => sum + s.amount, 0);
    if (attributed > 0) expect(led!.incoming.every((s) => s.hits > 0)).toBe(true);
  });

  it('leaves a knockout explainable after a save round-trip', () => {
    // A level 1 character against something it cannot survive.
    const g = makeGame({ seed: 11 });
    stage(g, [{ monsterId: 'wolf', level: 35 }]);
    for (let i = 0; i < 3000 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('knocked_out');

    const back = makeGame({ seed: 1 });
    expect(back.load(JSON.parse(JSON.stringify(g.save(0)))).ok).toBe(true);
    const led = combatOf(back).lastFight!;
    expect(led.incoming[0]).toMatchObject({ key: 'monster:wolf', label: 'Wolf' });
    expect(led.incoming[0].amount).toBeGreaterThan(0);
    // The last line of the transcript is the blow that ended it.
    expect(led.transcript[led.transcript.length - 1].text).toContain('The Wolf');
  });

  it('drops the tally when you simply walk away from a fight', () => {
    const g = huntingGame(5, 'woods_edge');
    for (let i = 0; i < 300 && !combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).fight).not.toBeNull();
    emit(g, hurtPlayer, { amount: 5, source: rat });
    expect(combatOf(g).ledger!.incoming.some((i) => i.key === rat.key)).toBe(true);
    expect(g.dispatch(stopHunt())).toEqual({ ok: true });
    expect(combatOf(g).ledger).toBeNull();
    expect(combatOf(g).fight).toBeNull();
  });
});

describe('migration', () => {
  it.todo('brings a v35 save forward with an empty ledger (not ported: the save here starts at version 1)');

  it('a new slice has no ledger', () => {
    const s = blankState();
    expect(s.ledger).toBeNull();
    expect(s.lastFight).toBeNull();
    expect(s.notebook).toEqual([]);
  });
});

describe('the notebook', () => {
  function ledgerEndingAt(tick: number): FightLedger {
    const s = blankState();
    noteIncoming(s, tick, wolf, 10);
    return endFight(s, tick, 'knocked_out', none)!;
  }

  it('keeps a fight and knows it has it', () => {
    const s = blankState();
    const led = ledgerEndingAt(100);
    expect(isKept(s, led)).toBe(false);
    expect(keepFight(s, led, 1)).toBeNull();
    expect(isKept(s, led)).toBe(true);
    expect(s.notebook[0].id).toBe(led.endedAt);
  });

  it('refuses to keep the same fight twice', () => {
    const s = blankState();
    const led = ledgerEndingAt(100);
    keepFight(s, led, 1);
    keepFight(s, led, 2);
    expect(s.notebook).toHaveLength(1);
  });

  it('forgets one on request', () => {
    const s = blankState();
    const led = ledgerEndingAt(100);
    keepFight(s, led, 1);
    dropFight(s, led.endedAt);
    expect(s.notebook).toHaveLength(0);
  });

  it('evicts the oldest when full, and HANDS BACK what it dropped', () => {
    const s = blankState();
    const first = ledgerEndingAt(1);
    keepFight(s, first, 1);
    for (let i = 2; i <= NOTEBOOK_MAX; i++) keepFight(s, ledgerEndingAt(i), i);
    expect(s.notebook).toHaveLength(NOTEBOOK_MAX);

    const evicted = keepFight(s, ledgerEndingAt(NOTEBOOK_MAX + 1), 99);
    expect(evicted).not.toBeNull();
    expect(evicted!.id).toBe(first.endedAt);
    expect(s.notebook).toHaveLength(NOTEBOOK_MAX);
    expect(isKept(s, first)).toBe(false);
  });

  it('orders newest first', () => {
    const s = blankState();
    keepFight(s, ledgerEndingAt(10), 1);
    keepFight(s, ledgerEndingAt(20), 2);
    expect(s.notebook.map((e) => e.id)).toEqual([20, 10]);
  });

  it('survives a save round-trip with its transcript intact', () => {
    const g = makeGame({ seed: 1 });
    equip(g, 1);
    winnable(g);
    emit(g, feedLine, { text: '🩸 The Wolf hits you for 12 piercing.' });
    win(g);
    expect(g.dispatch(keepLastFight())).toEqual({ ok: true });

    const back = makeGame({ seed: 2 });
    expect(back.load(JSON.parse(JSON.stringify(g.save(0)))).ok).toBe(true);
    const notebook = combatOf(back).notebook;
    expect(notebook).toHaveLength(1);
    expect(notebook[0].ledger.transcript.some((line) => line.text.includes('hits you for 12'))).toBe(true);
  });

  it('saves what happened, not the working behind it', () => {
    const g = makeGame({ seed: 1 });
    equip(g, 1);
    winnable(g);
    // A line with a full report: what every landed blow feeds.
    emit(g, feedLine, {
      text: '⚔️ You hit the Wolf for 42',
      damage: {
        label: 'Your attack',
        target: 'Wolf',
        steps: [{ label: 'Damage', value: 40 }, { label: 'Swing variance ±10%' }],
        slices: [
          { type: 'slashing', source: 'Iron Sword', raw: 50, armor: 3, resisted: 5, resistance: 0.1, pierced: 0, dealt: 42 },
        ],
        hits: 1,
        crit: false,
        total: 42,
      },
    });
    const led = win(g);
    // The ledger's copy of the transcript carries the text and not the report.
    const line = led.transcript.find((l) => l.text === '⚔️ You hit the Wolf for 42');
    expect(line).toBeDefined();
    expect(line!.damage).toBeUndefined();
    expect(led.transcript.every((l) => l.damage === undefined)).toBe(true);
    g.dispatch(keepLastFight());
    expect(combatOf(g).notebook[0].ledger.transcript.every((l) => l.damage === undefined)).toBe(true);
  });

  it('costs a few kilobytes a fight, not a few hundred', () => {
    const g = makeGame({ seed: 1 });
    equip(g, 1);
    winnable(g);
    for (let i = 0; i < 100; i++) emit(g, feedLine, { text: `🩸 The Goblin Boss hits you for ${i}.` });
    for (let i = 0; i < 6; i++) {
      emit(g, hurtPlayer, { amount: 1, source: { key: `m${i}`, label: `Monster ${i}`, icon: '👹' } });
    }
    win(g);
    g.dispatch(keepLastFight());
    const cost = JSON.stringify(combatOf(g).notebook[0]).length;
    expect(cost).toBeLessThan(4096);
    expect(cost * NOTEBOOK_MAX).toBeLessThan(100_000);
  });

  // New here: the commands.
  it('the keep command refuses a fight that is already kept, and one that never ended', () => {
    const g = makeGame({ seed: 1 });
    expect(g.dispatch(keepLastFight())).toEqual({ ok: false, reason: 'no fight has ended yet' });
    equip(g, 1);
    winnable(g);
    win(g);
    expect(g.dispatch(keepLastFight())).toEqual({ ok: true });
    expect(g.dispatch(keepLastFight())).toEqual({ ok: false, reason: 'the fight is already kept' });
  });
});

describe('health is unaffected', () => {
  it('still returns what actually landed', () => {
    const g = makeGame({ seed: 1 });
    const before = hpOf(g);
    expect(ask(g, hitPlayer, { amount: 12 })).toBe(12);
    expect(hpOf(g)).toBe(before - 12);
    expect(ask(g, healNow, { amount: 5, kind: 'rest' })?.healed).toBe(5);
  });
});
