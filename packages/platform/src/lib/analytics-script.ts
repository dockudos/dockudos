/**
 * The browser side of analytics, served at `/analytics.js` and added to a docs site with
 *
 *     <script defer src="https://platform.example.com/analytics.js" data-site="<site id>"></script>
 *
 * It sends page views (including client-side navigation) and forwards the `dockudos:track` events the UI announces
 * (searches, feedback, assistant answers). No cookies, no storage, no identifiers: the server derives a one-day
 * visitor hash itself. It does nothing when the browser says Do Not Track or Global Privacy Control.
 */
export const ANALYTICS_SCRIPT = `(function () {
  var s = document.currentScript;
  var site = s && s.getAttribute('data-site');
  if (!site || !/^[0-9a-f-]{36}$/i.test(site)) return;
  var nav = navigator;
  if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl === true) return;
  var endpoint = new URL(s.src).origin + '/api/v1/ingest/' + site;

  function send(event) {
    var body = JSON.stringify(event);
    try {
      if (nav.sendBeacon && nav.sendBeacon(endpoint, body)) return;
    } catch (e) {}
    try {
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }

  var last = '';
  var first = true;
  function pageview() {
    var path = location.pathname;
    if (path === last) return;
    last = path;
    var event = { kind: 'pageview', path: path };
    if (first && document.referrer) event.referrer = document.referrer;
    first = false;
    send(event);
  }

  function wrap(name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(pageview, 0);
      return result;
    };
  }
  wrap('pushState');
  wrap('replaceState');
  addEventListener('popstate', function () { setTimeout(pageview, 0); });

  addEventListener('dockudos:track', function (e) {
    var d = e.detail || {};
    if (d.kind === 'search') send({ kind: 'search', query: String(d.query || ''), results: Number(d.results) || 0 });
    else if (d.kind === 'feedback') send({ kind: 'feedback', path: String(d.path || location.pathname), value: d.value });
    else if (d.kind === 'assistant') send({ kind: 'assistant', query: String(d.query || ''), value: d.value, cited: d.cited || [] });
  });

  window.dockudosAnalytics = { track: send };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageview);
  else pageview();
})();
`;
