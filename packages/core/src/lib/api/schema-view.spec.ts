import {
  constraints,
  exampleFromSchema,
  mergeAllOf,
  resolveSchema,
  typeLabel,
  validateInput,
} from './schema-view.ts';
import type { ApiSchema } from './types.ts';

const none = () => undefined;

describe('resolveSchema', () => {
  const pet: ApiSchema = { type: 'object', description: 'A pet' };
  const lookup = (name: string) => (name === 'Pet' ? pet : undefined);

  it('replaces a reference with its target, keeping the description of the use', () => {
    expect(resolveSchema({ ref: 'Pet', description: 'mine' }, lookup)).toEqual({
      type: 'object',
      description: 'mine',
      ref: 'Pet',
    });
  });

  it('keeps a stub whose target is not available, and an expanded stub as it is', () => {
    expect(resolveSchema({ ref: 'Gone' }, lookup)).toEqual({ ref: 'Gone' });
    const expanded = { ref: 'Pet', type: 'string' } as ApiSchema;
    expect(resolveSchema(expanded, lookup)).toBe(expanded);
  });
});

describe('mergeAllOf', () => {
  it('merges properties and required, and calls the result an object', () => {
    const merged = mergeAllOf(
      {
        allOf: [
          { properties: { a: { type: 'string' } }, required: ['a'] },
          { properties: { b: { type: 'integer' } }, required: ['a', 'b'] },
        ],
      },
      none,
    );
    expect(Object.keys(merged.properties!)).toEqual(['a', 'b']);
    expect(merged.required).toEqual(['a', 'b']);
    expect(merged.type).toBe('object');
  });
});

describe('typeLabel', () => {
  it('names schemas that only have an enum, a const or a reference', () => {
    expect(typeLabel({ enum: ['a'] })).toBe('enum');
    expect(typeLabel({ enum: ['a'], nullable: true })).toBe('enum | null');
    expect(typeLabel({ const: 1 })).toBe('const');
    expect(typeLabel({ ref: 'Pet' })).toBe('Pet');
    expect(typeLabel({})).toBe('any');
    expect(typeLabel(undefined)).toBe('any');
    expect(typeLabel({ type: 'string', format: 'uuid' })).toBe('string<uuid>');
  });
});

describe('constraints', () => {
  it('lists every bound that is set', () => {
    expect(
      constraints({
        minimum: 1,
        maximum: 2,
        exclusiveMinimum: 0,
        exclusiveMaximum: 3,
        multipleOf: 1,
        minLength: 1,
        maxLength: 2,
        minItems: 1,
        maxItems: 2,
        pattern: '^a',
        uniqueItems: true,
      }),
    ).toEqual([
      'min 1',
      'max 2',
      'min (exclusive) 0',
      'max (exclusive) 3',
      'multiple of 1',
      'min length 1',
      'max length 2',
      'min items 1',
      'max items 2',
      'pattern ^a',
      'unique items',
    ]);
    expect(constraints({})).toEqual([]);
  });
});

describe('exampleFromSchema', () => {
  it('prefers examples, then const, then default, then enum', () => {
    expect(exampleFromSchema({ examples: [7, 8] }, none)).toBe(7);
    expect(exampleFromSchema({ const: 'c', default: 'd' }, none)).toBe('c');
    expect(exampleFromSchema({ default: 'd', enum: ['e'] }, none)).toBe('d');
    expect(exampleFromSchema({ enum: ['e', 'f'] }, none)).toBe('e');
  });
});

describe('validateInput', () => {
  const check = (
    schema: ApiSchema | undefined,
    text: string,
    required = false,
  ) => validateInput(schema, text, required);

  it('only complains about an empty value when it is required', () => {
    expect(check({ type: 'string' }, '', true)).toBe('Required');
    expect(check({ type: 'string' }, '')).toBeUndefined();
    expect(check(undefined, 'anything')).toBeUndefined();
  });

  it('checks enums and the type of numbers', () => {
    expect(check({ enum: ['a', 'b'] }, 'c')).toBe('Must be one of: a, b');
    expect(check({ type: 'integer' }, 'x')).toBe('Must be an integer');
    expect(check({ type: 'number' }, 'x')).toBe('Must be a number');
    expect(check({ type: 'integer' }, '1.5')).toBe('Must be an integer');
  });

  it('checks every bound of a number', () => {
    const n: ApiSchema = {
      type: 'number',
      minimum: 1,
      maximum: 9,
      exclusiveMinimum: 1,
      exclusiveMaximum: 9,
      multipleOf: 2,
    };
    expect(check(n, '0')).toBe('Must be at least 1');
    expect(check(n, '10')).toBe('Must be at most 9');
    expect(check({ type: 'number', exclusiveMinimum: 1 }, '1')).toBe(
      'Must be more than 1',
    );
    expect(check({ type: 'number', exclusiveMaximum: 9 }, '9')).toBe(
      'Must be less than 9',
    );
    expect(check({ type: 'number', multipleOf: 2 }, '3')).toBe(
      'Must be a multiple of 2',
    );
    expect(check(n, '4')).toBeUndefined();
  });

  it('checks booleans, lengths and patterns, and does not stop on a pattern it cannot read', () => {
    expect(check({ type: 'boolean' }, 'yes')).toBe('Must be true or false');
    expect(check({ type: 'boolean' }, 'true')).toBeUndefined();
    expect(check({ type: 'string', minLength: 3 }, 'ab')).toBe(
      'At least 3 characters',
    );
    expect(check({ type: 'string', maxLength: 1 }, 'ab')).toBe(
      'At most 1 characters',
    );
    expect(check({ type: 'string', pattern: '^a' }, 'b')).toBe('Must match ^a');
    expect(check({ type: 'string', pattern: '(' }, 'b')).toBeUndefined();
  });

  it('checks the items of a list typed as a,b,c', () => {
    const list: ApiSchema = {
      type: 'array',
      items: { type: 'integer' },
      minItems: 2,
      maxItems: 3,
    };
    expect(check(list, '1')).toBe('At least 2 items');
    expect(check(list, '1,2,3,4')).toBe('At most 3 items');
    expect(check(list, '1,x')).toBe('Must be an integer');
    expect(check(list, '1, 2')).toBeUndefined();
    expect(check({ type: 'array' }, 'a,b')).toBeUndefined();
  });
});
