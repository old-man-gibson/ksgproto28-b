import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { START_TICKS } from '../src/systems/clock';
import log, {
  appendFeed,
  appendLog,
  FEED_MAX,
  feedFloating,
  feedFloatingRun,
  feedLine,
  feedRepeat,
  feedRepeatLine,
  feedSettle,
  fillText,
  hiddenLabels,
  HUNT_WINDOW,
  huntLine,
  LOG_LABELS_MAX,
  LOG_MAX,
  logLine,
  placeholdersOf,
  renderLine,
  repeatLine,
  settleFloating,
  TRANSCRIPT_MAX,
  transcriptClose,
  transcriptForSave,
  transcriptOpen,
  type DamageReport,
  type LogEntry,
  type LogState,
  type LogTally,
} from '../src/systems/log';
import { emit, makeGame, slice } from './helpers';

/**
 * Port of the old tests/log.test.ts, the template cases of
 * tests/logtext.test.ts and the transcript cases of tests/ledger.test.ts.
 * Changed: the state is the log slice, and the transcript is a list on that
 * slice (the old build kept it on the fight ledger).
 *
 * Left behind, for the ports of the systems they need:
 * - "conditions in play": a held condition feeding a floating run (statuses);
 * - "activities in play", "hunting in play", the "appears" lines (world, combat);
 * - tests/logtext.test.ts: every template has a call site and every call
 *   site supplies its placeholders. That test scans the whole old core; here
 *   each system owns its templates;
 * - tests/ledger.test.ts apart from the transcript: the fight ledger (combat).
 */

const fresh = (): LogState => log.initial();

function line(group: string | undefined, prefix: string, tally: LogTally[], t = 0): LogEntry {
  return { msg: renderLine(prefix, tally), kind: 'loot', t, group, prefix, tally };
}

function msgs(state: LogState): string[] {
  return state.log.map((l) => l.msg);
}

describe('log line rendering', () => {
  it('counts things and reads amounts the other way round', () => {
    expect(renderLine('🔨 Crafted', [{ label: '🪨 Iron Ingot', qty: 1 }])).toBe(
      '🔨 Crafted 🪨 Iron Ingot',
    );
    expect(renderLine('🔨 Crafted', [{ label: '🪨 Iron Ingot', qty: 12 }])).toBe(
      '🔨 Crafted 🪨 Iron Ingot ×12',
    );
    expect(renderLine('💰 Shift pay:', [{ label: 'gold', qty: 500, style: 'amount' }])).toBe(
      '💰 Shift pay: 500 gold',
    );
  });
});

describe('repeat grouping', () => {
  it('folds repeats into a running count instead of a new line', () => {
    const s = fresh();
    for (let i = 0; i < 5; i++) {
      appendLog(s, line('act:mine', '🧺 Gathered:', [{ label: '🪨 Iron Ore', qty: 1 }], i));
    }
    expect(msgs(s)).toEqual(['🧺 Gathered: 🪨 Iron Ore ×5']);
  });

  it('keeps a separate count per output when a run yields several things', () => {
    const s = fresh();
    const g = 'act:orchard';
    // 100 runs: gold every other time, an apple most times, a rare golden one.
    for (let i = 0; i < 50; i++) {
      appendLog(s, line(g, '🧺 Gathered:', [{ label: 'gold', qty: 10, style: 'amount' }]));
    }
    for (let i = 0; i < 75; i++) {
      appendLog(s, line(g, '🧺 Gathered:', [{ label: '🍎 Apple', qty: 1 }]));
    }
    for (let i = 0; i < 2; i++) {
      appendLog(s, line(g, '🧺 Gathered:', [{ label: '✨ Golden Apple', qty: 1 }]));
    }
    expect(msgs(s)).toEqual(['🧺 Gathered: 500 gold, 🍎 Apple ×75, ✨ Golden Apple ×2']);
  });

  it('ends the run when anything else is logged in between', () => {
    const s = fresh();
    const gathered = () => line('act:mine', '🧺 Gathered:', [{ label: '🪨 Iron Ore', qty: 1 }]);
    appendLog(s, gathered());
    appendLog(s, gathered());
    appendLog(s, { msg: '📈 Mining level 5!', kind: 'skill', t: 0 });
    appendLog(s, gathered());
    expect(msgs(s)).toEqual([
      '🧺 Gathered: 🪨 Iron Ore ×2',
      '📈 Mining level 5!',
      '🧺 Gathered: 🪨 Iron Ore',
    ]);
  });

  it('never merges across different groups', () => {
    const s = fresh();
    appendLog(s, line('act:mine', '🧺 Gathered:', [{ label: '🪨 Iron Ore', qty: 1 }]));
    appendLog(s, line('act:woodcut', '🧺 Gathered:', [{ label: '🪵 Hardwood', qty: 1 }]));
    expect(msgs(s)).toHaveLength(2);
  });

  it('leaves ungrouped lines alone', () => {
    const s = fresh();
    appendLog(s, { msg: 'You arrive.', kind: 'travel', t: 0 });
    appendLog(s, { msg: 'You arrive.', kind: 'travel', t: 1 });
    expect(msgs(s)).toHaveLength(2);
  });

  it('carries the timestamp forward so a folded line reads as recent', () => {
    const s = fresh();
    appendLog(s, line('act:mine', '🧺 Gathered:', [{ label: '🪨 Iron Ore', qty: 1 }], 10));
    appendLog(s, line('act:mine', '🧺 Gathered:', [{ label: '🪨 Iron Ore', qty: 1 }], 99));
    expect(s.log[0].t).toBe(99);
  });

  it('still trims the feed to LOG_MAX', () => {
    const s = fresh();
    for (let i = 0; i < LOG_MAX + 20; i++) appendLog(s, { msg: `line ${i}`, kind: 'info', t: i });
    expect(s.log).toHaveLength(LOG_MAX);
    expect(s.log[0].msg).toBe('line 20');
  });
});

