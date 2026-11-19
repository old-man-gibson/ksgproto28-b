/**
 * The derived space: a shape read as quantities, the name it has earned, and
 * the spell it resolves to. Port of the pure half of the old
 * `systems/psionic.ts` (`axisPoints`, `shapeTotal`, `shapeKey`,
 * `psiBiasFrom`, `deriveShape`, `recogniseShape`, `shapeName`,
 * `describeDerived`, `shapeSpec`). Pure: no state, no context.
 *
 * Every field of the spell is a function of the quantities, never of a raw
 * point count (old `docs/PSIONIC.md` section 1).
 */
import type { SpellSpec, SpellStrike } from '../spellcraft';
import type { DerivedStats } from '../stats';
import type { StatusApplication } from '../statuses';
import {
  PSIONIC,
  PSI_AXIS_IDS,
  PSI_QUANTITIES,
  PSI_RECOGNITION_LIST,
  type PsiAxisId,
  type PsiBias,
  type PsiDerived,
  type PsiQuantityId,
  type PsionicRecognitionDef,
  type PsionicShape,
} from './defs';

export function axisPoints(shape: PsionicShape, axis: PsiAxisId): number {
  return shape[axis] ?? 0;
}

export function shapeTotal(shape: PsionicShape): number {
  return Object.values(shape).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

/** A shape's identity: zeros dropped, axes sorted. The same rule as the spell key. */
export function shapeKey(shape: PsionicShape): string {
  return (Object.entries(shape) as [PsiAxisId, number][])
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([a, n]) => `${a}${n}`)
    .join(',');
}

/** The book's form of a shape: `{ axis, value }` per axis with points, in axis order. */
export function toShapeList(shape: PsionicShape): { axis: string; value: number }[] {
  return PSI_AXIS_IDS.filter((axis) => (shape[axis] ?? 0) > 0).map((axis) => ({ axis, value: shape[axis]! }));
}

/** A shape from the book's (or a monster's) list. */
export function toShape(list: readonly { readonly axis: string; readonly value: number }[]): PsionicShape {
  const shape: Record<string, number> = {};
  for (const { axis, value } of list) shape[axis] = (shape[axis] ?? 0) + value;
  return shape as PsionicShape;
}

/** What the shaper wears, as multipliers on the reading. The old `psiBiasFrom`. */
export function psiBiasFrom(stats: Readonly<DerivedStats>): PsiBias {
  return {
    pressure: stats.psiPressure,
    momentum: stats.psiMomentum,
    inertia: stats.psiInertia,
    acuity: stats.psiAcuity,
    awareness: stats.psiAwareness,
    coherence: stats.psiCoherence,
    purchase: stats.psiPurchase,
  };
}

/** A product of two axes brought back onto the scale points are spent on. */
function onPointScale(product: number): number {
  return Math.sqrt(product);
}

/** A shape read as the quantities it computes to; `bias` applied last. The old `deriveShape`. */
export function deriveShape(shape: PsionicShape, bias?: PsiBias): PsiDerived {
  const p = (axis: PsiAxisId) => axisPoints(shape, axis);
  const pressure = p('force') + p('grip');
  const momentum = p('mass') * p('speed');
  const bare: PsiDerived = {
    pressure,
    momentum,
    inertia: Math.max(0, p('mass') - p('speed')),
    acuity: p('clairvoyance') / Math.max(1, p('reach') + onPointScale(momentum)),
    awareness: p('clairvoyance') * p('reach'),
    coherence: p('space') / Math.max(1, p('force') + p('mass')),
    purchase: p('grip') / (1 + p('speed')),
    inward: p('vitality') / Math.max(1, p('vitality') + pressure),
  };
  if (!bias) return bare;
  for (const id of Object.keys(bare) as PsiQuantityId[]) {
    const mult = (bias as Partial<Record<PsiQuantityId, number>>)[id];
    if (mult !== undefined && mult !== 1) bare[id] = Math.max(0, bare[id] * mult);
  }
  return bare;
}

/** How wide the working reaches. */
function spreadOf(shape: PsionicShape, d: PsiDerived): number {
  return axisPoints(shape, 'reach') + onPointScale(d.awareness) * PSIONIC.awarenessSpread;
}

/** The share of itself a shape keeps rather than spends. Saturating. */
function holdOf(d: PsiDerived): number {
  return d.coherence / (d.coherence + 1);
}

// ---- recognitions ----

function regionValue(key: string, shape: PsionicShape, d: PsiDerived): number {
  return key in d ? d[key as PsiQuantityId] : axisPoints(shape, key as PsiAxisId);
}

function inRegion(r: PsionicRecognitionDef, shape: PsionicShape, d: PsiDerived): boolean {
  return Object.entries(r.region).every(([key, band]) => {
    const value = regionValue(key, shape, d);
    if (band!.min !== undefined && value < band!.min) return false;
    if (band!.max !== undefined && value > band!.max) return false;
    return true;
  });
}

