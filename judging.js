// Judging: categories within a heat, the skating system (rules 5–8, single dance) and recall tallies.
// Pure functions over comp data + marks so they can be tested on their own.

const isOpen = (s) => /\bopen\b/i.test(String(s || ""));
const isClosed = (s) => /\bclosed\b/i.test(String(s || ""));

// A couple's category in a heat: Closed/Open (entry level beats heat style), plus level, age and division when present.
function categoryOf(d, h, e) {
  const st = (d.students || []).find((x) => x.id === e.studentId) || {};
  const parts = [];
  const lvlRaw = String(e.level || "").trim();
  let co = "";
  if (isOpen(lvlRaw)) co = "Open"; else if (isClosed(lvlRaw)) co = "Closed";
  else if (isOpen(h.style) && isClosed(h.style)) co = "Closed"; // a mixed "Closed/Open" heat: entries without "Open" are Closed
  else if (isOpen(h.style)) co = "Open"; else if (isClosed(h.style)) co = "Closed";
  else co = String(h.style || "").trim();
  if (co) parts.push(co);
  const lvl = (lvlRaw && !isOpen(lvlRaw) && !isClosed(lvlRaw)) ? lvlRaw : String(st.level || h.level || "").trim();
  if (lvl) parts.push(lvl);
  const age = String(e.age || h.age || "").trim(); if (age) parts.push(age);
  const div = String(e.division || "").trim(); if (div) parts.push(div);
  return parts.join(" · ") || "All couples";
}
const coupleNum = (e) => String(e.number != null && String(e.number).trim() !== "" ? e.number : e.couple != null ? e.couple : "?").trim();

// Categories in a heat, in order of first appearance: [{ key, couples: [{ num, lead, follow }] }]
function categories(d, h) {
  const pro = new Map((d.pros || []).map((p) => [p.id, p.name]));
  const stu = new Map((d.students || []).map((s) => [s.id, s]));
  const out = [], byKey = new Map();
  for (const e of h.entries || []) {
    const key = categoryOf(d, h, e);
    let c = byKey.get(key);
    if (!c) { c = { key, couples: [] }; byKey.set(key, c); out.push(c); }
    const s = stu.get(e.studentId) || {};
    c.couples.push({ num: coupleNum(e), lead: pro.get(e.proId || s.proId) || "", follow: s.name || "" });
  }
  for (const c of out) c.couples.sort((a, b) => (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0) || String(a.num).localeCompare(String(b.num)));
  return out;
}
const roundOf = (h) => (h.round && h.round.type === "semi") ? { type: "semi", recall: Math.max(1, parseInt(h.round.recall, 10) || 1) } : { type: "final" };
const roundKey = (h) => h.n + ":" + roundOf(h).type;

