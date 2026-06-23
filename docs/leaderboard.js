// Leaderboard page. Loads the shared index (schemas, seasons, situations) and a
// season's full player objects, then renders a sortable table of percentiles --
// the group composites (overall) and every individual stat -- within a chosen
// pool (forwards / defensemen / goalies). Stat columns are banded under their
// group (Offense / Two-Way / Defense, or goalie Overall / By Danger / Workload).
// All percentiles come straight from the season files built by build_data.py;
// only OVR (the mean of a player's group percentiles) is derived here, for a
// sensible default sort.

let IDX = null;
let season = null;
let pool = "F";            // F | D | G
let sit = "all";           // all | 5on5
let filterText = "";
let minToi = 0;            // min total ice time (minutes) to include a player
let posFilter = "all";     // all | C | L | R  (only meaningful for the forward pool)
let teamFilter = "all";    // all | conf:<name> | div:<name> | team:<CODE>
let sortKey = "__ovr";
let sortDir = -1;          // -1 desc, 1 asc
const seasonCache = {};

const el = (id) => document.getElementById(id);

// same cold->hot percentile scale as the rest of the site
const COLD = [47, 91, 156], MID = [196, 188, 173], HOT = [200, 16, 46];
const NEUTRAL = "rgb(125,134,148)";
const DEFAULT_MUG = "https://assets.nhle.com/mugs/nhl/default-skater.png";

// OVR group weights mirror each pool's trophy philosophy so "overall" leans on
// the same things the awards do. Forwards use the Hart split (offense-led); the
// flat mean it replaced over-credited Defense, whose on-ice "against" rates
// reward sheltered minutes. Defensemen follow Norris, goalies Vezina.
const OVR_WEIGHTS = {
  F: { "Offense": 0.55, "Two-Way": 0.35, "Defense": 0.10 },
  D: { "Offense": 0.35, "Two-Way": 0.40, "Defense": 0.25 },
  G: { "Overall": 0.60, "By Danger": 0.40 },
};
// OVR blends the skill composite 75/25 with a workload percentile, the same weight
// and workload definition the awards use: skaters rank on per-game ice time
// (min/GP, a usage signal), goalies on total ice time (their min/GP is ~60 for all,
// so only games started separates a workhorse from a backup).
const LOAD_W = 0.25;
// workload metric for the active pool: min/GP for skaters, total minutes for goalies
const loadMetric = (p) =>
  pool === "G" ? p.toi_min : (p.games ? p.toi_min / p.games : 0);

