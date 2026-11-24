/**
 * People: who stands where, what they say, and the first greeting. Port of
 * `data/npcs.data.ts` (the records in scope) and of `npcsAt`, `npcDialogue`,
 * `talkTo`, `hasMet` and `metKey` of the old `systems/quests.ts`. See
 * README.md in this folder.
 *
 * Quests and shops read this registry; neither is imported here.
 */
import {
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  registry,
  s,
  skipped,
  type DeepReadonly,
  type Infer,
  type RecordOf,
} from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import counters, {
  bumpCounter,
  conditionRefIssues,
  conditionSchema,
  conditionsMet,
  counterValue,
  type Condition,
  type ConditionReader,
  type CountersState,
} from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { checkDiscovery, conditionReader, grantSkillXp } from '../skills';
import world from '../world';
import npcsData from './content/npcs.json';
import npcsTextData from './content/npcs_text.json';
import { migrations } from './migrations';

// ---- content ----

const QUALITY = ['f', 'e', 'd', 'c', 'b', 'a', 's'] as const;

/** One line of a shelf. `id` names an item or a material by `kind`; the shop tests check it resolves. */
const shopLineSchema = s.object({
  kind: s.enum(['material', 'item']),
  id: s.string({ help: 'An item id for kind "item", a material id for kind "material".' }),
  quality: s.optional(s.enum(QUALITY, { help: 'Graded wares are sold at this one grade. Default c.' })),
  price: s.optional(s.number({ min: 1, help: 'Flat asking price per unit. The no-arbitrage floor still applies.' })),
  requires: s.optional(s.array(conditionSchema)),
});

const npcs = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    spotId: s.ref('spots', { help: 'Where this person stands.' }),
    quests: s.array(s.ref('quests'), { help: 'Quests this person gives, in order.' }),
    shop: s.optional(s.object({ name: s.string(), lines: s.array(shopLineSchema) })),
    desc: s.string(),
    dialogue: s.array(s.string()),
    lore: s.optional(
      s.array(
        s.object(
          { requires: s.array(conditionSchema), dialogue: s.array(s.string()) },
          { help: 'Lines that join the dialogue once every condition holds (old `NpcDef.lore`).' },
        ),
      ),
    ),
  }),
  npcsData,
  'People',
);

const npcsText = registry(textSchema, npcsTextData, 'People text');
const TEXT = Object.fromEntries((npcsTextData as TextRecord[]).map((r) => [r.id, r.text]));

type NpcRecord = RecordOf<typeof npcs>;
export type ShopLine = Omit<Infer<typeof shopLineSchema>, 'requires'> & { requires?: Condition[] };
/** Lines that join a person's dialogue once every condition holds. */
export interface LoreEntry {
  requires: Condition[];
  dialogue: string[];
}
export type NpcDef = Omit<NpcRecord, 'shop' | 'lore'> & { shop?: { name: string; lines: ShopLine[] }; lore?: LoreEntry[] };

export const NPC_LIST = npcsData as unknown as NpcDef[];
export const NPCS: Record<string, NpcDef> = Object.fromEntries(NPC_LIST.map((n) => [n.id, n]));

// ---- reads ----

/** Tags an exchange with a person trains (the `speechcraft` skill). */
export const SOCIAL_TAGS = ['social'];

/** Base payout of one exchange, before the person's novelty is applied. */
export const QUEST_ACCEPT_XP = 8;

/** Where the game remembers a first greeting. */
export const metKey = (npcId: string): string => `met:${npcId}`;

export function hasMet(counts: DeepReadonly<CountersState>, npcId: string): boolean {
  return counterValue(counts, metKey(npcId)) >= 1;
}

export function npcsAt(spotId: string): NpcDef[] {
  return NPC_LIST.filter((n) => n.spotId === spotId);
}

/**
 * What this person says now: the dialogue, then the lines of every `lore`
 * entry whose conditions hold, in entry order. The old `npcDialogue`.
 */
export function npcDialogue(reader: ConditionReader, npc: NpcDef): string[] {
  const lines = [...npc.dialogue];
  for (const entry of npc.lore ?? []) {
    if (conditionsMet(reader, entry.requires)) lines.push(...entry.dialogue);
  }
  return lines;
}