// Skating system, single dance (rules 5–8).
// marks: { judgeId: [num1st, num2nd, ...] } (each judge ranks every couple). Returns [{ num, place, detail }] sorted by place.
function skate(nums, marks) {
  const judges = Object.keys(marks);
  const J = judges.length, n = nums.length;
  if (!J || !n) return [];
  const maj = Math.floor(J / 2) + 1;
  const pl = new Map(nums.map((c) => [c, judges.map((j) => { const i = marks[j].indexOf(c); return i < 0 ? n : i + 1; })]));
  const cnt = (c, k) => pl.get(c).filter((p) => p <= k).length;
  const sum = (c, k) => pl.get(c).filter((p) => p <= k).reduce((a, b) => a + b, 0);
  const res = new Map(), detail = new Map();
  let place = 1;
  const unplaced = new Set(nums);
  function award(group, how) { const avg = place + (group.length - 1) / 2; for (const c of group) { res.set(c, avg); detail.set(c, how); unplaced.delete(c); } place += group.length; }
  // Rank a group that all hold a majority at column k (rules 6 & 7; ties go to the next column, then share the place).
  function resolve(group, k) {
    group = group.slice();
    while (group.length) {
      const maxC = Math.max(...group.map((c) => cnt(c, k)));
      const top = group.filter((c) => cnt(c, k) === maxC);
      let pick = top;
      if (top.length > 1) { const minS = Math.min(...top.map((c) => sum(c, k))); pick = top.filter((c) => sum(c, k) === minS); }
      if (pick.length === 1) award(pick, `${cnt(pick[0], k)} of ${J} at 1–${k}` + (top.length > 1 ? `, sum ${sum(pick[0], k)}` : ""));
      else if (k >= n) award(pick, "tie (shared)");
      else resolve(pick, k + 1); // rule 7: next place column for the tied couples only
      group = group.filter((c) => unplaced.has(c));
    }
  }
  while (unplaced.size) {
    let k = place, cands = [];
    for (; k <= n; k++) { cands = [...unplaced].filter((c) => cnt(c, k) >= maj); if (cands.length) break; }
    if (!cands.length) { award([...unplaced], "no majority"); break; }
    resolve(cands, k);
  }
  return nums.map((c) => ({ num: c, place: res.get(c), detail: detail.get(c), marks: pl.get(c) })).sort((a, b) => a.place - b.place || String(a.num).localeCompare(String(b.num)));
}

// Recalls: total marks, top N, flag a tie at the cutoff. recalls: { judgeId: [nums] }
function tallyRecalls(nums, recalls, target) {
  const tot = new Map(nums.map((c) => [c, 0]));
  for (const j of Object.keys(recalls)) for (const c of recalls[j] || []) if (tot.has(c)) tot.set(c, tot.get(c) + 1);
  const rows = nums.map((c) => ({ num: c, marks: tot.get(c) })).sort((a, b) => b.marks - a.marks || (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0));
  const N = Math.min(target, rows.length);
  const cut = N > 0 ? rows[N - 1].marks : Infinity;
  const tie = N > 0 && N < rows.length && rows[N].marks === cut;
  rows.forEach((r, i) => { r.recalled = r.marks > cut || (r.marks === cut && !tie && i < N); r.tieAtCut = tie && r.marks === cut; });
  return { rows, target: N, tie, cutMarks: cut };
}

// Full result for one heat: categories, each judge's marks, outstanding judges, and the computed placements / recalls.
function heatResult(d, h, rec) {
  const round = roundOf(h), judges = d.judges || [];
  const cats = categories(d, h);
  const byJ = (rec && rec.judges) || {};
  const contested = cats.filter((c) => c.couples.length >= 2);
  const submitted = judges.filter((j) => byJ[j.id] && byJ[j.id].submitted);
  const outstanding = contested.length ? judges.filter((j) => !(byJ[j.id] && byJ[j.id].submitted)) : [];
  const catsOut = cats.map((c) => {
    const nums = c.couples.map((x) => x.num);
    const base = { key: c.key, couples: c.couples, contested: nums.length >= 2 };
    if (nums.length < 2) return { ...base, result: nums.map((num) => ({ num, place: 1, detail: "uncontested" })) };
    const marks = {};
    for (const j of submitted) { const m = (byJ[j.id].cats || {})[c.key]; if (m) marks[j.id] = round.type === "semi" ? (m.recalls || []) : (m.places || []); }
    if (round.type === "semi") return { ...base, marks, recall: tallyRecalls(nums, marks, round.recall) };
    return { ...base, marks, result: skate(nums, marks) };
  });
  return { n: h.n, dance: h.dance, style: h.style, time: h.time, round, key: roundKey(h), judges: judges.map((j) => ({ id: j.id, name: j.name, submitted: !!(byJ[j.id] && byJ[j.id].submitted), at: byJ[j.id] && byJ[j.id].at })), outstanding: outstanding.map((j) => j.name), contested: contested.length > 0, cats: catsOut };
}

