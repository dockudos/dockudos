export interface VideoProps {
  /** Title for screen readers. Required for embeds. */
  title: string;
  /** A video file (`/demo.mp4`). Plays in the page with controls. */
  src?: string;
  /** An `https://` page to embed, such as a YouTube or Vimeo embed URL. */
  embed?: string;
  poster?: string;
  /** Width over height of an embed. Default `16 / 9`. */
  ratio?: string;
}

/**
 * A video file with controls, or an embedded player. An embed must be `https://` and runs in a
 * sandbox; it loads only when scrolled into view.
 */
export function Video({
  title,
  src,
  embed,
  poster,
  ratio = '16 / 9',
}: VideoProps) {
  if (embed) {
    if (!/^https:\/\//i.test(embed)) {
      throw new Error(
        `<Video embed="${embed}">: only https:// URLs can be embedded`,
      );
    }
    return (
      <div
        className="not-prose my-5 overflow-hidden rounded-lg border"
        style={{ aspectRatio: ratio }}
      >
        <iframe
          src={embed}
          title={title}
          loading="lazy"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full border-0"
        />
      </div>
    );
  }
  if (!src) throw new Error('<Video> needs a `src` file or an `embed` URL');
  return (
    <video
      controls
      preload="metadata"
      poster={poster}
      aria-label={title}
      className="my-5 w-full rounded-lg border"
    >
      <source src={src} />
      <a href={src}>{title}</a>
    </video>
  );
}
