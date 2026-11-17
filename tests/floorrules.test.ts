/**
 * Port of the old `tests/floorrules.test.ts`: mutation tests for the floor
 * structure rules (`src/systems/ladder/floorRules.ts`). tests/worldContent.test.ts
 * shows each rule passes on the registries; this file shows each one fails
 * when content breaks it, on edited copies of the spots (the registry itself
 * is never touched).
 *
 * Changed: imports; `buildAdjacency` takes the spots; a find's gold is
 * `{ min, max }`; the live-floor cases run on the 6 banded floors here (the
 * old file listed floors 1 to 3 of its 20); the explore case runs on a kernel.
 * The forge here has no floor validator: those cases are `it.todo`.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type Kernel } from '../src/kernel';
import type { EncounterLine } from '../src/systems/combat';
import {
  clearTableIssues,
  exploreIssues,
  FLOORS,
  floorStructureIssues,
  stampClearTableIssues,
  type FloorAdjacency,
  type FloorReport,
  type FloorRule,
} from '../src/systems/ladder';
import {
  buildAdjacency,
  isExplored,
  selectActivity,
  SPOTS,
  type ActivityDef,
  type Connection,
  type SpotDef,
  type WorldState,
} from '../src/systems/world';
import { makeGame, patch, slice } from './helpers';

const F2 = 'ascent_f2_area';

type Spots = Record<string, SpotDef>;

function addSpot(s: Spots, id: string, areaId: string, connections: Connection[] = [], extra: Partial<SpotDef> = {}): void {
  s[id] = { id, name: id, icon: '·', areaId, desc: '', activities: [], connections, map: { x: 50, y: 50 }, ...extra };
}

const link = (to: string, extra: Partial<Connection> = {}): Connection => ({ to, ticks: 10, ...extra });

/** A copy of the live spots with `change` applied, and the adjacency the registry would build for it. */
function world(change: (s: Spots) => void = () => {}): { spots: Spots; adj: FloorAdjacency } {
  const spots = structuredClone(SPOTS) as Spots;
  change(spots);
  return { spots, adj: buildAdjacency(Object.values(spots)) };
}

function run(floorId: string, change?: (s: Spots) => void): FloorReport {
  const { spots, adj } = world(change);
  return floorStructureIssues(FLOORS[floorId], spots, adj);
}

const messages = (r: FloorReport, rule: FloorRule): string[] => r.issues.filter((i) => i.rule === rule).map((i) => i.message);

describe('the live floors pass every structure rule', () => {
  it.each(['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'])('%s', (id) => {
    const r = run(id);
    expect(r.issues).toEqual([]);
    expect(r.skipped).toBeUndefined();
  });

  it('floor 1 puts the office block off the spine, joined at the reception and the toll hall', () => {
    const r = run('ascent_f1');
    expect(r.spine).toEqual(
      expect.arrayContaining(['f1_landing', 'f1_storerooms', 'f1_bonded_deep', 'f1_forms', 'f1_reception', 'f1_toll_hall']),
    );
    expect(r.spine).toHaveLength(6);
    // Without the way back (the oneWay "Return to Reception" edges and the
    // doors into the toll hall) the seven offices join the spine at the
    // reception alone, and the loop rule fails.
    const cut = run('ascent_f1', (s) => {
      for (const id of ['f1_registry', 'f1_scribe', 'f1_auditor', 'f1_break_room', 'f1_dispatch', 'f1_records', 'f1_supplies']) {
        s[id].connections = s[id].connections.filter((c) => c.to !== 'f1_reception' && c.to !== 'f1_toll_hall');
      }
    });
    expect(messages(cut, 'wing-loop')).toEqual([expect.stringContaining("only 'f1_reception'")]);
  });
});

