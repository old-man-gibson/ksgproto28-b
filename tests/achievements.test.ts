/**
 * Achievements (step 4 port L). The old build had no test file of its own
 * for them: the tier cases were in `hunters.test.ts` and `quests.test.ts`
 * (ported there). These cases cover the parts the port moved: the check on
 * `counters/changed`, the modifier source, the content, the claimed line.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import achievements, {
  ACHIEVEMENT_LIST,
  achievementMods,
  bonusText,
  tierNumeral,
  totalTiers,
  type AchievementsState,
  type AchievementsView,
} from '../src/systems/achievements';
import { bumpCounter, setCounter } from '../src/systems/counters';
import type { LogState } from '../src/systems/log';
import { targetIssue } from '../src/systems/stats';
import { emit, makeGame, readText, listFiles, slice } from './helpers';

const claimed = (g: Kernel) => slice<AchievementsState>(g, 'achievements').claimed;
const lines = (g: Kernel) => slice<LogState>(g, 'log').log.map((l) => l.msg);

describe('claiming tiers', () => {
  it('a counter crossing a threshold claims the tier, once', () => {
    const g = makeGame({ seed: 1 });
    emit(g, bumpCounter, { key: 'quests:completed', amount: 2 });
    expect(claimed(g).questmaster).toBeUndefined();
    emit(g, bumpCounter, { key: 'quests:completed' });
    expect(claimed(g).questmaster).toBe(1);
    emit(g, bumpCounter, { key: 'quests:completed' });
    expect(claimed(g).questmaster).toBe(1);
    expect(lines(g).filter((m) => m.includes('Questmaster')).length).toBe(1);
    expect(lines(g)).toContain('🏆 Achievement: ⭐ Questmaster I.');
  });

  it('one write past several thresholds claims each tier in order', () => {
    const g = makeGame({ seed: 2 });
    emit(g, setCounter, { key: 'gold:earned', value: 50_000 });
    expect(claimed(g).fortune_seeker).toBe(3);
    const got = lines(g).filter((m) => m.includes('Fortune Seeker'));
    expect(got).toEqual(['I', 'II', 'III'].map((n) => `🏆 Achievement: 💰 Fortune Seeker ${n}.`));
  });

  it('a counter set lower takes nothing back', () => {
    const g = makeGame({ seed: 3 });
    emit(g, setCounter, { key: 'kills:tag:slime', value: 12 });
    expect(claimed(g).slime_kills).toBe(2);
    emit(g, setCounter, { key: 'kills:tag:slime', value: 0 });
    expect(claimed(g).slime_kills).toBe(2);
  });

  it('a claimed tier reaches the stat block, and no source is stale', () => {
    const g = makeGame({ seed: 4 });
    const before = g.derived('stats/maxHp');
    emit(g, setCounter, { key: 'attr:str', value: 25 });
    expect(claimed(g).honed_body).toBe(2);
    expect(g.derived('stats/maxHp')).toBeCloseTo(before + 35, 6);
    expect(g.staleStats()).toEqual([]);
  });

  it('the harvest counts tiers across achievements', () => {
    expect(totalTiers({ claimed: { a: 2, b: 5 } })).toBe(7);
  });
});

describe('content', () => {
  it('every bonus targets a stat the pipeline knows', () => {
    for (const def of ACHIEVEMENT_LIST) {
      for (const tier of def.tiers) for (const m of tier.bonus) expect(targetIssue(m.stat), `${def.id} ${m.stat}`).toBeNull();
      // Thresholds rise.
      const t = def.tiers.map((x) => x.threshold);
      expect(t, def.id).toEqual([...t].sort((a, b) => a - b));
    }
  });

  it('every counter an achievement reads is written somewhere in src', () => {
    const source = listFiles('src/systems')
      .filter((f) => f.endsWith('.ts'))
      .map(readText)
      .join('\n');
    // Written with a literal key, a named constant, or a key built from a prefix.
    const written: Record<string, string> = {
      'attr:str': '`attr:${',
      'travel:trips': "'travel:trips'",
      'gold:earned': "'gold:earned'",
      'gather:iron_scrap': '`gather:${',
      'kills:tag:slime': '`kills:tag:${',
      'kills:tag:inorganic': '`kills:tag:${',
    };
    for (const def of ACHIEVEMENT_LIST) {
      const needle = written[def.statKey] ?? `'${def.statKey}'`;
      expect(source.includes(needle), `${def.id} reads ${def.statKey}`).toBe(true);
    }
  });

  it('labels each tier by name and numeral, and names the target tag', () => {
    const mods = achievementMods({ claimed: { slime_kills: 2 } });
    expect(mods.map((m) => m.source)).toEqual(['Slime Hunter I', 'Slime Hunter II']);
    expect(mods.every((m) => m.requiresMonsterTag === 'slime')).toBe(true);
    expect(bonusText(ACHIEVEMENT_LIST.find((d) => d.id === 'slime_kills')!.tiers[0].bonus[0])).toBe('+3% Damage vs Slime');
    expect(tierNumeral(4)).toBe('IV');
    expect(tierNumeral(6)).toBe('6');
  });
});

describe('the view', () => {
  it('rows carry the counter, the next threshold and the goal', () => {
    const g = makeGame({ seed: 5 });
    emit(g, setCounter, { key: 'kills', value: 120 });
    const view = g.view().systems[achievements.id] as AchievementsView;
    const slayer = view.rows.find((r) => r.id === 'slayer')!;
    expect(slayer).toMatchObject({ claimed: 1, tiers: 3, value: 120, next: 1000, goal: 'Defeat 1.00K monsters' });
    expect(view.total).toBe(ACHIEVEMENT_LIST.reduce((n, d) => n + d.tiers.length, 0));
  });
});
