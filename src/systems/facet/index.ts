/**
 * The run's unique ability, as FACET documents. Port of old
 * `src/core/facet/` (`host.ts`, `signal.ts`, `quantities.ts`) and the Facet
 * parts of `game.ts`, `state.ts` and the Ability tab. The core itself is not
 * in git (`load.ts`, docs/SETUP.md); without it every command answers
 * `NO_CORE` and every hook returns at once.
 *
 * Tentative (user, 2026-11-20): off by default. Off, no ability can be
 * granted, nothing here runs a step of the core, and the Ability tab is not
 * listed. See README.md in this folder for the switch and for every line
 * outside this folder that the port touched.
 */
import {
  answer,
  defineCommand,
  defineRequest,
  defineSystem,
  handle,
  on,
  OK,
  skipped,
  type Ctx,
  type DeepReadonly,
  type ViewCtx,
} from '../../kernel';
import { flaskUsed } from '../alchemy';
import { attrXpNeeded, registerXpRouter } from '../attributes';
import clock, { TICKS_PER_GAME_MINUTE, totalTicksOf } from '../clock';
import combat, {
  ABILITY_RUN,
  enemyKilled,
  fightClosed,
  fightStarted,
  fightWon,
  registerFightHook,
  registerPlayerAction,
  type ActionCtx,
} from '../combat';
import { consumableUsed } from '../consumables';
import { dishCalories } from '../cooking';
import log, { feedLine, feedSettle, logLine } from '../log';
import { registerDamageWatch } from '../resources';
import { spellCast } from '../spellcraft';
import { ATTRIBUTE_IDS, finalAttributes, type AttributeId } from '../stats';
import statuses, { heldOf, removeStatus, STATUSES } from '../statuses';
import type { FacetCell, FacetDoc } from './facet';
import { bind, carrierPrefix, CORE, NO_CORE, refOfEntity, withCtx, withReads } from './host';
import { migrations } from './migrations';
import { FACET_ACTION, initialFacet, PLAYER_REF, type FacetState } from './state';

export * from './state';
export { CORE, NO_CORE } from './host';
export type { FacetDoc } from './facet';

type C = Ctx<FacetState>;

// ---- commands ----

/** The switch. Off drops the held ability and its carrier statuses. */
export const switchFacet = defineCommand<{ on: boolean }>('facet/switch');
/** Give the player a bank ability, replacing the one held (old `grantFacet`). One ability per run. */
export const grantFacet = defineCommand<{ id: string }>('facet/grant');
/** Pick option `v` of the held ability's choice: Weakest Weapon Master's stance (old `chooseFacetOption`). */
export const chooseOption = defineCommand<{ v: number }>('facet/choose-option');
/** Press an action for the next bar fill, or take the press back: Sun Blast (old `queueFacetAction`). */
export const pressAction = defineCommand<{ key: string }>('facet/press');
/** Take the held ability's evolution branch (old `chooseEvolution`). */
export const chooseEvolution = defineCommand<{ key: string }>('facet/evolve');
/** Set a cell of the held ability to a share of its cap (old `debugSetCell`, the debug panel's rows). */
export const setCell = defineCommand<{ key: string; share: number }>('facet/set-cell');

// ---- requests (the hooks other systems call; each answers inside their handler) ----

/** One fight tick for the ability. The defeat it asked for, if any (old `facetCombatTick`, `fallen`). */
export const fightTick = defineRequest<void, { outcome: 'knocked_out' | 'dead'; cause: string } | null>('facet/fight-tick');
/** The player's bar filled (old `facetSignal('barFill')`). */
export const barFill = defineRequest<void, void>('facet/bar-fill');
/** The pressed action takes this bar fill. True when it was used (old `queuedAct`). */
export const takePressed = defineRequest<void, boolean>('facet/take-pressed');
/** Use an action at a bar fill. False when it is not offered or not ready (old `useFacetAction`). */
export const useAction = defineRequest<{ key: string }, boolean>('facet/use-action');
/** A blow reached the player (old `hitTaken` from `damagePlayer`). */
export const hitTaken = defineRequest<
  { amount: number; blow: number; type: string; attacker: string; self: number; boss: number },
  void
>('facet/hit-taken');
/** XP for an attribute at or past the ceiling. True when the ability took it (old `routeAttrXp`). */
export const routeXp = defineRequest<{ attr: AttributeId; amount: number }, boolean>('facet/route-xp');

