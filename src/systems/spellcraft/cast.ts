/**
 * A working resolves in a fight. Port of old `combat.ts` 2224 to 2792 and
 * 3229 to 3520: `castMonsterWorking`, `resolveMonsterWorking`,
 * `castCraftedSelf`, `castCraftedAttack`, miracle synergy and the
 * counterspell functions.
 *
 * Every function gets the narrow context combat gives a registered kind. A
 * monster's HP, clock and conditions change through requests on `combat` and
 * `statuses`; this system's own slice (the casting stamp, the last miracle)
 * through requests on itself.
 */
import { PLAYER, type DeepReadonly } from '../../kernel';
import { grantAttrXp } from '../attributes';
import clock, { totalTicksOf } from '../clock';
import combat, {
  registerMonsterAction,
  registerPlayerAction,
  type PickedActive,
  addBuff,
  healEnemy,
  hurtEnemy,
  incomingSlice,
  isSiteBoss,
  landSlices,
  markEvent,
  mindInDebt,
  monsterSlice,
  retaliateAttack,
  stampAction,
  stampCooldown,
  triggerHolds,
  type ActionCtx,
  type Enemy,
  type Fight,
  type TypedSlice,
} from '../combat';
import { feedLine, type DamageReport, type DamageStep } from '../log';
import { rollProcChance } from '../mercy';
import { kitOf, MONSTERS, monsterTagSet, penetrationOf } from '../monsters';
import resources, { drawNow, healNow, hitPlayer, isAlive, resourceValue, spendNow } from '../resources';
import { checkDiscovery, grantSkillXp } from '../skills';
import { RES_STAT_BY_TYPE, statBlockOf, vsVariant, type DamageType, type DerivedStats } from '../stats';
import statuses, {
  amplifyStatuses,
  applyStatus,
  applyStatuses,
  consumeMagnetCharge,
  heldOf,
  magnetCritChance,
  statusBlocks,
  statusPacifiesFlankers,
  stripStatuses,
} from '../statuses';
import { counterEfficiency, OTHERS_POWER } from './counter';
import { leadingElement, schoolOf, sourceIssue, specForSource, undoWorking, workingSignature, type SchoolReads } from './spec';
import type { CraftedSpell, SpellSource, SpellSpec, SpellStrike } from './types';
import spellcraft from './index';
import {
  GRIMOIRE_PREFIX,
  heldSpell,
  noteCasting,
  noteMiracle,
  refute,
  sealed,
  spellCast,
  spellPractised,
  strikeLanded,
  type SpellcraftReads,
} from './state';

type Foe = DeepReadonly<Enemy>;

/** How long one miracle's echo lasts for the next to resonate with. */
export const MIRACLE_SYNERGY_WINDOW = 100;
/** What resonating is worth: strikes and healing, multiplied. */
export const MIRACLE_SYNERGY_MULT = 1.25;

const PLAYER_CRIT = 'proc:crit';

const pctOf = (x: number): string => `${Math.round(x * 100)}%`;

const feed = (ctx: ActionCtx, text: string, damage?: DamageReport): void =>
  ctx.emit(feedLine, damage ? { text, damage } : { text });

const openFight = (ctx: ActionCtx): DeepReadonly<Fight> | null => ctx.read(combat).fight;
const alive = (ctx: ActionCtx): boolean => isAlive(ctx.read(resources));
const mine = (ctx: ActionCtx) => heldOf(ctx.read(statuses));
const heldBy = (ctx: ActionCtx, e: Foe) => heldOf(ctx.read(statuses), e.entity);
const statsOf = (ctx: ActionCtx, e: Foe): Readonly<DerivedStats> => statBlockOf(ctx, e.entity);
const penetrationOfFoe = (e: Foe): number => (MONSTERS[e.defId] ? penetrationOf(MONSTERS[e.defId]) : 0);
const living = (c: DeepReadonly<Fight>): number => c.enemies.filter((e) => e && e.hp > 0).length;
const randInt = (ctx: ActionCtx, min: number, max: number): number => min + ctx.rng.int(max - min + 1);

/** The key a monster's working is sealed under: per specimen, by slot. */
const sealKey = (e: Foe, index: number, slot: number): string => `${e.defId}:${index}:${slot}`;

// ---- a monster spends its action on a working ----

/**
 * Whether a monster's cast entry can be its turn's action. The cast branch
 * of the old `pickMonsterAction`. A string is a reason.
 */
export function monsterCastAvailable(
  ctx: ActionCtx,
  e: Foe,
  source: SpellSource,
  fight: DeepReadonly<Fight>,
  index: number,
): boolean | string {
  const issue = sourceIssue(source);
  if (issue) return issue;
  const spec = specForSource(source);
  // An undoing is never its own turn's action: it waits for the player's casting.
  if (spec.counter) return false;
  // A working only for its own side, with nobody else on that side standing, has nothing to do.
  const kinOnly = spec.target === 'others' && !spec.strikes.length && !spec.afflicts?.length;
  if (kinOnly && !fight.enemies.some((m) => !!m && m.entity !== e.entity && m.hp > 0)) {
    return `${spec.name} is for its kin only and no kin is standing`;
  }
  if (mindInDebt(e)) return `its mind is in debt and cannot shape ${spec.name}`;
  const slot = fight.enemies.findIndex((m) => m?.entity === e.entity);
  if (sealed(ctx, sealKey(e, index, slot))) return `${spec.name} is sealed for this fight`;
  return true;
}

