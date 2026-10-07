import { type ThemeMode, themeScript } from './theme.ts';

/** Render in `<head>`. Sets the `dark` class before paint, from the stored choice or `defaultMode`. */
export function ThemeScript({
  defaultMode = 'system',
}: {
  defaultMode?: ThemeMode;
}) {
  return (
    <script dangerouslySetInnerHTML={{ __html: themeScript(defaultMode) }} />
  );
}
