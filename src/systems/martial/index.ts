/**
 * Techniques: the registries, the ledger of what the player knows, how a
 * technique is learned, practised and slotted, and its execution from a
 * rotation for monsters and the player. Port of the old `systems/martial.ts`
 * and of the technique branches of `systems/combat.ts`. See README.md in
 * this folder: spine port 5 ported the execution, step 3 the rest.
 *
 * This system registers three things with combat at module load: the monster
 * kind `technique`, the player kind `technique:` and the interception of the
 * incoming blow (counter techniques).
 */
import {
  answer,
  defineCommand,
  defineRequest,
  defineSystem,
  handle,
  on,
  OK,
  PLAYER,
  registry,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type Modifier,
  type SystemDef,
} from '../../kernel';
import { grantAttrXp } from '../attributes';
import combat, {
  addBuff,
  damageEnemy,
  enableAction,
  fightClosed,
  registerPositionWatch,
  hook,
  movePlayer,
  playerDamageType,
  playerPosition,
  POSITION_SOURCE,
  registerInterception,
  registerMonsterAction,
  registerPlayerAction,
  stampCooldown,
  takePrevented,
  triggerHolds,
  weaponSource,
  type ActionCtx,
  type ArmedInterception,
  type CombatState,
  type EnemyStrike,
  type Fight,
  type PickedActive,
} from '../combat';
import counters, { conditionsMet, counterChanged, counterValue, setCounter, type Condition } from '../counters';
import items, { giveBack, itemDefOf, runeEffectAt, runeRefKey, takeWeapon, type ItemInstance } from '../items';
import { feedLine, fillText, logLine, textSchema, type DamageReport, type DamageStep, type TextRecord } from '../log';
import { NPCS } from '../npcs';
import prestige, { legacyTechniqueSlots } from '../prestige';
import resources, { availableMax, drawNow, poolHooks, resourceValue, spendNow, type ResourceId } from '../resources';
import skills, { conditionReader, enterSkill, grantSkillXp, SKILLS } from '../skills';
import { statBlockOf, type DerivedStats } from '../stats';
import spellcraft, {
  castCraftedAttack,
  preparedSpells,
  registerHeldSpell,
  resolveSpell,
  resolveSpellFor,
  type SchoolReads,
} from '../spellcraft';
import world from '../world';
import statuses, { heldOf, heldWith, statusDisplacedExit } from '../statuses';
import textData from './content/martial_text.json';
import {
  BASE_TECHNIQUE_SLOTS,
  forkArchetypes,
  MAX_DRILLED,
  NEUTRAL_POSITION,
  positions,
  POSITIONS,
  SPELL_READY_POSITION,
  teachers,
  TEACHERS,
  TECHNIQUE_LIST,
  techniques,
  TECHNIQUES,
  WATCH_KEY_PREFIX,
  type Lesson,
  type PositionDef,
  type TechniqueDef,
  type TechniqueEntry,
  type TechniqueMove,
  type TechniqueState,
} from './defs';
import {
  chosenFork,
  displayName,
  entriesOf,
  entryPositions,
  exitOf,
  forkAvailable,
  forkOptions,
  masteryTier,
  masteryTierName,
  moveOf,
  NO_RUNES,
  repsToNextTier,
  type Held,
  type RuneTechniqueMod,
} from './ladder';
import { migrations } from './migrations';

export * from './defs';
export * from './ladder';

// ---- the slice ----

export type TechniqueForm = TechniqueState['form'];

export interface MartialState {
  /** The ledger: a technique in it is known. The old `state.techniques`. */
  techniques: Record<string, TechniqueState>;
  /** Techniques whose practice counts, at most `MAX_DRILLED`. The old `state.drilling`. */
  drilling: string[];
  /**
   * Where a self-learning or watch count starts, by technique id (`watch:<id>`
   * for the watch count). Follows the counter while the technique cannot be
   * reached. The old `state.learnFrom`.
   */
  learnFrom: Record<string, number>;
  /** A dagger carried concealed. The old `state.sheathed`. */
  sheathed: ItemInstance | null;
  /** The blade a technique dropped in this fight. The old `combat.grounded`. */
  grounded: ItemInstance | null;
  /** The blade a technique left in a target in this fight. The old `combat.impaled`. */
  impaled: ItemInstance | null;
  /** Grimoire uid of the working held in the spell-ready seat. The old `combat.readiedSpell` (step 3: not ported). */
  readiedSpell: number | null;
}

/** States what the position the player stands in does to incoming blows and to dodge. */
export const POSITION_EFFECT_SOURCE = 'martial/position';

/** The counter that opens self-learning (old `unlockKey('martial')`). */
export const MARTIAL_UNLOCK = 'flag:unlock_martial';

/** The counter a school lesson stamps (old `schoolTaughtKey`). */
export function schoolTaughtKey(skillId: string): string {
  return `taught:${skillId}`;
}

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const martialText = registry(textSchema, textData, 'Martial text');

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };
type MCtx = Ctx<MartialState>;
type MState = DeepReadonly<MartialState>;
type CState = DeepReadonly<CombatState>;

const PREFIX = 'technique:';

/** A technique's rotation id, `technique:<id>`. Kept per id: the rotation asks for every known one on every tick of a fight. */
const ROTATION_IDS = new Map<string, string>();
function rotationId(def: TechniqueDef): string {
  let id = ROTATION_IDS.get(def.id);
  if (id === undefined) {
    id = `${PREFIX}${def.id}`;
    ROTATION_IDS.set(def.id, id);
  }
  return id;
}

// ---- the ways in ----

/** The ways a technique declares, with no ledger read. A monster and the content tests read these. The old `declaredEntries`. */
export function declaredEntries(def: TechniqueDef): readonly TechniqueEntry[] {
  return def.from;
}

/** Declared entry positions, flattened. The old `declaredPositions`. */
export function declaredPositions(def: TechniqueDef): string[] | 'any' {
  const entries = declaredEntries(def);
  if (entries.some((e) => e.at === 'any')) return 'any';
  return [...new Set(entries.flatMap((e) => e.at as string[]))];
}

/** The watch counter a monster's use of a technique bumps. The old `watchStatKey`. */
export function watchStatKey(techniqueId: string): string {
  return `${WATCH_KEY_PREFIX}${techniqueId}`;
}

/** The way in that is open now: a position it admits and its own trigger. The old `openEntry`. */
export function openEntry(ctx: ActionCtx, def: TechniqueDef, held: Held, position: string): TechniqueEntry | undefined {
  return entriesOf(def, held).find((e) => (e.at === 'any' || e.at.includes(position)) && triggerHolds(ctx, e.trigger));
}

/** Tags of everything worn, with `unarmed` for an empty weapon hand. The old `equippedTags`. */
function wornTags(ctx: Pick<ReadCtx, 'read'>): Set<string> {
  const worn = ctx.read(items).equipment;
  const tags = new Set<string>();
  for (const item of Object.values(worn)) {
    if (!item) continue;
    for (const t of itemDefOf(item)?.tags ?? []) tags.add(t);
  }
  if (!worn.weapon) tags.add('unarmed');
  return tags;
}

/** Whether the required weapon family is worn. No family: anything. The old `techniqueArmed`. */
export function techniqueArmed(ctx: Pick<ReadCtx, 'read'>, def: TechniqueDef): boolean {
  return !def.family || wornTags(ctx).has(def.family);
}

