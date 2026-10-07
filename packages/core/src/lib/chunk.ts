import type { PageSection } from './extract.ts';
import { hashText } from './hash.ts';

export interface Chunk {
  /** Stable id: a hash of the page path, heading path and text. */
  id: string;
  pagePath: string;
  /** Headings from the outermost to the chunk's own, without the page title. */
  headingPath: string[];
  /** Id of the heading to link to; empty for text before the first heading. */
  anchor: string;
  text: string;
}

export interface ChunkOptions {
  /** Longest chunk in characters. Default 1200 (about 300 tokens). */
  maxChars?: number;
}

export const DEFAULT_CHUNK_CHARS = 1200;

/**
 * Split a page's sections into chunks of at most `maxChars`. A section is one chunk when it fits;
 * otherwise it is cut between paragraphs, then between lines, then between words, and every part keeps
 * the section's heading path and anchor. Editing a section changes the ids of that section's chunks only.
 */
export function chunkSections(
  pagePath: string,
  sections: readonly PageSection[],
  { maxChars = DEFAULT_CHUNK_CHARS }: ChunkOptions = {},
): Chunk[] {
  const limit = Math.max(200, Math.floor(maxChars));
  const seen = new Map<string, number>();
  const out: Chunk[] = [];
  for (const section of sections) {
    for (const text of splitText(section.text, limit)) {
      const base = hashText(
        `${pagePath}\u0000${section.headingPath.join('›')}\u0000${text}`,
      );
      // Two identical chunks under one heading would share an id; number the later ones.
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out.push({
        id: n === 1 ? base : `${base}-${n}`,
        pagePath,
        headingPath: [...section.headingPath],
        anchor: section.anchor,
        text,
      });
    }
  }
  return out;
}

/** Cut `text` into pieces no longer than `limit`, preferring paragraph, then line, then word boundaries. */
export function splitText(text: string, limit: number): string[] {
  if (text.length === 0) return [];
  if (text.length <= limit) return [text];
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length <= limit) pieces.push(paragraph);
    else pieces.push(...splitLong(paragraph, limit));
  }
  // Pack neighbouring pieces back together up to the limit.
  const out: string[] = [];
  let buffer = '';
  for (const piece of pieces) {
    if (buffer && buffer.length + 2 + piece.length > limit) {
      out.push(buffer);
      buffer = piece;
    } else buffer = buffer ? `${buffer}\n\n${piece}` : piece;
  }
  if (buffer) out.push(buffer);
  return out;
}

function splitLong(text: string, limit: number): string[] {
  const out: string[] = [];
  let buffer = '';
  const push = (piece: string) => {
    if (buffer && buffer.length + 1 + piece.length > limit) {
      out.push(buffer);
      buffer = piece;
    } else buffer = buffer ? `${buffer}\n${piece}` : piece;
  };
  for (const line of text.split('\n')) {
    if (line.length <= limit) push(line);
    else {
      for (const word of splitWords(line, limit)) push(word);
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

function splitWords(line: string, limit: number): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit; // no usable space: cut inside the word
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
