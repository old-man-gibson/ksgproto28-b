/**
 * Quests: taking work from a person, its objectives, and turning it in. Port
 * of the old `systems/quests.ts` without the greeting (that is `npcs`), and
 * of `data/quests.data.ts` (the quest in scope). See README.md in this folder.
 */
import {
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  on,
  OK,
  PLAYER,
  registry,
  s,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type Infer,
  type RecordOf,
  type SystemDef,
} from '../../kernel';
import { benchCrafted } from '../benches';
import { enemyKilled } from '../combat';
import counters, { bumpCounter, conditionSchema, conditionsMet, counterValue, setCounter, type Condition } from '../counters';
import { grantFavorAll } from '../divine';
import { addGold } from '../gold';
import { grantItem, ITEMS } from '../items';
import { grantLevelXp, questLevelXp } from '../levels';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import materials, { grantMaterial, heldOf, MATERIALS, takeStack } from '../materials';
import { hasMet, NPCS, QUEST_ACCEPT_XP, SOCIAL_TAGS } from '../npcs';
import { checkDiscovery, conditionReader, grantDiscoveryXp, grantSkillXp, grantSkillXpDirect } from '../skills';
import { namedFact } from '../stats';
import world, { arrived, SPOTS } from '../world';
import questsData from './content/quests.json';
import questsTextData from './content/quests_text.json';
import { migrations } from './migrations';

// ---- content ----

const objectiveSchema = s.object({
  type: s.enum(['kill', 'craft', 'reach', 'collect', 'talk', 'stat']),
  monsterId: s.optional(s.ref('monsters')),
  count: s.optional(s.number({ integer: true, min: 1 })),
  recipeId: s.optional(s.string({ help: 'A recipe id. Recipes arrive with crafting (step 3).' })),
  discipline: s.optional(s.string()),
  spotId: s.optional(s.ref('spots')),
  materialId: s.optional(s.ref('materials')),
  qty: s.optional(s.number({ integer: true, min: 1 })),
  npcId: s.optional(s.ref('npcs')),
  key: s.optional(s.string()),
  value: s.optional(s.number({ min: 0 })),
  at: s.optional(s.ref('spots', { help: 'Where the objective is usually done, for a Go link. Progress never reads it.' })),
  desc: s.optional(s.string()),
});

const quests = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    giver: s.ref('npcs'),
    requirements: s.optional(s.array(conditionSchema)),
    objectives: s.array(objectiveSchema),
    rewards: s.object({
      gold: s.optional(s.number({ min: 0 })),
      levelXp: s.optional(s.number({ min: 0 })),
      favor: s.optional(s.number({ min: 0, help: 'Divine favour with every known god, on top of the 1 every turn-in pays.' })),
      materials: s.optional(s.array(s.object({ id: s.ref('materials'), qty: s.number({ integer: true, min: 1 }) }))),
      items: s.optional(s.array(s.ref('items'))),
      skillXp: s.optional(s.array(s.object({ id: s.ref('skills'), xp: s.number({ min: 0 }) }))),
    }),
    desc: s.string(),
  }),
  questsData,
  'Quests',
);

const questsText = registry(textSchema, questsTextData, 'Quest text');
const TEXT = Object.fromEntries((questsTextData as TextRecord[]).map((r) => [r.id, r.text]));

export type QuestObjective = Infer<typeof objectiveSchema>;
export type QuestDef = Omit<RecordOf<typeof quests>, 'requirements'> & { requirements?: Condition[] };

export const QUEST_LIST = questsData as unknown as QuestDef[];
export const QUESTS: Record<string, QuestDef> = Object.fromEntries(QUEST_LIST.map((q) => [q.id, q]));

// ---- slice ----

export interface QuestProgress {
  status: 'active' | 'done';
  /** Stored progress per objective. Live objectives (collect, talk, stat) store nothing. */
  progress: number[];
}

export interface QuestsState {
  quests: Record<string, QuestProgress>;
}

type State = DeepReadonly<QuestsState>;
type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- reads ----

/**
 * A completed job against one new dialogue option: deliberately lopsided.
 * Finishing something is the lesson.
 */
export const QUEST_COMPLETE_WEIGHT = 4;