/** The weapon-state requirement a technique cannot meet, or null. The old `weaponStateGate`. */
export function weaponStateGate(
  ctx: Pick<ReadCtx, 'read'>,
  def: TechniqueDef,
): 'wielded' | 'grounded' | 'sheathed' | 'impaled' | 'readied' | null {
  const m = ctx.read(martial);
  if (def.requiresWielded && !ctx.read(items).equipment.weapon) return 'wielded';
  if (def.requiresGrounded && !m.grounded) return 'grounded';
  if (def.requiresImpaled && !m.impaled) return 'impaled';
  if (def.requiresReadiedSpell && m.readiedSpell === null) return 'readied';
  if (def.requiresSheathed) {
    const tags = m.sheathed ? (itemDefOf(m.sheathed)?.tags ?? []) : [];
    if (!tags.includes(def.requiresSheathed)) return 'sheathed';
  }
  return null;
}

// ---- readied spells (the spell-ready seat) ----

/**
 * The spell a Ready Spell form takes up: the first prepared one, in book
 * order, that has something to deliver (a strike or a heal), is not a
 * counterspell, and can be paid for now. The bare reading, as the old code
 * read it. The old `readyableSpell`.
 */
export function readyableSpell(reads: SchoolReads, stats: Readonly<DerivedStats>): { uid: number; cost: number } | null {
  const mana = resourceValue(reads.read(resources), 'mana');
  for (const spell of preparedSpells(reads.read(spellcraft))) {
    const spec = resolveSpell(spell);
    if (spec.strikes.length === 0 && !spec.heal) continue;
    if (spec.counter) continue;
    const cost = spec.manaCost * stats.manaEff;
    if (mana < cost) continue;
    return { uid: spell.uid, cost };
  }
  return null;
}

/** Whether this prepared working is held in the seat rather than left to cast on its own. The old `spellIsHeld`. */
export function spellIsHeld(reads: Pick<ReadCtx, 'read'>, uid: number): boolean {
  return reads.read(martial).readiedSpell === uid;
}

// ---- runes ----

/**
 * The surgery the runes of the wielded weapon make on a technique, in the
 * runes' canonical order (by key), so the result does not depend on the
 * socket order. The old `weaponTechniqueMods`.
 */
export function runeModsOf(ctx: Pick<ReadCtx, 'read'>, techniqueId: string): readonly RuneTechniqueMod[] {
  const weapon = ctx.read(items).equipment.weapon;
  if (!weapon?.runes?.length) return NO_RUNES;
  const found: { key: string; mod: RuneTechniqueMod }[] = [];
  for (const ref of weapon.runes) {
    for (const m of runeEffectAt(ref, 'weapon')?.techniqueMods ?? []) {
      if (m.technique === techniqueId) found.push({ key: runeRefKey(ref), mod: m as RuneTechniqueMod });
    }
  }
  if (found.length > 1) found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return found.map((f) => f.mod);
}

/** The runes of every technique, looked up once per id. */
function runeLookup(ctx: Pick<ReadCtx, 'read'>): (id: string) => readonly RuneTechniqueMod[] {
  const weapon = ctx.read(items).equipment.weapon;
  if (!weapon?.runes?.length) return () => NO_RUNES;
  const memo = new Map<string, readonly RuneTechniqueMod[]>();
  return (id) => {
    let mods = memo.get(id);
    if (!mods) memo.set(id, (mods = runeModsOf(ctx, id)));
    return mods;
  };
}

// ---- knowing ----

/** Known techniques in registry order. The old `knownTechniques`. */
export function knownTechniques(state: MState): TechniqueDef[] {
  if (!hasAny(state.techniques)) return [];
  return TECHNIQUE_LIST.filter((t) => !!state.techniques[t.id]);
}

function hasAny(record: DeepReadonly<Record<string, unknown>>): boolean {
  for (const _ in record) return true;
  return false;
}

export function techniqueForm(state: MState, id: string): TechniqueForm | undefined {
  return state.techniques[id]?.form;
}

export function techniqueExecutions(state: MState, id: string): number {
  return state.techniques[id]?.executions ?? 0;
}

/** Whether the body could hold the technique: the gate on learning it. The old `eligibleToLearn`. */
export function eligibleToLearn(ctx: ReadCtx, def: TechniqueDef): boolean {
  return !def.unlock || conditionsMet(conditionReader(ctx), def.unlock as Condition[]);
}

/**
 * The skill a technique shows under: its home skill when held, else the first
 * skill its eligibility names that is held, else fighting. The old `techniqueHomeSkill`.
 */
export function techniqueHomeSkill(ctx: Pick<ReadCtx, 'read'>, def: TechniqueDef): string {
  const held = ctx.read(skills).skills;
  if (def.skill && held[def.skill]) return def.skill;
  for (const cond of def.unlock ?? []) if (cond.type === 'skill' && cond.id && held[cond.id]) return cond.id;
  return 'fighting';
}

/** Known techniques under a skill, in registry order. The old `techniquesUnderSkill`. */
export function techniquesUnderSkill(ctx: Pick<ReadCtx, 'read'>, skillId: string): TechniqueDef[] {
  return knownTechniques(ctx.read(martial)).filter((t) => techniqueHomeSkill(ctx, t) === skillId);
}

/** Every technique a family selection would show: the universal ones and those of the families. The old `techniquesForFamilies`. */
export function techniquesForFamilies(families: readonly string[]): TechniqueDef[] {
  return TECHNIQUE_LIST.filter((t) => !t.family || families.includes(t.family));
}

/** The `technique.<id>` trigger subjects the picker offers: the known techniques only. The old `visible` of `TECHNIQUE_SUBJECTS`. */
export function visibleTechniqueSubjects(state: MState): string[] {
  return knownTechniques(state).map((t) => `technique.${t.id}`);
}

// ---- slots and the bench ----

/** Benched: known and switched off. The bench is the player's trigger switch. The old `techniqueBenched`. */
export function techniqueBenched(c: CState, id: string): boolean {
  return c.triggers[`${PREFIX}${id}`]?.enabled === false;
}

/** In a slot: known and not benched. The old `techniqueSlotted`. */
export function techniqueSlotted(m: MState, c: CState, id: string): boolean {
  return !!m.techniques[id] && !techniqueBenched(c, id);
}

/** Slotted techniques in rotation order: the stored order, then the registry. The old `slottedTechniques`. */
export function slottedTechniques(m: MState, c: CState): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id) && TECHNIQUES[id] && techniqueSlotted(m, c, id)) out.push(id);
  };
  for (const entry of c.rotation) if (entry.startsWith(PREFIX)) add(entry.slice(PREFIX.length));
  for (const def of TECHNIQUE_LIST) add(def.id);
  return out;
}

/** How many techniques the rotation holds: drill slots, plus 3, plus the prestige boon. The old `techniqueSlots`. */
export function techniqueSlots(ctx: Pick<ReadCtx, 'read'>): number {
  return MAX_DRILLED + BASE_TECHNIQUE_SLOTS + legacyTechniqueSlots(ctx.read(prestige));
}

/** Bench a technique; its drill stops with it. The old `benchTechnique`. */
function bench(ctx: MCtx, id: string): void {
  ctx.request(enableAction, { id: `${PREFIX}${id}`, enabled: false });
  if (ctx.state.drilling.includes(id)) ctx.state.drilling = ctx.state.drilling.filter((d) => d !== id);
}

