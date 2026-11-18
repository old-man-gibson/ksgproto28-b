/**
 * Consumables: using a held material that has a `consumable` record. Cards
 * (a recipe, a word, a technique, a stamp, a votive token) do their one
 * thing; everything else restores, grants and cures, scaled by its grade.
 * Port of old `systems/consumables.ts` without the food half (cooking). See
 * README.md in this folder.
 */
import {
  defineCommand,
  defineSystem,
  handle,
  OK,
  PLAYER,
  registry,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import { wordUnlocked, wordUnlockKey } from '../arcane';
import { DISCIPLINE_LIST, recipeKey } from '../benches';
import combat from '../combat';
import counters, { bumpCounter, counterValue } from '../counters';
import { grantFavorAll, FLOATING_FAVOR_KEY, VOTIVE_BASELINE_KEY } from '../divine';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import martial, { learnRequest, reachablePositions, runeModsOf, techniqueReachable, TECHNIQUES } from '../martial';
import materials, {
  gradesHeld,
  heldOf,
  isGraded,
  MATERIAL_LIST,
  MATERIALS,
  QUALITY_TIERS,
  qualityMult,
  stockOf,
  takeStack,
  type MaterialDef,
  type QualityTier,
} from '../materials';
import { availableMax, healNow, poolHooks, restoreNow } from '../resources';
import { statBlockOf } from '../stats';
import { applyStatus, fireStatusEvent, isHarmful, STATUSES, type StatusApplication } from '../statuses';
import { checkTitles } from '../titles';
import { registerCardSpent } from '../world';
import textData from './content/consumables_text.json';
import { migrations } from './migrations';

const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const consumablesText = registry(textSchema, textData, 'Consumables text');
const say = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

export type ConsumableSpec = NonNullable<MaterialDef['consumable']>;

/** Votive tokens offered so far. */
export const VOTIVE_KEY = 'votive:tokens';
/** What the first votive token gives every god, now and later. */
export const VOTIVE_FIRST_FAVOR = 2;
/** What eating something spoiled does to you. */
export const SPOILED = 'queasy';

// ---- slice ----

export interface ConsumablesState {
  /** Material id to the tick it may be used again. The old `useCooldowns` without the flask key. */
  cooldowns: Record<string, number>;
}

// ---- reads ----

export function consumableSpec(id: string): ConsumableSpec | undefined {
  return MATERIALS[id]?.consumable;
}

/** A card is read or offered for a one-time effect, not eaten. The old `isCard`. */
export function isCard(spec: ConsumableSpec | undefined): boolean {
  return !!spec && !!(spec.teaches || spec.unlocksWord || spec.teachesTechnique || spec.stamps || spec.votive);
}

/**
 * Whether a card's effect has already happened: a recipe known, a word
 * lifted, a technique held in canonical form, a flag set. The votive token
 * never spends. The old `cardSpent`.
 */
export function cardSpent(ctx: ReadCtx, spec: ConsumableSpec | undefined): boolean {
  if (!spec) return false;
  const c = ctx.read(counters);
  if (spec.teaches) return counterValue(c, recipeKey(spec.teaches)) > 0;
  if (spec.unlocksWord) return wordUnlocked(ctx, spec.unlocksWord);
  if (spec.teachesTechnique) return ctx.read(martial).techniques[spec.teachesTechnique]?.form === 'canonical';
  if (spec.stamps) return counterValue(c, spec.stamps) >= 1;
  return false;
}

registerCardSpent((ctx, materialId) => cardSpent(ctx, consumableSpec(materialId)));

/** The name of the dish a recipe card teaches: the bench outcome's, else the material's. The old `recipeName`. */
function recipeName(id: string): string {
  for (const disc of DISCIPLINE_LIST) {
    const outcome = disc.outcomes.find((o) => o.recipe === id);
    if (outcome) return outcome.name;
  }
  return MATERIALS[id]?.name ?? id;
}

/** Units held of a material at a grade; a plain material ignores the grade. */
function heldAt(ctx: ReadCtx, id: string, quality: QualityTier): number {
  const m = ctx.read(materials);
  return isGraded(id) ? stockOf(m, id, quality) : heldOf(m, id);
}

/** Everything usable held, best grade first. The old `heldConsumables`. */
export function heldConsumables(ctx: ReadCtx): { def: MaterialDef; quality: QualityTier; qty: number }[] {
  const m = ctx.read(materials);
  const out: { def: MaterialDef; quality: QualityTier; qty: number }[] = [];
  for (const def of MATERIAL_LIST) {
    if (!def.consumable) continue;
    if (def.graded) {
      for (const g of gradesHeld(m, def.id)) out.push({ def, quality: g.quality, qty: g.qty });
    } else {
      const qty = heldOf(m, def.id);
      if (qty > 0) out.push({ def, quality: 'c', qty });
    }
  }
  return out;
}

export function cooldownLeft(state: DeepReadonly<ConsumablesState>, id: string, tick: number): number {
  return Math.max(0, (state.cooldowns[id] ?? 0) - tick);
}

/** Whether it can be used now, and why not. The old `canUse`, with food refused (cooking). */
export function canUse(
  ctx: ReadCtx & { tick: number },
  state: DeepReadonly<ConsumablesState>,
  id: string,
  quality: QualityTier,
): { ok: boolean; reason?: string } {
  const spec = consumableSpec(id);
  if (!spec) return { ok: false, reason: say('not_usable') };
  if (heldAt(ctx, id, quality) < 1) return { ok: false, reason: say('none_held') };
  if (cardSpent(ctx, spec)) return { ok: false, reason: say(spec.teaches ? 'recipe_known' : 'card_spent') };
  // A technique nothing known leads into is held back, not spent.
  const tech = spec.teachesTechnique ? TECHNIQUES[spec.teachesTechnique] : undefined;
  if (tech) {
    const m = ctx.read(martial);
    if (!techniqueReachable(m, tech, reachablePositions(m, (tid) => runeModsOf(ctx, tid)))) {
      return { ok: false, reason: say('technique_unreachable', { name: tech.name }) };
    }
  }
  // Dishes are eaten between fights only.
  if (spec.food && ctx.read(combat).fight) return { ok: false, reason: say('in_combat') };
  const left = cooldownLeft(state, id, ctx.tick);
  if (left > 0) return { ok: false, reason: say('cooldown', { seconds: (left / 10).toFixed(1) }) };
  if (spec.food) return { ok: false, reason: say('food_not_ported') };
  return { ok: true };
}

// ---- commands ----

/** Use one held consumable. The old `useConsumable`, not queued. */
export const useConsumable = defineCommand<{ id: string; quality?: QualityTier }>('consumables/use');

type K = Ctx<ConsumablesState>;

function useCard(ctx: K, def: MaterialDef, spec: ConsumableSpec): void {
  if (spec.teaches) {
    ctx.emit(bumpCounter, { key: recipeKey(spec.teaches) });
    ctx.emit(logLine, { msg: say('recipe_learned', { name: recipeName(spec.teaches) }), kind: 'skill' });
    return;
  }
  if (spec.unlocksWord) {
    ctx.emit(bumpCounter, { key: wordUnlockKey(spec.unlocksWord) });
    ctx.emit(logLine, { msg: say('word_learned', { word: spec.unlocksWord }), kind: 'skill' });
    return;
  }
  if (spec.teachesTechnique) {
    const tech = TECHNIQUES[spec.teachesTechnique];
    ctx.emit(logLine, { msg: say('technique_learned', { name: tech?.name ?? spec.teachesTechnique }), kind: 'skill' });
    if (tech) ctx.request(learnRequest, { technique: tech.id, form: 'canonical' });
    return;
  }
  if (spec.stamps) {
    ctx.emit(bumpCounter, { key: spec.stamps });
    ctx.emit(logLine, { msg: say('card_used', { icon: def.icon, verb: spec.useVerb ?? 'Used', name: def.name }), kind: 'skill' });
    // A stamped flag is what hidden titles read.
    ctx.emit(checkTitles, undefined);
    return;
  }
  if (spec.votive) {
    const offered = counterValue(ctx.read(counters), VOTIVE_KEY) + 1;
    ctx.emit(bumpCounter, { key: VOTIVE_KEY });
    if (offered === 1) {
      ctx.request(grantFavorAll, { amount: VOTIVE_FIRST_FAVOR });
      ctx.emit(bumpCounter, { key: VOTIVE_BASELINE_KEY, amount: VOTIVE_FIRST_FAVOR });
      ctx.emit(logLine, { msg: say('votive_first', { amount: VOTIVE_FIRST_FAVOR }), kind: 'skill' });
    } else {
      ctx.emit(bumpCounter, { key: FLOATING_FAVOR_KEY });
      ctx.emit(logLine, { msg: say('votive_floating'), kind: 'skill' });
    }
  }
}

function useOne(ctx: K, id: string, quality: QualityTier): void {
  const spec = consumableSpec(id)!;
  const def = MATERIALS[id]!;
  if (isCard(spec)) {
    useCard(ctx, def, spec);
    return;
  }
  const scale = qualityMult(quality);
  const stats = statBlockOf(ctx);
  // Instant: the whole restore, now. Food scaling by the cook is the cooking port.
  for (const r of spec.restore ?? []) {
    const amount = ((r.flat ?? 0) + (r.ofMax ?? 0) * availableMax(stats, poolHooks(ctx), r.resource)) * scale;
    if (amount === 0) continue;
    if (amount > 0 && r.resource === 'hp') ctx.request(healNow, { amount, kind: 'salve' });
    else ctx.request(restoreNow, { id: r.resource, amount });
  }
  // Sustained. A refuse grade does not feed weakly: it makes you ill, resisted.
  if (scale < 0) {
    ctx.request(applyStatus, { entity: PLAYER, app: { id: SPOILED, intensity: -scale }, source: def.name, resist: true });
  } else {
    for (const app of spec.grants ?? []) {
      const granted = STATUSES[app.id];
      const dose: StatusApplication = { ...(app as StatusApplication), intensity: (app.intensity ?? 1) * scale };
      ctx.request(applyStatus, {
        entity: PLAYER,
        app: dose,
        source: def.name,
        ...(granted && isHarmful(granted) ? { resist: true } : {}),
      });
    }
  }
  // Curing is a status event with a tag.
  for (const tag of spec.cures ?? []) ctx.request(fireStatusEvent, { entity: PLAYER, on: 'cure', detail: { tag } });
  if (spec.cooldown) ctx.state.cooldowns[id] = ctx.tick + spec.cooldown;
  ctx.emit(logLine, {
    msg: say('used', { icon: def.icon, verb: spec.useVerb ?? 'Used', grade: QUALITY_TIERS[quality].name, name: def.name }),
    kind: scale < 0 ? 'danger' : 'action',
  });
}

// ---- view ----

export interface ConsumableRow {
  id: string;
  quality: QualityTier;
  name: string;
  icon: string;
  grade: string;
  color: string;
  qty: number;
  verb: string;
  /** Effects as "Label: fact" lines. */
  lines: string[];
  /** Null when it may be used now, else the reason. */
  blocked: string | null;
}

export interface ConsumablesView {
  rows: ConsumableRow[];
}

function effectLines(spec: ConsumableSpec): string[] {
  const lines: string[] = [];
  for (const r of spec.restore ?? []) {
    const parts = [r.flat ? `${r.flat}` : '', r.ofMax ? `${Math.round(r.ofMax * 100)}% of max` : ''].filter(Boolean);
    lines.push(`Restores: ${parts.join(' + ')} ${r.resource}`);
  }
  for (const g of spec.grants ?? []) lines.push(`Grants: ${STATUSES[g.id]?.name ?? g.id}`);
  for (const c of spec.cures ?? []) lines.push(`Clears: ${c}`);
  if (spec.cooldown) lines.push(`Cooldown: ${spec.cooldown / 10}s`);
  if (spec.teaches) lines.push(`Teaches: ${recipeName(spec.teaches)}`);
  if (spec.unlocksWord) lines.push(`Word: ${spec.unlocksWord}`);
  if (spec.teachesTechnique) lines.push(`Technique: ${TECHNIQUES[spec.teachesTechnique]?.name ?? spec.teachesTechnique}`);
  if (spec.votive) lines.push('Offering: favour with the gods');
  if (spec.food) lines.push('Food: eaten through cooking');
  return lines;
}

const consumables = defineSystem<ConsumablesState, ConsumablesView>({
  id: 'consumables',
  version: 1,
  migrations,
  initial: () => ({ cooldowns: {} }),
  content: { consumables_text: consumablesText },

  commands: [
    handle(useConsumable, (ctx, { id, quality = 'c' }) => {
      const check = canUse(ctx, ctx.state, id, quality);
      if (!check.ok) {
        const reason = check.reason ?? say('not_usable');
        ctx.emit(logLine, { msg: say('locked', { reason }), kind: 'danger' });
        return skipped(reason);
      }
      if (ctx.request(takeStack, { id, quality, qty: 1 }) < 1) return skipped(say('none_held'));
      useOne(ctx, id, quality);
      return OK;
    }),
  ],

  view: (ctx): ConsumablesView => ({
    rows: heldConsumables(ctx).map(({ def, quality, qty }) => {
      const spec = def.consumable!;
      const check = canUse(ctx, ctx.state, def.id, quality);
      return {
        id: def.id,
        quality,
        name: def.name,
        icon: def.icon,
        grade: def.graded ? QUALITY_TIERS[quality].name : '',
        color: QUALITY_TIERS[quality].color,
        qty,
        verb: spec.useVerb ?? 'Use',
        lines: effectLines(spec),
        blocked: check.ok ? null : (check.reason ?? ''),
      };
    }),
  }),
});

export default consumables;
