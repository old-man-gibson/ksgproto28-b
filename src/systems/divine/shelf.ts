/**
 * The shelf of powers: filtering and grouping the deities. Port of
 * `queryDeities`, `pantheonOf`, `deityGroups` and `deitiesInRelation` of
 * old `systems/deities.ts`.
 */
import type { DeityRelation } from '../spellcraft';
import { DEITY_LIST, DEITY_TAGS, deityRelation, type DeityDef } from './defs';

/** A body of gods. The old `PantheonDef`. */
export interface PantheonDef {
  id: string;
  name: string;
  icon: string;
  desc?: string;
}

/**
 * Registered pantheons. Empty in the old data and here; a registered entry
 * enriches a membership tag with a description. Writable, as the old one.
 */
export const PANTHEONS: Record<string, PantheonDef> = {};

/** Every deity standing in the given relation to this one. */
export function deitiesInRelation(id: string, relation: DeityRelation, list: readonly DeityDef[] = DEITY_LIST): DeityDef[] {
  return list.filter((d) => d.id !== id && deityRelation(id, d.id) === relation);
}

/**
 * Which deities match a filter. Tags OR within an axis and AND across axes.
 * A search matches the name, the epithet or the description. `tags` are
 * tag values as deities carry them.
 */
export function queryDeities(
  query: { search?: string; tags?: readonly string[] } = {},
  list: readonly DeityDef[] = DEITY_LIST,
): DeityDef[] {
  const needle = query.search?.trim().toLowerCase() ?? '';
  const byAxis = new Map<string, string[]>();
  for (const tag of query.tags ?? []) {
    const axis = DEITY_TAGS[tag]?.category ?? 'other';
    byAxis.set(axis, [...(byAxis.get(axis) ?? []), tag]);
  }
  return list.filter((d) => {
    for (const tags of byAxis.values()) {
      if (!tags.some((t) => d.tags.includes(t))) return false;
    }
    if (!needle) return true;
    return `${d.name} ${d.epithet} ${d.desc}`.toLowerCase().includes(needle);
  });
}

/**
 * The pantheon a deity is counted among, or null. The `pantheon` field wins;
 * else the deity's membership tag. A registered pantheon is returned whole;
 * an unregistered membership tag reads as a pantheon with the tag's value as
 * id; an unknown claim is null.
 */
export function pantheonOf(d: DeityDef): PantheonDef | null {
  const claimed = d.pantheon ?? d.tags.find((t) => DEITY_TAGS[t]?.category === 'membership');
  if (!claimed) return null;
  const registered = PANTHEONS[claimed];
  if (registered) return registered;
  const tag = DEITY_TAGS[claimed];
  return tag ? { id: tag.tag, name: tag.name, icon: tag.icon } : null;
}

export interface DeityGroup {
  /** Null for the deities that claim no pantheon. */
  pantheon: PantheonDef | null;
  deities: DeityDef[];
}

/** Each pantheon with its deities, in first-seen order, then the unaffiliated as one last group. */
export function deityGroups(list: readonly DeityDef[] = DEITY_LIST): DeityGroup[] {
  const groups: DeityGroup[] = [];
  const alone: DeityDef[] = [];
  for (const d of list) {
    const pantheon = pantheonOf(d);
    if (!pantheon) {
      alone.push(d);
      continue;
    }
    const found = groups.find((g) => g.pantheon?.id === pantheon.id);
    if (found) found.deities.push(d);
    else groups.push({ pantheon, deities: [d] });
  }
  if (alone.length) groups.push({ pantheon: null, deities: alone });
  return groups;
}