describe('fight feed grouping', () => {
  /** One tick's worth of a condition biting, as the tick paths emit it. */
  function tick(s: LogState, label: string, qty: number, group = 'cond:self') {
    feedRepeat(s, {
      group,
      prefix: '🩸 You suffer:',
      tally: [{ label, qty, style: 'amount' }],
    });
  }

  it('folds a long bleed into one running total instead of one line per tick', () => {
    const s = fresh();
    for (let i = 0; i < 15; i++) tick(s, '🩸 bleeding', 1);
    expect(s.combatFeed.map((f) => f.text)).toEqual(['🩸 You suffer: 15 🩸 bleeding']);
  });

  it('keeps each condition separate inside the one folded line', () => {
    const s = fresh();
    for (let i = 0; i < 10; i++) {
      tick(s, '🩸 bleeding', 2);
      tick(s, '🧪 poison', 1);
    }
    expect(s.combatFeed).toHaveLength(1);
    expect(s.combatFeed[0].text).toBe('🩸 You suffer: 20 🩸 bleeding, 10 🧪 poison');
  });

  it('accumulates at full precision and only rounds for display', () => {
    const s = fresh();
    // A slow bleed under a point per tick. Rounding each tick as it landed
    // would floor every one of these to zero and report damage that was
    // really taken as nothing at all.
    for (let i = 0; i < 5; i++) tick(s, '🩸 bleeding', 0.4);
    expect(s.combatFeed[0].text).toBe('🩸 You suffer: 2 🩸 bleeding');
    expect(s.combatFeed[0].tally?.[0].qty).toBeCloseTo(2);
  });

  it('ends the run when something else happens in the fight', () => {
    const s = fresh();
    tick(s, '🩸 bleeding', 3);
    s.combatFeed.push({ text: '⚔️ You strike the Rat for 12.' });
    tick(s, '🩸 bleeding', 3);
    expect(s.combatFeed.map((f) => f.text)).toEqual([
      '🩸 You suffer: 3 🩸 bleeding',
      '⚔️ You strike the Rat for 12.',
      '🩸 You suffer: 3 🩸 bleeding',
    ]);
  });

  it('never merges the player line into the enemies one', () => {
    const s = fresh();
    tick(s, '🩸 bleeding', 1, 'cond:self');
    tick(s, '🩸 Rat bleeding', 1, 'cond:foes');
    expect(s.combatFeed).toHaveLength(2);
  });

  it('does not alias the tally it was handed', () => {
    const s = fresh();
    // The tick paths rebuild their tally array every tick; the folded line must
    // own its own copy or it would go on accumulating into a caller's object.
    const mine: LogTally[] = [{ label: '🩸 bleeding', qty: 1, style: 'amount' }];
    feedRepeat(s, { group: 'cond:self', prefix: '🩸 You suffer:', tally: mine });
    feedRepeat(s, { group: 'cond:self', prefix: '🩸 You suffer:', tally: mine });
    expect(mine[0].qty).toBe(1);
    expect(s.combatFeed[0].tally?.[0].qty).toBe(2);
  });

  it('still trims the fight feed to FEED_MAX', () => {
    const s = fresh();
    for (let i = 0; i < FEED_MAX + 5; i++) {
      feedRepeat(s, { group: `g${i}`, prefix: 'x', tally: [{ label: `${i}`, qty: 1 }] });
    }
    expect(s.combatFeed).toHaveLength(FEED_MAX);
  });
});