/**
 * Bring the rotation inside its slots: slotted techniques past the cap, in
 * rotation order, go to the bench; drills of unslotted techniques stop. The
 * old `fitTechniqueSlots`. Returns how many were benched.
 */
export function fitTechniqueSlots(ctx: MCtx): number {
  const over = slottedTechniques(ctx.state, ctx.read(combat)).slice(techniqueSlots(ctx));
  for (const id of over) bench(ctx, id);
  const c = ctx.read(combat);
  ctx.state.drilling = ctx.state.drilling.filter((id) => techniqueSlotted(ctx.state, c, id));
  return over.length;
}

// ---- reach ----

/**
 * The positions the fighter can stand in: neutral, plus the exit of every
 * known technique that can itself be entered, to a fixpoint. The old
 * `reachablePositions`.
 */
export function reachablePositions(m: MState, runes: (id: string) => readonly RuneTechniqueMod[] = () => NO_RUNES): Set<string> {
  const known = knownTechniques(m);
  const reach = new Set<string>([NEUTRAL_POSITION]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const def of known) {
      const held = m.techniques[def.id];
      const from = entryPositions(def, held);
      if (from !== 'any' && !from.some((p) => reach.has(p))) continue;
      const exit = exitOf(def, held, runes(def.id));
      if (!reach.has(exit)) {
        reach.add(exit);
        grew = true;
      }
    }
  }
  return reach;
}

/** The entry positions of a technique the fighter cannot reach yet. The old `unreachedEntries`. */
export function unreachedEntries(m: MState, def: TechniqueDef, reach: ReadonlySet<string>): string[] {
  const from = entryPositions(def, m.techniques[def.id]);
  if (from === 'any' || from.some((p) => reach.has(p))) return [];
  return from;
}

/** Whether a technique could ever fire for this fighter. The old `techniqueReachable`. */
export function techniqueReachable(m: MState, def: TechniqueDef, reach: ReadonlySet<string>): boolean {
  return unreachedEntries(m, def, reach).length === 0;
}

const watchFromKey = (id: string): string => `watch:${id}`;

/** Self-learning progress, counted from when the technique became reachable. The old `selfLearnProgress`. */
export function selfLearnProgress(m: MState, counts: DeepReadonly<{ counts: Record<string, number> }>, def: TechniqueDef): number {
  const self = def.learn?.self;
  if (!self) return 0;
  return Math.max(0, counterValue(counts, self.stat) - (m.learnFrom[def.id] ?? 0));
}

/** Sightings toward `learn.watch`, counted from when the technique became reachable. The old `watchLearnProgress`. */
export function watchLearnProgress(m: MState, counts: DeepReadonly<{ counts: Record<string, number> }>, def: TechniqueDef): number {
  if (!def.learn?.watch) return 0;
  return Math.max(0, counterValue(counts, watchStatKey(def.id)) - (m.learnFrom[watchFromKey(def.id)] ?? 0));
}

/** Every counter key some technique learns from. A change of one of these runs the learning check. */
const LEARN_KEYS = new Map<string, TechniqueDef[]>();
for (const t of TECHNIQUE_LIST) {
  for (const key of [...(t.learn?.self ? [t.learn.self.stat] : []), ...(t.learn?.watch ? [watchStatKey(t.id)] : [])]) {
    if (!LEARN_KEYS.has(key)) LEARN_KEYS.set(key, []);
    LEARN_KEYS.get(key)!.push(t);
  }
}

/** The reach of a fighter who knows nothing: neutral alone. */
const BARE_REACH: ReadonlySet<string> = new Set([NEUTRAL_POSITION]);

// ---- learning ----

const log = (ctx: Pick<MCtx, 'emit'>, key: string, params: Record<string, unknown>, kind: string): void =>
  ctx.emit(logLine, { msg: fillText(TEXT[key], params), kind });

/**
 * Enter a technique in the ledger. Re-learning never downgrades: an entry
 * keeps its executions and moves rough to canonical only. A new technique
 * with every slot in use goes to the bench, with a line. The old
 * `learnTechnique`.
 */
export function learnTechnique(ctx: MCtx, def: TechniqueDef, form: TechniqueForm): DeepReadonly<TechniqueState> {
  const ledger = ctx.state.techniques;
  const held = ledger[def.id];
  if (!held) {
    const cap = techniqueSlots(ctx);
    const full = slottedTechniques(ctx.state, ctx.read(combat)).length >= cap;
    ledger[def.id] = { executions: 0, form };
    if (full) {
      bench(ctx, def.id);
      log(ctx, 'learned_benched', { icon: def.icon, name: def.name, cap }, 'combat');
    }
    return ledger[def.id];
  }
  if (held.form === 'rough' && form === 'canonical') held.form = 'canonical';
  return held;
}

/**
 * Self-learning: an eligible, reachable, unknown technique with a `learn.self`
 * counter or a watch count becomes known, rough, once either progress
 * crosses. The baselines of an unreachable technique follow their counters.
 * Off while the martial unlock is shut; the baselines still move. The old
 * `checkTechniqueLearning`.
 */
export function checkTechniqueLearning(ctx: MCtx, defs: readonly TechniqueDef[] = TECHNIQUE_LIST): void {
  const m = ctx.state;
  const counts = ctx.read(counters);
  // The reach only changes with the ledger, and an empty ledger reaches neutral alone.
  const reach = hasAny(m.techniques) ? reachablePositions(m, runeLookup(ctx)) : BARE_REACH;
  for (const def of defs) {
    const { self, watch } = def.learn ?? {};
    if ((!self && !watch) || m.techniques[def.id] || techniqueReachable(m, def, reach)) continue;
    if (self) m.learnFrom[def.id] = counterValue(counts, self.stat);
    if (watch) m.learnFrom[watchFromKey(def.id)] = counterValue(counts, watchStatKey(def.id));
  }
  if (counterValue(counts, MARTIAL_UNLOCK) < 1) return;
  for (const def of defs) {
    if (!def.learn || m.techniques[def.id]) continue;
    if (!techniqueReachable(m, def, reach)) continue;
    const { self, watch } = def.learn;
    const ready =
      (!!self && selfLearnProgress(m, counts, def) >= self.count) || (!!watch && watchLearnProgress(m, counts, def) >= watch);
    if (!ready || !eligibleToLearn(ctx, def)) continue;
    log(ctx, 'technique_learned', { icon: def.icon, name: def.name }, 'combat');
    learnTechnique(ctx, def, 'rough');
  }
}

// ---- teachers ----

/** Where a lesson stands: taught, held (a requirement or no way in), or open. The old `lessonState`. */
export type LessonState = 'open' | 'held' | 'taught';

export function lessonState(ctx: ReadCtx, lesson: Lesson): LessonState {
  const reader = conditionReader(ctx);
  const met = !lesson.requires || conditionsMet(reader, lesson.requires as Condition[]);
  if (lesson.school) {
    if (ctx.read(skills).skills[lesson.school]) return 'taught';
    return met ? 'open' : 'held';
  }
  const m = ctx.read(martial);
  const id = lesson.technique ?? '';
  if (m.techniques[id]?.form === 'canonical') return 'taught';
  if (!met) return 'held';
  const def = TECHNIQUES[id];
  if (def && !techniqueReachable(m, def, reachablePositions(m, runeLookup(ctx)))) return 'held';
  return 'open';
}

