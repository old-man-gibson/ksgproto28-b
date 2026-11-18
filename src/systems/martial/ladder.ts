/**
 * What practice, a fork and the runes of the wielded weapon make of a
 * technique: the powers-of-ten ladder, the Honed fork, rune surgery. Port of
 * the ladder, fork and `resolvedMove` / `techniqueExit` / `techniqueEntries`
 * half of the old `systems/martial.ts`. Every function here is pure: it reads
 * the def, the ledger entry and the rune mods it is given.
 */
import type { DeepReadonly } from '../../kernel';
import {
  BEYOND_COOLDOWN,
  BEYOND_POWER,
  FORK_ARCHETYPE_LIST,
  FORK_ARCHETYPES,
  FORK_TIER,
  MASTERY_COOLDOWN,
  MASTERY_LADDER,
  MASTERY_NAMES,
  MASTERY_POWER,
  MAX_MASTERY_TIER,
  ROUGH_REP_MULT,
  ROUGH_STAMINA_MULT,
  type ForkArchetypeDef,
  type TechniqueDef,
  type TechniqueEntry,
  type TechniqueMove,
  type TechniqueState,
} from './defs';

export type Held = DeepReadonly<TechniqueState> | undefined;

/** One rune's surgery on one technique. The old `RuneTechniqueMod`. */
export interface RuneTechniqueMod {
  technique: string;
  rename?: string;
  cooldownMult?: number;
  damageMult?: number;
  penetrationAdd?: number;
  splashAdd?: number;
  exitTo?: string;
  grantsFork?: string;
}

export const NO_RUNES: readonly RuneTechniqueMod[] = [];

// ---- the ladder ----

/** Reps as the ladder counts them: a rough form's count double. The old `effectiveReps`. */
export function effectiveReps(held: Held): number {
  if (!held) return 0;
  return held.form === 'rough' ? held.executions * ROUGH_REP_MULT : held.executions;
}

/** Reps a rung needs: the ladder's four, then one per power of ten. */
export function rungThreshold(tier: number): number {
  return tier <= MASTERY_LADDER.length ? MASTERY_LADDER[tier - 1] : Math.pow(10, tier);
}

