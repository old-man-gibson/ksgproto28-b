/**
 * The harbor band's convoys (floors 11 to 14). Port of old `systems/sea.ts`
 * and `data/sea.data.ts`. See README.md in this folder.
 *
 * Every water in `convoys.json` runs the same clock: convoy n sails during
 * the clock's ticks [3600n, 3600n + 1200) in four legs of 300, then sits in
 * port until the next hour of ticks. Each leg's raiders, monsters and guard
 * are a hash of (water, convoy, leg), so nothing about the schedule is
 * stored (`rules.ts`).
 *
 * A leg resolves on the tick that ends it, and only for a player present at
 * that water: standing on it, not idle, not travelling, not knocked out
 * (`presentAt`). Present while the kernel runs in place, the leg fires the
 * battery, counts the kills made at that water during the leg, and credits
 * crates to `sea:crates:won`. Present while it catches up
 * (`ctx.catchingUp`, docs/KERNEL.md decision 34), the leg fires the battery
 * with no kills and pays 25% of its crates as cargo, never to
 * `sea:crates:won`, so a night away cannot pass a harbor floor's clear.
 *
 * No slice of its own (docs/CONTENT.md decision Q6): the side is the join
 * quest's accept stamp, and the running cargo is in run counters under
 * `sea:<water>:*`.
 */
import { defineSystem, on, registry, s, type Command, type Ctx, type DeepReadonly, type DerivedReads, type SystemDef } from '../../kernel';
import { isIdle } from '../bonus';
import clock, { totalTicksOf } from '../clock';
import { enemyKilled, fightsKey, fightWon } from '../combat';
import counters, { bumpCounter, setCounter, setCounterNow, type CountersState } from '../counters';
import { addGold } from '../gold';
import { checkClears, registerTermText } from '../ladder';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import materials, { grantMaterial, gradesHeld, heldOf, isGraded, MATERIALS, takeGraded, takeMaterial } from '../materials';
import { NPCS } from '../npcs';
import quests, { acceptedKey, acceptQuest, availableQuests } from '../quests';
import skills, { skillLevel } from '../skills';
import world, { selectActivity, SPOTS, type WorldState } from '../world';
import convoysData from './content/convoys.json';
import seaSidesData from './content/sea_sides.json';
import seaTextData from './content/sea_text.json';
import { migrations } from './migrations';
import {
  batteryOf,
  cargoBefore,
  cargoKey,
  dealPrice,
  killKey,
  killLeg,
  legEnding,
  legId,
  legKills,
  legRoll,
  paidAtPort,
  resolveLeg,
  SEA,
  SEA_CRATES_OFFLINE,
  SEA_CRATES_WON,
  SEA_DEAL,
  SEA_FLOWS,
  SEA_MISSION_DONE,
  seaClock,
  type Battery,
  type ConvoyDef,
  type SeaSideDef,
} from './rules';

export * from './rules';
export * from './validation';

// ---- content ----

const range = s.array(s.number({ integer: true, min: 0 }), { help: 'Inclusive [low, high].' });

const seaSides = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    giver: s.ref('npcs', { help: 'The recruiter at a floor 11 berth.' }),
    joinQuest: s.ref('quests', { help: 'Accepting it picks the side for the run.' }),
    flow: s.enum(SEA_FLOWS, { help: 'Which end of the convoy the side stands on.' }),
    prey: s.array(s.ref('monsters'), { help: 'Kills of these on a water count against the leg.' }),
    mission: s.object({ spot: s.ref('spots'), monsterId: s.ref('monsters') }, { help: 'Floor 14: this kill there stamps the floor done.' }),
    desc: s.string(),
  }),
  seaSidesData,
  'Sea sides',
);

const convoys = registry(
  s.object({
    id: s.ref('spots', { help: 'The water the convoy sails past.' }),
    raiders: range,
    monsters: range,
    guard: range,
    cargo: s.array(s.ref('materials'), { help: 'One of these per crate won (merchants are paid gold).' }),
  }),
  convoysData,
  'Convoys',
);

const seaText = registry(textSchema, seaTextData, 'Sea text');
const TEXT = Object.fromEntries((seaTextData as TextRecord[]).map((r) => [r.id, r.text]));