/** The lessons a person gives. */
export function lessonsOf(npcId: string): readonly Lesson[] {
  return TEACHERS[npcId]?.lessons ?? [];
}

/** The person who teaches a school, and the lesson. The old `schoolTeacher`. */
export function schoolTeacher(skillId: string): { npcId: string; lesson: Lesson } | null {
  for (const t of Object.values(TEACHERS)) {
    for (const lesson of t.lessons) if (lesson.school === skillId) return { npcId: t.id, lesson };
  }
  return null;
}

/** Why a lesson cannot be taken now, or null. */
function lessonRefusal(ctx: ReadCtx, npcId: string, lesson: Lesson | undefined, what: string): string | null {
  if (!NPCS[npcId]) return `no person "${npcId}"`;
  if (!lesson) return `${NPCS[npcId].name} does not teach ${what}`;
  const at = lessonState(ctx, lesson);
  if (at === 'taught') return `${what} is already taught`;
  if (at === 'held') return `the lesson is held: a requirement is unmet or nothing known leads into ${what}`;
  return null;
}

// ---- drilling and practice ----

/** Whether a technique is drilled. */
export function isDrilled(state: MState, id: string): boolean {
  return state.drilling.includes(id);
}

/**
 * Count one execution. Practice counts only for a drilled technique; a free
 * drill slot claims a slotted technique on its first execution. With
 * `drillsAll` held every slotted technique counts, and `repMult` records
 * several reps at once. Returns a newly reached rung. The old `recordExecution`.
 */
export function recordExecution(ctx: MCtx, def: TechniqueDef): { tier: number; name: string } | undefined {
  const m = ctx.state;
  const c = ctx.read(combat);
  const held = heldOf(ctx.read(statuses));
  if (heldWith(held, 'drillsAll')) {
    if (!techniqueSlotted(m, c, def.id)) return undefined;
  } else if (!m.drilling.includes(def.id)) {
    if (m.drilling.length >= MAX_DRILLED || !techniqueSlotted(m, c, def.id)) return undefined;
    m.drilling.push(def.id);
  }
  const entry = m.techniques[def.id];
  if (!entry) return undefined;
  const before = masteryTier(entry);
  const reps = heldWith(held, 'repMult');
  entry.executions += reps ? Math.max(1, Math.round(reps.intensity)) : 1;
  const after = masteryTier(entry);
  if (after <= before) return undefined;
  return { tier: after, name: masteryTierName(def, after) ?? `tier ${after}` };
}

// ---- weapon states ----

/** Hand a held blade back: to the hand if free, else the pack. The old `reclaim`. */
function reclaim(ctx: MCtx, item: ItemInstance): void {
  ctx.request(giveBack, { item });
}

/** The equipment side of a move. 'pre' draws or takes a blade back; 'post' leaves it. The old `applyTechniqueEquipment`. */
function applyTechniqueEquipment(ctx: MCtx, def: TechniqueDef, phase: 'pre' | 'post'): void {
  const effect = def.move.equipment;
  const m = ctx.state;
  if (!effect || !ctx.read(combat).fight) return;
  if (phase === 'post' && (effect === 'ground' || effect === 'impale')) {
    const item = ctx.request(takeWeapon, undefined);
    if (item) m[effect === 'ground' ? 'grounded' : 'impaled'] = item;
  } else if (phase === 'pre' && effect === 'recover' && m.grounded) {
    const item = m.grounded;
    m.grounded = null;
    reclaim(ctx, item);
  } else if (phase === 'pre' && effect === 'wrench' && m.impaled) {
    const item = m.impaled;
    m.impaled = null;
    reclaim(ctx, item);
  } else if (phase === 'pre' && effect === 'draw' && m.sheathed) {
    const item = m.sheathed;
    m.sheathed = null;
    reclaim(ctx, item);
  }
}

/** The fight is over: nobody leaves their blade in the dirt or in a body. The old `recoverGroundedWeapon`. */
function recoverGroundedWeapon(ctx: MCtx): void {
  for (const slot of ['grounded', 'impaled'] as const) {
    const item = ctx.state[slot];
    if (!item) continue;
    ctx.state[slot] = null;
    reclaim(ctx, item);
  }
}

// ---- requests and commands ----

/** Request: enter a technique in the ledger (a drill manual, a test). */
export const learnRequest = defineRequest<{ technique: string; form: TechniqueForm }, boolean>('martial/learn');
/** Request: run the learning check now (old `checkTechniqueLearning`). The tests and a later port use it. */
export const checkLearning = defineRequest<void, void>('martial/check-learning');
/** Request: bring the rotation inside its slots (old `fitTechniqueSlots`, a loadout apply). Answers how many were benched. */
export const fitSlots = defineRequest<void, number>('martial/fit-slots');
/** Request: count one execution of a technique (the three execution paths). */
export const recordRequest = defineRequest<{ technique: string }, { tier: number; name: string } | null>('martial/record');
/** Request: the equipment side of a move, `pre` or `post`. */
export const techniqueEquipment = defineRequest<{ technique: string; phase: 'pre' | 'post' }, void>('martial/equipment');
/** Hold a prepared working in the spell-ready seat, or let it go (`uid: null`). The mana is never refunded. */
export const holdSpell = defineRequest<{ uid: number | null }, void>('martial/hold-spell');
/** Take the sheathed blade off the player (the festival's door, old `holdGear`). Answers a copy, or null. */
export const holdSheathed = defineRequest<void, ItemInstance | null>('martial/hold-sheathed');
/**
 * Give a held sheathed blade back (old `returnGear`): a sheathed blade among
 * `lent` is taken back first; then the held one goes into the sheath when it
 * is empty. Answers the held blade when the sheath was taken, for the pack.
 */
export const returnSheathed = defineRequest<{ held: ItemInstance | null; lent: number[] }, ItemInstance | null>(
  'martial/return-sheathed',
);

export const learnFromTeacher = defineCommand<{ npc: string; technique: string }>('martial/learn-technique');
export const learnSchool = defineCommand<{ npc: string; school: string }>('martial/learn-school');
export const toggleDrill = defineCommand<{ technique: string }>('martial/toggle-drill');
export const setSlotted = defineCommand<{ technique: string; on: boolean }>('martial/set-slotted');
export const chooseFork = defineCommand<{ technique: string; fork: string }>('martial/choose-fork');
export const toggleSheathe = defineCommand<void>('martial/toggle-sheathe');
/** Debug: wipe a technique back to unknown. The old `resetTechnique`. */
export const resetTechnique = defineCommand<{ technique: string }>('martial/reset');
/** Debug: reopen the Honed choice. The old `clearFork`. */
export const clearFork = defineCommand<{ technique: string }>('martial/clear-fork');

// ---- a monster's technique ----

registerMonsterAction('technique', {
  available(_ctx, enemy, entry) {
    if (!('technique' in entry)) return false;
    const def = TECHNIQUES[entry.technique];
    if (!def) return `no technique has the id "${entry.technique}"`;
    // A monster has no ledger: it reads the declared ways only, and no trigger.
    const from = declaredPositions(def);
    return from === 'any' || from.includes(enemy.position ?? NEUTRAL_POSITION);
  },
  shape(_ctx, _enemy, entry) {
    const def = TECHNIQUES[(entry as { technique: string }).technique];
    const move = def.move;
    return {
      name: def.name,
      icon: def.icon,
      ...(move.damageMult !== undefined ? { damageMult: move.damageMult } : {}),
      // The old enemy phase threw the blow as `move.damageType ?? kit.damageType`.
      ...(move.damageType ? { damageType: move.damageType } : {}),
      ...(move.hits !== undefined ? { hits: move.hits } : {}),
      ...(move.inflicts ? { inflicts: move.inflicts } : {}),
      // The old enemy phase stamped `tech.move.cooldown ?? 60`; every record has a cooldown.
      cooldown: move.cooldown,
      to: def.to,
      watchKey: watchStatKey(def.id),
    };
  },
});

