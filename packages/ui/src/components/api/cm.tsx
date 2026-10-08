'use client';

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
} from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  keymap,
  lineNumbers,
  placeholder as placeholderText,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

export interface CodeMirrorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Ctrl/Cmd+Enter in the editor. */
  onSubmit?: () => void;
  /** `json`, `javascript`, `python`, `go`, `xml`, `yaml`, `shell`; anything else is plain text. */
  language: string;
  /** The accessible name of the editor. */
  label: string;
  readOnly?: boolean;
  lineNumbers?: boolean;
  /** Fold arrows for objects and arrays. */
  foldable?: boolean;
  wrap?: boolean;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}

/** Each grammar is its own chunk, fetched when something of that language is first shown. */
const LANGUAGES: Record<string, (editable: boolean) => Promise<Extension>> = {
  json: async (editable) => {
    const m = await import('@codemirror/lang-json');
    return editable ? [m.json(), linter(m.jsonParseLinter())] : m.json();
  },
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  shell: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell),
};

/** Colours come from CSS variables (`--dk-tok-*`), so light and dark follow the site without rebuilding the editor. */
const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--dk-tok-keyword)' },
    { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--dk-tok-string)' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--dk-tok-number)' },
    { tag: [t.propertyName, t.attributeName], color: 'var(--dk-tok-property)' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--dk-tok-function)' },
    { tag: [t.typeName, t.className, t.tagName, t.namespace], color: 'var(--dk-tok-type)' },
    { tag: [t.comment, t.meta], color: 'var(--dk-tok-comment)', fontStyle: 'italic' },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--dk-tok-punctuation)' },
    { tag: t.invalid, color: 'var(--dk-callout-danger)' },
  ]),
);

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--foreground)', fontSize: '0.8125rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.65',
    maxHeight: 'var(--dk-cm-max, 24rem)',
    overflow: 'auto',
  },
  '.cm-content': { padding: '0.7rem 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 0.9rem' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.4rem 0 0.9rem', minWidth: '2rem' },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 0.25rem' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--ring) 28%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklch, var(--dk-callout-warning) 30%, transparent)' },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--ring) 22%, transparent)',
    outline: 'none',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--muted)',
    border: '1px solid var(--border)',
    color: 'var(--muted-foreground)',
    padding: '0 0.3rem',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-diagnostic': { fontFamily: 'inherit', padding: '0.2rem 0.5rem' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--dk-callout-danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--dk-callout-danger)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover, var(--background))',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
  },
  '.cm-panels': { backgroundColor: 'var(--muted)', color: 'var(--foreground)', borderColor: 'var(--border)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit', fontSize: '0.8125rem' },
  '.cm-panel input': {
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--input)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-panel button': {
    color: 'var(--foreground)',
    backgroundImage: 'none',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--input)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--dk-callout-warning) 30%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, var(--dk-callout-warning) 55%, transparent)' },
});

/** The editor behind `CodeEditor`. Loaded on demand, so pages that never show code samples do not pay for it. */
export default function CodeMirror(props: CodeMirrorProps) {
  const { value, language, readOnly = false } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const latest = useRef(props);
  const languageSlot = useRef(new Compartment());

  useEffect(() => {
    latest.current = props;
  });

  // One editor for the life of the component; the effects below keep it in step with the props.
  useEffect(() => {
    const p = latest.current;
    const editable = !p.readOnly;
    const extensions: Extension[] = [
      theme,
      highlighting,
      drawSelection(),
      bracketMatching(),
      highlightSelectionMatches(),
      languageSlot.current.of([]),
      keymap.of([
        ...(editable
          ? [{ key: 'Mod-Enter', run: () => (latest.current.onSubmit ? (latest.current.onSubmit(), true) : false) }]
          : []),
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
      ]),
      EditorView.contentAttributes.of({
        'aria-label': p.label,
        // axe does not count a contenteditable as focusable, and a code block that scrolls must be reachable by keyboard
        tabindex: '0',
        ...(p.invalid ? { 'aria-invalid': 'true' } : {}),
        ...(p.describedBy ? { 'aria-describedby': p.describedBy } : {}),
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) latest.current.onChange?.(u.state.doc.toString());
      }),
    ];
    if (editable) extensions.push(history());
    else extensions.push(EditorState.readOnly.of(true));
    if (p.lineNumbers) extensions.push(lineNumbers());
    if (p.foldable) extensions.push(foldGutter());
    if (p.wrap) extensions.push(EditorView.lineWrapping);
    if (p.placeholder) extensions.push(placeholderText(p.placeholder));

    const editor = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({ doc: p.value, extensions }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    let current = true;
    const load = LANGUAGES[language];
    void (load ? load(!readOnly) : Promise.resolve<Extension>([])).then((extension) => {
      if (current) view.current?.dispatch({ effects: languageSlot.current.reconfigure(extension) });
    });
    return () => {
      current = false;
    };
  }, [language, readOnly]);

  return <div ref={host} className="dk-cm-host" />;
}
