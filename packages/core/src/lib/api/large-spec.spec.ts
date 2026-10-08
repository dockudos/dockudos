import { generateOpenApi } from './generate-openapi.ts';
import { normalizeOpenApi } from './openapi.ts';

/**
 * The performance budget for big specs (P3.17): 2,000 operations with 400 interlinked, partly circular schemas turn
 * into pages in under this many milliseconds on the CI machine, and no page carries more than this many bytes of data
 * (the rest is loaded when a reader opens a field), so pages stay light however large the API is.
 * Measured on a laptop: about 0.4 s. On the real GitHub spec (1,232 operations) about 0.4 s and 11 kB a page.
 */
const BUDGET_MS = 5_000;
const MAX_PAGE_DATA_BYTES = 60_000;

function syntheticSpec(operations: number, schemaCount: number) {
  const schemas: Record<string, unknown> = {};
  for (let i = 0; i < schemaCount; i++) {
    schemas[`Model${i}`] = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', description: 'A name '.repeat(10) },
        // each model links to the next three, and the last ones link back: cycles everywhere
        a: { $ref: `#/components/schemas/Model${(i + 1) % schemaCount}` },
        b: { $ref: `#/components/schemas/Model${(i + 7) % schemaCount}` },
        c: {
          type: 'array',
          items: { $ref: `#/components/schemas/Model${(i * 3) % schemaCount}` },
        },
        d: {
          allOf: [
            { $ref: `#/components/schemas/Model${(i + 2) % schemaCount}` },
            { type: 'object', properties: { extra: { type: 'string' } } },
          ],
        },
      },
    };
  }
  const paths: Record<string, unknown> = {};
  for (let i = 0; i < operations; i++) {
    const model = { $ref: `#/components/schemas/Model${i % schemaCount}` };
    paths[
      `/resource${Math.floor(i / 4)}/{id}/${i % 4 === 0 ? 'x' : `y${i % 4}`}`
    ] = {
      get: {
        operationId: `op${i}`,
        tags: [`Tag${i % 40}`],
        summary: `Operation ${i}`,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: model } },
          },
        },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Large', version: '1' },
    paths,
    components: { schemas },
  };
}

describe('large specs', () => {
  it('2,000 operations become 2,000 pages within the time budget, each light', () => {
    const doc = syntheticSpec(2000, 400);
    const started = performance.now();
    const model = normalizeOpenApi(doc, 'large');
    const result = generateOpenApi(model, {
      name: 'large',
      mount: 'api',
      groupBy: 'tag',
      playground: true,
    });
    const elapsed = performance.now() - started;

    expect(result.operations).toBe(2000);
    expect(result.pages).toBe(2000);
    expect(Object.keys(model.schemas)).toHaveLength(400);
    expect(elapsed).toBeLessThan(BUDGET_MS);

    const data = result.files.filter((f) => f.file.includes('/ops/'));
    expect(data).toHaveLength(2000);
    expect(Math.max(...data.map((f) => f.content.length))).toBeLessThan(
      MAX_PAGE_DATA_BYTES,
    );
  });
});
