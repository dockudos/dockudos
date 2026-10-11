# Security review: the self-hosted platform (Phase 5)

Reviewed 2026-10-11 by reading the code against a checklist (authentication, sessions, authorization, CSRF, injection, SSRF,
secrets, untrusted code, data exposure, denial of service, supply chain). Findings were fixed and each has a test. This is a
self-review by the author of the code. **It is not the independent `security-auditor` review the phase plan asks for before a release**; that is
still open. See "Not covered".

## What was reviewed

`packages/platform`: `auth.ts`, `oidc-login.ts`, `permissions.ts`, `http.ts`, `webhooks.ts`, `builds.ts`, `sources.ts`, `exec.ts`, `editor.ts`,
`analytics.ts`, `privacy.ts`, `agent*.ts`, `git/*`, `safe-fetch.ts`, `storage.ts`, `sigv4.ts`, `backup.ts`, `queue.ts`, `config.ts`, `logger.ts`.
`apps/platform`: `next.config.mjs` (headers), `proxy.ts`, the preview frame. `packages/next`: `platform-verify.ts`. `deploy/`: Dockerfiles, Compose, Helm.

## Checked and fine

| Area | How it holds |
| --- | --- |
| Webhook authenticity | HMAC-SHA-256 (GitHub) or a shared token (GitLab), compared in constant time, before the body is parsed. The site comes from the URL, so its secret is known before anything is trusted. Unknown site, wrong provider and bad signature all return the identical 401, so ids cannot be probed (`webhooks.spec.ts`). |
| Webhook replay and retries | Delivery id and queued build are written in one transaction; a redelivery is a no-op; a new delivery for the same commit folds into the same build (unique `(site, commit, trigger)`). |
| API keys | 32 random bytes, only a SHA-256 hash stored, looked up by an 8-hex prefix, compared in constant time. Revoked, expired and wrong keys are indistinguishable. A key cannot create keys or exceed its creator's role. Repeated bad keys from one address are throttled. |
| Sessions | HMAC-signed, purpose-bound (a login cookie is not a session), 12 hours, `HttpOnly`, `SameSite=Lax`, `Secure` on https. The user is re-read on every request, so a deleted user is out at once and role changes apply immediately. |
| CSRF | Cookie-authenticated requests that change data must carry `Origin` equal to the dashboard's. Bearer-key requests are exempt (no ambient credentials). Sign-out checks origin too. |
| OIDC | Reuses the Phase 4 flow: PKCE, state, nonce, RS256/ES256 only, `iss`/`aud`/`exp` checked, `returnTo` restricted to local paths. An address the provider has not verified cannot become the instance owner. |
| Authorization | One table maps actions to a minimum role. Nobody grants above their own role, edits someone above them, or leaves a team without an owner. Another team's site answers 403 in the same way an unknown one does for the actions that matter. |
| Editor scope | Only `docs.json`, `docs/**/*.md(x)` and `public/media/*` can be written. Package files, scripts, workflows and config are out of reach, so an editor account cannot change how the site is built. Front matter and `docs.json` are validated before commit; `direct` commits need admin. |
| Media | Type from magic bytes, not name or `Content-Type`; 10 MB cap; SVGs sanitised (no script, no `foreignObject`, no handlers); stored under a generated name. |
| Preview of repository MDX | MDX is code. The preview runs in an `<iframe sandbox="allow-scripts">` and is served with `Content-Security-Policy: sandbox allow-scripts; connect-src 'none'; frame-ancestors 'self'`: an opaque origin, no network. Browser test: `document.cookie` inside the frame is blocked. |
| Agent never publishes | Its only write interface (`createAgentGit`) creates a new `dockudos/agent-…` branch and a pull request. No method commits to an existing branch. The evaluation set asserts zero pushes to the default branch; model output cannot choose a path (the file comes from the page being edited). |
| Untrusted model input | Diffs and pages are fenced with random markers and the system prompt names them untrusted; the model has no tools. Its reply must match a fixed format and pass checks: valid front matter, not a rewrite, no new `import`/`export` lines, no `<script>`/`<iframe>`/handlers. |
| SSRF | Every outbound request made for a user (Git hosts, the model, S3) goes through `createSafeFetch`: https only, no embedded credentials, DNS resolved and any private, loopback, link-local (cloud metadata), CGNAT or multicast address refused (IPv4-mapped IPv6 included), redirects followed by hand and re-checked, credentials dropped when a redirect leaves the host, size and time capped. Hosts the operator configured are trusted. |
| Build isolation (partial) | Fetch passes the Git token through the environment, never argv or the URL. Dependency install runs `--ignore-scripts`. Commands get a minimal environment (no database URL, no session secret, no tokens), a time limit, a capped log, and are killed as a process group. Symlinks in the output are skipped. Build logs are scrubbed of known secrets. |
| Hosted sites | Served only on `<slug>.<sitesDomain>`, which config validation refuses to equal the dashboard host or a parent of it. Platform cookies are host-only, so site scripts cannot see them. Path traversal (`..`, encoded, NUL) is refused; symlinks never reach storage; `nosniff`. |
| Analytics privacy | No IP, no user agent, no cookie, no query string is stored. The visitor is a keyed daily hash of a truncated address and agent; search text is scrubbed of emails, numbers, ids and token-like strings; conversations are opt-in with retention and are deleted when switched off. A browser cannot label its own traffic as AI. Do Not Track and Global Privacy Control are honoured. Test asserts none of address, agent, query string or referrer path appear in stored rows. |
| Secrets in logs | Fields named like secrets are never written; every configured secret value (including the database password in the URL) is scrubbed from messages, errors and stacks. S3 errors never include the secret key. |
| Rate limits | Ingest per site and address, webhooks per site, sign-in per address, API per actor, bad bearer attempts per address. In memory, per process. |
| Config | All variables validated at start, all problems reported at once, secrets never echoed. |
| Backup | Files are mode 0600 in a 0700 directory; every file is checked against a SHA-256 manifest before anything is written; restore refuses a non-empty instance and runs in one transaction. |
| Containers and cluster | Non-root user, no privilege escalation, capabilities dropped, read-only root filesystem (platform pods), seccomp default, service account token not mounted, rolling updates that never reduce capacity, optional network policy for the worker. |
| Dependencies | `pnpm audit --prod` shows no advisories for `packages/platform` or `apps/platform` (the dashboard is on Next 16.4). |

