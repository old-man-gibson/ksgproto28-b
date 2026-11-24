/**
 * Region skies (a region's `sky`, the tables of `sky_tables`) and the
 * encounter lines that wait on them (an encounter line's `sky`), checked
 * against the rest of the content. Port of the old `systems/skyValidation.ts`.
 * Takes plain records, so a test or a tool runs it on a staged copy.
 * `tests/worldContent.test.ts` runs it over the live content.
 */
import { SKY_TABLES, WEATHER_KINDS } from './defs';

/** Plain shapes, so the registries and staged copies both fit. */
export interface SkyRefs {
  regions: Record<string, { id: string; sky?: string; world?: unknown; sheltered?: boolean; tags?: readonly string[] }>;
  areas: Record<string, { id: string; regionId: string; skyRegionId?: string; sheltered?: boolean; tags?: readonly string[] }>;
  spots: Record<
    string,
    { id: string; areaId: string; tags?: readonly string[]; encounters?: readonly { monsterId: string; sky?: readonly string[] }[] }
  >;
}

export interface SkyIssue {
  kind: 'region' | 'area' | 'spot';
  id: string;
  message: string;
}

/** Kinds only a region sky table produces; the noise field never draws them. */
const TABLE_ONLY = new Set(['heatwave', 'calm']);

const KINDS = new Set<string>(WEATHER_KINDS);

/**
 * - A region's `sky` names a table, and a region with a table has an atlas
 *   pin (an unplaced region has no weather).
 * - An area's `skyRegionId` names a region.
 * - A spot's `sky` encounter line names one or more weather kinds; `calm`
 *   and `heatwave` only where the sky region has a table; and the spot has an
 *   open sky: not sheltered (the area's `sheltered` overrides the region's),
 *   no `indoor` tag on region, area or spot, a sky region with an atlas pin.
 */
export function skyContentIssues(refs: SkyRefs): SkyIssue[] {
  const issues: SkyIssue[] = [];

  for (const region of Object.values(refs.regions)) {
    if (region.sky === undefined) continue;
    const add = (message: string) => issues.push({ kind: 'region', id: region.id, message });
    if (!SKY_TABLES[region.sky]) add(`sky '${region.sky}' is not in SKY_TABLES`);
    if (!region.world) add('a sky table needs an atlas pin (world): an unplaced region has no weather');
  }

  for (const area of Object.values(refs.areas)) {
    if (area.skyRegionId === undefined) continue;
    if (!refs.regions[area.skyRegionId]) {
      issues.push({ kind: 'area', id: area.id, message: `skyRegionId '${area.skyRegionId}' is not a region` });
    }
  }

  for (const spot of Object.values(refs.spots)) {
    const lines = (spot.encounters ?? []).filter((e) => e.sky !== undefined);
    if (!lines.length) continue;
    const add = (message: string) => issues.push({ kind: 'spot', id: spot.id, message });
    const area = refs.areas[spot.areaId];
    // The sky region, as `skyRegionOf` of `world` finds it.
    const region = area && refs.regions[area.skyRegionId ?? area.regionId];
    // The roof test of `skyKindAt`: the area's `sheltered` overrides the
    // region's, and an `indoor` tag at any level is a roof.
    const sheltered = area?.sheltered ?? region?.sheltered ?? false;
    const roofed = [...(region?.tags ?? []), ...(area?.tags ?? []), ...(spot.tags ?? [])].includes('indoor');
    for (const e of lines) {
      const who = `${e.monsterId}: sky`;
      const kinds = e.sky ?? [];
      if (!kinds.length) add(`${who} is empty, so the line never rolls`);
      for (const k of kinds) {
        if (!KINDS.has(k)) add(`${who} names '${k}', which is not a weather kind`);
        else if (TABLE_ONLY.has(k) && !region?.sky) {
          add(`${who} names '${k}', which only a region sky table produces, and this region has none`);
        }
      }
      if (sheltered || roofed) add(`${who} waits on a sky this spot never has (sheltered or indoor)`);
      else if (!region?.world) add(`${who} waits on a sky this spot never has (its region is not on the atlas)`);
    }
  }

  return issues;
}
