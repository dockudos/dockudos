'use client';

import {
  type Collection,
  type Environment,
  type RequestOrigin,
  type ResponseExample,
  type SavedRequest,
  type StoredRequest,
  type ToMarkdown,
  applyVariables,
  decodeSharedRequest,
  defaultSampleLanguages,
  diffLines,
  encodeSharedRequest,
  importText,
  maskSecret,
  neededVariables,
  sharedRequestUrl,
  suggestedName,
  toBruno,
  toCurl,
  toDockudosFile,
  toPostman,
  variableValues,
} from '@dockudos/core';
import {
  Download,
  FilePlus,
  Loader2,
  Plus,
  Send,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CopyButton } from '../copy-button.tsx';
import { CodeEditor, languageForMime } from './code-editor.tsx';
import {
  addCollection,
  addEnvironment,
  addImported,
  addVariable,
  chooseEnvironment,
  clearHistory,
  clearNotice,
  deleteCollection,
  deleteEnvironment,
  deleteExample,
  deleteRequest,
  keepExample,
  moveRequest,
  recordSent,
  renameCollection,
  renameEnvironment,
  saveRequest,
  removeVariable,
  setHistoryWithSecrets,
  setRememberSecrets,
  updateRequest,
  updateVariable,
  useApiClient,
} from './client-store.ts';
import { FieldInput, Pane, PaneTabs, ResponseView, formatSize } from './parts.tsx';
import { PROXY_ROUTE, type SendOutcome, sendRequest } from './send.ts';

/**
 * The API client: the requests a reader saved, the environments their `{{variables}}` come from, what they sent, and
 * the responses they kept. Everything is in their own browser; no account, no server, and no scripting.
 *
 * It is used in two places: as a page of its own (`<ApiClient />` in MDX, where it can call any address), and as a
 * panel over an endpoint page, opened from the playground's **Save** and **Collections** buttons.
 */


export type ClientTab = 'collections' | 'environments' | 'history';

export interface ClientPrefill {
  name?: string;
  request: StoredRequest;
  origin?: RequestOrigin;
  /** Credential values to take out before the request is stored. */
  secrets?: string[];
  /** Header, query and cookie names of the operation's security schemes. */
  authFields?: string[];
}

export interface ApiClientProps {
  /** Fill the editor with this request when it opens (the playground passes what is in its form). */
  prefill?: ClientPrefill;
  /** Which list the side opens on. */
  start?: ClientTab;
  /** Send through the site's proxy route, as the playground does when `openapi.playground.proxy` is on. */
  proxy?: boolean;
  /** Shown when the client sits over an endpoint page. */
  onClose?: () => void;
  /** A heading for the page version. */
  title?: string;
}

/** What the editor is holding: a request being written, and where it would be saved. */
interface Draft {
  savedId?: string;
  name: string;
  collectionId?: string;
  method: string;
  url: string;
  headers: [string, string][];
  contentType: string;
  body: string;
  origin?: RequestOrigin;
  secrets?: string[];
  authFields?: string[];
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const emptyDraft = (): Draft => ({
  name: '',
  method: 'GET',
  url: '',
  headers: [],
  contentType: 'application/json',
  body: '',
});

const draftOf = (prefill: ClientPrefill): Draft => ({
  name: prefill.name ?? suggestedName(prefill.request),
  method: prefill.request.method,
  url: prefill.request.url,
  headers: prefill.request.headers,
  contentType: prefill.request.body?.contentType ?? 'application/json',
  body: prefill.request.body?.text ?? '',
  ...(prefill.origin ? { origin: prefill.origin } : {}),
  ...(prefill.secrets ? { secrets: prefill.secrets } : {}),
  ...(prefill.authFields ? { authFields: prefill.authFields } : {}),
});

const draftFrom = (saved: SavedRequest): Draft => ({
  savedId: saved.id,
  name: saved.name,
  collectionId: saved.collectionId,
  method: saved.request.method,
  url: saved.request.url,
  headers: saved.request.headers,
  contentType: saved.request.body?.contentType ?? 'application/json',
  body: saved.request.body?.text ?? '',
  ...(saved.origin ? { origin: saved.origin } : {}),
});

const requestOf = (draft: Draft): StoredRequest => {
  const headers = draft.headers.filter(([name]) => name.trim());
  const body = draft.body.trim()
    ? { contentType: draft.contentType, text: draft.body }
    : undefined;
  // A body needs to say what it is; a header the reader wrote themselves wins.
  const typed = headers.some(([name]) => name.toLowerCase() === 'content-type');
  return {
    method: draft.method,
    url: draft.url.trim(),
    headers:
      body && !typed ? [['Content-Type', body.contentType], ...headers] : headers,
    ...(body ? { body } : {}),
  };
};

const sorted = <T extends { order: number }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.order - b.order);