/**
 * A monster casts. It pays no pool and never learns: the spell's own
 * cooldown is the whole governor. The tick sweeps the dead and checks the
 * player afterwards. The old `castMonsterWorking`.
 */
export function castMonsterWorking(ctx: ActionCtx, e: Foe, source: SpellSource, index: number): void {
  const spec = specForSource(source);
  ctx.request(stampAction, { entity: e.entity, index, cooldown: spec.cooldown, name: spec.name, icon: spec.icon });
  ctx.emit(spellCast, { caster: e.entity, school: spec.school, name: spec.name, manaCost: spec.manaCost, ...(spec.deity ? { deity: spec.deity } : {}) });
  const c = openFight(ctx);
  if (!c) return;
  const slot = c.enemies.findIndex((m) => m?.entity === e.entity);

  // The same argument, from the other side.
  const refusal = refute(ctx, sealKey(e, index, slot), spec.manaCost);
  if (refusal.negated) {
    if (refusal.backlash > 0) {
      ctx.request(hurtEnemy, { entity: e.entity, amount: Math.max(1, Math.round(refusal.backlash)), type: 'arcane', outgoing: true });
    }
    feed(
      ctx,
      refusal.sealed
        ? `🚫 Your body negates the ${e.name}'s ${spec.name}; it cannot cast it again this fight.`
        : `🚫 Your body negates the ${e.name}'s ${spec.name}.`,
    );
    return;
  }

  // The casting is visible before it resolves: stamped for triggers, and
  // offered to whatever undoing the player has in wait.
  ctx.request(noteCasting, {
    entity: e.entity,
    name: spec.name,
    school: spec.school,
    ...(leadingElement(spec) ? { element: leadingElement(spec) } : {}),
  });
  ctx.request(markEvent, { event: 'onEnemyCast' });
  let working = spec;
  let remaining = 1;
  const armed = pickCounterspell(ctx);
  if (armed) {
    const standing = living(c);
    remaining = springCounterspell(ctx, armed, e, spec);
    const now = openFight(ctx);
    if (!now || !alive(ctx)) return;
    // Its own answer may have reached the caster, or anyone else.
    const fell = living(now) !== standing;
    if (e.hp <= 0 || !now.enemies.some((m) => m?.entity === e.entity)) return;
    if (remaining <= 0) {
      feed(ctx, `↩️ The ${e.name}'s ${spec.name} is fully undone by your counterspell.`);
      return;
    }
    working = undoWorking(spec, remaining);
    if (fell) {
      feed(ctx, `${spec.icon} The ${e.name} casts ${spec.name} at ${pctOf(remaining)} strength (reduced by your counterspell).`);
      resolveMonsterWorking(ctx, e, working);
      return;
    }
  }

  feed(
    ctx,
    remaining < 1
      ? `${spec.icon} The ${e.name} casts ${spec.name} at ${pctOf(remaining)} strength (reduced by your counterspell).`
      : `${spec.icon} The ${e.name} casts ${spec.name}.`,
  );
  resolveMonsterWorking(ctx, e, working);
}

/**
 * What a monster's working does once it is decided that it happens: shared
 * by an ordinary cast and by a counterspell's payload. True when it left the
 * player at 0 HP. `spec.buff` is not read: a monster wears conditions
 * (`grants`). The old `resolveMonsterWorking`.
 */
function resolveMonsterWorking(ctx: ActionCtx, e: Foe, spec: SpellSpec): boolean {
  const c = openFight(ctx);
  if (!c) return false;
  const es = statsOf(ctx, e);
  // Its own side. `others`, said by a monster, is everyone else on that side.
  const kin = spec.target === 'others' ? c.enemies.filter((m): m is Foe => !!m && m.entity !== e.entity && m.hp > 0) : [e];
  if (spec.heal && !spec.healsEnemy) {
    for (const m of kin) {
      ctx.request(healEnemy, { entity: m.entity, amount: spec.heal * es.spellPower, source: spec.name, hostile: false });
    }
  }
  for (const m of kin) {
    for (const app of spec.grants ?? []) ctx.request(applyStatus, { entity: m.entity, app, source: spec.name });
  }

  // What it does to the player. Strikes arrive as any incoming damage does.
  const penetration = penetrationOfFoe(e);
  const boss = isSiteBoss(ctx.read(combat).site, e.defId);
  for (const strike of spec.strikes) {
    for (let h = 0; h < (strike.hits ?? 1); h++) {
      const raw = es.spellPower * strike.power * (0.9 + ctx.rng.next() * 0.2);
      const landed = strike.untyped
        ? Math.max(1, Math.round(raw))
        : incomingSlice(statBlockOf(ctx), strike.type, spec.name, raw).dealt;
      ctx.request(hitPlayer, {
        amount: landed,
        type: strike.type,
        source: { key: `monster:${e.defId}`, label: e.name, icon: e.icon, by: e.entity, thrown: raw, boss },
      });
      feed(ctx, `${spec.icon} ${spec.name} hits you for ${landed} ${strike.type}.`);
      if (landed > 0 && strike.inflicts?.length) {
        ctx.request(applyStatuses, { entity: PLAYER, apps: strike.inflicts, source: spec.name, resist: true, penetration });
      }
      if (!alive(ctx)) return true;
    }
  }
  // The working itself arriving, blow or no blow.
  if (spec.afflicts?.length) {
    ctx.request(applyStatuses, { entity: PLAYER, apps: spec.afflicts, source: spec.name, resist: true, penetration });
  }
  return false;
}