/** The rung held: 0 none, 1 to 4 the ladder, 5 to `MAX_MASTERY_TIER` past Perfected. */
export function masteryTier(held: Held): number {
  const reps = effectiveReps(held);
  let tier = 0;
  while (tier < MAX_MASTERY_TIER && reps >= rungThreshold(tier + 1)) tier += 1;
  return tier;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

/** The rung's name: the record's note, the ladder name, or "Beyond N" past Perfected. */
export function masteryTierName(def: TechniqueDef, tier: number): string | undefined {
  if (tier < 1) return undefined;
  const named = def.mastery?.find((m) => m.tier === tier)?.name;
  if (named) return named;
  return tier <= MASTERY_LADDER.length ? MASTERY_NAMES[tier - 1] : `Beyond ${ROMAN[tier - MASTERY_LADDER.length - 1]}`;
}

/** Raw executions still needed for the next rung; undefined at the last one. */
export function repsToNextTier(held: Held): number | undefined {
  const tier = masteryTier(held);
  if (tier >= MAX_MASTERY_TIER) return undefined;
  const mult = held?.form === 'rough' ? ROUGH_REP_MULT : 1;
  return Math.ceil((rungThreshold(tier + 1) - effectiveReps(held)) / mult);
}

// ---- the ways in ----

/**
 * Every way into the technique for the one who holds it: the declared ways,
 * plus one plain way at the positions the held rungs open (`addFrom`). The
 * old `techniqueEntries`.
 */
export function entriesOf(def: TechniqueDef, held: Held): readonly TechniqueEntry[] {
  if (!held || !def.mastery) return def.from;
  const tier = masteryTier(held);
  if (tier === 0) return def.from;
  const opened: string[] = [];
  for (let t = 1; t <= tier; t++) {
    for (const note of def.mastery) if (note.tier === t && note.addFrom) opened.push(...note.addFrom);
  }
  return opened.length ? [...def.from, { at: opened }] : def.from;
}

/** Where the technique fires from, flattened. The old `entryPositions`. */
export function entryPositions(def: TechniqueDef, held: Held): string[] | 'any' {
  const entries = entriesOf(def, held);
  if (entries.some((e) => e.at === 'any')) return 'any';
  return [...new Set(entries.flatMap((e) => e.at as string[]))];
}

/** Whether the technique admits a position. The old `positionAllows`. */
export function positionAllows(def: TechniqueDef, held: Held, position: string): boolean {
  const from = entryPositions(def, held);
  return from === 'any' || from.includes(position);
}

// ---- forks ----

/** The archetype the path committed to. The old `chosenFork`. */
export function chosenFork(held: Held): ForkArchetypeDef | undefined {
  return held?.path ? FORK_ARCHETYPES[held.path] : undefined;
}

/** Whether an archetype can apply to the move at all. The old `forkApplies`. */
function forkApplies(def: TechniqueDef, arch: ForkArchetypeDef): boolean {
  const offensive = def.move.damageMult !== undefined;
  if ((arch.kind === 'strike') !== offensive) return false;
  // A pure-exit archetype must move the exit: on a technique that already ends
  // there it advances nothing.
  const numeric =
    arch.damageMult !== undefined ||
    arch.hits !== undefined ||
    arch.cooldownMult !== undefined ||
    arch.splashAdd !== undefined ||
    arch.staminaMult !== undefined ||
    arch.durationMult !== undefined;
  return numeric || arch.exitTo !== def.to;
}

/**
 * The archetypes on offer at Honed: the record's list, or the whole matching
 * vocabulary for a syncretic form, widened by the weapon's runes
 * (`grantsFork`). The old `forkOptions`.
 */
export function forkOptions(def: TechniqueDef, held: Held, runes: readonly RuneTechniqueMod[] = NO_RUNES): ForkArchetypeDef[] {
  const base =
    held?.form === 'syncretic'
      ? FORK_ARCHETYPE_LIST.filter((a) => forkApplies(def, a))
      : (def.forks ?? []).map((id) => FORK_ARCHETYPES[id]).filter((a): a is ForkArchetypeDef => !!a && forkApplies(def, a));
  const out = [...base];
  for (const m of runes) {
    if (!m.grantsFork) continue;
    const arch = FORK_ARCHETYPES[m.grantsFork];
    if (arch && forkApplies(def, arch) && !out.some((a) => a.id === arch.id)) out.push(arch);
  }
  return out;
}

/** Whether the Honed choice is open: rung reached, options, no path yet. The old `forkAvailable`. */
export function forkAvailable(def: TechniqueDef, held: Held, runes: readonly RuneTechniqueMod[] = NO_RUNES): boolean {
  if (!held || held.path) return false;
  if (masteryTier(held) < FORK_TIER) return false;
  return forkOptions(def, held, runes).length > 0;
}

/** The name as the path and the runes shaped it: a rune's rename, else the fork's prefix. The old `techniqueDisplayName`. */
export function displayName(def: TechniqueDef, held: Held, runes: readonly RuneTechniqueMod[] = NO_RUNES): string {
  const rename = runes.find((m) => m.rename)?.rename;
  if (rename) return rename;
  const fork = chosenFork(held);
  return fork ? `${fork.name} ${def.name}` : def.name;
}

// ---- the move and the exit ----

/** Where executing it leaves the fighter: a rune, then the fork, then the record. The old `techniqueExit`. */
export function exitOf(def: TechniqueDef, held: Held, runes: readonly RuneTechniqueMod[] = NO_RUNES): string {
  const rune = runes.find((m) => m.exitTo)?.exitTo;
  return rune ?? chosenFork(held)?.exitTo ?? def.to;
}

/**
 * The move as practice and provenance shaped it: the rung's multipliers, the
 * rungs past Perfected, the fork, the runes, the rough surcharge (gone at
 * Perfected). The old `resolvedMove`, term for term and in its order.
 */
export function moveOf(def: TechniqueDef, held: Held, runes: readonly RuneTechniqueMod[] = NO_RUNES): TechniqueMove {
  const tier = masteryTier(held);
  const rough = held?.form === 'rough';
  const fork = chosenFork(held);
  if (tier === 0 && !rough && !fork && runes.length === 0) return def.move;
  const move: TechniqueMove = { ...def.move };
  if (tier > 0) {
    const rung = Math.min(tier, MASTERY_LADDER.length) - 1;
    if (move.damageMult !== undefined) move.damageMult *= MASTERY_POWER[rung];
    if (move.preventedMult !== undefined) move.preventedMult *= MASTERY_POWER[rung];
    move.cooldown = Math.max(10, Math.round(move.cooldown * MASTERY_COOLDOWN[rung]));
  }
  const beyond = Math.max(0, tier - MASTERY_LADDER.length);
  if (beyond > 0) {
    const power = Math.pow(BEYOND_POWER, beyond);
    if (move.damageMult !== undefined) move.damageMult *= power;
    if (move.preventedMult !== undefined) move.preventedMult *= power;
    if (move.buff && move.damageMult === undefined && move.preventedMult === undefined) {
      move.buff = { ...move.buff, duration: Math.round(move.buff.duration * power) };
    }
    move.cooldown = Math.max(10, Math.round(move.cooldown * Math.pow(BEYOND_COOLDOWN, beyond)));
  }
  if (fork) {
    if (fork.damageMult && move.damageMult !== undefined) move.damageMult *= fork.damageMult;
    if (fork.damageMult && move.preventedMult !== undefined) move.preventedMult *= fork.damageMult;
    if (fork.hits) move.hits = fork.hits;
    if (fork.cooldownMult) move.cooldown = Math.max(10, Math.round(move.cooldown * fork.cooldownMult));
    if (fork.splashAdd) move.splash = (move.splash ?? 0) + fork.splashAdd;
    if (fork.staminaMult && move.staminaCost) move.staminaCost *= fork.staminaMult;
    if (fork.durationMult && move.buff) {
      move.buff = { ...move.buff, duration: Math.round(move.buff.duration * fork.durationMult) };
    }
  }
  for (const m of runes) {
    if (m.damageMult && move.damageMult !== undefined) move.damageMult *= m.damageMult;
    if (m.damageMult && move.preventedMult !== undefined) move.preventedMult *= m.damageMult;
    if (m.cooldownMult) move.cooldown = Math.max(10, Math.round(move.cooldown * m.cooldownMult));
    if (m.penetrationAdd) move.penetration = (move.penetration ?? 0) + m.penetrationAdd;
    if (m.splashAdd) move.splash = (move.splash ?? 0) + m.splashAdd;
  }
  if (rough && tier < MASTERY_LADDER.length && move.staminaCost) move.staminaCost *= ROUGH_STAMINA_MULT;
  return move;
}
