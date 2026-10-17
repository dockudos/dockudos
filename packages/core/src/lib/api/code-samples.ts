import type { ApiCodeSample } from './types.ts';
import type { SampleLanguage } from './samples.ts';

/** What `openapi.samples.mode` means; see `mergeSamples`. */
export type SamplesMode = 'replace' | 'append' | 'generated-only';

const MAX_SOURCE = 100_000;
const MAX_SAMPLES = 20;

/**
 * Names spec authors use, mapped to the id of the sample language that shows the same thing. Redocly and others write
 * `Shell`, `Node.js` and `cURL`; the key is the name lowercased with everything but letters and digits removed.
 */
const ALIASES: Record<string, string> = {
  curl: 'curl',
  shell: 'curl',
  sh: 'curl',
  bash: 'curl',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  fetch: 'javascript',
  python: 'python',
  py: 'python',
  python3: 'python',
  requests: 'python',
  go: 'go',
  golang: 'go',
};

/** Syntax-highlighting names for languages without a generated counterpart. */
const HIGHLIGHT: Record<string, string> = {
  curl: 'shell',
  csharp: 'csharp',
  cs: 'csharp',
  dotnet: 'csharp',
  java: 'java',
  kotlin: 'kotlin',
  php: 'php',
  ruby: 'ruby',
  rb: 'ruby',
  rust: 'rust',
  swift: 'swift',
  typescript: 'typescript',
  ts: 'typescript',
  objectivec: 'objective-c',
  powershell: 'powershell',
  c: 'c',
  cpp: 'cpp',
  dart: 'dart',
  scala: 'scala',
  r: 'r',
  json: 'json',
  yaml: 'yaml',
  http: 'http',
};

const key = (lang: string) =>
  lang
    .toLowerCase()
    .replace(/#/g, 'sharp')
    .replace(/\+/g, 'p')
    .replace(/[^a-z0-9]/g, '');

/** The id of the generated language a sample's `lang` stands for (`Shell` is `curl`), if there is one. */
export const canonicalLanguage = (lang: string): string | undefined =>
  ALIASES[key(lang)];

/** The highlighter to use for a sample. Unknown names give `text`, which shows the code uncoloured. */
export function highlightFor(lang: string): string {
  const k = key(lang);
  const canonical = ALIASES[k];
  if (canonical) return canonical === 'curl' ? 'shell' : canonical;
  return HIGHLIGHT[k] ?? 'text';
}

/**
 * Read `x-codeSamples` (or the older `x-code-samples`) of an operation. A malformed entry is skipped and named in
 * `warnings`; it never fails the build.
 */
export function readCodeSamples(
  operation: Record<string, unknown>,
  where: string,
): { samples: ApiCodeSample[]; warnings: string[] } {
  const warnings: string[] = [];
  const name = ['x-codeSamples', 'x-code-samples'].find(
    (k) => operation[k] !== undefined,
  );
  if (!name) return { samples: [], warnings };
  const raw = operation[name];
  if (!Array.isArray(raw)) {
    return {
      samples: [],
      warnings: [`${where}: ${name} must be a list; ignored.`],
    };
  }
  const samples: ApiCodeSample[] = [];
  raw.forEach((entry, i) => {
    const at = `${where}: ${name}[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      warnings.push(`${at} is not an object; ignored.`);
      return;
    }
    const { lang, label, source } = entry as Record<string, unknown>;
    if (typeof lang !== 'string' || !lang.trim()) {
      warnings.push(`${at} has no "lang"; ignored.`);
      return;
    }
    if (typeof source !== 'string' || !source.trim()) {
      warnings.push(`${at} has no "source"; ignored.`);
      return;
    }
    if (source.length > MAX_SOURCE) {
      warnings.push(`${at} is longer than ${MAX_SOURCE} characters; ignored.`);
      return;
    }
    samples.push({
      lang: lang.trim(),
      label:
        typeof label === 'string' && label.trim() ? label.trim() : lang.trim(),
      source,
    });
  });
  if (samples.length > MAX_SAMPLES) {
    warnings.push(`${where}: only the first ${MAX_SAMPLES} samples are used.`);
    samples.length = MAX_SAMPLES;
  }
  return { samples, warnings };
}

/** One tab of the code samples: generated from the request, or written in the spec. */
export interface SampleTab {
  /** Id used to remember the reader's choice. A spec sample that replaces a generated one takes over its id. */
  id: string;
  label: string;
  highlight: string;
  /** The code shown. Generated samples follow the request that is being built; spec samples are fixed text. */
  code: (request: Parameters<SampleLanguage['generate']>[0]) => string;
  fromSpec: boolean;
}

/**
 * The tabs of an endpoint, in order.
 * - `replace`: a spec sample for a language that is generated takes that tab's place; the others follow, in the order of the spec.
 * - `append`: every generated tab, then every spec sample.
 * - `generated-only`: spec samples are not shown.
 * Two tabs never share a label: a second `Python` becomes `Python (2)`.
 */
export function mergeSamples(
  generated: readonly SampleLanguage[],
  fromSpec: readonly ApiCodeSample[] = [],
  mode: SamplesMode = 'replace',
): SampleTab[] {
  const tabs: SampleTab[] = generated.map((l) => ({
    id: l.id,
    label: l.label,
    highlight: l.highlight === 'bash' ? 'shell' : l.highlight,
    code: (request) => l.generate(request),
    fromSpec: false,
  }));
  if (mode !== 'generated-only') {
    fromSpec.forEach((s, i) => {
      const tab: SampleTab = {
        id: `spec-${i}`,
        label: s.label,
        highlight: highlightFor(s.lang),
        code: () => s.source,
        fromSpec: true,
      };
      const canonical = canonicalLanguage(s.lang);
      const at =
        mode === 'replace' && canonical
          ? tabs.findIndex((t) => !t.fromSpec && t.id === canonical)
          : -1;
      if (at >= 0) tabs[at] = { ...tab, id: canonical! };
      else tabs.push(tab);
    });
  }
  const seen = new Map<string, number>();
  return tabs.map((t) => {
    const n = (seen.get(t.label) ?? 0) + 1;
    seen.set(t.label, n);
    return n === 1 ? t : { ...t, label: `${t.label} (${n})` };
  });
}