// ---- the player's working ----

/** The book entry of a rotation id, or undefined. */
export function spellOfId(state: SpellcraftReads, id: string): DeepReadonly<CraftedSpell> | undefined {
  if (!id.startsWith(GRIMOIRE_PREFIX)) return undefined;
  const uid = Number(id.slice(GRIMOIRE_PREFIX.length));
  return state.grimoire.find((spell) => spell.uid === uid);
}

/**
 * The bare reading of a book entry, with the player's name for it: what the
 * grimoire lists. The old `resolveSpell`.
 */
export function resolveSpell(spell: DeepReadonly<CraftedSpell>): SpellSpec {
  const spec = specForSource(spell.source as SpellSource);
  return spell.name ? { ...spec, name: spell.name } : spec;
}

/**
 * The spell as it reads in the caster's hands: the school's `reading` (the
 * arcane word levels), else the bare reading. Not cached. The old
 * `resolveSpellFor`.
 */
export function resolveSpellFor(reads: SchoolReads, spell: DeepReadonly<CraftedSpell>): SpellSpec {
  const source = spell.source as SpellSource;
  const spec = schoolOf(source.school)?.reading?.(reads, source);
  if (!spec) return resolveSpell(spell);
  return spell.name ? { ...spec, name: spell.name } : spec;
}

/** Succession synergy: a miracle cast soon after a friendly deity's miracle resonates with it. The old `miracleSynergy`. */
function miracleSynergy(ctx: ActionCtx, spec: SpellSpec): number {
  if (spec.school !== 'divine' || !spec.deity) return 1;
  const last = ctx.request(noteMiracle, { deity: spec.deity });
  if (!last || last.age > MIRACLE_SYNERGY_WINDOW) return 1;
  const relation = schoolOf('divine')?.relation?.(last.deity, spec.deity) ?? 'neutral';
  return relation === 'synergy' ? MIRACLE_SYNERGY_MULT : 1;
}

/** Whether any combatant, the caster included, carries one of these conditions. */
function anyAfflicted(ctx: ActionCtx, c: DeepReadonly<Fight>, ids: readonly string[]): boolean {
  if (mine(ctx).some((held) => ids.includes(held.id))) return true;
  return c.enemies.some((e) => e && heldBy(ctx, e).some((held) => ids.includes(held.id)));
}

/** Everything a spell does to its own caster besides damage: blessings and buffs. */
function applySelfRiders(ctx: ActionCtx, spec: SpellSpec): void {
  for (const app of spec.grants ?? []) ctx.request(applyStatus, { entity: PLAYER, app, source: spec.name });
  if (spec.buff) ctx.request(addBuff, { name: spec.buff.name, mods: spec.buff.mods, ticksLeft: spec.buff.duration });
}

function pay(ctx: ActionCtx, stats: Readonly<DerivedStats>, id: string, spec: SpellSpec): void {
  ctx.request(spendNow, { id: 'mana', amount: spec.manaCost * stats.manaEff });
  // A psionic working is paid out of the mind's own pool.
  if (spec.focusCost) ctx.request(spendNow, { id: 'focus', amount: spec.focusCost });
  if (spec.staminaCost) ctx.request(drawNow, { id: 'stamina', amount: spec.staminaCost });
  ctx.request(stampCooldown, { id, ticks: spec.cooldown });
}

const announce = (ctx: ActionCtx, id: string, spec: SpellSpec): void =>
  ctx.emit(spellCast, {
    caster: PLAYER,
    id,
    school: spec.school,
    name: spec.name,
    manaCost: spec.manaCost,
    ...(spec.deity ? { deity: spec.deity } : {}),
  });

/**
 * Saying a sentence is how its words are worn in: a grimoire working that
 * paid its cast XP tells the schools. The old `grantCastWordXp` call sites.
 */
function practised(ctx: ActionCtx, id: string): void {
  if (id.startsWith(GRIMOIRE_PREFIX)) ctx.emit(spellPractised, { id });
}

/** What casting on yourself teaches, whether or not anything survived to land. */
function selfCastXp(ctx: ActionCtx, id: string, spec: SpellSpec): void {
  ctx.emit(grantAttrXp, { attr: 'int', amount: 2 });
  const tags = ['magic', spec.school];
  ctx.emit(checkDiscovery, { tags });
  ctx.emit(grantSkillXp, { tags, amount: 3 });
  practised(ctx, id);
}

/** What an offensive cast teaches. */
function attackCastXp(ctx: ActionCtx, id: string, spec: SpellSpec): void {
  ctx.emit(grantAttrXp, { attr: 'int', amount: 3 });
  const tags = ['combat', 'magic', spec.school];
  ctx.emit(checkDiscovery, { tags });
  ctx.emit(grantSkillXp, { tags, amount: 4 });
  practised(ctx, id);
}