/** Does `a` demand everything `b` does, and at least as much of it? */
function subsumes(a: PsionicRecognitionDef, b: PsionicRecognitionDef): boolean {
  return Object.entries(b.region).every(([key, band]) => {
    const own = (a.region as Record<string, { min?: number; max?: number }>)[key];
    if (!own) return false;
    if (band!.min !== undefined && (own.min ?? -Infinity) < band!.min) return false;
    if (band!.max !== undefined && (own.max ?? Infinity) > band!.max) return false;
    return true;
  });
}

/** Explicit priority, then nesting, then the more constrained region. */
function beats(a: PsionicRecognitionDef, b: PsionicRecognitionDef): boolean {
  const pa = a.priority ?? 0;
  const pb = b.priority ?? 0;
  if (pa !== pb) return pa > pb;
  const nested = subsumes(a, b);
  if (nested !== subsumes(b, a)) return nested;
  return Object.keys(a.region).length > Object.keys(b.region).length;
}

/** The name this shape has earned at this tier, if any. The old `recogniseShape`. */
export function recogniseShape(shape: PsionicShape, tier: number, bias?: PsiBias): PsionicRecognitionDef | undefined {
  const d = deriveShape(shape, bias);
  let best: PsionicRecognitionDef | undefined;
  for (const r of PSI_RECOGNITION_LIST) {
    if ((r.tier ?? 0) > tier || !inRegion(r, shape, d)) continue;
    if (!best || beats(r, best)) best = r;
  }
  return best;
}

// ---- naming an unrecognised shape ----

/** The loudest quantity names a nameless shape; ties go to declaration order. */
const CHARACTERS: {
  noun: string;
  icon: string;
  face?: 'in' | 'out';
  of: (d: PsiDerived, shape: PsionicShape) => number;
}[] = [
  { noun: 'Mending', icon: '💚', face: 'in', of: (_d, s) => axisPoints(s, 'vitality') * 0.8 },
  { noun: 'Rush', icon: '💨', face: 'in', of: (d) => onPointScale(d.momentum) },
  { noun: 'Hammer', icon: '🔨', face: 'out', of: (d) => onPointScale(d.momentum) },
  { noun: 'Needle', icon: '📍', face: 'out', of: (d) => d.acuity },
  { noun: 'Foresight', icon: '🔮', face: 'in', of: (d) => d.acuity },
  { noun: 'Anchor', icon: '🪨', face: 'out', of: (d) => d.inertia },
  { noun: 'Root', icon: '🌱', face: 'in', of: (d) => d.inertia },
  { noun: 'Wave', icon: '🌊', face: 'out', of: (d) => onPointScale(d.awareness) },
  { noun: 'Vigil', icon: '👁️', face: 'in', of: (d) => onPointScale(d.awareness) },
  { noun: 'Fold', icon: '🌀', of: (d) => d.coherence * 2 },
  { noun: 'Vise', icon: '🫳', face: 'out', of: (d) => d.purchase * 0.6 },
  { noun: 'Ward', icon: '💢', face: 'in', of: (d) => d.pressure * 0.5 },
  { noun: 'Spike', icon: '👊', face: 'out', of: (_d, s) => axisPoints(s, 'force') * 0.5 },
];

function characterOf(shape: PsionicShape, d: PsiDerived) {
  let best: (typeof CHARACTERS)[number] | undefined;
  let bestWeight = 0;
  for (const c of CHARACTERS) {
    const share = c.face === 'in' ? d.inward : c.face === 'out' ? 1 - d.inward : 1;
    const weight = c.of(d, shape) * share;
    if (weight > bestWeight) {
      best = c;
      bestWeight = weight;
    }
  }
  return best;
}

/** The generated name when no recognition takes. The old `shapeName`. */
export function shapeName(shape: PsionicShape): string {
  if (shapeTotal(shape) === 0) return 'Empty Mind';
  const character = characterOf(shape, deriveShape(shape));
  return character ? `Mind ${character.noun}` : 'Empty Gesture';
}

/** A nameless shape's description: the quantities it came out as. The old `describeDerived`. */
export function describeDerived(d: PsiDerived): string {
  const parts = (Object.entries(d) as [PsiQuantityId, number][])
    .filter(([, value]) => value > 0)
    .map(([id, value]) => `${PSI_QUANTITIES[id].name} ${value.toFixed(PSI_QUANTITIES[id].decimals)}`);
  if (!parts.length) return 'Reach and Speed only shape how a working arrives. This one has nothing to deliver.';
  return parts.join(' · ');
}

// ---- resolution ----

/**
 * A shape resolved to its spell. `tier` decides only whether the name (and
 * its flat bonus) comes; `bias` is what the shaper wears. The old `shapeSpec`.
 */
