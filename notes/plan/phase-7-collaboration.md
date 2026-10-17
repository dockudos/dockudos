# Phase 7: Collaboration

**Goal:** a team can write and review docs together in the platform, not only one at a time through pull requests.

**Depends on:** Phase 5 (platform: auth, roles, editor, Git providers, database) and the visual editor (`dockudos edit`, `apps/editor`, MDX <-> ProseMirror converter). **Done when:** two people edit the same page and see each other, comments can be left on text and resolved, and nothing a person did is lost.

Today: the platform editor saves a pull request per save and detects conflicts after the fact; the local editor is single-user and relies on Git. There are roles (viewer, editor, admin) but no comments, review state or presence.

## Decision gate (do first)

- [ ] P7.0 Write an ADR choosing how live editing works. Options:
  1. **Comments and review only**, no live co-editing. Cheapest; files stay the source of truth.
  2. **Presence and soft locks**: show who is on a page, warn before two people edit the same one.
  3. **Real-time co-editing** with Yjs and TipTap's collaboration extension, with the Git file as the persisted result.
  Recommendation: build 7A and 7B first, then do 7C only if teams ask for it. Real-time editing changes the data model (the CRDT, not the file, becomes the live truth) and needs the converter's "unedited blocks are written back verbatim" guarantee to hold across merges.

## Tasks

### 7A. Comments and review
- [ ] P7.1 Data model in the platform database: threads and comments anchored to a page, a block (stable id) and an optional text range; resolved state; author; timestamps. Migration and tests.
- [ ] P7.2 Anchoring that survives edits: store the quoted text and block id; re-anchor after a save, and show an orphaned thread instead of dropping it when the text is gone.
- [ ] P7.3 API: create, reply, resolve, reopen, delete (author or admin); role checks (viewers read, editors write); rate limits; input size limits; comment text is treated as untrusted (rendered as text, no HTML).
- [ ] P7.4 Editor UI: select text, add a comment; margin markers; thread panel; filter by open and resolved; keyboard access.
- [ ] P7.5 Mentions (`@name`) and notifications: in-app list, and optional email or webhook (Slack-style) with a documented payload. No notification without an opt-in setting.
- [ ] P7.6 Review state per change set: a draft can be marked "ready for review", approved or changes-requested by another editor; the PR created on save carries the review summary. Optional rule: require one approval before the editor opens the PR.
- [ ] P7.7 Page history in the editor: list of commits for a page, view a diff, restore a version (creates a new commit).
- [ ] P7.8 Audit trail of comments and review actions in the existing analytics/event store (admin view).

### 7B. Presence and soft locks
- [ ] P7.9 Presence channel (server-sent events or WebSocket) per site and page: who has it open, who is typing; coloured avatars in the editor.
- [ ] P7.10 Soft lock: opening a page someone is editing shows a banner with their name and offers "view only" or "edit anyway"; the existing conflict resolution still applies on save.
- [ ] P7.11 Works behind the Compose proxy and the Helm ingress (documented timeouts, heartbeat, reconnect with back-off).

### 7C. Real-time co-editing (only if P7.0 chooses it)
- [ ] P7.12 Yjs document per page, persisted in the platform database; server relays updates; authentication on the socket.
- [ ] P7.13 TipTap collaboration and cursor extensions wired to the existing schema (including `jsxBlock`, `rawBlock`, `rawInline`, `jsxInline`).
- [ ] P7.14 Converter guarantees under merge: property tests that concurrent edits to different blocks produce a file where every untouched block is byte-identical to the original.
- [ ] P7.15 Save policy: debounced commit of the merged document to a branch, one author line per contributor (`Co-authored-by`), conflict path when the branch moved outside the editor.
- [ ] P7.16 Offline and reconnect: edits made while disconnected merge on return; size limits and compaction of the update log.

### 7D. Local editor
- [ ] P7.17 `dockudos edit` shows Git-based collaboration cues without a server: files changed on disk by a pull, upstream commits since open (`git fetch` is never run implicitly), and a "this page changed upstream" banner.
- [ ] P7.18 Docs in `apps/docs` (platform pages and the visual editor guide): roles, comments, review, presence, what is stored where.

## Acceptance criteria

- [ ] Two browsers open the same page: each sees the other's presence within 2 s; the soft-lock banner appears.
- [ ] A comment added by one editor is visible to another, can be replied to and resolved, and survives an edit of the surrounding text (re-anchored) or is shown as orphaned.
- [ ] A viewer cannot create, edit or delete comments, and cannot read comments of a site they cannot read (tests per role and per site).
- [ ] Restoring a version creates a new commit and loses no history.
- [ ] (If 7C) two people type in different blocks of one page at once; the saved file has both edits and every other block unchanged.

## Tests

- [ ] Unit: anchoring and re-anchoring, role matrix for every comment endpoint, mention parsing, review state machine.
- [ ] Integration (PGlite, as in Phase 5): comment lifecycle, notifications with a local webhook receiver, history and restore against the in-memory Git host.
- [ ] Browser (Playwright, two contexts): presence, soft lock, comment thread across users.
- [ ] (If 7C) Property tests over random concurrent edits; reconnect test; load test of N editors on one page.
- [ ] Security: stored XSS through comment text and display names, cross-site comment access, socket authentication, rate limits.

## Risks

- **Real-time editing and verbatim Markdown.** The converter's byte-for-byte guarantee is the product's selling point for Git diffs; 7C must prove it holds under merges before it ships.
- **Unreviewed security surface.** Presence and comments add sockets and stored user text. Get the independent `security-auditor` review that Phase 5 still owes, and cover this phase in it.
- **Environment limits.** Docker and a cluster are still unavailable here; Compose and Helm checks for presence run in CI only.
