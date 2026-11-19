/**
 * The recipe registry and the route rules, with no state of their own. Port
 * of old `systems/crafting.ts` (`recipeUnlocked`, `recipeHidden`,
 * `recipeRoutes`, `chooseRoute`, `canAfford`, `routeYield`,
 * `recipeResultName`, `recipeResultIcon`, `recipeCostText`) and of the four
 * smelting records of `data/recipes.data.ts`.
 *
 * The old `consumeCost` is not here: the tick takes the chosen route's cost
 * through the request `materials/take`.
 */
import { registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import { conditionSchema, conditionsMet, type Condition } from '../counters';
import { ITEMS } from '../items';
import { MATERIALS, type MaterialsState } from '../materials';
import { textSchema } from '../log';
import { conditionReader } from '../skills';
import type { Reads } from '../world';
import recipesData from './content/recipes.json';
import textData from './content/crafting_text.json';

// ---- schemas ----

const costLine = s.object({ id: s.ref('materials'), qty: s.number({ min: 1 }) });

export const recipes = registry(
  s.object({
    id: s.id(),
    name: s.optional(s.string({ help: 'Name of the craft. Default: the name of the result.' })),
    secret: s.optional(s.boolean({ help: 'Not listed anywhere until `unlock` is met.' })),
    tags: s.array(s.string(), { help: 'The kind of work. Skill XP and a scoped craftSpeed read these.' }),
    result: s.object({
      kind: s.enum(['material', 'item', 'rune']),
      id: s.string({ help: 'A material, item or rune id, by `kind`.' }),
      qty: s.optional(s.number({ min: 1 })),
    }),
    cost: s.array(costLine, { help: 'The first route. A craft takes the earliest affordable route.' }),
    alts: s.optional(
      s.array(
        s.object({
          id: s.string({ help: 'Unique within the recipe.' }),
          cost: s.array(costLine),
          qty: s.optional(s.number({ min: 1, help: 'Overrides the result quantity on this route.' })),
        }),
      ),
    ),
    ticks: s.number({ min: 1, help: 'Base ticks per craft at craftSpeed 1.' }),
    xp: s.number({ min: 0, help: 'Skill XP per craft, before 0.2 per tick.' }),
    unlock: s.optional(s.array(conditionSchema)),
  }),
  recipesData,
  'Recipes',
);

export const craftingText = registry(textSchema, textData, 'Crafting text');

// ---- types ----

export interface CostLine {
  id: string;
  qty: number;
}

export interface RecipeAlt {
  id: string;
  cost: CostLine[];
  qty?: number;
}

export interface RecipeDef {
  id: string;
  name?: string;
  secret?: boolean;
  tags: string[];
  result: { kind: 'material' | 'item' | 'rune'; id: string; qty?: number };
  cost: CostLine[];
  alts?: RecipeAlt[];
  ticks: number;
  xp: number;
  unlock?: Condition[];
}

type RecipeRecord = RecordOf<typeof recipes>;

export const RECIPE_LIST: RecipeDef[] = recipesData as RecipeRecord[] as unknown as RecipeDef[];
export const RECIPES: Record<string, RecipeDef> = Object.fromEntries(RECIPE_LIST.map((r) => [r.id, r]));

/** Plain material counts, as the route rules read them. */
type Held = DeepReadonly<Pick<MaterialsState, 'counts'>>;

// ---- unlock ----

export function recipeUnlocked(reads: Reads, recipe: RecipeDef): boolean {
  return !recipe.unlock || conditionsMet(conditionReader(reads), recipe.unlock);
}

/** A secret recipe not yet unlocked: not listed at all. */
export function recipeHidden(reads: Reads, recipe: RecipeDef | undefined): boolean {
  return !!recipe?.secret && !recipeUnlocked(reads, recipe);
}

// ---- routes ----

/** Every route to the product, in the order they are considered. `cost` is route zero, id `primary`. */
export function recipeRoutes(recipe: RecipeDef): RecipeAlt[] {
  return [{ id: 'primary', cost: recipe.cost, qty: recipe.result.qty }, ...(recipe.alts ?? [])];
}

function affordable(held: Held, route: RecipeAlt): boolean {
  return route.cost.every((c) => (held.counts[c.id] ?? 0) >= c.qty);
}

/** The earliest affordable route. Declaration order is preference order. */
export function chooseRoute(held: Held, recipe: RecipeDef): RecipeAlt | null {
  return recipeRoutes(recipe).find((r) => affordable(held, r)) ?? null;
}

export function canAfford(held: Held, recipe: RecipeDef): boolean {
  return chooseRoute(held, recipe) !== null;
}

/** Yield of one craft along `route`, else the recipe's own, else 1. */
export function routeYield(recipe: RecipeDef, route: RecipeAlt | null): number {
  return route?.qty ?? recipe.result.qty ?? 1;
}

// ---- names ----

/** The recipe's name, else the result's. A rune result reads the material registry, as in the old build. */
export function recipeResultName(recipe: RecipeDef): string {
  if (recipe.name) return recipe.name;
  return recipe.result.kind === 'item'
    ? (ITEMS[recipe.result.id]?.name ?? recipe.result.id)
    : (MATERIALS[recipe.result.id]?.name ?? recipe.result.id);
}

/** The result's icon. A rune result reads the material registry, as in the old build. */
export function recipeResultIcon(recipe: RecipeDef): string {
  return recipe.result.kind === 'item' ? (ITEMS[recipe.result.id]?.icon ?? '🔨') : (MATERIALS[recipe.result.id]?.icon ?? '🔨');
}

function routeText(route: RecipeAlt, yieldQty: number, showYield: boolean): string {
  const inputs = route.cost.map((c) => `${MATERIALS[c.id]?.icon ?? ''}×${c.qty}`).join(' ');
  return showYield ? `${inputs} → ×${yieldQty}` : inputs;
}

/**
 * The cost line. Routes are joined with "or". When any route yields a
 * different amount, every route shows its yield. With `held`, the route a
 * craft would take now is marked "▸".
 */
export function recipeCostText(held: Held | null, recipe: RecipeDef): string {
  const routes = recipeRoutes(recipe);
  if (routes.length === 1) return routeText(routes[0], routeYield(recipe, routes[0]), false);
  const yields = routes.map((r) => routeYield(recipe, r));
  const varies = yields.some((y) => y !== yields[0]);
  const chosen = held ? chooseRoute(held, recipe) : null;
  return routes
    .map((r, i) => {
      const text = routeText(r, yields[i], varies);
      return chosen && r.id === chosen.id ? `▸${text}` : text;
    })
    .join(' or ');
}
