/**
 * The Vermin Festival's content contracts. Port of old
 * `systems/festivalValidation.ts`. Takes the tables and plain registries as
 * parameters, so a test or a tool runs it on a staged copy.
 * `tests/worldContent.test.ts` runs it over the live content.
 *
 * The schemas already reject an unknown move, an id that names no strategy,
 * monster, item, section or den, and a level that is not a whole number. What
 * is left here is what a schema cannot say: the dark room's last wave and its
 * boss line, the champion's boss line on the arena, a strategy's conditions
 * in range, a den's power, a cache holding exactly one find, a building only
 * in the village.
 */
import { denPower, ROYALE_MOVES, type RoyaleCacheDef, type RoyaleDenDef, type RoyaleStrategyDef } from './royaleData';
import { ARENA, DARK_ROOM, type FestivalFoe } from './rules';

/** Plain shapes, so the registries and staged copies both fit. */
export interface FestivalRefs {
  monsters: Record<string, unknown>;
  spots: Record<string, { encounters?: readonly { monsterId: string; boss?: boolean }[] }>;
}

/** The royale's tables, for the royale's checks. */
export interface RoyaleRefs {
  strategies: Record<string, Pick<RoyaleStrategyDef, 'id' | 'move' | 'when'>>;
  sections: Record<string, unknown>;
  defaultPlan: readonly string[];
  species: readonly { id: string; weight: number; plan: readonly string[] }[];
  champion: string;
  dens: readonly Pick<RoyaleDenDef, 'id' | 'section' | 'radius' | 'foes'>[];
  caches: readonly RoyaleCacheDef[];
}

/** One problem, on the registry entry it is about. */
export interface FestivalIssue {
  kind: 'royaleStrategy' | 'monster' | 'spot';
  id: string;
  message: string;
}

/**
 * Every staged dark room fighter is a real monster; the last wave is one
 * fighter fought alone; and that fighter is a boss line of the dark room,
 * which floor 15's clear reads. With `royale`, the royale's checks too (old
 * `festivalValidation.ts` the rest): every strategy names a move the field
 * knows and conditions in range; every plan names real strategies; every
 * survivor species is a monster with a positive weight and a plan; the
 * champion is a monster and the arena's boss line, which floor 16's clear
 * reads; a den has foes that are monsters, a power above 0, a radius and a
 * section; a cache has exactly one of item, weapon and heal, a section, a den
 * that exists, and a building only in the village. Royale problems are
 * reported on the arena spot.
 */
export function festivalContentIssues(
  waves: readonly (readonly FestivalFoe[])[],
  refs: FestivalRefs,
  royale?: RoyaleRefs,
): FestivalIssue[] {
  const issues: FestivalIssue[] = [];
  const on = (kind: FestivalIssue['kind'], id: string, message: string) => issues.push({ kind, id, message });
  const bossLine = (spotId: string, monsterId: string | undefined) =>
    !!monsterId && !!refs.spots[spotId]?.encounters?.some((e) => e.boss && e.monsterId === monsterId);
  if (royale) {
    const moves: ReadonlySet<string> = new Set(ROYALE_MOVES);
    for (const s of Object.values(royale.strategies)) {
      if (!moves.has(s.move)) on('royaleStrategy', s.id, `unknown move '${s.move}'`);
      const w = s.when;
      if (w?.hpBelow !== undefined && !(w.hpBelow > 0 && w.hpBelow <= 1)) {
        on('royaleStrategy', s.id, 'when.hpBelow is a health share, above 0 and at most 1');
      }
      for (const k of ['fieldAbove', 'fieldBelow'] as const) {
        const v = w?.[k];
        if (v !== undefined && !(Number.isInteger(v) && v >= 0)) on('royaleStrategy', s.id, `when.${k} is a whole number of survivors`);
      }
    }
    for (const id of royale.defaultPlan) {
      if (!royale.strategies[id]) on('royaleStrategy', id, `the default royale plan names unknown strategy '${id}'`);
    }
    for (const sp of royale.species) {
      if (!refs.monsters[sp.id]) on('monster', sp.id, 'a survivor species is not a monster');
      if (!(sp.weight > 0)) on('monster', sp.id, 'survivor species weight must be positive');
      if (!sp.plan.length) on('monster', sp.id, 'survivor species has no strategies');
      for (const id of sp.plan) {
        if (!royale.strategies[id]) on('royaleStrategy', id, `survivor species '${sp.id}' names unknown strategy '${id}'`);
      }
    }
  }
  for (const wave of waves) {
    for (const foe of wave) {
      if (!refs.monsters[foe.monsterId]) on('monster', foe.monsterId, 'a dark room wave fighter is not a monster');
    }
  }
  const last = waves[waves.length - 1] ?? [];
  if (last.length !== 1) on('spot', DARK_ROOM, 'the dark room’s last wave is one fighter, fought alone');
  if (!bossLine(DARK_ROOM, last[0]?.monsterId)) on('spot', DARK_ROOM, 'the dark room’s last fighter is not a boss line here');
  if (!royale) return issues;
  if (!refs.monsters[royale.champion]) on('monster', royale.champion, 'the royale champion is not a monster');
  if (!bossLine(ARENA, royale.champion)) on('spot', ARENA, 'the royale champion is not a boss line here');
  const dens = new Set(royale.dens.map((d) => d.id));
  for (const den of royale.dens) {
    if (!royale.sections[den.section]) on('spot', ARENA, `den '${den.id}' names unknown section '${den.section}'`);
    if (!(den.radius > 0)) on('spot', ARENA, `den '${den.id}' needs a radius above 0`);
    if (!den.foes.length) on('spot', ARENA, `den '${den.id}' has no foes`);
    for (const foe of den.foes) {
      if (!refs.monsters[foe.monsterId]) on('monster', foe.monsterId, `den '${den.id}' names a foe that is not a monster`);
    }
    if (!(denPower(den) > 0)) on('spot', ARENA, `den '${den.id}' has no power: its foes need levels above 0`);
  }
  for (const cache of royale.caches) {
    const given = [cache.item !== undefined, cache.weapon === true, cache.heal !== undefined].filter(Boolean).length;
    if (given !== 1) on('spot', ARENA, `cache '${cache.id}' holds exactly one of item, weapon and heal`);
    if (cache.heal !== undefined && !(cache.heal > 0 && cache.heal <= 1)) on('spot', ARENA, `cache '${cache.id}' heals a share of health, above 0 and at most 1`);
    if (!royale.sections[cache.section]) on('spot', ARENA, `cache '${cache.id}' names unknown section '${cache.section}'`);
    if (cache.den !== undefined && !dens.has(cache.den)) on('spot', ARENA, `cache '${cache.id}' names unknown den '${cache.den}'`);
    if (cache.building !== undefined && cache.section !== 'village') on('spot', ARENA, `cache '${cache.id}' names a building outside the village`);
  }
  return issues;
}
