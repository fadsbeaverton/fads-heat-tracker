// Ballroom live-heat server: zero dependencies, Server-Sent Events for live push.
const http = require("http"), fs = require("fs"), path = require("path");
const store = require("./comp-store");
const judging = require("./judging");
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
// Judge marks: { "<heat>:<final|semi>": { n, round, judges: { <judgeId>: { submitted, at, cats: { <category>: { places: [nums] } | { recalls: [nums] } } } } } }
// Kept in marks.json next to state.json. Like state.json this is wiped when a free Render instance sleeps or redeploys,
// so staff can download a backup and judges' phones re-send their own submitted marks when they reconnect.
const MARKS_FILE = path.join(__dirname, "marks.json");
let MARKS = {};
try { MARKS = JSON.parse(fs.readFileSync(MARKS_FILE, "utf8")) || {}; } catch {}
const overall = () => (DATA.multis || []).map((m) => judging.multiResult(DATA, m, (h) => MARKS[judging.roundKey(h)]));
const multiHeats = () => DATA.heats.filter((h) => judging.dancesOf(h)).map((h) => judging.heatResult(DATA, h, MARKS[judging.roundKey(h)]));
const saveMarks = () => { state.marksVersion = (state.marksVersion || 0) + 1; fs.writeFile(MARKS_FILE, JSON.stringify(MARKS), () => {}); };
const judgeByCode = (code) => (DATA.judges || []).find((j) => j.code === String(code || "").trim().toUpperCase()) || null;
const heatN = (n) => DATA.heats.find((h) => h.n === parseInt(n, 10)) || null;
// Validate a judge's marks against the heat's categories; returns cleaned cats or throws.
function cleanMarks(h, cats, final) {
  const round = judging.roundOf(h), out = {};
  for (const c of judging.categories(DATA, h)) {
    if (c.couples.length < 2) continue;
    const nums = c.couples.map((x) => x.num), m = (cats || {})[c.key] || {};
    const dances = judging.dancesOf(h);
    if (dances) { // multi-dance heat: one set of marks per dance
      const src = m.dances || {}, per = {};
      for (const dn of dances) {
        const v = src[dn] || {};
        if (round.type === "semi") per[dn] = { recalls: [...new Set((v.recalls || []).map(String))].filter((x) => nums.includes(x)) };
        else {
          const pl = [...new Set((v.places || []).map(String))].filter((x) => nums.includes(x));
          if (final && pl.length !== nums.length) throw new Error(`Place every couple in ${c.key}, ${dn} (${pl.length} of ${nums.length})`);
          per[dn] = { places: pl };
        }
      }
      out[c.key] = { dances: per };
      continue;
    }
    if (round.type === "semi") {
      const rec = [...new Set((m.recalls || []).map(String))].filter((x) => nums.includes(x));
      out[c.key] = { recalls: rec };
    } else {
      const pl = [...new Set((m.places || []).map(String))].filter((x) => nums.includes(x));
      if (final && pl.length !== nums.length) throw new Error(`Place every couple in ${c.key} (${pl.length} of ${nums.length})`);
      out[c.key] = { places: pl };
    }
  }
  return out;
}
function judgeHeat(j, h) {
  const rec = MARKS[judging.roundKey(h)];
  const mine = rec && rec.judges && rec.judges[j.id];
  return { n: h.n, dance: h.dance, label: judging.danceLabel(h), dances: judging.dancesOf(h), style: h.style, time: h.time, day: h.day, round: judging.roundOf(h), key: judging.roundKey(h), total: DATA.heats.length,
    cats: judging.categories(DATA, h), mine: mine ? { submitted: !!mine.submitted, at: mine.at, cats: mine.cats } : null };
}

