# 0008: How the palette offers the assistant and AI navigation

## Context
The command palette searches. Phase 2 adds two AI actions on the same input: "Ask" (an answer with sources) and "Take me there" (jump to the best section). ai.md left open whether they are a separate palette mode or the default for natural-language queries.

## Decision
Keyword search stays the default. The AI actions are rows in the same list, and what was typed decides where they sit:

- A query that reads like a question (a question mark, or a leading question word) puts **Ask AI** first, then **Take me there**, then search results.
- Anything else shows search results first and the two AI rows after them, so Enter on keywords still opens the best result and nobody is sent to a model by accident.
- With no search results at all and three words or more, **Take me there** comes first: the request is likelier a task than a keyword search.
- `Tab` always asks; `Cmd/Ctrl+Enter` always means "take me there".
- Asking opens a conversation inside the palette (Esc returns to search); the same conversation is also available in a side panel.
- "Take me there" jumps only when confident. When it is not, it lists the best guess and the alternatives and lets the reader choose.

## Consequences
- No new mode to learn, and a site without AI looks and works exactly as before.
- Cost is only incurred by an explicit action, never by typing.
- The heuristic is a few lines (`looksLikeQuestion`) and easy to tune or replace later without changing the interface.