// ---- the player's technique ----

const ledgerOf = (ctx: Pick<ReadCtx, 'read'>): DeepReadonly<MartialState['techniques']> => ctx.read(martial).techniques;

const feed = (ctx: Pick<ActionCtx, 'emit'>, text: string, damage?: DamageReport): void =>
  ctx.emit(feedLine, damage ? { text, damage } : { text });

/** The gates every path into a player's technique shares, in the old order. A string is a reason. */
function gate(ctx: ActionCtx, def: TechniqueDef, held: Held, fight: DeepReadonly<Fight>, baked: boolean): true | false | string {
  if (!techniqueArmed(ctx, def)) return false;
  if (weaponStateGate(ctx, def)) return false;
  // The baked reflex gates every way in; then one way must be open.
  if (baked && !triggerHolds(ctx, def.trigger)) return false;
  if (!openEntry(ctx, def, held, fight.position)) return false;
  return true;
}

/** Count the execution and put a new rung in the feed. */
const practise = (ctx: ActionCtx, def: TechniqueDef): void => {
  ctx.request(recordRequest, { technique: def.id });
};

registerPlayerAction(PREFIX, {
  rank: 30,
  known: (ctx) => knownTechniques(ctx.read(martial)).map(rotationId),
  pick(ctx, id, slot, fight) {
    const def = TECHNIQUES[id.slice(PREFIX.length)];
    if (!def) return `no technique has the id "${id.slice(PREFIX.length)}"`;
    const held = ledgerOf(ctx)[def.id];
    if (!held) return 'the technique is not known';
    // A counter lives inside the enemy's attack: neither slot picks it.
    if (def.move.counter) return null;
    const offensive = def.move.damageMult !== undefined;
    if ((slot === 'attack') !== offensive) return null;
    const open = gate(ctx, def, held, fight, true);
    if (open !== true) return open === false ? null : open;
    const runes = runeModsOf(ctx, def.id);
    const move = moveOf(def, held, runes);
    const exit = exitOf(def, held, runes);

    if (offensive) {
      const picked: PickedActive = {
        id,
        cooldown: move.cooldown,
        usesHands: true,
        shape: {
          label: `${def.icon} ${def.name} strikes`,
          hitLabel: def.name,
          damageMult: move.damageMult,
          ...(move.hits !== undefined ? { hits: move.hits } : {}),
          ...(move.penetration !== undefined ? { penetration: move.penetration } : {}),
          ...(move.splash !== undefined ? { splash: move.splash } : {}),
          ...(move.crit ? { crit: { floor: move.crit.floor, damageMult: move.crit.damageMult } } : {}),
          ...(move.inflicts ? { inflicts: move.inflicts } : {}),
          ...(move.staminaCost !== undefined ? { staminaCost: move.staminaCost } : {}),
          ...(move.momentum !== undefined ? { momentum: move.momentum } : {}),
          // A deflection answers with what its own trigger's defence stopped.
          ...(move.preventedMult
            ? { prevented: { by: def.trigger?.event === 'onParry' ? ('onParry' as const) : ('onHit' as const), mult: move.preventedMult } }
            : {}),
          to: exit,
        },
        ...(move.equipment ? { before: (c: ActionCtx) => c.request(techniqueEquipment, { technique: def.id, phase: 'pre' }) } : {}),
        after(c) {
          if (move.equipment) c.request(techniqueEquipment, { technique: def.id, phase: 'post' });
          practise(c, def);
        },
      };
      return picked;
    }

    // Readying a working pays its mana now. With nothing prepared that can
    // be held and paid for, the form does not come (old: silently).
    const readied = move.readiesSpell ? readyableSpell(ctx, statBlockOf(ctx)) : null;
    if (move.readiesSpell && !readied) return 'no prepared spell with a strike or a heal can be paid for';

    // A defensive form: it fires from the buff slot as soon as its moment comes.
    return {
      id,
      cooldown: move.cooldown,
      usesHands: false,
      cast(c) {
        const stats = statBlockOf(c);
        if (readied) {
          c.request(spendNow, { id: 'mana', amount: readied.cost });
          c.request(holdSpell, { uid: readied.uid });
        }
        if (move.buff) c.request(addBuff, { name: def.name, mods: move.buff.mods, ticksLeft: move.buff.duration });
        if (move.staminaCost) {
          c.request(drawNow, { id: 'stamina', amount: stats.maxStamina * move.staminaCost * stats.staminaEff });
        }
        c.request(movePlayer, { to: exit });
        practise(c, def);
        if (readied) {
          const spell = c.read(spellcraft).grimoire.find((s) => s.uid === readied.uid);
          feed(
            c,
            `🔮 ${def.name} — ${spell ? resolveSpellFor(c, spell).name : 'a spell'} is readied (mana paid now). You lose it, mana included, if you leave this position.`,
          );
        } else feed(c, `${def.icon} ${def.name} — you settle ${POSITIONS[exit]?.name ?? exit}.`);
        c.emit(grantAttrXp, { attr: 'dex', amount: 2 });
        c.emit(grantSkillXp, { tags: ['combat', ...(def.family ? [def.family] : [])], amount: 3 });
      },
    };
  },
});

// ---- counters: techniques that live inside the enemy's attack ----

/** What one interception costs: a share of the pool's usable size, trimmed by its efficiency. The old `counterPrice`. */
function counterPrice(ctx: ActionCtx, stats: Readonly<DerivedStats>, pool: ResourceId, cost: number): number {
  const eff = pool === 'stamina' ? stats.staminaEff : pool === 'mana' ? stats.manaEff : 1;
  return availableMax(stats as DerivedStats, poolHooks(ctx), pool) * cost * eff;
}

/**
 * The counter form ready to intercept `event` now: the first in rotation
 * order that is known, off its clock, armed, open from where the player
 * stands and affordable. Its own event is happening now, so the baked
 * trigger is not asked. The old `pickCounter`.
 */
function pickCounter(ctx: ActionCtx, fight: DeepReadonly<Fight>, event: string): ArmedInterception | null {
  const book = ledgerOf(ctx);
  // Asked on every blow that lands: an empty ledger answers at once.
  if (!hasAny(book)) return null;
  const state = ctx.read(combat);
  // The explicit rotation first, then the rest in registry order: the order `activeRotation` gives techniques.
  const order: string[] = [];
  for (const id of state.rotation) {
    if (id.startsWith(PREFIX) && book[id.slice(PREFIX.length)] && !order.includes(id)) order.push(id);
  }
  for (const def of TECHNIQUE_LIST) {
    const id = `${PREFIX}${def.id}`;
    if (book[def.id] && !order.includes(id)) order.push(id);
  }
  const stats = statBlockOf(ctx);
  for (const id of order) {
    const def = TECHNIQUES[id.slice(PREFIX.length)];
    const held = book[def?.id ?? ''];
    if (!def?.move.counter) continue;
    if ((def.trigger?.event ?? 'onHit') !== event) continue;
    if ((fight.cooldowns[id] ?? 0) > 0) continue;
    if (gate(ctx, def, held, fight, false) !== true) continue;
    // Benching a counter switches the reflex off like anything else.
    if (!triggerHolds(ctx, state.triggers[id])) continue;
    const runes = runeModsOf(ctx, def.id);
    const move = moveOf(def, held, runes);
    const spec = move.counter!;
    const pool = spec.pool as ResourceId | undefined;
    // An empty pool is not a refusal: just not this blow.
    if (pool && spec.cost && counterPrice(ctx, stats, pool, spec.cost) > resourceValue(ctx.read(resources), pool)) continue;
    return {
      name: def.name,
      reduce: spec.reduce,
      fire: (c, target) => fireCounter(c, id, def, exitOf(def, held, runes), move, target),
    };
  }
  return null;
}

