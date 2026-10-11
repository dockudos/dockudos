import type { ComponentType } from 'react';
import {
  Accordion,
  AccordionGroup,
  Accordions,
} from '../components/accordion.tsx';
import { Banner } from '../components/banner.tsx';
import { Colors } from '../components/colors.tsx';
import { Icon } from '../components/icon.tsx';
import {
  Panel,
  RequestExample,
  ResponseExample,
} from '../components/panel.tsx';
import { Shortcut } from '../components/shortcut.tsx';
import { Tile } from '../components/tile.tsx';
import { CodeBlock, CodeGroup } from '../components/code-block.tsx';
import { Badge } from '../components/badge.tsx';
import {
  Callout,
  Check,
  Danger,
  Info,
  Note,
  Tip,
  Warning,
} from '../components/callout.tsx';
import { Card, CardGroup, Cards } from '../components/cards.tsx';
import { Columns } from '../components/columns.tsx';
import { Expandable } from '../components/expandable.tsx';
import { File, Files, Folder, Tree } from '../components/tree.tsx';
import { CopyText } from '../components/copy-text.tsx';
import { Endpoint } from '../components/endpoint.tsx';
import { Prompt } from '../components/prompt.tsx';
import { View } from '../components/view.tsx';
import { Visibility } from '../components/visibility.tsx';
import { Checklist, ChecklistItem } from '../components/checklist.tsx';
import { Answer, Question, Quiz } from '../components/quiz.tsx';
import { Exercise, Hint, Solution } from '../components/exercise.tsx';
import { Download } from '../components/download.tsx';
import { Quote } from '../components/quote.tsx';
import { Checkpoint, TutorialIntro } from '../components/tutorial.tsx';
import { Stat, Stats } from '../components/stats.tsx';
import { ThemedImage } from '../components/themed-image.tsx';
import { Timeline, TimelineItem } from '../components/timeline.tsx';
import { Deprecated, Since } from '../components/version-labels.tsx';
import { Frame } from '../components/frame.tsx';
import { GithubInfo } from '../components/github-info.tsx';
import { GraphView } from '../components/graph-view.tsx';
import { Mermaid } from '../components/mermaid.tsx';
import { Hero, LinkButton } from '../components/hero.tsx';
import { InlineToc } from '../components/inline-toc.tsx';
import { Kbd } from '../components/kbd.tsx';
import { ParamField, ResponseField } from '../components/param-field.tsx';
import { Step, Steps } from '../components/steps.tsx';
import { Table } from '../components/table.tsx';
import { Tab, Tabs } from '../components/tabs.tsx';
import { Tooltip } from '../components/tooltip.tsx';
import { TypeTable } from '../components/type-table.tsx';
import { Update } from '../components/update.tsx';
import { Changelog } from '../components/changelog.tsx';
import { Story } from '../components/story.tsx';
import { Section } from '../components/section.tsx';
import { Video } from '../components/video.tsx';
import { ZoomableImage } from '../components/zoomable-image.tsx';
import { ApiOperation } from '../components/api/context.tsx';
import { ApiPlayground } from '../components/api/playground.tsx';
import {
  ApiParameters,
  ApiRequestBody,
  ApiResponses,
} from '../components/api/sections.tsx';

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
  Tree,
  Prompt,
  TutorialIntro,
  Checkpoint,
  Checklist,
  ChecklistItem,
  Quiz,
  Question,
  Answer,
  Exercise,
  Hint,
  Solution,
  Download,
  Quote,
  Stats,
  Stat,
  ThemedImage,
  Timeline,
  TimelineItem,
  Since,
  Deprecated,
  View,
  Visibility,
  GithubInfo,
  InlineToc,
  TypeTable,
  GraphView,
  CodeGroup,
  Badge,
  Icon,
  Note,
  Info,
  Tip,
  Check,
  Warning,
  Danger,
  CardGroup,
  AccordionGroup,
  Shortcut,
  Tile,
  Colors,
  Panel,
  RequestExample,
  ResponseExample,
  Kbd,
  Frame,
  Video,
  Columns,
  Expandable,
  ParamField,
  ResponseField,
  Endpoint,
  ApiOperation,
  ApiParameters,
  ApiRequestBody,
  ApiResponses,
  ApiPlayground,
  Update,
  Changelog,
  Story,
  Section,
  CopyText,
  Hero,
  LinkButton,
  Mermaid,
  pre: CodeBlock,
  table: Table,
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
