/**
 * Reading a sequence into a brew, and the check of a layout at the Alembic.
 * Pure: reagents in, brew out, no state and no roll. Port of the reading
 * half of old `systems/alchemy.ts`. See README.md for the two laws.
 */
import { checkCraft, DISCIPLINES, type BenchReads, type DisciplineDef, type GradedStack, type Placement } from '../benches';
import { fillText } from '../log';
import { MATERIALS, qualityMult, type QualityTier } from '../materials';
import { RESOURCES, type ResourceId } from '../resources';
import type { DamageType } from '../stats';
import type { StatusApplication } from '../statuses';
import {
  BREW_BASE_DURATION,
  BREW_FORMS,
  BREW_MAX_DURATION,
  formulaFor,
  REAGENT_LIST,
  REAGENTS,
  TEXT,
  type BrewForm,
  type BrewMedium,
  type EssenceSpec,
} from './defs';

export const ALCHEMY: DisciplineDef = DISCIPLINES.alchemy;

// ---- tuning (the old constants, unchanged) ----

/** What a fully dissolved essence returns, relative to an undissolved one. */
export const EXTRACT_YIELD = 1.35;
/** Past this, a brew is a burst rather than something that lingers. */
export const VOLATILE_AT = 1;
/** The share of potency a solvent cannot hold that survives anyway. */
export const SPILL = 0.35;
/** What a second solvent does: weaker, calmer, roomier. */
export const DILUTE = { potency: 0.7, volatility: 0.55 };
/** Volatility left in a fixed brew. */
export const FIX_QUENCH = 0.15;
/** Duration (in base durations) banked per point of volatility quenched. */
export const FIX_BANK = 0.5;
/** What an ignite that catches adds to volatility. */
export const IGNITE_KICK = 0.8;
/** What an ignite that fails leaves of the final potency. */
export const IGNITE_FOUL = 0.82;
/** Potency gained when a clarify removes an essence. */
export const CLARIFY_BOOST = 0.25;
/** Final potency gained when a clarify finds only one essence. */
export const CLARIFY_POLISH = 0.2;
/** A thrown flask's potency, as damage. */
export const BOMB_POWER = 2.4;
/** A coated blade's potency, as damage per blow. */
export const OIL_BITE = 0.3;
/** How many blows a coating lasts: a floor, a slope, and a hard ceiling. */
export const OIL_BLOWS = { base: 3, perPotency: 0.8, cap: 12 };
/** Essence weight to the intensity of what it inflicts, grants, or fumes. */
export const INFLICT_PER_WEIGHT = 0.45;
export const GRANT_PER_WEIGHT = 0.5;
/** Ticks between flasks. */
export const FLASK_COOLDOWN = 60;

// ---- the brew ----

/** One typed strike of a thrown flask or a coated blow. The old `SpellStrike` as alchemy filled it. */
export interface BrewStrike {
  type: DamageType;
  power: number;
  penetration?: number;
  inflicts?: StatusApplication[];
}

/** What a sequence comes out as. The old `BrewSpec`. */
export interface BrewSpec {
  name: string;
  icon: string;
  form: BrewForm;
  medium: BrewMedium;
  potency: number;
  capacity: number;
  volatility: number;
  duration: number;
  essences: { spec: EssenceSpec; weight: number; share: number }[];
  strikes: BrewStrike[];
  inflicts: StatusApplication[];
  restore: { resource: ResourceId; amount: number }[];
  grants: StatusApplication[];
  cures: string[];
  value: number;
  notes: string[];
  summary: string[];
  penetration?: number;
  blows?: number;
}

/** A flask is nothing but its sequence. The old `BrewedFlask`. */
export interface BrewedFlask {
  steps: GradedStack[];
}

/** The sequence a layout spells out: filled steps, in slot order, gaps closed. */
export function sequenceOf(placement: Placement, disc: DisciplineDef = ALCHEMY): GradedStack[] {
  return disc.slots.map((s) => placement[s.id]).filter((s): s is GradedStack => !!s);
}