/**
 * The answer, on the spot and free of the action bar: the player's damage in
 * the weapon's type, and what was just stopped in the type the technique
 * names. Whoever threw the blow is who it answers. The old `fireCounter`,
 * without the readied spell (not ported).
 */
function fireCounter(
  ctx: ActionCtx,
  id: string,
  def: TechniqueDef,
  exit: string,
  move: TechniqueMove,
  target: DeepReadonly<{ entity: string; name: string }>,
): void {
  const stats = statBlockOf(ctx);
  const spec = move.counter!;
  const pool = spec.pool as ResourceId | undefined;
  if (pool && spec.cost) ctx.request(spendNow, { id: pool, amount: counterPrice(ctx, stats, pool, spec.cost) });

  // The technique chose when and from where; the grimoire decides what
  // lands. The held working replaces the weapon answer entirely.
  if (move.deliversSpell) {
    const uid = ctx.read(martial).readiedSpell;
    const held = uid === null ? undefined : ctx.read(spellcraft).grimoire.find((s) => s.uid === uid);
    ctx.request(holdSpell, { uid: null });
    ctx.request(stampCooldown, { id, ticks: move.cooldown });
    const displacedTo = statusDisplacedExit((p) => ctx.rng.chance(p), heldOf(ctx.read(statuses)));
    ctx.request(movePlayer, { to: displacedTo ?? exit });
    practise(ctx, def);
    ctx.emit(grantAttrXp, { attr: 'int', amount: 3 });
    ctx.emit(grantSkillXp, { tags: ['combat', 'magic'], amount: 3 });
    if (held) {
      feed(ctx, `${def.icon} ${def.name} — your readied spell is cast in place of the weapon strike.`);
      // The old code paid the working again here, and stamped its cooldown
      // on the technique's id over the technique's own.
      castCraftedAttack(ctx, id, resolveSpellFor(ctx, held));
    }
    return;
  }

  const type = playerDamageType(ctx);
  const strikes: EnemyStrike[] = [];
  const steps: DamageStep[] = [];
  if (move.damageMult) {
    strikes.push({ type, raw: stats.damage * move.damageMult });
    steps.push({ label: 'Damage', value: stats.damage });
    if (move.damageMult !== 1) steps.push({ label: def.name, mult: move.damageMult });
  }
  if (move.preventedMult) {
    const stopped = ctx.request(takePrevented, { by: 'onHit' });
    if (stopped > 0) {
      strikes.push({ type: move.damageType ?? type, raw: stopped * move.preventedMult });
      steps.push({ label: 'Damage blocked', value: stopped * move.preventedMult });
    }
  }
  const landed = ctx.request(damageEnemy, {
    entity: target.entity,
    strikes,
    source: weaponSource(ctx),
    penetration: stats.penetration,
    kind: 'strike',
  });
  if (landed) {
    feed(ctx, `${def.icon} ${def.name} answers the ${target.name} for ${landed.dealt}`, {
      label: def.name,
      target: target.name,
      steps,
      slices: landed.slices,
      hits: 1,
      crit: false,
      total: landed.dealt,
    });
  }
  ctx.request(stampCooldown, { id, ticks: move.cooldown });
  const displaced = statusDisplacedExit((p) => ctx.rng.chance(p), heldOf(ctx.read(statuses)));
  ctx.request(movePlayer, { to: displaced ?? exit });
  practise(ctx, def);
  ctx.emit(grantAttrXp, { attr: 'dex', amount: 2 });
  ctx.emit(grantSkillXp, { tags: ['combat', ...(def.family ? [def.family] : [])], amount: 3 });
}

registerInterception('martial/counter', { arm: pickCounter });

// A held working is out of the rotation and out of the counterspell pick.
registerHeldSpell((reads) => reads.read(martial).readiedSpell);

// Leaving the seat drops the held working, mana and all. The old `setPosition`.
registerPositionWatch((ctx, from, to) => {
  if (from === SPELL_READY_POSITION && to !== SPELL_READY_POSITION && ctx.read(martial).readiedSpell !== null) {
    ctx.request(holdSpell, { uid: null });
  }
});

// ---- the planner's reads ----

/** One technique on the position graph. `from` is null for a reflex that enters from anywhere. The old `PositionEdge`. */
export interface PositionEdge {
  technique: string;
  from: string | null;
  to: string;
}

/** The graph the given techniques form now, with mastery, fork and runes. The old `positionGraph`. */
export function positionGraph(m: MState, defs: readonly TechniqueDef[], runes: (id: string) => readonly RuneTechniqueMod[] = () => NO_RUNES): PositionEdge[] {
  const edges: PositionEdge[] = [];
  for (const def of defs) {
    const held = m.techniques[def.id];
    const to = exitOf(def, held, runes(def.id));
    const from = entryPositions(def, held);
    if (from === 'any') edges.push({ technique: def.id, from: null, to });
    else for (const p of from) edges.push({ technique: def.id, from: p, to });
  }
  return edges;
}

/** Whether a position is shown: neutral always, else a known technique enters or leaves it. The old `positionKnown`. */
export function positionKnown(ctx: ReadCtx, id: string): boolean {
  if (id === NEUTRAL_POSITION) return true;
  const def = POSITIONS[id];
  if (!def) return false;
  if (def.unlock && !conditionsMet(conditionReader(ctx), def.unlock as Condition[])) return false;
  const m = ctx.read(martial);
  const runes = runeLookup(ctx);
  return knownTechniques(m).some((t) => {
    const held = m.techniques[t.id];
    if (exitOf(t, held, runes(t.id)) === id) return true;
    const from = entryPositions(t, held);
    return from !== 'any' && from.includes(id);
  });
}

/** The positions to draw, in registry order. The old `knownPositions`. */
export function knownPositions(ctx: ReadCtx): PositionDef[] {
  return Object.values(POSITIONS).filter((p) => positionKnown(ctx, p.id));
}

/** Why a technique is or is not about to fire, in the rotation's order. The old `TechniqueStatus`. */
export type TechniqueStatus =
  | { kind: 'ready' }
  | { kind: 'primed' }
  | { kind: 'off' }
  | { kind: 'unarmed'; family: string }
  | { kind: 'state'; needs: 'wielded' | 'grounded' | 'sheathed' | 'impaled' | 'readied' }
  | { kind: 'cooldown'; ticks: number }
  | { kind: 'position'; from: string[] }
  | { kind: 'trigger'; event?: string }
  | { kind: 'gated' };

