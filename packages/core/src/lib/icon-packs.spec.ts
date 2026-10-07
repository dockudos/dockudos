import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './config.ts';
import {
  IconPackError,
  iconNameFromFile,
  loadIconPacks,
} from './icon-packs.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dockudos-icons-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const good = (d = 'M0 0h8v8z') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#336699" d="${d}"/></svg>`;
const put = async (file: string, text: string) => {
  await mkdir(join(root, file, '..'), { recursive: true });
  await writeFile(join(root, file), text);
};
const cfg = (packs: object) => parseConfig({ name: 'A', icons: { packs } });

describe('iconNameFromFile', () => {
  it.each([
    ['logo.svg', 'logo'],
    ['Logo.SVG', 'logo'],
    ['social/Git Hub.svg', 'social-git-hub'],
    ['a__b.svg', 'a__b'],
    ['--x--.svg', 'x'],
    ['äö.svg', ''],
  ])('%s -> %j', (file, name) => expect(iconNameFromFile(file)).toBe(name));
});

describe('loadIconPacks', () => {
  it('prefixes every icon with its pack name, reading nested folders', async () => {
    await put('icons/acme/logo.svg', good());
    await put('icons/acme/social/github.svg', good('M1 1h4'));
    await put('icons/acme/readme.txt', 'ignored');
    const icons = await loadIconPacks(root, cfg({ acme: 'icons/acme' }));
    expect(Object.keys(icons)).toEqual(['acme:logo', 'acme:social-github']);
    expect(icons['acme:logo']).toMatchObject({ viewBox: '0 0 8 8' });
    expect(icons['acme:logo']!.body).toContain('#336699');
  });

  it('can make a pack monochrome, and keeps several packs apart', async () => {
    await put('a/x.svg', good());
    await put('b/x.svg', good());
    const icons = await loadIconPacks(
      root,
      cfg({ mono: { dir: 'a', monochrome: true }, plain: 'b' }),
    );
    expect(icons['mono:x']!.body).toContain('currentColor');
    expect(icons['plain:x']!.body).toContain('#336699');
  });

  it('cleans each file: scripts and handlers never reach the page', async () => {
    await put(
      'p/evil.svg',
      '<svg viewBox="0 0 8 8" onload="alert(1)"><script>alert(2)</script><path d="M0 0" onclick="x()"/></svg>',
    );
    const icons = await loadIconPacks(root, cfg({ p: 'p' }));
    expect(icons['p:evil']!.body).toBe('<path d="M0 0"/>');
    expect(JSON.stringify(icons)).not.toMatch(/alert|onclick|onload|script/);
  });

  it('reports every problem at once, with file and reason', async () => {
    await put('p/ok.svg', good());
    await put('p/broken.svg', '<svg><g/></svg>');
    await put('p/Dup.svg', good());
    await put('p/dup.svg', good());
    await put('p/åäö.svg', good());
    await mkdir(join(root, 'empty'));
    const error = await loadIconPacks(
      root,
      cfg({ p: 'p', e: 'empty', gone: 'nowhere', out: '../elsewhere' }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(IconPackError);
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('p/broken.svg: needs a viewBox'),
        expect.stringContaining('becomes "p:dup", the same as'),
        expect.stringContaining(
          'p/åäö.svg: the file name has no usable letters',
        ),
        'icons.packs.e: no .svg files in empty',
        'icons.packs.gone: folder not found: nowhere',
        'icons.packs.out: ../elsewhere is outside the project',
      ]),
    );
  });

  it('has nothing to load without packs', async () => {
    expect(await loadIconPacks(root, cfg({}))).toEqual({});
  });
});
