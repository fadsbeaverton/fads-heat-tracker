// EXAMPLE DATA ONLY — all names, heats and times are made up for the demo.
// Deterministic generator so every restart yields the same heat list.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const r = rng(20261115);
const pick = (a) => a[Math.floor(r() * a.length)];

const COMP = {
  name: "Rose City Ballroom Classic",
  subtitle: "Example competition · Fred Astaire Dance Studios Beaverton",
  date: "Saturday (example date)",
  venue: "Grand Ballroom (example venue)",
  isExample: true,
};

const PROS = [
  { id: "p1", name: "Marco Vellani" }, { id: "p2", name: "Elena Sorova" },
  { id: "p3", name: "Diego Alcantar" }, { id: "p4", name: "Natalie Brooks" },
  { id: "p5", name: "Jonah Whitfield" }, { id: "p6", name: "Sofia Lindqvist" },
];
const STUDENT_NAMES = [
  "Avery Holloway", "Brooke Tanaka", "Carmen Ruiz", "Daniel Okafor", "Evelyn Marsh",
  "Felix Granger", "Grace Whitmore", "Henry Castillo", "Isla Pennington", "Jasper Quinn",
  "Kendra Ashby", "Liam Doherty", "Maya Fontaine", "Nora Kessler", "Oliver Stanton",
  "Priya Raman", "Ruth Calloway", "Samuel Ibarra",
];
const STUDENTS = STUDENT_NAMES.map((name, i) => ({
  id: "s" + (i + 1), name,
  level: ["Bronze I", "Bronze II", "Bronze III", "Bronze IV", "Silver I", "Silver II", "Gold"][Math.floor(r() * 7)],
  proId: PROS[i % PROS.length].id,
}));

const STYLES = {
  Smooth: ["Waltz", "Tango", "Foxtrot", "Viennese Waltz"],
  Standard: ["Waltz", "Tango", "Foxtrot", "Quickstep", "Viennese Waltz"],
  Rhythm: ["Cha Cha", "Rumba", "East Coast Swing", "Bolero", "Mambo"],
  Latin: ["Cha Cha", "Samba", "Rumba", "Paso Doble", "Jive"],
};
const LEVEL_GROUPS = ["Bronze I–II", "Bronze III–IV", "Silver", "Gold", "Newcomer", "Bronze (Open)"];
const AGES = ["Adult A", "Adult B", "Senior I", "Senior II"];

// Student-facing day schedule (time + short event name only). Heat blocks
// line up with these times so styles fall in the right part of the day.
const EVENTS = [
  { title: "Registration", start: "08:00" },
  { title: "Dance camp", start: "09:00" },
  { title: "Closed/Open Rhythm", start: "10:00", from: 1, to: 30 },
  { title: "Awards", start: "11:00" },
  { title: "Lunch", start: "13:00" },
  { title: "Closed/Open Smooth", start: "14:00", from: 31, to: 60 },
  { title: "Awards", start: "15:00" },
  { title: "Closed/Open Standard/Latin", start: "15:15", from: 61, to: 104 },
  { title: "Dinner", start: "18:00" },
  { title: "Scholarships / Showcase", start: "19:30" },
  { title: "Awards", start: "20:15" },
  { title: "Party", start: "21:00" },
];
// Award breaks: given out after a designated heat, at the time on the day schedule.
const AWARDS = [
  { afterHeat: 30, start: "11:00" },  // after Closed/Open Rhythm
  { afterHeat: 60, start: "15:00" },  // after Closed/Open Smooth
  { afterHeat: 104, start: "20:15" }, // evening, after Showcase
];

// Blocks run in order; heat times are computed from them.
const HEAT_MIN = 1.75; // average minutes per heat incl. walk-on
const PLAN = [
  { kind: "info", title: "Registration", start: "08:00", minutes: 60 },
  { kind: "info", title: "Dance camp", start: "09:00", minutes: 60 },
  { kind: "heats", style: "Rhythm", count: 30, start: "10:00" },
  { kind: "awards", title: "Awards", start: "11:00", minutes: 20 },
  { kind: "break", title: "Lunch", start: "13:00", minutes: 60 },
  { kind: "heats", style: "Smooth", count: 30, start: "14:00" },
  { kind: "awards", title: "Awards", start: "15:00", minutes: 15 },
  { kind: "heats", style: "Standard", count: 24, start: "15:15" },
  { kind: "heats", style: "Latin", count: 20 },
  { kind: "break", title: "Dinner", start: "18:00", minutes: 90 },
  { kind: "info", title: "Scholarships / Showcase", start: "19:30", minutes: 45 },
  { kind: "awards", title: "Awards", start: "20:15", minutes: 45 },
  { kind: "info", title: "Party", start: "21:00", minutes: 120 },
];

function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function fmt(min) { min = Math.round(min); let h = Math.floor(min / 60), m = min % 60; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; }

const heats = [], schedule = [];
let t = 0, n = 0, sessionNo = 0;
for (const b of PLAN) {
  if (b.start) t = Math.max(t, toMin(b.start));
  if (b.kind === "session") { sessionNo++; schedule.push({ kind: "session", title: b.title, time: fmt(t) }); continue; }
  if (b.kind === "heats") {
    const first = n + 1; const startT = t;
    for (let i = 0; i < b.count; i++) {
      n++;
      heats.push({ n, style: b.style, dance: pick(STYLES[b.style]), level: pick(LEVEL_GROUPS), age: pick(AGES),
        session: sessionNo, minute: t, time: fmt(t), entries: [] });
      t += HEAT_MIN;
    }
    schedule.push({ kind: "heats", title: `${b.style} heats`, style: b.style, from: first, to: n, time: fmt(startT), end: fmt(t) });
    continue;
  }
  schedule.push({ kind: b.kind, title: b.title, time: fmt(t), end: fmt(t + b.minutes), afterHeat: n });
  t += b.minutes;
}

// Give each student 6–10 heats with their pro (no pro dances two heats at once).
for (const s of STUDENTS) {
  const want = 6 + Math.floor(r() * 5); let tries = 0, got = 0;
  while (got < want && tries++ < 500) {
    const h = heats[Math.floor(r() * heats.length)];
    if (h.entries.some((e) => e.proId === s.proId || e.studentId === s.id)) continue;
    if (h.entries.length >= 4) continue;
    h.entries.push({ studentId: s.id, proId: s.proId, couple: 100 + Number(s.id.slice(1)) });
    got++;
  }
}

// Private per-student access codes (EXAMPLE). Separate RNG so the heat list above never changes.
const rc = rng(73190731), ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const used = new Set();
for (const s of STUDENTS) { let c; do { c = Array.from({ length: 6 }, () => ALPHA[Math.floor(rc() * ALPHA.length)]).join(""); } while (used.has(c)); used.add(c); s.code = c; }

const events = EVENTS.map((e) => ({
  title: e.title, time: fmt(toMin(e.start)), minute: toMin(e.start),
  ...(e.from ? { from: e.from, to: e.to } : {}),
}));
const awards = AWARDS.map((a) => ({ afterHeat: a.afterHeat, time: fmt(toMin(a.start)), minute: toMin(a.start) }));

module.exports = { comp: COMP, pros: PROS, students: STUDENTS, heats, schedule, events, awards, heatMinutes: HEAT_MIN };
