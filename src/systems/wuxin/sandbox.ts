/**
 * The sandbox of the Wuxin panel: every edit and every line the panel shows,
 * as plain functions. Port of the script of the old `WuxinPanel.svelte`. The
 * panel holds the state (a configuration, the pick, the arrow switch, the
 * sandbox values) and calls these; a test calls the same functions.
 *
 * Nothing here reads or writes the save. The old panel was a sandbox on
 * purpose: there is no player cycle in the game, and the charge and
 * habituation values have no source.
 */
import { ARCANE_WORDS } from '../arcane';
import { SEVERED, type WuxinConfig, type WuxinKind, type WuxinProblem, type WuxinRelation } from './cycle';

/** The classical relation in the lexicon's nouns: seed for wood, stone for earth, iron for metal. */
export const CLASSICAL: WuxinConfig = {
  slots: [
    { element: 'seed', nourishes: 'fire', hinders: 'stone' },
    { element: 'fire', nourishes: 'stone', hinders: 'iron' },
    { element: 'stone', nourishes: 'iron', hinders: 'water' },
    { element: 'iron', nourishes: 'water', hinders: 'seed' },
    { element: 'water', nourishes: 'seed', hinders: 'fire' },
  ],
};

export const clone = (c: WuxinConfig): WuxinConfig => ({ slots: c.slots.map((s) => ({ ...s })) });

/** The sandbox values of the old panel: charge and habituation per slot. Nothing feeds them. */
export const SANDBOX_CHARGE: readonly number[] = [0.2, 0.55, 0.86, 0.35, 0.05];
export const SANDBOX_HABIT: readonly number[] = [0.1, 0.4, 0.72, 0.15, 0.0];

/** Near enough to full that fighting for more is close to wasted. */
export const FULL = 0.8;

export type Preset = 'classical' | 'burst' | 'sustain' | 'split';
export const PRESETS: readonly { id: Preset; label: string }[] = [
  { id: 'classical', label: 'Classical' },
  { id: 'burst', label: 'Burst' },
  { id: 'sustain', label: 'Sustain' },
  { id: 'split', label: 'Split' },
];

/** The shapes the old panel's preset buttons set. */
export function preset(which: Preset): WuxinConfig {
  const next = clone(CLASSICAL);
  if (which === 'burst') {
    // One generative arrow cut: the ring opens into a line.
    next.slots[4].nourishes = null;
  } else if (which === 'sustain') {
    // Nothing in the cycle fights anything else in it.
    for (const s of next.slots) s.hinders = null;
  } else if (which === 'split') {
    // The other closed shape: a feeding pair beside a triangle.
    next.slots[0].nourishes = 'fire';
    next.slots[1].nourishes = 'seed';
    next.slots[2].nourishes = 'iron';
    next.slots[3].nourishes = 'water';
    next.slots[4].nourishes = 'stone';
  }
  return next;
}

/**
 * Swap a slot's element for another noun, its arrows following. When the
 * incoming element is already seated, the two trade places.
 */
export function setElement(cfg: WuxinConfig, index: number, to: string): WuxinConfig {
  const from = cfg.slots[index].element;
  if (from === to) return cfg;
  const next = clone(cfg);
  const other = next.slots.findIndex((s) => s.element === to);
  if (other >= 0) next.slots[other].element = from;
  next.slots[index].element = to;
  for (const s of next.slots) {
    if (other >= 0) {
      if (s.nourishes === from) s.nourishes = to;
      else if (s.nourishes === to) s.nourishes = from;
      if (s.hinders === from) s.hinders = to;
      else if (s.hinders === to) s.hinders = from;
    } else {
      if (s.nourishes === from) s.nourishes = to;
      if (s.hinders === from) s.hinders = to;
    }
  }
  return next;
}

/** Set one arrow from the clause table's list; `∅` cuts it. The list path may leave the cycle illegal. */
export function setArrow(cfg: WuxinConfig, index: number, relation: WuxinRelation, to: string): WuxinConfig {
  const next = clone(cfg);
  next.slots[index][relation] = to === SEVERED ? null : to;
  return next;
}

/**
 * Draw an arrow from slot `from` onto slot `onto`, or cut it when `onto` is
 * null or `from` itself. At most one arrow of each kind may point at an
 * element: drawing onto a taken target displaces whoever held it.
 */
export function connect(cfg: WuxinConfig, from: number, onto: number | null, relation: WuxinRelation): WuxinConfig {
  const next = clone(cfg);
  if (onto === null || onto === from) {
    next.slots[from][relation] = null;
  } else {
    const target = next.slots[onto].element;
    for (const s of next.slots) if (s[relation] === target) s[relation] = null;
    next.slots[from][relation] = target;
  }
  return next;
}

/**
 * A click on a seat: pick it, drop the pick, or draw the picked element's
 * arrow onto it. Answers the new pick and the new configuration.
 */
export function tapSeat(
  cfg: WuxinConfig,
  picked: number | null,
  seat: number,
  aim: WuxinRelation,
): { cfg: WuxinConfig; picked: number | null } {
  if (picked === null) return { cfg, picked: seat };
  if (picked === seat) return { cfg, picked: null };
  return { cfg: connect(cfg, picked, seat, aim), picked: null };
}

// ---------- Reading it back ----------

export const wordOf = (id: string) => ARCANE_WORDS[id];
export const nameOf = (id: string): string => wordOf(id)?.word ?? id;
export const pct = (v: number): string => `${Math.round(v * 100)}%`;

/**
 * What a slot is holding, in plain terms (the old `readout`). Relaxed is out
 * of combat: a full node rests instead of leaking.
 */
