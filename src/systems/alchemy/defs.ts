/**
 * Alchemy content: reagents, forms and formulas. Port of old
 * `data/alchemy.data.ts` and `text/alchemy.text.ts`. See README.md.
 */
import { registry, s, type RecordOf } from '../../kernel';
import { textSchema, type TextRecord } from '../log';
import { RESOURCE_IDS } from '../resources';
import { DAMAGE_TYPES } from '../stats';
import { applicationSchema } from '../statuses';
import formsData from './content/brew_forms.json';
import formulasData from './content/brew_formulas.json';
import reagentsData from './content/reagents.json';
import textData from './content/alchemy_text.json';

export const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
export const alchemyText = registry(textSchema, textData, 'Alchemy text');

const SECOND = 10;

const essenceSchema = s.object({
  id: s.id(),
  name: s.string({ minLength: 1 }),
  power: s.number({ help: 'Potency an undissolved essence adds at Fair grade.' }),
  type: s.optional(s.enum(DAMAGE_TYPES)),
  inflicts: s.optional(s.array(applicationSchema, { help: 'Read by a Flask, a Fume and an Oil.' })),
  grants: s.optional(s.array(applicationSchema, { help: 'Read by an Elixir.' })),
  restore: s.optional(
    s.array(s.object({ resource: s.enum(RESOURCE_IDS), per: s.number({ help: 'Restored per point of potency share.' }) }), {
      help: 'Read by a Draught and a Salve.',
    }),
  ),
  cures: s.optional(s.array(s.string(), { help: 'Cure tags. Read by a Salve.' })),
});

const actSchema = s.object({
  kind: s.enum(['agitate', 'fix', 'ignite', 'clarify', 'corrode']),
  amount: s.optional(s.number({ help: 'agitate: volatility added.' })),
  needs: s.optional(s.number({ help: 'ignite: volatility it needs to catch.' })),
  mult: s.optional(s.number({ help: 'ignite, clarify, corrode: the multiplier.' })),
  penetration: s.optional(s.number({ help: 'corrode: armour pierce added.' })),
  purity: s.optional(s.number({ help: 'corrode: final potency multiplier.' })),
});

export const reagents = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Icon name of the bought art. Not in this repository.' })),
    minLevel: s.optional(s.number({ help: 'Alchemy level to use it.' })),
    menstruum: s.optional(
      s.object({ medium: s.enum(['water', 'oil', 'spirit']), body: s.number({ help: 'Potency the solvent holds.' }) }),
    ),
    essence: s.optional(essenceSchema),
    act: s.optional(actSchema),
    desc: s.string(),
  }),
  reagentsData,
  'Reagents',
);

export const brewForms = registry(
  s.object({
    id: s.enum(['elixir', 'draught', 'salve', 'oil', 'bomb', 'fume', 'residue']),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    verb: s.string(),
    thrown: s.boolean({ help: 'Needs a fight.' }),
    sustained: s.boolean(),
    desc: s.string(),
  }),
  formsData,
  'Brew forms',
);

export const brewFormulas = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    sequence: s.array(s.ref('reagents'), { help: 'Exact and ordered.' }),
    desc: s.string(),
  }),
  formulasData,
  'Brew formulas',
);

export type ReagentDef = RecordOf<typeof reagents>;
export type EssenceSpec = NonNullable<ReagentDef['essence']>;
export type BrewFormDef = RecordOf<typeof brewForms>;
export type BrewForm = BrewFormDef['id'];
export type BrewMedium = 'none' | 'water' | 'oil' | 'spirit';
export type BrewFormulaDef = RecordOf<typeof brewFormulas>;

export const REAGENT_LIST = reagentsData as unknown as ReagentDef[];
export const REAGENTS: Record<string, ReagentDef> = Object.fromEntries(REAGENT_LIST.map((r) => [r.id, r]));
export const BREW_FORMS = Object.fromEntries((formsData as unknown as BrewFormDef[]).map((f) => [f.id, f])) as Record<
  BrewForm,
  BrewFormDef
>;
export const BREW_FORMULAS = formulasData as unknown as BrewFormulaDef[];

/** The formula this exact sequence is, if it is one. */
export function formulaFor(sequence: readonly string[]): BrewFormulaDef | undefined {
  return BREW_FORMULAS.find((f) => f.sequence.length === sequence.length && f.sequence.every((id, i) => id === sequence[i]));
}

/** How long a sustained brew runs before anything is banked into it. */
export const BREW_BASE_DURATION = 45 * SECOND;
/** The longest a fixed brew can be stretched to. */
export const BREW_MAX_DURATION = 150 * SECOND;
