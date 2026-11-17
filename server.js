// Ballroom live-heat server: zero dependencies, Server-Sent Events for live push.
const http = require("http"), fs = require("fs"), path = require("path");
const store = require("./comp-store");
let DATA = store.load();
const PORT = Number(process.env.PORT || 8787);
const PIN = String(process.env.STAFF_PIN || "2468");
const STATE_FILE = path.join(__dirname, "state.json");
const PUB = path.join(__dirname, "public");

let state = { currentHeat: 1, awardsAfter: null, announcement: "", announcedAt: null, updatedAt: Date.now(), version: 1, dataVersion: 1 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
if (state.dataVersion == null) state.dataVersion = 1;
if (!Array.isArray(state.announcements)) state.announcements = state.announcement ? [{ id: String(state.announcedAt || Date.now()), text: state.announcement, at: state.announcedAt || Date.now() }] : [];
const save = () => fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});

// Public data: the heat program only (no students, no entries, no codes). Full data needs the staff PIN.
function publicData() {
  return { comp: DATA.comp, heatMinutes: DATA.heatMinutes, schedule: DATA.schedule,
    events: DATA.events, awards: DATA.awards,
    heats: DATA.heats.map(({ n, style, dance, level, age, time, session }) => ({ n, style, dance, level, age, time, session })) };
}
let PUBLIC_DATA = publicData();
let BY_CODE = new Map([...DATA.students.map((s) => [s.code, s]), ...(DATA.pros || []).filter((x) => x.code).map((x) => [x.code, x])]);
function rebuild() {
  PUBLIC_DATA = publicData();
  BY_CODE = new Map([...DATA.students.map((s) => [s.code, s]), ...(DATA.pros || []).filter((x) => x.code).map((x) => [x.code, x])]);
  const max = DATA.heats.length;
  if (max >= 1 && state.currentHeat > max) state.currentHeat = max;
  if (state.currentHeat < 1) state.currentHeat = 1;
  if (state.awardsAfter != null && !awardAfter(state.awardsAfter)) state.awardsAfter = null;
}
function touchData() {
  rebuild();
  state.dataVersion = (state.dataVersion || 0) + 1;
  state.version++;
  state.updatedAt = Date.now();
  store.save(DATA);
  save(); broadcast();
}
// Live pace: median of recent single-step heat changes (ignores breaks > 8 min and taps < 15 s).
const DEFAULT_PACE = 105; // seconds per heat until we have real data
function pace() { const a = (state.intervals || []).slice(-8).sort((x, y) => x - y); return a.length >= 3 ? a[Math.floor(a.length / 2)] : DEFAULT_PACE; }
// Schedule status: compare when the current heat actually started (and the clock) with the printed schedule.
// DEMO=1 (example data) anchors the printed schedule to the moment staff set Heat 1, so the demo reads sensibly at any time of day.
const DEMO = process.env.DEMO === "1";
function clockMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
const nowMin = () => clockMin() + (DEMO ? (state.anchorShift || 0) : 0);
const awardAfter = (n) => DATA.awards.find((a) => a.afterHeat === n) || null;
const liveAwards = () => {
  const a = state.awardsAfter != null ? awardAfter(state.awardsAfter) : null;
  return a ? { afterHeat: a.afterHeat, time: a.time, minute: a.minute } : null;
};
function scheduleOffset() {
  if (state.startedAtMin == null) return 0;
  if (state.awardsAfter != null) {
    const a = awardAfter(state.awardsAfter), nh = DATA.heats[state.awardsAfter];
    if (!a) return 0;
    let off = state.startedAtMin - a.minute;
    if (nh) off = Math.max(off, nowMin() - nh.minute);
    return Math.round(off);
  }
  const h = DATA.heats[state.currentHeat - 1], nh = DATA.heats[state.currentHeat];
  if (!h) return 0;
  let off = state.startedAtMin - h.minute;
  if (nh) off = Math.max(off, nowMin() - nh.minute); // floor is overdue for the next heat: falling behind
  return Math.round(off);
}
const pub = () => { const h = DATA.heats[state.currentHeat - 1] || {};
  return { currentHeat: state.currentHeat, total: DATA.heats.length, now: { dance: h.dance, style: h.style, level: h.level },
    awards: liveAwards(), scheduleOffsetMin: scheduleOffset(), clockMin: Math.round(nowMin()), paceSec: Math.round(pace()), paceLive: (state.intervals || []).length >= 3, announcement: state.announcement, announcedAt: state.announcedAt, announcements: state.announcements || [], updatedAt: state.updatedAt, version: state.version, dataVersion: state.dataVersion || 1, viewers: clients.size }; };
// Simple brute-force guard for code lookups: max 20 bad codes per IP per 10 minutes.
const bad = new Map();
const ipOf = (req) => { const a = req.socket.remoteAddress || "?"; const f = req.headers["x-forwarded-for"]; return (f && /127\.0\.0\.1|::1/.test(a)) ? String(f).split(",")[0].trim() : a; };
const isStaff = (req, url) => String(req.headers["x-staff-pin"] || url.searchParams.get("pin") || "") === PIN;

