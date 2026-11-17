/**
 * The arcane grammar: a sentence of word ids parsed into clauses and composed
 * into a spell. Port of `parseSentence`, `composeArcane`, `splitWordId`,
 * `displayWord` and the tuning constants of the old `systems/arcane.ts`,
 * written by `scripts/port-arcane.py` from that file: the code is the old
 * code; the comments are new.
 *
 * Rules, in the order the composer reads them:
 *
 * - Words group into clauses. A clause holds one noun and one verb; a second
 *   noun or a second verb closes the clause and opens the next.
 * - Whichever core word came first leads the clause. Verb-led: power x0.85,
 *   mechanics (penetration, splash, grip, ward) x1.3. Noun-led: power x1.15,
 *   mechanics x0.8. A noun with no verb: power x0.8.
 * - An adverb belongs to the clause open when it is read. Before the core it
 *   is leading, after it trailing; `hits`, `crit` and `clock` read the
 *   position.
 * - A target word belongs to no clause; the last one spoken addresses the
 *   spell.
 * - A conjunction closes the clause before it and binds the one after:
 *   `then` (follow-through), `and` (fuse), `but` (transmute), `or`
 *   (alternatives), `if` (condition), `with` (accompany).
 * - Clause i that is not linked lands at share 1 / (1 + 0.5 i).
 * - A word repeated in a row deepens: power x1, x2.3, x3.9 and mana x1, x3,
 *   x6 for one, two and three. A fourth does not parse.
 *
 * There is no random draw: the same words in the same order give the same
 * spell.
 */
import type { SpellSpec, SpellStrike, SpellTarget } from '../spellcraft';
import { RES_STAT_BY_TYPE, type ContentMod, type DamageType } from '../stats';
import { STATUSES, type StatusApplication } from '../statuses';
import { ARCANE_WORDS, type ArcaneWordDef } from './defs';

// ---- tuning ----

/** How much the leading word of a clause dominates it. */
export const VERB_LED = { power: 0.85, mechanics: 1.3 };
export const NOUN_LED = { power: 1.15, mechanics: 0.8 };

/** A noun spoken with no verb. */
export const UNSHAPED_POWER = 0.8;

/** Clause i (from 0) that is not linked lands at this share. */
export const clauseShare = (i: number) => 1 / (1 + i * 0.5);

/** Base cooldown in ticks, before verbs and adverbs. */
export const BASE_COOLDOWN = 90;

/** The cooldown is held inside this range. */
export const COOLDOWN_RANGE: [number, number] = [30, 500];

/** A word may be spoken at most this many times in a row. */
export const MAX_STACK = 3;

/** A dimmed condition keeps at least this share of its intensity. */
export const INTENSITY_FLOOR = 0.15;

/** Power of a word spoken one, two and three times in a row. */
export const STACK_POWER = [1, 2.3, 3.9];

/** Mana of a word spoken one, two and three times in a row. */
export const STACK_MANA = [1, 3, 6];

/** Raw splash at which a working addresses every enemy. */
export const EVERYTHING_SPLASH = 1.5;

/** Sending a spell to `others` costs this multiple of its mana. */
export const OTHERS_MANA_MULT = 1.5;
/** How much of its own strength a word adds per level of its word skill, compounding per clause. */
export const WORD_POWER_PER_LEVEL = 0.015;

/** What one word's practice is worth to the clause it sits in. `levels` is absent for the bare reading. */
export function wordBonusFor(levels: Record<string, number> | undefined, wordId: string): number {
  return 1 + WORD_POWER_PER_LEVEL * (levels?.[wordId] ?? 0);
}

/**
 * The conditions a noun's signature affliction can be recognised as: the
 * inflicted ids and everything they escalate into.
 */
function signatureStatuses(apps: { id: string }[] | undefined): string[] {
  const out: string[] = [];
  for (const app of apps ?? []) {
    let id: string | undefined = app.id;
    while (id && !out.includes(id)) {
      out.push(id);
      id = STATUSES[id]?.escalatesTo;
    }
  }
  return out;
}

// ---- tokens ----

/** A sentence token: 'fire' is tier 1, 'fire:2' is the word two deep. */
export function splitWordId(token: string): { id: string; tier: number } {
  const [id, t] = token.split(':');
  return { id, tier: t ? Number(t) : 1 };
}

/** One token of a sentence: a word and how many times in a row it was said. `preCore` marks an adverb spoken before the noun and the verb of its clause. */
export interface SpokenWord {
  def: ArcaneWordDef;

  count: number;

  preCore?: boolean;
}

