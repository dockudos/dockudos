# 0006: First LLM and embedding adapters

## Context
The provider layer is pluggable (`LLMProvider`, `EmbeddingProvider`). Phase 2 needs a concrete first set.

## Decision
Ship in Phase 2:
- **LLM:** an OpenAI-compatible adapter (covers OpenAI, and any compatible endpoint such as local or gateway servers via `baseURL`) and an Anthropic adapter.
- **Embeddings:** an OpenAI-compatible adapter.
- A mock provider for tests and the CI evaluation set.
- Env vars: `DOCKUDOS_LLM_API_KEY`, `DOCKUDOS_EMBEDDINGS_API_KEY`.

## Consequences
- Other providers use the custom-adapter interface until demand justifies a built-in one.
- Adapters use plain `fetch` streaming to avoid heavy SDK dependencies.