/** The four sides, in the berths' order on the quay. */
export const SEA_SIDE_LIST = seaSidesData as unknown as SeaSideDef[];
export const SEA_SIDES: Record<string, SeaSideDef> = Object.fromEntries(SEA_SIDE_LIST.map((x) => [x.id, x]));
export const CONVOY_LIST = convoysData as unknown as ConvoyDef[];
export const CONVOYS: Record<string, ConvoyDef> = Object.fromEntries(CONVOY_LIST.map((c) => [c.id, c]));

/** The mission spots of floor 14: a kill elsewhere stamps nothing. */
const MISSION_SPOTS = new Set(SEA_SIDE_LIST.map((x) => x.mission.spot));

// The ladder card names the sea's counters in words.
registerTermText(SEA_CRATES_WON, (value) => `${value.toLocaleString('en-US')} crates won`);
registerTermText(SEA_MISSION_DONE, () => 'Your side’s mission boss slain');

// ---- reads ----

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/** True for a spot with a convoy. */
export function isWater(spotId: string): boolean {
  return CONVOYS[spotId] !== undefined;
}

/**
 * The run's side: the one whose join quest has been accepted. Join quests
 * require the other sides' stamps at 0, so at most one holds; a save edited
 * into two gets the first in list order.
 */
export function seaSide(counts: DeepReadonly<CountersState>): SeaSideDef | null {
  for (const side of SEA_SIDE_LIST) {
    if ((counts.counts[acceptedKey(side.joinQuest)] ?? 0) >= 1) return side;
  }
  return null;
}

/** Present at a water: standing on it, doing something, not travelling, not knocked out. */
export function presentAt(ctx: ReadCtx, spotId: string): boolean {
  const w = ctx.read(world);
  return w.spot === spotId && !w.travel && !w.recovering && !isIdle(ctx);
}

// ---- the tick ----

export interface SeaState {}

type C = Ctx<SeaState>;

/**
 * Fire the battery for one leg: what `batteryOf` reports, and the hold pays
 * for it. A graded ration is spent from the lowest grade held.
 */
export function fireBattery(ctx: C): Battery {
  const held = ctx.read(materials);
  const b = batteryOf(held);
  const spend = (id: string) => {
    if (!isGraded(id)) {
      ctx.request(takeMaterial, { id, qty: 1 });
      return;
    }
    const worst = gradesHeld(held, id).pop();
    if (worst) ctx.request(takeGraded, { id, quality: worst.quality, qty: 1 });
  };
  if (b.shot) spend(SEA.shot);
  if (b.powder) spend(SEA.powder);
  if (b.ration) spend(SEA.ration);
  return b;
}

/** One material per crate from the water's row; "Rock Salt x2, Iron Ingot" for the log. */
function payCargo(ctx: C, row: ConvoyDef, n: number): string {
  const got = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const id = row.cargo[ctx.rng.int(row.cargo.length)];
    ctx.request(grantMaterial, { id, qty: 1 });
    got.set(id, (got.get(id) ?? 0) + 1);
  }
  return [...got].map(([id, qty]) => `${MATERIALS[id]?.name ?? id}${qty > 1 ? ` x${qty}` : ''}`).join(', ');
}

/** Pay `n` credited crates: in place to `sea:crates:won` and gold or cargo; catching up as cargo at 25%. */
function credit(ctx: C, side: SeaSideDef, row: ConvoyDef, n: number): void {
  const counts = ctx.read(counters).counts;
  if (ctx.catchingUp) {
    const before = counts[SEA_CRATES_OFFLINE] ?? 0;
    ctx.emit(bumpCounter, { key: SEA_CRATES_OFFLINE, amount: n });
    const paid = Math.floor((before + n) / SEA.offlineShare) - Math.floor(before / SEA.offlineShare);
    payCargo(ctx, row, paid);
    return;
  }
  const total = (counts[SEA_CRATES_WON] ?? 0) + n;
  ctx.emit(bumpCounter, { key: SEA_CRATES_WON, amount: n });
  if (side.flow === 'convoy') {
    const { price } = dealPrice(skillLevel(ctx.read(skills), SEA_DEAL.skill));
    const gold = n * price;
    ctx.request(addGold, { amount: gold, earned: true });
    ctx.emit(logLine, { msg: fillText(TEXT.sold, { crates: n, price, gold, total }), kind: 'loot' });
  } else {
    const list = payCargo(ctx, row, n);
    ctx.emit(logLine, { msg: fillText(TEXT.won, { crates: n, total, list }), kind: 'loot' });
  }
  // After the bump: the clear check reads the new count.
  ctx.emit(checkClears, undefined);
}