/** Every reagent the alchemist may put in the alembic at this level. */
export function knownReagents(level: number) {
  return REAGENT_LIST.filter((r) => (r.minLevel ?? 0) <= level);
}

function brewName(form: BrewForm, essences: BrewSpec['essences']): string {
  const kind = BREW_FORMS[form];
  if (form === 'residue') return 'Inert Residue';
  const top = essences[0];
  return top ? `${top.spec.name} ${kind.name}` : `Blank ${kind.name}`;
}

/** Scale a declared application by how loudly its essence reads. */
function scaleApps(
  apps: readonly { id: string; intensity?: number }[] | undefined,
  weight: number,
  per: number,
  duration?: number,
): StatusApplication[] {
  return (apps ?? []).map((a) => {
    const out: StatusApplication = { ...(a as StatusApplication), intensity: (a.intensity ?? 1) * weight * per };
    if (duration !== undefined) out.duration = duration;
    return out;
  });
}

/** A number for the reading: at most two decimals, no trailing zeros. */
const num = (x: number): string => String(Math.round(x * 100) / 100);
/** A multiplier or share as a whole percent. */
const pctOf = (x: number): number => Math.round(x * 100);
const say = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

/** Which forms each base can come out as, for the first step's line. */
const MEDIUM_FORMS: Record<BrewMedium, string> = {
  none: 'Residue',
  water: 'Elixir or Draught',
  oil: 'Salve or Oil',
  spirit: 'Fume or Flask',
};

/** The essence registers each form reads; everything else in it goes unused. */
const FORM_READS: Record<BrewForm, ('type' | 'inflicts' | 'grants' | 'restore' | 'cures')[]> = {
  bomb: ['type', 'inflicts'],
  fume: ['inflicts'],
  oil: ['type', 'inflicts'],
  elixir: ['grants'],
  draught: ['restore'],
  salve: ['restore', 'cures'],
  residue: [],
};

/** The whole outcome table: solvent across, volatility down. */
export function formOf(medium: BrewMedium, volatility: number): BrewForm {
  if (medium === 'none') return 'residue';
  const roused = volatility >= VOLATILE_AT;
  if (medium === 'oil') return roused ? 'oil' : 'salve';
  if (medium === 'water') return roused ? 'draught' : 'elixir';
  return roused ? 'bomb' : 'fume';
}

/**
 * Read a sequence into a brew. Unknown reagents are read as ignored, not
 * refused: legality is `checkBrew`'s job. `notes` has one line per step;
 * `summary` says what the whole adds up to. The old `composeBrew`.
 */
