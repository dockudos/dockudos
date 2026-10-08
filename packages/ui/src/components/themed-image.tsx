import { ZoomableImage } from './zoomable-image.tsx';
import { type ToMarkdown } from '@dockudos/core';

export interface ThemedImageProps {
  /** The image shown in light mode (and on paper). */
  light: string;
  /** The image shown in dark mode. */
  dark: string;
  /** Describes the image. Both versions share it. */
  alt?: string;
  width?: number;
  height?: number;
}

/**
 * One picture in two versions, such as a screenshot of each theme. The reader sees the one that
 * matches the current theme; paper always gets the light one.
 */
export function ThemedImage({
  light,
  dark,
  alt = '',
  width,
  height,
}: ThemedImageProps) {
  return (
    <>
      <span className="dk-themed-light">
        <ZoomableImage src={light} alt={alt} width={width} height={height} />
      </span>
      <span className="dk-themed-dark">
        <ZoomableImage src={dark} alt={alt} width={width} height={height} />
      </span>
    </>
  );
}

ThemedImage.toMarkdown = ((props) => `![${props.alt ?? ''}](${props.light})`) satisfies ToMarkdown<{
  light: string;
  alt?: string;
}>;
