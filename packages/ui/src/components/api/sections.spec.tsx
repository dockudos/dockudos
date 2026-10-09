import type { ApiOperationData } from '@dockudos/core';
import { render, screen, within } from '@testing-library/react';
import { ApiOperation } from './context.tsx';
import { CodeFigure, ApiParameters, ApiRequestBody, ApiResponses } from './sections.tsx';

const page = (operation: object, ui: React.ReactNode) =>
  render(
    <ApiOperation
      data={{ operation: { method: 'get', parameters: [], responses: [], ...operation } } as unknown as ApiOperationData}
      schemasUrl="/schemas"
    >
      {ui}
    </ApiOperation>,
  );

describe('ApiParameters rows', () => {
  it('shows a default, a deprecation, an array’s allowed values, and examples of any kind', () => {
    page(
      {
        parameters: [
          {
            name: 'a',
            in: 'query',
            required: false,
            deprecated: true,
            schema: { type: 'string', default: 'x' },
            example: 'plain',
          },
          { name: 'b', in: 'query', required: false, schema: { type: 'array', items: { enum: ['p', 2] } }, example: { k: 1 } },
          { name: 'c', in: 'header', required: false },
        ],
      },
      <ApiParameters />,
    );
    expect(screen.getByText('Deprecated.')).toBeInTheDocument();
    expect(screen.getByText('plain')).toBeInTheDocument();
    expect(screen.getByText('{"k":1}')).toBeInTheDocument();
    expect(screen.getByText('p')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'header parameters' })).toBeInTheDocument();
  });
});

describe('ApiRequestBody and ApiResponses', () => {
  it('shows nothing when there is no body and no responses', () => {
    const { container } = page({}, <><ApiRequestBody /><ApiResponses /></>);
    expect(container.querySelector('.dk-api-body, .dk-api-responses')).toBeNull();
  });

  it('shows a body in several content types as tabs, with examples named or titled, and a note when there is nothing', () => {
    page(
      {
        requestBody: {
          required: true,
          description: 'The payload',
          content: {
            'application/json': {
              examples: {
                first: { summary: 'Titled', value: { a: 1 } },
                second: { value: 'raw text' },
              },
            },
            'text/plain': { examples: {} },
          },
        },
      },
      <ApiRequestBody />,
    );
    expect(screen.getByText('required')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'application/json' })).toBeInTheDocument();
    expect(screen.getByText('Titled')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.getByText(/No schema is given for text\/plain/)).toBeInTheDocument();
  });

  it('shows a single example as "Example", and response headers', () => {
    page(
      {
        responses: [
          {
            status: '200',
            description: 'Fine',
            headers: [{ name: 'X-Rate', description: 'Left', schema: { type: 'integer' } }],
            content: { 'application/json': { examples: { only: { value: { ok: true } } } } },
          },
        ],
      },
      <ApiResponses />,
    );
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText('X-Rate')).toBeInTheDocument();
    expect(screen.getByText('Headers')).toBeInTheDocument();
  });

  it('has no Markdown of its own, and a code figure picks its language from the code', () => {
    for (const c of [ApiParameters, ApiRequestBody, ApiResponses]) {
      expect((c as unknown as { toMarkdown: () => string }).toMarkdown()).toBe('');
    }
    const { container } = render(<CodeFigure code='{"a":1}' />);
    expect(within(container).getByText('{"a":1}')).toBeInTheDocument();
  });
});