describe('no skip: each floor-local gate is necessary', () => {
  it('(b) a free two-way room between the stairhead and the third stretch bypasses the gates it spans', () => {
    const r = run('ascent_f2', (s) => {
      addSpot(s, 'f2_x', F2, [link('f2_stairhead'), link('f2_hall_3')]);
    });
    const skips = messages(r, 'no-skip');
    expect(skips).toHaveLength(2);
    expect(skips[0]).toContain('[fights:f2_hall_1 >= 3]');
    expect(skips[0]).toContain('f2_stairhead -> f2_x -> f2_hall_3');
    expect(skips[1]).toContain('[fights:f2_hall_2 >= 3]');
    // The third gate still stands: the far end's only way in is its own door.
    expect(skips.some((m) => m.includes('fights:f2_hall_3'))).toBe(false);
  });

  it('(b) is invisible to authored edges alone: the bypass runs over mirrored edges', () => {
    const { spots } = world((s) => {
      addSpot(s, 'f2_x', F2, [link('f2_stairhead'), link('f2_hall_3')]);
    });
    const unmirrored: FloorAdjacency = new Map();
    for (const spot of Object.values(spots)) {
      for (const connection of spot.connections) unmirrored.set(spot.id, [...(unmirrored.get(spot.id) ?? []), connection]);
    }
    expect(messages(floorStructureIssues(FLOORS.ascent_f2, spots, unmirrored), 'no-skip')).toEqual([]);
    expect(messages(floorStructureIssues(FLOORS.ascent_f2, spots, buildAdjacency(Object.values(spots))), 'no-skip')).not.toEqual([]);
  });

  it('(c) the same room with a oneWay exit to the stairhead and its only entry from the third stretch passes', () => {
    const r = run('ascent_f2', (s) => {
      addSpot(s, 'f2_x', F2, [link('f2_stairhead', { oneWay: true })]);
      s.f2_hall_3.connections.push(link('f2_x'));
    });
    expect(r.issues).toEqual([]);
  });

  it('(d) an entry behind an attribute still bypasses: only floor counters count as gates', () => {
    const attr: Partial<Connection> = { requires: [{ type: 'attr', attr: 'str', level: 7 }] };
    const r = run('ascent_f2', (s) => {
      addSpot(s, 'f2_x', F2, [link('f2_hall_3')]);
      s.f2_stairhead.connections.push(link('f2_x', attr));
    });
    expect(messages(r, 'no-skip')).not.toEqual([]);
    // As a dead-end room, the same attribute door is a wing and passes.
    const wing = run('ascent_f2', (s) => {
      addSpot(s, 'f2_x', F2);
      s.f2_stairhead.connections.push(link('f2_x', attr));
    });
    expect(wing.issues).toEqual([]);
  });

  it('(e) a oneWay edge from a new room back to the stairhead, behind a floor flag, passes', () => {
    const lever = (s: Spots, back: Partial<Connection>) => {
      addSpot(s, 'f2_vent', F2, [
        link('f2_hall_1'),
        link('f2_stairhead', { requires: [{ type: 'stat', key: 'flag:f2_lever', value: 1 }], ...back }),
      ]);
      s.f2_break_room.finds = [...(s.f2_break_room.finds ?? []), { id: 'f2_lever_find', at: 0.9, stat: { key: 'flag:f2_lever' } }];
    };
    expect(run('ascent_f2', (s) => lever(s, { oneWay: true })).issues).toEqual([]);
    // The same edge as a two-way road is a gate on the landing itself, and
    // the mirror hands the landing a free road to the vent.
    expect(messages(run('ascent_f2', (s) => lever(s, {})), 'no-skip')).toEqual([
      expect.stringContaining('[flag:f2_lever >= 1]'),
    ]);
  });

  it('a find or a search reward at a floor spot makes its flag a floor counter', () => {
    // Floor 1's doors read key items granted by a search reward (the daybook in
    // the Archive) and by a find (the office key at the reception). A free road
    // from the records passage to the toll hall bypasses both, and names them.
    // The office-key gate is named even though the road makes the toll hall
    // 3 hops from the landing and the reception 4: a oneWay gate edge into the
    // toll hall is not a "shortcut home" just because it now points at a nearer
    // room, since the toll hall is not on every road to the reception.
    const r = run('ascent_f1', (s) => {
      s.f1_bonded_deep.connections.push(link('f1_toll_hall'));
    });
    const skips = messages(r, 'no-skip');
    expect(skips).toHaveLength(2);
    expect(skips.join('\n')).toContain('[flag:key_item:toll_clerk_book >= 1]');
    expect(skips.join('\n')).toContain('[flag:key_item:toll_office_key >= 1]');
  });

  it('a gated oneWay exit is a shortcut home only when its target is on every road to its source', () => {
    // v hangs off the second stretch; u hangs off the first. u is nearer the
    // landing than v, but u is not on the road to v, so v -> u behind a floor
    // flag is a gate on a room the first stretch already opens.
    const exit = (to: string) => (s: Spots) => {
      addSpot(s, 'f2_u', F2);
      addSpot(s, 'f2_v', F2, [link(to, { oneWay: true, requires: [{ type: 'stat', key: 'flag:f2_lever', value: 1 }] })]);
      s.f2_hall_1.connections.push(link('f2_u'));
      s.f2_hall_2.connections.push(link('f2_v'));
      s.f2_break_room.finds = [...(s.f2_break_room.finds ?? []), { id: 'f2_lever_find', at: 0.9, stat: { key: 'flag:f2_lever' } }];
    };
    expect(messages(run('ascent_f2', exit('f2_u')), 'no-skip')).toEqual([expect.stringContaining('[flag:f2_lever >= 1]')]);
    // Back to a room on the way in (the first stretch), it is a shortcut home.
    expect(run('ascent_f2', exit('f2_hall_1')).issues).toEqual([]);
  });

  it('edges that carry a gate\'s terms and more are shut with it', () => {
    // v is behind the lever on one road and behind lever + first stretch on
    // another. With the lever off both are shut, so the lever gate stands.
    // The stricter road adds nothing over the lever alone, and is named.
    const r = run('ascent_f2', (s) => {
      addSpot(s, 'f2_v', F2);
      s.f2_hall_1.connections.push(link('f2_v', { requires: [{ type: 'stat', key: 'flag:f2_lever', value: 1 }] }));
      s.f2_stairhead.connections.push(
        link('f2_v', {
          requires: [
            { type: 'stat', key: 'flag:f2_lever', value: 1 },
            { type: 'stat', key: 'fights:f2_hall_1', value: 3 },
          ],
        }),
      );
      s.f2_break_room.finds = [...(s.f2_break_room.finds ?? []), { id: 'f2_lever_find', at: 0.9, stat: { key: 'flag:f2_lever' } }];
    });
    const skips = messages(r, 'no-skip');
    expect(skips).toHaveLength(1);
    expect(skips[0]).toContain('[fights:f2_hall_1 >= 3 & flag:f2_lever >= 1]');
  });

  describe('two thresholds of one counter', () => {
    const sortedFlag = (s: Spots) => {
      s.f2_break_room.finds = [...(s.f2_break_room.finds ?? []), { id: 'f2_sorted_find', at: 0.9, stat: { key: 'flag:f2_sorted' } }];
    };
    const at = (type: 'stat' | 'statMax', value: number) => ({ type, key: 'flag:f2_sorted', value });

    // Two doors into one room, from different rooms, at a weak and a strong
    // threshold of the same counter (>= 10 and >= 20; <= 5 and <= 2). The strong
    // door implies the weak one, so shutting the weak group shuts both. Before
    // that was counted, each group reported the other's door as a bypass.
    it.each([
      ['stat', 10, 20, '>='],
      ['statMax', 5, 2, '<='],
    ] as const)('%s %i and %i into one room: only the stronger gate is named', (type, weak, strong, op) => {
      const r = run('ascent_f2', (s) => {
        sortedFlag(s);
        addSpot(s, 'f2_dlo', F2);
        s.f2_hall_1.connections.push(link('f2_dlo', { requires: [at(type, weak)] }));
        s.f2_stairhead.connections.push(link('f2_dlo', { requires: [at(type, strong)] }));
      });
      // The weak door lets a player below the strong threshold in, so the
      // strong gate is bypassed: the same shape as a door at fights >= 1 around
      // a >= 3 budget, which the rule has to keep catching.
      const skips = messages(r, 'no-skip');
      expect(skips).toEqual([expect.stringContaining(`[flag:f2_sorted ${op} ${strong}]`)]);
      expect(skips.join('\n')).not.toContain(`[flag:f2_sorted ${op} ${weak}]`);
    });

    it('a room behind both doors in series raises no issue; a free two-way room into it is still named', () => {
      const doors = (s: Spots) => {
        sortedFlag(s);
        addSpot(s, 'f2_dlo_a', F2);
        addSpot(s, 'f2_dlo', F2);
        s.f2_hall_1.connections.push(link('f2_dlo_a', { requires: [at('stat', 10)] }));
        s.f2_dlo_a.connections.push(link('f2_dlo', { requires: [at('stat', 20)] }));
      };
      expect(run('ascent_f2', doors).issues).toEqual([]);

      const skips = messages(
        run('ascent_f2', (s) => {
          doors(s);
          addSpot(s, 'f2_free', F2, [link('f2_stairhead'), link('f2_dlo')]);
        }),
        'no-skip',
      );
      expect(skips).toHaveLength(2);
      expect(skips.join('\n')).toContain('[flag:f2_sorted >= 10]');
      expect(skips.join('\n')).toContain('[flag:f2_sorted >= 20]');
    });
  });
});

