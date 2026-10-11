/** The version and language of the page being read, so questions and requests stay inside them. */
export interface AskScope {
  locale?: string;
  version?: string;
}

let current: AskScope = {};

/** Set by `DocsLayout` on every page. */
export function setAskScope(scope: AskScope): void {
  current = scope;
}

/** What to send along with a question: only the parts that are set. */
export function askScopeFields(): AskScope {
  return {
    ...(current.locale && { locale: current.locale }),
    ...(current.version && { version: current.version }),
  };
}