/** What a token reads as: the word, or what repetition made of it. */
export function displayWord(t: SpokenWord): string {
  if (t.count <= 1) return t.def.word;
  return t.def.stacked?.[t.count - 2] ?? `${t.def.word} ×${t.count}`;
}

/** One clause as the composer read it. `linked` is the conjunction that bound it to the clause before. */
export interface ArcaneClause {
  noun?: SpokenWord;
  verb?: SpokenWord;
  adverbs: SpokenWord[];

  led: 'noun' | 'verb';

  linked?: ArcaneWordDef;
}

/** A parsed sentence. */
export interface ArcaneParse {
  ok: boolean;
  reason?: string;
  clauses: ArcaneClause[];
  target: SpellTarget;

  words: ArcaneWordDef[];

  tokens: SpokenWord[];
}

// ---- parsing ----

/** Read a sentence into clauses. Grammar only: no legality check beyond the words existing. */
export function parseSentence(wordIds: string[]): ArcaneParse {
  const none = (reason: string): ArcaneParse => ({
    ok: false,
    reason,
    clauses: [],
    target: 'one',
    words: [],
    tokens: [],
  });
  const words: ArcaneWordDef[] = [];
  const spoken: { def: ArcaneWordDef; tier: number }[] = [];
  for (const raw of wordIds) {
    const { id, tier } = splitWordId(raw);
    const def = ARCANE_WORDS[id];
    if (!def) return none(`No such word: ${raw}`);
    if (tier !== 1 && (!Number.isInteger(tier) || tier < 1 || tier > MAX_STACK || !def.stacked)) {
      return none(`No such word: ${raw}`);
    }
    words.push(def);
    spoken.push({ def, tier });
  }

  const tokens: SpokenWord[] = [];
  for (const s of spoken) {
    const last = tokens[tokens.length - 1];
    if (last && last.def.id === s.def.id && s.def.kind !== 'target' && s.def.kind !== 'conjunction') {
      if (last.count + s.tier > MAX_STACK) {
        return none(`No mouth can hold a fourth "${s.def.word}"`);
      }
      last.count += s.tier;
    } else {
      tokens.push({ def: s.def, count: s.tier });
    }
  }

  const clauses: ArcaneClause[] = [];
  let target: SpellTarget = 'one';
  let open: ArcaneClause | null = null;

  let pendingLink: ArcaneWordDef | null = null;

  const close = () => {
    if (open && (open.noun || open.verb || open.adverbs.length)) clauses.push(open);
    open = null;
  };
  const openClause = (): ArcaneClause => {
    const clause: ArcaneClause = { adverbs: [], led: 'noun' };
    if (pendingLink) {
      clause.linked = pendingLink;
      pendingLink = null;
    }
    return clause;
  };

  for (const t of tokens) {
    const w = t.def;
    if (w.kind === 'target') {
      target = w.target ?? 'one';
      continue;
    }
    if (w.kind === 'conjunction') {
      if (!open && clauses.length === 0) {
        return none(`"${w.word}" follows nothing`);
      }
      if (pendingLink) return none(`"${w.word}" follows nothing`);
      close();
      pendingLink = w;
      continue;
    }
    open ??= openClause();
    if (w.kind === 'adverb') {
      if (!open.noun && !open.verb) t.preCore = true;
      open.adverbs.push(t);
      continue;
    }
    if (w.kind === 'noun') {
      if (open.noun) {
        close();
        open = openClause();
      }
      open.noun = t;
      if (!open.verb) open.led = 'noun';
      continue;
    }
    if (open.verb) {
      close();
      open = openClause();
    }
    open.verb = t;
    if (!open.noun) open.led = 'verb';
  }
  close();
  if (pendingLink) {
    return none(`"${(pendingLink as ArcaneWordDef).word}" leads nowhere`);
  }

  if (!clauses.some((c) => c.noun || c.verb)) {
    return { ok: false, reason: 'A spell needs a noun or a verb', clauses, target, words, tokens };
  }
  return { ok: true, clauses, target, words, tokens };
}

// ---- composing ----

/** Scale the intensity of applications, keeping their chance. */
function scaleInflicts(apps: StatusApplication[] | undefined, mult: number): StatusApplication[] | undefined {
  if (!apps || mult <= 0) return undefined;
  return apps.map((a) => ({ ...a, intensity: (a.intensity ?? 1) * mult }));
}

/** Scale how readily conditions take hold. Capped at 0.95. */
function scaleChance(apps: StatusApplication[] | undefined, mult: number): StatusApplication[] | undefined {
  if (!apps || mult === 1) return apps;
  return apps.map((a) => ({ ...a, chance: Math.min(0.95, (a.chance ?? 1) * mult) }));
}

