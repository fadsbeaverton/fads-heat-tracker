// Persistent competition data (comp.json) and staff edit / CSV import helpers.
const fs = require("fs"), path = require("path");
const FILE = path.join(__dirname, "comp.json");
const CODES = path.join(__dirname, "codes.txt");
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

function toMin(s) {
  s = String(s || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!m) return null;
  let h = +m[1], min = +(m[2] || 0);
  const ap = (m[3] || "").toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function fmt(min) {
  if (min == null || min === "") return "";
  min = Math.round(Number(min));
  if (!Number.isFinite(min)) return "";
  let h = Math.floor(((min % 1440) + 1440) % 1440 / 60), m = ((min % 60) + 60) % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
function stamp(obj) {
  if (obj.time) { const m = toMin(obj.time); if (m != null) { obj.minute = m; obj.time = fmt(m); return obj; } }
  if (obj.minute != null) obj.time = fmt(obj.minute);
  return obj;
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (d && Array.isArray(d.heats) && Array.isArray(d.students)) return d;
  } catch {}
  // Hosted copy: heat list and private codes come from the COMP_DATA_GZ env var (gzip+base64 of comp.json), never the repo.
  if (process.env.COMP_DATA_GZ) {
    try {
      const d = JSON.parse(require("zlib").gunzipSync(Buffer.from(process.env.COMP_DATA_GZ, "base64")).toString("utf8"));
      if (d && Array.isArray(d.heats) && Array.isArray(d.students)) { save(d); return d; }
    } catch (e) { console.error("COMP_DATA_GZ invalid", e.message); }
  }
  const seed = require("./data");
  const d = { comp: seed.comp, pros: seed.pros, students: seed.students, heats: seed.heats,
    schedule: seed.schedule, events: seed.events, awards: seed.awards, heatMinutes: seed.heatMinutes };
  save(d);
  return d;
}
function save(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
  try {
    const lines = (d.students || []).map((s) => `${s.name}\t${s.code}\t/simple?code=${s.code}`);
    fs.writeFileSync(CODES, lines.join("\n") + (lines.length ? "\n" : ""));
  } catch {}
}

function newCode(d) {
  const used = new Set([...(d.students || []).map((s) => s.code), ...(d.pros || []).map((p) => p.code).filter(Boolean)]);
  let c;
  do { c = Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join(""); } while (used.has(c));
  return c;
}
function newStudentId(d) {
  const nums = (d.students || []).map((s) => Number(String(s.id || "").replace(/\D/g, "")) || 0);
  return "s" + ((nums.length ? Math.max(...nums) : 0) + 1);
}
function findPro(d, name) {
  name = String(name || "").trim();
  if (!name) return null;
  const low = name.toLowerCase();
  let p = (d.pros || []).find((x) => x.name.toLowerCase() === low);
  if (!p) {
    const nums = (d.pros || []).map((x) => Number(String(x.id || "").replace(/\D/g, "")) || 0);
    const twin = (d.students || []).find((x) => x.name.trim().toLowerCase() === low);
    p = { id: "p" + ((nums.length ? Math.max(...nums) : 0) + 1), name, code: twin ? twin.code : newCode(d) };
    d.pros = d.pros || [];
    d.pros.push(p);
  }
  return p;
}
function sortHeats(d) { d.heats.sort((a, b) => a.n - b.n); }
function maxHeat(d) { return (d.heats || []).reduce((m, h) => Math.max(m, h.n), 0); }
function heatByN(d, n) { return (d.heats || []).find((h) => h.n === n); }
function ensureHeat(d, n, fields) {
  n = parseInt(n, 10);
  if (!(n >= 1 && n <= 999)) throw new Error("Heat must be a number from 1 to 999");
  let h = heatByN(d, n);
  if (!h) {
    const max = maxHeat(d);
    if (n > max + 1) {
      // fill gaps so the program stays 1..N
      for (let i = max + 1; i < n; i++) d.heats.push({ n: i, style: "", dance: "", level: "", age: "", session: 0, minute: 0, time: "", entries: [] });
    }
    h = { n, style: "", dance: "", level: "", age: "", session: 0, minute: 0, time: "", entries: [] };
    d.heats.push(h);
  }
  if (fields) {
    if (fields.dance != null) h.dance = String(fields.dance).trim();
    if (fields.style != null) h.style = String(fields.style).trim();
    if (fields.level != null) h.level = String(fields.level).trim();
    if (fields.time != null) { h.time = String(fields.time).trim(); stamp(h); }
  }
  sortHeats(d);
  return h;
}
function renumberFrom(d, start, delta) {
  for (const h of d.heats) if (h.n >= start) h.n += delta;
  for (const a of d.awards || []) if (a.afterHeat >= start) a.afterHeat += delta;
  for (const ev of d.events || []) {
    if (ev.from >= start) ev.from += delta;
    if (ev.to >= start) ev.to += delta;
  }
  sortHeats(d);
}

function setComp(d, b) {
  d.comp = d.comp || {};
  if (b.name != null) d.comp.name = String(b.name).slice(0, 120);
  if (b.subtitle != null) d.comp.subtitle = String(b.subtitle).slice(0, 200);
  if (b.date != null) d.comp.date = String(b.date).slice(0, 80);
  if (b.venue != null) d.comp.venue = String(b.venue).slice(0, 120);
  d.comp.isExample = false;
}

function addStudent(d, b) {
  const name = String(b.name || "").trim();
  if (!name) throw new Error("Student name is required");
  if ((d.students || []).some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error("A student with that name already exists");
  const pro = findPro(d, b.partner || b.proName);
  const s = { id: newStudentId(d), name, level: String(b.level || "").trim() || "Bronze", proId: pro ? pro.id : ((d.pros[0] || {}).id || ""), code: newCode(d) };
  d.students.push(s);
  return s;
}
function updateStudent(d, b) {
  const s = (d.students || []).find((x) => x.id === b.id);
  if (!s) throw new Error("Student not found");
  if (b.name != null) {
    const name = String(b.name).trim();
    if (!name) throw new Error("Student name is required");
    if (d.students.some((x) => x.id !== s.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error("A student with that name already exists");
    s.name = name;
  }
  if (b.level != null) s.level = String(b.level).trim();
  if (b.partner != null || b.proName != null) {
    const pro = findPro(d, b.partner || b.proName);
    if (pro) s.proId = pro.id;
  }
  return s;
}
function deleteStudent(d, b) {
  const i = (d.students || []).findIndex((x) => x.id === b.id);
  if (i < 0) throw new Error("Student not found");
  const id = d.students[i].id;
  d.students.splice(i, 1);
  for (const h of d.heats) h.entries = (h.entries || []).filter((e) => e.studentId !== id);
}

function leaderNumber(v) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, 16) : "";
}
function addEntry(d, b) {
  const s = (d.students || []).find((x) => x.id === b.studentId);
  if (!s) throw new Error("Student not found");
  const n = parseInt(b.heat, 10);
  if (!(n >= 1)) throw new Error("Heat number is required");
  const h = ensureHeat(d, n, { dance: b.dance, style: b.style, time: b.time, level: b.heatLevel });
  if ((h.entries || []).some((e) => e.studentId === s.id)) throw new Error("That student is already in heat " + n);
  const pro = findPro(d, b.partner) || (s.proId && (d.pros || []).find((p) => p.id === s.proId)) || null;
  const couple = 100 + (Number(String(s.id).replace(/\D/g, "")) || d.students.length);
  const number = leaderNumber(b.number != null ? b.number : b.leaderNumber);
  h.entries = h.entries || [];
  h.entries.push({ studentId: s.id, proId: pro ? pro.id : (s.proId || ""), couple, ...(b.level ? { level: String(b.level).trim() } : {}), ...(number ? { number } : {}) });
  if (b.dance && !h.dance) h.dance = String(b.dance).trim();
  if (b.style && !h.style) h.style = String(b.style).trim();
  return h;
}
function removeEntry(d, b) {
  const n = parseInt(b.heat, 10);
  const h = heatByN(d, n);
  if (!h) throw new Error("Heat not found");
  const before = (h.entries || []).length;
  h.entries = (h.entries || []).filter((e) => e.studentId !== b.studentId);
  if (h.entries.length === before) throw new Error("That student is not in heat " + n);
}

function updateHeat(d, b) {
  const h = heatByN(d, parseInt(b.n, 10));
  if (!h) throw new Error("Heat not found");
  if (b.dance != null) h.dance = String(b.dance).trim();
  if (b.style != null) h.style = String(b.style).trim();
  if (b.level != null) h.level = String(b.level).trim();
  if (b.time != null) { h.time = String(b.time).trim(); stamp(h); }
  return h;
}
function addHeat(d, b) {
  const max = maxHeat(d);
  let n = b.n != null && String(b.n).trim() !== "" ? parseInt(b.n, 10) : max + 1;
  if (!(n >= 1 && n <= 999)) throw new Error("Heat must be a number from 1 to 999");
  if (heatByN(d, n)) throw new Error("Heat " + n + " already exists");
  if (n <= max) renumberFrom(d, n, 1);
  return ensureHeat(d, n, { dance: b.dance || "", style: b.style || "", time: b.time || "", level: b.level || "" });
}
function deleteHeat(d, b) {
  const n = parseInt(b.n, 10);
  const i = (d.heats || []).findIndex((h) => h.n === n);
  if (i < 0) throw new Error("Heat not found");
  d.heats.splice(i, 1);
  renumberFrom(d, n + 1, -1);
}

function addEvent(d, b) {
  const title = String(b.title || b.name || "").trim();
  if (!title) throw new Error("Event name is required");
  const ev = stamp({ title, time: String(b.time || "").trim() });
  if (ev.minute == null) throw new Error("A valid time is required (e.g. 10:00 AM)");
  d.events = d.events || [];
  d.events.push(ev);
  d.events.sort((a, c) => a.minute - c.minute);
  return ev;
}
function updateEvent(d, b) {
  const ev = (d.events || [])[b.i];
  if (!ev) throw new Error("Event not found");
  if (b.title != null || b.name != null) ev.title = String(b.title || b.name).trim();
  if (b.time != null) { ev.time = String(b.time).trim(); stamp(ev); }
  if (!ev.title) throw new Error("Event name is required");
  d.events.sort((a, c) => a.minute - c.minute);
  return ev;
}
function deleteEvent(d, b) {
  if (!(d.events || [])[b.i]) throw new Error("Event not found");
  d.events.splice(b.i, 1);
}

function addAward(d, b) {
  const afterHeat = parseInt(b.afterHeat, 10);
  if (!(afterHeat >= 1)) throw new Error("After heat is required");
  const a = stamp({ afterHeat, time: String(b.time || "").trim() });
  if (a.minute == null) throw new Error("A valid time is required (e.g. 11:00 AM)");
  d.awards = d.awards || [];
  if (d.awards.some((x) => x.afterHeat === afterHeat)) throw new Error("An award break already exists after heat " + afterHeat);
  d.awards.push(a);
  d.awards.sort((x, y) => x.afterHeat - y.afterHeat);
  return a;
}
function updateAward(d, b) {
  const a = (d.awards || [])[b.i];
  if (!a) throw new Error("Award break not found");
  if (b.afterHeat != null) a.afterHeat = parseInt(b.afterHeat, 10);
  if (b.time != null) { a.time = String(b.time).trim(); stamp(a); }
  if (!(a.afterHeat >= 1) || a.minute == null) throw new Error("After heat and a valid time are required");
  d.awards.sort((x, y) => x.afterHeat - y.afterHeat);
  return a;
}
function deleteAward(d, b) {
  if (!(d.awards || [])[b.i]) throw new Error("Award break not found");
  d.awards.splice(b.i, 1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => String(x).trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); if (row.some((x) => String(x).trim())) rows.push(row); }
  return rows;
}
function normHeader(h) { return String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function rowsToObjects(rows) {
  if (!rows.length) return [];
  const keys = rows[0].map(normHeader);
  return rows.slice(1).map((r) => {
    const o = {};
    keys.forEach((k, i) => { if (k) o[k] = r[i] != null ? String(r[i]).trim() : ""; });
    return o;
  });
}
function pickLeaderNumber(o) {
  const v = o.number || o.leadernumber || o.leader || o.couplenumber || "";
  if (v) return leaderNumber(v);
  const c = String(o.couple || "").trim();
  if (c && /^[0-9A-Za-z-]{1,8}$/.test(c)) return leaderNumber(c);
  return "";
}
function classify(o) {
  const typ = (o.type || "").toLowerCase();
  if (typ === "schedule" || typ === "event") return "schedule";
  if (typ === "award" || typ === "awards") return "award";
  if (typ === "entry" || typ === "heat") return "entry";
  if (o.event && !o.student && !o.heat) return "schedule";
  if ((o.afterheat || o.after) && !o.student) return "award";
  return "entry";
}

function collectImport(d, entryRows, scheduleRows, awardRows) {
  const errors = [], warnings = [];
  const students = new Map(); // lower name -> { name, level, partner, existing }
  const heats = new Map();
  const entries = [];
  const events = [];
  const awards = [];
  const existingByName = new Map((d.students || []).map((s) => [s.name.toLowerCase(), s]));

  function eatEntry(o, line) {
    const name = o.student || o.name || o.dancer || "";
    const heat = parseInt(o.heat || o.heatnumber || o.n, 10);
    if (!name) { errors.push("Row " + line + ": missing student name"); return; }
    if (!(heat >= 1)) { errors.push("Row " + line + " (" + name + "): missing or invalid heat number"); return; }
    const key = name.toLowerCase();
    if (!students.has(key)) students.set(key, { name, level: o.level || "", partner: o.partner || o.pro || "", existing: !!existingByName.get(key) });
    else {
      const s = students.get(key);
      if (o.level && !s.level) s.level = o.level;
      if ((o.partner || o.pro) && !s.partner) s.partner = o.partner || o.pro;
    }
    if (o.level && existingByName.get(key) && existingByName.get(key).level && o.level !== existingByName.get(key).level) {
      // fine — entry-level can differ; student level updated on replace/merge if provided
    }
    if (!heats.has(heat)) heats.set(heat, { n: heat, time: o.time || "", dance: o.dance || "", style: o.style || "", level: o.heatlevel || "" });
    else {
      const h = heats.get(heat);
      if (o.dance && h.dance && o.dance !== h.dance) warnings.push("Heat " + heat + " has more than one dance in the file; using “" + h.dance + "”");
      if (o.dance && !h.dance) h.dance = o.dance;
      if (o.style && !h.style) h.style = o.style;
      if (o.time && !h.time) h.time = o.time;
    }
    entries.push({ heat, student: name, level: o.level || "", partner: o.partner || o.pro || "", dance: o.dance || "", style: o.style || "", time: o.time || "", number: pickLeaderNumber(o), line });
  }
  function eatSched(o, line) {
    const title = o.event || o.title || o.name || "";
    if (!title) { errors.push("Schedule row " + line + ": missing event name"); return; }
    const ev = stamp({ title, time: o.time || "" });
    if (ev.minute == null) { errors.push("Schedule row " + line + " (“" + title + "”): missing or invalid time"); return; }
    events.push(ev);
  }
  function eatAward(o, line) {
    const afterHeat = parseInt(o.afterheat || o.after || o.heat, 10);
    if (!(afterHeat >= 1)) { errors.push("Awards row " + line + ": missing After Heat"); return; }
    const a = stamp({ afterHeat, time: o.time || "" });
    if (a.minute == null) { errors.push("Awards row " + line + " (after heat " + afterHeat + "): missing or invalid time"); return; }
    awards.push(a);
  }

  entryRows.forEach((o, i) => {
    const kind = classify(o);
    const line = i + 2;
    if (kind === "schedule") eatSched(o, line);
    else if (kind === "award") eatAward(o, line);
    else eatEntry(o, line);
  });
  (scheduleRows || []).forEach((o, i) => eatSched(o, i + 2));
  (awardRows || []).forEach((o, i) => eatAward(o, i + 2));

  const seen = new Set();
  const uniq = [];
  for (const e of entries) {
    const k = e.student.toLowerCase() + "#" + e.heat;
    if (seen.has(k)) { warnings.push("Duplicate entry skipped: " + e.student + " in heat " + e.heat); continue; }
    seen.add(k); uniq.push(e);
  }
  const newStudents = [...students.values()].filter((s) => !s.existing).length;
  const existingStudents = [...students.values()].filter((s) => s.existing).length;
  return {
    preview: {
      students: students.size, newStudents, existingStudents,
      heats: heats.size, entries: uniq.length,
      events: events.length, awards: awards.length,
      errors, warnings,
    },
    _payload: { students, heats, entries: uniq, events, awards },
  };
}

function applyImport(d, payload, mode) {
  const { students, heats, entries, events, awards } = payload;
  mode = mode === "merge" ? "merge" : "replace";
  const existingByName = new Map((d.students || []).map((s) => [s.name.toLowerCase(), s]));
  const nameToStudent = new Map();

  if (mode === "replace") {
    const kept = [];
    for (const [key, info] of students) {
      const old = existingByName.get(key);
      const pro = findPro(d, info.partner);
      if (old) {
        old.name = info.name;
        if (info.level) old.level = info.level;
        if (pro) old.proId = pro.id;
        kept.push(old);
        nameToStudent.set(key, old);
      } else {
        const s = { id: newStudentId({ students: kept }), name: info.name, level: info.level || "Bronze", proId: pro ? pro.id : ((d.pros[0] || {}).id || ""), code: newCode({ students: kept, pros: d.pros }) };
        kept.push(s);
        nameToStudent.set(key, s);
      }
    }
    d.students = kept;
    d.heats = [];
    for (const h of [...heats.values()].sort((a, b) => a.n - b.n)) {
      ensureHeat(d, h.n, { dance: h.dance, style: h.style, time: h.time, level: h.level });
    }
    if (events.length) d.events = events.slice().sort((a, b) => a.minute - b.minute);
    if (awards.length) d.awards = awards.slice().sort((a, b) => a.afterHeat - b.afterHeat);
  } else {
    for (const [key, info] of students) {
      let s = existingByName.get(key);
      if (s) {
        if (info.level) s.level = info.level;
        const pro = findPro(d, info.partner);
        if (pro) s.proId = pro.id;
      } else {
        s = addStudent(d, { name: info.name, level: info.level, partner: info.partner });
        existingByName.set(key, s);
      }
      nameToStudent.set(key, s);
    }
    for (const h of heats.values()) ensureHeat(d, h.n, { dance: h.dance, style: h.style, time: h.time, level: h.level });
    if (events.length) {
      d.events = d.events || [];
      for (const ev of events) {
        const i = d.events.findIndex((x) => x.title === ev.title && x.minute === ev.minute);
        if (i < 0) d.events.push(ev);
      }
      d.events.sort((a, b) => a.minute - b.minute);
    }
    if (awards.length) {
      d.awards = d.awards || [];
      for (const a of awards) {
        const i = d.awards.findIndex((x) => x.afterHeat === a.afterHeat);
        if (i >= 0) d.awards[i] = a; else d.awards.push(a);
      }
      d.awards.sort((a, b) => a.afterHeat - b.afterHeat);
    }
  }

  for (const e of entries) {
    const s = nameToStudent.get(e.student.toLowerCase());
    if (!s) continue;
    const h = heatByN(d, e.heat);
    if (!h) continue;
    if ((h.entries || []).some((x) => x.studentId === s.id)) continue;
    const pro = findPro(d, e.partner) || (s.proId && (d.pros || []).find((p) => p.id === s.proId));
    const couple = 100 + (Number(String(s.id).replace(/\D/g, "")) || 0);
    h.entries = h.entries || [];
    h.entries.push({ studentId: s.id, proId: pro ? pro.id : (s.proId || ""), couple, ...(e.level ? { level: e.level } : {}), ...(e.number ? { number: e.number } : {}) });
  }
}

function csvEscape(s) {
  s = String(s ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv(d) {
  const head = ["Type", "Heat", "Time", "Dance", "Style", "Level", "Student", "Partner", "Number", "Event", "AfterHeat"];
  const lines = [head.join(",")];
  const proName = (id) => ((d.pros || []).find((p) => p.id === id) || {}).name || "";
  for (const h of d.heats || []) {
    const ents = h.entries || [];
    if (!ents.length) {
      lines.push(["entry", h.n, h.time || "", h.dance || "", h.style || "", h.level || "", "", "", "", "", ""].map(csvEscape).join(","));
    }
    for (const e of ents) {
      const s = (d.students || []).find((x) => x.id === e.studentId);
      if (!s) continue;
      const partner = proName(e.proId || s.proId);
      lines.push(["entry", h.n, h.time || "", h.dance || "", h.style || "", e.level || s.level || "", s.name, partner, e.number || "", "", ""].map(csvEscape).join(","));
    }
  }
  for (const ev of d.events || []) {
    lines.push(["schedule", "", ev.time || "", "", "", "", "", "", "", ev.title || "", ""].map(csvEscape).join(","));
  }
  for (const a of d.awards || []) {
    lines.push(["award", "", a.time || "", "", "", "", "", "", "", "", a.afterHeat].map(csvEscape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function parseXlsxBuffer(buf) {
  let XLSX;
  try { XLSX = require("xlsx"); } catch { throw new Error("Excel (.xlsx) support is not installed. Save the file as CSV and try again."); }
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetToRows = (name) => {
    const sh = wb.Sheets[name];
    if (!sh) return [];
    const aoa = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });
    return aoa.map((r) => r.map((c) => String(c == null ? "" : c).trim()));
  };
  const names = wb.SheetNames || [];
  const lower = (s) => String(s).toLowerCase();
  const mainName = names.find((n) => /entry|heat|program|comp/i.test(n)) || names[0];
  const schedName = names.find((n) => /sched|event/i.test(lower(n)) && n !== mainName);
  const awardName = names.find((n) => /award/i.test(lower(n)) && n !== mainName);
  return {
    entries: rowsToObjects(sheetToRows(mainName)),
    schedule: schedName ? rowsToObjects(sheetToRows(schedName)) : [],
    awards: awardName ? rowsToObjects(sheetToRows(awardName)) : [],
  };
}

function parseImportInput(b, d) {
  let entryRows = [], scheduleRows = [], awardRows = [];
  if (b.csv) entryRows = rowsToObjects(parseCsv(b.csv));
  if (b.scheduleCsv) scheduleRows = rowsToObjects(parseCsv(b.scheduleCsv));
  if (b.awardsCsv) awardRows = rowsToObjects(parseCsv(b.awardsCsv));
  if (b.xlsxBase64) {
    const buf = Buffer.from(b.xlsxBase64, "base64");
    const parts = parseXlsxBuffer(buf);
    entryRows = entryRows.concat(parts.entries);
    scheduleRows = scheduleRows.concat(parts.schedule);
    awardRows = awardRows.concat(parts.awards);
  }
  if (!entryRows.length && !scheduleRows.length && !awardRows.length) throw new Error("No rows found. Check the file and column headers.");
  return collectImport(d, entryRows, scheduleRows, awardRows);
}

function setData(d, src) {
  if (!src || !Array.isArray(src.heats) || !Array.isArray(src.students)) throw new Error("Invalid data");
  // replace fields in place so callers keep the same object reference
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, JSON.parse(JSON.stringify(src)));
}

function apply(d, b) {
  const act = b.action;
  if (act === "preview-import") {
    const { preview } = parseImportInput(b, d);
    return { ok: true, preview };
  }
  if (act === "apply-import") {
    const { preview, _payload } = parseImportInput(b, d);
    if (preview.errors.length) throw new Error("Fix " + preview.errors.length + " error(s) before applying. " + preview.errors[0]);
    applyImport(d, _payload, b.mode);
    return { ok: true, preview, data: d };
  }
  if (act === "export") return { ok: true, csv: exportCsv(d) };
  if (act === "reload") { setData(d, load()); return { ok: true, data: d }; }
  if (act === "set-data") { setData(d, b.data); return { ok: true, data: d }; }

  if (act === "set-comp") setComp(d, b);
  else if (act === "add-student") { const s = addStudent(d, b); return { ok: true, student: s, data: d }; }
  else if (act === "update-student") updateStudent(d, b);
  else if (act === "delete-student") deleteStudent(d, b);
  else if (act === "new-code") {
    const s = (d.students || []).find((x) => x.id === b.id);
    if (!s) throw new Error("Student not found");
    s.code = newCode(d);
    return { ok: true, student: s, data: d };
  }
  else if (act === "add-entry") addEntry(d, b);
  else if (act === "remove-entry") removeEntry(d, b);
  else if (act === "update-heat") updateHeat(d, b);
  else if (act === "add-heat") addHeat(d, b);
  else if (act === "delete-heat") deleteHeat(d, b);
  else if (act === "add-event") addEvent(d, b);
  else if (act === "update-event") updateEvent(d, b);
  else if (act === "delete-event") deleteEvent(d, b);
  else if (act === "add-award") addAward(d, b);
  else if (act === "update-award") updateAward(d, b);
  else if (act === "delete-award") deleteAward(d, b);
  else throw new Error("Unknown action");
  return { ok: true, data: d };
}

module.exports = { load, save, apply, exportCsv, toMin, fmt, ALPHA, FILE };
