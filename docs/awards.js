// Awards page. Loads the shared index (for seasons + headshot codes) and the
// precomputed awards file, then renders the model's top-5 per trophy for the
// chosen season. Scores/nominees come straight from build_data.py.

let IDX = null;
let AWARDS = null;
let season = null;

const el = (id) => document.getElementById(id);

// same cold->hot percentile scale as the player page
const COLD = [47, 91, 156], MID = [196, 188, 173], HOT = [200, 16, 46];
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

// short labels for the "why" chips; full name stays in the chip tooltip
const WHY_ABBR = {
  "Offense": "Off", "Two-Way": "2Way", "Defense": "Def",
  "Overall": "Ovr", "By Danger": "Dng",
};
const whyLabel = (l) => WHY_ABBR[l] || l;
const DEFAULT_MUG = "https://assets.nhle.com/mugs/nhl/default-skater.png";

function renderSeasonSelect() {
  const sel = el("award-season");
  sel.innerHTML = "";
  IDX.seasons.forEach((s) => {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    if (s === season) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { season = sel.value; renderGrid(); };
}

function nomineeRow(n, rank, code) {
  const row = document.createElement("a");
  row.className = "nominee" + (rank === 1 ? " winner" : "");
  row.href = `index.html?id=${n.id}&season=${season}`;

  const rk = document.createElement("span");
  rk.className = "rank";
  rk.textContent = rank;

  const img = document.createElement("img");
  img.className = "nom-mug";
  img.loading = "lazy";
  img.onerror = () => { img.onerror = null; img.src = DEFAULT_MUG; };
  img.src = `https://assets.nhle.com/mugs/nhl/${code}/${n.team}/${n.id}.png`;
  img.alt = n.name;

  const id = document.createElement("div");
  id.className = "nom-id";
  id.innerHTML = `<span class="nom-name">${n.name}</span>` +
                 `<span class="nom-meta">${posLabel(n.position)} - ${n.team} - ${n.games} GP</span>`;

  const why = document.createElement("div");
  why.className = "nom-why";
  n.why.forEach((w) => {
    const chip = document.createElement("span");
    chip.className = "why-chip";
    chip.title = w.label;
    chip.style.background = pctColor(w.pct);
    chip.innerHTML = `<b>${w.pct}</b><i>${whyLabel(w.label)}</i>`;
    why.appendChild(chip);
  });

  const score = document.createElement("span");
  score.className = "nom-score";
  score.textContent = n.score;

  row.append(rk, img, id, why, score);
  return row;
}

function renderGrid() {
  renderSeasonSelect();
  const grid = el("award-grid");
  grid.innerHTML = "";
  const code = IDX.headshot_seasons[season];
  const data = AWARDS.by_season[season] || {};

  AWARDS.trophies.forEach((t) => {
    const card = document.createElement("section");
    card.className = "trophy";

    const head = document.createElement("div");
    head.className = "trophy-head";
    head.innerHTML = `<h3>${t.name}</h3><span class="trophy-sub">${t.sub}</span>` +
                     `<p class="trophy-desc">${t.desc}</p>`;
    card.appendChild(head);

    const noms = data[t.key];
    if (!noms || !noms.length) {
      const none = document.createElement("p");
      none.className = "trophy-none";
      none.textContent = "Not available for this season.";
      card.appendChild(none);
    } else {
      const list = document.createElement("div");
      list.className = "nominee-list";
      noms.forEach((n, i) => list.appendChild(nomineeRow(n, i + 1, code)));
      card.appendChild(list);
    }
    grid.appendChild(card);
  });
}

// ---- historical winners table (built once; season-independent) ----
// Each trophy's rank-1 nominee for every season, newest first. Reads the same
// awards.json the grid does, so no extra data is needed.
function renderHistory() {
  const table = el("award-history-table");
  const seasons = [...IDX.seasons].sort().reverse();   // newest -> oldest
  const shortName = (t) => t.name.replace(/\s*Trophy$/, "");

  let html = "<thead><tr><th class='ah-season'>Season</th>" +
    AWARDS.trophies.map((t) => `<th title="${t.sub}">${shortName(t)}</th>`).join("") +
    "</tr></thead><tbody>";

  seasons.forEach((s) => {
    const data = AWARDS.by_season[s] || {};
    html += `<tr><th class="ah-season">${s}</th>`;
    AWARDS.trophies.forEach((t) => {
      const w = (data[t.key] || [])[0];
      html += "<td>" + (w
        ? `<a class="ah-win" href="index.html?id=${w.id}&season=${s}">${w.name}` +
          `<span class="ah-team">${w.team}</span></a>`
        : "<span class='ah-none'>&ndash;</span>") + "</td>";
    });
    html += "</tr>";
  });
  table.innerHTML = html + "</tbody>";
}

// ---- boot ----
Promise.all([
  fetch("data/index.json").then((r) => r.json()),
  fetch("data/awards.json").then((r) => r.json()),
]).then(([idx, awards]) => {
  IDX = idx;
  AWARDS = awards;
  season = IDX.seasons.includes(IDX.default_season) ? IDX.default_season : IDX.seasons[0];
  renderGrid();
  renderHistory();
}).catch((e) => {
  el("award-grid").textContent = "Failed to load awards data: " + e;
});
