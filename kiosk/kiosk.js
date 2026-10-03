// Include on every kiosk page:
//   <script src="/kiosk/kiosk.js" data-app="photoframe"></script>
//
// Listens to the kiosk server and navigates this tab to whichever app is
// current. Uses Server-Sent Events, with plain polling as a fallback.
// Same-origin navigation keeps a Home Screen web app in full-screen mode.
(function () {
  var script = document.currentScript;
  var me = (script && script.getAttribute('data-app')) || '';
  var navigating = false;

  function apply(state) {
    if (!state || !state.url || navigating) return;
    if (state.app === me) return;
    navigating = true;
    window.location.replace(state.url);
  }

  function poll() {
    fetch('/current', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function () {});
  }

  if (window.EventSource) {
    var es = new EventSource('/events');
    es.onmessage = function (e) {
      try { apply(JSON.parse(e.data)); } catch (err) {}
    };
    // EventSource reconnects on its own; poll occasionally as a safety net.
    setInterval(poll, 15000);
  } else {
    setInterval(poll, 2000);
  }

  // When the iPad wakes or the tab is re-shown, re-sync immediately.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) poll();
  });
  window.addEventListener('pageshow', poll);
})();
