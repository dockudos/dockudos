import { parseDocument } from 'yaml';

const FIELDS = [
  ['title', 'Title'],
  ['description', 'Description'],
  ['icon', 'Icon'],
] as const;

/** Edit the common front matter fields without disturbing the rest (order and comments are kept). */
export function Frontmatter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const doc = parseDocument(value);
  const data = (doc.toJS() ?? {}) as Record<string, unknown>;
  const set = (key: string, text: string) => {
    const d = parseDocument(value);
    if (text === '') d.delete(key);
    else d.set(key, text);
    onChange(d.toString().replace(/\n+$/, ''));
  };
  return (
    <details className="frontmatter" open>
      <summary>Page settings</summary>
      {doc.errors.length > 0 ? (
        <p role="alert" className="error">
          The page settings are not valid YAML:{' '}
          {doc.errors[0]!.message.split('\n')[0]}. Fix them in Source view.
        </p>
      ) : (
        FIELDS.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              value={typeof data[key] === 'string' ? data[key] : ''}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))
      )}
    </details>
  );
}
