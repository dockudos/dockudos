import { mdxToMarkdown } from '@dockudos/core';
import { mdxComponents } from './components.tsx';

const convert = (body: string) =>
  mdxToMarkdown(body, { components: mdxComponents });

describe('the rest of the components as Markdown', () => {
  it('accordions are a bold title, an optional description and the answer', async () => {
    expect(
      await convert(
        '<Accordions>\n<Accordion title="Q1" description="Short">\nA1\n</Accordion>\n<Accordion title="Q2">A2</Accordion>\n</Accordions>',
      ),
    ).toBe('**Q1**\n\nShort\n\nA1\n\n**Q2**\n\nA2');
  });

  it('a checklist is a task list, checked or not', async () => {
    expect(
      await convert(
        '<Checklist>\n<ChecklistItem checked>Done</ChecklistItem>\n<ChecklistItem>Todo</ChecklistItem>\n</Checklist>',
      ),
    ).toBe('- [x] Done\n- [ ] Todo');
  });

  it('request and response examples are labelled and keep their code untouched', async () => {
    expect(
      await convert(
        '<Panel>\n<RequestExample>\n```bash\ncurl x\n```\n</RequestExample>\n<ResponseExample>\n```json\n{}\n```\n</ResponseExample>\n</Panel>',
      ),
    ).toBe(
      '**Request example**\n\n```bash\ncurl x\n```\n\n**Response example**\n\n```json\n{}\n```',
    );
  });

  it('a timeline item shows its date and a readable status, and ignores a status it does not know', async () => {
    expect(
      await convert(
        '<Timeline>\n<TimelineItem title="Launch" date="2026-01-01" status="done">Shipped.</TimelineItem>\n<TimelineItem title="Next" status="planned">Soon.</TimelineItem>\n<TimelineItem title="Bare">x</TimelineItem>\n<TimelineItem title="Odd" status="weird">y</TimelineItem>\n</Timeline>',
      ),
    ).toBe(
      '**Launch** (2026-01-01, Done)\n\nShipped.\n\n**Next** (Planned)\n\nSoon.\n\n**Bare**\n\nx\n\n**Odd**\n\ny',
    );
  });

  it('a tree is a nested list, under any of its names', async () => {
    expect(
      await convert(
        '<Tree>\n<Tree.Folder name="src">\n<Tree.File name="a.ts" />\n<Tree.Folder name="lib">\n<Tree.File name="b.ts" />\n</Tree.Folder>\n</Tree.Folder>\n<Tree.File name="README.md" />\n</Tree>',
      ),
    ).toBe('- src/\n  - a.ts\n  - lib/\n    - b.ts\n- README.md');
    expect(
      await convert(
        '<Files>\n<Folder name="x">\n<File name="y" />\n</Folder>\n</Files>',
      ),
    ).toBe('- x/\n  - y');
  });
});
