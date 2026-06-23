// Hockey Savant front-end. Multi-season: an index + per-player search index load
// on boot; each season's full player objects load on demand and are cached.

let IDX = null;          // index.json (seasons, stat schemas, situations, ...)
let SEARCH = [];         // players_index.json (one entry per player, with seasons[])
const seasonCache = {};  // label -> { season, players }

let currentEntry = null; // search-index entry for the selected player
let current = null;      // full player object for the active season
let currentSeason = null;
let currentSit = null;

const el = (id) => document.getElementById(id);

// percentile -> cold(blue) .. hot(red) scale (Savant convention: high = elite)
const COLD = [47, 91, 156], MID = [196, 188, 173], HOT = [200, 16, 46];
function pctColor(p) {
  if (p >= 50) return lerpColor(MID, HOT, (p - 50) / 50);
  return lerpColor(COLD, MID, p / 50);
}
function lerpColor(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const NEUTRAL = "rgb(125,134,148)";       // slate for context (neither good nor bad)
const LOGO_LIGHT = { TBL: true, TOR: true }; // teams whose dark logo is invisible
const POS_LABEL = { L: "LW", R: "RW" };
const posLabel = (p) => POS_LABEL[p] || p;
// strip diacritics so "stutzle" matches "Stützle"
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function fmtVal(v, fmt) {
  if (fmt === "pct") return v.toFixed(1) + "%";
  if (fmt === "gax") return (v >= 0 ? "+" : "") + v.toFixed(1);
  if (fmt === "gax2") return (v >= 0 ? "+" : "") + v.toFixed(2);
  if (fmt === "int") return (v >= 0 ? "+" : "") + Math.round(v);
  if (fmt === "svp") return v.toFixed(3).replace(/^0/, "");
  if (fmt === "rate3") return v.toFixed(3);
  return v.toFixed(2);
}

// ---- data loading ----
function loadSeason(label) {
  if (seasonCache[label]) return Promise.resolve(seasonCache[label]);
  return fetch(`data/season_${label}.json`)
    .then((r) => r.json())
    .then((d) => { seasonCache[label] = d; return d; });
}

// pick which season to show first for a player: prefer the default (2025-26),
// else their most recent qualifying season (seasons[] is sorted latest-first).
function defaultSeasonFor(entry) {
  return entry.seasons.includes(IDX.default_season) ? IDX.default_season : entry.seasons[0];
}

function selectPlayer(entry, season) {
  currentEntry = entry;
  const label = season || defaultSeasonFor(entry);
  loadSeason(label).then((data) => {
    const player = data.players.find((p) => p.id === entry.id);
    if (!player) return;
    current = player;
    currentSeason = label;
    if (!player.situations[currentSit]) {
      currentSit = IDX.situations.find((s) => player.situations[s]);
    }
    el("search").value = entry.name;
    el("suggest").innerHTML = "";
    el("similar").classList.remove("hidden");
    renderCard();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ---- card ----
function renderCard() {
  if (!current) return;
  const isGoalie = current.type === "goalie";
  const stats = isGoalie ? IDX.stats_goalie : IDX.stats;
  const groups = isGoalie ? IDX.groups_goalie : IDX.groups;
  const sit = current.situations[currentSit];

  el("p-name").textContent = current.name;
  el("p-sub").textContent =
    `${posLabel(current.position)} - ${current.team} - ${current.games} GP - ` +
    `${Math.round(sit.toi_min)} min ${currentSit}`;
  el("p-line").innerHTML = isGoalie
    ? `<b>${current.gaa.toFixed(2)}</b> GAA<span class="sep">|</span>` +
      `<b>${current.svp.toFixed(3).replace(/^0/, "")}</b> SV%`
    : `<b>${current.goals}</b> G<span class="sep">|</span>` +
      `<b>${current.assists}</b> A<span class="sep">|</span>` +
      `<b>${current.points}</b> PTS`;
  el("pool-label").textContent =
    isGoalie ? "goalies" : current.pool === "D" ? "defensemen" : "forwards";

  // headshot (season-specific mug; falls back to silhouette for old/missing ones)
  const code = IDX.headshot_seasons[currentSeason];
  const photo = el("p-photo");
  photo.onerror = () => {
    photo.onerror = null;
    photo.src = "https://assets.nhle.com/mugs/nhl/default-skater.png";
  };
  photo.src = `https://assets.nhle.com/mugs/nhl/${code}/${current.team}/${current.id}.png`;
  photo.alt = current.name;

  // small inline team logo (hidden if the asset is missing, e.g. defunct teams)
  const logo = el("p-logo");
  logo.onerror = () => { logo.onerror = null; logo.style.display = "none"; };
  logo.style.display = "";
  const variant = LOGO_LIGHT[current.team] ? "light" : "dark";
  logo.src = `https://assets.nhle.com/logos/nhl/svg/${current.team}_${variant}.svg`;

  renderSeasonSelect();

  // situation toggle
  const tog = el("sit-toggle");
  tog.innerHTML = "";
  IDX.situations.forEach((s) => {
    const b = document.createElement("button");
    b.textContent = s === "5on5" ? "5-on-5" : "All";
    b.className = s === currentSit ? "on" : "";
    b.onclick = () => { currentSit = s; renderCard(); };
    tog.appendChild(b);
  });

  // sliders grouped into sections
  const wrap = el("sliders");
  wrap.innerHTML = "";
  groups.forEach((g) => {
    const inGroup = stats.filter((s) => s.group === g);
    if (!inGroup.length) return;
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `<span>${g}</span>`;
    const comp = sit.groups && sit.groups[g];
    if (comp) {
      const badge = document.createElement("span");
      badge.className = "group-score";
      badge.textContent = comp.pct;
      badge.style.background = pctColor(comp.pct);
      badge.title = `Group percentile (avg ${comp.avg})`;
      head.appendChild(badge);
    }
    wrap.appendChild(head);
    inGroup.forEach((st) => {
      const cell = sit.stats[st.key];
      const row = document.createElement("div");
      row.className = "slider-row";
      let tag = "";
      if (st.low) tag = ' <span class="inv">&darr;</span>';
      else if (st.neutral) tag = ' <span class="inv" title="context, not skill">-</span>';
      row.innerHTML = `
        <div class="slider-label">${st.label}${tag}</div>
        <div class="track"><div class="fill-wrap"></div></div>
        <div class="slider-val">${fmtVal(cell.value, st.fmt)}</div>`;
      const dot = document.createElement("div");
      dot.className = "dot";
      dot.style.left = cell.pct + "%";
      dot.style.background = st.neutral ? NEUTRAL : pctColor(cell.pct);
      dot.textContent = cell.pct;
      row.querySelector(".fill-wrap").appendChild(dot);
      wrap.appendChild(row);
    });
  });

  renderSimilar(current, currentSit);
  renderTrajectory();
  el("card").classList.remove("hidden");
  el("empty").classList.add("hidden");
}

// ---- season-by-season trajectory charts (under the card) ----
// Group colors echo the percentile scale's poles; OVR uses the brand accent.
const GROUP_COLORS = {
  "Offense": "#c8102e", "Two-Way": "#b8860b", "Defense": "#2f5b9c",
  "Overall": "#c8102e", "By Danger": "#2f5b9c",
};

// minimal SVG line chart; series = [{label, color, vals:[pct|null]}] aligned to labels
function lineChart(labels, series, legend) {
  const n = labels.length;
  const W = 360, H = 168, padL = 24, padR = 12, padT = 12, padB = 28;
  const iW = W - padL - padR, iH = H - padT - padB;
  const X = (i) => padL + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW);
  const Y = (v) => padT + (1 - v / 100) * iH;

  let s = `<svg viewBox="0 0 ${W} ${H}" class="lc" preserveAspectRatio="xMidYMid meet" role="img">`;
  [0, 50, 100].forEach((g) => {
    const y = Y(g).toFixed(1);
    s += `<line class="lc-grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
    s += `<text class="lc-yl" x="${padL - 5}" y="${(+y + 3).toFixed(1)}">${g}</text>`;
  });
  const step = n > 9 ? 2 : 1;
  labels.forEach((lab, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    s += `<text class="lc-xl" x="${X(i).toFixed(1)}" y="${H - 9}">'${lab.slice(-2)}</text>`;
  });
  series.forEach((ser) => {
    let d = "", pen = false;
    ser.vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? " L" : " M") + X(i).toFixed(1) + " " + Y(v).toFixed(1);
      pen = true;
    });
    if (d) s += `<path class="lc-line" d="${d}" stroke="${ser.color}"/>`;
    ser.vals.forEach((v, i) => {
      if (v == null) return;
      s += `<circle class="lc-dot" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.2" ` +
           `fill="${ser.color}"><title>${labels[i]} - ${ser.label} ${v}</title></circle>`;
    });
  });
  s += `</svg>`;
  if (legend) s += `<div class="lc-legend">` + series.map((ser) =>
    `<span class="lc-key"><i style="background:${ser.color}"></i>${ser.label}</span>`).join("") + `</div>`;
  return s;
}