/**
 * Cast a prepared spell that lands on its own caster: wards, mendings, and
 * anything the grammar sent to "me". It fires from the buff slot. `prepaid`
 * is a counterspell's payload: already paid, clocked and trained by the
 * spring, and not itself answerable. The tick checks the player and sweeps
 * afterwards. The old `castCraftedSelf`.
 */
export function castCraftedSelf(ctx: ActionCtx, id: string, spec: SpellSpec, prepaid = false): void {
  const stats = statBlockOf(ctx);
  if (!prepaid) {
    pay(ctx, stats, id, spec);
    announce(ctx, id, spec);
    feed(ctx, `${spec.icon} You cast ${spec.name}.`);

    // An enemy's undoing may be waiting for exactly this.
    const answer = answerPlayerWorking(ctx, spec);
    if (answer.fatal || !openFight(ctx)) return;
    if (answer.remaining <= 0) {
      feed(ctx, `↩️ ${spec.name} is fully undone by the enemy's counterspell.`);
      selfCastXp(ctx, id, spec);
      return;
    }
    if (answer.remaining < 1) spec = undoWorking(spec, answer.remaining);
  }

  const synergy = miracleSynergy(ctx, spec);
  if (synergy > 1) feed(ctx, `✨ ${spec.name} gets ×${MIRACLE_SYNERGY_MULT} damage and healing (deity synergy with the previous miracle).`);

  if (spec.heal) {
    const healed = ctx.request(healNow, { amount: spec.heal * stats.spellPower * synergy, kind: 'spell' })?.healed ?? 0;
    if (healed > 0) feed(ctx, `💚 ${spec.name} heals you for ${Math.round(healed)} HP.`);
  }
  applySelfRiders(ctx, spec);
  for (const strike of spec.strikes) {
    for (let h = 0; h < (strike.hits ?? 1); h++) {
      const raw = stats.spellPower * strike.power * synergy * (0.9 + ctx.rng.next() * 0.2);
      // "Zero me": the caster's resistances have nothing to say to nothing.
      const dealt = strike.untyped
        ? Math.max(1, Math.round(raw))
        : incomingSlice(statBlockOf(ctx), strike.type, spec.name, raw).dealt;
      ctx.request(hitPlayer, {
        amount: dealt,
        type: strike.type,
        source: { key: `spell:${id}`, label: spec.name, icon: spec.icon, self: true },
      });
      feed(ctx, `${spec.icon} ${spec.name} hits you for ${dealt} ${strike.untyped ? 'untyped' : strike.type}.`);
      for (const app of strike.inflicts ?? []) ctx.request(applyStatus, { entity: PLAYER, app, source: spec.name, resist: true });
      if (!alive(ctx)) return;
    }
  }
  if (!prepaid) selfCastXp(ctx, id, spec);
}

/**
 * Cast a prepared offensive spell on the player's swing: several typed
 * strikes per cast, a clause landing twice, a broadside across the whole
 * formation, conditions riding each strike. `aimAt` is the slot of the
 * caster a counterspell's payload answers; such a payload is already paid,
 * clocked and trained. The tick sweeps the dead afterwards. The old
 * `castCraftedAttack`.
 */
