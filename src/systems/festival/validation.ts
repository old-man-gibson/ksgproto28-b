/**
 * The Vermin Festival's content contracts, the run's part. Port of old
 * `systems/festivalValidation.ts` without the royale's checks (strategies,
 * plans, survivor species, the champion, dens and caches), which come with
 * the royale's registries in step 4 port C5. Takes the waves and plain
 * registries as parameters, so a test or a tool runs it on a staged copy.
 * `tests/worldContent.test.ts` runs it over the live content.
 */
import { DARK_ROOM, type FestivalFoe } from './rules';

/** Plain shapes, so the registries and staged copies both fit. */
export interface FestivalRefs {
  monsters: Record<string, unknown>;
  spots: Record<string, { encounters?: readonly { monsterId: string; boss?: boolean }[] }>;
}

/** One problem, on the registry entry it is about. */
export interface FestivalIssue {
  kind: 'monster' | 'spot';
  id: string;
  message: string;
}

/**
 * Every staged dark room fighter is a real monster; the last wave is one
 * fighter fought alone; and that fighter is a boss line of the dark room,
 * which floor 15's clear reads.
 */
export function festivalContentIssues(waves: readonly (readonly FestivalFoe[])[], refs: FestivalRefs): FestivalIssue[] {
  const issues: FestivalIssue[] = [];
  const on = (kind: FestivalIssue['kind'], id: string, message: string) => issues.push({ kind, id, message });
  for (const wave of waves) {
    for (const foe of wave) {
      if (!refs.monsters[foe.monsterId]) on('monster', foe.monsterId, 'a dark room wave fighter is not a monster');
    }
  }
  const last = waves[waves.length - 1] ?? [];
  if (last.length !== 1) on('spot', DARK_ROOM, 'the dark room’s last wave is one fighter, fought alone');
  const bossLine = (spotId: string, monsterId: string | undefined) =>
    !!monsterId && !!refs.spots[spotId]?.encounters?.some((e) => e.boss && e.monsterId === monsterId);
  if (!bossLine(DARK_ROOM, last[0]?.monsterId)) on('spot', DARK_ROOM, 'the dark room’s last fighter is not a boss line here');
  return issues;
}
