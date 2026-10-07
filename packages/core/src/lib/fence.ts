/**
 * Tracks whether lines are inside a fenced code block. Fences may be indented
 * to any depth: in MDX, a fence inside `<Step>` or a list item is usually indented.
 */
export class FenceTracker {
  #open: string | undefined;

  /**
   * Feed lines in order. Returns true for a line that is part of a fence (its
   * opening and closing lines included) and should not be read as prose.
   */
  inCode(line: string): boolean {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!this.#open) this.#open = marker;
      else if (
        marker[0] === this.#open[0] &&
        marker.length >= this.#open.length
      )
        this.#open = undefined;
      return true;
    }
    return this.#open !== undefined;
  }
}