export function castCraftedAttack(ctx: ActionCtx, id: string, spec: SpellSpec, aimAt?: number): void {
  const spring = aimAt !== undefined;
  const stats = statBlockOf(ctx);
  if (!spring) {
    // A refuting body argues with every working in the fight, its own included.
    // A refused working still costs what it cost.
    const refusal = refute(ctx, id, spec.manaCost * stats.manaEff);
    if (refusal.negated) {
      ctx.request(spendNow, { id: 'mana', amount: spec.manaCost * stats.manaEff });
      ctx.request(stampCooldown, { id, ticks: spec.cooldown });
      announce(ctx, id, spec);
      if (refusal.backlash > 0) ctx.request(hitPlayer, { amount: refusal.backlash, type: 'arcane' });
      feed(
        ctx,
        refusal.sealed
          ? `🚫 ${spec.name} is refused, and will not be spoken again this fight.`
          : `🚫 ${spec.name} is refused before it can finish.`,
      );
      return;
    }
    pay(ctx, stats, id, spec);
    announce(ctx, id, spec);

    // An enemy's undoing may be lying in wait for exactly this.
    const answer = answerPlayerWorking(ctx, spec);
    if (answer.fatal || !openFight(ctx)) return;
    if (answer.remaining <= 0) {
      feed(ctx, `↩️ ${spec.name} comes apart before it can land.`);
      attackCastXp(ctx, id, spec);
      return;
    }
    if (answer.remaining < 1) spec = undoWorking(spec, answer.remaining);
  }
  const c = openFight(ctx);
  if (!c) return;
  /** Who the working is aimed at: the front, or the caster a spring answered. */
  const aim = aimAt ?? 0;

  // Divine resonance and affliction-feeding, resolved once per cast.
  const synergy = miracleSynergy(ctx, spec);
  if (synergy > 1) feed(ctx, `✨ ${spec.name} gets ×${MIRACLE_SYNERGY_MULT} damage and healing (deity synergy with the previous miracle).`);
  const empowered = spec.empowered && anyAfflicted(ctx, c, spec.empowered.statuses) ? spec.empowered.mult : 1;
  if (empowered > 1) feed(ctx, `${spec.icon} ${spec.name} gets ×${empowered}: a poison condition is active in the fight.`);
  const castMult = synergy * empowered;

  // Strip the caster's own afflictions and deliver them to the aimed enemy, with interest.
  const aimed = c.enemies[aim];
  if (spec.transfers && aimed) {
    const taken = ctx.request(stripStatuses, { entity: PLAYER, ids: spec.transfers.statuses });
    if (taken.length) {
      for (const t of taken) {
        ctx.request(applyStatus, {
          entity: aimed.entity,
          app: { id: t.id, intensity: t.intensity * spec.transfers.mult },
          source: spec.name,
          penetration: stats.penetration,
        });
      }
      feed(ctx, `${spec.icon} ${spec.name} moves your poison conditions onto the target at ×${spec.transfers.mult} intensity.`);
    }
  }

  const targets = spec.target === 'others' ? c.enemies.map((e, i) => (e ? i : -1)).filter((i) => i >= 0) : [aim];
  // A broadside thins the working across everyone it addresses.
  const share = spec.target === 'others' ? OTHERS_POWER : 1;

  // "or": one alternative per group is rolled for the whole cast.
  let rolledOut: Set<SpellStrike> | null = null;
  {
    const groups = new Map<number, SpellStrike[]>();
    for (const strike of spec.strikes) {
      if (strike.altGroup === undefined) continue;
      (groups.get(strike.altGroup) ?? groups.set(strike.altGroup, []).get(strike.altGroup)!).push(strike);
    }
    for (const members of groups.values()) {
      const kept = members[randInt(ctx, 0, members.length - 1)];
      for (const m of members) {
        if (m === kept) continue;
        (rolledOut ??= new Set()).add(m);
      }
    }
  }

  let mainRaw = 0;
  for (const idx of targets) {
    const target = c.enemies[idx];
    if (!target) continue;
    // Hunter bonuses resolve against each victim separately, like weapon blows.
    const vs = statBlockOf(ctx, PLAYER, vsVariant(monsterTagSet(target.defId)));
    const slices = new Map<string, TypedSlice>();
    const steps: DamageStep[] = [{ label: 'Spell Power', value: vs.spellPower }];
    const powerMult = spec.strikes.reduce((sum, st) => sum + st.power * (st.hits ?? 1), 0) * share * castMult;
    if (powerMult !== 1) steps.push({ label: spec.name, mult: powerMult });
    steps.push({ label: 'Variance ±10%' });

    let anyCrit = false;
    // "then": a follow-up hits harder only if the strike before it landed on this target.
    let prevLanded = false;
    for (const strike of spec.strikes) {
      if (rolledOut?.has(strike)) continue;
      // A conditioned strike fires only while the target bears the named affliction.
      if (strike.onlyIf && !strike.onlyIf.some((sid) => heldBy(ctx, target).some((held) => held.id === sid))) {
        prevLanded = false;
        continue;
      }
      const follow = strike.followUp && prevLanded ? strike.followUp : 1;
      let landedAny = false;
      for (let h = 0; h < (strike.hits ?? 1); h++) {
        const critChance = Math.max(0, vs.crit + (strike.critBonus ?? 0) + magnetCritChance(heldBy(ctx, target), strike.type));
        const critted = ctx.request(rollProcChance, { key: PLAYER_CRIT, rate: critChance });
        let critMult = 1;
        if (critted) {
          anyCrit = true;
          // A crit is never worse than an ordinary blow.
          critMult = Math.max(
            1,
            vs.critDamage + (strike.critDamageBonus ?? 0) + ctx.request(consumeMagnetCharge, { entity: target.entity }),
          );
        }
        const raw = vs.spellPower * strike.power * share * castMult * follow * critMult * (0.9 + ctx.rng.next() * 0.2);
        if (idx === aim) mainRaw += raw;
        const theirs = statsOf(ctx, target);
        // A twin-natured strike lands as whichever type the target guards worse.
        const type: DamageType =
          strike.orType && theirs[RES_STAT_BY_TYPE[strike.orType]] < theirs[RES_STAT_BY_TYPE[strike.type]]
            ? strike.orType
            : strike.type;
        const landed: TypedSlice = strike.untyped
          ? { type, source: spec.name, raw, armor: 0, resisted: 0, resistance: 0, pierced: 0, dealt: raw }
          : monsterSlice(theirs, type, spec.name, raw, Math.min(0.95, vs.penetration + (strike.penetration ?? 0)));
        const key = `${landed.type}:${landed.source}`;
        const merged = slices.get(key);
        if (merged) {
          merged.raw += landed.raw;
          merged.armor += landed.armor;
          merged.resisted += landed.resisted;
          merged.pierced = Math.max(merged.pierced, landed.pierced);
          merged.warded = (merged.warded ?? 0) + (landed.warded ?? 0);
          merged.dealt += landed.dealt;
        } else {
          slices.set(key, { ...landed });
        }
        if (landed.dealt > 0) {
          landedAny = true;
          ctx.emit(strikeLanded, { target: target.entity, defId: target.defId, type, first: h === 0 });
          for (const app of strike.inflicts ?? []) {
            ctx.request(applyStatus, { entity: target.entity, app, source: spec.name, penetration: vs.penetration });
          }
        }
      }
      prevLanded = landedAny;
    }
    // The working itself arriving: these land whether or not anything was struck.
    for (const app of spec.afflicts ?? []) {
      ctx.request(applyStatus, { entity: target.entity, app, source: spec.name, penetration: vs.penetration });
    }
    // A working with nothing to land deals no damage and says nothing.
    if (slices.size > 0) {
      const landed = ctx.request(landSlices, { entity: target.entity, slices: [...slices.values()], crit: anyCrit });
      if (landed) {
        if (landed.bite !== 1) steps.push({ label: 'Conditions on the target', mult: landed.bite });
        feed(ctx, `${spec.icon} ${spec.name} strikes the ${target.name} for ${landed.dealt}${anyCrit ? ' — CRIT!' : ''}.`, {
          label: spec.name,
          target: target.name,
          steps,
          slices: [...slices.values()],
          hits: 1,
          crit: anyCrit,
          total: landed.dealt,
        });
      }
    }
  }

  // Spill from a single-target working that was told to be bigger ("expand").
  if (spec.target !== 'others' && (spec.splash ?? 0) > 0) {
    const flanks = c.enemies.map((e, i) => (e && i !== aim ? i : -1)).filter((i) => i >= 0);
    if (flanks.length > 0) {
      const other = c.enemies[flanks[randInt(ctx, 0, flanks.length - 1)]]!;
      const slice = monsterSlice(statsOf(ctx, other), spec.strikes[0]?.type ?? 'arcane', spec.name, mainRaw * (spec.splash ?? 0));
      const spill = Math.max(1, Math.round(slice.dealt));
      ctx.request(hurtEnemy, { entity: other.entity, amount: spill, type: slice.type });
      feed(ctx, `↯ ${spec.name} spills into the ${other.name} for ${spill}`);
    }
  }

  // A venom already at work on the aimed enemy is redoubled and refreshed,
  // after the strike, so the miracle's own fresh poison counts too.
  if (spec.amplify && aimed) {
    const touched = ctx.request(amplifyStatuses, { entity: aimed.entity, ids: spec.amplify.statuses, mult: spec.amplify.mult });
    if (touched > 0) feed(ctx, `${spec.icon} ${spec.name} multiplies the poison on the ${aimed.name} by ${spec.amplify.mult}.`);
  }

  // A mending that was addressed pours into the enemy; otherwise it tends the caster.
  if (spec.heal && spec.healsEnemy) {
    for (const idx of targets) {
      const target = c.enemies[idx];
      if (!target) continue;
      ctx.request(healEnemy, {
        entity: target.entity,
        amount: spec.heal * stats.spellPower * castMult * share,
        source: spec.name,
        hostile: true,
        penetration: stats.penetration,
      });
    }
  } else if (spec.heal) {
    const healed = ctx.request(healNow, { amount: spec.heal * stats.spellPower * castMult, kind: 'spell' })?.healed ?? 0;
    if (healed > 0) feed(ctx, `💚 ${spec.name} heals you for ${Math.round(healed)} HP.`);
  }
  applySelfRiders(ctx, spec);

  // Some conditions cost the player every time they attack.
  if (ctx.request(retaliateAttack, undefined)) return;

  // A spring's payload was trained by the spring that carried it.
  if (!spring) attackCastXp(ctx, id, spec);
}