describe('floating affliction runs', () => {
  it('settles onto the newest line when it ends, and rides down with it', () => {
    const s = fresh();
    appendFeed(s, { text: 'first exchange' });
    feedFloating(s, {
      group: 'cond:self',
      prefix: '🩸 You suffer:',
      tally: [{ label: '🩸 bleeding', qty: 4, style: 'amount' }],
      ids: ['bleeding'],
    });
    appendFeed(s, { text: 'second exchange' });
    // Still running: it belongs to no line yet.
    expect(s.combatFeed.some((f) => f.afflictions?.length)).toBe(false);

    settleFloating(s, 'cond:self');
    expect(s.floatingFeed).toHaveLength(0);
    // It stuck to whatever was newest at that moment — not to the line it
    // started under, which is the point of "floating".
    const stuck = s.combatFeed[s.combatFeed.length - 1];
    expect(stuck.text).toBe('second exchange');
    expect(renderLine(stuck.afflictions![0].prefix, stuck.afflictions![0].tally)).toBe(
      '🩸 You suffer: 4 🩸 bleeding',
    );

    // …and it travels with that line as the feed fills above it.
    appendFeed(s, { text: 'third exchange' });
    const carried = s.combatFeed.find((f) => f.text === 'second exchange');
    expect(carried?.afflictions).toHaveLength(1);
    expect(s.combatFeed[s.combatFeed.length - 1].afflictions).toBeUndefined();
  });

  it('becomes a line of its own only when there is nothing to stick to', () => {
    // A poison ticking out of combat, with an empty feed behind it. Dropping
    // the total on the floor would lose the only explanation for the health.
    const g = { state: fresh() };
    feedFloating(g.state, {
      group: 'cond:self',
      prefix: '🩸 You suffer:',
      tally: [{ label: '🩸 bleeding', qty: 7, style: 'amount' }],
      ids: ['bleeding'],
    });
    settleFloating(g.state, 'cond:self');
    expect(g.state.combatFeed).toHaveLength(1);
    expect(g.state.combatFeed[0].text).toBe('🩸 You suffer: 7 🩸 bleeding');
  });
});

