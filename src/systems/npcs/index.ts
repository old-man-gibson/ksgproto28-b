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
import counters, { bumpCounter, conditionSchema, counterValue, type Condition, type CountersState } from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { checkDiscovery, grantSkillXp } from '../skills';
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
  }),
  npcsData,
  'People',
);

const npcsText = registry(textSchema, npcsTextData, 'People text');
const TEXT = Object.fromEntries((npcsTextData as TextRecord[]).map((r) => [r.id, r.text]));

type NpcRecord = RecordOf<typeof npcs>;
export type ShopLine = Omit<Infer<typeof shopLineSchema>, 'requires'> & { requires?: Condition[] };
export type NpcDef = Omit<NpcRecord, 'shop'> & { shop?: { name: string; lines: ShopLine[] } };

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
 * What this person says now. The old `npcDialogue` also added `lore` lines
 * whose conditions hold; no person in scope has any.
 */
export function npcDialogue(npc: NpcDef): string[] {
  return [...npc.dialogue];
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
  met: boolean;
  /** The name of the counter, or null for no shop. */
  shop: string | null;
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

  view: ({ read }) => {
    const counts = read(counters);
    return {
      here: npcsAt(read(world).spot).map((n) => ({
        id: n.id,
        name: n.name,
        icon: n.icon,
        desc: n.desc,
        dialogue: npcDialogue(n),
        met: hasMet(counts, n.id),
        shop: n.shop?.name ?? null,
      })),
    };
  },
});

export default system;