export function shapeSpec(shape: PsionicShape, tier = 12, bias?: PsiBias): SpellSpec {
  const p = (axis: PsiAxisId) => axisPoints(shape, axis);
  const curve = PSIONIC.pointCurve;
  const d = deriveShape(shape, bias);

  const drive = onPointScale(d.momentum);
  const spread = spreadOf(shape, d);
  const hold = holdOf(d);
  const outward = 1 - d.inward;
  // Structure keeps your working standing; purchase keeps it on them.
  const worn = Math.round(PSIONIC.inwardDuration(d.coherence));
  const held = Math.round(PSIONIC.adhesion(d.purchase));

  const strikes: SpellStrike[] = [];
  const raw =
    curve(p('force')) * PSIONIC.forcePower + curve(drive) * PSIONIC.momentumPower + curve(p('grip')) * PSIONIC.gripPower;
  const power = raw * outward * (1 - hold * PSIONIC.holdCost);

  if (power > 0) {
    const strike: SpellStrike = {
      type: d.acuity >= PSIONIC.needleAcuity ? 'piercing' : 'bludgeoning',
      power,
    };
    const penetration = Math.min(0.95, d.acuity * (1 + d.coherence) * PSIONIC.penPerAcuity);
    if (penetration > 0) strike.penetration = penetration;

    const inflicts: StatusApplication[] = [];
    if (p('grip') > 0) {
      // No duration: a daze is spent in lost actions, not held for a time.
      inflicts.push({ id: 'dazed', intensity: 1, chance: Math.min(0.95, p('grip') * PSIONIC.gripChance) });
    }
    if (drive > 0) {
      inflicts.push({
        id: 'concussed',
        intensity: 1,
        chance: Math.min(0.9, drive * PSIONIC.concussChance),
        duration: held,
      });
    }
    if (inflicts.length) strike.inflicts = inflicts;
    strikes.push(strike);
  }

  // Biased, so matter can rob a shape of its name.
  const recognition = recogniseShape(shape, tier, bias);
  const character = characterOf(shape, d);
  const spec: SpellSpec = {
    name: recognition?.name ?? shapeName(shape),
    icon: recognition?.icon ?? character?.icon ?? '🧠',
    desc: recognition?.desc ?? describeDerived(d),
    school: 'psionic',
    target: spread >= PSIONIC.reachAll ? 'others' : 'one',
    strikes,
    // Psionics spends focus, never mana.
    manaCost: 0,
    focusCost: PSIONIC.focusBase + shapeTotal(shape) * PSIONIC.focusPerPoint,
    cooldown: Math.max(40, Math.round(PSIONIC.cooldown * Math.pow(PSIONIC.speedCooldown, p('speed')))),
  };
  if (d.acuity >= PSIONIC.sureAcuity) spec.sure = true;
  if (spread > 0 && spread < PSIONIC.reachAll) spec.splash = Math.min(0.75, spread * PSIONIC.reachSplash);
  if (p('vitality') > 0) spec.heal = curve(p('vitality')) * PSIONIC.vitalityHeal * (0.5 + d.inward);

  // What the shape leaves standing on the shaper: each quantity's inward share.
  const grants: StatusApplication[] = [];
  const inwardFace = (id: string, aimed: number, gate: number) => {
    if (aimed >= gate) grants.push({ id, intensity: aimed, duration: worn });
  };
  inwardFace('psionic_haste', drive * d.inward, PSIONIC.hasteMomentum);
  inwardFace('psionic_bracing', d.pressure * d.inward, PSIONIC.braceGate);
  inwardFace('psionic_root', d.inertia * d.inward, PSIONIC.rootInertia);
  inwardFace('psionic_foresight', d.acuity * d.inward, PSIONIC.foresightGate);
  inwardFace('psionic_wide_sight', onPointScale(d.awareness) * d.inward, PSIONIC.wideSightGate);
  // Held mass aimed outward stands in the world as a wall.
  if (d.inertia * outward >= PSIONIC.bulwarkInertia) {
    grants.push({ id: 'kinetic_bulwark', intensity: 1, duration: worn });
  }
  if (grants.length) spec.grants = grants;

  // Sight and structure aimed at them arrive as the working itself.
  const afflicts: StatusApplication[] = [];
  const outwardFace = (id: string, aimed: number, gate: number) => {
    if (aimed >= gate) afflicts.push({ id, intensity: aimed, duration: held });
  };
  outwardFace('psionic_read', d.acuity * outward, PSIONIC.readGate);
  outwardFace('psionic_compression', d.coherence * outward, PSIONIC.compressionGate);
  if (afflicts.length) spec.afflicts = afflicts;

  if (recognition) {
    for (const s of spec.strikes) s.power *= PSIONIC.recognitionBonus;
    if (spec.heal) spec.heal *= PSIONIC.recognitionBonus;
  }
  return spec;
}