describe('hunt lines fold per 30 s', () => {
  const PREFIX = '☠️ Hunt:';
  const wolf = (): LogTally[] => [
    { label: '🐺 Young Wolf', qty: 1 },
    { label: 'gold', qty: 10, style: 'amount' },
  ];
  const hunt = (tally: LogTally[], t: number): LogEntry => ({ ...line('hunt', PREFIX, tally, t), kind: 'combat' });

  it('the window is 300 ticks', () => {
    expect(HUNT_WINDOW).toBe(300);
  });

  it('folds 20 routine events inside 300 ticks into 1 line', () => {
    const s = fresh();
    for (let i = 0; i < 20; i++) appendLog(s, hunt(wolf(), i * 14));
    expect(s.log).toHaveLength(1);
    expect(s.log[0].msg).toBe('☠️ Hunt: 200 gold, 🐺 Young Wolf ×20');
    expect(s.log[0].since).toBe(0);
    expect(s.log[0].window).toBe(300);
    expect(s.log[0].t).toBe(19 * 14);
  });

  it('an equippable item line splits the run', () => {
    const s = fresh();
    appendLog(s, hunt(wolf(), 0));
    appendLog(s, hunt(wolf(), 10));
    appendLog(s, { msg: '📦 Loot: 🛡️ Leather Vest', kind: 'loot', t: 20 });
    appendLog(s, hunt(wolf(), 30));
    expect(msgs(s)).toEqual([
      '☠️ Hunt: 20 gold, 🐺 Young Wolf ×2',
      '📦 Loot: 🛡️ Leather Vest',
      '☠️ Hunt: 10 gold, 🐺 Young Wolf',
    ]);
  });

  it('a line older than 300 ticks does not absorb a new event', () => {
    const s = fresh();
    appendLog(s, hunt(wolf(), 0));
    appendLog(s, hunt(wolf(), 299));
    expect(s.log).toHaveLength(1);
    appendLog(s, hunt(wolf(), 300));
    expect(s.log).toHaveLength(2);
    expect(s.log[1].since).toBe(300);
  });

  it('measures the window from when the line opened, not from its latest event', () => {
    const s = fresh();
    appendLog(s, hunt(wolf(), 0));
    appendLog(s, hunt(wolf(), 200));
    // 400 is within 300 of the latest event (200) and not of the first (0).
    appendLog(s, hunt(wolf(), 400));
    expect(s.log).toHaveLength(2);
    expect(s.log[0].tally?.[1].qty).toBe(2);
  });

  it('reads a line that has a window and no `since` by its `t`', () => {
    const saved = (): LogState => {
      const s = fresh();
      s.log.push({ msg: '☠️ Hunt: 🐺 Young Wolf', kind: 'combat', t: 1000, group: 'hunt', prefix: PREFIX, tally: [{ label: '🐺 Young Wolf', qty: 1 }], window: 300 });
      return s;
    };
    const inside = saved();
    appendLog(inside, hunt(wolf(), 1299));
    expect(inside.log).toHaveLength(1);
    const outside = saved();
    appendLog(outside, hunt(wolf(), 1300));
    expect(outside.log).toHaveLength(2);
  });

  it('still folds a saved line that has no window for as long as it is the newest', () => {
    const s = fresh();
    s.log.push({ msg: '🧺 Gathered: 🪨 Iron Ore', kind: 'loot', t: 0, group: 'act:mine', prefix: '🧺 Gathered:', tally: [{ label: '🪨 Iron Ore', qty: 1 }] });
    appendLog(s, line('act:mine', '🧺 Gathered:', [{ label: '🪨 Iron Ore', qty: 1 }], 10_000_000));
    expect(msgs(s)).toEqual(['🧺 Gathered: 🪨 Iron Ore ×2']);
    expect(s.log[0].window).toBeUndefined();
    expect(s.log[0].since).toBeUndefined();
  });

  it('shows four labels and counts the rest', () => {
    const s = fresh();
    appendLog(s, hunt([{ label: '🐺 Young Wolf', qty: 4 }, { label: 'gold', qty: 90, style: 'amount' }], 0));
    appendLog(s, hunt([{ label: '🐀 Forest Rat', qty: 6 }, { label: 'Raw Meat (Fair)', qty: 1 }], 10));
    appendLog(s, hunt([{ label: 'Torn Fur', qty: 2 }, { label: 'Iron Scrap', qty: 1 }], 20));
    expect(LOG_LABELS_MAX).toBe(4);
    // Gold first, then the counts from the largest down.
    expect(s.log[0].msg).toBe('☠️ Hunt: 90 gold, 🐀 Forest Rat ×6, 🐺 Young Wolf ×4, Torn Fur ×2, +2 more');
    expect(hiddenLabels(s.log[0])).toEqual(['Raw Meat (Fair)', 'Iron Scrap']);
  });

  it('shows no "+N more" for exactly four labels, and hides nothing', () => {
    const s = fresh();
    appendLog(s, hunt([1, 2, 3, 4].map((n) => ({ label: `L${n}`, qty: 5 - n })), 0));
    expect(s.log[0].msg).toBe('☠️ Hunt: L1 ×4, L2 ×3, L3 ×2, L4');
    expect(hiddenLabels(s.log[0])).toEqual([]);
  });

  it('hides nothing on a line with no window', () => {
    const s = fresh();
    for (let i = 0; i < 6; i++) appendLog(s, line('act:mine', '🧺 Gathered:', [{ label: `L${i}`, qty: 1 }]));
    expect(s.log[0].msg).toBe('🧺 Gathered: L0, L1, L2, L3, L4, L5');
    expect(hiddenLabels(s.log[0])).toEqual([]);
  });

  it('does not alias the tally it was handed', () => {
    const s = fresh();
    const mine = wolf();
    appendLog(s, hunt(mine, 0));
    appendLog(s, hunt(wolf(), 10));
    expect(mine[0].qty).toBe(1);
    expect(s.log[0].tally?.find((t) => t.label === '🐺 Young Wolf')?.qty).toBe(2);
  });

  it('keeps `since` and `window` through a save', () => {
    const kernel = makeGame();
    emit(kernel, logLine, huntLine(wolf()));
    const loaded = makeGame();
    expect(loaded.load(JSON.parse(JSON.stringify(kernel.save(0)))).ok).toBe(true);
    expect(slice<LogState>(loaded, 'log').log[0]).toMatchObject({ since: START_TICKS, window: 300, group: 'hunt' });
  });
});

