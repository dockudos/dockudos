import { describe, expect, it } from 'vitest';
import { applyForm, configToForm, initialState, insertBlock, pendingChanges, reducer, splitFrontmatter, wrapSelection } from '../src/lib/editor-state';

const open = (s = initialState('base1'), path = 'docs/a.mdx', content = '# A') => reducer(s, { type: 'open', path, content });

describe('editing buffers', () => {
  it('has no pending changes until something is edited, and only for what changed', () => {
    let s = open();
    expect(pendingChanges(s)).toEqual([]);
    s = reducer(s, { type: 'edit', path: 'docs/a.mdx', content: '# A2' });
    expect(pendingChanges(s)).toEqual([{ path: 'docs/a.mdx', content: '# A2' }]);
    s = reducer(s, { type: 'edit', path: 'docs/a.mdx', content: '# A' });
    expect(pendingChanges(s)).toEqual([]);
    expect(reducer(s, { type: 'edit', path: 'docs/none.mdx', content: 'x' })).toBe(s);
  });

  it('keeps an open buffer when a file is opened again', () => {
    const s = reducer(open(), { type: 'edit', path: 'docs/a.mdx', content: 'changed' });
    expect(reducer(s, { type: 'open', path: 'docs/a.mdx', content: '# A' }).buffers['docs/a.mdx']!.content).toBe('changed');
  });

  it('applies a server plan: new, changed and deleted files, and selects the last new one', () => {
    let s = open(initialState('b'), 'docs.json', '{}');
    s = reducer(s, { type: 'apply', changes: [{ path: 'docs/new.mdx', content: 'n' }, { path: 'docs/old.mdx', delete: true }, { path: 'docs.json', content: '{"a":1}' }] });
    expect(pendingChanges(s)).toEqual(expect.arrayContaining([{ path: 'docs/new.mdx', content: 'n' }, { path: 'docs/old.mdx', delete: true }, { path: 'docs.json', content: '{"a":1}' }]));
    expect(pendingChanges(s)).toHaveLength(3);
    expect(s.active).toBe('docs/new.mdx'); // the page that was made, not the config that lists it
  });

  it('drops a file that was created and deleted before saving', () => {
    let s = reducer(initialState('b'), { type: 'apply', changes: [{ path: 'docs/tmp.mdx', content: 'x' }] });
    s = reducer(s, { type: 'apply', changes: [{ path: 'docs/tmp.mdx', delete: true }] });
    expect(pendingChanges(s)).toEqual([]);
  });

  it('treats a save as the new baseline and forgets deletions and uploads', () => {
    let s = reducer(open(), { type: 'edit', path: 'docs/a.mdx', content: 'X' });
    s = reducer(s, { type: 'upload', id: 'u1' });
    s = reducer(s, { type: 'apply', changes: [{ path: 'docs/gone.mdx', delete: true }] });
    s = reducer(s, { type: 'saved' });
    expect(pendingChanges(s)).toEqual([]);
    expect(s.uploads).toEqual([]);
    expect(s.buffers['docs/gone.mdx']).toBeUndefined();
    expect(s.buffers['docs/a.mdx']).toEqual({ original: 'X', content: 'X' });
  });

  it('resolves a conflict by re-basing, taking upstream text for the files given', () => {
    let s = open(open(), 'docs/b.mdx', 'B');
    s = reducer(reducer(s, { type: 'edit', path: 'docs/a.mdx', content: 'mine' }), { type: 'edit', path: 'docs/b.mdx', content: 'mine too' });
    s = reducer(s, { type: 'resolve', baseSha: 'head2', theirs: { 'docs/a.mdx': 'theirs' } });
    expect(s.baseSha).toBe('head2');
    expect(pendingChanges(s)).toEqual([{ path: 'docs/b.mdx', content: 'mine too' }]);
    expect(reducer(s, { type: 'resolve', baseSha: 'h3', theirs: { 'docs/b.mdx': null } }).buffers['docs/b.mdx']).toBeUndefined();
  });

  it('selects and loads', () => {
    expect(reducer(initialState(), { type: 'select', path: 'x' }).active).toBe('x');
    expect(reducer(open(), { type: 'load', baseSha: 'z' })).toEqual(initialState('z'));
  });
});

describe('toolbar helpers', () => {
  it('wraps a selection, or a placeholder when nothing is selected, and reports the new selection', () => {
    expect(wrapSelection('hello world', 6, 11, '**')).toEqual({ text: 'hello **world**', start: 8, end: 13 });
    expect(wrapSelection('ab', 1, 1, '[', '](https://)', 'link')).toEqual({ text: 'a[link](https://)b', start: 2, end: 6 });
  });
  it('puts a block on its own line', () => {
    expect(insertBlock('para', 4, '## H').text).toBe('para\n\n## H\n');
    expect(insertBlock('', 0, '## H').text).toBe('## H\n');
    expect(insertBlock('a\n', 2, '## H').text).toBe('a\n\n## H\n');
    expect(insertBlock('a\n\n', 3, '## H').text).toBe('a\n\n## H\n');
  });
  it('splits front matter', () => {
    expect(splitFrontmatter('---\ntitle: T\n---\nbody')).toEqual({ front: 'title: T', body: 'body' });
    expect(splitFrontmatter('no front')).toEqual({ front: '', body: 'no front' });
  });
});

describe('docs.json form', () => {
  const json = JSON.stringify({ name: 'A', theme: { primary: '#fff', mode: 'dark' }, kudos: { enabled: false }, navigation: [{ tab: 'T', groups: [] }] });
  it('reads the fields and writes them back without losing the rest', () => {
    expect(configToForm(json)).toEqual({ name: 'A', description: '', primary: '#fff', kudos: false, ok: true });
    const out = JSON.parse(applyForm(json, { name: 'B', description: 'd', primary: '#000', kudos: true }));
    expect(out).toMatchObject({ name: 'B', description: 'd', theme: { primary: '#000', mode: 'dark' }, kudos: { enabled: true }, navigation: [{ tab: 'T', groups: [] }] });
    const cleared = JSON.parse(applyForm(json, { name: 'B', description: '', primary: '', kudos: false }));
    expect(cleared.theme).toEqual({ mode: 'dark' });
    expect(cleared.description).toBeUndefined();
  });
  it('reports invalid JSON instead of throwing', () => {
    expect(configToForm('{ nope').ok).toBe(false);
  });
});
