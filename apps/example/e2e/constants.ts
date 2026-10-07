/** The model key the e2e server runs with. It must never appear in any page, script or response. */
export const LLM_KEY = 'sk-e2e-must-never-leak-7f3a9c1d';

/** A key for programs that call the assistant themselves (`DOCKUDOS_API_KEYS`). */
export const API_KEY = 'e2e-api-key-0123456789abcdef';

/** The page on another origin that embeds the assistant, and one that is not allowed to. */
export const HOST = 'http://127.0.0.1:4390';
export const STRANGER = 'http://127.0.0.1:4391';