// ---- Multi-dance events (championships, scholarships) ----
// Stored in comp data as d.multis = [{ id, name, heats: [n, ...] }], one heat per dance.
// Overall winner: most 1st-place marks from all judges across all the event's dances, then most 2nds, 3rds, and so on.
const FAMILY = [
  ["Smooth", /^(waltz|tango|foxtrot|fox ?trot|viennese waltz|v\.? ?waltz|peabody)$/i],
  ["Rhythm", /^(cha ?cha|rumba|east coast swing|swing|bolero|mambo|merengue|hustle|west coast swing|wcs)$/i],
  ["Standard", /^(quickstep|slow foxtrot|international waltz|international tango)$/i],
  ["Latin", /^(samba|jive|paso ?doble|paso)$/i],
];
const KNOWN_DANCES = /\b(viennese waltz|v\.? ?waltz|waltz|tango|foxtrot|fox ?trot|peabody|quickstep|cha ?cha|rumba|east coast swing|west coast swing|swing|bolero|mambo|merengue|hustle|samba|jive|paso ?doble|paso|salsa|lindy hop|nightclub two step|polka)\b/gi;
const familyOf = (dance) => { const t = String(dance || "").trim(); for (const [f, re] of FAMILY) if (re.test(t)) return f; return ""; };
const kindOf = (name) => /scholar/i.test(name) ? "Scholarship" : /champ/i.test(name) ? "Championship" : "Multi-dance";
const heatMap = (d) => new Map((d.heats || []).map((h) => [h.n, h]));
const coupleSet = (h) => (h.entries || []).map(coupleNum).sort().join(",");

// Suggest groupings staff can accept with one tap. Two signals, both "obvious":
// 1) heat names that say Championship / Scholarship (e.g. "Open Smooth Championship – Waltz"): consecutive heats with the same name once the dance is removed;
// 2) consecutive heats on the same day with different dances of one family (Smooth, Rhythm…) and exactly the same couples (2+ couples, 3+ dances).
function suggestMultis(d) {
  const used = new Set((d.multis || []).flatMap((m) => m.heats || []));
  const H = (d.heats || []).slice().sort((a, b) => a.n - b.n).filter((h) => !used.has(h.n));
  const out = [], taken = new Set();
  const label = (h) => [h.style, h.dance, h.level].filter(Boolean).join(" ");
  const base = (h) => label(h).replace(KNOWN_DANCES, " ").replace(/[()\[\]\/,–—:-]+/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < H.length; i++) {
    const h = H[i]; if (taken.has(h.n) || !/champ|scholar/i.test(label(h))) continue;
    const b = base(h).toLowerCase(), run = [h];
    for (let j = i + 1; j < H.length; j++) { const x = H[j]; if (x.n !== run[run.length - 1].n + 1 && x.n - run[run.length - 1].n > 2) break; if (base(x).toLowerCase() === b && (x.day || "") === (h.day || "")) run.push(x); else if (/champ|scholar/i.test(label(x))) break; }
    if (run.length >= 2) { run.forEach((x) => taken.add(x.n)); out.push({ name: base(h).replace(/\b\w/g, (c) => c.toUpperCase()), heats: run.map((x) => x.n), dances: run.map((x) => (label(x).match(KNOWN_DANCES) || [x.dance])[0]), why: "Heat names say " + kindOf(base(h)) }); }
  }
  for (let i = 0; i < H.length; i++) {
    const h = H[i]; if (taken.has(h.n)) continue;
    const fam = familyOf(h.dance), cs = coupleSet(h);
    if (!fam || (h.entries || []).length < 2) continue;
    const run = [h];
    for (let j = i + 1; j < H.length; j++) {
      const x = H[j], prev = run[run.length - 1];
      if (x.n !== prev.n + 1 || taken.has(x.n) || (x.day || "") !== (h.day || "") || familyOf(x.dance) !== fam || (x.style || "") !== (h.style || "") || run.some((r) => r.dance === x.dance) || coupleSet(x) !== cs) break;
      run.push(x);
    }
    if (run.length >= 3) { run.forEach((x) => taken.add(x.n)); out.push({ name: [h.style, fam, "Championship"].filter(Boolean).join(" "), heats: run.map((x) => x.n), dances: run.map((x) => x.dance), why: "Same " + run[0].entries.length + " couples dance " + run.length + " " + fam + " dances in a row" }); i += run.length - 1; }
  }
  return out.sort((a, b) => a.heats[0] - b.heats[0]);
}

