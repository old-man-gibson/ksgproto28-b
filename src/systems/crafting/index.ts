/**
 * Crafting: recipes worked as a spot activity. Spend a route's inputs, bank
 * the product, on the activity bar of the world. Through floor 6 that is
 * the smelting line at the Forges. Port of old `systems/crafting.ts` and of
 * the craft half of old `systems/actions.ts`.
 *
 * The slice is empty: a craft's progress is the world's `activityProgress`.
 * The world cannot import this system, so this one registers the craft kind
 * with it at module load (`registerCraftKind`). See README.md in this folder.
 */
import { defineSystem, type Ctx } from '../../kernel';
import { grantAttrXpSplit } from '../attributes';
import { benchCrafted } from '../benches';
import { bumpCounter } from '../counters';
import { condsText, grantItem, grantRune } from '../items';
import { fillText, logLine, repeatLine, type TextRecord } from '../log';
import materials, { grantMaterial, takeMaterial } from '../materials';
import { checkDiscovery, grantSkillXp } from '../skills';
import type { DerivedStats } from '../stats';
import {
  activityCost,
  activityFillRate,
  activityXpTags,
  attrXpWeights,
  cycleDone,
  registerCraftKind,
  type ActivityDef,
  type Reads,
  type WorldState,
} from '../world';
import textData from './content/crafting_text.json';
import {
  canAfford,
  chooseRoute,
  craftingText,
  RECIPES,
  recipeCostText,
  recipeHidden,
  recipeResultIcon,
  recipeResultName,
  recipes,
  recipeUnlocked,
  routeYield,
  type RecipeDef,
} from './defs';
import { migrations } from './migrations';

export * from './defs';

const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));

// ---- slice ----

/** Empty. Version 1. */
export type CraftingState = Record<string, never>;

// ---- the craft activity ----

/** The craft activity of a recipe: id `craft_<recipe>`, the result's name and icon, the recipe's tags. */
export function craftActivity(recipe: RecipeDef): ActivityDef {
  return {
    id: `craft_${recipe.id}`,
    kind: 'craft',
    recipe: recipe.id,
    name: `Craft ${recipeResultName(recipe)}`,
    icon: recipeResultIcon(recipe),
    tags: recipe.tags,
  };
}

function outOfMaterials(ctx: Ctx<WorldState>, act: ActivityDef): void {
  ctx.emit(logLine, { msg: fillText(TEXT.out_of_materials, { name: act.name }), kind: 'action' });
}

/**
 * One tick of a craft activity: the craft branch of the old `tickAction`.
 * False when the craft stops (starved at the start of a cycle, or at its
 * end); the world then clears the activity.
 */
export function tickCraft(ctx: Ctx<WorldState>, act: ActivityDef, stats: Readonly<DerivedStats>): boolean {
  const recipe = act.recipe ? RECIPES[act.recipe] : undefined;
  if (!recipe) return true;
  const state = ctx.state;
  // Starved at the start of a cycle: stop instead of running a dead cycle.
  if (state.activityProgress === 0 && !canAfford(ctx.read(materials), recipe)) {
    outOfMaterials(ctx, act);
    return false;
  }
  const tags = activityXpTags(act);
  ctx.emit(checkDiscovery, { tags });
  state.activityProgress += activityFillRate(ctx, act, stats);
  if (state.activityProgress < activityCost(act, stats)) return true;
  // Reset, not carry, so the start-of-cycle guard holds.
  state.activityProgress = 0;
  const route = chooseRoute(ctx.read(materials), recipe);
  if (!route) {
    outOfMaterials(ctx, act);
    return false;
  }
  for (const c of route.cost) ctx.request(takeMaterial, { id: c.id, qty: c.qty });
  // The route that paid decides the yield. No craft activity has output factors.
  const qty = routeYield(recipe, route);
  if (recipe.result.kind === 'material') ctx.request(grantMaterial, { id: recipe.result.id, qty });
  else if (recipe.result.kind === 'rune') ctx.request(grantRune, { id: recipe.result.id, qty, silent: true });
  else for (let i = 0; i < qty; i++) ctx.request(grantItem, { defId: recipe.result.id });
  ctx.emit(grantSkillXp, { tags, amount: recipe.xp + 0.2 * recipe.ticks });
  // Empty unless the craft activity sets `attrXp`; none does.
  ctx.emit(grantAttrXpSplit, { weights: attrXpWeights(act), amount: 0.5 * recipe.ticks * stats.trainXp });
  ctx.emit(cycleDone, { spot: state.spot, activity: act.id, kind: act.kind, tags, baseTicks: recipe.ticks });
  ctx.emit(bumpCounter, { key: 'crafts' });
  ctx.emit(benchCrafted, { discipline: 'craft', recipe: recipe.id });
  ctx.emit(
    logLine,
    repeatLine({
      group: `act:${act.id}`,
      prefix: '🔨 Crafted',
      tally: [{ label: `${recipeResultIcon(recipe)} ${recipeResultName(recipe)}`, qty }],
      kind: 'item',
    }),
  );
  return true;
}

const held = (reads: Reads) => reads.read(materials);

registerCraftKind({
  activities: (ids) => ids.filter((id) => RECIPES[id]).map((id) => craftActivity(RECIPES[id])),
  ticks: (id) => RECIPES[id]?.ticks,
  unlocked: (reads, id) => !!RECIPES[id] && recipeUnlocked(reads, RECIPES[id]),
  hidden: (reads, id) => recipeHidden(reads, RECIPES[id]),
  affordable: (reads, id) => !!RECIPES[id] && canAfford(held(reads), RECIPES[id]),
  detail: (reads, id) => {
    const recipe = RECIPES[id];
    if (!recipe) return '';
    return recipeUnlocked(reads, recipe) ? `Cost: ${recipeCostText(held(reads), recipe)}` : `Requires: ${condsText(recipe.unlock)}`;
  },
  tick: tickCraft,
});

const crafting = defineSystem<CraftingState>({
  id: 'crafting',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { recipes, crafting_text: craftingText },
});

export default crafting;