describe('wing depth', () => {
  const chain = (n: number) => (s: Spots) => {
    for (let i = 1; i <= n; i++) addSpot(s, `f2_w${i}`, F2, i < n ? [link(`f2_w${i + 1}`)] : []);
    s.f2_hall_1.connections.push(link('f2_w1'));
  };

  it('a room 4 hops from the spine fails; 3 hops passes the depth rule', () => {
    expect(messages(run('ascent_f2', chain(4)), 'wing-depth')).toEqual([expect.stringContaining("'f2_w4' is 4 hops")]);
    expect(messages(run('ascent_f2', chain(3)), 'wing-depth')).toEqual([]);
  });

  it('is measured from the spine, not the landing: the far end of floor 2 is 4 hops from the landing', () => {
    const r = run('ascent_f2');
    expect(r.spine).toContain('f2_hall_4');
    expect(r.issues).toEqual([]);
  });

  it('a room nothing reaches fails', () => {
    expect(messages(run('ascent_f2', (s) => addSpot(s, 'f2_lost', F2)), 'wing-depth')).toEqual([
      expect.stringContaining("'f2_lost' cannot be reached"),
    ]);
  });
});

describe('wings loop', () => {
  const wing = (n: number, extra: (s: Spots) => void = () => {}) => (s: Spots) => {
    for (let i = 1; i <= n; i++) addSpot(s, `f2_w${i}`, F2, i < n ? [link(`f2_w${i + 1}`)] : []);
    s.f2_hall_1.connections.push(link('f2_w1'));
    extra(s);
  };

  it('a wing of 3 joined to the spine at one spot fails', () => {
    expect(messages(run('ascent_f2', wing(3)), 'wing-loop')).toEqual([
      expect.stringContaining("joins the spine at only 'f2_hall_1'"),
    ]);
  });

  it('a wing of 2 joined at one spot passes', () => {
    expect(run('ascent_f2', wing(2)).issues).toEqual([]);
  });

  it('a wing of 3 that also joins the stairhead passes', () => {
    const r = run('ascent_f2', wing(3, (s) => s.f2_w3.connections.push(link('f2_stairhead'))));
    expect(r.issues).toEqual([]);
  });

  it('a wing of 3 with a oneWay edge back to the spot it joins passes', () => {
    const r = run('ascent_f2', wing(3, (s) => s.f2_w3.connections.push(link('f2_hall_1', { oneWay: true }))));
    expect(r.issues).toEqual([]);
  });
});