// ---- the core, called with this system's context ----

const ctxOf = (doc: FacetDoc) => ({ ref: PLAYER_REF, facet: doc, bindings: {} });

/** Raise an ability event. Free when no ability is held. */
function signal(ctx: C, id: string, detail: Record<string, unknown> = {}): void {
  if (!CORE || !ctx.state.docs.length) return;
  withCtx(ctx, () => Facet.event(id, PLAYER_REF, detail));
}

/** One held document's actions, and whether each can be used now. */
export interface HeldAction {
  /** Its rotation id: `facet:` plus the key. */
  id: string;
  key: string;
  name: string;
  icon: string;
  desc: string;
  /** The cell the Ability tab draws its button beneath; '' for none. */
  under: string;
  ready: boolean;
}

/** The actions of the held documents. Call inside `withCtx` or `withReads`. */
function actionsOf(docs: readonly DeepReadonly<FacetDoc>[]): HeldAction[] {
  return docs.flatMap((doc) =>
    (doc.reading?.actions ?? []).map((a) => ({
      id: FACET_ACTION + a.key,
      key: a.key,
      name: a.name,
      icon: a.icon,
      desc: a.desc ?? '',
      under: a.under ?? '',
      ready: Facet.evalExpr(a.ready, ctxOf(doc as FacetDoc)) > 0,
    })),
  );
}

/** Use an action now: raise `act` for the document to answer (old `useFacetAction`, `fireFacetAction`). */
function useNow(ctx: C, key: string): boolean {
  if (!CORE || !ctx.state.docs.length) return false;
  return withCtx(ctx, () => {
    const action = actionsOf(ctx.state.docs).find((a) => a.key === key && a.ready);
    if (!action) return false;
    Facet.event('act', PLAYER_REF, { action: key });
    ctx.emit(feedLine, { text: `${action.icon} You use ${action.name}.` });
    return true;
  });
}

/** Take every carrier status of a document off the player. */
function dropCarriers(ctx: C, doc: DeepReadonly<FacetDoc>): void {
  const prefix = carrierPrefix(doc);
  const ids = heldOf(ctx.read(statuses))
    .filter((s) => s.id.startsWith(prefix))
    .map((s) => s.id);
  for (const id of ids) ctx.request(removeStatus, { entity: 'player', id });
}

/** The held document that offers an evolution, or undefined. */
function offering(docs: readonly DeepReadonly<FacetDoc>[]): DeepReadonly<FacetDoc> | undefined {
  return docs.find((d) => Array.isArray(d.offer) && d.offer.length > 0);
}

/** Levels `xp` buys from `ceiling` up, each priced like a real attribute level (old `levelsPast`). */
export function levelsPast(ceiling: number, xp: number): number {
  let left = xp;
  let n = 0;
  while (n < 10_000) {
    const need = attrXpNeeded(ceiling + n);
    if (left < need) break;
    left -= need;
    n += 1;
  }
  return n;
}

// ---- hooks registered with other systems at load ----

/** An ability is held and the core is there to run it. A save that holds one in a build without the core keeps it inert. */
const held = (ctx: Pick<ActionCtx, 'read'>) => CORE && ctx.read(facet).docs.length > 0;

registerFightHook('facet', {
  tick: (ctx) => (held(ctx) ? ctx.request(fightTick, undefined) : null),
  barFill: (ctx) => {
    if (held(ctx)) ctx.request(barFill, undefined);
  },
  takeFill: (ctx) => (CORE && ctx.read(facet).queued ? ctx.request(takePressed, undefined) : false),
});

// Ability actions ride the rotation like a spell or a technique, last
// unless the player orders them (old `activeRotation`, rank 50).
registerPlayerAction(FACET_ACTION, {
  rank: 50,
  known: (ctx) => {
    const state = ctx.read(facet);
    if (!CORE || !state.docs.length) return [];
    return state.docs.flatMap((d) => (d.reading?.actions ?? []).map((a) => FACET_ACTION + a.key));
  },
  pick: (ctx, id, slot) => {
    if (slot !== 'attack') return null;
    const state = ctx.read(facet);
    const key = id.slice(FACET_ACTION.length);
    const ready = withReads(ctx, state, () => actionsOf(state.docs).some((a) => a.key === key && a.ready));
    if (!ready) return null;
    return { id, cooldown: 0, usesHands: false, takesFill: (c) => c.request(useAction, { key }) };
  },
});

