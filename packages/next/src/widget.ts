/**
 * The embeddable assistant, as a script any page can load:
 *
 *     <script src="https://docs.acme.com/dockudos-widget.js" async data-hint="Billing settings"></script>
 *
 * It adds a floating "Ask AI" button; opening it shows the site's own assistant (the `/embed` page) in a frame,
 * so it looks like the docs and talks to the docs server, with no key in the page. Written with no
 * dependencies and no template literals, so it can live in a string.
 *
 * Settings, as attributes on the script tag: `data-label`, `data-position` (`right` or `left`), `data-color`
 * (a hex color for the button), `data-path` (a docs page the reader is about) and `data-hint` (what they are
 * doing). `window.Dockudos` has `open()`, `close()`, `toggle()` and `setContext({ path, hint })`.
 */
export const WIDGET_BODY = String.raw`
  if (!script || window.Dockudos) return;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { return; }
  var data = script.dataset || {};
  var label = data.label || 'Ask AI';
  var side = data.position === 'left' ? 'left' : 'right';
  var color = /^#[0-9a-f]{3,8}$/i.test(data.color || '') ? data.color : '#18181b';

  function clean(c) {
    var out = {};
    if (c && typeof c.path === 'string' && c.path.charAt(0) === '/' && c.path.length <= 200) out.path = c.path;
    if (c && typeof c.hint === 'string' && c.hint.trim()) out.hint = c.hint.trim().slice(0, 200);
    return out;
  }
  var context = clean({ path: data.path, hint: data.hint });
  var frame = null;
  var open = false;

  function address() {
    var u = new URL('/embed', origin);
    if (context.path) u.searchParams.set('path', context.path);
    if (context.hint) u.searchParams.set('hint', context.hint);
    return u.toString();
  }
  function tell() {
    if (frame && frame.contentWindow)
      frame.contentWindow.postMessage({ type: 'dockudos:context', context: context }, origin);
  }

  var host = document.createElement('div');
  host.setAttribute('data-dockudos-widget', '');
  var root = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent =
    ':host{all:initial}' +
    'button,.panel{position:fixed;z-index:2147483000;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}' +
    '.launch{bottom:20px;' + side + ':20px;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 18px;border:0;border-radius:999px;background:' + color + ';color:#fff;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
    '.launch:focus-visible,.close:focus-visible{outline:3px solid #2563eb;outline-offset:2px}' +
    '.panel{bottom:76px;' + side + ':20px;display:flex;flex-direction:column;width:min(400px,calc(100vw - 40px));height:min(640px,calc(100vh - 100px));overflow:hidden;border:1px solid rgba(0,0,0,.15);border-radius:12px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.3)}' +
    '.panel[hidden]{display:none}' +
    '.bar{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 6px 14px;border-bottom:1px solid rgba(0,0,0,.1);background:#fafafa;color:#18181b;font-weight:600}' +
    '.close{width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:#18181b;font-size:20px;line-height:1;cursor:pointer}' +
    '.close:hover{background:rgba(0,0,0,.08)}' +
    'iframe{flex:1;width:100%;border:0;background:#fff}' +
    '@media (max-width:480px){.panel{inset:0;width:100%;height:100%;border:0;border-radius:0}}' +
    '@media (prefers-reduced-motion:no-preference){.launch{transition:transform .15s}.launch:hover{transform:translateY(-1px)}}';
  var launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'launch';
  launch.textContent = label;
  launch.setAttribute('aria-haspopup', 'dialog');
  launch.setAttribute('aria-expanded', 'false');
  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ask the docs');
  panel.hidden = true;
  var bar = document.createElement('div');
  bar.className = 'bar';
  var title = document.createElement('span');
  title.textContent = 'Ask the docs';
  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  bar.appendChild(title);
  bar.appendChild(close);
  panel.appendChild(bar);
  root.appendChild(style);
  root.appendChild(launch);
  root.appendChild(panel);

  function show(next) {
    open = next;
    panel.hidden = !next;
    launch.setAttribute('aria-expanded', String(next));
    if (next) {
      if (!frame) {
        frame = document.createElement('iframe');
        frame.title = 'Ask the docs';
        frame.src = address();
        frame.addEventListener('load', tell);
        panel.appendChild(frame);
      }
      frame.focus();
    } else {
      launch.focus();
    }
  }
  // The frame says when it is ready to hear where the reader is; a message sent before that goes nowhere.
  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow || !e.data) return;
    if (e.data.type === 'dockudos:ready') tell();
    // Escape pressed inside the frame never reaches this page, so the frame asks for the close.
    if (e.data.type === 'dockudos:close' && open) show(false);
  });
  launch.addEventListener('click', function () { show(!open); });
  close.addEventListener('click', function () { show(false); });
  document.addEventListener('keydown', function (e) {
    if (open && e.key === 'Escape') show(false);
  });

  window.Dockudos = {
    open: function () { show(true); },
    close: function () { show(false); },
    toggle: function () { show(!open); },
    setContext: function (c) { context = clean(c); tell(); },
  };
  function mount() { document.body.appendChild(host); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
`;

export const WIDGET_SCRIPT = `(function (document, window, script) {${WIDGET_BODY}})(document, window, document.currentScript);\n`;

/**
 * `GET` handler for the script above:
 *
 *     // src/app/dockudos-widget.js/route.ts
 *     export const dynamic = 'force-static';
 *     export const GET = createWidgetHandler();
 */
export function createWidgetHandler() {
  return function GET(): Response {
    return new Response(WIDGET_SCRIPT, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  };
}