function sailLeg(ctx: C, side: SeaSideDef, row: ConvoyDef, convoy: number, leg: number): void {
  const counts = ctx.read(counters);
  const before = cargoBefore(counts, side.flow, row, convoy, leg);
  const kills = ctx.catchingUp ? 0 : legKills(counts, row.id, convoy, leg);
  const battery = fireBattery(ctx);
  const roll = legRoll(row, convoy, leg);
  const out = resolveLeg(side.flow, roll, before, battery.rating, kills);
  const last = leg === SEA.legs - 1;
  const credited = paidAtPort(side.flow) ? (last ? out.cargo.crates : 0) : out.credited;

  ctx.emit(setCounter, { key: cargoKey(row.id, 'convoy'), value: convoy + 1 });
  ctx.emit(setCounter, { key: cargoKey(row.id, 'leg'), value: leg + 1 });
  ctx.emit(setCounter, { key: cargoKey(row.id, 'crates'), value: out.cargo.crates });
  ctx.emit(setCounter, { key: cargoKey(row.id, 'carried'), value: out.cargo.carried });

  const n = leg + 1;
  const legs = SEA.legs;
  const rating = battery.rating;
  const moved = out.moved;
  const { crates, carried } = out.cargo;
  const msg =
    side.flow === 'convoy'
      ? fillText(TEXT.leg_convoy, { leg: n, legs, threat: roll.raiders + roll.monsters, rating, kills, lost: moved, crates })
      : side.flow === 'escort'
        ? fillText(TEXT.leg_escort, { leg: n, legs, monsters: roll.monsters, rating, kills, lost: moved, crates })
        : side.flow === 'raid'
          ? fillText(TEXT.leg_raid, { leg: n, legs, guard: roll.guard, rating, kills, seized: moved })
          : fillText(TEXT.leg_recover, { leg: n, legs, crew: roll.raiders, rating, kills, recovered: moved, carried });
  ctx.emit(logLine, { msg, kind: 'combat' });
  if (credited > 0) credit(ctx, side, row, credited);
}

/**
 * One tick of the sea at the clock's tick `totalTicks`: the leg that ends
 * there, for a player present at a water with a side.
 */
function sailIfDue(ctx: C, totalTicks: number): void {
  const due = legEnding(totalTicks);
  if (!due) return;
  const row = CONVOYS[ctx.read(world).spot];
  if (!row || !presentAt(ctx, row.id)) return;
  const side = seaSide(ctx.read(counters));
  if (!side) return;
  sailLeg(ctx, side, row, due.convoy, due.leg);
}

/**
 * One tick of the sea, reading the clock. The old `tickSea`. Exported so a
 * test can run it alone, on any clock; the game's tick is `tickSeaCached`.
 */
export function tickSea(ctx: C): void {
  sailIfDue(ctx, totalTicksOf(ctx.read(clock)));
}

/**
 * The next kernel tick on which a leg can end, for one sea slice object. A
 * cache, not state: never saved. It is exact because, while a slice object
 * lives, the clock's tick is the only writer of the clock and adds 1 on
 * every kernel tick, as the kernel adds 1 to its own; a load and a new run
 * replace the slice object, and a miss reads the clock again. One entry:
 * another kernel's slice is a miss, never a wrong answer.
 */
let dueFor: object | null = null;
let dueAt = 0;

/**
 * The system's tick: the clock is read only on the kernel tick where the
 * next leg can end (every 300 ticks), not on every tick. Same outcome as
 * `tickSea` on every tick.
 */