// ---- anti-magic: counterspells ----

/** A prepared counterspell that has passed every gate and waits for a working. */
interface ArmedCounterspell {
  id: string;
  spec: SpellSpec;
}

/**
 * The player's counterspell ready to answer a working now: the first
 * prepared one in rotation order that is off its clock, not sealed,
 * affordable, and whose own trigger holds. The casting has been stamped, so
 * a trigger can ask what is being cast. The old `pickCounterspell`.
 */
function pickCounterspell(ctx: ActionCtx): ArmedCounterspell | null {
  const state = ctx.read(combat);
  const c = state.fight;
  if (!c) return null;
  const book = ctx.read(spellcraft);
  const stats = statBlockOf(ctx);
  const order = [
    ...state.rotation.filter((id) => id.startsWith(GRIMOIRE_PREFIX)),
    ...book.grimoire.filter((spell) => spell.prepared).map((spell) => `${GRIMOIRE_PREFIX}${spell.uid}`),
  ];
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const spell = spellOfId(book, id);
    if (!spell?.prepared) continue;
    if ((c.cooldowns[id] ?? 0) > 0) continue;
    if (sealed(ctx, id)) continue;
    // A working being held for a blade's opening is not also an undoing.
    if (heldSpell(ctx) === spell.uid) continue;
    const spec = resolveSpellFor(ctx, spell);
    if (!spec.counter) continue;
    // A rattled head cannot hold a spell together, an undoing included.
    if (statusBlocks(mine(ctx), 'spell')) continue;
    if (resourceValue(ctx.read(resources), 'mana') < spec.manaCost * stats.manaEff) continue;
    if (spec.focusCost && resourceValue(ctx.read(resources), 'focus') < spec.focusCost) continue;
    if (!triggerHolds(ctx, state.triggers[id])) continue;
    return { id, spec };
  }
  return null;
}