function renderTrajectory() {
  const entry = currentEntry, sec = el("trajectory");
  const seasons = [...entry.seasons].sort();        // oldest -> newest
  Promise.all(seasons.map(loadSeason)).then(() => {
    if (currentEntry !== entry) return;             // selection moved on
    const isGoalie = current.type === "goalie";
    const groupNames = isGoalie ? ["Overall", "By Danger"] : ["Offense", "Two-Way", "Defense"];
    const rows = [];
    seasons.forEach((s) => {
      const pl = seasonCache[s].players.find((p) => p.id === entry.id);
      const blk = pl && pl.situations[currentSit];
      if (!blk) return;
      rows.push({
        season: s,
        groups: blk.groups,
        ovr: blk.ovr == null ? null : blk.ovr,
      });
    });
    if (rows.length < 2) { sec.classList.add("hidden"); return; }   // need a trend

    const labels = rows.map((r) => r.season);
    const groupSeries = groupNames.map((g) => ({
      label: g, color: GROUP_COLORS[g],
      vals: rows.map((r) => (r.groups[g] ? r.groups[g].pct : null)),
    }));
    el("traj-cap-groups").textContent = isGoalie ? "Group Percentiles" : "Off / Two-Way / Def Percentiles";
    el("traj-sit").textContent = currentSit === "5on5" ? "5-on-5" : "All situations";
    el("chart-groups").innerHTML = lineChart(labels, groupSeries, true);
    el("chart-ovr").innerHTML = lineChart(labels, [{ label: "OVR", color: "#ff8200",
      vals: rows.map((r) => r.ovr) }], false);
    sec.classList.remove("hidden");
  });
}