/** Stretch or compress how long inflicted conditions run and scale their intensity. A condition with no lifetime of its own is left alone. */
function shapeConditions(
  apps: StatusApplication[] | undefined,
  durMult: number,
  intMult: number,
): StatusApplication[] | undefined {
  if (!apps || (durMult === 1 && intMult === 1)) return apps;
  return apps.map((a) => {
    const base = STATUSES[a.id]?.duration;
    const out: StatusApplication = { ...a, intensity: (a.intensity ?? 1) * intMult };
    if (base && durMult !== 1) out.duration = Math.max(1, Math.round(base * durMult));
    return out;
  });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What `with` can accompany: the last clause that acted. */
type Acting =
  | { kind: 'strike'; strike: SpellStrike }

  | { kind: 'ward'; base: number; duration: number }

  | { kind: 'mend'; restoreMult: number }
  | { kind: 'undo'; part: { burn: number; hits: number } };

/**
 * Compose a sentence into a spell, or null when it does not parse. Pure.
 * `levels` is how well the speaker knows each word (step 3); absent, the
 * bare reading.
 */
export function composeArcane(
  wordIds: string[],

  levels?: Record<string, number>,
): SpellSpec | null {
  const parse = parseSentence(wordIds);
  if (!parse.ok) return null;

  const strikes: SpellStrike[] = [];
  let heal = 0;
  let splash = 0;

  let splashRaw = 0;
  let manaCost = 0;
  let cooldownMult = 1;
  let wardMods: ContentMod[] = [];
  let wardDuration = 0;
  let target = parse.target;

  let shareIndex = -1;

  let altGroups = 0;

  let prevStrike: SpellStrike | null = null;

  let prevActing: Acting | null = null;

  const signature: Partial<Record<DamageType, number>> = {};

  let undoTiers = 0;
  const tuning: Partial<Record<DamageType, number>> = {};
  const undoParts: { burn: number; hits: number }[] = [];
  const tune = (noun: ArcaneWordDef, units: number) => {
    if (noun.untyped || !noun.element) return;
    tuning[noun.element] = (tuning[noun.element] ?? 0) + units;
  };

  parse.clauses.forEach((clause) => {
    if (!clause.linked) shareIndex += 1;
    const share = clauseShare(Math.max(0, shareIndex));
    const led = clause.led === 'verb' ? VERB_LED : NOUN_LED;
    const noun = clause.noun?.def;
    const verb = clause.verb?.def.verb;
    const nounStack = STACK_POWER[(clause.noun?.count ?? 1) - 1];
    const verbStack = STACK_POWER[(clause.verb?.count ?? 1) - 1];
    const verbCount = clause.verb?.count ?? 1;

    let powerMult = [clause.noun, clause.verb, ...clause.adverbs].reduce(
      (mult, t) => (t ? mult * wordBonusFor(levels, t.def.id) : mult),
      1,
    );
    let manaMult = 1;
    let hitsPre = 1;
    let hitsPost = 1;

    let condDur = 1;
    let condRate = 1;

    let condIntensity = 1;

    let critAdd = 0;

    let critDamageAdd = 0;
    for (const adv of clause.adverbs) {
      const a = adv.def.adverb;
      if (!a) continue;
      powerMult *= Math.pow(a.powerMult ?? 1, adv.count);

      manaMult *= a.manaMult ?? 1;
      cooldownMult *= Math.pow(a.cooldownMult ?? 1, adv.count);
      condIntensity *= Math.pow(a.intensity ?? 1, adv.count);
      if (a.crit) {
        const side = adv.preCore ? a.crit.lead : a.crit.trail;
        critAdd += (side?.chance ?? 0) * adv.count;
        critDamageAdd += (side?.damage ?? 0) * adv.count;
      }
      if (a.clock) {
        const side = adv.preCore ? a.clock.lead : a.clock.trail;
        condDur *= Math.pow(side.dur, adv.count);
        condRate *= Math.pow(side.rate, adv.count);
      }
      if (a.hits) {
        const landings = a.hits + (adv.count - 1);
        if (adv.preCore) hitsPre = Math.max(hitsPre, landings);
        else hitsPost = Math.max(hitsPost, landings);
      }
    }

    const hits = hitsPre;
    const depth = hitsPost;

    const spoken = [clause.noun, clause.verb, ...clause.adverbs];
    manaCost +=
      spoken.reduce(
        (sum, t) => sum + (t?.def.mana ?? 0) * STACK_MANA[(t?.count ?? 1) - 1],
        0,
      ) * manaMult * (clause.linked?.conjunction?.alternate ?? 1);

    if (verb?.cooldownMult) cooldownMult *= Math.pow(verb.cooldownMult, verbCount);

    if (noun && !noun.untyped && noun.element) {
      signature[noun.element] = (signature[noun.element] ?? 0) + (clause.noun?.count ?? 1);
    } else if (!noun && verb && verb.restore === undefined && !verb.ward && !verb.undo) {
      const substance = verb.bareType ?? 'arcane';
      signature[substance] = (signature[substance] ?? 0) + verbCount;
    }

    const linkedBy = clause.linked?.conjunction;
    if (linkedBy?.accompany !== undefined && prevActing && noun && clause.noun && !clause.verb) {
      const acting: Acting = prevActing;
      const floored = Math.max(INTENSITY_FLOOR, condIntensity);
      switch (acting.kind) {
        case 'undo':
          tune(noun, clause.noun.count);
          acting.part.burn *= powerMult * floored * depth;
          acting.part.hits = Math.max(acting.part.hits, hits);
          break;
        case 'strike': {
          const lent = shapeConditions(scaleInflicts(noun.inflicts, nounStack * depth * floored), condDur, condRate);
          if (lent) {
            const copies = hits > 1 ? Array.from({ length: hits }, () => lent.map((a) => ({ ...a }))).flat() : lent;
            acting.strike.inflicts = [...(acting.strike.inflicts ?? []), ...copies];
          }
          break;
        }
        case 'ward': {
          const amount =
            acting.base * nounStack * powerMult * floored * depth * condRate * share * linkedBy.accompany;
          wardMods = [
            ...wardMods,
            noun.element
              ? { stat: RES_STAT_BY_TYPE[noun.element], op: 'add' as const, value: amount }
              : { stat: 'armor' as const, op: 'add' as const, value: amount * 20 },
          ];
          wardDuration = Math.max(wardDuration, Math.max(1, Math.round(acting.duration * condDur * hits)));
          break;
        }
        case 'mend':
          heal += (noun.power ?? 0) * nounStack * acting.restoreMult * powerMult * share * hits * depth * linkedBy.accompany;
          break;
      }
      return;
    }

    if (verb?.undo) {
      undoTiers += verbCount;
      if (noun && clause.noun) tune(noun, clause.noun.count);
      const part = {
        burn:
          verb.undo.burn *
          (noun ? led.power : 1) *
          powerMult *
          share *
          Math.max(INTENSITY_FLOOR, condIntensity) *
          depth,
        hits,
      };
      undoParts.push(part);
      prevActing = { kind: 'undo', part };
      prevStrike = null;
      return;
    }

    if (verb?.restore !== undefined) {
      const base = noun ? (noun.power ?? 0) * nounStack * (verb.powerMult ?? 1) : 0.5;
      heal += base * verb.restore * verbStack * led.power * powerMult * share * hits * depth;
      prevStrike = null;
      prevActing = { kind: 'mend', restoreMult: (verb.powerMult ?? 1) * verb.restore * verbStack * led.power };
      return;
    }
    if (verb?.ward) {

      const amount =
        verb.ward.amount *
        verbStack *
        nounStack *
        led.mechanics *
        powerMult *
        Math.max(INTENSITY_FLOOR, condIntensity) *
        depth *
        condRate *
        share;
      wardMods = [
        ...wardMods,
        noun?.element
          ? { stat: RES_STAT_BY_TYPE[noun.element], op: 'add' as const, value: amount }
          :
            { stat: 'armor' as const, op: 'add' as const, value: amount * 20 },
      ];
      wardDuration = Math.max(
        wardDuration,
        Math.max(1, Math.round(verb.ward.duration * condDur * hits)),
      );
      prevStrike = null;
      prevActing = {
        kind: 'ward',
        base: verb.ward.amount * verbStack * led.mechanics,
        duration: verb.ward.duration,
      };
      return;
    }

    let power: number;
    if (noun && verb) power = (noun.power ?? 0) * nounStack * (verb.powerMult ?? 1) * led.power;
    else if (noun) power = (noun.power ?? 0) * nounStack * UNSHAPED_POWER;
    else power = (verb?.barePower ?? 0) * verbStack;
    power *= powerMult * share * depth;
    if (power <= 0) return;

    const mechanics = clause.verb ? led.mechanics : 1;
    const strike: SpellStrike = {
      type: noun?.element ?? (verb?.bareType ?? 'arcane'),
      power,
    };
    if (noun?.untyped) strike.untyped = true;
    if (critAdd !== 0) strike.critBonus = critAdd;
    if (critDamageAdd !== 0) strike.critDamageBonus = critDamageAdd;
    if (verb?.penetration) {
      strike.penetration = Math.min(0.95, verb.penetration * mechanics * verbStack);
    }
    if (hits > 1) strike.hits = hits;
    const grip = verb?.gripMult ? verb.gripMult * mechanics * verbStack : 1;
    const carried = noun?.inflicts ?? (noun ? undefined : verb?.bareInflicts);
    const inflicts = shapeConditions(
      scaleChance(
        scaleInflicts(carried, nounStack * grip * depth * Math.max(INTENSITY_FLOOR, condIntensity)),
        verb?.statusRate ? Math.pow(verb.statusRate, verbCount) * mechanics : 1,
      ),
      condDur,
      condRate,
    );
    if (inflicts) strike.inflicts = inflicts;
    if (verb?.splash) {
      const raw = verb.splash * mechanics * verbStack;
      splashRaw += raw;
      splash = Math.min(0.75, splash + raw);
    }
    const conj = clause.linked?.conjunction;
    if (conj && prevStrike) {
      if (conj.fuse) {
        if (prevStrike.untyped && !strike.untyped) {
          delete prevStrike.untyped;
          prevStrike.type = strike.type;
        } else if (!prevStrike.orType && strike.type !== prevStrike.type) {
          prevStrike.orType = strike.type;
        }
        prevStrike.power += strike.power * (strike.hits ?? 1) * conj.fuse;
        if (strike.penetration) {
          prevStrike.penetration = Math.max(prevStrike.penetration ?? 0, strike.penetration);
        }
        if (strike.inflicts) {
          prevStrike.inflicts = [...(prevStrike.inflicts ?? []), ...strike.inflicts];
        }
        return;
      }
      if (conj.transmute) {
        const donated = scaleInflicts(strike.inflicts, powerMult);
        prevStrike.inflicts =
          donated && hitsPre > 1
            ? Array.from({ length: hitsPre }, () => donated.map((a) => ({ ...a }))).flat()
            : donated;
        return;
      }
      if (conj.condition) {
        prevStrike.onlyIf = signatureStatuses(noun?.inflicts);
        return;
      }
      if (conj.alternate) {
        if (prevStrike.altGroup === undefined) prevStrike.altGroup = altGroups++;
        strike.altGroup = prevStrike.altGroup;
        prevStrike = strike;
        prevActing = { kind: 'strike', strike };
        strikes.push(strike);
        return;
      }
      if (conj.inheritPenetration) {
        strike.penetration = Math.max(strike.penetration ?? 0, prevStrike.penetration ?? 0) || undefined;
      }
      if (conj.followThrough) strike.followUp = conj.followThrough;
    }
    prevStrike = strike;
    prevActing = { kind: 'strike', strike };
    strikes.push(strike);
  });

  if (splashRaw >= EVERYTHING_SPLASH && target === 'one') {
    target = 'others';
    splash = 0;
  }

  manaCost += parse.words
    .filter((w) => w.kind === 'target' || w.kind === 'conjunction')
    .reduce((s, w) => s + (w.mana ?? 0), 0);
  if (parse.target === 'others') manaCost *= OTHERS_MANA_MULT;

  const cooldown = Math.round(
    Math.min(COOLDOWN_RANGE[1], Math.max(COOLDOWN_RANGE[0], BASE_COOLDOWN * cooldownMult)),
  );

  const spokeAddress = parse.words.some((w) => w.kind === 'target');
  const healsEnemy = heal > 0 && spokeAddress && target !== 'self';

  const lead = parse.clauses.find((c) => c.noun)?.noun ?? parse.clauses[0].verb;
  const spec: SpellSpec = {
    name: parse.tokens.map((t) => cap(displayWord(t))).join(' '),
    icon: lead?.def.icon ?? '✨',
    school: 'arcane',
    target,
    strikes,
    manaCost: Math.max(1, Math.round(manaCost)),
    cooldown,
  };
  if (heal > 0) spec.heal = heal;
  if (healsEnemy) spec.healsEnemy = true;
  if (splash > 0) spec.splash = splash;
  if (wardMods.length) spec.buff = { name: 'Ward', mods: wardMods, duration: wardDuration };
  if (undoTiers > 0) {
    spec.counter = { tiers: undoTiers, tuning, burn: undoParts.reduce((sum, p) => sum + p.burn, 0) };
    const burns = Math.max(1, ...undoParts.map((p) => p.hits));
    if (burns > 1) spec.counter.burns = burns;
  }
  if (Object.keys(signature).length) spec.signature = signature;
  return spec;
}