/** Everything a counterspell carries besides the undoing, or null when that is all it is. */
function counterPayload(spec: SpellSpec): SpellSpec | null {
  const carries =
    spec.strikes.length > 0 || !!spec.heal || !!spec.buff || (spec.grants?.length ?? 0) > 0 || (spec.afflicts?.length ?? 0) > 0;
  if (!carries) return null;
  const rest: SpellSpec = { ...spec };
  delete rest.counter;
  return rest;
}

/** Lay an undoing's burn on each bearer, once per application it was spoken with. The old `layBurn`. */
function layBurn(ctx: ActionCtx, bearers: readonly string[], intensity: number, times: number, source: string, penetration = 0): void {
  if (intensity <= 0) return;
  for (const entity of bearers) {
    for (let n = 0; n < times; n++) {
      // The player's arcane resistance thins a burn on arrival; a monster's is read off the monster.
      ctx.request(applyStatus, { entity, app: { id: 'manaburn', intensity }, source, resist: true, penetration });
    }
  }
}

/**
 * Spring the player's counterspell on a monster's working. It pays, clocks
 * and trains like a cast, then returns what is left of the working: 1
 * untouched, 0 undone entirely. The old `springCounterspell`.
 */
function springCounterspell(ctx: ActionCtx, armed: ArmedCounterspell, caster: Foe, working: SpellSpec): number {
  const { id, spec } = armed;
  const counter = spec.counter!;
  const stats = statBlockOf(ctx);
  const cost = spec.manaCost * stats.manaEff;
  // A refuting body argues with its own undoings too, and a refused one still costs what it cost.
  const refusal = refute(ctx, id, cost);
  pay(ctx, stats, id, spec);
  announce(ctx, id, spec);
  if (refusal.negated) {
    if (refusal.backlash > 0) ctx.request(hitPlayer, { amount: refusal.backlash, type: 'arcane' });
    feed(ctx, `🚫 ${spec.name} is negated by your own body before it can trigger.`);
    return 1;
  }

  const reading = counterEfficiency(counter, workingSignature(working));
  const burn = reading.efficiency * counter.burn * stats.spellPower;
  const c = openFight(ctx);
  // The address decides who burns: the caster it answered by default, every
  // enemy thinned for a broadside, and the speaker for "undo me".
  if (spec.target === 'self') layBurn(ctx, [PLAYER], burn, counter.burns ?? 1, spec.name);
  else if (spec.target === 'others') {
    const all = (c?.enemies ?? []).filter((m): m is Foe => !!m && m.hp > 0).map((m) => m.entity);
    layBurn(ctx, all, burn * OTHERS_POWER, counter.burns ?? 1, spec.name);
  } else layBurn(ctx, [caster.entity], burn, counter.burns ?? 1, spec.name);

  const undone = reading.efficiency >= 1 ? 'undone entirely' : `${pctOf(reading.efficiency)} of it undone`;
  feed(
    ctx,
    `🪤 ${spec.name} springs on the ${caster.name}'s ${working.name}: ${pctOf(reading.efficiency)} efficiency, ${undone}, manaburn ${Math.round(burn)}.`,
  );

  ctx.emit(grantAttrXp, { attr: 'int', amount: 3 });
  const tags = ['combat', 'magic', spec.school];
  ctx.emit(checkDiscovery, { tags });
  ctx.emit(grantSkillXp, { tags, amount: 4 });
  practised(ctx, id);

  // Whatever else the sentence carries goes off with it, at the caster.
  const payload = counterPayload(spec);
  if (payload) {
    const now = openFight(ctx);
    const slot = now?.enemies.findIndex((m) => m?.entity === caster.entity) ?? -1;
    if (payload.target === 'self') castCraftedSelf(ctx, id, payload, true);
    else if (caster.hp > 0 && slot >= 0) castCraftedAttack(ctx, id, payload, slot);
  }
  return Math.max(0, 1 - reading.efficiency);
}

/**
 * An enemy's undoing, answering the player's working. The first enemy
 * holding a ready counterspell springs it, the front first, and only one
 * answers any one working. Returns what is left of the working and whether
 * the answer left the player at 0 HP. The old `answerPlayerWorking`.
 */
function answerPlayerWorking(ctx: ActionCtx, working: SpellSpec): { remaining: number; fatal: boolean } {
  const c = openFight(ctx);
  if (!c) return { remaining: 1, fatal: false };
  const tick = totalTicksOf(ctx.read(clock));
  for (let slot = 0; slot < c.enemies.length; slot++) {
    const e = c.enemies[slot];
    if (!e || e.hp <= 0 || mindInDebt(e)) continue;
    // The terms of an honourable duel: everyone but the front can only watch.
    if (slot > 0 && statusPacifiesFlankers(mine(ctx))) continue;
    const rotation = kitOf(e as Enemy).rotation ?? [];
    for (let index = 0; index < rotation.length; index++) {
      const entry = rotation[index];
      if (!('cast' in entry)) continue;
      if ((e.cooldowns?.[index] ?? 0) > tick) continue;
      if (entry.uses !== undefined && (e.spent?.[index] ?? 0) >= entry.uses) continue;
      if (sourceIssue(entry.cast)) continue;
      const spec = specForSource(entry.cast);
      if (!spec.counter) continue;
      const key = sealKey(e, index, slot);
      if (sealed(ctx, key)) continue;
      return springEnemyCounter(ctx, e, index, key, spec, working);
    }
  }
  return { remaining: 1, fatal: false };
}

