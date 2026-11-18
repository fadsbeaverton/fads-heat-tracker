// Multi-dance heats (championships, scholarships): a heat whose name lists its dances in parentheses,
// e.g. "Smooth Championship (W, T, F)" or "Rhythm Scholarship (C, R, S, B, M)". Shared by the server and the pages.
(function (root) {
  const D = [
    ["Waltz", "W", ["w", "waltz", "american waltz", "slow waltz"]],
    ["Tango", "T", ["t", "tango", "american tango"]],
    ["Foxtrot", "F", ["f", "fox", "foxtrot", "fox trot", "slow foxtrot", "sf"]],
    ["Viennese Waltz", "VW", ["vw", "v", "v waltz", "v. waltz", "viennese", "viennese waltz"]],
    ["Peabody", "P", ["p", "pb", "peabody"]],
    ["Quickstep", "Q", ["q", "qs", "quickstep"]],
    ["Cha Cha", "C", ["c", "cc", "cha", "cha cha", "chacha", "cha-cha", "cha cha cha"]],
    ["Rumba", "R", ["r", "rumba", "rhumba"]],
    ["Swing", "S", ["s", "sw", "ecs", "swing", "east coast swing", "e.c. swing"]],
    ["Bolero", "B", ["b", "bo", "bolero"]],
    ["Mambo", "M", ["m", "mb", "mambo"]],
    ["West Coast Swing", "WCS", ["wcs", "west coast", "west coast swing"]],
    ["Hustle", "H", ["h", "hu", "hustle"]],
    ["Samba", "SA", ["sa", "sb", "samba"]],
    ["Jive", "J", ["j", "ji", "jive"]],
    ["Paso Doble", "PD", ["pd", "paso", "paso doble"]],
    ["Merengue", "ME", ["me", "mer", "merengue"]],
    ["Salsa", "SL", ["sl", "salsa"]],
    ["Argentine Tango", "AT", ["at", "argentine tango"]],
    ["Nightclub Two Step", "NC2S", ["nc", "nc2s", "ncts", "nightclub", "nightclub two step", "night club two step"]],
    ["Polka", "PK", ["pk", "polka"]],
    ["Lindy Hop", "LH", ["lh", "lindy", "lindy hop"]],
  ];
  const BY = new Map();
  for (const [name, ab, keys] of D) for (const k of keys) BY.set(k, { name, abbr: ab });
  const norm = (t) => String(t).toLowerCase().replace(/[.]/g, (m, i, s) => (/\w/.test(s[i + 1] || "") ? ". " : "")).replace(/\s+/g, " ").trim();
  // Returns { base, dances: [{ name, abbr }] } when the text has a parenthesized list of 2+ known dances, else null.
  function parse(text) {
    const s = String(text || "");
    const all = [...s.matchAll(/\(([^()]*)\)/g)];
    for (let i = all.length - 1; i >= 0; i--) {
      const toks = all[i][1].split(/\s*(?:,|\/|&|\+|;|\band\b)\s*/i).map((t) => t.trim()).filter(Boolean);
      if (toks.length < 2) continue;
      const ds = toks.map((t) => BY.get(norm(t)) || BY.get(norm(t).replace(/\s/g, "")) || null);
      if (ds.some((x) => !x) || new Set(ds.map((x) => x.name)).size !== ds.length) continue;
      const base = (s.slice(0, all[i].index) + s.slice(all[i].index + all[i][0].length)).replace(/\s+/g, " ").replace(/\s*[-–—:·]\s*$/, "").trim();
      return { base, dances: ds };
    }
    return null;
  }
  // "Smooth Championship (W, T, F)" -> "Smooth Championship · W, T, F"
  function label(text) { const p = parse(text); return p ? [p.base || "Multi-dance", p.dances.map((d) => d.abbr).join(", ")].join(" · ") : String(text || ""); }
  const api = { parse, label, list: D.map(([name, abbr]) => ({ name, abbr })) };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Dances = api;
})(typeof window !== "undefined" ? window : globalThis);
