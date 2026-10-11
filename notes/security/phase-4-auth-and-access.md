# Security review: sign-in, access and imported content (Phase 4)

Reviewed 2026-10-11 by reading the code against a checklist (authentication, session management, access control, input handling, SSRF,
output encoding, caching, secrets). Findings were fixed and each has a test. Nothing here replaces an outside review before a
paid offering depends on it; see "Not covered".

## What was reviewed

`packages/core`: `session.ts`, `oidc.ts`, `principal.ts`, `access.ts` (`expandAccessRules`), `index-filter.ts`, `sources/*`.
`packages/next`: `auth.ts`, `session.ts`, `access.ts` (login rule, language redirect), `viewer.ts`, `api.ts`, `ai-api.ts`, `mcp.ts`,
`kudos.ts` (webhook), `feeds.ts`, `og.ts`. `packages/cli`: `sync`, `epub`, `static`.

## Checked and fine

| Area | How it holds |
| --- | --- |
| Login CSRF / mix-up | `state` and `nonce` are random, kept in a signed `HttpOnly` cookie that expires in 10 minutes, and compared in constant time. A code from another attempt fails on the nonce (`auth.spec.ts`). |
| Code interception | PKCE (S256); the mock provider checks the verifier hashes to the challenge. |
| ID token | RS256 and ES256 only (no `none`, no HS256), key chosen by `kid` from the provider's set, then `iss`, `aud` (+`azp` for several), `exp`, `iat`, `nonce`. Keys refreshed once on failure (rotation). |
| Session cookie | HMAC-SHA-256 over `payload.purpose.expiry`, a login token cannot be used as a session (purpose is signed). `HttpOnly`, `SameSite=Lax`, `Secure` on https, bounded lifetime. Forged, expired, other-secret and truncated cookies are refused (`access-layer.spec.ts`). |
| Open redirect | `returnTo` accepts a path on this site only (`//x`, `\`, schemes, control characters become `/`). Sign-in and sign-out. |
| Deny by default | No session, a bad session, a missing secret or a missing role never opens a page. A missing `DOCKUDOS_AUTH_SECRET` answers 503. |
| Rules and variants | Rules written for the default version and language are expanded to every version and language, so a translation or an old copy of a private page is not left open (`expandAccessRules`). |
| Retrieval | Search, the browser index, the assistant, "Take me there", MCP and `llms*.txt` are filtered per request by the same `authorize()` as the page route. The full index is never served: `site.index()` is the public form, `site.indexFor(viewer)` the viewer's. The assistant's answer cache is keyed by viewer scope. Leak test over every surface: `content-at-scale.spec.ts`, `private.spec.ts`. |
| Page output | Protected pages are not built ahead of time (`staticParams`), the sidebar of open pages leaves them out, and a protected `/og/…png` is a bare card. |
| Static export | Pages behind rules are left out of files, index, twins, sitemap and cards. |
| Imported content | Escaped for MDX (braces, `<`), `import`/`export` lines and `javascript:`/`data:` links neutralised, HTML converted from a tag whitelist. Compiles hostile samples without running them (`sources-mdx.spec.ts`). |
| Source requests | https only (http for localhost), size and time limits, token sent to the listing's host only. |
| Webhook | Config-authored URL, 3 s limit, `redirect: error`, no address, cookie, name or email (user id only when asked). |
| Output encoding | RSS, OPF and XHTML escape all text; control characters stripped; EPUB image names are content hashes. |

## Found and fixed during the work

1. **Relative `Location` from the proxy.** The sign-in and language redirects were relative; Next.js rejects those with `Invalid URL` (a 500).
   Found by the browser tests; now absolute.
2. **MDX injection through imports.** `import …` / `export …` at the start of a line was still ESM after braces were escaped, and
   `[x](javascript:…)` survived. Found by compiling hostile samples; `mdxSafe` now neutralises both.
3. **A private page's title in the sidebar.** Pages listed in `navigation` showed in the sidebar of every page. Open pages now get a
   sidebar without protected pages (`navFor`).
4. **Remote list SSRF.** A listing could name private addresses for the build machine to fetch. Entries on another host may no longer be
   private or link-local addresses.
5. **EPUB image path boundary.** `startsWith(cwd)` was not a path boundary and followed links; now `realpath` and a separator check.
6. **Protected pages in the build output.** They were prerendered as static HTML; now rendered on request, after the guard.

## Known limits (documented in the guides)

- **Sessions are stateless.** Signing out clears the cookie but cannot revoke a copy someone stole before it expires; keep `auth.sessionHours` short
  for sensitive docs, and rotate `DOCKUDOS_AUTH_SECRET` to end every session.
- **`seo.siteUrl` should be set** behind a TLS-terminating proxy; the `Secure` flag and the redirect address come from it.
- **No rate limit on `/api/auth/*`.** Discovery and keys are cached, but put a limit in front of public sites.
- **The assistant's API keys use the `Authorization` header**, so a `token`-rule reader sends the token as `X-Docs-Token` there.
- **Names are not resolved** by the private-address check of `remote` sources, so DNS rebinding is out of scope; sources are authored by the site owner.
- **Cards use one Latin font**; the text of other scripts renders as boxes.

## Not covered

Live providers (Auth0, Okta, Entra ID, Keycloak): the flow is tested against a mock provider that checks PKCE and signs real RS256 tokens, not
against a hosted one. Notion and Sanity adapters are tested against recorded-shape responses. No outside penetration test.
