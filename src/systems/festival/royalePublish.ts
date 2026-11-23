/**
 * What the festival's view publishes of the royale (step 4 port C5). The old
 * `RoyaleField.svelte` and `FestivalPanel.svelte` read the game state and
 * derived these in the component; here the panel reads the published view,
 * so the derivations run in the view: the fog (which fighters and features
 * show), the radar, the section underfoot, the survivors in sight as people,
 * the plan's options and the hub's preview of the attempt's field.
 *
 * Cost: built only while an attempt holds the player. On the field it walks
 * the survivors once for the fog (`visibleFighters`, the old component's
 * `shown`), the 40 caches and dens for the features, and builds a display
 * line for each survivor in sight from a small cache. The whole field is
 * never copied: only the fighters in sight, and counts. The terrain is not in
 * the view; the panel rebuilds it from the seed (`royaleMap`, a memo).
 */
import { MONSTERS } from '../monsters';
import { ITEMS } from '../items';
import {
  ROYALE_CACHES,
  ROYALE_DENS,
  ROYALE_PLAN_SLOTS,
  ROYALE_SECTIONS,
  ROYALE_STRATEGIES,
  SURVIVOR_CHAMPION,
  type FieldFighter,
  type RoyaleField,
  type RoyaleStrategyDef,
} from './royaleData';
import { mapOf, sectionAt, sectionKnown, sightAt } from './royaleTerrain';
import { festivalMinutes, radarText, radarView, visibleFeatures, visibleFighters, type FieldFeature, type RadarView } from './royaleView';
import { royaleMap } from './royaleMap';
import { survivorBuild } from './survivorGen';

/** One survivor on the player's map. */
export interface RoyaleBodyView {
  id: number;
  x: number;
  y: number;
  hp: number;
  icon: string;
  /** Duelling another survivor or a den. */
  duel: boolean;
  /** In the player's fight. */
  engaged: boolean;
  /** The radar's target. */
  radar: boolean;
}

/** One survivor in sight, as a person: the generated build's name and weapon. */
export interface RoyaleSightedView {
  id: number;
  icon: string;
  name: string;
  weapon: string;
  tools: number;
  engaged: boolean;
}

export interface RoyaleFeatureView extends FieldFeature {
  /** The den the player is fighting now. */
  fight: boolean;
  /** The section's display name. */
  sectionName: string;
  /** The guarding den's name, for a shut cache. */
  guardName: string;
}

/** The field while the player stands on it. */
export interface RoyaleFieldView {
  /** The terrain's seed: the panel draws `royaleMap(seed)`. */
  seed: number;
  size: number;
  player: { x: number; y: number; target: { x: number; y: number } | null };
  /** Survivors on the field. */
  standing: number;
  duelling: number;
  /** Survivors in the player's fight. */
  engaged: number;
  /** One survivor left: the champion. */
  last: boolean;
  radar: RadarView;
  /** "Radar: on in 42 min (42 s of play)" while off, "Radar: nearest fighter 34 units, north-east" once on. */
  radarLine: string;
  /** The section under the player: name, pace and sight; null on open meadow. */
  here: { name: string; pace: number; sight: number } | null;
  /** How far the player sees from where they stand, in field units. */
  sight: number;
  /** The survivors on the player's map, far to near. */
  bodies: RoyaleBodyView[];
  /** The same survivors, nearest first, as people. */
  sighted: RoyaleSightedView[];
  /** Caches and dens on the player's map. */
  features: RoyaleFeatureView[];
  /** A fight is open on the field. */
  fighting: boolean;
}

/** One strategy as the plan's pickers offer it. */
export interface RoyaleStrategyOption {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** "always", "while below 50% health", "while more than 30 left". */
  when: string;
}

/** The player's ranked plan and every strategy that may go in it. */
export interface RoyalePlanView {
  ids: string[];
  slots: number;
  options: RoyaleStrategyOption[];
  /** A hand-set destination on the field holds: "Back to the plan" clears it. */
  target: boolean;
}

/** The hub's preview of this attempt's field, as far as the survey has scouted it. */
export interface RoyalePreviewView {
  seed: number;
  size: number;
  /** Caches and dens of scouted sections only. */
  features: FieldFeature[];
  sections: { id: string; icon: string; name: string; scouted: boolean; caches: number; dens: number }[];
  scouted: number;
}

/** "while below 50% health", "while more than 30 left": the condition, from the data. The old `whenText`. */
export function whenText(s: Pick<RoyaleStrategyDef, 'when'>): string {
  const w = s.when;
  if (!w) return 'always';
  const parts: string[] = [];
  if (w.hpBelow !== undefined) parts.push(`below ${Math.round(w.hpBelow * 100)}% health`);
  if (w.fieldAbove !== undefined) parts.push(`more than ${w.fieldAbove} left`);
  if (w.fieldBelow !== undefined) parts.push(`fewer than ${w.fieldBelow} left`);
  return `while ${parts.join(' and ')}`;
}

const OPTIONS: RoyaleStrategyOption[] = Object.values(ROYALE_STRATEGIES).map((s) => ({
  id: s.id,
  name: s.name,
  icon: s.icon,
  desc: s.desc,
  when: whenText(s),
}));