registerDamageWatch((ctx, hit) => {
  if (!held(ctx)) return;
  const source = hit.source;
  ctx.request(hitTaken, {
    amount: hit.lost,
    blow: source?.thrown ?? hit.lost,
    type: hit.type ?? 'none',
    attacker: refOfEntity(ctx, source?.by),
    self: source?.self ? 1 : 0,
    boss: source?.boss ? 1 : 0,
  });
});

registerXpRouter((ctx, attr, amount) => (amount > 0 && held(ctx) ? ctx.request(routeXp, { attr, amount }) : false));

/** The ceiling a held status sets, or null (old `attrCeiling`). */
function ceilingOf(ctx: C): number | null {
  let cap: number | null = null;
  for (const s of heldOf(ctx.read(statuses))) {
    if (STATUSES[s.id]?.attrCeiling) cap = cap === null ? s.intensity : Math.min(cap, s.intensity);
  }
  return cap;
}

// ---- the view ----

export interface CellReadout {
  key: string;
  label: string;
  icon: string;
  value: number;
  cap: number;
  show: string;
  desc: string;
  /** The cell's `line` hint filled in, or null. */
  line: string | null;
  /** What the bare number is called when a line stands in for it, or null. */
  base: string | null;
  /** Its carrier modifies one of your numbers, so while the value is not zero it acts on you now. */
  acts: boolean;
}

export interface ConditionReadout {
  name: string;
  icon: string;
  desc: string;
  becomes: { name: string; icon: string; desc: string } | null;
}

export interface FacetOption {
  v: number;
  name: string;
  icon: string;
  desc: string;
}

export interface EvolutionChoice {
  key: string;
  name: string;
  icon: string;
  desc: string;
}

export interface FacetReadout {
  name: string;
  icon: string;
  desc: string;
  cells: CellReadout[];
  inputs: { label: string; value: number; show: string }[];
  conditions: ConditionReadout[];
  choice: { label: string; options: FacetOption[]; want: number; active: number } | null;
  evolves: { label: string; at: number; into: EvolutionChoice[] } | null;
  actions: (HeldAction & { queued: boolean })[];
}

export interface FacetView {
  on: boolean;
  /** The core is in this build (`src/systems/facet/core/`, docs/SETUP.md). */
  core: boolean;
  held: FacetReadout[];
  /** The bank: what the Ability tab can grant while the switch is on. */
  bank: EvolutionChoice[];
  /** An evolution waiting on a pick, or null. */
  evolution: { from: string; icon: string; choices: EvolutionChoice[] } | null;
  inFight: boolean;
}

type ClauseShape = { on?: string; do?: unknown[] };
type EffectShape = {
  emit?: string;
  into?: string[];
  defId?: string;
  def?: { id?: string; name?: string; icon?: string; desc?: string; escalatesTo?: string };
};

const effectsOf = (doc: DeepReadonly<FacetDoc>): { on: string; eff: EffectShape }[] =>
  (doc.clauses as readonly ClauseShape[]).flatMap((c) =>
    (c.do ?? []).filter((e): e is EffectShape => !!e && typeof e === 'object').map((eff) => ({ on: c.on ?? '', eff })),
  );

const choiceOf = (key: string): EvolutionChoice => {
  const reading = Facet.bank?.[key]?.reading;
  return { key, name: reading?.name ?? key, icon: reading?.icon ?? '✦', desc: reading?.desc ?? '' };
};

/** A document's description; one saved before its bank entry had one takes the entry of the same name. */
function descOf(doc: DeepReadonly<FacetDoc>): string {
  if (doc.reading?.desc) return doc.reading.desc;
  const name = doc.reading?.name;
  const twin = Object.values(Facet.bank ?? {}).find((b) => name && b.reading?.name === name);
  return twin?.reading?.desc ?? '';
}

