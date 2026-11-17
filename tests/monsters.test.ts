/**
 * The monster cases of the old `tests/content.test.ts` ("monsters",
 * "bestiary: derived tags", "everything a monster inflicts exists",
 * "monster penetration"), under their old names, plus new cases for the
 * record lint.
 *
 * The schema validator already checks the references the old cases checked
 * by hand (tags, tier, escorts, the conditions a monster inflicts). The old
 * assertions are kept here on the loaded records.
 *
 * Left behind, as `it.todo`: the portrait files (licensed art, not in this
 * repository) and the generated art list; the floor half of the penetration
 * rule (port 6: spots and floors).
 */
import { describe, expect, it } from 'vitest';
import { conditionIssues, type ConditionRecord } from '../src/systems/counters';
import { ITEMS, RUNES } from '../src/systems/items';
import { dropTableIssues } from '../src/systems/loot';
import { MATERIALS } from '../src/systems/materials';
import {
  MONSTER_LIST,
  MONSTER_TAGS,
  MONSTERS,
  monsterIssues,
  monsterTagsOf,
  penetrationOf,
  penetrationProblems,
  TAG_ARMOR,
  TAG_RESISTANCES,
  TIERS,
  type MonsterDef,
} from '../src/systems/monsters';
import { DAMAGE_TYPES } from '../src/systems/stats';
import { STATUSES } from '../src/systems/statuses';
import { readJson } from './helpers';

const VALID_DAMAGE_TYPES = new Set<string>(DAMAGE_TYPES);

describe('monsters', () => {
  it('the registry holds every record of the old one', () => {
    expect(MONSTER_LIST).toHaveLength(131);
    expect(Object.keys(TIERS)).toEqual(['basic', 'veteran', 'elite', 'ancient', 'legendary', 'mythic', 'divine']);
  });

  it('damage types, resistances, and drop tables are valid', () => {
    for (const m of MONSTER_LIST) {
      expect(VALID_DAMAGE_TYPES.has(m.damageType), `${m.id} damageType`).toBe(true);
      for (const key of Object.keys(m.resistances ?? {})) {
        expect(VALID_DAMAGE_TYPES.has(key), `${m.id} resistance ${key}`).toBe(true);
      }
      expect(m.loot.rolls).toBeGreaterThan(0);
      // The same drop listed twice would escalate at double rate under
      // drought protection: `dropTableIssues` reports it.
      expect(dropTableIssues(m.loot), m.id).toEqual([]);
      for (const e of m.loot.entries) {
        expect(e.weight, `${m.id} drop weight`).toBeGreaterThan(0);
        if (e.kind === 'item') expect(ITEMS[e.id!], `${m.id} drops item ${e.id}`).toBeDefined();
        if (e.kind === 'material') expect(MATERIALS[e.id!], `${m.id} drops material ${e.id}`).toBeDefined();
        if (e.kind === 'rune') expect(RUNES[e.id!], `${m.id} drops rune ${e.id}`).toBeDefined();
        if (e.qty) expect(e.qty[0]).toBeLessThanOrEqual(e.qty[1]);
        if (e.killedBy) {
          expect(e.killedBy.length, `${m.id} drops ${e.id ?? e.kind} on no kill: killedBy is empty`).toBeGreaterThan(0);
          for (const t of e.killedBy) expect(VALID_DAMAGE_TYPES.has(t), `${m.id} killedBy ${t}`).toBe(true);
        }
      }
    }
  });

  it('a veil holds at least one condition, and every condition names something real', () => {
    const raw = readJson('src/systems/monsters/content/monsters.json') as { id: string; veil?: ConditionRecord[] }[];
    for (const m of raw) {
      if (!m.veil) continue;
      expect(m.veil.length, `${m.id}: an empty veil hides nothing`).toBeGreaterThan(0);
      for (const cond of m.veil) expect(conditionIssues(cond), `${m.id} veil`).toEqual([]);
    }
  });

  it('every tag is registered, and tier tags are never hand-written', () => {
    for (const m of MONSTER_LIST) {
      for (const tag of m.tags) {
        const def = MONSTER_TAGS[tag];
        expect(def, `${m.id}: unregistered tag '${tag}'`).toBeDefined();
        expect(def.category !== 'tier', `${m.id}: tag '${tag}' is derived from the record, do not declare it`).toBe(true);
      }
      const material = m.tags.filter((t) => MONSTER_TAGS[t]?.category === 'material');
      expect(material.length, `${m.id}: needs exactly one material tag`).toBe(1);
      const taxon = m.tags.filter((t) => MONSTER_TAGS[t]?.category === 'taxon');
      expect(taxon.length, `${m.id}: needs at least one taxonomy tag`).toBeGreaterThan(0);
    }
  });

  it('every TAG_RESISTANCES key is a registered monster tag', () => {
    for (const tag of Object.keys(TAG_RESISTANCES)) {
      expect(MONSTER_TAGS[tag], `TAG_RESISTANCES: unregistered tag '${tag}'`).toBeDefined();
    }
    // The same rule for the armour table, which the old file stated in a comment.
    for (const tag of Object.keys(TAG_ARMOR)) {
      expect(MONSTER_TAGS[tag], `TAG_ARMOR: unregistered tag '${tag}'`).toBeDefined();
    }
  });

  it('no monster carries two tags that disagree in sign about one damage type', () => {
    for (const m of MONSTER_LIST) {
      const opinions = new Map<string, { tag: string; sign: number }>();
      for (const tag of m.tags) {
        for (const [type, rule] of Object.entries(TAG_RESISTANCES[tag] ?? {})) {
          const sign = Math.sign(rule!.base);
          if (sign === 0) continue;
          const seen = opinions.get(type);
          expect(
            seen === undefined || seen.sign === sign,
            `${m.id}: tags '${seen?.tag}' and '${tag}' disagree about ${type}`,
          ).toBe(true);
          if (!seen) opinions.set(type, { tag, sign });
        }
      }
    }
  });

  it.todo('enemyArt.gen.ts lists exactly the art the monsters declare (the art step: the files are not in this repository)');
  it.todo('declared bestiary art exists on disk (the art step: the files are not in this repository)');

  // New here: what the schema cannot say.
  it('every record passes the record lint', () => {
    for (const m of MONSTER_LIST) expect(monsterIssues(m), m.id).toEqual([]);
  });

  it('the record lint names a bad gold range, a rotation entry of two kinds and a group that cannot fit', () => {
    const bad: MonsterDef = {
      ...MONSTERS.goblin,
      id: 'test_bad',
      gold: [5, 1],
      rotation: [{ technique: 'lunge', cast: { school: 'arcane', words: ['fire'] } } as never],
      group: { min: 4, max: 9 },
    };
    expect(monsterIssues(bad)).toEqual([
      'test_bad: gold must be a lowest and a highest number',
      'test_bad: a rotation entry carries exactly one of technique and cast',
      'test_bad: group max 9 is above the 5 slots of a fight',
    ]);
  });
});