/** Stamped at accept and never cleared within the run. */
export const acceptedKey = (questId: string): string => `flag:quest:${questId}:accepted`;

/** The source that states `quest:<id>` for every quest turned in. */
export const DONE_SOURCE = 'quests/done';

/** Quests this person can offer now: never accepted, requirements met. */
export function availableQuests(ctx: ReadCtx, state: State, npcId: string): QuestDef[] {
  const npc = NPCS[npcId];
  if (!npc) return [];
  const r = conditionReader(ctx);
  return npc.quests
    .map((id) => QUESTS[id])
    .filter((q) => q && !state.quests[q.id] && (!q.requirements || conditionsMet(r, q.requirements)));
}

export function activeQuests(state: State): QuestDef[] {
  return Object.entries(state.quests)
    .filter(([, qs]) => qs.status === 'active')
    .map(([id]) => QUESTS[id])
    .filter(Boolean);
}

/** Current and target of an objective. Collect, talk and stat objectives read the save live. */
export function objectiveProgress(
  ctx: ReadCtx,
  state: State,
  quest: QuestDef,
  index: number,
): { current: number; target: number } {
  const o = quest.objectives[index];
  const stored = state.quests[quest.id]?.progress[index] ?? 0;
  switch (o.type) {
    case 'kill':
    case 'craft':
      return { current: Math.min(stored, o.count ?? 1), target: o.count ?? 1 };
    case 'reach':
      return { current: Math.min(stored, 1), target: 1 };
    case 'collect':
      return {
        current: Math.min(heldOf(ctx.read(materials), o.materialId ?? ''), o.qty ?? 1),
        target: o.qty ?? 1,
      };
    // Live like collect: greetings and counters are facts about the save, so
    // one made before the quest was accepted still counts.
    case 'talk':
      return { current: hasMet(ctx.read(counters), o.npcId ?? '') ? 1 : 0, target: 1 };
    case 'stat':
      return {
        current: Math.min(counterValue(ctx.read(counters), o.key ?? ''), o.value ?? 0),
        target: o.value ?? 0,
      };
  }
}

export function questComplete(ctx: ReadCtx, state: State, quest: QuestDef): boolean {
  if (state.quests[quest.id]?.status !== 'active') return false;
  return quest.objectives.every((_, i) => {
    const p = objectiveProgress(ctx, state, quest, i);
    return p.current >= p.target;
  });
}

/** Turning in means standing before the giver with everything done. */
export function canTurnIn(ctx: ReadCtx, state: State, quest: QuestDef): boolean {
  return questComplete(ctx, state, quest) && ctx.read(world).spot === NPCS[quest.giver]?.spotId;
}

// ---- events and commands ----

export const questAccepted = defineEvent<{ quest: string }>('quests/accepted');
export const questCompleted = defineEvent<{ quest: string }>('quests/completed');

/** Take a quest from its giver, standing at the giver's spot. The old `acceptQuest`. */
export const acceptQuest = defineCommand<{ quest: string }>('quests/accept');
/** Hand in a finished quest to its giver. The old `turnInQuest`. */
export const turnInQuest = defineCommand<{ quest: string }>('quests/turn-in');

function advanceObjectives(
  ctx: Ctx<QuestsState>,
  matches: (o: QuestObjective) => boolean,
  set?: number,
): void {
  for (const quest of activeQuests(ctx.state)) {
    let changed = false;
    quest.objectives.forEach((o, i) => {
      if (!matches(o)) return;
      // Live objectives store nothing; no listener ever matches them.
      if (o.type === 'collect' || o.type === 'talk' || o.type === 'stat') return;
      const qs = ctx.state.quests[quest.id];
      const target = o.type === 'reach' ? 1 : (o.count ?? 1);
      const next = set !== undefined ? set : qs.progress[i] + 1;
      if (qs.progress[i] < target && next !== qs.progress[i]) {
        qs.progress[i] = Math.min(target, next);
        changed = true;
      }
    });
    if (changed && questComplete(ctx, ctx.state, quest)) {
      const giver = NPCS[quest.giver];
      ctx.emit(logLine, {
        msg: fillText(TEXT.quests_ready, {
          name: quest.name,
          giver: giver?.name,
          spot: SPOTS[giver?.spotId ?? '']?.name ?? '?',
        }),
        kind: 'quest',
      });
    }
  }
}

