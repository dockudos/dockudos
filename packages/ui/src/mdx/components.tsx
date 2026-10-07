import type { ComponentType } from 'react';
import { Accordion, Accordions } from '../components/accordion.tsx';
import { Banner } from '../components/banner.tsx';
import { CodeBlock, CodeGroup } from '../components/code-block.tsx';
import { Callout } from '../components/callout.tsx';
import { Card, Cards } from '../components/cards.tsx';
import { File, Files, Folder } from '../components/files.tsx';
import { GithubInfo } from '../components/github-info.tsx';
import { GraphView } from '../components/graph-view.tsx';
import { Mermaid } from '../components/mermaid.tsx';
import { InlineToc } from '../components/inline-toc.tsx';
import { Step, Steps } from '../components/steps.tsx';
import { Tab, Tabs } from '../components/tabs.tsx';
import { Tooltip } from '../components/tooltip.tsx';
import { TypeTable } from '../components/type-table.tsx';
import { ZoomableImage } from '../components/zoomable-image.tsx';

/** Components available in every MDX file without importing. */
export const mdxComponents = {
  Callout,
  Accordions,
  Accordion,
  Tabs,
  Tab,
  Steps,
  Step,
  Cards,
  Card,
  Tooltip,
  Banner,
  Files,
  File,
  Folder,
  GithubInfo,
  InlineToc,
  TypeTable,
  GraphView,
  CodeGroup,
  Mermaid,
  pre: CodeBlock,
  img: ZoomableImage,
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MdxComponentMap = Record<string, ComponentType<any> | string>;

/**
 * The default component map with your overrides on top. Any component can be
 * replaced by name: `defineMdxComponents({ Callout: MyCallout })`.
 * Use it in `mdx-components.tsx`.
 */
export function defineMdxComponents(
  overrides: MdxComponentMap = {},
): MdxComponentMap {
  return { ...mdxComponents, ...overrides };
}