describe('bestiary', () => {
  it('derived tags describe the monster the stats describe', () => {
    for (const def of MONSTER_LIST) {
      const tags = monsterTagsOf(def);
      expect(tags, `${def.id}: tier tag`).toContain(def.tier);
      expect(tags.includes('ranged'), `${def.id}: ranged tag`).toBe(def.range === 'ranged');
      expect(tags.includes('leader'), `${def.id}: leader tag`).toBe(!!def.escorts?.length);
      // Everything lands in an element bucket, real or `non_elemental`.
      const elements = tags.filter((t) => MONSTER_TAGS[t]?.category === 'element');
      expect(elements.length, `${def.id}: elements ${elements.join(',')}`).toBeGreaterThan(0);
    }
  });
});

describe('statuses', () => {
  it('everything a monster inflicts exists', () => {
    for (const def of MONSTER_LIST) {
      for (const app of [...(def.inflicts ?? []), ...(def.wears ?? [])]) {
        expect(STATUSES[app.id], `${def.id} inflicts unknown '${app.id}'`).toBeTruthy();
        if (app.chance !== undefined) {
          expect(app.chance).toBeGreaterThan(0);
          expect(app.chance).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('monster penetration', () => {
  it('is a share on every tier', () => {
    for (const tier of Object.values(TIERS)) {
      expect(tier.penetration, `${tier.id} penetration`).toBeGreaterThanOrEqual(0);
      expect(tier.penetration, `${tier.id} penetration`).toBeLessThanOrEqual(1);
    }
  });

  it('is zero for everything that can appear on floors 1 to 3, and a share elsewhere', () => {
    // The share half. The floor half needs the spots of the early floors.
    expect(penetrationProblems(MONSTERS, TIERS).map((p) => p.message)).toEqual([]);
  });
  it.todo('is zero for everything that can appear on floors 1 to 3: the floor half (port 6: spots and floors build the `early` list)');

  // New here: the function with the list a later port will build.
  it('reports a species that erodes resistance on an early floor, and one out of range', () => {
    const defs: Record<string, MonsterDef> = {
      early: { ...MONSTERS.goblin, id: 'early', tier: 'ancient' },
      wild: { ...MONSTERS.goblin, id: 'wild', penetration: 1.5 },
    };
    expect(penetrationOf(defs.early)).toBe(0.15);
    const problems = penetrationProblems(defs, TIERS, [{ monsterId: 'early', where: 'f1_test (floor_1)' }]);
    expect(problems.map((p) => p.monster).sort()).toEqual(['early', 'wild']);
  });
});