// season dropdown lists only the seasons this player qualified in
function renderSeasonSelect() {
  const sel = el("season-select");
  sel.innerHTML = "";
  currentEntry.seasons.forEach((s) => {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    if (s === currentSeason) o.selected = true;
    sel.appendChild(o);
  });
  sel.disabled = currentEntry.seasons.length < 2;
  sel.onchange = () => selectPlayer(currentEntry, sel.value);
}

// ---- similar players: Euclidean distance over percentile profiles, same season ----
function similarPlayers(p, sit, n = 3) {
  const dims = (p.type === "goalie" ? IDX.stats_goalie : IDX.stats).filter((s) => !s.neutral);
  const vecOf = (pl) => dims.map((s) => pl.situations[sit].stats[s.key].pct);
  const me = vecOf(p);
  return seasonCache[currentSeason].players
    .filter((o) => o.type === p.type && o.pool === p.pool && o.id !== p.id && o.situations[sit])
    .map((o) => {
      const v = vecOf(o);
      let sum = 0;
      for (let i = 0; i < me.length; i++) { const d = me[i] - v[i]; sum += d * d; }
      return { player: o, dist: Math.sqrt(sum) };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

function renderSimilar(p, sit) {
  el("similar-by").textContent =
    p.type === "goalie" ? "Goalies" : p.pool === "D" ? "Defensemen" : "Forwards";
  const wrap = el("similar-list");
  wrap.innerHTML = "";
  const code = IDX.headshot_seasons[currentSeason];
  similarPlayers(p, sit).forEach(({ player }) => {
    const row = document.createElement("button");
    row.className = "sim-row";
    const img = document.createElement("img");
    img.className = "sim-mug";
    img.onerror = () => { img.onerror = null; img.src = "https://assets.nhle.com/mugs/nhl/default-skater.png"; };
    img.src = `https://assets.nhle.com/mugs/nhl/${code}/${player.team}/${player.id}.png`;
    const name = document.createElement("span");
    name.className = "sim-name";
    name.textContent = player.name;
    const meta = document.createElement("span");
    meta.className = "sim-meta";
    meta.textContent = `${posLabel(player.position)} - ${player.team}`;
    row.append(img, name, meta);
    // jump to that player's card, staying in the season they were compared in
    const season = currentSeason;
    row.onclick = () => selectPlayer(SEARCH.find((e) => e.id === player.id), season);
    wrap.appendChild(row);
  });
}

// ---- search / autocomplete (over the cross-season player index) ----
let activeIdx = -1;
function runSearch() {
  const q = fold(el("search").value.trim());
  const list = el("suggest");
  list.innerHTML = "";
  activeIdx = -1;
  if (!q) return;
  SEARCH.filter((p) => fold(p.name).includes(q)).slice(0, 12).forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${p.name}</span><span class="meta">${posLabel(p.position)} - ${p.team}</span>`;
    li.onclick = () => selectPlayer(p);
    list.appendChild(li);
  });
}
function moveActive(d) {
  const items = [...el("suggest").children];
  if (!items.length) return;
  activeIdx = (activeIdx + d + items.length) % items.length;
  items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
}
el("search").addEventListener("input", runSearch);
el("search").addEventListener("keydown", (e) => {
  const items = [...el("suggest").children];
  if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
  else if (e.key === "Enter") {
    if (activeIdx >= 0 && items[activeIdx]) items[activeIdx].click();
    else if (items[0]) items[0].click();
  } else if (e.key === "Escape") { el("suggest").innerHTML = ""; }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) el("suggest").innerHTML = "";
});

// ---- empty-state "jump to a star" chips ----
const STARTER_NAMES = ["Connor McDavid", "Cale Makar", "Nathan MacKinnon",
                       "Auston Matthews", "Connor Hellebuyck"];
function buildChips() {
  const wrap = el("empty-chips");
  wrap.innerHTML = "";
  STARTER_NAMES.forEach((nm) => {
    const e = SEARCH.find((x) => x.name === nm);
    if (!e) return;
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = e.name;
    chip.onclick = () => selectPlayer(e);
    wrap.appendChild(chip);
  });
}

// ---- boot ----
Promise.all([
  fetch("data/index.json").then((r) => r.json()),
  fetch("data/players_index.json").then((r) => r.json()),
]).then(([idx, search]) => {
  IDX = idx;
  SEARCH = search;
  currentSit = IDX.situations.includes("5on5") ? "5on5" : IDX.situations[0];
  buildChips();
  // deep link from the awards page: index.html?id=<playerId>&season=<label>
  const params = new URLSearchParams(location.search);
  const linkId = params.get("id");
  const entry = linkId && SEARCH.find((e) => e.id === linkId);
  if (entry) selectPlayer(entry, params.get("season"));
  else el("search").focus();
}).catch((e) => { el("empty").textContent = "Failed to load data: " + e; });
