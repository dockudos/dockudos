import type { ComponentType } from 'react';
import { Accordion, Accordions } from '../components/accordion.tsx';
import { Banner } from '../components/banner.tsx';
import { CodeBlock, CodeGroup } from '../components/code-block.tsx';
import { Badge } from '../components/badge.tsx';
import { Callout } from '../components/callout.tsx';
import { Card, Cards } from '../components/cards.tsx';
import { Columns } from '../components/columns.tsx';
import { Expandable } from '../components/expandable.tsx';
import { File, Files, Folder } from '../components/files.tsx';
import { CopyText } from '../components/copy-text.tsx';
import { Endpoint } from '../components/endpoint.tsx';
import { Frame } from '../components/frame.tsx';
import { GithubInfo } from '../components/github-info.tsx';
import { GraphView } from '../components/graph-view.tsx';
import { Mermaid } from '../components/mermaid.tsx';
import { Hero, LinkButton } from '../components/hero.tsx';
import { InlineToc } from '../components/inline-toc.tsx';
import { Kbd } from '../components/kbd.tsx';
import { ParamField, ResponseField } from '../components/param-field.tsx';
import { Step, Steps } from '../components/steps.tsx';
import { Tab, Tabs } from '../components/tabs.tsx';
import { Tooltip } from '../components/tooltip.tsx';
import { TypeTable } from '../components/type-table.tsx';
import { Update } from '../components/update.tsx';
import { Video } from '../components/video.tsx';
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
  Badge,
  Kbd,
  Frame,
  Video,
  Columns,
  Expandable,
  ParamField,
  ResponseField,
  Endpoint,
  Update,
  CopyText,
  Hero,
  LinkButton,
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
