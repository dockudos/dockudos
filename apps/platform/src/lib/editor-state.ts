/** The editor's working copy: what was loaded, what it is now, and what has been uploaded for the next save. */
export interface Buffer {
  /** Content at the commit the editor loaded, or `null` for a file that does not exist there yet. */
  original: string | null;
  content: string;
  deleted?: boolean;
}

export interface EditorState {
  baseSha: string;
  buffers: Record<string, Buffer>;
  uploads: string[];
  active?: string;
}

export type Action =
  | { type: 'load'; baseSha: string }
  | { type: 'open'; path: string; content: string }
  | { type: 'edit'; path: string; content: string }
  | { type: 'apply'; changes: { path: string; content?: string; delete?: boolean }[] }
  | { type: 'upload'; id: string }
  | { type: 'saved' }
  | { type: 'resolve'; baseSha: string; theirs: Record<string, string | null> }
  | { type: 'select'; path: string | undefined };

export const initialState = (baseSha = ''): EditorState => ({ baseSha, buffers: {}, uploads: [] });

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case 'load':
      return { ...initialState(a.baseSha) };
    case 'open':
      return s.buffers[a.path] ? { ...s, active: a.path } : { ...s, active: a.path, buffers: { ...s.buffers, [a.path]: { original: a.content, content: a.content } } };
    case 'edit': {
      const b = s.buffers[a.path];
      return b ? { ...s, buffers: { ...s.buffers, [a.path]: { ...b, content: a.content } } } : s;
    }
    case 'apply': {
      const buffers = { ...s.buffers };
      for (const c of a.changes) {
        const prev = buffers[c.path];
        // A page created in this session and deleted again never existed upstream: there is nothing to delete.
        if (c.delete && prev && prev.original === null) delete buffers[c.path];
        else if (c.delete) buffers[c.path] = { original: prev?.original ?? '', content: '', deleted: true };
        else buffers[c.path] = { original: prev ? prev.original : null, content: c.content ?? '' };
      }
      // Show the page that was made or moved, not docs.json which only changed to list it.
      const shown = a.changes.filter((c) => !c.delete);
      const last = (shown.filter((c) => c.path !== 'docs.json').at(-1) ?? shown.at(-1))?.path;
      return { ...s, buffers, ...(last && { active: last }) };
    }
    case 'upload':
      return { ...s, uploads: [...s.uploads, a.id] };
    case 'saved': {
      const buffers: Record<string, Buffer> = {};
      for (const [p, b] of Object.entries(s.buffers)) if (!b.deleted) buffers[p] = { original: b.content, content: b.content };
      const active = s.active && buffers[s.active] ? s.active : undefined;
      return { ...s, buffers, uploads: [], ...(active ? { active } : { active: undefined }) };
    }
    case 'resolve': {
      // Re-base onto the latest commit. Files where the person chose "theirs" take the upstream text and stop being edits.
      const buffers = { ...s.buffers };
      for (const [path, theirs] of Object.entries(a.theirs)) {
        if (theirs === null) delete buffers[path];
        else buffers[path] = { original: theirs, content: theirs };
      }
      return { ...s, baseSha: a.baseSha, buffers };
    }
    case 'select':
      return { ...s, active: a.path };
  }
}

/** The edits to send: files whose text differs from what was loaded, new files, and deletions. */
export type Change = { path: string; content?: string; delete?: boolean };

export function pendingChanges(s: EditorState): Change[] {
  return Object.entries(s.buffers).flatMap(([path, b]): Change[] => {
    if (b.deleted) return b.original === null ? [] : [{ path, delete: true }];
    return b.original === null || b.content !== b.original ? [{ path, content: b.content }] : [];
  });
}

/** Insert Markdown around a selection, the way a toolbar button does. Returns the new text and where the cursor goes. */
export function wrapSelection(text: string, start: number, end: number, before: string, after = before, placeholder = 'text'): { text: string; start: number; end: number } {
  const selected = text.slice(start, end) || placeholder;
  const next = text.slice(0, start) + before + selected + after + text.slice(end);
  return { text: next, start: start + before.length, end: start + before.length + selected.length };
}

/** Put a block of Markdown on its own line(s) at the cursor. */
export function insertBlock(text: string, at: number, block: string): { text: string; start: number; end: number } {
  const lead = at > 0 && text[at - 1] !== '\n' ? '\n\n' : at > 0 && text[at - 2] !== '\n' && text[at - 1] === '\n' ? '\n' : '';
  const next = text.slice(0, at) + lead + block + '\n' + text.slice(at);
  const start = at + lead.length;
  return { text: next, start, end: start + block.length };
}

export function splitFrontmatter(source: string): { front: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  return m ? { front: m[1]!, body: source.slice(m[0].length) } : { front: '', body: source };
}

/** Top-level fields of docs.json the form edits; everything else is kept as it is. */
export function configToForm(json: string): { name: string; description: string; primary: string; kudos: boolean; ok: boolean } {
  try {
    const c = JSON.parse(json) as { name?: string; description?: string; theme?: { primary?: string }; kudos?: { enabled?: boolean } };
    return { name: c.name ?? '', description: c.description ?? '', primary: c.theme?.primary ?? '', kudos: c.kudos?.enabled ?? false, ok: true };
  } catch {
    return { name: '', description: '', primary: '', kudos: false, ok: false };
  }
}

export function applyForm(json: string, f: { name: string; description: string; primary: string; kudos: boolean }): string {
  const c = JSON.parse(json) as Record<string, any>;
  c['name'] = f.name;
  if (f.description) c['description'] = f.description;
  else delete c['description'];
  if (f.primary) c['theme'] = { ...(c['theme'] ?? {}), primary: f.primary };
  else if (c['theme']) delete c['theme'].primary;
  c['kudos'] = { ...(c['kudos'] ?? {}), enabled: f.kudos };
  return `${JSON.stringify(c, null, 2)}\n`;
}