describe("the clear spot's table never empties", () => {
  const line = (extra: Partial<EncounterLine> = {}): EncounterLine => ({ monsterId: 'forest_rat', weight: 1, level: [1, 1], ...extra });
  const table = (...encounters: EncounterLine[]) => ({ id: 'fixture_spot', encounters });
  const stat = (key: string, value: number) => ({ type: 'stat' as const, key, value });
  const statMax = (key: string, value: number) => ({ type: 'statMax' as const, key, value });

  it("floor 3's Hearing Room (four lines partitioning flag:f3_strings_cut) passes", () => {
    expect(clearTableIssues(SPOTS.f3_hearing_room)).toEqual([]);
  });

  it('the same table with the value-2 line moved to 3 leaves a gap at 2', () => {
    const r = run('ascent_f3', (s) => {
      s.f3_hearing_room.encounters![2].requires = [stat('flag:f3_strings_cut', 3), statMax('flag:f3_strings_cut', 3)];
    });
    expect(messages(r, 'clear-table')).toEqual([expect.stringContaining('flag:f3_strings_cut = 2')]);
  });

  it('an open-ended top line (no statMax) covers every higher value', () => {
    expect(clearTableIssues(SPOTS.f3_hearing_room)).toEqual([]);
    expect(clearTableIssues(table(line({ requires: [statMax('flag:x', 0)] }), line({ requires: [stat('flag:x', 1)] })))).toEqual([]);
  });

  it('lines with a daypart or a window do not cover a gap', () => {
    expect(clearTableIssues(table(line({ daypart: 'night' })))).toHaveLength(1);
    expect(clearTableIssues(table(line({ window: { min: 1, max: 2 } })))).toHaveLength(1);
    expect(clearTableIssues(table(line({ daypart: 'night' }), line()))).toEqual([]);
  });

  it('a line that waits on the sky does not cover a gap, like a daypart', () => {
    expect(clearTableIssues(table(line({ sky: ['gale'] })))).toEqual([expect.stringContaining('daypart, sky or window')]);
    expect(clearTableIssues(table(line({ sky: ['calm'] }), line({ sky: ['gale', 'storm'] })))).toHaveLength(1);
    expect(clearTableIssues(table(line({ sky: ['gale'] }), line()))).toEqual([]);
    // A sky line with a counter gate still covers nothing, so the plain line
    // with the same gate carries the table.
    expect(clearTableIssues(table(line({ sky: ['rain'], requires: [stat('flag:x', 1)] }), line({ requires: [statMax('flag:x', 0)] })))).toHaveLength(1);
  });

  it('a line gated on a counter alone leaves the counter-zero state empty', () => {
    const issues = clearTableIssues(table(line({ requires: [stat('flag:x', 2)] })));
    expect(issues).toEqual([expect.stringContaining('flag:x = 0')]);
  });

  it('a line gated on something that is not a counter cannot be counted on', () => {
    const attr = { type: 'attr' as const, attr: 'str' as const, level: 5 };
    expect(clearTableIssues(table(line({ requires: [attr] })))).toHaveLength(1);
    expect(clearTableIssues(table(line({ requires: [attr] }), line()))).toEqual([]);
  });

  it('a once line counts as eligible: the history is ignored', () => {
    expect(clearTableIssues(table(line({ once: true })))).toEqual([]);
  });

  it('refuses to enumerate an unreasonable number of counters', () => {
    const lines = Array.from({ length: 12 }, (_, i) => line({ requires: [stat(`flag:k${i}`, 1)] }));
    expect(clearTableIssues(table(...lines, line()))[0]).toContain('too many to check');
  });
});

