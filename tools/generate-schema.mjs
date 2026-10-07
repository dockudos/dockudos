// Writes packages/core/docs.schema.json from the zod schema. Run: pnpm schema
import { writeFileSync } from 'node:fs';
import { docsConfigJsonSchema } from '../packages/core/src/index.ts';

const out = new URL('../packages/core/docs.schema.json', import.meta.url);
writeFileSync(out, JSON.stringify(docsConfigJsonSchema(), null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