/** The plan as the view shows it: the ranked ids (the default plan when none is set). */
export function planView(ids: readonly string[], target: boolean): RoyalePlanView {
  return { ids: [...ids], slots: ROYALE_PLAN_SLOTS, options: OPTIONS, target };
}

/**
 * A survivor's name and weapon for the list in sight, by seed, id and tools:
 * a small memo, cleared whole when full, so the view does not run the
 * generator for every survivor in sight on every frame.
 */
const PEOPLE = new Map<string, { name: string; weapon: string }>();
const PEOPLE_MAX = 512;

function personOf(seed: number, f: Pick<FieldFighter, 'id' | 'monsterId' | 'tools'>): { name: string; weapon: string } {
  const key = `${seed}|${f.id}|${f.monsterId}|${(f.tools ?? []).join(',')}`;
  let hit = PEOPLE.get(key);
  if (!hit) {
    if (PEOPLE.size >= PEOPLE_MAX) PEOPLE.clear();
    const build = survivorBuild(seed, f);
    hit = { name: build.name, weapon: build.weapon ? (ITEMS[build.weapon]?.name ?? build.weapon) : 'bare hands' };
    PEOPLE.set(key, hit);
  }
  return hit;
}

const DEN_NAME = new Map(ROYALE_DENS.map((d) => [d.id, d.name]));

const featureView = (f: FieldFeature, denFight: string | undefined): RoyaleFeatureView => ({
  ...f,
  fight: f.kind === 'den' && denFight === f.id,
  sectionName: ROYALE_SECTIONS[f.section]?.name ?? f.section,
  guardName: f.guard ? (DEN_NAME.get(f.guard) ?? f.guard) : '',
});

/**
 * The field as the player's map shows it at world tick `now`. `counter`
 * reads the run's counters (the survey's scouted flags). The old
 * `RoyaleField.svelte` derivations.
 */
export function fieldView(
  field: Readonly<RoyaleField>,
  now: number,
  counter: (key: string) => number,
  fighting: boolean,
): RoyaleFieldView {
  const f = field as RoyaleField;
  const map = mapOf(f);
  const p = f.player;
  const radar = radarView(f, now);
  const shown = visibleFighters(map, f, radar);
  const radarId = radar.state === 'on' ? radar.target?.id : undefined;
  const last = f.fighters.length === 1;
  const iconOf = (x: FieldFighter): string => MONSTERS[last ? SURVIVOR_CHAMPION : x.monsterId]?.icon ?? '❔';
  const d2 = (x: FieldFighter) => (x.x - p.x) ** 2 + (x.y - p.y) ** 2;
  const here = sectionAt(map, p.x, p.y);
  let engaged = 0;
  for (const x of f.fighters) if (x.engaged) engaged += 1;
  return {
    seed: f.seed ?? 0,
    size: f.size,
    player: { x: p.x, y: p.y, target: p.target ? { x: p.target.x, y: p.target.y } : null },
    standing: f.fighters.length,
    duelling: shown.filter((x) => x.duel).length,
    engaged,
    last,
    radar,
    // "Label: fact": the old line read "Radar in 42 min (42s of play)" while off.
    radarLine:
      radar.state === 'off' ? `Radar: on in ${festivalMinutes(radar.left)} min (${Math.ceil(radar.left / 10)} s of play)` : radarText(radar),
    here: here ? { name: here.name, pace: here.pace, sight: here.sight } : null,
    sight: sightAt(map, p.x, p.y),
    bodies: [...shown]
      .sort((a, b) => a.x + a.y - (b.x + b.y))
      .map((x) => ({ id: x.id, x: x.x, y: x.y, hp: x.hp, icon: iconOf(x), duel: !!x.duel, engaged: !!x.engaged, radar: x.id === radarId })),
    sighted: [...shown]
      .sort((a, b) => d2(a) - d2(b))
      .map((x) => {
        const person = personOf(f.seed ?? 0, x);
        return { id: x.id, icon: iconOf(x), name: person.name, weapon: person.weapon, tools: x.tools?.length ?? 0, engaged: !!x.engaged };
      }),
    features: visibleFeatures(map, f, (id) => sectionKnown(counter, f, id), p).map((x) => featureView(x, f.denFight)),
    fighting,
  };
}

/** The hub's preview of the field the royale will open on: scouted sections only (the survey's flags), nothing by sight. */
export function previewView(seed: number, counter: (key: string) => number): RoyalePreviewView {
  const map = royaleMap(seed);
  const sections = Object.values(ROYALE_SECTIONS).map((s) => ({
    id: s.id,
    icon: s.icon,
    name: s.name,
    scouted: sectionKnown(counter, undefined, s.id),
    caches: ROYALE_CACHES.filter((c) => c.section === s.id).length,
    dens: ROYALE_DENS.filter((d) => d.section === s.id).length,
  }));
  return {
    seed,
    size: map.size,
    features: visibleFeatures(map, undefined, (id) => sectionKnown(counter, undefined, id)),
    sections,
    scouted: sections.filter((r) => r.scouted).length,
  };
}