describe('the log through the kernel', () => {
  const lines = (kernel: Kernel) => slice<LogState>(kernel, 'log').log;

  it('a line is stamped with the game clock and defaults to the info kind', () => {
    const kernel = makeGame();
    kernel.tick(25);
    emit(kernel, logLine, { msg: 'You arrive.' });
    expect(lines(kernel)).toEqual([{ msg: 'You arrive.', kind: 'info', t: START_TICKS + 25 }]);
  });

  it('a groupable line folds, and a hunt line closes after its window', () => {
    const kernel = makeGame();
    const gathered = repeatLine({
      group: 'act:mine',
      prefix: '🧺 Gathered:',
      tally: [{ label: '🪨 Iron Ore', qty: 1 }],
      kind: 'loot',
    });
    for (let i = 0; i < 5; i++) emit(kernel, logLine, gathered);
    expect(lines(kernel).map((l) => l.msg)).toEqual(['🧺 Gathered: 🪨 Iron Ore ×5']);

    const wolf = () =>
      huntLine([
        { label: '🐺 Young Wolf', qty: 1 },
        { label: 'gold', qty: 10, style: 'amount' },
      ]);
    emit(kernel, logLine, wolf());
    kernel.tick(HUNT_WINDOW - 1);
    emit(kernel, logLine, wolf());
    expect(lines(kernel)).toHaveLength(2);
    expect(lines(kernel)[1].msg).toBe('☠️ Hunt: 20 gold, 🐺 Young Wolf ×2');
    kernel.tick(1);
    emit(kernel, logLine, wolf());
    expect(lines(kernel)).toHaveLength(3);
  });

  it('the feed requests reach the feed, the floating runs and the open transcript', () => {
    const kernel = makeGame();
    const state = () => slice<LogState>(kernel, 'log');
    emit(kernel, feedLine, { text: 'before the fight' });
    emit(kernel, transcriptOpen, undefined);
    emit(kernel, feedLine, { text: 'first exchange' });
    emit(kernel, feedRepeatLine, {
      group: 'cond:foes',
      prefix: '🩸 Rat suffers:',
      tally: [{ label: 'bleeding', qty: 2, style: 'amount' }],
    });
    emit(kernel, feedFloatingRun, {
      group: 'cond:self',
      prefix: '🩸 You suffer:',
      tally: [{ label: 'bleeding', qty: 4, style: 'amount' }],
      ids: ['bleeding'],
    });
    expect(state().floatingFeed).toHaveLength(1);
    emit(kernel, feedSettle, { group: 'cond:self' });
    expect(state().floatingFeed).toHaveLength(0);
    expect(state().combatFeed.map((f) => f.text)).toEqual([
      'before the fight',
      'first exchange',
      '🩸 Rat suffers: 2 bleeding',
    ]);
    // The transcript holds the fight only, and its own copy of the settled run.
    expect(state().transcript!.map((f) => f.text)).toEqual(['first exchange', '🩸 Rat suffers: 2 bleeding']);
    expect(state().transcript![1].afflictions).toHaveLength(1);
    emit(kernel, transcriptClose, undefined);
    expect(state().transcript).toBeNull();
    emit(kernel, transcriptClose, undefined);
    emit(kernel, feedSettle, { group: 'cond:self' });
    expect(kernel.skips().map((skip) => skip.reason)).toEqual([
      'no transcript is open',
      'no floating run "cond:self" is open',
    ]);
  });
});

