// Shared live connection: SSE with auto-reconnect + polling backup for phones that sleep.
window.Live = (function () {
  let es, handlers = [], statusFns = [], last = null;
  function emit(s) { if (last && s.version < last.version && s.updatedAt < last.updatedAt) return; last = s; handlers.forEach((f) => f(s)); }
  function status(st) { statusFns.forEach((f) => f(st)); }
  function connect() {
    if (es) es.close();
    status("re");
    es = new EventSource("/api/stream");
    es.addEventListener("open", () => status("on"));
    es.addEventListener("state", (e) => { status("on"); emit(JSON.parse(e.data)); });
    es.onerror = () => status(navigator.onLine ? "re" : "off");
  }
  async function poll() { try { const r = await fetch("/api/state", { cache: "no-store" }); if (r.ok) emit(await r.json()); } catch {} }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { poll(); if (!es || es.readyState === 2) connect(); } });
  window.addEventListener("online", connect);
  setInterval(() => { if (!es || es.readyState !== 1) poll(); }, 10000);
  return { start() { connect(); poll(); }, onState(f) { handlers.push(f); }, onStatus(f) { statusFns.push(f); }, get state() { return last; } };
})();
function setLiveBadge(el, st) { el.className = "live " + st; el.querySelector("span").textContent = st === "on" ? "Live" : st === "re" ? "Reconnecting…" : "Offline"; }
