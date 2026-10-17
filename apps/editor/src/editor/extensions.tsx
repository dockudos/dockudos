import { Extension, mergeAttributes, Node } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

const BLOCKS = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'table',
  'jsxBlock',
  'rawBlock',
];

/**
 * Bookkeeping the MDX converter needs on every block: the block's original source and the blank space before it
 * (so an unedited block is written back unchanged), plus the few MDX details the stock nodes do not carry.
 */
const Bookkeeping = Extension.create({
  name: 'bookkeeping',
  addGlobalAttributes() {
    const keep = (def: unknown = null) => ({
      default: def,
      rendered: false,
      keepOnSplit: false,
    });
    return [
      { types: BLOCKS, attributes: { orig: keep(), before: keep() } },
      { types: ['codeBlock'], attributes: { meta: keep() } },
      {
        types: ['bulletList', 'orderedList', 'listItem'],
        attributes: { spread: keep(false) },
      },
      { types: ['table'], attributes: { align: keep([]) } },
    ];
  },
});

function JsxBlockView({ node, updateAttributes }: NodeViewProps) {
  const name = String(node.attrs['name'] || 'Fragment');
  return (
    <NodeViewWrapper className="jsx-block" data-component={name}>
      <div className="jsx-head" contentEditable={false}>
        <span className="jsx-badge">{name}</span>
        <input
          aria-label={`${name} tag`}
          className="jsx-tag"
          spellCheck={false}
          value={String(node.attrs['open'])}
          onChange={(e) => updateAttributes({ open: e.target.value })}
        />
      </div>
      <NodeViewContent className="jsx-body" />
    </NodeViewWrapper>
  );
}

function RawBlockView({ node, updateAttributes }: NodeViewProps) {
  const source = String(node.attrs['source']);
  return (
    <NodeViewWrapper className="raw-block" contentEditable={false}>
      <div className="raw-label">Source (shown as written)</div>
      <textarea
        aria-label="Source"
        spellCheck={false}
        rows={Math.min(14, source.split('\n').length + 1)}
        value={source}
        onChange={(e) => updateAttributes({ source: e.target.value })}
      />
    </NodeViewWrapper>
  );
}

function RawInlineView({ node, updateAttributes }: NodeViewProps) {
  const source = String(node.attrs['source']);
  return (
    <NodeViewWrapper as="span" className="raw-inline" contentEditable={false}>
      <input
        aria-label="Inline source"
        spellCheck={false}
        size={Math.max(4, source.length)}
        value={source}
        onChange={(e) => updateAttributes({ source: e.target.value })}
      />
    </NodeViewWrapper>
  );
}

function JsxInlineView({ node, updateAttributes }: NodeViewProps) {
  const name = String(node.attrs['name'] || 'Fragment');
  return (
    <NodeViewWrapper as="span" className="jsx-inline" data-component={name}>
      <button
        type="button"
        className="jsx-chip"
        contentEditable={false}
        title={String(node.attrs['open'])}
        aria-label={`Edit ${name} tag`}
        onClick={() => {
          const next = window.prompt('Tag', String(node.attrs['open']));
          if (next?.trim()) updateAttributes({ open: next.trim() });
        }}
      >
        {name}
      </button>
      <NodeViewContent className="jsx-inline-body" />
    </NodeViewWrapper>
  );
}

const JsxInline = Node.create({
  name: 'jsxInline',
  group: 'inline',
  inline: true,
  content: 'inline*',
  addAttributes() {
    return {
      name: { default: '' },
      open: { default: '<Component>' },
      close: { default: '</Component>' },
    };
  },
  parseHTML: () => [{ tag: 'span[data-jsx-inline]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-jsx-inline': '' }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(JsxInlineView),
});

const JsxBlock = Node.create({
  name: 'jsxBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return {
      name: { default: '' },
      open: { default: '<Component>' },
      close: { default: '</Component>' },
    };
  },
  parseHTML: () => [{ tag: 'div[data-jsx-block]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-jsx-block': '' }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(JsxBlockView),
});

const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [{ tag: 'pre[data-raw-block]' }],
  renderHTML: ({ node }) => [
    'pre',
    { 'data-raw-block': '' },
    String(node.attrs['source']),
  ],
  addNodeView: () => ReactNodeViewRenderer(RawBlockView),
});

const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ source: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-raw-inline]' }],
  renderHTML: ({ node }) => [
    'span',
    { 'data-raw-inline': '' },
    String(node.attrs['source']),
  ],
  addNodeView: () => ReactNodeViewRenderer(RawInlineView),
});

export const extensions = [
  StarterKit.configure({
    underline: false,
    link: { openOnClick: false, autolink: false },
  }),
  Image.configure({ inline: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({
    placeholder: 'Start writing, or insert a component…',
  }),
  Bookkeeping,
  JsxBlock,
  JsxInline,
  RawBlock,
  RawInline,
];
