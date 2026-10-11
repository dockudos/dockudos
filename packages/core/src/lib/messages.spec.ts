import { en, format, messagesFor, translations } from './messages.ts';

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('bundled translations', () => {
  for (const [lang, bundle] of Object.entries(translations)) {
    it(`${lang} translates every message and keeps its placeholders`, () => {
      expect(Object.keys(bundle).sort()).toEqual(Object.keys(en).sort());
      for (const [key, text] of Object.entries(bundle))
        expect(placeholders(text as string), `${lang}.${key}`).toEqual(
          placeholders(en[key as keyof typeof en]),
        );
    });
  }
});

describe('messagesFor', () => {
  it('is English without a language, or with one we have no words for', () => {
    expect(messagesFor(undefined)).toEqual(en);
    expect(messagesFor('sw')).toEqual(en);
  });
  it('uses the base language for a regional tag, and the exact tag when there is one', () => {
    expect(messagesFor('fr-CA').next).toBe('Suivant');
    expect(messagesFor('pt-BR').search).toBe('Pesquisar');
  });
  it('lets the site override words for exactly one language, ignoring unknown keys', () => {
    const m = messagesFor('fr', {
      fr: { search: 'Chercher', nonsense: 'x' },
      de: { search: 'Suche' },
    });
    expect(m.search).toBe('Chercher');
    expect(m.next).toBe('Suivant');
    expect(m).not.toHaveProperty('nonsense');
    expect(messagesFor('en', { en: { search: 'Find' } }).search).toBe('Find');
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(format('v{version} of {name}', { version: 2 })).toBe('v2 of {name}');
    expect(format('plain')).toBe('plain');
  });
});