describe('every explore pays something', () => {
  const explore: ActivityDef = { id: 'explore_x', kind: 'explore', name: 'Look', icon: '🔍' };
  const spot = (extra: Partial<SpotDef>): SpotDef => ({
    id: 'fixture_spot', name: 'x', icon: '·', areaId: F2, desc: '', activities: [explore], connections: [], ...extra,
  });

  it('fails with no finds and no hidden road, passes with either', () => {
    expect(exploreIssues([spot({})])).toEqual([{ spot: 'fixture_spot', message: expect.stringContaining('pays nothing') }]);
    expect(exploreIssues([spot({ finds: [{ id: 'f', at: 1, gold: { min: 1, max: 1 } }] })])).toEqual([]);
    expect(exploreIssues([spot({ connections: [{ to: 'somewhere', ticks: 5, hidden: true }] })])).toEqual([]);
    expect(exploreIssues([spot({ activities: [] })])).toEqual([]);
  });

  it('the Chalk Yard and the Undercrofts each pay one find; stripped of it, each fails', () => {
    expect(exploreIssues([SPOTS.chalk_yard, SPOTS.the_undercrofts])).toEqual([]);
    for (const id of ['chalk_yard', 'the_undercrofts']) {
      expect(SPOTS[id].finds).toHaveLength(1);
      expect(exploreIssues([{ ...SPOTS[id], finds: undefined }]).map((i) => i.spot)).toEqual([id]);
    }
  });

  it('a fresh save that explores either one to 100% receives the payload', () => {
    // A find that pays nothing to a new player passes the lint and is no find:
    // the first draft paid Arcana XP, and the only arcane skill unlocks at INT 10.
    const goldOf = (g: Kernel) => slice<{ gold: number }>(g, 'gold').gold;
    const flourOf = (g: Kernel) => {
      const m = slice<{ counts: Record<string, number>; stock: Record<string, Record<string, number>> }>(g, 'materials');
      return (m.counts.rough_flour ?? 0) + Object.values(m.stock.rough_flour ?? {}).reduce((n, q) => n + (q ?? 0), 0);
    };
    const explore = (spot: string, activity: string) => {
      const g = makeGame({ seed: 42 });
      patch(g, (slices) => {
        slices.world.spot = spot;
        if (!slices.world.discovered.includes(spot)) slices.world.discovered.push(spot);
      });
      const before = { gold: goldOf(g), flour: flourOf(g) };
      expect(g.dispatch(selectActivity({ activity }))).toEqual({ ok: true });
      for (let i = 0; i < 50 && !isExplored(slice<WorldState>(g, 'world'), spot); i++) runHeadless(g, { ticks: 100 });
      const state = slice<WorldState>(g, 'world');
      expect(isExplored(state, spot)).toBe(true);
      expect(state.finds[spot]).toEqual([SPOTS[spot].finds![0].id]);
      return { g, before };
    };

    const chalk = explore('chalk_yard', 'explore_chalk');
    // At least the find's minimum: exploring also drops the odd coin of its own.
    expect(goldOf(chalk.g) - chalk.before.gold).toBeGreaterThanOrEqual(SPOTS.chalk_yard.finds![0].gold!.min);

    const cellar = explore('the_undercrofts', 'explore_undercrofts');
    expect(flourOf(cellar.g) - cellar.before.flour).toBe(SPOTS.the_undercrofts.finds![0].material!.qty);
  });
});