## Found and fixed during the work

Real defects that a test, a tool or a second look turned up after the code was written:

1. **Event name collision.** The first analytics event for assistant answers reused `dockudos:assistant`, which already means "open the
   assistant panel", so every answer would have popped the panel open. A Phase 2 test caught it; analytics now has its own `dockudos:track` event.
2. **Vulnerable Next.js.** `pnpm audit` showed the workspace pins Next 16.1, which has critical and high advisories patched in 16.3.8 or later.
   The dashboard is network-exposed, so it was moved to Next 16.4. The other apps were left alone (see below).
3. **Ambiguous "latest" run.** Agent runs were ordered by timestamp alone; two runs in the same millisecond could be taken in the wrong order, so a
   change could be diffed against the wrong base. A sequence column now breaks ties.
4. **Config errors hidden by other errors.** When one variable was invalid, the checks that depend on others (S3, OIDC, roles) never ran, so
   problems were not all reported at once. They now read the raw environment independently.
5. **A body-size error reported as a syntax error** on the ingest endpoint (413 became 400). Fixed so a client can tell them apart.
6. **Editor bugs.** Creating a page selected `docs.json` instead of the page; deleting a page created in the same session asked the server to delete a
   file that never existed. Found by the unit and browser tests.
7. **A parent process that froze its child.** The first smoke harness hosted the test database in the same process that waited synchronously on the
   server using it. Not a product bug, but it showed the server has no startup timeout on the database; it retries until the pool connects.

Mitigations designed in from the start, each with a test, listed here because they are easy to get wrong in a rewrite: an address the provider has
not verified cannot make someone instance owner; a browser cannot label its own traffic as AI; build logs and error messages are scrubbed of
configured secrets before they are stored; unknown site, wrong provider and bad signature give the same webhook response; hosted sites cannot share a
host with the dashboard.

## Not covered, and what to do about it

| Gap | Why it matters | What to do |
| --- | --- | --- |
| **No independent review or penetration test.** | This was written and reviewed by the same author. | Commission the `security-auditor` review the plan requires before a release. |
| **The build worker runs repository code** in the worker process. | `--ignore-scripts` and a minimal environment do not stop `next.config.js` or MDX from running code. A hostile repository can use the worker's network and CPU. | For repositories you do not trust, run workers in their own namespace with the Helm `networkPolicy` (egress to your Git host and registry only, not the cloud metadata address or internal ranges), memory limits and no secrets. A gVisor or microVM runner is the proper fix and is not built. |
| **Rate limits are per process.** | N replicas allow N times the limit. | Put limits at the ingress as well. |
| **Sessions are stateless.** | A session cannot be revoked before it expires (12 h) except by deleting the user or rotating the secret. Team roles do apply immediately. | Rotate `DOCKUDOS_SESSION_SECRET` after an incident. |
| **Webhook secrets are stored in plain text.** | HMAC needs the secret. Backups contain them. | Encrypt backups; rotate from the dashboard. |
| **Public ingest.** | Anyone who knows a site id can send events for it. | Counts are indicative. Rate limits apply. |
| **DNS rebinding in `safe-fetch`.** | The address is checked, then the fetch resolves again. | Applies to untrusted hosts only; the platform makes no such request today (Git hosts and the model are operator-configured). Pin the resolved address if user-supplied URLs are ever added. |
| **`/metrics` is open when no token is set.** | It lists route groups and counts. | Set `DOCKUDOS_METRICS_TOKEN`; the bundled proxy and ingress do not route it. |
| **Floating image tags.** | `minio/minio:latest` and `caddy:2` change under you. | Pin digests in production. No image scanning is configured. |
| **No audit log.** | Who changed what is only in Git history and the `edits` table. | Planned for the enterprise tier (E.12). |
| **Containers, Compose and the cluster install were not run.** | There was no Docker daemon or cluster in the environment this was built in. | The CI jobs (`.github/workflows/platform.yml`) run them; read their first results before relying on them. |
| **Other apps are on vulnerable Next 16.1.** | `apps/docs`, `apps/example`, `apps/web`, `apps/scale` and the `next` peer range of `@dockudos/next` are exposed to the advisories `pnpm audit` lists (2 critical, 18 high across the workspace). | Upgrade the workspace to Next 16.4 and re-run the Phase 1-4 suites. Deliberately not done here: it is a separate change with its own risk. |
