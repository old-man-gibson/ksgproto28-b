/**
 * Content schemas. A schema is plain data, so the forge can draw a form from
 * it and the validator can walk it. `Infer` gives the TypeScript type of a
 * record, so a system does not write the record type a second time.
 */

interface Base {
  label?: string;
  help?: string;
  optional?: boolean;
}

export interface StringSchema extends Base {
  kind: 'string';
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface NumberSchema extends Base {
  kind: 'number';
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface BooleanSchema extends Base {
  kind: 'boolean';
}

export interface EnumSchema<V extends string = string> extends Base {
  kind: 'enum';
  values: readonly V[];
}

/** The id of a record in another registry (or the same one). */
export interface RefSchema extends Base {
  kind: 'ref';
  registry: string;
}

export interface ArraySchema<I = Schema> extends Base {
  kind: 'array';
  of: I;
}

export interface ObjectSchema<F = Record<string, Schema>> extends Base {
  kind: 'object';
  fields: F;
}

export type Schema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | EnumSchema
  | RefSchema
  | ArraySchema
  | ObjectSchema;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type Infer<S> = S extends { kind: 'string' }
  ? string
  : S extends { kind: 'number' }
    ? number
    : S extends { kind: 'boolean' }
      ? boolean
      : S extends { kind: 'enum'; values: readonly (infer V)[] }
        ? V
        : S extends { kind: 'ref' }
          ? string
          : S extends { kind: 'array'; of: infer I }
            ? Infer<I>[]
            : S extends { kind: 'object'; fields: infer F }
              ? Simplify<
                  {
                    [K in keyof F as F[K] extends { optional: true } ? never : K]: Infer<F[K]>;
                  } & {
                    [K in keyof F as F[K] extends { optional: true } ? K : never]?: Infer<F[K]>;
                  }
                >
              : never;

/** Record ids: lower case, digits and underscores, starting with a letter. */
export const ID_PATTERN = '^[a-z][a-z0-9_]*$';

type Options<T> = Omit<T, 'kind' | 'optional'>;

export const s = {
  string: (options: Options<StringSchema> = {}): StringSchema => ({ kind: 'string', ...options }),
  id: (options: Options<StringSchema> = {}): StringSchema => ({
    kind: 'string',
    pattern: ID_PATTERN,
    ...options,
  }),
  number: (options: Options<NumberSchema> = {}): NumberSchema => ({ kind: 'number', ...options }),
  boolean: (options: Options<BooleanSchema> = {}): BooleanSchema => ({ kind: 'boolean', ...options }),
  enum: <const V extends string>(
    values: readonly V[],
    options: Omit<Options<EnumSchema>, 'values'> = {},
  ): EnumSchema<V> => ({ kind: 'enum', values, ...options }),
  ref: (registry: string, options: Omit<Options<RefSchema>, 'registry'> = {}): RefSchema => ({
    kind: 'ref',
    registry,
    ...options,
  }),
  array: <I extends Schema>(of: I, options: Omit<Options<ArraySchema>, 'of'> = {}): ArraySchema<I> => ({
    kind: 'array',
    of,
    ...options,
  }),
  object: <F extends Record<string, Schema>>(
    fields: F,
    options: Omit<Options<ObjectSchema>, 'fields'> = {},
  ): ObjectSchema<F> => ({ kind: 'object', fields, ...options }),
  optional: <S extends Schema>(schema: S): S & { optional: true } => ({ ...schema, optional: true }),
};

export interface ValueIssue {
  /** Dotted path inside the value, empty for the value itself. */
  path: string;
  message: string;
}

export interface FoundRef {
  path: string;
  registry: string;
  id: string;
}

function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

/**
 * Check one value against a schema. Issues and references are appended to the
 * arrays given. References are collected, not resolved: resolving needs every
 * registry, which is the caller's job.
 */
export function validateValue(
  schema: Schema,
  value: unknown,
  path: string,
  issues: ValueIssue[],
  refs: FoundRef[],
): void {
  const fail = (message: string) => issues.push({ path, message });
  switch (schema.kind) {
    case 'string': {
      if (typeof value !== 'string') return void fail('expected a string');
      if (schema.minLength !== undefined && value.length < schema.minLength)
        fail(`shorter than ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        fail(`longer than ${schema.maxLength} characters`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
        fail(`does not match ${schema.pattern}`);
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return void fail('expected a finite number');
      if (schema.integer && !Number.isInteger(value)) fail('expected an integer');
      if (schema.min !== undefined && value < schema.min) fail(`below the minimum ${schema.min}`);
      if (schema.max !== undefined && value > schema.max) fail(`above the maximum ${schema.max}`);
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') fail('expected true or false');
      return;
    }
    case 'enum': {
      if (typeof value !== 'string' || !schema.values.includes(value))
        fail(`expected one of: ${schema.values.join(', ')}`);
      return;
    }
    case 'ref': {
      if (typeof value !== 'string') return void fail('expected a record id');
      refs.push({ path, registry: schema.registry, id: value });
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) return void fail('expected a list');
      value.forEach((item, index) => validateValue(schema.of, item, join(path, index), issues, refs));
      return;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return void fail('expected an object');
      const record = value as Record<string, unknown>;
      for (const [key, field] of Object.entries(schema.fields)) {
        if (record[key] === undefined) {
          if (!field.optional) issues.push({ path: join(path, key), message: 'missing' });
          continue;
        }
        validateValue(field, record[key], join(path, key), issues, refs);
      }
      for (const key of Object.keys(record)) {
        if (!(key in schema.fields)) issues.push({ path: join(path, key), message: 'unknown field' });
      }
      return;
    }
  }
}