/** The registries `loreIssues` resolves condition ids against. */
export interface LoreRefs {
  skills: Record<string, unknown>;
  quests: Record<string, unknown>;
}

/**
 * The lore lint of the old forge validator (`forge/lib/validate.ts`, the
 * `lore` half of its veil and lore rule): an entry needs a condition (or it
 * would always show) and a line, and its conditions name real skills and
 * quests. Empty when sound. The veil half is `veilIssues` in `bestiary`.
 */
export function loreIssues(people: readonly NpcDef[], refs: LoreRefs): { npc: string; message: string }[] {
  const issues: { npc: string; message: string }[] = [];
  for (const npc of people) {
    (npc.lore ?? []).forEach((entry, i) => {
      for (const message of conditionRefIssues(entry.requires, refs)) issues.push({ npc: npc.id, message });
      if (!entry.requires?.length) issues.push({ npc: npc.id, message: `lore entry ${i} has no conditions: it would always show` });
      if (!entry.dialogue?.length) issues.push({ npc: npc.id, message: `lore entry ${i} has nothing to say` });
    });
  }
  return issues;
}

// ---- events and commands ----

/** A first greeting was made. */
export const talked = defineEvent<{ npc: string }>('npcs/talked');

/** Greet a person standing here. The old `talkTo`. */
export const talkTo = defineCommand<{ npc: string }>('npcs/talk');

// ---- view ----

export interface NpcView {
  id: string;
  name: string;
  icon: string;
  desc: string;
  dialogue: string[];
  /** The line said now: `dialogueLine` of `dialogue`. Empty when there is none. */
  line: string;
  met: boolean;
  /** The name of the counter, or null for no shop. */
  shop: string | null;
}

/** Game ticks each line of a person's dialogue is said before the next (old `LocationPanel` `dialogueLine`). */
export const DIALOGUE_LINE_TICKS = 300;

/**
 * The line a person says at a clock tick: the lines rotate every
 * `DIALOGUE_LINE_TICKS` (30 seconds of play). The old people card's
 * `dialogueLine`. Empty with no lines.
 */
export function dialogueLine(lines: readonly string[], totalTicks: number): string {
  if (!lines.length) return '';
  return lines[Math.floor(totalTicks / DIALOGUE_LINE_TICKS) % lines.length];
}

export interface NpcsView {
  /** People at the spot the player stands on. */
  here: NpcView[];
}

export interface NpcsState {}

const system = defineSystem<NpcsState, NpcsView>({
  id: 'npcs',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { npcs, npcs_text: npcsText },

  commands: [
    handle(talkTo, (ctx, { npc: npcId }) => {
      const npc = NPCS[npcId];
      if (!npc) return skipped(`no person "${npcId}"`);
      if (ctx.read(world).spot !== npc.spotId) return skipped(`${npc.name} is not here`);
      if (hasMet(ctx.read(counters), npcId)) return skipped(`${npc.name} is already met`);
      ctx.emit(bumpCounter, { key: metKey(npcId) });
      ctx.emit(checkDiscovery, { tags: SOCIAL_TAGS });
      ctx.emit(grantSkillXp, { tags: SOCIAL_TAGS, amount: QUEST_ACCEPT_XP, sourceKey: npcId });
      ctx.emit(talked, { npc: npcId });
      ctx.emit(logLine, { msg: fillText(TEXT.quests_npc_met, { name: npc.name }), kind: 'quest' });
      return OK;
    }),
  ],

  view: (ctx) => {
    const { read } = ctx;
    const counts = read(counters);
    const people = npcsAt(read(world).spot);
    // A reader only where someone has lore: most spots have nobody who does.
    const reader = people.some((n) => n.lore?.length) ? conditionReader(ctx) : null;
    const now = people.length ? totalTicksOf(read(clock)) : 0;
    return {
      here: people.map((n) => {
        const dialogue = reader ? npcDialogue(reader, n) : [...n.dialogue];
        return {
          id: n.id,
          name: n.name,
          icon: n.icon,
          desc: n.desc,
          dialogue,
          line: dialogueLine(dialogue, now),
          met: hasMet(counts, n.id),
          shop: n.shop?.name ?? null,
        };
      }),
    };
  },
});

export default system;