function tickSeaCached(ctx: C): void {
  const now = ctx.tick;
  if (ctx.state === dueFor && now < dueAt) return;
  const total = totalTicksOf(ctx.read(clock));
  dueFor = ctx.state;
  dueAt = now + SEA.legTicks - (total % SEA.legTicks);
  sailIfDue(ctx, total);
}

// ---- view ----

export interface SeaAction {
  /** `sail` (start the water's hunt) or `sign` (accept the side's join quest). */
  id: 'sail' | 'sign';
  label: string;
  command: Command;
  /** Why the control is disabled, or null when it can be used. The sail control stays shown while sailing. */
  blocked: string | null;
}

export interface SeaHoldLine {
  id: string;
  name: string;
  icon: string;
  held: number;
  note: string;
}

export interface SeaView {
  /** At a water, a berth or a port onto a water; with a side, anywhere on the harbor floors. */
  shown: boolean;
  side: { id: string; name: string; icon: string; desc: string; flow: string } | null;
  won: number;
  offline: number;
  offlineShare: number;
  /** The convoy at the water the player stands on, once a side is picked. */
  convoy: {
    number: number;
    /** 1-based; null in port. */
    leg: number | null;
    legs: number;
    secondsToNext: number;
    roll: { raiders: number; monsters: number; guard: number } | null;
    kills: number;
    crates: number;
    carried: number;
    present: boolean;
  } | null;
  battery: Battery;
  hold: SeaHoldLine[];
  deal: { price: number; level: number; terms: { id: string; level: number; gold: number; met: boolean }[] } | null;
  /** What the panel offers here, each with the command its button sends. */
  actions: SeaAction[];
}

/** The areas that hold a water or a side's mission: with a side, the readout shows there. */
const HARBOR_AREAS = new Set(
  Object.values(SPOTS)
    .filter((sp) => isWater(sp.id) || MISSION_SPOTS.has(sp.id))
    .map((sp) => sp.areaId),
);
/** Where the pick is made, and the ports that sail. */
const HARBOR_SPOTS = new Set([
  ...SEA_SIDE_LIST.map((x) => NPCS[x.giver]?.spotId).filter((id): id is string => !!id),
  ...Object.values(SPOTS)
    .filter((sp) => sp.connections.some((c) => isWater(c.to)))
    .map((sp) => sp.id),
]);

const HOLD_NOTES: Record<string, string> = {
  [SEA.cannon]: `kept, ${SEA.maxCannons} count`,
  [SEA.shot]: 'one a leg, loads the cannons',
  [SEA.powder]: 'one a leg, +1 hit',
  [SEA.ration]: 'one a leg, +1 morale',
};

const EMPTY_BATTERY = batteryOf({ counts: {}, stock: {} });

/** The view off the harbor: nothing is shown, so nothing is read past the spot and the side. */
const HIDDEN: SeaView = {
  shown: false,
  side: null,
  won: 0,
  offline: 0,
  offlineShare: SEA.offlineShare,
  convoy: null,
  battery: EMPTY_BATTERY,
  hold: [],
  deal: null,
  actions: [],
};

