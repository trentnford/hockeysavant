// Glossary page. The conceptual prose is static in glossary.html; the stat tables
// are rendered here from index.json so the list, labels and direction flags stay
// in sync with build_data.py. Plain-language descriptions live in DESC, keyed by
// stat key (falling back to the label if one is ever missing).

const DESC = {
  // skater
  xg60: "Shot quality the player generates on their own, per 60 minutes — the summed scoring probability of their unblocked attempts.",
  sa60: "Individual shot attempts (Corsi) per 60 — how much volume they throw at the net.",
  hdxg60: "Expected goals from high-danger areas (the slot and inner zone) per 60 — premium chances.",
  pts60: "Goals plus assists per 60 of ice time, so pace isn't rewarded for sheer minutes.",
  pa60: "First assists per 60 — the pass that directly sets up a goal, a more repeatable playmaking signal than secondary assists.",
  oixg60: "Expected goals the player's team generates while they're on the ice, per 60 — on-ice offensive drive.",
  gax: "Actual goals minus expected goals — finishing skill above the quality of the chances taken.",
  corsi: "Share of on-ice shot attempts that belong to the player's team — territorial and possession tilt.",
  fenwick: "Like Corsi, but counting unblocked attempts only.",
  relxg: "The team's expected-goals share with the player on the ice minus with them off — isolates their impact from teammates.",
  netpen: "Penalties drawn minus penalties taken — net special-teams value through discipline and drawing fouls.",
  xga60: "Expected goals the team allows with the player on the ice, per 60. Best read as team defense; it rewards sheltered usage.",
  blk60: "Opponent shots the player blocks per 60.",
  tk60: "Times the player takes the puck off an opponent per 60.",
  giv60: "Turnovers the player commits per 60.",
  hit60: "Hits thrown per 60 — physical engagement, a style marker more than a value one.",
  // goalie
  sv: "Share of shots on goal stopped.",
  gsax60: "Goals saved above expected per 60 — shots stopped beyond what their quality predicted. The core goaltending skill metric.",
  gsax: "The same as xGSA/60, expressed as a full-season total.",
  rebsh: "Rebounds allowed per shot faced — rebound control.",
  hdsv: "Save percentage on high-danger shots.",
  mdsv: "Save percentage on medium-danger shots.",
  ldsv: "Save percentage on low-danger shots.",
  xgshot: "Average expected goals per shot faced — how hard the workload was. Context, neither good nor bad.",
  sf60: "Shots on goal faced per 60 — workload volume. Context.",
};

function dirCell(s) {
  if (s.neutral) return '<b class="dir ctx" title="context">&ndash;</b>';
  if (s.low) return '<b class="dir down" title="lower is better">&darr;</b>';
  return '<b class="dir up" title="higher is better">&uarr;</b>';
}

function renderTable(elId, stats, groups) {
  const wrap = document.getElementById(elId);
  wrap.innerHTML = "";
  const table = document.createElement("table");
  groups.forEach((g) => {
    const inGroup = stats.filter((s) => s.group === g);
    if (!inGroup.length) return;
    const gh = document.createElement("tr");
    gh.className = "gloss-grouprow";
    gh.innerHTML = `<th colspan="3">${g}</th>`;
    table.appendChild(gh);
    inGroup.forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="g-stat">${s.label}</td>` +
        `<td class="g-dir">${dirCell(s)}</td>` +
        `<td class="g-desc">${DESC[s.key] || s.label}</td>`;
      table.appendChild(tr);
    });
  });
  wrap.appendChild(table);
}

fetch("data/index.json").then((r) => r.json()).then((idx) => {
  renderTable("gloss-skaters", idx.stats, idx.groups);
  renderTable("gloss-goalies", idx.stats_goalie, idx.groups_goalie);
}).catch((e) => {
  document.getElementById("gloss-skaters").textContent = "Failed to load data: " + e;
});