export function readout(cfg: WuxinConfig, i: number, charge: number, habit: number, relaxed: boolean): string[] {
  const out: string[] = [];
  const slot = cfg.slots[i];
  const full = charge >= FULL;
  if (full && relaxed) {
    // Resting levels follow the shape: something draining it keeps it a little
    // short of full, and a sustain circle seals at the top with no sink.
    const drainer = cfg.slots.find((s) => s.hinders === slot.element);
    out.push(
      drainer
        ? `At rest, venting through ${nameOf(drainer.element)}. It settles a little short of full and stays there.`
        : `At rest and sealed: nothing vents it, so it stays full. Only something outside the cycle drawing on it can spend it.`,
    );
  } else if (full) {
    out.push(
      slot.nourishes
        ? `Nearly full — most of what arrives passes on to ${nameOf(slot.nourishes)} instead of staying.`
        : `Nearly full, and nothing to pass it to — the surplus leaks as qi deviation.`,
    );
  }
  if (habit >= FULL) {
    // What clears a backlog is an arrow pointing at this element.
    const drainer = cfg.slots.find((s) => s.hinders === slot.element);
    out.push(
      drainer
        ? `You have taken a great deal of this lately; fighting it teaches little. ${nameOf(drainer.element)} is hindering it, which is what clears the backlog.`
        : `You have taken a great deal of this lately; fighting it teaches little — and nothing hinders it, so nothing is clearing the backlog. Point a destructive arrow at it.`,
    );
  }
  if (!out.length) out.push('Room to take more in, and more to learn from it.');
  return out;
}

export const KIND_NOTE: Record<WuxinKind, string> = {
  harmonious:
    'Hinders follows nourishes taken twice in a row (hinders = nourishes squared): the classical relation, whatever elements are in the slots.',
  counterflow:
    'Hinders runs against nourishes: every element hinders the one that feeds it. This is the opposite of harmony and always has the maximum discord.',
  split: 'Generation closes as two separate loops: a feeding pair standing apart from a triangle. The only other closed shape five arrows can make.',
  burst:
    'Generation is cut, so it runs down a line instead of round a ring. The head has nothing feeding it; the tail has nothing to pass to.',
  sustain: 'Nothing in this cycle fights anything else in it.',
  tempered: 'Nourishes is complete, but hinders has a gap: one element hinders nothing.',
  irregular: 'Closed, but no single structure relates the two rings. Legal, but it has no named role yet.',
};

/** What the alignment exponent means, when there is one. */
export const K_NOTE: Record<number, string> = {
  1: 'destruction IS generation — every element feeds and fights the same thing',
  2: 'the classical relation',
  3: 'the pentagram traced the other way — unnamed',
  4: 'generation reversed — feeding your own attacker',
};

export function problemText(p: WuxinProblem): string {
  switch (p.kind) {
    case 'slotCount':
      return `A cycle is five slots — this has ${p.found}.`;
    case 'duplicateElement':
      return `${p.element} is seated twice.`;
    case 'unknownElement':
      return `${p.element} is not a word the lexicon has.`;
    case 'selfArrow':
      return `${p.element} points its ${p.relation} arrow at itself.`;
    case 'danglingArrow':
      return `${p.element} ${p.relation} ${p.target}, which is not in the cycle.`;
    case 'contested':
      return `${p.target} is ${p.relation === 'nourishes' ? 'nourished' : 'hindered'} by ${p.by.join(' and ')} — only one may.`;
  }
}

// ---------- Geometry ----------

export const VIEW = 420;
export const CX = 210;
export const CY = 196;
export const RING = 126;
export const NODE_R = 30;
const HEAD_GAP = 8;
/** Circumferences the charge and habituation arcs are drawn against. */
export const RIM = 2 * Math.PI * NODE_R;
export const INNER_RIM = 2 * Math.PI * (NODE_R - 5);
/** How far a generative arc bows outward, so it reads as the outer circle. */
const GEN_BOW = 30;

export interface Seat {
  x: number;
  y: number;
}

/** The five seats round the ring, the first at the top. */
export function seats(count: number): Seat[] {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return { x: CX + RING * Math.cos(a), y: CY + RING * Math.sin(a) };
  });
}

export function toward(p: Seat, q: Seat, dist: number): Seat {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * dist, y: p.y + (dy / len) * dist };
}

/** Generation bows outward from the centre: the pentagon's own circle. */
export function genPath(a: Seat, b: Seat): string {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const out = toward({ x: CX, y: CY }, mid, Math.hypot(mid.x - CX, mid.y - CY) + GEN_BOW);
  const s = toward(a, out, NODE_R);
  const e = toward(b, out, NODE_R + HEAD_GAP);
  return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${out.x.toFixed(1)} ${out.y.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
}

/** Destruction runs straight across: the pentagram inside the pentagon. */
export function desPath(a: Seat, b: Seat): string {
  const s = toward(a, b, NODE_R);
  const e = toward(b, a, NODE_R + HEAD_GAP);
  return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} L ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
}

export interface Drawn {
  key: string;
  d: string;
  from: number;
}

/** Every drawn arrow of one relation. */
export function edgesOf(cfg: WuxinConfig, relation: WuxinRelation, at: Seat[]): Drawn[] {
  const elements = cfg.slots.map((s) => s.element);
  return cfg.slots.flatMap((slot, i) => {
    const target = slot[relation];
    const a = at[i];
    const j = target ? elements.indexOf(target) : -1;
    const b = j >= 0 ? at[j] : undefined;
    if (!a || !b) return [];
    return [{ key: `${relation === 'nourishes' ? 'g' : 'd'}${i}`, d: relation === 'nourishes' ? genPath(a, b) : desPath(a, b), from: i }];
  });
}
