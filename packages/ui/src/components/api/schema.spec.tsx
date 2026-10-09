import type { ApiOperationData, ApiSchema } from '@dockudos/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiOperation } from './context.tsx';
import { SchemaTree } from './schema.tsx';

const SCHEMAS: Record<string, ApiSchema> = {
  Item: { type: 'object', properties: { label: { type: 'string' } } },
  Rec: { type: 'object', properties: { kids: { type: 'array', items: { ref: 'Rec' } } } },
  Loop: { allOf: [{ ref: 'Loop' }] },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = /\/([^/]+)\.json$/.exec(url)?.[1] as string;
      if (name === '~boom') return Promise.reject('boom');
      const schema = SCHEMAS[name.replace(/~(.)/g, (_, c: string) => c.toUpperCase())];
      return schema ? new Response(JSON.stringify(schema)) : new Response('no', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const data = { operation: { method: 'get' } } as unknown as ApiOperationData;
const tree = (schema: ApiSchema) =>
  render(
    <ApiOperation data={data} schemasUrl="/schemas">
      <SchemaTree schema={schema} />
    </ApiOperation>,
  );

describe('SchemaTree fields', () => {
  it('shows format, tags, enums of any kind, a constant, a default and constraints', () => {
    tree({
      type: 'object',
      required: ['f'],
      properties: {
        f: {
          type: 'string',
          format: 'date-time',
          readOnly: true,
          writeOnly: true,
          deprecated: true,
          enum: [1, true, 'x'],
          const: 'k',
          default: 3,
        },
        map: { type: 'object', additionalProperties: { type: 'string' } },
        // No type to carry the format in its label, so it is listed as a fact.
        uuid: { format: 'uuid' },
      },
    });
    expect(screen.getByText('string<date-time>')).toBeInTheDocument();
    expect(screen.getByText('format uuid')).toBeInTheDocument();
    for (const tag of ['read only', 'write only', 'deprecated', 'required']) {
      expect(screen.getByText(tag)).toBeInTheDocument();
    }
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('"k"')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('opens arrays that hold objects, and leaves alone those that hold nothing to open', async () => {
    tree({
      type: 'object',
      properties: {
        objects: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
        nested: { type: 'array', items: { type: 'array' } },
        bare: { type: 'array' },
        extra: { type: 'object', additionalProperties: { type: 'object', properties: { deep: { type: 'string' } } } },
      },
    });
    expect(screen.queryByRole('button', { name: 'nested' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'bare' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'objects' }));
    expect(screen.getByText('label')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'extra' }));
    await userEvent.click(screen.getByRole('button', { name: '[key: string]' }));
    expect(screen.getByText('deep')).toBeInTheDocument();
  });
});

describe('SchemaTree arrays at the root', () => {
  it('shows the fields of the items of an array', () => {
    tree({ type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } });
    expect(screen.getByText('label')).toBeInTheDocument();
  });

  it('loads the item type of an array when it is a reference, and shows it while loading', async () => {
    tree({ type: 'array', items: { ref: 'Item' } });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('label')).toBeInTheDocument();
  });

  it('says when the item type cannot be loaded', async () => {
    tree({ type: 'array', items: { ref: 'Nowhere' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the item type');
  });

  it('stops where an item is the schema it is already inside', async () => {
    tree({ ref: 'Rec', ...SCHEMAS.Rec });
    await userEvent.click(await screen.findByRole('button', { name: 'kids' }));
    expect(await screen.findByText(/again\./)).toBeInTheDocument();
  });
});

describe('SchemaTree loading', () => {
  it('shows a schema that was not an Error when it fails to load, and one that refers to itself', async () => {
    tree({ type: 'object', properties: { x: { ref: 'Boom' } } });
    await userEvent.click(screen.getByRole('button', { name: 'x' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('does not loop on a schema made of itself', async () => {
    tree({ ref: 'Loop' });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SchemaTree choices', () => {
  it('names each variant by its title, its reference or its type, and switches between them', async () => {
    tree({
      anyOf: [{ title: 'Titled', type: 'string' }, { ref: 'Item' }, { type: 'number' }],
      discriminator: { propertyName: 'kind' },
    });
    expect(screen.getByText(/Any of/)).toBeInTheDocument();
    expect(screen.getByText('kind')).toBeInTheDocument();
    for (const name of ['Titled', 'Item', 'number 3']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'number 3' }));
    expect(screen.getByRole('button', { name: 'number 3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows nothing for a choice with no variants', () => {
    tree({ oneOf: [] });
    expect(screen.queryByRole('group')).toBeNull();
  });
});