function conditionsOf(doc: DeepReadonly<FacetDoc>): ConditionReadout[] {
  const seen = new Map<string, ConditionReadout>();
  for (const { eff } of effectsOf(doc)) {
    if (eff.emit !== 'status') continue;
    const id = eff.def?.id ?? eff.defId;
    if (!id || seen.has(id)) continue;
    const def = eff.def ?? STATUSES[id];
    if (!def) continue;
    const next = eff.def?.escalatesTo ? STATUSES[eff.def.escalatesTo] : undefined;
    seen.set(id, {
      name: def.name ?? id,
      icon: def.icon ?? '',
      desc: def.desc ?? '',
      becomes: next ? { name: next.name, icon: next.icon, desc: next.desc } : null,
    });
  }
  return [...seen.values()];
}

/** Carrier fields that act on a fight with no modifier (the stances, Solar Charge's infusion). */
const ACTING_FIELDS = ['parryContest', 'blowCut', 'pureBlows', 'unarmedRider'];
const hasMods = (status: { [field: string]: unknown } | undefined) =>
  Array.isArray(status?.mods) && (status.mods as unknown[]).length > 0;

/** The old `facetReadouts`, for the Ability tab. */
function readouts(ctx: ViewCtx<FacetState>): FacetReadout[] {
  const queued = ctx.state.queued;
  return ctx.state.docs.map((d) => {
    const doc = d as FacetDoc;
    const ec = ctxOf(doc);
    const cell = (key: string) => doc.cells?.find((c) => c.key === key);
    const evolve = effectsOf(doc).find(({ on: hook, eff }) => eff.emit === 'evolve' && /^cell:\w+:cap$/.test(hook));
    const trigger = evolve && cell(evolve.on.split(':')[1]);
    return {
      name: doc.reading?.name ?? 'Ability',
      icon: doc.reading?.icon ?? '✦',
      desc: descOf(doc),
      cells: (doc.cells ?? [])
        .filter((c): c is FacetCell & { show: string } => !!c.show)
        .map((c) => ({
          key: c.key,
          label: c.label ?? c.key,
          icon: c.icon ?? '',
          value: c.state?.v ?? 0,
          cap: Facet.evalExpr(c.cap, ec),
          show: c.show,
          desc: c.status?.desc ?? '',
          line: c.line ? c.line.text.replace('{v}', String(Math.round((c.state?.v ?? 0) * (c.line.scale ?? 1)))) : null,
          base: c.line?.base ?? null,
          acts: c.carrier !== false && (hasMods(c.status) || ACTING_FIELDS.some((f) => c.status?.[f])),
        })),
      inputs: (doc.reading?.inputs ?? []).map((i) => ({ label: i.label, value: Facet.readQ(PLAYER_REF, i.q).value, show: i.show ?? '' })),
      conditions: conditionsOf(doc),
      choice: doc.reading?.choice
        ? {
            label: doc.reading.choice.label,
            options: doc.reading.choice.options.map((o) => ({ ...o })),
            want: cell(doc.reading.choice.want)?.state?.v ?? 0,
            active: cell(doc.reading.choice.active)?.state?.v ?? 0,
          }
        : null,
      evolves: trigger
        ? {
            label: trigger.label ?? trigger.key,
            at: Facet.evalExpr(trigger.cap, ec),
            into: (evolve.eff.into ?? []).filter((k) => Facet.bank?.[k]).map(choiceOf),
          }
        : null,
      actions: actionsOf([doc]).map((a) => ({ ...a, queued: queued === a.key })),
    };
  });
}

/** Bank entries a grant offers: every entry, branches included, as the old debug rows listed them; none left behind. */
function grantable(): EvolutionChoice[] {
  return Object.keys(Facet.bank ?? {})
    .filter((k) => !LEFT_BEHIND.has(k))
    .map(choiceOf);
}

/** Bank entries this port does not offer: they need a system not ported yet (README, "Left behind"). */
export const LEFT_BEHIND: ReadonlySet<string> = new Set(['shadow_clone']);

/** Whether the navigation lists the Ability tab: while the switch is on. Read by `panel.ts`. */
export function facetListed(views: Readonly<Record<string, unknown>>): boolean {
  return !!(views.facet as FacetView | undefined)?.on;
}

// ---- the system ----

