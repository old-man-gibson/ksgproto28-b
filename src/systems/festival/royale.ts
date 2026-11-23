/**
 * The royale on floor 16. Port of old `systems/royale.ts` (step 4 port C5;
 * old docs/FLOOR_IDEAS.md section 5.3 items 13 and 18, old docs/FESTIVAL.md
 * section 9.2): the field (`royaleField.ts`) stepped once a tick while the
 * player stands on it, with its engagements fought as staged fights at the
 * arena. The player moves by a ranked plan of strategies, or by hand at any
 * time; a plan alone can win.
 *
 * The survivors who reach the player become a staged fight at the arena, at
 * their own levels and with the wounds they carry. Won, they leave the field.
 * A den the player walks into is a staged fight too, with the den's monsters
 * at their pinned levels; won, the den is cleared and its cache opens, and the
 * field does not change. The last survivor is the champion, fought alone:
 * floor 16's boss line, so its fall is the win and nothing else is
 * (`index.ts` counts it).
 *
 * Imports only types from `index.ts`, which imports this file.
 */
import type { Ctx, DeepReadonly, DerivedReads } from '../../kernel';
import { startStaged } from '../combat';
import counters, { counterValue, type CountersState } from '../counters';
import items, { grantItem, giveBack, ITEMS, takeWeapon, type ItemDef, type ItemInstance, type SlotId } from '../items';
import levels, { levelOf } from '../levels';
import { fillText, logLine, type TextRecord } from '../log';
import martial from '../martial';
import resources, { availableMax, healNow, hpFraction, poolHooks } from '../resources';
import { statBlockOf } from '../stats';
import { siteOf, SPOTS } from '../world';
import festivalTextData from './content/festival_text.json';
import issuedWeaponsData from './content/issued_weapons.json';
import type { FestivalRun, FestivalState } from './index';
import {
  CACHE_WEAPONS,
  DEFAULT_ROYALE_PLAN,
  ROYALE_DENS,
  ROYALE_LAYOUT_VERSION,
  ROYALE_PLAN_SLOTS,
  ROYALE_STRATEGIES,
  SURVIVOR_SPECIES,
  type RoyaleCacheDef,
  type RoyaleDenDef,
  type RoyaleField,
  type RoyaleStrategyDef,
} from './royaleData';
import { championFight, clearEngaged, createField, restoreChampion, stepField } from './royaleField';
import { sectionKnown } from './royaleTerrain';
import { ARENA, FESTIVAL_SOURCE, prepShare, SURVIVOR_LEVELS, survivorLevel } from './rules';
import { survivorMember } from './survivorGen';

type F = Ctx<FestivalState>;

const TEXT = Object.fromEntries((festivalTextData as TextRecord[]).map((r) => [r.id, r.text]));
const ISSUED = issuedWeaponsData as { id: string; skill: string; item?: string }[];

function say(ctx: F, id: string, params: Record<string, unknown> | undefined, kind: string): void {
  ctx.emit(logLine, { msg: fillText(TEXT[id], params), kind });
}

// ---- the plan ----

/** The player's ranked strategies: their own, or the default plan. Unknown ids are skipped. The old `royalePlan`. */
export function royalePlan(plan: readonly string[]): RoyaleStrategyDef[] {
  const ids = plan.length ? plan : DEFAULT_ROYALE_PLAN;
  return ids.map((id) => ROYALE_STRATEGIES[id]).filter((s): s is RoyaleStrategyDef => !!s);
}

/** A plan as `festival/set-plan` keeps it: known ids only, no repeats, at most ROYALE_PLAN_SLOTS. The old `setRoyalePlan`. */
export function cleanPlan(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((id) => !!ROYALE_STRATEGIES[id]).slice(0, ROYALE_PLAN_SLOTS);
}

/** Every species' plan, resolved once. */
const SPECIES_PLANS = new Map(
  SURVIVOR_SPECIES.map((s) => [s.id, s.plan.map((id) => ROYALE_STRATEGIES[id]).filter((d): d is RoyaleStrategyDef => !!d)]),
);

const DENS = new Map(ROYALE_DENS.map((d) => [d.id, d]));

// ---- the tick ----

/**
 * One tick of the field while the player stands on it, out of travel and
 * recovery. `now` is the world clock's tick; `fighting` is whether a fight is
 * open. The old `tickRoyale`.
 */
