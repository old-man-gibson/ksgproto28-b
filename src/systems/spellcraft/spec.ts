/**
 * What a spell source means: the one door every reader goes through. Port
 * of `specForSource`, `spellKey`, `workingSignature`, `leadingElement` and
 * `undoWorking` of the old `systems/spellcraft.ts`.
 *
 * A school is registered by the system that owns it, at module load. This
 * file imports no school, so a new school edits no file in this folder.
 */
import type { DeepReadonly, DerivedReads, SystemDef } from '../../kernel';
import type { StatusApplication } from '../statuses';
import type { DamageType } from '../stats';
import type { SpellSchool, SpellSource, SpellSpec } from './types';

/** How two deities stand toward one another. */
export type DeityRelation = 'synergy' | 'hostile' | 'neutral';

export interface SchoolKind<S extends SpellSource = SpellSource> {
  /** The identity of a source within the school: the old `spellKey` after its `school:` prefix. */
  key(source: S): string;
  /** The bare reading of a source, or null when it no longer resolves. Pure. */
  spec(source: S): SpellSpec | null;
  /** The standing between two deities, for miracle synergy. */
  relation?(a: string, b: string): DeityRelation;
  /**
   * The source as this speaker reads it, or null for the bare reading. Not
   * cached: it reads state (the arcane word levels). The school's case of
   * the old `resolveSpellFor`.
   */
  reading?(reads: SchoolReads, source: S): SpellSpec | null;
}

/**
 * What a school's contextual reading may look at: other systems' slices, and
 * a resolver's output (the psionic reading reads the stat block for the gear
 * bias). Every caller passes a context, which has both.
 */
export interface SchoolReads extends Pick<DerivedReads, 'resolved'> {
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
}

const SCHOOLS = new Map<string, SchoolKind>();

/** Register a school of magic. Called at module load by the system that owns it. */
export function registerSchool<K extends SpellSchool>(
  school: K,
  kind: SchoolKind<Extract<SpellSource, { school: K }>>,
): void {
  if (SCHOOLS.has(school)) throw new Error(`spellcraft: school "${school}" is registered twice`);
  SCHOOLS.set(school, kind as unknown as SchoolKind);
}

export function schoolOf(school: string): SchoolKind | undefined {
  return SCHOOLS.get(school);
}

/** Tests only: drop a registered school and the specs resolved through it. */
export function unregisterSchool(school: string): void {
  SCHOOLS.delete(school);
  SPELL_CACHE.clear();
}

/** A spell's identity: the combination itself. The old `spellKey`. */
export function spellKey(source: SpellSource): string {
  const kind = SCHOOLS.get(source.school);
  return `${source.school}:${kind ? kind.key(source) : JSON.stringify(source)}`;
}

/** What a reference that no longer resolves reads as. */
const FADED: Omit<SpellSpec, 'school'> = {
  name: 'Faded Inscription',
  icon: '📜',
  target: 'one',
  strikes: [],
  manaCost: 1,
  cooldown: 200,
};

interface Resolved {
  spec: SpellSpec;
  /** Why the source reads as a faded inscription, or null. */
  issue: string | null;
}

/** Resolved specs by combination. A spell never changes once made; content does not change at run time. */
const SPELL_CACHE = new Map<string, Resolved>();

function resolve(source: SpellSource): Resolved {
  const kind = SCHOOLS.get(source.school);
  if (!kind) {
    return {
      spec: { ...FADED, school: source.school },
      issue: `no system has registered the school "${source.school}"`,
    };
  }
  const key = spellKey(source);
  let found = SPELL_CACHE.get(key);
  if (!found) {
    const spec = kind.spec(source);
    found = spec
      ? { spec, issue: null }
      : { spec: { ...FADED, school: source.school }, issue: `the ${source.school} source "${kind.key(source)}" does not resolve to a spell` };
    SPELL_CACHE.set(key, found);
  }
  return found;
}

/** What a combination means, memoised. The old `specForSource`. */
export function specForSource(source: SpellSource): SpellSpec {
  return resolve(source).spec;
}

/** Why a source cannot be cast (an unregistered school, a source that does not resolve), or null. */
export function sourceIssue(source: SpellSource): string | null {
  return resolve(source).issue;
}

// ---- what an undoing reads and what it leaves ----

/**
 * What a working is made of, for an undoing to match: element to units. An
 * arcane sentence states its own. A miracle or a shape has no words: each
 * strike stands for one unit of its element, and a twin nature for one of
 * each. The old `workingSignature`.
 */
export function workingSignature(spec: SpellSpec): Partial<Record<DamageType, number>> {
  if (spec.signature) return spec.signature;
  const out: Partial<Record<DamageType, number>> = {};
  for (const strike of spec.strikes) {
    if (strike.untyped) continue;
    out[strike.type] = (out[strike.type] ?? 0) + 1;
    if (strike.orType) out[strike.orType] = (out[strike.orType] ?? 0) + 1;
  }
  return out;
}

/** The element a working is most made of. The old `leadingElement`. */
export function leadingElement(spec: SpellSpec): DamageType | undefined {
  let best: DamageType | undefined;
  let most = 0;
  for (const [element, units] of Object.entries(workingSignature(spec)) as [DamageType, number][]) {
    if (units > most) {
      best = element;
      most = units;
    }
  }
  return best;
}

/**
 * What is left of a working once an undoing has taken the complement of
 * `remaining` out of it: every blow, mending, coat and condition at that
 * share. 1 is the working untouched. The old `undoWorking`.
 */
export function undoWorking(spec: SpellSpec, remaining: number): SpellSpec {
  const r = Math.max(0, Math.min(1, remaining));
  if (r >= 1) return spec;
  const thinned = (apps: StatusApplication[]) => apps.map((a) => ({ ...a, intensity: (a.intensity ?? 1) * r }));
  const out: SpellSpec = {
    ...spec,
    strikes: spec.strikes.map((strike) => ({
      ...strike,
      power: strike.power * r,
      ...(strike.inflicts ? { inflicts: thinned(strike.inflicts) } : {}),
    })),
  };
  if (spec.heal) out.heal = spec.heal * r;
  if (spec.buff) out.buff = { ...spec.buff, mods: spec.buff.mods.map((m) => ({ ...m, value: m.value * r })) };
  if (spec.grants) out.grants = thinned(spec.grants);
  if (spec.afflicts) out.afflicts = thinned(spec.afflicts);
  if (spec.transfers) out.transfers = { ...spec.transfers, mult: spec.transfers.mult * r };
  if (spec.amplify) out.amplify = { ...spec.amplify, mult: 1 + (spec.amplify.mult - 1) * r };
  return out;
}