const facet = defineSystem<FacetState, FacetView>({
  id: 'facet',
  version: 1,
  migrations,
  initial: initialFacet,
  // After the sky (weather, 20), before the dish claims (meals, 50): old
  // `Game.advance` ran `tickFacets` after `tickSky` and before `tickMealClaims`.
  order: 30,

  tick: (ctx) => {
    if (!CORE || !ctx.state.docs.length) return;
    // Once per game minute, in a fight or not (old `tickFacets`).
    if (totalTicksOf(ctx.read(clock)) % TICKS_PER_GAME_MINUTE === 0) withCtx(ctx, () => Facet.minute(PLAYER_REF));
    // The ability's floating feed runs settle once no fight is open (old `tickCombat`).
    if (!ctx.read(combat).fight) {
      for (const run of ctx.read(log).floatingFeed) if (run.group.startsWith(ABILITY_RUN)) ctx.emit(feedSettle, { group: run.group });
    }
  },

  commands: [
    handle(switchFacet, (ctx, { on: next }) => {
      if (next && !CORE) return skipped(NO_CORE);
      if (ctx.state.on === next) return skipped(`Facet abilities are already switched ${next ? 'on' : 'off'}`);
      if (!next) {
        for (const doc of ctx.state.docs) dropCarriers(ctx, doc);
        ctx.state.docs = [];
        ctx.state.queued = null;
        ctx.state.fallen = null;
      }
      ctx.state.on = next;
      return OK;
    }),
    handle(grantFacet, (ctx, { id }) => {
      if (!CORE) return skipped(NO_CORE);
      if (!ctx.state.on) return skipped('Facet abilities are switched off');
      if (LEFT_BEHIND.has(id)) return skipped(`"${id}" needs a system that is not ported yet`);
      const template = Facet.bank?.[id];
      if (!template) return skipped(`the bank has no ability "${id}"`);
      for (const doc of ctx.state.docs) dropCarriers(ctx, doc);
      ctx.state.docs = [Facet.hydrate(JSON.parse(JSON.stringify(template)) as FacetDoc)];
      ctx.state.queued = null;
      withCtx(ctx, () => bind(ctx.state, true));
      return OK;
    }),
    handle(chooseOption, (ctx, { v }) => {
      if (!CORE) return skipped(NO_CORE);
      const doc = ctx.state.docs.find((d) => d.reading?.choice);
      const choice = doc?.reading?.choice;
      if (!doc || !choice) return skipped('the held ability offers no choice');
      if (!choice.options.some((o) => o.v === v)) return skipped(`the choice has no option ${v}`);
      const want = doc.cells?.find((c) => c.key === choice.want);
      const active = doc.cells?.find((c) => c.key === choice.active);
      if (!want || !active) return skipped('the held ability lacks its choice cells');
      withCtx(ctx, () => {
        Facet.cellStep(want, 'set', v, ctxOf(doc));
        // Out of a fight there is no bar fill to wait for: it applies at once.
        if (!ctx.read(combat).fight) Facet.cellStep(active, 'set', v, ctxOf(doc));
      });
      return OK;
    }),
    handle(pressAction, (ctx, { key }) => {
      if (!CORE) return skipped(NO_CORE);
      if (!ctx.read(combat).fight) return skipped('no fight is open');
      if (ctx.state.queued === key) {
        ctx.state.queued = null;
        return OK;
      }
      if (!ctx.state.docs.length) return skipped('no ability is held');
      const ready = withCtx(ctx, () => actionsOf(ctx.state.docs).some((a) => a.key === key && a.ready));
      if (!ready) return skipped(`the action "${key}" is not ready`);
      ctx.state.queued = key;
      return OK;
    }),
    handle(chooseEvolution, (ctx, { key }) => {
      if (!CORE) return skipped(NO_CORE);
      const from = offering(ctx.state.docs) as FacetDoc | undefined;
      if (!from) return skipped('no evolution is on offer');
      const next = withCtx(ctx, () => Facet.evolve(from, key));
      if (!next) return skipped(`"${key}" is not on the offer`);
      dropCarriers(ctx, from);
      ctx.state.docs = ctx.state.docs.map((d) => (d === from ? next : d));
      withCtx(ctx, () => bind(ctx.state, true));
      ctx.emit(logLine, {
        msg: `${from.reading?.icon ?? '✦'} ${from.reading?.name ?? 'Your ability'} evolves into ${next.reading?.icon ?? '✦'} ${next.reading?.name ?? key}.`,
        kind: 'info',
      });
      return OK;
    }),
    handle(setCell, (ctx, { key, share }) => {
      if (!CORE) return skipped(NO_CORE);
      const doc = ctx.state.docs.find((d) => d.cells?.some((c) => c.key === key));
      if (!doc) return skipped(`no held ability has the cell "${key}"`);
      withCtx(ctx, () => {
        const cell = doc.cells!.find((c) => c.key === key)!;
        Facet.cellStep(cell, 'set', share * Facet.evalExpr(cell.cap, ctxOf(doc)), ctxOf(doc));
      });
      return OK;
    }),
  ],

  requests: [
    answer(fightTick, (ctx) => {
      if (!CORE || !ctx.state.docs.length) return null;
      withCtx(ctx, () => Facet.tick(PLAYER_REF));
      const fallen = ctx.state.fallen;
      ctx.state.fallen = null;
      return fallen ? { ...fallen } : null;
    }),
    answer(barFill, (ctx) => signal(ctx, 'barFill')),
    answer(takePressed, (ctx) => {
      const pressed = ctx.state.queued;
      if (!pressed) return false;
      ctx.state.queued = null;
      // One that is no longer ready is dropped, and the fill goes on to the rotation.
      return useNow(ctx, pressed);
    }),
    answer(useAction, (ctx, { key }) => useNow(ctx, key)),
    answer(hitTaken, (ctx, detail) => signal(ctx, 'hitTaken', { ...detail })),
    answer(routeXp, (ctx, { attr, amount }) => {
      if (!CORE) return false;
      const cap = ceilingOf(ctx);
      if (cap === null) return false;
      const doc = ctx.state.docs.find((d) => d.cells?.some((c) => c.key === 'past_' + attr));
      if (!doc) return false;
      if (finalAttributes(ctx)[attr] < cap) return false;
      withCtx(ctx, () => {
        const cell = (key: string) => doc.cells!.find((c) => c.key === key);
        Facet.cellStep(cell('past_' + attr)!, 'add', amount, ctxOf(doc));
        const hidden = cell('hidden');
        if (hidden) {
          const levels = ATTRIBUTE_IDS.reduce((n, a) => n + levelsPast(cap, cell('past_' + a)?.state?.v ?? 0), 0);
          if (levels !== hidden.state?.v) Facet.cellStep(hidden, 'set', levels, ctxOf(doc));
        }
      });
      return true;
    }),
  ],

  events: [
    on(fightStarted, (ctx, { payload }) =>
      signal(ctx, 'fightStart', {
        enemies: payload.enemies.length,
        maxLevel: payload.enemies.reduce((n, e) => Math.max(n, e.level), 0),
      }),
    ),
    on(enemyKilled, (ctx, { payload }) => signal(ctx, 'kill', { level: payload.level, boss: payload.boss ? 1 : 0 })),
    on(fightWon, (ctx) => signal(ctx, 'fightWon')),
    on(fightClosed, (ctx, { payload }) => {
      ctx.state.queued = null;
      ctx.state.fallen = null;
      signal(ctx, 'fightEnd', { won: payload.standing.length === 0 ? 1 : 0 });
    }),
    on(flaskUsed, (ctx) => signal(ctx, 'flaskUsed')),
    on(consumableUsed, (ctx, { payload }) => {
      const calories = dishCalories(payload.id, payload.quality);
      if (calories > 0) signal(ctx, 'eat', { calories });
      if (payload.direct) signal(ctx, 'itemUsed');
    }),
    // A miracle cast in a fight (old `miracleSynergy`).
    on(spellCast, (ctx, { payload }) => {
      if (payload.caster === 'player' && payload.school === 'divine' && payload.deity && ctx.read(combat).fight) {
        signal(ctx, 'miracleCast');
      }
    }),
  ],

  view: (ctx): FacetView => {
    const state = ctx.state;
    // A save switched on in a build with the core reads as off in one without it.
    if (!state.on || !CORE) return { on: false, core: CORE, held: [], bank: [], evolution: null, inFight: false };
    return withReads(ctx, state, () => {
      const from = offering(state.docs);
      return {
        on: true,
        core: true,
        held: readouts(ctx),
        bank: grantable(),
        evolution: from
          ? { from: from.reading?.name ?? 'Your ability', icon: from.reading?.icon ?? '✦', choices: (from.offer as string[]).map(choiceOf) }
          : null,
        inFight: !!ctx.read(combat).fight,
      };
    });
  },
});

export default facet;