/** A monster's counterspell, sprung on the player's working. The old `springEnemyCounter`. */
function springEnemyCounter(
  ctx: ActionCtx,
  e: Foe,
  index: number,
  key: string,
  spec: SpellSpec,
  working: SpellSpec,
): { remaining: number; fatal: boolean } {
  ctx.request(stampAction, { entity: e.entity, index, cooldown: spec.cooldown, name: spec.name, icon: spec.icon });

  const refusal = refute(ctx, key, spec.manaCost);
  if (refusal.negated) {
    if (refusal.backlash > 0) {
      ctx.request(hurtEnemy, { entity: e.entity, amount: Math.max(1, Math.round(refusal.backlash)), type: 'arcane', outgoing: true });
    }
    feed(ctx, `🚫 Your body negates the ${e.name}'s counterspell against your ${working.name}.`);
    return { remaining: 1, fatal: false };
  }

  const counter = spec.counter!;
  const es = statsOf(ctx, e);
  const reading = counterEfficiency(counter, workingSignature(working));
  const burn = reading.efficiency * counter.burn * es.spellPower;
  // "Undo me" in a monster's mouth burns the monster. Its own penetration has nothing to say about itself.
  layBurn(
    ctx,
    [spec.target === 'self' ? e.entity : PLAYER],
    burn,
    counter.burns ?? 1,
    spec.name,
    spec.target === 'self' ? 0 : penetrationOfFoe(e),
  );
  const undone = reading.efficiency >= 1 ? 'undone entirely' : `${pctOf(reading.efficiency)} of it undone`;
  feed(
    ctx,
    `🪤 The ${e.name}'s ${spec.name} springs on your ${working.name}: ${pctOf(reading.efficiency)} efficiency, ${undone}, manaburn ${Math.round(burn)}.`,
  );

  const payload = counterPayload(spec);
  const fatal = payload ? resolveMonsterWorking(ctx, e, payload) : false;
  return { remaining: Math.max(0, 1 - reading.efficiency), fatal };
}

// ---- the kinds ----

registerMonsterAction('cast', {
  available(ctx, enemy, entry, fight, index) {
    if (!('cast' in entry)) return false;
    return monsterCastAvailable(ctx, enemy, entry.cast as SpellSource, fight, index);
  },
  perform(ctx, enemy, entry, index) {
    castMonsterWorking(ctx, enemy, (entry as { cast: SpellSource }).cast, index);
  },
});

registerPlayerAction(GRIMOIRE_PREFIX, {
  rank: 40,
  // Prepared spells ride the rotation; a spell that is not prepared is not offered.
  known: (ctx) =>
    ctx
      .read(spellcraft)
      .grimoire.filter((spell) => spell.prepared)
      .map((spell) => `${GRIMOIRE_PREFIX}${spell.uid}`),
  /** The grimoire branch of the old `pickActive`, in its order. */
  pick(ctx, id, slot): PickedActive | string | null {
    const spell = spellOfId(ctx.read(spellcraft), id);
    // Only spells still prepared count: a stale uid in the rotation is inert.
    if (!spell?.prepared) return null;
    if (sealed(ctx, id)) return `${resolveSpell(spell).name} is sealed for this fight`;
    // A working being held does not also go off by itself.
    if (heldSpell(ctx) === spell.uid) return null;
    const issue = sourceIssue(spell.source as SpellSource);
    if (issue) return issue;
    // Read in the caster's hands: the one place combat reads a crafted spell.
    const spec = resolveSpellFor(ctx, spell);
    // A counterspell is a trap: somebody else's casting springs it.
    if (spec.counter) return null;
    // Offensive spells swing on the action bar; wards, mendings and whatever
    // was sent at its own speaker fire as soon as ready. Healing an enemy is offensive.
    const offensive = spec.target !== 'self' && (spec.strikes.length > 0 || spec.healsEnemy === true);
    if ((slot === 'attack') !== offensive) return null;
    // A rattled head cannot hold a spell together.
    if (statusBlocks(mine(ctx), 'spell')) return `a condition blocks casting ${spec.name}`;
    const stats = statBlockOf(ctx);
    const pools = ctx.read(resources);
    const mana = spec.manaCost * stats.manaEff;
    if (resourceValue(pools, 'mana') < mana) return `not enough mana for ${spec.name}: it costs ${Math.round(mana * 10) / 10}`;
    if (spec.focusCost && resourceValue(pools, 'focus') < spec.focusCost) {
      return `not enough focus for ${spec.name}: it costs ${spec.focusCost}`;
    }
    return {
      id,
      cooldown: spec.cooldown,
      usesHands: false,
      ...(spec.sure ? { sure: true } : {}),
      ...(spec.strikes[0] ? { approach: spec.strikes[0].type } : {}),
      cast: offensive ? (c) => castCraftedAttack(c, id, spec) : (c) => castCraftedSelf(c, id, spec),
    };
  },
});