const when = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The client as a page: `<ApiClient />` in any MDX file. */
export function ApiClient(props: ApiClientProps) {
  return <ClientView {...props} />;
}

// In Markdown (and so for an AI tool) the client is a note: there is nothing to try in a text file.
ApiClient.toMarkdown = (() =>
  'An API client runs on this page in the browser: saved requests, environments, history, and import and export.') satisfies ToMarkdown;

/** The client over an endpoint page, with a close button. */
export function ApiClientPanel(props: ApiClientProps) {
  return <ClientView {...props} panel />;
}

function ClientView({
  prefill,
  start = 'collections',
  proxy = false,
  onClose,
  title,
  panel = false,
}: ApiClientProps & { panel?: boolean }) {
  const state = useApiClient();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() =>
    prefill ? draftOf(prefill) : emptyDraft(),
  );
  const [tab, setTab] = useState<ClientTab>(start);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome>();
  const [shared, setShared] = useState<string>();
  const [savedNote, setSavedNote] = useState<string>();
  const controller = useRef<AbortController>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // A link that carries a request (`#request=…`) opens with it in the editor, whether the page is loaded fresh or the
  // link only changes the fragment of the page the reader is already on.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const fromHash = () => {
      const sharedRequest = decodeSharedRequest(window.location.hash);
      if (!sharedRequest) return;
      setDraft(draftOf(sharedRequest));
      setOutcome(undefined);
      setShared(undefined);
      setSavedNote('This request came from a link. Credentials are never part of one.');
      // Over an endpoint page the link is spent once read, so opening the panel again shows the playground's request.
      if (panel) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [panel]);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (panel) heading.current?.focus();
  }, [panel]);

  const active = state.environments.find((e) => e.id === state.activeEnvironmentId);
  const values = useMemo(
    () => (active ? variableValues(active.variables) : {}),
    [active],
  );
  const request = requestOf(draft);
  const resolved = useMemo(() => applyVariables(request, values), [request, values]);
  const examples = state.examples.filter(
    (e) => !draft.savedId || e.requestId === draft.savedId,
  );

  const send = async () => {
    // Nothing is sent to an address that still has a `{{variable}}` with no value behind it.
    if (!resolved.request.url || resolved.missing.length || resolved.cyclic.length) return;
    controller.current?.abort();
    const abort = (controller.current = new AbortController());
    setBusy(true);
    setOutcome(undefined);
    const result = await sendRequest(resolved.request, {
      signal: abort.signal,
      proxy: proxy ? PROXY_ROUTE : undefined,
    });
    if (abort.signal.aborted) return;
    setOutcome(result);
    setBusy(false);
    recordSent({
      request,
      ...(result.ok
        ? { status: result.response.status, ms: result.response.ms }
        : { error: result.message }),
      ...(draft.savedId ? { requestId: draft.savedId } : {}),
    });
  };

  const save = () => {
    if (!request.url) {
      setSavedNote('Give the request an address first.');
      return;
    }
    if (draft.savedId) {
      updateRequest(draft.savedId, { name: draft.name, request });
      setSavedNote(`Saved “${draft.name || suggestedName(request)}”.`);
      return;
    }
    const saved = saveRequest({
      ...(draft.collectionId ? { collectionId: draft.collectionId } : {}),
      name: draft.name,
      request,
      ...(draft.origin ? { origin: draft.origin } : {}),
      ...(draft.secrets ? { secrets: draft.secrets } : {}),
      ...(draft.authFields ? { authFields: draft.authFields } : {}),
    });
    setDraft((d) => ({ ...d, savedId: saved.id, collectionId: saved.collectionId, name: saved.name }));
    setSavedNote(
      saved.redacted?.length
        ? `Saved “${saved.name}”. ${saved.redacted.join(', ')} ${saved.redacted.length > 1 ? 'were' : 'was'} left out: a credential is never stored. Use a secret variable to send it again.`
        : `Saved “${saved.name}”.`,
    );
  };

  const share = () => {
    const { text, tooLong } = encodeSharedRequest(request, draft.name);
    if (tooLong) {
      setSavedNote('This request is too long to put in a link. Export it to a file instead.');
      return;
    }
    setShared(
      sharedRequestUrl(
        typeof window === 'undefined' ? '' : window.location.href,
        text,
      ),
    );
  };

  const open = (saved: SavedRequest) => {
    setDraft(draftFrom(saved));
    setOutcome(undefined);
    setShared(undefined);
    setSavedNote(undefined);
  };

  const Wrapper = panel ? 'div' : 'section';
  return (
    <Wrapper
      className="dk-api-client"
      data-panel={panel ? '' : undefined}
      {...(panel ? { role: 'dialog', 'aria-modal': false, 'aria-label': 'API client' } : {})}
    >
      <header className="dk-api-client-head">
        <h2 className="dk-api-client-title" tabIndex={-1} ref={heading}>
          {title ?? 'API client'}
        </h2>
        <EnvironmentPicker
          environments={sorted(state.environments)}
          activeId={state.activeEnvironmentId}
          id={`${id}-env`}
        />
        {onClose && (
          <button type="button" className="dk-api-tool" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
            Close
          </button>
        )}
      </header>

      {state.where === 'memory' && (
        <p className="dk-api-status" role="status">
          {state.notice ??
            'This browser is not keeping the client’s data, so what you save lasts until the page is closed.'}
        </p>
      )}
      {state.notice && state.where !== 'memory' && (
        <p className="dk-api-error" role="alert">
          {state.notice}{' '}
          <button type="button" className="dk-api-tool" onClick={clearNotice}>
            Dismiss
          </button>
        </p>
      )}

      <div className="dk-api-client-body">
        <aside className="dk-api-client-side" aria-label="Saved requests">
          <PaneTabs
            label="Client"
            idBase={`${id}-side`}
            value={tab}
            onChange={(value) => setTab(value as ClientTab)}
            tabs={[
              { id: 'collections', label: 'Collections', count: state.requests.length },
              { id: 'environments', label: 'Environments', count: state.environments.length },
              { id: 'history', label: 'History', count: state.history.length },
            ]}
          />
          <Pane idBase={`${id}-side`} id="collections" active={tab}>
            <CollectionTree
              collections={sorted(state.collections)}
              requests={state.requests}
              openId={draft.savedId}
              onOpen={open}
              id={`${id}-tree`}
            />
            <Transfer
              collections={sorted(state.collections)}
              requests={state.requests}
              environments={state.environments}
              id={`${id}-transfer`}
            />
          </Pane>
          <Pane idBase={`${id}-side`} id="environments" active={tab}>
            <Environments
              environments={sorted(state.environments)}
              activeId={state.activeEnvironmentId}
              rememberSecrets={state.rememberSecrets}
              id={`${id}-envs`}
            />
          </Pane>
          <Pane idBase={`${id}-side`} id="history" active={tab}>
            <History
              entries={state.history}
              withSecrets={state.historyWithSecrets}
              onOpen={(entry) =>
                setDraft((d) => ({ ...d, savedId: undefined, method: entry.method, url: entry.url }))
              }
            />
          </Pane>
        </aside>

        <div className="dk-api-client-main">
          <form
            className="dk-api-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void send();
            }}
          >
            <div className="dk-api-bar">
              <div className="dk-api-url">
                <select
                  aria-label="Method"
                  className="dk-api-method-select"
                  data-method={draft.method.toLowerCase()}
                  value={draft.method}
                  onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}
                >
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <input
                  id={`${id}-url`}
                  aria-label="Address"
                  className="dk-api-base"
                  value={draft.url}
                  placeholder="https://api.example.com/pets or {{baseUrl}}/pets"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                />
              </div>
              {busy ? (
                <button
                  type="button"
                  className="dk-api-send"
                  data-busy=""
                  onClick={() => {
                    controller.current?.abort();
                    setBusy(false);
                  }}
                >
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Cancel
                </button>
              ) : (
                <button type="submit" className="dk-api-send" disabled={!request.url}>
                  <Send className="size-4" aria-hidden="true" />
                  Send
                </button>
              )}
            </div>

            {resolved.missing.length > 0 && (
              <p className="dk-api-error" role="alert">
                No value for {resolved.missing.map((n) => `{{${n}}}`).join(', ')}. Add{' '}
                {resolved.missing.length > 1 ? 'them' : 'it'} to an environment, or write the value in.
              </p>
            )}
            {resolved.cyclic.length > 0 && (
              <p className="dk-api-error" role="alert">
                {resolved.cyclic.map((n) => `{{${n}}}`).join(', ')} refers to itself.
              </p>
            )}
            {resolved.request.url !== request.url && (
              <p className="dk-api-facts">
                Sends to <code>{resolved.request.url}</code>
              </p>
            )}

            <div className="dk-api-client-save">
              <FieldInput
                label="Name"
                id={`${id}-name`}
                value={draft.name}
                placeholder={suggestedName(request)}
                onChange={(name) => setDraft((d) => ({ ...d, name }))}
              />
              <label className="dk-api-label" htmlFor={`${id}-collection`}>
                <span>Collection</span>
                <select
                  id={`${id}-collection`}
                  value={draft.collectionId ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, collectionId: e.target.value || undefined }))
                  }
                >
                  <option value="">
                    {state.collections.length ? sorted(state.collections)[0]?.name : 'My requests'}
                  </option>
                  {sorted(state.collections).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="dk-api-client-actions">
                <button type="button" className="dk-api-tool" onClick={save}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  {draft.savedId ? 'Update' : 'Save'}
                </button>
                {draft.savedId && (
                  <button
                    type="button"
                    className="dk-api-tool"
                    onClick={() => {
                      setDraft(emptyDraft());
                      setOutcome(undefined);
                      setShared(undefined);
                      setSavedNote(undefined);
                    }}
                  >
                    <FilePlus className="size-3.5" aria-hidden="true" />
                    New request
                  </button>
                )}
                <button type="button" className="dk-api-tool" onClick={share}>
                  <Share2 className="size-3.5" aria-hidden="true" />
                  Share
                </button>
                <CopyAs request={resolved.request} />
                {draft.savedId && (
                  <button
                    type="button"
                    className="dk-api-tool"
                    onClick={() => {
                      deleteRequest(draft.savedId as string);
                      setDraft(emptyDraft());
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete
                  </button>
                )}
              </div>
            </div>
            {savedNote && (
              <p className="dk-api-status" role="status" data-testid="api-client-note">
                {savedNote}
              </p>
            )}
            {shared && (
              <label className="dk-api-label" htmlFor={`${id}-share`}>
                <span>Link to this request (no credentials in it)</span>
                <input id={`${id}-share`} readOnly value={shared} onFocus={(e) => e.target.select()} />
              </label>
            )}

            <Editor draft={draft} setDraft={setDraft} id={`${id}-editor`} />

            <div aria-live="polite" className="dk-api-result">
              {busy && <p className="dk-api-status">Waiting for the API…</p>}
              {outcome && !outcome.ok && (
                <div className="dk-api-failure" role="alert">
                  <strong>{outcome.message}</strong>
                  {outcome.hint && <p>{outcome.hint}</p>}
                </div>
              )}
              {outcome?.ok && (
                <>
                  <ResponseView response={outcome.response} id={`${id}-res`} />
                  <ResponseTools
                    body={outcome.response.body}
                    status={outcome.response.status}
                    statusText={outcome.response.statusText}
                    headers={outcome.response.headers}
                    requestId={draft.savedId}
                    examples={examples}
                  />
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </Wrapper>
  );
}

// -- the side lists ---------------------------------------------------------

function EnvironmentPicker({
  environments,
  activeId,
  id,
}: {
  environments: Environment[];
  activeId?: string;
  id: string;
}) {
  if (!environments.length) return null;
  return (
    <label className="dk-api-label dk-api-client-env" htmlFor={id}>
      <span>Environment</span>
      <select
        id={id}
        value={activeId ?? ''}
        onChange={(e) => chooseEnvironment(e.target.value || undefined)}
      >
        <option value="">None</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A click that landed on a button or a field of a row, which has its own job to do. */
const inControl = (target: EventTarget): boolean =>
  target instanceof HTMLElement && !!target.closest('button, input');

/**
 * The collections and their requests, as a tree assistive technology understands: each row is a `treeitem` that takes
 * focus, the arrows move between rows, left and right close and open a collection, and Enter opens a request. The
 * buttons on a row (rename, reorder, delete) are ordinary buttons, reached with Tab.
 */
function CollectionTree({
  collections,
  requests,
  openId,
  onOpen,
  id,
}: {
  collections: Collection[];
  requests: SavedRequest[];
  openId?: string;
  onOpen: (saved: SavedRequest) => void;
  id: string;
}) {
  const [closed, setClosed] = useState<string[]>([]);
  const [focused, setFocused] = useState<string>();
  const [renaming, setRenaming] = useState<string>();

  /** The rows as they are shown, so the arrows walk them in that order. */
  const rows: { key: string; collection: Collection; saved?: SavedRequest }[] = [];
  for (const collection of collections) {
    rows.push({ key: collection.id, collection });
    if (closed.includes(collection.id)) continue;
    for (const saved of sorted(requests.filter((r) => r.collectionId === collection.id))) {
      rows.push({ key: saved.id, collection, saved });
    }
  }
  const current = focused ?? rows[0]?.key;

  const focus = (key: string) => {
    setFocused(key);
    document.getElementById(`${id}-row-${key}`)?.focus();
  };

  const toggle = (collectionId: string, open?: boolean) =>
    setClosed((list) =>
      (open ?? list.includes(collectionId))
        ? list.filter((c) => c !== collectionId)
        : [...new Set([...list, collectionId])],
    );

  const move = (e: KeyboardEvent<HTMLElement>, key: string) => {
    const at = rows.findIndex((r) => r.key === key);
    const row = rows[at];
    if (!row) return;
    const to =
      e.key === 'ArrowDown'
        ? at + 1
        : e.key === 'ArrowUp'
          ? at - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : undefined;
    if (to !== undefined) {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (next) focus(next.key);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (row.saved) onOpen(row.saved);
      else toggle(row.collection.id);
      return;
    }
    if (!row.saved && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      toggle(row.collection.id, e.key === 'ArrowRight');
    }
  };

  if (!collections.length) {
    return (
      <div className="dk-api-client-empty">
        <p className="dk-api-status">
          Nothing saved yet. Send a request and press <strong>Save</strong>, or import a collection.
        </p>
        <button type="button" className="dk-api-tool" onClick={() => addCollection('My requests')}>
          <Plus className="size-3.5" aria-hidden="true" />
          New collection
        </button>
      </div>
    );
  }

  return (
    <>
      <ul role="tree" aria-label="Collections" className="dk-api-client-tree">
        {collections.map((collection) => {
          const mine = sorted(requests.filter((r) => r.collectionId === collection.id));
          const expanded = !closed.includes(collection.id);
          return (
            <li
              key={collection.id}
              role="treeitem"
              id={`${id}-row-${collection.id}`}
              aria-expanded={expanded}
              aria-labelledby={`${id}-label-${collection.id}`}
              tabIndex={current === collection.id ? 0 : -1}
              onFocus={(e) => {
                if (e.target === e.currentTarget) setFocused(collection.id);
              }}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget) move(e, collection.id);
              }}
              onClick={(e) => {
                if (inControl(e.target)) return;
                focus(collection.id);
                toggle(collection.id);
              }}
            >
              <span className="dk-api-client-row">
                {renaming === collection.id ? (
                  <input
                    autoFocus
                    aria-label={`Name of ${collection.name}`}
                    defaultValue={collection.name}
                    onBlur={(e) => {
                      renameCollection(collection.id, e.target.value);
                      setRenaming(undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(undefined);
                    }}
                  />
                ) : (
                  <span id={`${id}-label-${collection.id}`} className="dk-api-client-name">
                    {collection.name}
                    <span className="dk-api-tab-count">{mine.length}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="dk-api-tool"
                  aria-label={`Rename ${collection.name}`}
                  onClick={() => setRenaming(collection.id)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="dk-api-tool"
                  aria-label={`Delete ${collection.name}`}
                  onClick={() => deleteCollection(collection.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </span>
              <ul role="group" hidden={!expanded}>
                {mine.map((saved, position) => (
                  <li
                    key={saved.id}
                    role="treeitem"
                    id={`${id}-row-${saved.id}`}
                    aria-labelledby={`${id}-label-${saved.id}`}
                    aria-selected={saved.id === openId}
                    tabIndex={current === saved.id ? 0 : -1}
                    className="dk-api-client-row"
                    onFocus={(e) => {
                      if (e.target === e.currentTarget) setFocused(saved.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget) move(e, saved.id);
                    }}
                    onClick={(e) => {
                      if (inControl(e.target)) return;
                      focus(saved.id);
                      onOpen(saved);
                    }}
                  >
                    <span id={`${id}-label-${saved.id}`} className="dk-api-client-name">
                      <span
                        className="dk-api-method"
                        data-method={saved.request.method.toLowerCase()}
                      >
                        {saved.request.method}
                      </span>
                      {saved.name}
                    </span>
                    <button
                      type="button"
                      className="dk-api-tool"
                      aria-label={`Move ${saved.name} up`}
                      disabled={position === 0}
                      onClick={() => moveRequest(saved.id, position - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="dk-api-tool"
                      aria-label={`Move ${saved.name} down`}
                      disabled={position === mine.length - 1}
                      onClick={() => moveRequest(saved.id, position + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="dk-api-tool"
                      aria-label={`Delete ${saved.name}`}
                      onClick={() => deleteRequest(saved.id)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <button type="button" className="dk-api-tool" onClick={() => addCollection('New collection')}>
        <Plus className="size-3.5" aria-hidden="true" />
        New collection
      </button>
    </>
  );
}

function Environments({
  environments,
  activeId,
  rememberSecrets,
  id,
}: {
  environments: Environment[];
  activeId?: string;
  rememberSecrets: boolean;
  id: string;
}) {
  const [show, setShow] = useState<string[]>([]);
  return (
    <div className="dk-api-client-envs">
      <p className="dk-api-facts">
        A variable is written <code>{'{{name}}'}</code> in the address, a header or the body. A secret one is masked
        here, left out of exports and links, and kept only for this tab unless you say otherwise.
      </p>
      {environments.map((environment) => {
        const variables = environment.variables;
        return (
          <fieldset key={environment.id} className="dk-api-client-env-card">
            <legend>
              {/* Committed when the field is left, so a half-typed name is never stored. */}
              <input
                key={environment.name}
                aria-label={`Name of ${environment.name}`}
                defaultValue={environment.name}
                onBlur={(e) => renameEnvironment(environment.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </legend>
            {environment.id !== activeId && (
              <button
                type="button"
                className="dk-api-tool"
                onClick={() => chooseEnvironment(environment.id)}
              >
                Use this one
              </button>
            )}
            <table className="dk-api-client-vars">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Value</th>
                  <th scope="col">Secret</th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {variables.map((variable, index) => {
                  const visible = show.includes(`${environment.id}:${variable.name}`);
                  return (
                    <tr key={index}>
                      <td>
                        <input
                          aria-label={`Variable ${index + 1} name`}
                          value={variable.name}
                          onChange={(e) =>
                            updateVariable(environment.id, index, { name: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        {variable.secret && !visible ? (
                          <button
                            type="button"
                            className="dk-api-tool"
                            onClick={() => setShow((list) => [...list, `${environment.id}:${variable.name}`])}
                          >
                            {maskSecret(variable.value) || 'Not set'} — show
                          </button>
                        ) : (
                          <input
                            aria-label={`Value of ${variable.name || `variable ${index + 1}`}`}
                            type={variable.secret ? 'password' : 'text'}
                            value={variable.value}
                            onChange={(e) =>
                              updateVariable(environment.id, index, { value: e.target.value })
                            }
                          />
                        )}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${variable.name || `Variable ${index + 1}`} is secret`}
                          checked={!!variable.secret}
                          onChange={(e) =>
                            updateVariable(environment.id, index, { secret: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="dk-api-tool"
                          aria-label={`Remove ${variable.name || `variable ${index + 1}`}`}
                          onClick={() => removeVariable(environment.id, index)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="dk-api-client-actions">
              <button
                type="button"
                className="dk-api-tool"
                onClick={() => addVariable(environment.id)}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add a variable
              </button>
              <button
                type="button"
                className="dk-api-tool"
                aria-label={`Delete ${environment.name}`}
                onClick={() => deleteEnvironment(environment.id)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </button>
            </div>
          </fieldset>
        );
      })}
      <div className="dk-api-client-actions">
        <button type="button" className="dk-api-tool" onClick={() => addEnvironment('Sandbox')}>
          <Plus className="size-3.5" aria-hidden="true" />
          New environment
        </button>
      </div>
      <label className="dk-api-client-check" htmlFor={`${id}-remember`}>
        <input
          id={`${id}-remember`}
          type="checkbox"
          checked={rememberSecrets}
          onChange={(e) => setRememberSecrets(e.target.checked)}
        />
        <span>
          Remember secret values in this browser after the tab closes. Off by default: they are kept for the tab only,
          as the playground keeps credentials.
        </span>
      </label>
    </div>
  );
}

function History({
  entries,
  withSecrets,
  onOpen,
}: {
  entries: { id: string; at: number; method: string; url: string; status?: number; ms?: number; error?: string }[];
  withSecrets: boolean;
  onOpen: (entry: { method: string; url: string }) => void;
}) {
  const id = useId();
  return (
    <div className="dk-api-client-history">
      {entries.length === 0 ? (
        <p className="dk-api-status">Nothing sent yet from this browser.</p>
      ) : (
        <ol>
          {[...entries]
            .sort((a, b) => b.at - a.at)
            .map((entry) => (
              <li key={entry.id}>
                <button type="button" className="dk-api-client-name" onClick={() => onOpen(entry)}>
                  <span className="dk-api-method" data-method={entry.method.toLowerCase()}>
                    {entry.method}
                  </span>
                  <code>{entry.url}</code>
                  <span>
                    {entry.error
                      ? entry.error
                      : `${entry.status ?? ''}${entry.ms !== undefined ? ` · ${entry.ms} ms` : ''}`}
                  </span>
                  <time dateTime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>
                </button>
              </li>
            ))}
        </ol>
      )}
      <div className="dk-api-client-actions">
        <button type="button" className="dk-api-tool" onClick={clearHistory} disabled={!entries.length}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Clear
        </button>
      </div>
      <label className="dk-api-client-check" htmlFor={`${id}-secrets`}>
        <input
          id={`${id}-secrets`}
          type="checkbox"
          checked={withSecrets}
          onChange={(e) => setHistoryWithSecrets(e.target.checked)}
        />
        <span>
          Also list requests that used a secret variable. Off by default. The list holds the address as you wrote it,
          with <code>{'{{variables}}'}</code> unresolved, never the value behind one.
        </span>
      </label>
    </div>
  );
}

// -- the request editor -----------------------------------------------------

function Editor({
  draft,
  setDraft,
  id,
}: {
  draft: Draft;
  setDraft: (change: (draft: Draft) => Draft) => void;
  id: string;
}) {
  const [pane, setPane] = useState('headers');
  const headers = draft.headers;
  const setHeaders = (next: [string, string][]) => setDraft((d) => ({ ...d, headers: next }));
  return (
    <div className="dk-api-request">
      <PaneTabs
        label="Request"
        idBase={id}
        value={pane}
        onChange={setPane}
        tabs={[
          { id: 'headers', label: 'Headers', count: headers.length },
          { id: 'body', label: 'Body', flag: !!draft.body.trim() },
        ]}
      />
      <Pane idBase={id} id="headers" active={pane}>
        <table className="dk-api-client-vars">
          <thead>
            <tr>
              <th scope="col">Header</th>
              <th scope="col">Value</th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map(([name, value], index) => (
              <tr key={index}>
                <td>
                  <input
                    aria-label={`Header ${index + 1} name`}
                    value={name}
                    spellCheck={false}
                    onChange={(e) =>
                      setHeaders(headers.map((h, i) => (i === index ? [e.target.value, h[1]] : h)))
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`Value of ${name || `header ${index + 1}`}`}
                    value={value}
                    spellCheck={false}
                    onChange={(e) =>
                      setHeaders(headers.map((h, i) => (i === index ? [h[0], e.target.value] : h)))
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="dk-api-tool"
                    aria-label={`Remove ${name || `header ${index + 1}`}`}
                    onClick={() => setHeaders(headers.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="dk-api-tool" onClick={() => setHeaders([...headers, ['', '']])}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add a header
        </button>
      </Pane>
      <Pane idBase={id} id="body" active={pane}>
        <div className="dk-api-bodybar">
          <label className="dk-api-label" htmlFor={`${id}-type`}>
            <span>Content type</span>
            <input
              id={`${id}-type`}
              value={draft.contentType}
              spellCheck={false}
              onChange={(e) => setDraft((d) => ({ ...d, contentType: e.target.value }))}
            />
          </label>
        </div>
        <CodeEditor
          value={draft.body}
          language={languageForMime(draft.contentType, draft.body)}
          label="Request body"
          placeholder="Request body"
          lineNumbers
          onChange={(text) => setDraft((d) => ({ ...d, body: text }))}
        />
      </Pane>
    </div>
  );
}

/** Copy the request as a command or as code, from the same generators the endpoint pages use. */
function CopyAs({ request }: { request: StoredRequest }) {
  const [language, setLanguage] = useState('curl');
  const id = useId();
  const code = useMemo(() => {
    if (language === 'curl') return toCurl(request);
    const found = defaultSampleLanguages.find((l) => l.id === language);
    return found ? found.generate({ ...request, method: request.method }) : toCurl(request);
  }, [language, request]);
  return (
    <span className="dk-api-client-copyas">
      <label className="sr-only" htmlFor={`${id}-lang`}>
        Copy as
      </label>
      <select id={`${id}-lang`} value={language} onChange={(e) => setLanguage(e.target.value)}>
        <option value="curl">cURL</option>
        {defaultSampleLanguages
          .filter((l) => l.id !== 'curl')
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
      </select>
      <CopyButton text={code} />
    </span>
  );
}

/** Keep this answer, or compare it with one that was kept before. */
function ResponseTools({
  body,
  status,
  statusText,
  headers,
  requestId,
  examples,
}: {
  body: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  requestId?: string;
  examples: ResponseExample[];
}) {
  const [against, setAgainst] = useState<string>();
  const id = useId();
  const kept = [...examples].sort((a, b) => b.at - a.at);
  const other = kept.find((e) => e.id === against);
  const diff = useMemo(
    () => (other ? diffLines(other.body, body) : undefined),
    [other, body],
  );
  return (
    <div className="dk-api-client-restools">
      <div className="dk-api-client-actions">
        <button
          type="button"
          className="dk-api-tool"
          onClick={() =>
            keepExample({
              ...(requestId ? { requestId } : {}),
              name: `${status} at ${when(Date.now())}`,
              status,
              statusText,
              headers,
              body,
            })
          }
        >
          <Download className="size-3.5" aria-hidden="true" />
          Keep this response
        </button>
        {kept.length > 0 && (
          <label className="dk-api-label" htmlFor={`${id}-against`}>
            <span>Compare with</span>
            <select
              id={`${id}-against`}
              value={against ?? ''}
              onChange={(e) => setAgainst(e.target.value || undefined)}
            >
              <option value="">Nothing</option>
              {kept.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {kept.length > 0 && (
        <ul className="dk-api-client-kept">
          {kept.map((example) => (
            <li key={example.id}>
              <span>
                {example.name} · {formatSize(example.body.length)}
                {example.truncated ? ' (cut)' : ''}
              </span>
              <button
                type="button"
                className="dk-api-tool"
                aria-label={`Delete ${example.name}`}
                onClick={() => deleteExample(example.id)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {diff && (
        <figure className="dk-api-client-diff" aria-label="What changed">
          <figcaption>
            {diff.tooLong
              ? 'One of the two is too long to compare line by line.'
              : `${diff.added} line${diff.added === 1 ? '' : 's'} added, ${diff.removed} removed`}
          </figcaption>
          {!diff.tooLong && (
            <pre>
              <code>
                {diff.lines.map((line, i) => (
                  <span key={i} data-mark={line.mark}>
                    {line.mark === 'added' ? '+' : line.mark === 'removed' ? '-' : ' '}
                    {line.text}
                    {'\n'}
                  </span>
                ))}
              </code>
            </pre>
          )}
        </figure>
      )}
    </div>
  );
}

// -- import and export ------------------------------------------------------

/**
 * The text of a chosen file. `FileReader` rather than `Blob.text()`: every browser has had it for years, and the
 * environments a docs site is tested in do too.
 */
const fileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.readAsText(file);
  });

function Transfer({
  collections,
  requests,
  environments,
  id,
}: {
  collections: Collection[];
  requests: SavedRequest[];
  environments: Environment[];
  id: string;
}) {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [needed, setNeeded] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  const read = (content: string) => {
    const imported = importText(content);
    setWarnings(imported.warnings);
    if (!imported.requests.length) return;
    addImported(imported);
    setNeeded(neededVariables(imported.requests, imported.environments[0]?.variables ?? []));
    setText('');
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void fileText(file).then(read);
    e.target.value = '';
  };

  const download = (name: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dk-api-client-transfer">
      <button type="button" className="dk-api-tool" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Upload className="size-3.5" aria-hidden="true" />
        Import or export
      </button>
      {open && (
        <div className="dk-api-client-transfer-body">
          <label className="dk-api-label" htmlFor={`${id}-file`}>
            <span>From a file (a dockudos export, Postman v2.1, Bruno, or a .bru file)</span>
            <input id={`${id}-file`} type="file" accept=".json,.bru,.txt,.curl" onChange={onFile} />
          </label>
          <label className="dk-api-label" htmlFor={`${id}-paste`}>
            <span>Or paste a curl command or a collection</span>
            <textarea
              id={`${id}-paste`}
              rows={3}
              value={text}
              spellCheck={false}
              placeholder="curl --request GET --url https://api.example.com/pets"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="dk-api-client-actions">
            <button type="button" className="dk-api-tool" disabled={!text.trim()} onClick={() => read(text)}>
              Import
            </button>
          </div>
          <p className="dk-api-facts">
            An import reads the file and nothing else: scripts and tests in it are listed below and never run, and a
            credential saved in it is not imported.
          </p>
          {warnings.length > 0 && (
            <ul className="dk-api-client-warnings" role="status">
              {warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
          {needed.length > 0 && (
            <p className="dk-api-status" role="status">
              These requests use {needed.map((n) => `{{${n}}}`).join(', ')}. Add{' '}
              {needed.length > 1 ? 'those variables' : 'that variable'} to an environment before sending them.
            </p>
          )}
          {collections.map((collection) => {
            const mine = requests.filter((r) => r.collectionId === collection.id);
            return (
              <div key={collection.id} className="dk-api-client-actions">
                <span>{collection.name}</span>
                <button
                  type="button"
                  className="dk-api-tool"
                  onClick={() =>
                    download(
                      'dockudos-api-client.json',
                      toDockudosFile({ collections: [collection], requests: mine, environments }),
                    )
                  }
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  dockudos
                </button>
                <button
                  type="button"
                  className="dk-api-tool"
                  onClick={() => download('postman-collection.json', toPostman(collection, mine))}
                >
                  Postman
                </button>
                <button
                  type="button"
                  className="dk-api-tool"
                  onClick={() => download('bruno-collection.json', toBruno(collection, mine))}
                >
                  Bruno
                </button>
              </div>
            );
          })}
          <p className="dk-api-facts">
            An export carries no secret value: a secret variable keeps its name so you know what to fill in, and a
            credential is never in a saved request to begin with.
          </p>
        </div>
      )}
    </div>
  );
}