export function tickRoyale(ctx: F, run: FestivalRun, now: number, fighting: boolean): void {
  // A field from before the current layout is replaced whole, but never
  // during a fight: its survivors are in it (old docs/FESTIVAL.md section
  // 9.2a rule 3).
  if (!run.field?.fighters || run.field.layout !== ROYALE_LAYOUT_VERSION) {
    if (fighting) return;
    run.field = createField(() => ctx.rng.next(), run.fieldSeed, now);
  }
  const field = run.field;
  // A fight is staged the tick its survivors are engaged, and a won one takes
  // them off the field, so engaged survivors (or a den fight) with no fight
  // are left over from a fight that closed without a win: they walk again.
  // The old build reached this after a reload mid-fight, which dropped the
  // fight; here a save keeps the fight, so this is the old guard, kept.
  if (!fighting) {
    for (const f of field.fighters) if (f.engaged) delete f.engaged;
    if (field.denFight) delete field.denFight;
  }
  // The royale must be able to end: a field with no one on it gets its champion back.
  restoreChampion(field);
  const stats = statBlockOf(ctx);
  const hooks = poolHooks(ctx);
  const hp = hpFraction(ctx.read(resources), stats, hooks);
  const baseLevel = SURVIVOR_LEVELS.base + Math.round(SURVIVOR_LEVELS.growth * prepShare(run.clock));
  // The counters are read only when the player's plan asks which sections it knows.
  let counts: DeepReadonly<CountersState> | null = null;
  const counter = (key: string): number => counterValue((counts ??= ctx.read(counters)), key);
  const result = stepField(
    field,
    {
      now,
      rng: () => ctx.rng.next(),
      playerFree: !fighting,
      playerHp: hp,
      playerPower: levelOf(ctx.read(levels)),
      playerSpeed: stats.travelSpeed,
      plan: royalePlan(ctx.state.plan),
      planOf: (id) => SPECIES_PLANS.get(id) ?? [],
      knows: (section) => sectionKnown(counter, field, section),
    },
    baseLevel,
  );
  // The spring heals the player out of combat only (the step reports it only then), and only a wound.
  if (result.playerHeal > 0 && hp < 1) {
    ctx.request(healNow, { amount: availableMax(stats, hooks, 'hp') * result.playerHeal, kind: 'idle' });
  }
  for (const cache of result.playerCaches) takeCache(ctx, run, cache);
  if (result.den) {
    startDenFight(ctx, field, result.den);
    return;
  }
  if (result.engaged.length === 0) return;
  // The last survivor is the champion, whatever it walked the field as.
  const last = field.fighters.length === 1;
  ctx.request(startStaged, {
    site: siteOf(ctx, SPOTS[ARENA]),
    // Each survivor fights as its generated build: name, kit, attribute emphasis.
    members: result.engaged.map((f) => survivorMember(field.seed ?? 0, f, survivorLevel(run.clock, f.wins, last), f.hp, last)),
  });
}

// ---- caches and dens ----

type ReadCtx = DerivedReads & Pick<F, 'read'>;

/** The weapon family the door issued: that of the issued item, `unarmed` with bare hands. The old `issuedFamily`. */
function issuedFamily(ctx: ReadCtx, run: DeepReadonly<FestivalRun>): string {
  if (run.issued === undefined) return 'unarmed';
  const held = ctx.read(items);
  const sheathed = ctx.read(martial).sheathed;
  const carried = [...Object.values(held.equipment), ...held.inventory, ...(sheathed ? [sheathed] : [])];
  const item = carried.find((i) => i?.uid === run.issued);
  return ISSUED.find((w) => w.item === item?.defId)?.id ?? 'unarmed';
}

/**
 * The player reaches an open cache (the field has already marked it taken).
 * An item or weapon is lent for the attempt: a plain copy (no affix, no rune
 * slots), worn if its slot is free and otherwise in the pack, its uid
 * recorded in `run.lent` for the attempt's end. A weapon cache lends the
 * weapon of the issued family (CACHE_WEAPONS; bare hands get gauntlets). A
 * lent weapon of the issued family takes the hand from the issued weapon,
 * which goes to the pack (`takesTheHand`), so a plan alone fights with what
 * the field gave it. A heal cache restores a share of max health at once.
 * The old `takeCache`.
 */
