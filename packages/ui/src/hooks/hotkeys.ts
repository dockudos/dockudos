/**
 * Keyboard shortcuts as a small registry: any component can register a shortcut, and the help
 * dialog lists whatever is registered. One `keydown` listener serves them all.
 */

export interface HotkeyEntry {
  id: number;
  /** One or more alternatives: `'mod+k'`, `'/'`, `'g h'` (a sequence), `'shift+/'`. */
  keys: string[];
  handler: (event: KeyboardEvent) => void;
  /** Shown in the shortcuts dialog. Entries without a description are not listed. */
  description?: string;
  /** Heading in the shortcuts dialog. */
  group?: string;
  /** Fire while typing in a field. Default false. */
  allowInInputs?: boolean;
}

interface Parsed {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  del: 'delete',
};

/** `'mod+shift+k'` to its parts. `mod` is Cmd on Apple platforms and Ctrl elsewhere. */
export function parseChord(chord: string): Parsed {
  const parts =
    chord.trim().toLowerCase() === '+' ? ['+'] : chord.trim().split('+');
  // `split` always yields at least one part.
  const key = parts.pop() as string;
  const mods = new Set(parts.map((p) => p.trim().toLowerCase()));
  return {
    key: ALIASES[key.toLowerCase()] ?? key.toLowerCase(),
    mod: mods.has('mod'),
    ctrl: mods.has('ctrl') || mods.has('control'),
    meta: mods.has('meta') || mods.has('cmd') || mods.has('command'),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
  };
}

export const isApple = (): boolean =>
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

/**
 * Does this key event press this chord? A plain character (`t`, `?`, `[`) matches with no Ctrl, Cmd
 * or Alt held, and whatever Shift is (`?` already needs it). Modifiers named in the chord must be held.
 */
export function matchesChord(
  event: KeyboardEvent,
  chord: Parsed,
  apple = isApple(),
): boolean {
  const wantCtrl = chord.ctrl || (chord.mod && !apple);
  const wantMeta = chord.meta || (chord.mod && apple);
  if (
    event.ctrlKey !== wantCtrl ||
    event.metaKey !== wantMeta ||
    event.altKey !== chord.alt
  )
    return false;
  // Shift only matters when the chord names it, or when the key is a letter or digit.
  if (chord.shift && !event.shiftKey) return false;
  if (
    !chord.shift &&
    event.shiftKey &&
    /^[a-z0-9]$/i.test(chord.key) &&
    event.key.toLowerCase() === chord.key
  ) {
    return false;
  }
  return event.key.toLowerCase() === chord.key;
}

const FIELD =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Is the user typing somewhere shortcuts must not steal keys from? */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(FIELD) !== null;
}

const SEQUENCE_TIMEOUT_MS = 1000;

class HotkeyStore {
  #entries: HotkeyEntry[] = [];
  #nextId = 1;
  #listeners = new Set<() => void>();
  #attached = false;
  #buffer: { chord: string; at: number }[] = [];
  #snapshot: readonly HotkeyEntry[] = [];

  register(entry: Omit<HotkeyEntry, 'id'>): () => void {
    const full = { ...entry, id: this.#nextId++ };
    this.#entries = [...this.#entries, full];
    this.#changed();
    this.#attach();
    return () => {
      this.#entries = this.#entries.filter((e) => e.id !== full.id);
      this.#changed();
    };
  }

  /** Replace an entry's handler without re-registering (hooks call this on every render). */
  update(id: number, patch: Partial<Omit<HotkeyEntry, 'id'>>) {
    this.#entries = this.#entries.map((e) =>
      e.id === id ? { ...e, ...patch } : e,
    );
  }

  list = (): readonly HotkeyEntry[] => this.#snapshot;

  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  #changed() {
    this.#snapshot = this.#entries.filter((e) => e.description);
    this.#listeners.forEach((fn) => fn());
  }

  #attach() {
    if (this.#attached || typeof window === 'undefined') return;
    this.#attached = true;
    window.addEventListener('keydown', this.#onKeyDown);
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.key === 'Dead'
    )
      return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    const typing = isTypingTarget(event.target);
    const now = Date.now();
    const key = event.key.toLowerCase();

    const history = this.#buffer.filter(
      (b) => now - b.at < SEQUENCE_TIMEOUT_MS,
    );
    const apple = isApple();

    // The most recently registered match wins, so a custom component can override a built-in shortcut.
    for (const entry of [...this.#entries].reverse()) {
      if (typing && !entry.allowInInputs) continue;
      for (const keys of entry.keys) {
        const chords = keys.trim().split(/\s+/).map(parseChord);
        const last = chords[chords.length - 1];
        if (!last || !matchesChord(event, last, apple)) continue;
        const before = chords.slice(0, -1);
        const ok = before.every((c, i) => {
          const prior = history[history.length - before.length + i];
          return prior !== undefined && prior.chord === formatChordKey(c);
        });
        if (!ok) continue;
        event.preventDefault();
        this.#buffer = [];
        entry.handler(event);
        return;
      }
    }
    this.#buffer = [...history, { chord: key, at: now }].slice(-3);
  };
}

const formatChordKey = (c: Parsed) => c.key;

export const hotkeys = new HotkeyStore();

const SYMBOLS_APPLE: Record<string, string> = {
  mod: '⌘',
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
};
const SYMBOLS_OTHER: Record<string, string> = {
  mod: 'Ctrl',
  meta: 'Win',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
};
const KEY_NAMES: Record<string, string> = {
  escape: 'Esc',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: 'Enter',
};

/** `'mod+k'` as the keys a person would press: `['⌘', 'K']` on a Mac, `['Ctrl', 'K']` elsewhere. */
export function formatHotkey(keys: string, apple = isApple()): string[][] {
  return keys
    .trim()
    .split(/\s+/)
    .map((chord) => {
      const c = parseChord(chord);
      const symbols = apple ? SYMBOLS_APPLE : SYMBOLS_OTHER;
      const out: string[] = [];
      if (c.mod) out.push(symbols['mod'] as string);
      if (c.ctrl) out.push(symbols['ctrl'] as string);
      if (c.meta) out.push(symbols['meta'] as string);
      if (c.alt) out.push(symbols['alt'] as string);
      if (c.shift) out.push(symbols['shift'] as string);
      out.push(
        KEY_NAMES[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key),
      );
      return out;
    });
}