// Public data: the heat program only (no students, no entries, no codes). Full data needs the staff PIN.
function publicData() {
  return { comp: DATA.comp, heatMinutes: DATA.heatMinutes, schedule: DATA.schedule,
    events: DATA.events, awards: DATA.awards,
    heats: DATA.heats.map(({ n, style, dance, level, age, time, session, day }) => ({ n, style, dance, level, age, time, session, day })) };
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
    const a = awardAfter(state.awardsAfter), nh = DATA.heats[state.awardsAfter], ah = DATA.heats[state.awardsAfter - 1];
    if (!a) return 0;
    let off = state.startedAtMin - a.minute;
    if (nh && (!ah || nh.day === ah.day)) off = Math.max(off, nowMin() - nh.minute);
    return Math.round(off);
  }
  const h = DATA.heats[state.currentHeat - 1], nh = DATA.heats[state.currentHeat];
  if (!h) return 0;
  let off = state.startedAtMin - h.minute;
  if (nh && nh.day === h.day) off = Math.max(off, nowMin() - nh.minute); // floor is overdue (multi-day comps: the next day's first heat isn't overdue) for the next heat: falling behind
  return Math.round(off);
}
const pub = () => { const h = DATA.heats[state.currentHeat - 1] || {};
  return { currentHeat: state.currentHeat, total: DATA.heats.length, now: { dance: h.dance, style: h.style, level: h.level, day: h.day },
    marksVersion: state.marksVersion || 0, awards: liveAwards(), scheduleOffsetMin: scheduleOffset(), clockMin: Math.round(nowMin()), paceSec: Math.round(pace()), paceLive: (state.intervals || []).length >= 3, announcement: state.announcement, announcedAt: state.announcedAt, announcements: state.announcements || [], updatedAt: state.updatedAt, version: state.version, dataVersion: state.dataVersion || 1, viewers: clients.size }; };
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
      return { n: h.n, dance: h.dance, style: h.style, level: e.level || (st && st.level) || "", time: h.time, day: h.day };
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
      const ch = DATA.heats[state.currentHeat - 1], ph = DATA.heats[state.currentHeat - 2];
      if (DEMO && state.awardsAfter == null && (state.currentHeat === 1 || (ch && ch.day && ph && ph.day !== ch.day))) state.anchorShift = ch.minute - clockMin(); // demo: anchor at Heat 1 or the first heat of each day
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
  // ---- Judges ----
  if (p === "/api/judge/heat" && req.method === "GET") {
    const ip = ipOf(req), b = bad.get(ip);
    if (b && b.n >= 20 && Date.now() - b.t < 600000) return json(res, 429, { error: "Too many tries. Wait a few minutes." });
    const j = judgeByCode(url.searchParams.get("code"));
    if (!j) { const e = b && Date.now() - b.t < 600000 ? b : { n: 0, t: Date.now() }; e.n++; bad.set(ip, e); return json(res, 404, { error: "Code not found" }); }
    const h = heatN(url.searchParams.get("n") || state.currentHeat) || heatN(state.currentHeat) || DATA.heats[0];
    if (!h) return json(res, 404, { error: "No heats" });
    return json(res, 200, { judge: { id: j.id, name: j.name }, comp: DATA.comp && DATA.comp.name, heat: judgeHeat(j, h) });
  }
  if (p === "/api/judge/submit" && req.method === "POST") {
    const b = await body(req);
    const j = judgeByCode(b.code); if (!j) return json(res, 404, { error: "Code not found" });
    const h = heatN(b.n); if (!h) return json(res, 404, { error: "Heat not found" });
    if (b.key && b.key !== judging.roundKey(h)) return json(res, 409, { error: "This heat's round changed. Refresh and mark again." });
    const key = judging.roundKey(h);
    const rec = MARKS[key] = MARKS[key] || { n: h.n, round: judging.roundOf(h), judges: {} };
    const cur = rec.judges[j.id];
    if (cur && cur.submitted) return json(res, 409, { error: "Already submitted. Ask staff to unlock." });
    let cats; try { cats = cleanMarks(h, b.cats, true); } catch (e) { return json(res, 400, { error: e.message }); }
    rec.judges[j.id] = { submitted: true, at: Date.now(), cats };
    saveMarks(); state.version++; broadcast();
    return json(res, 200, { ok: true, heat: judgeHeat(j, h) });
  }
  // Judges' phones keep their submitted marks and re-send them after a reconnect; fills only records the server lost.
  if (p === "/api/judge/sync" && req.method === "POST") {
    const b = await body(req);
    const j = judgeByCode(b.code); if (!j) return json(res, 404, { error: "Code not found" });
    let restored = 0;
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 5000)) {
      const h = heatN(it.n); if (!h || it.key !== judging.roundKey(h)) continue;
      const rec = MARKS[it.key] = MARKS[it.key] || { n: h.n, round: judging.roundOf(h), judges: {} };
      if (rec.judges[j.id]) continue;
      try { rec.judges[j.id] = { submitted: true, at: Number(it.at) || Date.now(), cats: cleanMarks(h, it.cats, true), restored: true }; restored++; } catch {}
    }
    if (restored) { saveMarks(); state.version++; broadcast(); }
    return json(res, 200, { ok: true, restored });
  }
  // ---- Results (staff) ----
  if (p === "/api/results" && req.method === "GET") {
    if (!isStaff(req, url)) return json(res, 401, { error: "Wrong PIN" });
    const h = heatN(url.searchParams.get("n") || state.currentHeat); if (!h) return json(res, 404, { error: "Heat not found" });
    return json(res, 200, judging.heatResult(DATA, h, MARKS[judging.roundKey(h)]));
  }
  if (p === "/api/results/summary" && req.method === "GET") {
    if (!isStaff(req, url)) return json(res, 401, { error: "Wrong PIN" });
    const J = (DATA.judges || []).length, rows = [];
    for (const [key, rec] of Object.entries(MARKS)) {
      const h = heatN(rec.n);
      const sub = Object.values(rec.judges || {}).filter((x) => x.submitted).length;
      rows.push({ key, n: rec.n, round: rec.round, dance: h ? h.dance : "", submitted: sub, of: J, current: !!h && judging.roundKey(h) === key });
    }
    rows.sort((a, b) => a.n - b.n);
    return json(res, 200, { judges: (DATA.judges || []).map((j) => ({ id: j.id, name: j.name })), heats: rows });
  }
  if (p === "/api/results/overall" && req.method === "GET") { // championships / scholarships: most 1sts, then 2nds…
    if (!isStaff(req, url)) return json(res, 401, { error: "Wrong PIN" });
    return json(res, 200, { heats: multiHeats(), events: overall() });
  }
  if (p === "/api/multis/suggest" && req.method === "GET") {
    if (!isStaff(req, url)) return json(res, 401, { error: "Wrong PIN" });
    return json(res, 200, { suggestions: judging.suggestMultis(DATA) });
  }
  if (p === "/api/results/action" && req.method === "POST") {
    const b = await body(req);
    if (String(b.pin) !== PIN) return json(res, 401, { error: "Wrong PIN" });
    if (b.action === "unlock") {
      const rec = MARKS[b.key], m = rec && rec.judges && rec.judges[b.judgeId];
      if (!m) return json(res, 404, { error: "No marks to unlock" });
      m.submitted = false; m.unlockedAt = Date.now();
    } else if (b.action === "restore") { // merge a downloaded backup: fills records the server doesn't have
      const src = b.marks && b.marks.marks ? b.marks.marks : b.marks;
      if (!src || typeof src !== "object") return json(res, 400, { error: "Not a marks backup" });
      let n = 0;
      for (const [key, rec] of Object.entries(src)) {
        if (!rec || typeof rec !== "object" || !rec.judges) continue;
        const dst = MARKS[key] = MARKS[key] || { n: rec.n, round: rec.round, judges: {} };
        for (const [jid, m] of Object.entries(rec.judges)) if (!dst.judges[jid] && m && m.cats) { dst.judges[jid] = m; n++; }
      }
      saveMarks(); state.version++; broadcast();
      return json(res, 200, { ok: true, restored: n });
    } else return json(res, 400, { error: "Unknown action" });
    saveMarks(); state.version++; broadcast();
    return json(res, 200, { ok: true });
  }
  if (p === "/api/results/export" && req.method === "GET") {
    if (!isStaff(req, url)) return json(res, 401, { error: "Wrong PIN" });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    if (url.searchParams.get("format") === "csv") {
      const q = (v) => { const t = String(v == null ? "" : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const jn = new Map((DATA.judges || []).map((j) => [j.id, j.name]));
      const lines = [["type", "heat", "dance", "round", "category", "judge", "couple", "mark", "result", "submitted_at"].join(",")];
      for (const [key, rec] of Object.entries(MARKS).sort((a, b) => a[1].n - b[1].n)) {
        const h = heatN(rec.n);
        for (const [jid, m] of Object.entries(rec.judges || {})) for (const [cat, v] of Object.entries(m.cats || {})) {
          if (v.dances) for (const [dn, dv] of Object.entries(v.dances)) {
            (dv.places || []).forEach((num, i) => lines.push(["mark", rec.n, dn, rec.round && rec.round.type, cat, jn.get(jid) || jid, num, i + 1, "", m.submitted ? new Date(m.at).toISOString() : "unlocked"].map(q).join(",")));
            (dv.recalls || []).forEach((num) => lines.push(["mark", rec.n, dn, "semi", cat, jn.get(jid) || jid, num, "X", "", m.submitted ? new Date(m.at).toISOString() : "unlocked"].map(q).join(",")));
          }
          if (v.places) v.places.forEach((num, i) => lines.push(["mark", rec.n, h && h.dance, rec.round && rec.round.type, cat, jn.get(jid) || jid, num, i + 1, "", m.submitted ? new Date(m.at).toISOString() : "unlocked"].map(q).join(",")));
          if (v.recalls) v.recalls.forEach((num) => lines.push(["mark", rec.n, h && h.dance, "semi", cat, jn.get(jid) || jid, num, "X", "", m.submitted ? new Date(m.at).toISOString() : "unlocked"].map(q).join(",")));
        }
        if (h && judging.roundKey(h) === key) for (const c of judging.heatResult(DATA, h, rec).cats) {
          if (c.multi) for (const pd of c.dances) {
            if (pd.result) pd.result.forEach((r) => lines.push(["result", rec.n, pd.dance, "final", c.key, "", r.num, "", r.place, ""].map(q).join(",")));
            if (pd.recall) pd.recall.rows.forEach((r) => lines.push(["result", rec.n, pd.dance, "semi", c.key, "", r.num, r.marks, r.recalled ? "recall" : r.tieAtCut ? "tie at cutoff" : "", ""].map(q).join(",")));
          }
          if (c.overall) c.overall.rows.forEach((r) => lines.push(["overall", rec.n, h.dance, "final", c.key, "", r.num, r.counts.map((v, i) => (i + 1) + ":" + v).join(" "), r.place == null ? "" : (r.tie ? "tie " : "") + r.place, ""].map(q).join(",")));
          if (c.result) c.result.forEach((r) => lines.push(["result", rec.n, h.dance, "final", c.key, "", r.num, "", r.place, ""].map(q).join(",")));
          if (c.recall) c.recall.rows.forEach((r) => lines.push(["result", rec.n, h.dance, "semi", c.key, "", r.num, r.marks, r.recalled ? "recall" : r.tieAtCut ? "tie at cutoff" : "", ""].map(q).join(",")));
        }
      }
      for (const ev of overall()) for (const c of ev.cats) for (const r of c.rows) {
        lines.push(["overall", ev.heats.join(" "), ev.name, ev.full + " of " + ev.total + " dances submitted", c.key, "", r.num, r.counts.map((v, i) => (i + 1) + ":" + v).join(" "), r.place == null ? "" : (r.tie ? "tie " : "") + r.place, ""].map(q).join(","));
      }
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=marks-${stamp}.csv`, "Cache-Control": "no-store" });
      return res.end(lines.join("\n") + "\n");
    }
    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename=marks-${stamp}.json`, "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ comp: DATA.comp && DATA.comp.name, exportedAt: Date.now(), judges: (DATA.judges || []).map((j) => ({ id: j.id, name: j.name })), marks: MARKS, multis: (DATA.multis || []).map((m) => ({ id: m.id, name: m.name, heats: m.heats })), overall: overall(), multiDanceHeats: multiHeats() }));
  }
  if (p === "/api/export" && req.method === "GET") {
    if (!isStaff(req, url)) return json(res, 401, { error: "Wrong PIN" });
    const csv = store.exportCsv(DATA);
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=comp.csv", "Cache-Control": "no-store" });
    return res.end(csv);
  }
  // static
  const ROUTES = { "/": "/index.html", "/control": "/control.html", "/simple": "/simple.html", "/simple-control": "/simple-control.html", "/simple-setup": "/simple-setup.html", "/competitor": "/simple.html", "/admin": "/simple-control.html", "/setup": "/simple-setup.html", "/judge": "/judge.html" };
  let f = ROUTES[p] || p;
  f = path.normalize(path.join(PUB, f));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Listening on :${PORT} (PIN ${PIN})`));