function seaView(ctx: Ctx<SeaState>): SeaView {
  const w: DeepReadonly<WorldState> = ctx.read(world);
  const counts = ctx.read(counters);
  const side = seaSide(counts);
  const spot = SPOTS[w.spot];
  const shown = isWater(w.spot) || HARBOR_SPOTS.has(w.spot) || (!!side && !!spot && HARBOR_AREAS.has(spot.areaId));
  if (!shown) return { ...HIDDEN, actions: [], hold: [] };
  const held = ctx.read(materials);
  const row = CONVOYS[w.spot];
  let convoy: SeaView['convoy'] = null;
  if (row && side) {
    const clockNow = seaClock(totalTicksOf(ctx.read(clock)));
    const leg = clockNow.leg;
    const ticksToNext = leg === null ? SEA.convoyTicks - clockNow.offset : (leg + 1) * SEA.legTicks - clockNow.offset;
    const cargo = cargoBefore(counts, side.flow, row, clockNow.convoy, leg ?? SEA.legs);
    convoy = {
      number: clockNow.convoy + 1,
      leg: leg === null ? null : leg + 1,
      legs: SEA.legs,
      secondsToNext: Math.ceil(ticksToNext / 10),
      roll: leg === null ? null : legRoll(row, clockNow.convoy, leg),
      kills: leg === null ? 0 : legKills(counts, row.id, clockNow.convoy, leg),
      crates: cargo.crates,
      carried: cargo.carried,
      present: presentAt(ctx, row.id),
    };
  }

  const actions: SeaAction[] = [];
  const hunt = spot?.activities.find((a) => a.kind === 'hunt');
  if (convoy && hunt) {
    const blocked = w.recovering
      ? 'Knocked out.'
      : w.travel
        ? 'On the road.'
        : convoy.present
          ? 'Sailing with the convoy.'
          : null;
    actions.push({ id: 'sail', label: hunt.name, command: selectActivity({ activity: hunt.id }), blocked });
  }
  if (!side && !w.travel) {
    for (const x of SEA_SIDE_LIST) {
      const giver = NPCS[x.giver];
      if (giver?.spotId !== w.spot) continue;
      if (!availableQuests(ctx, ctx.read(quests), giver.id).some((q) => q.id === x.joinQuest)) continue;
      actions.push({ id: 'sign', label: `Sign with ${x.name}`, command: acceptQuest({ quest: x.joinQuest }), blocked: null });
    }
  }

  return {
    shown,
    side: side ? { id: side.id, name: side.name, icon: side.icon, desc: side.desc, flow: side.flow } : null,
    won: counts.counts[SEA_CRATES_WON] ?? 0,
    offline: counts.counts[SEA_CRATES_OFFLINE] ?? 0,
    offlineShare: SEA.offlineShare,
    convoy,
    battery: batteryOf(held),
    hold: [SEA.cannon, SEA.shot, SEA.powder, SEA.ration].map((id) => ({
      id,
      name: MATERIALS[id]?.name ?? id,
      icon: MATERIALS[id]?.icon ?? '',
      held: heldOf(held, id),
      note: HOLD_NOTES[id],
    })),
    deal: side?.flow === 'convoy' ? dealPrice(skillLevel(ctx.read(skills), SEA_DEAL.skill)) : null,
    actions,
  };
}

// ---- the declaration ----

const sea = defineSystem<SeaState, SeaView>({
  id: 'sea',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { sea_sides: seaSides, convoys, sea_text: seaText },
  // After combat (10), benches (15) and wards (16): a kill on the tick a leg
  // ends is that leg's. The old `tickSea` ran after the activity.
  order: 17,

  tick: tickSeaCached,

  events: [
    /**
     * Kills on a water count against the leg in progress; the run's mission
     * boss on floor 14 stamps `flag:sea:14:done`. The leg's count is written
     * now (`counters/set-now`): two kills of one tick are two deliveries
     * before either handler's events.
     */
    on(enemyKilled, (ctx, { payload }) => {
      const { site, defId } = payload;
      if (!isWater(site) && !MISSION_SPOTS.has(site)) return;
      const counts = ctx.read(counters);
      const side = seaSide(counts);
      if (!side) return;
      if (defId === side.mission.monsterId && site === side.mission.spot) {
        ctx.emit(setCounter, { key: SEA_MISSION_DONE, value: 1 });
        ctx.emit(checkClears, undefined);
      }
      if (!isWater(site) || !side.prey.includes(defId)) return;
      const at = killLeg(totalTicksOf(ctx.read(clock)));
      if (!at) return;
      const id = legId(at.convoy, at.leg);
      const legKey = killKey(site, 'leg');
      const killsKey = killKey(site, 'kills');
      const fresh = counts.counts[legKey] !== id;
      if (fresh) ctx.request(setCounterNow, { key: legKey, value: id });
      ctx.request(setCounterNow, { key: killsKey, value: (fresh ? 0 : (counts.counts[killsKey] ?? 0)) + 1 });
    }),
    // A won fight on a water counts under `fights:<water>`: the harbor
    // floors' clears read one, and a water has no fight budget, so combat
    // does not count it.
    on(fightWon, (ctx, { payload }) => {
      if (!isWater(payload.site)) return;
      ctx.emit(bumpCounter, { key: fightsKey(payload.site) });
      ctx.emit(checkClears, undefined);
    }),
  ],

  view: seaView,
});

export default sea;
