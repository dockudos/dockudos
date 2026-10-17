/** Components the Insert menu offers. Each is ordinary MDX, parsed by the same converter as a page. */
export const SNIPPETS: { label: string; mdx: string }[] = [
  {
    label: 'Callout',
    mdx: '<Callout type="info" title="Good to know">\n\nWrite the note here.\n\n</Callout>\n',
  },
  {
    label: 'Tabs',
    mdx: '<Tabs>\n\n<Tab value="First">\n\nFirst tab content.\n\n</Tab>\n\n<Tab value="Second">\n\nSecond tab content.\n\n</Tab>\n\n</Tabs>\n',
  },
  {
    label: 'Steps',
    mdx: '<Steps>\n\n<Step title="First step">\n\nWhat to do.\n\n</Step>\n\n<Step title="Second step">\n\nWhat to do next.\n\n</Step>\n\n</Steps>\n',
  },
  {
    label: 'Cards',
    mdx: '<Cards columns={2}>\n\n<Card title="A card" href="/">\n\nWhat it links to.\n\n</Card>\n\n</Cards>\n',
  },
  {
    label: 'Accordion',
    mdx: '<Accordions>\n\n<Accordion title="A question">\n\nThe answer.\n\n</Accordion>\n\n</Accordions>\n',
  },
  { label: 'Code block', mdx: '```ts\nconst answer = 42;\n```\n' },
  {
    label: 'Table',
    mdx: '| Name | Description |\n| --- | --- |\n| One | First |\n',
  },
];
