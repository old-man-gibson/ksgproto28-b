/**
 * The harbor band's registries checked against the rest of the content. Port
 * of the old `systems/seaValidation.ts`. Takes the tables and plain registries
 * as parameters, so a test or a tool runs it on a staged copy.
 * `tests/worldContent.test.ts` runs it over the live content.
 */
import { SEA_FLOWS, type ConvoyDef, type SeaSideDef } from './rules';

/** Plain shapes, so the registries and staged copies both fit. */
export interface SeaRefs {
  spots: Record<
    string,
    {
      id: string;
      fightLimit?: number;
      activities: readonly { kind: string }[];
      encounters?: readonly { monsterId: string; once?: boolean }[];
    }
  >;
  npcs: Record<string, { quests: readonly string[] }>;
  quests: Record<string, { giver: string; requirements?: readonly { type: string; key?: string; value?: number }[] }>;
  monsters: Record<string, unknown>;
  materials: Record<string, unknown>;
}

export interface SeaIssue {
  kind: 'seaSide' | 'convoy';
  id: string;
  message: string;
}

/** The accept stamp a join quest writes (`quests` `acceptedKey`). */
const stamp = (questId: string): string => `flag:quest:${questId}:accepted`;

/**
 * - A side's flow is one of the four; its giver gives its join quest, which
 *   it alone uses; its prey are monsters; its mission spot has a `once`
 *   spawn of its mission monster.
 * - One side per run: every join quest requires every other side's stamp at
 *   0 (`statMax`).
 * - A convoy names a water: a spot with a hunt and no `fightLimit` (a water
 *   never clears; the sea counts its fights). Its three ranges are whole
 *   numbers with 0 <= low <= high, and its cargo is a non-empty list of
 *   materials.
 */
export function seaContentIssues(sides: readonly SeaSideDef[], convoys: readonly ConvoyDef[], refs: SeaRefs): SeaIssue[] {
  const issues: SeaIssue[] = [];
  const side = (id: string, message: string) => issues.push({ kind: 'seaSide', id, message });
  const convoy = (id: string, message: string) => issues.push({ kind: 'convoy', id, message });

  const joins = new Map<string, string>();
  for (const s of sides) {
    if (!SEA_FLOWS.includes(s.flow)) side(s.id, `flow '${s.flow}' is not one of ${SEA_FLOWS.join(', ')}`);
    const npc = refs.npcs[s.giver];
    if (!npc) side(s.id, `giver '${s.giver}' is not an NPC`);
    else if (!npc.quests.includes(s.joinQuest)) side(s.id, `giver '${s.giver}' does not give '${s.joinQuest}'`);
    const quest = refs.quests[s.joinQuest];
    if (!quest) side(s.id, `join quest '${s.joinQuest}' does not exist`);
    else if (quest.giver !== s.giver) side(s.id, `join quest '${s.joinQuest}' is given by '${quest.giver}', not '${s.giver}'`);
    if (joins.has(s.joinQuest)) side(s.id, `join quest '${s.joinQuest}' is also ${joins.get(s.joinQuest)}'s`);
    joins.set(s.joinQuest, s.id);
    if (!s.prey.length) side(s.id, 'prey is empty: no kill on the water would count');
    for (const m of s.prey) if (!refs.monsters[m]) side(s.id, `prey '${m}' is not a monster`);
    const spot = refs.spots[s.mission.spot];
    if (!spot) side(s.id, `mission spot '${s.mission.spot}' does not exist`);
    else if (!spot.encounters?.some((e) => e.monsterId === s.mission.monsterId && e.once)) {
      side(s.id, `mission spot '${s.mission.spot}' has no 'once' spawn of '${s.mission.monsterId}'`);
    }
  }
  // One side per run: every join quest refuses while any other side's stamp is set.
  for (const s of sides) {
    const quest = refs.quests[s.joinQuest];
    if (!quest) continue;
    for (const other of sides) {
      if (other.id === s.id) continue;
      const locked = (quest.requirements ?? []).some(
        (c) => c.type === 'statMax' && c.key === stamp(other.joinQuest) && c.value === 0,
      );
      if (!locked) side(s.id, `join quest '${s.joinQuest}' must require ${stamp(other.joinQuest)} at 0 (one side per run)`);
    }
  }

  const seen = new Set<string>();
  for (const row of convoys) {
    if (seen.has(row.id)) convoy(row.id, 'listed twice');
    seen.add(row.id);
    const spot = refs.spots[row.id];
    if (!spot) {
      convoy(row.id, 'names no spot');
    } else {
      if (!spot.activities.some((a) => a.kind === 'hunt')) convoy(row.id, 'the water has no hunt, so no kill there can count');
      if (spot.fightLimit !== undefined) convoy(row.id, 'a water never clears: drop its fightLimit (the sea counts its fights)');
    }
    for (const field of ['raiders', 'monsters', 'guard'] as const) {
      const range = row[field];
      const [lo, hi] = range;
      if (range.length !== 2 || !Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || lo > hi) {
        convoy(row.id, `${field} [${range.join(', ')}] must be two whole numbers with 0 <= low <= high`);
      }
    }
    if (!row.cargo.length) convoy(row.id, 'cargo is empty: a crate won would pay nothing');
    for (const m of row.cargo) if (!refs.materials[m]) convoy(row.id, `cargo '${m}' is not a material`);
  }
  return issues;
}
