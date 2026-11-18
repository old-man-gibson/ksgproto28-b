/**
 * Alchemy: the Alembic, the flasks it makes, weapon oils, and using a flask
 * in and out of a fight. Port of old `systems/alchemy.ts`. The Alembic is a
 * bench of `benches`, registered at module load; the coating is a blow
 * rider of `combat`. See README.md in this folder.
 */
import {
  answer,
  defineCommand,
  defineEvent,
  defineRequest,
  defineSystem,
  handle,
  OK,
  PLAYER,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import { grantAttrXp } from '../attributes';
import benches, {
  benchCrafted,
  consumedParts,
  noveltyKeys,
  recipeKey,
  registerBench,
  type BenchReads,
  type GradedStack,
  type Placement,
} from '../benches';
import combat, { landBurstRequest, monsterSlice, registerBlowRider, sweepRequest, type RiderSlice, type TypedSlice } from '../combat';
import counters, { counterValue } from '../counters';
import items, { itemName } from '../items';
import { feedLine, fillText, logLine, repeatLine } from '../log';
import materials, { grantGraded, MATERIALS, QUALITY_TIERS, takeGraded } from '../materials';
import resources, { healNow, resourceValue, RESOURCES, restoreNow } from '../resources';
import skills, { checkDiscovery, grantSkillXp, skillLevel } from '../skills';
import { statBlockOf } from '../stats';
import statuses, { applyStatus, fireStatusEvent, heldOf, STATUSES, type StatusApplication } from '../statuses';
import world, { SPOTS } from '../world';
import {
  ALCHEMY,
  brewGrade,
  checkBrew,
  FLASK_COOLDOWN,
  knownReagents,
  resolveBrew,
  type BrewedFlask,
  type BrewSpec,
} from './brew';
import { alchemyText, BREW_FORMS, brewForms, brewFormulas, REAGENT_LIST, reagents, TEXT } from './defs';
import { migrations } from './migrations';

export * from './brew';
export * from './defs';

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- slice ----

/** An oil worked into one blade. The old `WeaponCoating`. */
export interface WeaponCoating {
  brew: BrewedFlask;
  weaponUid: number;
  blowsLeft: number;
}

export interface AlchemyState {
  /** Flasks made and not used, in the order made. */
  flasks: BrewedFlask[];
  /** The oil on a blade, or null. */
  coating: WeaponCoating | null;
  /** The tick the shared flask clock opens. The old `useCooldowns.flask`. */
  flaskReady: number;
}

type A = Ctx<AlchemyState>;

const say = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

/** What a bench rule reads for the Alembic. */
export function benchReadsOf(ctx: ReadCtx): BenchReads {
  const c = ctx.read(counters);
  return {
    level: skillLevel(ctx.read(skills), ALCHEMY.skill),
    materials: ctx.read(materials),
    knowsRecipe: (id) => counterValue(c, recipeKey(id)) > 0,
  };
}

// ---- commands and requests ----

/** Drink, apply, coat or throw a flask; its sequence decides which. The old `useFlask`. */
export const useFlask = defineCommand<{ index: number }>('alchemy/use-flask');
/** A flask was used: the doses it granted, whatever its form. `meals` records them as claims. */
export const flaskUsed = defineEvent<{ grants: StatusApplication[] }>('alchemy/flask-used');
/** Work the Alembic once: spend the layout and shelve the flask. The old `brew`. Answered for `benches`. */
export const brewRequest = defineRequest<{ placement: Placement; duration?: number }, boolean>('alchemy/brew');

/** One blow's worth of oil. The old `CoatingBite`. */
export interface CoatingBite {
  name: string;
  typed: RiderSlice[];
  inflicts: StatusApplication[];
  /** True when that was the last blow the coating had in it. */
  exhausted: boolean;
}

/** Spend one blow of the coating on the blade in hand. Null when there is none. The old `spendCoating`. */
export const spendCoatingRequest = defineRequest<void, CoatingBite | null>('alchemy/spend-coating');

registerBench('alchemy', {
  preview: (ctx, placement) => checkBrew(benchReadsOf(ctx), placement),
  craft: brewRequest,
});

// The coating rides each hit of a weapon blow. What one blow spent is kept
// here from `perHit` to `afterBlow`, inside one call of the combat tick.
let blowBite: CoatingBite | null = null;

registerBlowRider('alchemy/coating', {
  perHit: (ctx) => {
    const bite = ctx.request(spendCoatingRequest, undefined);
    if (!bite) return null;
    blowBite = { ...bite, exhausted: bite.exhausted || !!blowBite?.exhausted };
    return bite.typed;
  },
  afterBlow: () => {
    const bite = blowBite;
    blowBite = null;
    if (!bite) return { source: '' };
    return {
      inflicts: bite.inflicts,
      source: bite.name,
      ...(bite.exhausted ? { line: say('oil_used_up', { name: bite.name }) } : {}),
    };
  },
});

// ---- the rules ----

/** The coating on the blade actually in hand. The old `activeCoating`. */
export function activeCoating(
  state: DeepReadonly<AlchemyState>,
  weaponUid: number | undefined,
): { coat: DeepReadonly<WeaponCoating>; spec: BrewSpec } | null {
  const coat = state.coating;
  if (!coat || coat.blowsLeft <= 0) return null;
  if (weaponUid === undefined || weaponUid !== coat.weaponUid) return null;
  return { coat, spec: resolveBrew(coat.brew) };
}

export function flaskCooldownLeft(state: DeepReadonly<AlchemyState>, tick: number): number {
  return Math.max(0, state.flaskReady - tick);
}

/** Whether a flask can be used now, and why not. The old `canUseFlask`. */
export function canUseFlask(ctx: ReadCtx & { tick: number }, state: DeepReadonly<AlchemyState>, index: number): { ok: boolean; reason?: string } {
  const flask = state.flasks[index];
  if (!flask) return { ok: false, reason: say('reason_no_such_flask') };
  const spec = resolveBrew(flask);
  if (spec.form === 'residue') return { ok: false, reason: say('reason_residue') };
  if (spec.form === 'oil' && !ctx.read(items).equipment.weapon) return { ok: false, reason: say('reason_no_weapon') };
  if (BREW_FORMS[spec.form].thrown && !ctx.read(combat).fight) return { ok: false, reason: say('reason_no_target') };
  const left = flaskCooldownLeft(state, ctx.tick);
  if (left > 0) return { ok: false, reason: say('reason_cooldown', { seconds: (left / 10).toFixed(1) }) };
  return { ok: true };
}

/** Work the Alembic once. The old `brew`. */
function brewOnce(ctx: A, placement: Placement): boolean {
  const check = checkBrew(benchReadsOf(ctx), placement);
  if (!check.ok || !check.spec || !check.sequence) {
    if (check.reason) ctx.emit(logLine, { msg: say('locked', { reason: check.reason }), kind: 'danger' });
    return false;
  }
  // Spend the layout; a take that fails puts back what was taken.
  const taken: GradedStack[] = [];
  for (const part of consumedParts(ALCHEMY, placement)) {
    if (ctx.request(takeGraded, { id: part.id, quality: part.quality })) taken.push(part);
    else {
      for (const back of taken) ctx.request(grantGraded, { id: back.id, quality: back.quality });
      return false;
    }
  }
  ctx.state.flasks.push({ steps: check.sequence.map((s) => ({ id: s.id, quality: s.quality })) });

  // A bench manifests the trade it teaches.
  ctx.emit(checkDiscovery, { tags: [ALCHEMY.tag] });
  ctx.emit(grantSkillXp, {
    tags: ['craft', ALCHEMY.tag],
    amount: ALCHEMY.xp * (1 + check.sequence.length * 0.2),
    sourceKey: noveltyKeys(ALCHEMY, placement),
  });
  // Quest objectives hear bench work as the old bus event `craft`.
  ctx.emit(benchCrafted, { discipline: ALCHEMY.id });
  const spec = check.spec;
  ctx.emit(
    logLine,
    repeatLine({
      group: `bench:${ALCHEMY.id}`,
      prefix: TEXT.brewed_prefix,
      tally: [{ label: `${spec.icon} ${spec.name}${check.formula ? ' 📜' : ''}`, qty: 1 }],
      kind: 'item',
    }),
  );
  return true;
}

/** Thrown: a flask goes off on the formation. It never scales with spell power. The old `hurl`. */
function hurl(ctx: A, spec: BrewSpec): void {
  const fight = ctx.read(combat).fight;
  if (!fight) return;
  ctx.emit(feedLine, { text: say('throw', { icon: spec.icon, name: spec.name }) });
  const targets = fight.enemies.map((e) => (e ? { entity: e.entity, name: e.name } : null));
  targets.forEach((target, i) => {
    if (!target) return;
    // The front slot takes the burst; the rest are caught by the edge of it.
    const share = i === 0 ? 1 : 0.5;
    let total = 0;
    const landed: TypedSlice[] = [];
    for (const strike of spec.strikes) {
      const raw = strike.power * share * (0.9 + ctx.rng.next() * 0.2);
      const slice = monsterSlice(statBlockOf(ctx, target.entity), strike.type, spec.name, raw, strike.penetration ?? 0);
      total += slice.dealt;
      landed.push(slice);
      if (slice.dealt > 0) {
        // The flask is its own applier: its penetration was set at the bench.
        for (const app of strike.inflicts ?? []) {
          ctx.request(applyStatus, { entity: target.entity, app, source: spec.name, penetration: strike.penetration ?? 0 });
        }
      }
    }
    // A fume has no blow to land behind: it settles on everyone regardless.
    for (const app of spec.inflicts) {
      ctx.request(applyStatus, { entity: target.entity, app, source: spec.name, penetration: spec.penetration ?? 0 });
    }
    if (total > 0) {
      const dealt = ctx.request(landBurstRequest, { entity: target.entity, slices: landed });
      if (dealt !== null) ctx.emit(feedLine, { text: say('throw_hit', { icon: spec.icon, name: spec.name, target: target.name, dealt }) });
    } else if (spec.inflicts.length) {
      ctx.emit(feedLine, { text: say('throw_lands', { icon: spec.icon, name: spec.name, target: target.name }) });
    }
  });
  ctx.emit(grantSkillXp, { tags: ['combat', 'craft', 'alchemy'], amount: 4 });
  ctx.request(sweepRequest, undefined);
}

/** Work an oil into the blade in hand. One coating at a time. The old `anoint`. */
function anoint(ctx: A, spec: BrewSpec, brew: BrewedFlask): void {
  const weapon = ctx.read(items).equipment.weapon!;
  const had = ctx.state.coating;
  ctx.state.coating = { brew, weaponUid: weapon.uid, blowsLeft: spec.blows ?? 1 };
  ctx.emit(logLine, {
    msg: say('oiled', {
      icon: spec.icon,
      name: spec.name,
      weapon: itemName(weapon),
      blows: spec.blows,
      wiped: had ? TEXT.oil_wiped : TEXT.oil_done,
    }),
    kind: 'action',
  });
}

/** Drunk or worn: everything lands on the alchemist. The old `swallow`. */
function swallow(ctx: A, spec: BrewSpec): void {
  const gained: string[] = [];
  // The cure goes first: a Salve's heal is also treatment, and a heal first
  // would ease a laceration to a bleed that the cure would then close.
  const cured: string[] = [];
  for (const tag of spec.cures) {
    const before = heldOf(ctx.read(statuses), PLAYER).map((s) => s.id);
    ctx.request(fireStatusEvent, { entity: PLAYER, on: 'cure', detail: { tag } });
    const after = new Set(heldOf(ctx.read(statuses), PLAYER).map((s) => s.id));
    for (const id of before) if (!after.has(id)) cured.push(`cured ${STATUSES[id]?.name ?? id}`);
  }
  for (const r of spec.restore) {
    if (r.amount <= 0) continue;
    const before = resourceValue(ctx.read(resources), r.resource);
    // Only the Salve is applied to a wound; a Draught heals as much but closes nothing.
    if (r.resource === 'hp') ctx.request(healNow, { amount: r.amount, kind: spec.form === 'salve' ? 'salve' : 'draught' });
    else ctx.request(restoreNow, { id: r.resource, amount: r.amount });
    const got = Math.round(resourceValue(ctx.read(resources), r.resource) - before);
    if (got > 0) gained.push(`+${got} ${RESOURCES[r.resource].name}`);
  }
  for (const app of spec.grants) {
    const inst = ctx.request(applyStatus, { entity: PLAYER, app, source: spec.name });
    if (inst) gained.push(STATUSES[inst.id]?.name ?? inst.id);
  }
  gained.push(...cured);
  ctx.emit(logLine, {
    msg: say(BREW_FORMS[spec.form].verb === 'Apply' ? 'applied' : 'drank', {
      icon: spec.icon,
      name: spec.name,
      gained: gained.length ? say('gained', { list: gained.join(', ') }) : '',
    }),
    kind: 'action',
  });
}

// ---- view ----

export interface ReagentRow {
  id: string;
  name: string;
  icon: string;
  desc: string;
  minLevel: number;
  known: boolean;
  /** Grades held, best first. */
  grades: { quality: string; qty: number; grade: string; color: string }[];
}

export interface FlaskGroupView {
  /** Index of the first flask of the group; the use command takes it. */
  index: number;
  qty: number;
  steps: string[];
  name: string;
  icon: string;
  form: string;
  formName: string;
  verb: string;
  desc: string;
  grade: string;
  color: string;
  /** Effects as "Label: fact" lines. */
  lines: string[];
  /** Null when it may be used now, else the reason. */
  blocked: string | null;
}

export interface AlchemyView {
  level: number;
  /** The player stands at a spot with an Alembic. */
  atBench: boolean;
  /** Names of the spots that have one. */
  benchSpots: string[];
  /** The Alembic's step slots: id, name, open or the level that opens it. */
  steps: { id: string; name: string; open: boolean; unlockLevel: number }[];
  reagents: ReagentRow[];
  flasks: FlaskGroupView[];
  coating: { name: string; blowsLeft: number } | null;
  /** Seconds left on the shared flask clock, 0 when ready. */
  cooldown: number;
  /** The Alembic's run, if one is going. */
  job: { progress: number; secondsLeft: number; done: number; remaining: number | null } | null;
}

function effectLines(spec: BrewSpec): string[] {
  const lines: string[] = [];
  for (const s of spec.strikes) lines.push(`Damage: ${Math.round(s.power)} ${s.type}`);
  for (const r of spec.restore) lines.push(`Restores: ${Math.round(r.amount)} ${RESOURCES[r.resource]?.name ?? r.resource}`);
  for (const g of spec.grants) lines.push(`Grants: ${STATUSES[g.id]?.name ?? g.id} for ${((g.duration as number) / 10).toFixed(0)}s`);
  for (const i of spec.inflicts) lines.push(`Inflicts: ${STATUSES[i.id]?.name ?? i.id}`);
  for (const c of spec.cures) lines.push(`Clears: ${c}`);
  if (spec.blows !== undefined) lines.push(`Blows: ${spec.blows}`);
  return lines;
}

const BENCH_SPOTS = Object.values(SPOTS).filter((spot) => spot.benches?.includes(ALCHEMY.id));

const alchemy = defineSystem<AlchemyState, AlchemyView>({
  id: 'alchemy',
  version: 1,
  migrations,
  initial: () => ({ flasks: [], coating: null, flaskReady: 0 }),
  content: { reagents, brew_forms: brewForms, brew_formulas: brewFormulas, alchemy_text: alchemyText },

  requests: [
    answer(brewRequest, (ctx, { placement }) => brewOnce(ctx, placement)),
    answer(spendCoatingRequest, (ctx) => {
      const held = activeCoating(ctx.state, ctx.read(items).equipment.weapon?.uid);
      if (!held) return null;
      const coat = ctx.state.coating!;
      const spec = held.spec;
      coat.blowsLeft -= 1;
      const exhausted = coat.blowsLeft <= 0;
      if (exhausted) ctx.state.coating = null;
      return {
        name: spec.name,
        typed: spec.strikes.map((s) => ({
          type: s.type,
          value: s.power,
          source: spec.name,
          ...(s.penetration !== undefined ? { penetration: s.penetration } : {}),
        })),
        inflicts: spec.inflicts,
        exhausted,
      };
    }),
  ],

  commands: [
    handle(useFlask, (ctx, { index }) => {
      const check = canUseFlask(ctx, ctx.state, index);
      if (!check.ok) {
        const reason = check.reason ?? say('reason_no_such_flask');
        ctx.emit(logLine, { msg: say('locked', { reason }), kind: 'danger' });
        return skipped(reason);
      }
      const flask = ctx.state.flasks[index];
      const spec = resolveBrew(flask);
      ctx.state.flasks.splice(index, 1);
      ctx.state.flaskReady = ctx.tick + FLASK_COOLDOWN;
      if (BREW_FORMS[spec.form].thrown) hurl(ctx, spec);
      else if (spec.form === 'oil') anoint(ctx, spec, flask);
      else swallow(ctx, spec);
      ctx.emit(grantAttrXp, { attr: 'int', amount: 1 });
      // The dish slots record the brew's doses (old `Game.useFlask`, `noteForeignDoses`).
      ctx.emit(flaskUsed, { grants: spec.grants.map((g) => ({ ...g })) });
      return OK;
    }),
  ],

  view: (ctx): AlchemyView => {
    const level = skillLevel(ctx.read(skills), ALCHEMY.skill);
    const mats = ctx.read(materials);
    const known = new Set(knownReagents(level).map((r) => r.id));
    const reagentRows: ReagentRow[] = REAGENT_LIST.map((r) => {
      const held = mats.stock[r.id] ?? {};
      const grades = (['s', 'a', 'b', 'c', 'd', 'e', 'f'] as const)
        .filter((q) => (held[q] ?? 0) > 0)
        .map((q) => ({ quality: q, qty: held[q] ?? 0, grade: QUALITY_TIERS[q].name, color: QUALITY_TIERS[q].color }));
      return {
        id: r.id,
        name: MATERIALS[r.id]?.name ?? r.name,
        icon: r.icon,
        desc: r.desc,
        minLevel: r.minLevel ?? 0,
        known: known.has(r.id),
        grades,
      };
    });
    // Identical sequences are grouped, not merged: each flask remembers its steps.
    const groups = new Map<string, FlaskGroupView>();
    ctx.state.flasks.forEach((flask, index) => {
      const key = flask.steps.map((s) => `${s.id}:${s.quality}`).join('>');
      const had = groups.get(key);
      if (had) {
        had.qty += 1;
        return;
      }
      const spec = resolveBrew(flask);
      const form = BREW_FORMS[spec.form];
      const check = canUseFlask(ctx, ctx.state, index);
      const grade = brewGrade(spec);
      groups.set(key, {
        index,
        qty: 1,
        steps: flask.steps.map((s) => MATERIALS[s.id]?.name ?? s.id),
        name: spec.name,
        icon: spec.icon,
        form: spec.form,
        formName: form.name,
        verb: form.verb,
        desc: form.desc,
        grade: QUALITY_TIERS[grade].name,
        color: QUALITY_TIERS[grade].color,
        lines: effectLines(spec),
        blocked: check.ok ? null : (check.reason ?? ''),
      });
    });
    const coated = activeCoating(ctx.state, ctx.read(items).equipment.weapon?.uid);
    const job = ctx.read(benches).job;
    return {
      level,
      atBench: !!SPOTS[ctx.read(world).spot]?.benches?.includes(ALCHEMY.id),
      benchSpots: BENCH_SPOTS.map((s) => s.name),
      steps: ALCHEMY.slots.map((s) => ({ id: s.id, name: s.name, open: (s.unlockLevel ?? 0) <= level, unlockLevel: s.unlockLevel ?? 0 })),
      reagents: reagentRows,
      flasks: [...groups.values()],
      coating: coated ? { name: coated.spec.name, blowsLeft: coated.coat.blowsLeft } : null,
      cooldown: flaskCooldownLeft(ctx.state, ctx.tick) / 10,
      job:
        job && job.discipline === ALCHEMY.id
          ? {
              progress: job.ticksPer > 0 ? Math.min(1, Math.max(0, 1 - Math.max(0, job.ticksLeft) / job.ticksPer)) : 0,
              secondsLeft: Math.max(0, job.ticksLeft) / 10,
              done: job.done,
              remaining: job.remaining,
            }
          : null,
    };
  },
});

export default alchemy;