export function composeBrew(steps: readonly GradedStack[]): BrewSpec {
  const notes: string[] = [];
  const summary: string[] = [];
  let medium: BrewMedium = 'none';
  let capacity = 0;
  let potency = 0;
  let volatility = 0;
  let purity = 1;
  let penetration = 0;
  /** Volatility that was quenched rather than spent: what a fix banks. */
  let banked = 0;
  const essences = new Map<string, { spec: EssenceSpec; weight: number }>();

  const n = steps.length;
  steps.forEach((step, i) => {
    const def = REAGENTS[step.id];
    if (!def) {
      notes.push(`${step.id}: ${say('step_unknown')}`);
      return;
    }
    const q = qualityMult(step.quality);
    /** Operators cannot run backwards on a poor grade; they merely do less. */
    const qq = Math.max(0, q);
    const parts: string[] = [];

    // A solvent first: a reagent that is both raises the brew it then acts on.
    if (def.menstruum) {
      const body = def.menstruum.body * q;
      if (medium === 'none') {
        medium = def.menstruum.medium;
        capacity += body;
        parts.push(say('step_base', { base: medium, forms: MEDIUM_FORMS[medium], capacity: num(capacity) }));
      } else {
        potency *= DILUTE.potency;
        volatility *= DILUTE.volatility;
        capacity += body;
        parts.push(
          say('step_dilute', {
            pmult: DILUTE.potency,
            potency: num(potency),
            vmult: DILUTE.volatility,
            volatility: num(volatility),
            capacity: num(capacity),
          }),
        );
      }
    }

    if (def.essence) {
      // Law 1: everything added after this one is time it spends dissolving.
      const after = n - 1 - i;
      const dissolved = after / (after + 1);
      const power = def.essence.power * q;
      const kept = power * (1 - dissolved);
      const gain = power * dissolved * EXTRACT_YIELD + kept;
      potency += gain;
      if (kept !== 0) {
        const held = essences.get(def.essence.id);
        if (held) held.weight += kept;
        else essences.set(def.essence.id, { spec: def.essence, weight: kept });
      }
      parts.push(
        after === 0
          ? say('step_last', { gain: num(gain), potency: num(potency) })
          : say('step_dissolve', {
              after: `${after} step${after === 1 ? '' : 's'}`,
              dissolved: pctOf(dissolved),
              gain: num(gain),
              potency: num(potency),
              kept: 100 - pctOf(dissolved),
            }),
      );
    }

    // Law 2: an operator reads the brew as it stands right now.
    const act = def.act;
    switch (act?.kind) {
      case 'agitate': {
        const added = (act.amount ?? 0) * qq;
        volatility += added;
        if (added > 0) parts.push(say('step_agitate', { amount: num(added), volatility: num(volatility) }));
        break;
      }
      case 'fix': {
        const quenched = Math.max(0, volatility - FIX_QUENCH);
        if (quenched <= 0) {
          parts.push(say('step_fix_idle', { volatility: num(volatility), floor: FIX_QUENCH }));
          break;
        }
        const bank = quenched * Math.max(0.2, q);
        banked += bank;
        const before = volatility;
        volatility = FIX_QUENCH;
        parts.push(say('step_fix', { before: num(before), volatility: num(volatility), bonus: pctOf(bank * FIX_BANK) }));
        break;
      }
      case 'ignite': {
        const before = volatility;
        const needs = act.needs ?? 0;
        if (volatility >= needs) {
          const mult = 1 + ((act.mult ?? 1) - 1) * Math.max(0.2, q);
          potency *= mult;
          volatility += IGNITE_KICK;
          parts.push(
            say('step_ignite', {
              before: num(before),
              needs,
              mult: num(mult),
              potency: num(potency),
              kick: IGNITE_KICK,
              volatility: num(volatility),
            }),
          );
        } else {
          purity *= IGNITE_FOUL;
          parts.push(say('step_ignite_fail', { before: num(before), needs, foul: IGNITE_FOUL }));
        }
        break;
      }
      case 'clarify': {
        if (essences.size >= 2) {
          let weakest: string | null = null;
          let least = Infinity;
          for (const [id, e] of essences) {
            if (e.weight < least) {
              least = e.weight;
              weakest = id;
            }
          }
          const dropped = weakest ? essences.get(weakest)!.spec.name : '';
          if (weakest) essences.delete(weakest);
          const m = 1 + ((act.mult ?? 1) - 1) * qq;
          for (const e of essences.values()) e.weight *= m;
          const boost = 1 + CLARIFY_BOOST * qq;
          potency *= boost;
          parts.push(say('step_clarify', { dropped, mult: num(m), boost: num(boost), potency: num(potency) }));
        } else if (essences.size === 1) {
          const polish = 1 + CLARIFY_POLISH * qq;
          purity *= polish;
          parts.push(say('step_clarify_one', { polish: num(polish) }));
        } else {
          parts.push(say('step_clarify_none'));
        }
        break;
      }
      case 'corrode': {
        const pierce = (act.penetration ?? 0) * qq;
        const mult = 1 + ((act.mult ?? 1) - 1) * qq;
        penetration += pierce;
        potency *= mult;
        purity *= act.purity ?? 1;
        parts.push(
          say('step_corrode', { pierce: pctOf(pierce), mult: num(mult), potency: num(potency), purity: act.purity }),
        );
        break;
      }
    }
    notes.push(`${def.icon} ${def.name}: ${parts.join(' ')}`);
  });

  // Past its capacity a brew spills, and most of the excess is lost.
  const raw = potency;
  if (capacity > 0 && potency > capacity) {
    const over = potency - capacity;
    potency = capacity + over * SPILL;
  }
  const held = potency;
  potency = Math.max(0, potency * purity);

  const ranked = [...essences.values()].filter((e) => e.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = ranked.reduce((s, e) => s + e.weight, 0);
  const list = ranked.map((e) => ({ spec: e.spec, weight: e.weight, share: total > 0 ? e.weight / total : 0 }));

  const form = formOf(medium, volatility);
  const kind = BREW_FORMS[form];
  const duration = Math.min(BREW_MAX_DURATION, Math.round(BREW_BASE_DURATION * (1 + banked * FIX_BANK)));

  // ---- the registers; which one a brew speaks in is decided by its form ----
  const strikes: BrewStrike[] = [];
  const inflicts: StatusApplication[] = [];
  const restore: BrewSpec['restore'] = [];
  const grants: StatusApplication[] = [];
  const cures: string[] = [];

  if (kind.thrown) {
    /** Substances with no element of their own: the bottle, and its weight. */
    let bare = 0;
    for (const e of list) {
      const power = potency * e.share * BOMB_POWER;
      const riders = scaleApps(e.spec.inflicts, e.weight, INFLICT_PER_WEIGHT, form === 'fume' ? duration : undefined);
      if (form === 'fume') {
        inflicts.push(...riders);
        continue;
      }
      if (!e.spec.type) {
        bare += power;
        inflicts.push(...riders);
        continue;
      }
      const strike: BrewStrike = { type: e.spec.type, power };
      if (penetration > 0) strike.penetration = Math.min(0.95, penetration);
      if (riders.length) strike.inflicts = riders;
      strikes.push(strike);
    }
    // Whatever had no element still arrived: a bottle thrown hard.
    if (form === 'bomb') {
      const glass = bare + (list.length === 0 ? potency * BOMB_POWER : 0);
      if (glass > 0) strikes.push({ type: 'bludgeoning', power: glass });
    }
  } else if (form === 'oil') {
    for (const e of list) {
      inflicts.push(...scaleApps(e.spec.inflicts, e.weight, INFLICT_PER_WEIGHT));
      if (!e.spec.type) continue;
      const strike: BrewStrike = { type: e.spec.type, power: potency * e.share * OIL_BITE };
      if (penetration > 0) strike.penetration = Math.min(0.95, penetration);
      strikes.push(strike);
    }
  } else if (kind.sustained) {
    for (const e of list) grants.push(...scaleApps(e.spec.grants, e.weight, GRANT_PER_WEIGHT, duration));
  } else if (form !== 'residue') {
    const pool = new Map<ResourceId, number>();
    for (const e of list) {
      for (const r of e.spec.restore ?? []) pool.set(r.resource, (pool.get(r.resource) ?? 0) + potency * e.share * r.per);
      if (form === 'salve') cures.push(...(e.spec.cures ?? []));
    }
    for (const [resource, amount] of pool) restore.push({ resource, amount });
  }

  const blows =
    form === 'oil'
      ? Math.min(OIL_BLOWS.cap, Math.max(1, Math.round(OIL_BLOWS.base + potency * OIL_BLOWS.perPotency)))
      : undefined;

  // ---- the summary ----
  summary.push(
    medium === 'none'
      ? say('sum_form_none')
      : say('sum_form', {
          base: medium,
          volatility: num(volatility),
          state: say(volatility >= VOLATILE_AT ? 'sum_roused' : 'sum_calm'),
          form: kind.name,
        }),
  );
  if (raw > held) {
    summary.push(say('sum_spill', { raw: num(raw), capacity: num(capacity), kept: pctOf(SPILL), potency: num(held) }));
  }
  if (purity !== 1) summary.push(say('sum_purity', { purity: num(purity), potency: num(potency) }));
  if (kind.sustained) {
    summary.push(
      banked > 0
        ? say('sum_duration_banked', {
            seconds: Math.round(duration / 10),
            base: BREW_BASE_DURATION / 10,
            bonus: pctOf(banked * FIX_BANK),
            cap: BREW_MAX_DURATION / 10,
          })
        : say('sum_duration', { seconds: Math.round(duration / 10) }),
    );
  }
  if (blows !== undefined) {
    summary.push(say('sum_blows', { blows, base: OIL_BLOWS.base, per: OIL_BLOWS.perPotency, cap: OIL_BLOWS.cap }));
  }
  // An essence only speaks in the registers its form reads. Name what is unused.
  if (form !== 'residue') {
    const reads = FORM_READS[form];
    const unused: string[] = [];
    for (const e of list) {
      const lost: string[] = [];
      if (e.spec.type && !reads.includes('type')) lost.push(say('register_damage', { type: e.spec.type }));
      if (e.spec.inflicts?.length && !reads.includes('inflicts')) lost.push(say('register_afflictions'));
      if (e.spec.grants?.length && !reads.includes('grants')) lost.push(say('register_buffs'));
      if (!reads.includes('restore')) {
        for (const r of e.spec.restore ?? []) {
          lost.push(say('register_restore', { resource: RESOURCES[r.resource]?.name ?? r.resource }));
        }
      }
      if (e.spec.cures?.length && !reads.includes('cures')) lost.push(say('register_cures'));
      if (lost.length) unused.push(`${e.spec.name} (${lost.join(', ')})`);
    }
    if (unused.length) {
      summary.push(
        say('sum_unused', { form: `${/^[AEIOU]/.test(kind.name) ? 'an' : 'a'} ${kind.name}`, list: unused.join('; ') }),
      );
    }
  }

  const formula = formulaFor(steps.map((s) => s.id));
  const spec: BrewSpec = {
    name: formula?.name ?? brewName(form, list),
    icon: formula?.icon ?? kind.icon,
    form,
    medium,
    potency,
    capacity,
    volatility,
    duration,
    essences: list,
    strikes,
    inflicts,
    restore,
    grants,
    cures: [...new Set(cures)],
    value: Math.round(4 * potency + 3 * total + 5),
    notes,
    summary,
  };
  if (penetration > 0) spec.penetration = Math.min(0.95, penetration);
  if (blows !== undefined) spec.blows = blows;
  return spec;
}

/** What a flask is. Nothing but its sequence decides it. */
export function resolveBrew(flask: { readonly steps: readonly GradedStack[] }): BrewSpec {
  return composeBrew(flask.steps);
}

/** The grade a brew reads as, for a colour and a word. Display only. The old `brewGrade`. */
export function brewGrade(spec: BrewSpec): QualityTier {
  const scale = spec.potency;
  if (scale >= 18) return 's';
  if (scale >= 12) return 'a';
  if (scale >= 8) return 'b';
  if (scale >= 5) return 'c';
  if (scale >= 2.5) return 'd';
  if (scale > 0) return 'e';
  return 'f';
}

// ---- the check ----

export interface BrewCheck {
  ok: boolean;
  reason?: string;
  spec?: BrewSpec;
  sequence?: GradedStack[];
  /** Set when the sequence is one somebody already wrote down. */
  formula?: string;
}

/**
 * What this layout would brew, without spending anything. The old
 * `previewBrew` over plain inputs: the panel and the request run the same
 * check.
 */
export function checkBrew(reads: BenchReads, placement: Placement, disc: DisciplineDef = ALCHEMY): BrewCheck {
  const sequence = sequenceOf(placement, disc);
  if (sequence.length < 2) return { ok: false, reason: say('reason_too_short') };
  for (const step of sequence) {
    const def = REAGENTS[step.id];
    if (!def) return { ok: false, reason: say('reason_not_a_reagent', { name: MATERIALS[step.id]?.name ?? step.id }) };
    if ((def.minLevel ?? 0) > reads.level) {
      return { ok: false, reason: say('reason_reagent_level', { name: def.name, level: def.minLevel }) };
    }
  }
  const check = checkCraft(reads, disc, placement);
  if (!check.ok) return { ok: false, reason: check.reason };
  const spec = composeBrew(sequence);
  return { ok: true, spec, sequence, formula: formulaFor(sequence.map((s) => s.id))?.id };
}
