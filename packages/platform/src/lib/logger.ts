export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

/** Field names whose values are never written, whatever they hold. */
const SENSITIVE_KEY = /secret|token|password|passwd|authorization|api[-_]?key|cookie|signature|credential|private/i;
const REDACTED = '[redacted]';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Where lines go. Default: stdout. */
  write?: (line: string) => void;
  /** Secret values to scrub from every string, in case one ends up in a message or an error. */
  secrets?: readonly string[];
  bindings?: Record<string, unknown>;
  now?: () => Date;
}

/**
 * Structured logs: one JSON object per line. Values under sensitive field names are replaced, and any
 * configured secret is scrubbed from every string, so a leaked URL or error message does not leak the key.
 */
export function createLogger({
  level = 'info',
  write = (line) => process.stdout.write(`${line}\n`),
  secrets = [],
  bindings = {},
  now = () => new Date(),
}: LoggerOptions = {}): Logger {
  const scrubList = secrets.filter((s) => s.length >= 6);
  const scrub = (text: string): string => {
    let out = text;
    for (const s of scrubList) out = out.split(s).join(REDACTED);
    return out;
  };
  const clean = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return scrub(value);
    if (value instanceof Error)
      return { name: value.name, message: scrub(value.message), stack: value.stack ? scrub(value.stack) : undefined };
    if (value === null || typeof value !== 'object') return value;
    if (depth > 5) return '[deep]';
    if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : clean(v, depth + 1);
    return out;
  };
  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    write(
      JSON.stringify({
        time: now().toISOString(),
        level: lvl,
        msg: scrub(msg),
        ...(clean({ ...bindings, ...fields }, 0) as object),
      }),
    );
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (b) =>
      createLogger({ level, write, secrets, bindings: { ...bindings, ...b }, now }),
  };
}

export const silentLogger: Logger = createLogger({ level: 'silent' });
