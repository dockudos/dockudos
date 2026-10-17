import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';

/**
 * A new editor selects its first block when that block is an atom (an `import` line, a raw chunk), and the next
 * keystroke would replace it. Start with a cursor in the first piece of text instead, without taking focus.
 */
export function startInText(editor: Editor): void {
  const { state, view } = editor;
  if (!('node' in state.selection)) return;
  const text = Selection.findFrom(state.doc.resolve(0), 1, true);
  if (text)
    view.dispatch(state.tr.setSelection(text).setMeta('addToHistory', false));
}