describe('the transcript', () => {
  const report = (total: number): DamageReport => ({
    label: 'Strike',
    target: 'Wolf',
    steps: [{ label: 'base', value: total }],
    slices: [
      { type: 'slashing', source: 'Sword', raw: total, armor: 0, resisted: 0, resistance: 0, pierced: 0, dealt: total },
    ],
    hits: 1,
    crit: false,
    total,
  });

  it('folds the way the live feed does, and keeps what the feed has dropped', () => {
    const s = fresh();
    s.transcript = [];
    for (let i = 0; i < 200; i++) {
      feedRepeat(s, {
        group: 'cond:self',
        prefix: '🩸 You suffer:',
        tally: [{ label: 'bleeding', qty: 1, style: 'amount' }],
      });
    }
    expect(s.transcript).toHaveLength(1);
    expect(s.transcript[0].text).toBe('🩸 You suffer: 200 bleeding');

    // Enough lines to roll the live feed but not the transcript.
    expect(TRANSCRIPT_MAX).toBeGreaterThan(FEED_MAX);
    const t = fresh();
    t.transcript = [];
    const count = FEED_MAX + 5;
    for (let i = 0; i < count; i++) appendFeed(t, { text: `line ${i}` });
    expect(t.combatFeed).toHaveLength(FEED_MAX);
    expect(t.transcript).toHaveLength(count);
    expect(t.transcript[0].text).toBe('line 0');
    for (let i = count; i < TRANSCRIPT_MAX * 4; i++) appendFeed(t, { text: `line ${i}` });
    expect(t.transcript).toHaveLength(TRANSCRIPT_MAX);
    expect(t.transcript[TRANSCRIPT_MAX - 1].text).toBe(`line ${TRANSCRIPT_MAX * 4 - 1}`);
  });

  it('each list folds its own copy of a damage report, so a folded line is not counted twice', () => {
    const s = fresh();
    s.transcript = [];
    for (let i = 0; i < 4; i++) {
      feedRepeat(s, {
        group: 'rotation',
        prefix: '⚔️ Blades:',
        tally: [{ label: 'damage', qty: 10, style: 'amount' }],
        damage: report(10),
      });
    }
    for (const list of [s.combatFeed, s.transcript]) {
      expect(list).toHaveLength(1);
      expect(list[0].damage).toMatchObject({ total: 40, hits: 4 });
      expect(list[0].damage!.slices).toHaveLength(1);
      expect(list[0].damage!.slices[0].dealt).toBe(40);
    }
    expect(s.combatFeed[0].damage).not.toBe(s.transcript[0].damage);
  });

  it('is saved without its damage reports', () => {
    const s = fresh();
    s.transcript = [];
    appendFeed(s, { text: '⚔️ You hit the Wolf for 42', damage: report(42) });
    feedFloating(s, {
      group: 'cond:foes',
      prefix: '🩸 Wolf suffers:',
      tally: [{ label: 'bleeding', qty: 3, style: 'amount' }],
      ids: ['bleeding'],
      damage: report(3),
    });
    settleFloating(s, 'cond:foes');
    expect(s.transcript[0].damage).toBeTruthy();
    expect(s.transcript[0].afflictions![0].report).toBeTruthy();
    const saved = transcriptForSave(s.transcript);
    expect(saved[0].text).toBe('⚔️ You hit the Wolf for 42');
    expect(saved[0].damage).toBeUndefined();
    expect(saved[0].afflictions![0].report).toBeUndefined();
    expect(saved[0].afflictions![0].tally).toEqual([{ label: 'bleeding', qty: 3, style: 'amount' }]);
  });
});

describe('log templates', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    const template = '⚠️ {what} (Lv {level}) appears!';
    expect(fillText(template, { what: 'Rat', level: 3 })).toBe('⚠️ Rat (Lv 3) appears!');
    expect(fillText(template, { what: 'Rat' })).toBe('⚠️ Rat (Lv {level}) appears!');
    expect(fillText(template)).toBe(template);
    expect(placeholdersOf(template)).toEqual(['what', 'level']);
  });

  it('writes the hunt line from its prefix and its labels', () => {
    expect(huntLine([{ label: '🐺 Young Wolf', qty: 1 }])).toMatchObject({
      msg: '☠️ Hunt: 🐺 Young Wolf',
      group: 'hunt',
      kind: 'combat',
    });
    const labels = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ label: `L${n}`, qty: 1 }));
    expect(renderLine('x', labels, 4)).toBe('x L1, L2, L3, L4, +3 more');
  });
});
