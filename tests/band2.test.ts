/**
 * Port of the old `tests/band2.test.ts` (5 cases): band 2, floors 4 to 6,
 * prestige at the warchief, floor 0 behind every prestiged run.
 *
 * The structure cases read the floor and spot registries. The climb cases run
 * the John driver (`tests/john.ts` of the old repository), which arrives with
 * port 7: each is an `it.todo` under its old `describe` and name.
 */
import { describe, expect, it } from 'vitest';
import { FLOORS } from '../src/systems/ladder';
import { SPOTS } from '../src/systems/world';

const BAND_TWO = ['ascent_f4', 'ascent_f5', 'ascent_f6'];
const BOSS_ROOMS = new Set(['f4_ravine_floor', 'f5_back_door', 'f6_great_hall']);

describe('band 2 structure', () => {
  it('prestige opens on the floor 6 clear: the warchief', () => {
    // The old case was `expect(PRESTIGE_UNLOCK).toEqual(FLOORS.ascent_f6.clear)`.
    // The prestige registry (`PRESTIGE_UNLOCK`) is port 7. The half that exists
    // here: the clear of floor 6 is the kill of the warchief in the Great
    // Hall, and the hall holds it as a `once` line.
    expect(FLOORS.ascent_f6.clear).toEqual([{ type: 'stat', key: 'slain:f6_great_hall:goblin_warchief', value: 1 }]);
    const lines = SPOTS.f6_great_hall.encounters ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((e) => e.monsterId === 'goblin_warchief' && e.once === true)).toBe(true);
  });

  it('floor 0 cannot be reached from the Foot, where every prestiged run starts', () => {
    // Every connection out of every spot, conditions ignored: the most a
    // player could ever walk. The tutorial's road out is one-way.
    const seen = new Set(['ascent_foot']);
    const queue = ['ascent_foot'];
    while (queue.length) {
      const at = queue.shift()!;
      for (const c of SPOTS[at]?.connections ?? []) {
        if (!seen.has(c.to)) {
          seen.add(c.to);
          queue.push(c.to);
        }
      }
    }
    expect([...seen].filter((id) => id.startsWith('f0_'))).toEqual([]);
    expect(FLOORS.ascent_f0.bandId).toBeUndefined(); // so a climb never offers it
  });

  it('every hunt outside the three boss rooms is endless, and the gates read goblin kills', () => {
    for (const floor of BAND_TWO) {
      const spots = Object.values(SPOTS).filter((s) => s.areaId === FLOORS[floor].areaId);
      for (const s of spots) {
        if (BOSS_ROOMS.has(s.id)) expect(s.fightLimit, s.id).toBe(1);
        else expect(s.fightLimit, `${s.id} runs out`).toBeUndefined();
      }
    }
    for (const floor of ['ascent_f5', 'ascent_f6']) {
      expect(FLOORS[floor].gate?.every((c) => c.type === 'stat' && c.key === 'kills:tag:goblin'), floor).toBe(true);
    }
  });
});

describe('John through band 2', () => {
  it.todo('clears floor 6 inside 45 minutes of play (port 7: the John port)');

  it.todo('knocks John down on the way, not out of the game (port 7: the John port)');
});