// ---- view ----

export interface ObjectiveView {
  desc: string;
  current: number;
  target: number;
}

export interface QuestView {
  id: string;
  name: string;
  desc: string;
  giver: string;
  giverName: string;
  giverSpot: string;
  giverSpotName: string;
  objectives: ObjectiveView[];
  /** Everything is done. */
  complete: boolean;
  /** Complete and the giver stands here. */
  canTurnIn: boolean;
}

export interface QuestsView {
  /** Quests the people here offer now. */
  offered: QuestView[];
  active: QuestView[];
  done: { id: string; name: string }[];
}

function objectiveText(o: QuestObjective): string {
  if (o.desc) return o.desc;
  switch (o.type) {
    case 'kill':
      return `Kill ${o.count ?? 1} ${o.monsterId ?? 'monsters'}`;
    case 'reach':
      return `Reach ${SPOTS[o.spotId ?? '']?.name ?? o.spotId}`;
    case 'collect':
      return `Bring ${o.qty ?? 1} ${MATERIALS[o.materialId ?? '']?.name ?? o.materialId}`;
    case 'talk':
      return `Talk to ${NPCS[o.npcId ?? '']?.name ?? o.npcId}`;
    case 'stat':
      return `${o.key}: ${o.value}`;
    case 'craft':
      return `Craft ${o.count ?? 1} ${o.recipeId ?? o.discipline ?? ''}`;
  }
}

function questView(ctx: ReadCtx, state: State, quest: QuestDef): QuestView {
  const giver = NPCS[quest.giver];
  const spot = giver?.spotId ?? '';
  const known = !!state.quests[quest.id];
  return {
    id: quest.id,
    name: quest.name,
    desc: quest.desc,
    giver: quest.giver,
    giverName: giver?.name ?? quest.giver,
    giverSpot: spot,
    giverSpotName: SPOTS[spot]?.name ?? spot,
    objectives: quest.objectives.map((o, i) => {
      const p = known ? objectiveProgress(ctx, state, quest, i) : { current: 0, target: 1 };
      return { desc: objectiveText(o), current: p.current, target: p.target };
    }),
    complete: known && questComplete(ctx, state, quest),
    canTurnIn: known && canTurnIn(ctx, state, quest),
  };
}

// ---- the declaration ----