/** The old `techniqueStatus`. */
export function techniqueStatus(ctx: ActionCtx, def: TechniqueDef): TechniqueStatus {
  const c = ctx.read(combat);
  const overlay = c.triggers[`${PREFIX}${def.id}`];
  if (overlay?.enabled === false) return { kind: 'off' };
  if (!techniqueArmed(ctx, def)) return { kind: 'unarmed', family: def.family! };
  const needs = weaponStateGate(ctx, def);
  if (needs) return { kind: 'state', needs };
  const fight = c.fight;
  if (!fight) return { kind: 'ready' };
  const cd = fight.cooldowns[`${PREFIX}${def.id}`] ?? 0;
  if (cd > 0) return { kind: 'cooldown', ticks: cd };
  if (!triggerHolds(ctx, def.trigger)) return { kind: 'trigger', event: def.trigger?.event };
  const held = ledgerOf(ctx)[def.id];
  if (!openEntry(ctx, def, held, fight.position)) {
    const here = entriesOf(def, held).find((e) => e.at === 'any' || e.at.includes(fight.position));
    if (here) return { kind: 'trigger', event: here.trigger?.event };
    const from = entryPositions(def, held);
    return { kind: 'position', from: from === 'any' ? [] : from };
  }
  if (!triggerHolds(ctx, overlay)) return { kind: 'gated' };
  return { kind: 'primed' };
}

// ---- the view ----

export interface TechniqueRow {
  id: string;
  name: string;
  icon: string;
  desc: string;
  family: string | null;
  form: TechniqueForm;
  executions: number;
  tier: number;
  tierName: string | null;
  toNext: number | null;
  slotted: boolean;
  drilled: boolean;
  from: string[] | 'any';
  to: string;
  kind: 'strike' | 'form' | 'counter';
  cooldown: number;
  forkOpen: boolean;
  forks: { id: string; name: string; icon: string; desc: string }[];
  path: string | null;
  /** Why it is or is not about to fire, as one "Label: fact" line. */
  status: string;
}

/** A status as one line. */
export function statusText(st: TechniqueStatus): string {
  switch (st.kind) {
    case 'ready':
      return 'Status: ready';
    case 'primed':
      return 'Status: fires at the next chance';
    case 'off':
      return 'Status: on the bench';
    case 'unarmed':
      return `Status: needs a ${st.family} in hand`;
    case 'state':
      return `Status: needs a ${st.needs} weapon state`;
    case 'cooldown':
      return `Status: cooldown ${(st.ticks / 10).toFixed(1)} s`;
    case 'position':
      return `Status: needs ${st.from.map((p) => POSITIONS[p]?.name ?? p).join(' or ')}`;
    case 'trigger':
      return st.event ? `Status: waits for ${st.event}` : 'Status: its condition does not hold';
    case 'gated':
      return 'Status: held by your own condition';
  }
}

export interface LessonRow {
  npc: string;
  npcName: string;
  technique: string | null;
  school: string | null;
  name: string;
  icon: string;
  state: LessonState;
}

export interface MartialView {
  known: TechniqueRow[];
  slots: { used: number; cap: number; drilled: number; drillCap: number };
  positions: { id: string; name: string; icon: string; color: string; incomingMult: number | null; dodgeMult: number | null }[];
  edges: PositionEdge[];
  lessons: LessonRow[];
  unlocked: boolean;
  sheathed: string | null;
  canSheathe: boolean;
}

function rowOf(ctx: ActionCtx, m: MState, c: CState, def: TechniqueDef, runes: readonly RuneTechniqueMod[]): TechniqueRow {
  const held = m.techniques[def.id];
  const move = moveOf(def, held, runes);
  const tier = masteryTier(held);
  return {
    id: def.id,
    name: displayName(def, held, runes),
    icon: def.icon,
    desc: def.desc ?? '',
    family: def.family ?? null,
    form: held!.form,
    executions: held!.executions,
    tier,
    tierName: masteryTierName(def, tier) ?? null,
    toNext: repsToNextTier(held) ?? null,
    slotted: techniqueSlotted(m, c, def.id),
    drilled: m.drilling.includes(def.id),
    from: entryPositions(def, held),
    to: exitOf(def, held, runes),
    kind: def.move.counter ? 'counter' : def.move.damageMult !== undefined ? 'strike' : 'form',
    cooldown: move.cooldown,
    forkOpen: forkAvailable(def, held, runes),
    forks: forkAvailable(def, held, runes)
      ? forkOptions(def, held, runes).map((f) => ({ id: f.id, name: f.name, icon: f.icon, desc: f.desc ?? '' }))
      : [],
    path: chosenFork(held)?.name ?? null,
    status: statusText(techniqueStatus(ctx, def)),
  };
}

// ---- the declaration ----

