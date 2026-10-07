# 0004: Keyword-first retrieval

## Context
The assistant, search, navigation, `llms.txt` and MCP share one content index. Embeddings add cost, a provider dependency and build time.

## Decision
Keyword (BM25-style) retrieval is the default and must work with no keys. Embeddings are an optional config switch that adds vector scores merged by rank fusion.

## Consequences
- Every AI feature has a no-LLM degraded mode.
- The index format reserves an optional `vector` per chunk from the start.