const system: SystemDef<QuestsState, QuestsView> = defineSystem<QuestsState, QuestsView>({
  id: 'quests',
  version: 1,
  migrations,
  initial: () => ({ quests: {} }),
  content: { quests, quests_text: questsText },

  modifiers: [
    {
      id: DONE_SOURCE,
      collect: ({ state, entity }) =>
        entity !== PLAYER
          ? []
          : Object.entries(state.quests)
              .filter(([, q]) => q.status === 'done')
              .map(([id]) => namedFact(`quest:${id}`, 1)),
    },
  ],

  commands: [
    handle(acceptQuest, (ctx, { quest: questId }) => {
      const quest = QUESTS[questId];
      if (!quest) return skipped(`no quest "${questId}"`);
      if (ctx.state.quests[questId]) return skipped(`${quest.name} was already taken`);
      const giver = NPCS[quest.giver];
      if (ctx.read(world).spot !== giver?.spotId) return skipped(`${giver?.name ?? quest.giver} is not here`);
      if (quest.requirements && !conditionsMet(conditionReader(ctx), quest.requirements))
        return skipped(`the requirements of ${quest.name} are not met`);

      ctx.state.quests[questId] = { status: 'active', progress: quest.objectives.map(() => 0) };
      ctx.emit(setCounter, { key: acceptedKey(questId), value: 1 });
      // Novelty is keyed to the giver: a fifth errand for one person teaches
      // less about people than a first word with a stranger.
      ctx.emit(checkDiscovery, { tags: SOCIAL_TAGS });
      ctx.emit(grantSkillXp, { tags: SOCIAL_TAGS, amount: QUEST_ACCEPT_XP, sourceKey: quest.giver });
      ctx.emit(questAccepted, { quest: questId });
      ctx.emit(logLine, { msg: fillText(TEXT.quests_accepted, { name: quest.name }), kind: 'quest' });
      return OK;
    }),

    handle(turnInQuest, (ctx, { quest: questId }) => {
      const quest = QUESTS[questId];
      if (!quest) return skipped(`no quest "${questId}"`);
      if (ctx.state.quests[questId]?.status !== 'active') return skipped(`${quest.name} is not active`);
      if (!questComplete(ctx, ctx.state, quest)) return skipped(`${quest.name} is not complete`);
      if (!canTurnIn(ctx, ctx.state, quest)) return skipped(`${NPCS[quest.giver]?.name ?? quest.giver} is not here`);

      // Collect objectives hand the goods over.
      for (const o of quest.objectives) {
        if (o.type !== 'collect' || !o.materialId) continue;
        ctx.request(takeStack, { id: o.materialId, quality: 'c', qty: o.qty ?? 1 });
      }

      const r = quest.rewards;
      const parts: string[] = [];
      if (r.gold) {
        ctx.request(addGold, { amount: r.gold, earned: true });
        parts.push(`${r.gold} gold`);
      }
      for (const m of r.materials ?? []) {
        ctx.request(grantMaterial, { id: m.id, qty: m.qty });
        parts.push(`${MATERIALS[m.id]?.name ?? m.id} ×${m.qty}`);
      }
      for (const itemId of r.items ?? []) {
        ctx.request(grantItem, { defId: itemId });
        parts.push(ITEMS[itemId]?.name ?? itemId);
      }
      for (const sx of r.skillXp ?? []) ctx.emit(grantSkillXpDirect, { skillId: sx.id, amount: sx.xp });
      const levelXp = questLevelXp(r.levelXp);
      if (levelXp > 0) parts.push(`${levelXp} level XP`);

      ctx.state.quests[questId].status = 'done';
      ctx.touch(DONE_SOURCE);
      ctx.emit(bumpCounter, { key: 'quests:completed' });
      // Seeing a job through pays as a discovery, and never wears out.
      ctx.emit(grantDiscoveryXp, { domain: 'dialogue', weight: QUEST_COMPLETE_WEIGHT });
      // A deed done for somebody earns favour with every known god: 1, plus
      // the quest's own favour reward. The old `grantFavorAll` call.
      ctx.request(grantFavorAll, { amount: 1 + (r.favor ?? 0) });
      ctx.emit(questCompleted, { quest: questId });
      ctx.emit(logLine, {
        msg: fillText(TEXT.quests_completed, {
          name: quest.name,
          rewards: parts.length ? fillText(TEXT.quests_rewards, { list: parts.join(', ') }) : '',
        }),
        kind: 'quest',
      });
      // After the turn-in line, so a level-up reads as its consequence.
      ctx.emit(grantLevelXp, { xp: levelXp });
      return OK;
    }),
  ],

  events: [
    on(enemyKilled, (ctx, { payload }) =>
      advanceObjectives(ctx, (o) => o.type === 'kill' && (!o.monsterId || o.monsterId === payload.defId)),
    ),
    on(arrived, (ctx, { payload }) => advanceObjectives(ctx, (o) => o.type === 'reach' && o.spotId === payload.spot, 1)),
    // The old bus event `craft`: bench work (step 3) and, later, craft activities.
    on(benchCrafted, (ctx, { payload }) =>
      advanceObjectives(
        ctx,
        (o) =>
          o.type === 'craft' &&
          (!o.recipeId || o.recipeId === payload.recipe) &&
          (!o.discipline || o.discipline === payload.discipline),
      ),
    ),
  ],

  view: (ctx) => {
    const state = ctx.state;
    const here = ctx.read(world).spot;
    const offered = Object.values(NPCS)
      .filter((n) => n.spotId === here)
      .flatMap((n) => availableQuests(ctx, state, n.id))
      .map((q) => questView(ctx, state, q));
    return {
      offered,
      active: activeQuests(state).map((q) => questView(ctx, state, q)),
      done: Object.entries(state.quests)
        .filter(([, q]) => q.status === 'done')
        .map(([id]) => ({ id, name: QUESTS[id]?.name ?? id })),
    };
  },
});

export default system;