const martial: SystemDef<MartialState, MartialView> = defineSystem<MartialState, MartialView>({
  id: 'martial',
  version: 2,
  migrations,
  initial: () => ({
    techniques: {},
    drilling: [],
    learnFrom: {},
    sheathed: null,
    grounded: null,
    impaled: null,
    readiedSpell: null,
  }),
  content: { positions, fork_archetypes: forkArchetypes, techniques, teachers, martial_text: martialText },

  modifiers: [
    {
      id: POSITION_EFFECT_SOURCE,
      // Reads where the player stands in the fight; combat touches its
      // position source when that changes.
      dependsOn: [POSITION_SOURCE],
      collect: ({ entity, read }): Modifier[] => {
        if (entity !== PLAYER) return [];
        const effects = POSITIONS[playerPosition(read(combat))]?.effects;
        if (!effects) return [];
        const mods: Modifier[] = [];
        // `|| 1`: an incoming multiplier of 0 reads as none, as the old `positionIncomingMult` did.
        if (effects.incomingMult) mods.push({ stat: hook.positionIncomingMult, kind: 'mult', value: effects.incomingMult });
        // An explicit 0 is kept: a position taken wide open dodges nothing.
        if (effects.dodgeMult !== undefined) mods.push({ stat: hook.positionDodgeMult, kind: 'mult', value: effects.dodgeMult });
        return mods;
      },
    },
  ],

  requests: [
    answer(learnRequest, (ctx, { technique, form }) => {
      const def = TECHNIQUES[technique];
      if (!def) {
        ctx.skip(learnRequest.type, `no technique has the id "${technique}"`);
        return false;
      }
      learnTechnique(ctx, def, form);
      return true;
    }),
    answer(checkLearning, (ctx) => checkTechniqueLearning(ctx)),
    answer(fitSlots, (ctx) => fitTechniqueSlots(ctx)),
    answer(holdSpell, (ctx, { uid }) => {
      ctx.state.readiedSpell = uid;
    }),
    answer(holdSheathed, (ctx) => {
      const item = ctx.state.sheathed;
      ctx.state.sheathed = null;
      return item ? (JSON.parse(JSON.stringify(item)) as ItemInstance) : null;
    }),
    answer(returnSheathed, (ctx, { held, lent }) => {
      const m = ctx.state;
      if (m.sheathed && lent.includes(m.sheathed.uid)) m.sheathed = null;
      if (!held) return null;
      if (m.sheathed) return JSON.parse(JSON.stringify(held)) as ItemInstance;
      m.sheathed = JSON.parse(JSON.stringify(held)) as ItemInstance;
      return null;
    }),
    answer(recordRequest, (ctx, { technique }) => {
      const def = TECHNIQUES[technique];
      if (!def) {
        ctx.skip(recordRequest.type, `no technique has the id "${technique}"`);
        return null;
      }
      const reached = recordExecution(ctx, def);
      if (reached) ctx.emit(feedLine, { text: fillText(TEXT.mastery_reached, { name: def.name, tier: reached.name }) });
      return reached ?? null;
    }),
    answer(techniqueEquipment, (ctx, { technique, phase }) => {
      const def = TECHNIQUES[technique];
      if (def) applyTechniqueEquipment(ctx, def, phase);
    }),
  ],

  commands: [
    handle(learnFromTeacher, (ctx, { npc, technique }) => {
      const lesson = lessonsOf(npc).find((l) => l.technique === technique);
      const def = TECHNIQUES[technique];
      if (!def) return skipped(`no technique has the id "${technique}"`);
      const refusal = lessonRefusal(ctx, npc, lesson, def.name);
      if (refusal) return skipped(refusal);
      const refined = ctx.state.techniques[def.id]?.form === 'rough';
      log(ctx, refined ? 'technique_refined' : 'technique_taught', { icon: def.icon, name: def.name, teacher: NPCS[npc].name }, 'skill');
      learnTechnique(ctx, def, 'canonical');
      return OK;
    }),
    handle(learnSchool, (ctx, { npc, school }) => {
      const lesson = lessonsOf(npc).find((l) => l.school === school);
      const def = SKILLS[school];
      if (!def) return skipped(`no skill has the id "${school}"`);
      const refusal = lessonRefusal(ctx, npc, lesson, def.name);
      if (refusal) return skipped(refusal);
      ctx.emit(setCounter, { key: schoolTaughtKey(school), value: 1 });
      ctx.request(enterSkill, { id: school });
      log(ctx, 'school_taught', { icon: def.icon, name: def.name, teacher: NPCS[npc].name }, 'skill');
      return OK;
    }),
    handle(toggleDrill, (ctx, { technique }) => {
      const drilling = ctx.state.drilling;
      const at = drilling.indexOf(technique);
      if (at >= 0) {
        drilling.splice(at, 1);
        return OK;
      }
      if (!TECHNIQUES[technique]) return skipped(`no technique has the id "${technique}"`);
      if (drilling.length >= MAX_DRILLED) return skipped(`all ${MAX_DRILLED} drill slots are in use`);
      if (!techniqueSlotted(ctx.state, ctx.read(combat), technique)) return skipped('the technique is not in a slot');
      drilling.push(technique);
      return OK;
    }),
    handle(setSlotted, (ctx, { technique, on: wanted }) => {
      if (!wanted) {
        bench(ctx, technique);
        return OK;
      }
      if (!ctx.state.techniques[technique]) return skipped('the technique is not known');
      const c = ctx.read(combat);
      if (techniqueSlotted(ctx.state, c, technique)) return skipped('the technique is already in a slot');
      const cap = techniqueSlots(ctx);
      if (slottedTechniques(ctx.state, c).length >= cap) {
        log(ctx, 'slots_full', { cap }, 'danger');
        return skipped(`all ${cap} technique slots are in use`);
      }
      ctx.request(enableAction, { id: `${PREFIX}${technique}`, enabled: true });
      return OK;
    }),
    handle(chooseFork, (ctx, { technique, fork }) => {
      const def = TECHNIQUES[technique];
      if (!def) return skipped(`no technique has the id "${technique}"`);
      const held = ctx.state.techniques[technique];
      const runes = runeModsOf(ctx, technique);
      if (!forkAvailable(def, held, runes)) return skipped('the Honed choice is not open');
      if (!forkOptions(def, held, runes).some((a) => a.id === fork)) return skipped(`"${fork}" is not offered`);
      held!.path = fork;
      return OK;
    }),
    handle(toggleSheathe, (ctx) => {
      const m = ctx.state;
      if (m.sheathed) {
        const item = m.sheathed;
        m.sheathed = null;
        reclaim(ctx, item);
        return OK;
      }
      const weapon = ctx.read(items).equipment.weapon;
      if (!weapon) return skipped('no weapon is wielded');
      if (!(itemDefOf(weapon)?.tags ?? []).includes('dagger')) return skipped('only a dagger can be sheathed');
      m.sheathed = ctx.request(takeWeapon, undefined);
      return OK;
    }),
    handle(resetTechnique, (ctx, { technique }) => {
      if (!ctx.state.techniques[technique]) return skipped('the technique is not known');
      delete ctx.state.techniques[technique];
      ctx.state.drilling = ctx.state.drilling.filter((d) => d !== technique);
      return OK;
    }),
    handle(clearFork, (ctx, { technique }) => {
      const held = ctx.state.techniques[technique];
      if (!held?.path) return skipped('the technique has no fork');
      delete held.path;
      return OK;
    }),
  ],

  events: [
    on(counterChanged, (ctx, { payload }) => {
      // Only the techniques that learn from the counter that moved: their
      // baselines and their progress are all a change of it can move. The
      // unlock opens every technique at once.
      if (payload.key === MARTIAL_UNLOCK) return checkTechniqueLearning(ctx);
      const defs = LEARN_KEYS.get(payload.key);
      if (defs) checkTechniqueLearning(ctx, defs);
    }),
    on(fightClosed, (ctx) => {
      if (ctx.state.grounded || ctx.state.impaled) recoverGroundedWeapon(ctx);
      // A working held at the edge of release does not survive the fight it
      // was held for. Its mana was spent when it was taken up.
      ctx.state.readiedSpell = null;
    }),
  ],

  view: (ctx) => {
    const m = ctx.state;
    const c = ctx.read(combat);
    const runes = runeLookup(ctx);
    const known = knownTechniques(m);
    const spot = ctx.read(world).spot;
    const lessons: LessonRow[] = [];
    for (const t of Object.values(TEACHERS)) {
      if (NPCS[t.id]?.spotId !== spot) continue;
      for (const lesson of t.lessons) {
        const def = lesson.technique ? TECHNIQUES[lesson.technique] : undefined;
        const skill = lesson.school ? SKILLS[lesson.school] : undefined;
        lessons.push({
          npc: t.id,
          npcName: NPCS[t.id].name,
          technique: lesson.technique ?? null,
          school: lesson.school ?? null,
          name: def?.name ?? skill?.name ?? '',
          icon: def?.icon ?? skill?.icon ?? '',
          state: lessonState(ctx, lesson),
        });
      }
    }
    const sheathedDef = m.sheathed ? itemDefOf(m.sheathed) : undefined;
    const weapon = ctx.read(items).equipment.weapon;
    return {
      // The status reads only: the view context has every read an action context uses.
      known: known.map((def) => rowOf(ctx as unknown as ActionCtx, m, c, def, runes(def.id))),
      slots: {
        used: slottedTechniques(m, c).length,
        cap: techniqueSlots(ctx),
        drilled: m.drilling.length,
        drillCap: MAX_DRILLED,
      },
      positions: knownPositions(ctx).map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        color: p.color,
        incomingMult: p.effects?.incomingMult ?? null,
        dodgeMult: p.effects?.dodgeMult ?? null,
      })),
      edges: positionGraph(m, known, runes),
      lessons,
      unlocked: counterValue(ctx.read(counters), MARTIAL_UNLOCK) >= 1,
      sheathed: sheathedDef?.name ?? null,
      canSheathe: !!m.sheathed || (!!weapon && (itemDefOf(weapon)?.tags ?? []).includes('dagger')),
    };
  },
});

export default martial;