const clients = new Set();
setInterval(() => broadcast(), 30000); // keeps "minutes behind" fresh while a heat runs long
function broadcast() {
  const msg = `event: state\ndata: ${JSON.stringify(pub())}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(`: ping ${Date.now()}\n\n`); }, 15000);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".csv": "text/csv; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c).length > 5e6 && req.destroy()); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); }); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/api/data") return json(res, 200, isStaff(req, url) ? DATA : PUBLIC_DATA); // full list + codes only with staff PIN
  if (p === "/api/state" && req.method === "GET") return json(res, 200, pub());
  if (p === "/api/me") {
    const ip = ipOf(req), b = bad.get(ip);
    if (b && b.n >= 20 && Date.now() - b.t < 600000) return json(res, 429, { error: "Too many tries. Wait a few minutes." });
    const s = BY_CODE.get(String(url.searchParams.get("code") || "").trim().toUpperCase());
    if (!s) { const e = b && Date.now() - b.t < 600000 ? b : { n: 0, t: Date.now() }; e.n++; bad.set(ip, e); return json(res, 404, { error: "Code not found" }); }
    const low = String(s.name || "").trim().toLowerCase();
    const sIds = new Set(DATA.students.filter((x) => x.name.trim().toLowerCase() === low).map((x) => x.id));
    const pIds = new Set((DATA.pros || []).filter((x) => x.name.trim().toLowerCase() === low).map((x) => x.id));
    const heats = DATA.heats.filter((h) => h.entries.some((e) => sIds.has(e.studentId) || pIds.has(e.proId))).map((h) => {
      const e = h.entries.find((x) => sIds.has(x.studentId) || pIds.has(x.proId));
      const st = DATA.students.find((x) => x.id === e.studentId);
      return { n: h.n, dance: h.dance, style: h.style, level: e.level || (st && st.level) || "", time: h.time };
    });
    return json(res, 200, { name: s.name, heats, total: DATA.heats.length });
  }
  if (p === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 2000\n\n`);
    clients.add(res);
    res.write(`event: state\ndata: ${JSON.stringify(pub())}\n\n`);
    broadcast(); // viewer count changed
    req.on("close", () => { clients.delete(res); broadcast(); });
    return;
  }
  if (p === "/api/control" && req.method === "POST") {
    const b = await body(req);
    if (String(b.pin) !== PIN) return json(res, 401, { error: "Wrong PIN" });
    const max = DATA.heats.length;
    if (b.action === "check") return json(res, 200, { ok: true });
    const before = state.currentHeat, beforeAt = state.updatedAt, beforeAwards = state.awardsAfter;
    if (b.action === "next") {
      if (state.awardsAfter != null) { const n = state.awardsAfter; state.awardsAfter = null; if (n < max) state.currentHeat = n + 1; }
      else if (awardAfter(state.currentHeat)) state.awardsAfter = state.currentHeat;
      else state.currentHeat = Math.min(max, state.currentHeat + 1);
    } else if (b.action === "prev") {
      if (state.awardsAfter != null) state.awardsAfter = null;
      else if (state.currentHeat > 1 && awardAfter(state.currentHeat - 1)) { state.currentHeat = state.currentHeat - 1; state.awardsAfter = state.currentHeat; }
      else state.currentHeat = Math.max(1, state.currentHeat - 1);
    } else if (b.heat != null) { const h = parseInt(b.heat, 10); if (!(h >= 1 && h <= max)) return json(res, 400, { error: "Heat out of range" }); state.currentHeat = h; state.awardsAfter = null; }
    if (typeof b.announcement === "string") {
      const t = b.announcement.slice(0, 200).trim();
      state.announcements = state.announcements || [];
      if (t) { const at = Date.now(); state.announcements = [...state.announcements, { id: at + "-" + Math.random().toString(36).slice(2, 6), text: t, at }].slice(-20); }
      else state.announcements = [];
    }
    if (typeof b.removeAnnouncement === "string") state.announcements = (state.announcements || []).filter((a) => a.id !== b.removeAnnouncement);
    if (typeof b.announcement === "string" || typeof b.removeAnnouncement === "string") {
      const last = (state.announcements || []).slice(-1)[0];
      state.announcement = last ? last.text : ""; state.announcedAt = last ? last.at : null;
    }
    if (state.currentHeat === before + 1 && !beforeAwards && beforeAt) { const sec = (Date.now() - beforeAt) / 1000; if (sec >= 15 && sec <= 480) { state.intervals = [...(state.intervals || []), sec].slice(-20); } }
    if (state.currentHeat !== before || state.awardsAfter !== beforeAwards) {
      state.updatedAt = Date.now();
      if (DEMO && state.currentHeat === 1 && state.awardsAfter == null) state.anchorShift = DATA.heats[0].minute - clockMin();
      state.startedAtMin = nowMin();
    }
    state.version++;
    save(); broadcast();
    return json(res, 200, { ok: true, state: pub() });
  }
  if (p === "/api/admin" && req.method === "POST") {
    const b = await body(req);
    if (String(b.pin) !== PIN) return json(res, 401, { error: "Wrong PIN" });
    try {
      const result = store.apply(DATA, b);
      if (b.action === "preview-import" || b.action === "export") return json(res, 200, result);
      touchData();
      return json(res, 200, result);
    } catch (e) { return json(res, 400, { error: e.message || "Request failed" }); }
  }
  if (p === "/api/export" && req.method === "GET") {
    if (!isStaff(req, url)) return json(res, 401, { error: "Wrong PIN" });
    const csv = store.exportCsv(DATA);
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=comp.csv", "Cache-Control": "no-store" });
    return res.end(csv);
  }
  // static
  const ROUTES = { "/": "/index.html", "/control": "/control.html", "/simple": "/simple.html", "/simple-control": "/simple-control.html", "/simple-setup": "/simple-setup.html", "/competitor": "/simple.html", "/admin": "/simple-control.html", "/setup": "/simple-setup.html" };
  let f = ROUTES[p] || p;
  f = path.normalize(path.join(PUB, f));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Listening on :${PORT} (PIN ${PIN})`));