// mid-rank percentile, matching build_data.py, so OVR is itself a percentile
function midrankPct(val, sorted) {
  const n = sorted.length;
  if (!n) return null;
  let below = 0, equal = 0;
  for (const v of sorted) { if (v < val) below++; else if (v === val) equal++; }
  return Math.round(100 * (below + equal / 2) / n);
}
function pctColor(p) {
  if (p >= 50) return lerpColor(MID, HOT, (p - 50) / 50);
  return lerpColor(COLD, MID, p / 50);
}
function lerpColor(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const POS_LABEL = { L: "LW", R: "RW" };
const posLabel = (p) => POS_LABEL[p] || p;
const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

// full team names for the Team dropdown (codes are what the data carries)
const TEAM_NAME = {
  ANA: "Anaheim Ducks", ARI: "Arizona Coyotes", ATL: "Atlanta Thrashers",
  BOS: "Boston Bruins", BUF: "Buffalo Sabres", CAR: "Carolina Hurricanes",
  CBJ: "Columbus Blue Jackets", CGY: "Calgary Flames", CHI: "Chicago Blackhawks",
  COL: "Colorado Avalanche", DAL: "Dallas Stars", DET: "Detroit Red Wings",
  EDM: "Edmonton Oilers", FLA: "Florida Panthers", LAK: "Los Angeles Kings",
  MIN: "Minnesota Wild", MTL: "Montreal Canadiens", NJD: "New Jersey Devils",
  NSH: "Nashville Predators", NYI: "New York Islanders", NYR: "New York Rangers",
  OTT: "Ottawa Senators", PHI: "Philadelphia Flyers", PIT: "Pittsburgh Penguins",
  SEA: "Seattle Kraken", SJS: "San Jose Sharks", STL: "St. Louis Blues",
  TBL: "Tampa Bay Lightning", TOR: "Toronto Maple Leafs", UTA: "Utah Hockey Club",
  VAN: "Vancouver Canucks", VGK: "Vegas Golden Knights", WPG: "Winnipeg Jets",
  WSH: "Washington Capitals",
};
// NHL alignment is season-dependent. The league realigned into today's four
// divisions in 2013-14; before that (2008-09 .. 2012-13) it ran six. Notably
// Detroit and Columbus were Western (Central) until the realignment, and the
// relocated Atlanta franchise (Winnipeg) played its first two seasons in the
// Eastern (Southeast) before moving West. So we resolve division/conference per
// season-era rather than with one static map.
const DIV_NEW = {   // 2013-14 onward (four divisions)
  BOS: "Atlantic", BUF: "Atlantic", DET: "Atlantic", FLA: "Atlantic",
  MTL: "Atlantic", OTT: "Atlantic", TBL: "Atlantic", TOR: "Atlantic",
  CAR: "Metropolitan", CBJ: "Metropolitan", NJD: "Metropolitan", NYI: "Metropolitan",
  NYR: "Metropolitan", PHI: "Metropolitan", PIT: "Metropolitan", WSH: "Metropolitan",
  CHI: "Central", COL: "Central", DAL: "Central", MIN: "Central", NSH: "Central",
  STL: "Central", UTA: "Central", WPG: "Central", ARI: "Central",
  ANA: "Pacific", CGY: "Pacific", EDM: "Pacific", LAK: "Pacific", SEA: "Pacific",
  SJS: "Pacific", VAN: "Pacific", VGK: "Pacific",
};
const DIV_OLD = {   // 2008-09 .. 2012-13 (six divisions)
  NJD: "Atlantic", NYI: "Atlantic", NYR: "Atlantic", PHI: "Atlantic", PIT: "Atlantic",
  BOS: "Northeast", BUF: "Northeast", MTL: "Northeast", OTT: "Northeast", TOR: "Northeast",
  ATL: "Southeast", CAR: "Southeast", FLA: "Southeast", TBL: "Southeast", WSH: "Southeast", WPG: "Southeast",
  CHI: "Central", CBJ: "Central", DET: "Central", NSH: "Central", STL: "Central",
  CGY: "Northwest", COL: "Northwest", EDM: "Northwest", MIN: "Northwest", VAN: "Northwest",
  ANA: "Pacific", DAL: "Pacific", LAK: "Pacific", ARI: "Pacific", SJS: "Pacific",
};
const CONF_OF_DIV = {
  Atlantic: "Eastern", Metropolitan: "Eastern", Northeast: "Eastern", Southeast: "Eastern",
  Central: "Western", Pacific: "Western", Northwest: "Western",
};
const DIVISIONS = {
  old: ["Atlantic", "Northeast", "Southeast", "Central", "Northwest", "Pacific"],
  new: ["Atlantic", "Metropolitan", "Central", "Pacific"],
};
// 2012-13 is the last six-division season; 2013-14 is the first realigned one
const seasonEra = (label) => (parseInt(label.slice(0, 4), 10) <= 2012 ? "old" : "new");
const divOf = (code, label) => (seasonEra(label) === "old" ? DIV_OLD : DIV_NEW)[code];
const confOf = (code, label) => CONF_OF_DIV[divOf(code, label)];
const teamName = (code) => TEAM_NAME[code] || code;
// strip diacritics so "stutzle" matches "Stützle"
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// compact column headers; the full label rides along in a tooltip
const GROUP_ABBR = {
  "Offense": "OFF", "Two-Way": "2WAY", "Defense": "DEF",
  "Overall": "OVRL", "By Danger": "DNGR", "Workload": "LOAD",
};
const STAT_ABBR = {
  xg60: "xG/60", sa60: "SA/60", hdxg60: "HDxG/60", pts60: "P/60", pa60: "A1/60",
  oixg60: "xGF/60", gax: "GAx", corsi: "CF%", fenwick: "FF%", relxg: "relxG",
  netpen: "NetPen", xga60: "xGA/60", blk60: "BLK/60", tk60: "TK/60",
  giv60: "GV/60", hit60: "HIT/60",
  sv: "SV%", gsax60: "xGSA/60", gsax: "xGSA", rebsh: "Reb/Sh", hdsv: "HDSV%",
  mdsv: "MDSV%", ldsv: "LDSV%", xgshot: "xG/Sh", sf60: "SF/60",
};

function fmtVal(v, fmt) {
  if (fmt === "pct") return v.toFixed(1) + "%";
  if (fmt === "gax") return (v >= 0 ? "+" : "") + v.toFixed(1);
  if (fmt === "gax2") return (v >= 0 ? "+" : "") + v.toFixed(2);
  if (fmt === "int") return (v >= 0 ? "+" : "") + Math.round(v);
  if (fmt === "svp") return v.toFixed(3).replace(/^0/, "");
  if (fmt === "rate3") return v.toFixed(3);
  return v.toFixed(2);
}

// ---- which stats/groups belong to the active pool ----
const isGoaliePool = () => pool === "G";
const poolStats = () => (isGoaliePool() ? IDX.stats_goalie : IDX.stats);

// ordered sections: a group, its composite (if it has any skill stat) and the
// individual stats beneath it. Goalie "Workload" is neutral-only -> band, no
// composite column.
function sections() {
  const stats = poolStats();
  const order = isGoaliePool() ? IDX.groups_goalie : IDX.groups;
  return order.map((g) => {
    const gstats = stats.filter((s) => s.group === g);
    return { group: g, composite: gstats.some((s) => !s.neutral) ? g : null, stats: gstats };
  }).filter((sec) => sec.stats.length);
}

// flat, ordered column descriptors used to render body cells
function columns() {
  const cols = [
    { key: "__rank", type: "rank", label: "#" },
    { key: "__name", type: "name", label: "Player" },
    { key: "__ovr", type: "ovr", label: "OVR",
      title: "Overall percentile: a trophy-weighted skill composite (Hart for forwards, " +
             "Norris for D, Vezina for goalies) blended 75/25 with workload " +
             "(min/GP for skaters, total ice time for goalies), then re-ranked within the pool" },
  ];
  sections().forEach((sec) => {
    let first = true;
    const push = (c) => { c.sectionStart = first; first = false; cols.push(c); };
    if (sec.composite) {
      push({ key: sec.composite, type: "group",
             label: GROUP_ABBR[sec.composite] || sec.composite, title: sec.composite });
    }
    sec.stats.forEach((s) => push({ key: s.key, type: "stat",
      label: STAT_ABBR[s.key] || s.label, title: s.label,
      fmt: s.fmt, low: s.low, neutral: s.neutral }));
  });
  return cols;
}
const columnExists = (key) => columns().some((c) => c.key === key);

// ---- value accessors against a player's active-situation block ----
function groupPct(p, g) {
  const b = p.situations[sit];
  return b && b.groups[g] ? b.groups[g].pct : null;
}
function statCell(p, key) {
  const b = p.situations[sit];
  return b && b.stats[key] ? b.stats[key] : null;
}
// weighted skill composite (raw 0-100 score) from the active pool's group pcts
function ovrSkill(p) {
  const w = OVR_WEIGHTS[pool];
  if (!w) return null;
  let sum = 0, wsum = 0;
  for (const [g, weight] of Object.entries(w)) {
    const pct = groupPct(p, g);
    if (pct == null) continue;
    sum += pct * weight; wsum += weight;
  }
  return wsum ? sum / wsum : null;
}

// OVR is the skill composite blended 75/25 with a pool-wide ice-time percentile,
// then re-ranked into its own percentile. OVR_RAW keeps the continuous blend for
// full-resolution sorting; both are rebuilt across the whole pool (not the text
// or TOI filter) whenever pool/situation/season change.
let OVR_RAW = {};
let OVR_PCT = {};
function computeOvr() {
  OVR_RAW = {}; OVR_PCT = {};
  const data = seasonCache[season];
  if (!data) return;
  const pooled = data.players.filter((p) => p.pool === pool && p.situations[sit]);
  const loads = pooled.map(loadMetric).sort((a, b) => a - b);        // for load pct
  pooled.forEach((p) => {
    const skill = ovrSkill(p);
    if (skill == null) return;
    const load = midrankPct(loadMetric(p), loads);
    OVR_RAW[p.id] = skill * (1 - LOAD_W) + load * LOAD_W;
  });
  const sorted = Object.values(OVR_RAW).sort((a, b) => a - b);
  for (const id in OVR_RAW) OVR_PCT[id] = midrankPct(OVR_RAW[id], sorted);
}
const ovr = (p) => (p.id in OVR_PCT ? OVR_PCT[p.id] : null);
function sortValue(p, col) {
  if (col.type === "name") return p.name.toLowerCase();
  // sort OVR by the continuous blend (full resolution) but display its percentile,
  // so the elite aren't all tied at 100 and broken alphabetically
  if (col.type === "ovr") return p.id in OVR_RAW ? OVR_RAW[p.id] : null;
  if (col.type === "group") return groupPct(p, col.key);
  const c = statCell(p, col.key);
  return c ? c.pct : null;
}

// ---- data loading ----
function loadSeason(label) {
  if (seasonCache[label]) return Promise.resolve(seasonCache[label]);
  return fetch(`data/season_${label}.json`)
    .then((r) => r.json())
    .then((d) => { seasonCache[label] = d; return d; });
}

// ---- controls ----
function renderControls() {
  const pt = el("pool-toggle");
  pt.innerHTML = "";
  [["F", "Forwards"], ["D", "Defensemen"], ["G", "Goalies"]].forEach(([k, lbl]) => {
    const b = document.createElement("button");
    b.textContent = lbl;
    b.className = k === pool ? "on" : "";
    b.onclick = () => {
      if (pool === k) return;
      pool = k;
      minToi = 0;            // TOI scale differs by pool (goalies dwarf skaters)
      posFilter = "all";     // position options are pool-specific (C/LW/RW only apply to F)
      if (!columnExists(sortKey)) { sortKey = "__ovr"; sortDir = -1; }
      render();
    };
    pt.appendChild(b);
  });

  const st = el("board-sit-toggle");
  st.innerHTML = "";
  IDX.situations.forEach((s) => {
    const b = document.createElement("button");
    b.textContent = s === "5on5" ? "5-on-5" : "All";
    b.className = s === sit ? "on" : "";
    b.onclick = () => { sit = s; render(); };
    st.appendChild(b);
  });

  const sel = el("board-season");
  sel.innerHTML = "";
  IDX.seasons.forEach((s) => {
    const o = document.createElement("option");
    o.value = s; o.textContent = s;
    if (s === season) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { season = sel.value; minToi = 0; loadSeason(season).then(render); };

  renderPosFilter();
  renderTeamFilter();

  // TOI slider: scale to the active pool's heaviest workload, clamp + relabel
  const slider = el("toi-slider");
  const maxToi = poolMaxToi();
  slider.max = maxToi;
  if (minToi > maxToi) minToi = 0;
  slider.value = minToi;
  setToiLabel();
}

function poolMaxToi() {
  const data = seasonCache[season];
  if (!data) return 0;
  let mx = 0;
  data.players.forEach((p) => { if (p.pool === pool && p.toi_min > mx) mx = p.toi_min; });
  return Math.ceil(mx / 25) * 25;
}
function setToiLabel() {
  el("toi-value").textContent = minToi > 0 ? `≥ ${minToi.toLocaleString()} min` : "all";
}

// Position dropdown: only forwards split into C/LW/RW; D and G are single-position
// pools, so the control is just a disabled "all" label there.
function renderPosFilter() {
  const sel = el("pos-filter");
  const opts = pool === "F"
    ? [["all", "All Forwards"], ["C", "Centers"], ["L", "Left Wings"], ["R", "Right Wings"]]
    : [["all", pool === "D" ? "Defensemen" : "Goalies"]];
  if (!opts.some(([v]) => v === posFilter)) posFilter = "all";
  sel.innerHTML = "";
  opts.forEach(([v, lbl]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = lbl;
    if (v === posFilter) o.selected = true;
    sel.appendChild(o);
  });
  sel.disabled = opts.length < 2;
  sel.onchange = () => { posFilter = sel.value; renderBody(); };
}

// Team dropdown: entire league, then conferences, divisions, and every team that
// actually iced a player this season (grouped with <optgroup>). Pure row filter,
// so percentile ranks stay pool-wide.
function renderTeamFilter() {
  const sel = el("team-filter");
  const data = seasonCache[season];
  const teams = data
    ? [...new Set(data.players.map((p) => p.team))].sort((a, b) => teamName(a).localeCompare(teamName(b)))
    : [];
  const divisions = DIVISIONS[seasonEra(season)];
  // a team / division pick can go stale when the season (or its era) changes
  if (teamFilter.startsWith("team:") && !teams.includes(teamFilter.slice(5))) teamFilter = "all";
  if (teamFilter.startsWith("div:") && !divisions.includes(teamFilter.slice(4))) teamFilter = "all";

  sel.innerHTML = "";
  const addOpt = (parent, value, label) => {
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    if (value === teamFilter) o.selected = true;
    parent.appendChild(o);
  };
  const addGroup = (label, rows) => {
    const g = document.createElement("optgroup");
    g.label = label;
    rows.forEach(([v, l]) => addOpt(g, v, l));
    sel.appendChild(g);
  };
  addOpt(sel, "all", "Entire League");
  addGroup("Conference", [["conf:Eastern", "Eastern Conference"], ["conf:Western", "Western Conference"]]);
  addGroup("Division", divisions.map((d) => [`div:${d}`, d]));
  addGroup("Team", teams.map((t) => [`team:${t}`, teamName(t)]));
  sel.onchange = () => { teamFilter = sel.value; renderBody(); };
}

// does a player pass the active team-group / single-team filter?
function teamMatch(p) {
  if (teamFilter === "all") return true;
  if (teamFilter.startsWith("conf:")) return confOf(p.team, season) === teamFilter.slice(5);
  if (teamFilter.startsWith("div:")) return divOf(p.team, season) === teamFilter.slice(4);
  if (teamFilter.startsWith("team:")) return p.team === teamFilter.slice(5);
  return true;
}

// ---- sorting / rows ----
function sortedRows() {
  const data = seasonCache[season];
  if (!data) return [];
  let list = data.players.filter((p) => p.pool === pool && p.situations[sit] && p.toi_min >= minToi);
  if (posFilter !== "all") list = list.filter((p) => p.position === posFilter);
  if (teamFilter !== "all") list = list.filter(teamMatch);
  if (filterText) {
    const q = fold(filterText);
    list = list.filter((p) => fold(p.name).includes(q));
  }
  const cols = columns();
  const col = cols.find((c) => c.key === sortKey) || cols[2];
  const m = sortDir;                       // +1 asc, -1 desc; nulls always sort last
  return list.sort((a, b) => {
    const va = sortValue(a, col), vb = sortValue(b, col);
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va < vb) return -m;
    if (va > vb) return m;
    return a.name.localeCompare(b.name);
  });
}

function setSort(col) {
  if (sortKey === col.key) sortDir = -sortDir;
  else { sortKey = col.key; sortDir = col.type === "name" ? 1 : -1; }
  render();
}

// ---- header (two rows: group bands + sortable columns) ----
function thFor(col, rowspan) {
  const th = document.createElement("th");
  th.className = "col-" + col.type + (col.key === sortKey ? " sorted" : "") +
                 (col.sectionStart ? " sec-start" : "");
  if (rowspan) th.rowSpan = 2;
  if (col.title) th.title = col.title;
  const arrow = col.key === sortKey ? (sortDir === 1 ? "▲" : "▼") : "";
  const low = col.low ? '<i class="lowmark" title="lower is better">&darr;</i>' : "";
  th.innerHTML = `<span class="th-lbl">${col.label}${low}</span>` +
                 `<i class="sort-arrow">${arrow}</i>`;
  if (col.type !== "rank") { th.classList.add("sortable"); th.onclick = () => setSort(col); }
  return th;
}

function renderHead() {
  const head = el("board-head");
  head.innerHTML = "";
  const bands = document.createElement("tr"); bands.className = "band-row";
  const colrow = document.createElement("tr"); colrow.className = "col-row";

  // rank / name / ovr span both header rows
  ["__rank", "__name", "__ovr"].forEach((k) => {
    const c = columns().find((x) => x.key === k);
    bands.appendChild(thFor(c, true));
  });

  sections().forEach((sec) => {
    const span = (sec.composite ? 1 : 0) + sec.stats.length;
    const band = document.createElement("th");
    band.className = "band band-" + slug(sec.group);
    band.colSpan = span;
    band.textContent = sec.group;
    bands.appendChild(band);
  });

  // second row: every sortable column (composites + stats), in order
  columns().filter((c) => !["__rank", "__name", "__ovr"].includes(c.key))
    .forEach((c) => colrow.appendChild(thFor(c, false)));

  head.append(bands, colrow);
}

// ---- body ----
function paintPct(td, pct, strong, neutral) {
  if (pct == null) { td.textContent = "–"; return; }
  const pill = document.createElement("span");
  pill.className = "pct-pill" + (strong ? " strong" : "");
  pill.textContent = pct;
  pill.style.background = neutral ? NEUTRAL : pctColor(pct);
  td.appendChild(pill);
}

function nameCell(td, p, code) {
  const a = document.createElement("a");
  a.className = "board-name";
  a.href = `index.html?id=${p.id}&season=${season}`;
  const img = document.createElement("img");
  img.className = "bn-mug";
  img.loading = "lazy";
  img.onerror = () => { img.onerror = null; img.src = DEFAULT_MUG; };
  img.src = `https://assets.nhle.com/mugs/nhl/${code}/${p.team}/${p.id}.png`;
  const txt = document.createElement("span");
  txt.className = "bn-txt";
  txt.innerHTML = `<span class="bn-name">${p.name}</span>` +
                  `<span class="bn-meta">${posLabel(p.position)} &middot; ${p.team} ` +
                  `&middot; ${p.toi_min.toLocaleString()} min</span>`;
  a.append(img, txt);
  td.appendChild(a);
}

function renderBody() {
  const cols = columns();
  const code = IDX.headshot_seasons[season];
  const body = el("board-body");
  body.innerHTML = "";
  const list = sortedRows();

  if (!list.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = cols.length;
    td.className = "board-empty";
    td.textContent = "No players match.";
    tr.appendChild(td);
    body.appendChild(tr);
    el("board-count").textContent = "0 players";
    return;
  }

  list.forEach((p, i) => {
    const tr = document.createElement("tr");
    if (i < 3) tr.className = "lead lead-" + (i + 1);
    cols.forEach((c) => {
      const td = document.createElement("td");
      td.className = "col-" + c.type + (c.sectionStart ? " sec-start" : "");
      if (c.type === "rank") {
        td.innerHTML = `<span class="rk">${i + 1}</span>`;
      } else if (c.type === "name") {
        nameCell(td, p, code);
      } else if (c.type === "ovr") {
        paintPct(td, ovr(p), true);
      } else if (c.type === "group") {
        paintPct(td, groupPct(p, c.key), true);
      } else {
        const cell = statCell(p, c.key);
        if (cell) {
          paintPct(td, cell.pct, false, c.neutral);
          td.title = `${c.title}: ${fmtVal(cell.value, c.fmt)} (${cell.pct} pct)`;
        } else { td.textContent = "–"; }
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  el("board-count").textContent =
    `${list.length} ${pool === "G" ? "goalie" : pool === "D" ? "defenseman" : "forward"}${list.length === 1 ? "" : "s"}`;
}

function render() {
  computeOvr();
  renderControls();
  renderHead();
  renderBody();
}

// ---- boot ----
el("board-filter").addEventListener("input", (e) => {
  filterText = e.target.value.trim();
  renderBody();
});
el("toi-slider").addEventListener("input", (e) => {
  minToi = +e.target.value;
  setToiLabel();
  renderBody();          // TOI filter just hides rows; OVR ranks stay pool-wide
});

fetch("data/index.json").then((r) => r.json()).then((idx) => {
  IDX = idx;
  season = IDX.seasons.includes(IDX.default_season) ? IDX.default_season : IDX.seasons[0];
  sit = IDX.situations.includes("all") ? "all" : IDX.situations[0];
  return loadSeason(season);
}).then(render).catch((e) => {
  el("board-body").innerHTML =
    `<tr><td class="board-empty">Failed to load data: ${e}</td></tr>`;
});
