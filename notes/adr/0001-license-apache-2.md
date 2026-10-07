# 0001: Apache 2.0 license

## Context
The goal is maximum adoption of the open-source library, with a paid managed cloud as the business. Alternatives were AGPL or a source-available license to deter resellers.

## Decision
License all code in this repository under Apache 2.0. It is permissive, includes a patent grant, and is familiar to enterprises.

## Consequences
- Anyone may host dockudos commercially. The moat is operations, support and managed AI, not the license (matches the "cloud sells operations, not features" principle).
- Every `package.json` carries `"license": "Apache-2.0"` and the repo has a `LICENSE` file.
- Revisiting this later (for example to AGPL) would need contributor agreement; add a CLA/DCO decision before accepting outside contributions at scale. See open item in CONTRIBUTING.md.