// Overall result for one multi-dance event. marksFor(h) returns the marks record for heat h's final (or undefined).
function multiResult(d, m, marksFor) {
  const judges = d.judges || [], hm = heatMap(d);
  const dances = [], cats = [], byKey = new Map();
  for (const n of m.heats || []) {
    const h = hm.get(n);
    if (!h) { dances.push({ n, dance: "", missing: true, full: false, submitted: 0, of: judges.length }); continue; }
    if (roundOf(h).type === "semi") { dances.push({ n, dance: h.dance, semi: true, full: false, submitted: 0, of: judges.length }); continue; }
    const r = heatResult(d, h, marksFor(h));
    const submitted = r.judges.filter((j) => j.submitted).length;
    dances.push({ n, dance: h.dance, submitted, of: judges.length, contested: r.contested, full: !r.contested || (judges.length > 0 && !r.outstanding.length) });
    for (const c of r.cats) {
      let cat = byKey.get(c.key);
      if (!cat) { cat = { key: c.key, rows: new Map(), contested: 0 }; byKey.set(c.key, cat); cats.push(cat); }
      for (const x of c.couples) { let row = cat.rows.get(x.num); if (!row) { row = { num: x.num, lead: x.lead, follow: x.follow, counts: [], dances: 0 }; cat.rows.set(x.num, row); } row.dances++; }
      if (!c.contested) continue;
      cat.contested++;
      for (const places of Object.values(c.marks || {})) places.forEach((num, i) => { const row = cat.rows.get(num); if (row) row.counts[i] = (row.counts[i] || 0) + 1; });
    }
  }
  const catsOut = cats.map((cat) => {
    const rows = [...cat.rows.values()];
    const P = Math.max(1, ...rows.map((r) => r.counts.length));
    rows.forEach((r) => { r.counts = Array.from({ length: P }, (_, i) => r.counts[i] || 0); r.votes = r.counts.reduce((a, b) => a + b, 0); });
    const cmp = (a, b) => { for (let i = 0; i < P; i++) if (a.counts[i] !== b.counts[i]) return b.counts[i] - a.counts[i]; return 0; };
    rows.sort((a, b) => cmp(a, b) || (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0));
    const anyVotes = rows.some((r) => r.votes);
    if (!cat.contested) { rows.forEach((r) => { r.place = rows.length === 1 ? 1 : null; r.tie = false; }); return { key: cat.key, places: P, rows, ties: false, uncontested: true }; }
    rows.forEach((r, i) => {
      r.place = !anyVotes ? null : i > 0 && cmp(rows[i - 1], r) === 0 ? rows[i - 1].place : i + 1;
    });
    rows.forEach((r) => { r.tie = anyVotes && rows.some((o) => o !== r && o.place === r.place); });
    return { key: cat.key, places: P, rows, ties: rows.some((r) => r.tie) };
  });
  const full = dances.filter((x) => x.full).length;
  return { id: m.id, name: m.name, kind: kindOf(m.name), heats: m.heats, dances, full, total: dances.length, complete: dances.length > 0 && full === dances.length, judges: judges.length, cats: catsOut };
}

module.exports = { categoryOf, categories, roundOf, roundKey, skate, tallyRecalls, heatResult, coupleNum, suggestMultis, multiResult, familyOf, kindOf };
