/**
 * A resolved spell as "Label: fact" lines, for a panel or a card. A short
 * form of the old `specLines` and `targetLabel` of `ui/lib/format.ts`; the
 * full card of the old interface (condition totals, overgrowth thresholds)
 * is the UI step.
 */
import { TPS } from '../../kernel';
import { STATUSES, type StatusApplication } from '../statuses';
import type { SpellSpec } from './types';

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const secs = (ticks: number): string => `${+(ticks / TPS).toFixed(1)} s`;

function application(a: StatusApplication): string {
  const name = STATUSES[a.id]?.name ?? a.id;
  const intensity = a.intensity ?? 1;
  const base = a.duration === 'permanent' ? null : (a.duration ?? STATUSES[a.id]?.duration);
  const clock = base ? ` for ${secs(base)}` : ' until removed';
  return `${pct(a.chance ?? 1)} ${name}${intensity !== 1 ? ` ×${intensity.toFixed(1)}` : ''}${clock}`;
}

/** Who a working is aimed at. The old `targetLabel`. */
export function targetText(spec: SpellSpec): string {
  if (spec.counter) return 'an enemy casting';
  const outward = spec.strikes.length > 0 || spec.healsEnemy === true || (spec.afflicts?.length ?? 0) > 0;
  const target = outward ? spec.target : 'self';
  return target === 'one' ? 'one enemy' : target === 'others' ? 'every enemy' : 'you';
}

/** Every line of a spell, in a fixed order. */
export function specLines(spec: SpellSpec): string[] {
  const lines = [`Target: ${targetText(spec)}`, `Mana: ${+spec.manaCost.toFixed(2)}`, `Cooldown: ${secs(spec.cooldown)}`];
  if (spec.focusCost) lines.push(`Focus: ${+spec.focusCost.toFixed(2)}`);
  if (spec.staminaCost) lines.push(`Stamina: ${+spec.staminaCost.toFixed(2)}`);
  if (spec.counter) {
    const tuning = Object.entries(spec.counter.tuning).map(([t, n]) => `${t} ${n}`);
    lines.push(`Counter: undo tier ${spec.counter.tiers}${tuning.length ? `, tuned ${tuning.join(', ')}` : ''}`);
  }
  for (const s of spec.strikes) {
    let line = `Strike: ${s.power.toFixed(2)}× spell power ${s.untyped ? 'untyped' : s.type}`;
    if (s.orType && !s.untyped) line += ` or ${s.orType}`;
    if ((s.hits ?? 1) > 1) line += ` ×${s.hits}`;
    if (s.penetration && !s.untyped) line += `, ${pct(s.penetration)} penetration`;
    if (s.critBonus) line += `, ${s.critBonus > 0 ? '+' : '-'}${pct(Math.abs(s.critBonus))} crit chance`;
    if (s.critDamageBonus) line += `, ${s.critDamageBonus > 0 ? '+' : '-'}${pct(Math.abs(s.critDamageBonus))} crit damage`;
    if (s.followUp) line += `, ×${s.followUp} after a landed strike`;
    if (s.altGroup !== undefined) line += ', one alternative rolled per cast';
    if (s.onlyIf) line += s.onlyIf.length ? `, only on ${s.onlyIf.map((i) => STATUSES[i]?.name ?? i).join('/')}` : ', never fires';
    if (s.inflicts?.length) line += `, ${s.inflicts.map(application).join('; ')}`;
    lines.push(line);
  }
  if (spec.splash) lines.push(`Spill: ${pct(spec.splash)} of each strike to a random flanker`);
  if (spec.heal) lines.push(spec.healsEnemy ? `Heals target: ${spec.heal.toFixed(2)}× spell power` : `Heal: ${spec.heal.toFixed(2)}× spell power`);
  if (spec.buff) {
    const mods = spec.buff.mods.map((m) => `${m.stat} ${m.value >= 0 ? '+' : ''}${+m.value.toFixed(3)}${m.op === 'mult' ? ' (mult)' : ''}`);
    lines.push(`Buff: ${spec.buff.name} for ${secs(spec.buff.duration)}, ${mods.join(', ')}`);
  }
  for (const a of spec.grants ?? []) lines.push(`Grants: ${application(a)}`);
  for (const a of spec.afflicts ?? []) lines.push(`Afflicts: ${application(a)}`);
  if (spec.empowered) lines.push(`Empowered: ×${spec.empowered.mult} while any combatant has ${spec.empowered.statuses.join('/')}`);
  if (spec.transfers) lines.push(`Transfers: ${spec.transfers.statuses.join('/')} from you to the target at ×${spec.transfers.mult}`);
  if (spec.amplify) lines.push(`Amplifies: ${spec.amplify.statuses.join('/')} on the target ×${spec.amplify.mult}`);
  if (spec.sure) lines.push('Sure: cannot be evaded');
  return lines;
}