/**
 * The old forge validator (`forge/lib/validate.ts`) ran the same functions on
 * the staged working copy. The forge here has no such validator.
 */
describe('the forge validator reports the same rules', () => {
  it.todo('says nothing about the live content (forge: floor rules in the forge validator)');
  it.todo('flags a bypass on the floor, a lost wing, a table gap and an explore that pays nothing (forge: floor rules in the forge validator)');
  it.todo('warns, and skips the spine rules, when a floor\'s clear names no spot (forge: floor rules in the forge validator)');
});

describe("a stamp clear's spots are one table (band 3's ward 7)", () => {
  const at = (pos: number) => ({ type: 'stat' as const, key: 'band:pos:x', value: pos });
  const upTo = (pos: number) => ({ type: 'statMax' as const, key: 'band:pos:x', value: pos });
  const open = { type: 'statMax' as const, key: 'ward:x:done', value: 0 };
  const line = (...requires: object[]) => ({ monsterId: 'm', weight: 1, level: [1, 1] as [number, number], requires });

  it('passes when some spot is eligible at every position, and ignores samples where the stamp is set', () => {
    const road = { id: 'road', encounters: [line(upTo(0), open)] };
    const camp = { id: 'camp', encounters: [line(at(1), open)] };
    expect(stampClearTableIssues([road, camp] as never, 'ward:x:done')).toEqual([]);
    // Each alone has gaps: the single-spot rule would flag both.
    expect(clearTableIssues(road as never)).not.toEqual([]);
    expect(clearTableIssues(camp as never)).not.toEqual([]);
  });

  it('flags a position no spot covers', () => {
    const road = { id: 'road', encounters: [line(upTo(0), open)] };
    const camp = { id: 'camp', encounters: [line(at(2), open)] };
    const issues = stampClearTableIssues([road, camp] as never, 'ward:x:done');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('band:pos:x = 1');
  });
});