function takeCache(ctx: F, run: FestivalRun, cache: RoyaleCacheDef): void {
  const name = `${cache.icon} ${cache.name}`;
  if (cache.heal !== undefined) {
    const max = availableMax(statBlockOf(ctx), poolHooks(ctx), 'hp');
    const healed = Math.round(ctx.request(healNow, { amount: max * cache.heal, kind: 'other' })?.healed ?? 0);
    say(ctx, 'cache_heal', { cache: name, healed }, 'item');
    return;
  }
  const defId = cache.item ?? (cache.weapon ? CACHE_WEAPONS[issuedFamily(ctx, run)] : undefined);
  const def = defId ? ITEMS[defId] : undefined;
  if (!def) {
    say(ctx, 'cache_empty', { cache: name }, 'item');
    return;
  }
  const hand = takesTheHand(ctx, run, def);
  // Old: a plain copy, then the hand, then `wearIfFree` in its slot, else the pack.
  const item = ctx.request(grantItem, { defId: def.id, plain: true, ...(def.slot ? { wear: def.slot as SlotId } : {}) });
  (run.lent ??= []).push(item.uid);
  ctx.touch(FESTIVAL_SOURCE);
  const placed = Object.values(ctx.read(items).equipment).some((i) => i?.uid === item.uid);
  let swapped = false;
  if (hand) {
    // The issued weapon was taken out of the hand for the lent one: to the
    // pack when the lent one is in the hand now, else back into the hand.
    const back = ctx.request(giveBack, { item: hand });
    swapped = placed && back === 'pack';
  }
  const vars = { cache: name, icon: def.icon, item: def.name };
  say(ctx, swapped ? 'cache_swapped' : placed ? 'cache_worn' : 'cache_packed', vars, 'loot');
}

/**
 * A lent weapon of the issued weapon's family goes into the hand in its place
 * (the issued weapon moves to the pack) when the hand still holds the issued
 * weapon and the lent one is a different item. There is no ranking of
 * weapons, so a different item of the same family always counts as the step
 * up: the field's weapons are placed above the starters (CACHE_WEAPONS).
 * Here: when it applies, the issued weapon is taken out of the hand and
 * answered, so the lent one can be worn in its slot; the caller gives it back
 * (to the pack, or to the hand when the lent one could not be wielded). Null
 * when the hand is not taken. The old `takesTheHand`.
 */
function takesTheHand(ctx: F, run: FestivalRun, def: ItemDef): ItemInstance | null {
  const held = ctx.read(items).equipment.weapon;
  if (def.slot !== 'weapon' || !held || held.uid !== run.issued || held.defId === def.id) return null;
  if (ISSUED.find((w) => def.tags.includes(w.id))?.id !== issuedFamily(ctx, run)) return null;
  return ctx.request(takeWeapon, undefined);
}

/** The player walks into a den: its monsters at their pinned levels, a staged fight at the arena. The old `startDenFight`. */
function startDenFight(ctx: F, field: RoyaleField, den: RoyaleDenDef): void {
  field.denFight = den.id;
  say(ctx, 'den_enter', { den: `${den.icon} ${den.name}` }, 'danger');
  ctx.request(startStaged, { site: siteOf(ctx, SPOTS[ARENA]), members: den.foes.map((f) => ({ ...f })) });
}

/**
 * A fight on the field was won. Returns true only when it held the champion,
 * the last survivor: that is the royale won (old docs/FESTIVAL.md section
 * 9.2a rule 2). A den fight clears its den and opens its cache and changes
 * nothing else: no survivor leaves, nothing is counted, the royale goes on. A
 * fight with survivors takes them off the field. Both reset the player's radar
 * clock. The old `royaleFightWon`.
 */
export function royaleFightWon(ctx: F, run: FestivalRun, now: number): boolean {
  const field = run.field;
  if (!field?.fighters) return false;
  field.player.lastFight = now;
  const denId = field.denFight;
  if (denId) {
    delete field.denFight;
    const den = DENS.get(denId);
    field.cleared ??= [];
    if (den && !field.cleared.includes(den.id)) {
      field.cleared.push(den.id);
      say(ctx, 'den_cleared', { den: `${den.icon} ${den.name}` }, 'combat');
    }
    return false;
  }
  const champion = championFight(field);
  clearEngaged(field);
  const left = field.fighters.length;
  if (left > 0) say(ctx, 'field_left', { alive: left }, 'combat');
  return champion;
}
