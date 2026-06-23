#!/usr/bin/env python3
"""Build Hockey Savant data from MoneyPuck's multi-season skater files + goalies.

Inputs: skaters09.csv ... skaters26.csv (suffix = ending year, so 09 = 2008-09)
and goalies.csv (2025-26 only, for now).

Outputs (docs/data/):
  index.json          - seasons list, stat schemas, situations, headshot codes
  players_index.json  - every player de-duplicated across seasons, for search;
                        each carries the seasons they qualified in
  season_<label>.json - full per-season player objects with percentiles

Design (locked during workshop):
  - Percentiles are computed PER SEASON, within position pools (F vs D; goalies
    vs goalies). Qualifier per season: skaters >200 min OR >20 GP; goalies
    >15 GP OR >600 min.
  - Situations exposed: 'all' and '5on5' (toggle).
  - Similar players (computed client-side) stay within one season.
  - Goalies exist only in 2025-26 for now.
"""
import csv
import json
import os

HERE = os.path.dirname(__file__)
OUT_DIR = os.path.join(HERE, "docs", "data")
# Raw MoneyPuck CSVs live here, untracked (too large for git). Drop the
# skaters*.csv / goalies*.csv files into ./data/ before running this script.
DATA_DIR = os.path.join(HERE, "data")
SEASONS = list(range(9, 27))          # 09 (2008-09) .. 26 (2025-26)
GOALIE_SEASONS = set(SEASONS)         # goalies present for every season
SITUATIONS = ["all", "5on5"]

# older MoneyPuck files use dotted tricodes; normalize for NHL logo/mug assets
TEAM_FIX = {"L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "T.B": "TBL"}

# The MoneyPuck CSVs are ASCII and mangle accented names -- some letters are
# dropped outright (Stutzle -> "Sttzle", Lafreniere -> "Lafrenire"), others are
# transliterated (Tomas, Kampf). Restore proper diacritics by playerId (stable
# across seasons). Front-end search folds accents, so these stay ASCII-typable.
NAME_FIX = {
    "8482116": "Tim Stützle",        "8482109": "Alexis Lafrenière",
    "8476881": "Tomáš Hertl",        "8475193": "Tomáš Tatar",
    "8469521": "Tomáš Plekanec",     "8476292": "Ondřej Palát",
    "8480039": "Martin Nečas",       "8480144": "David Kämpf",
    "8477944": "Jakub Vrána",        "8477330": "Dominik Kubalík",
    "8477919": "Frédérick Gaudreau", "8481535": "Nils Höglander",
    "8480843": "Lukáš Dostál",       "8477970": "Vítek Vaněček",
    "8481704": "Juuso Pärssinen",    "8475714": "Calle Järnkrok",
    "8480073": "Erik Brännström",    "8483468": "Jiří Kulich",
    "8465009": "Zdeno Chára",        "8469466": "Aleš Hemský",
    "8460542": "Patrik Eliáš",       "8448208": "Jaromír Jágr",
    "8457981": "Teemu Selänne",      "8473563": "Nicklas Bäckström",
    "8473404": "Niklas Bäckström",   "8470594": "Marc-André Fleury",
    "8477444": "André Burakovsky",   "8476882": "Teuvo Teräväinen",
}


def fix_team(t):
    return TEAM_FIX.get(t, t)


def fix_name(r):
    return NAME_FIX.get(r["playerId"], r["name"])


def season_label(yy):
    end = 2000 + yy
    return f"{end - 1}-{end % 100:02d}"      # 2008-09


def headshot_code(yy):
    end = 2000 + yy
    return f"{end - 1}{end}"                  # 20082009


def num(x):
    try:
        return float(x)
    except (ValueError, TypeError):
        return 0.0


def per60(r, col):
    secs = num(r["icetime"])
    return num(r[col]) / (secs / 3600) if secs > 0 else 0.0


# ------------------------------------------------------------------ skaters --
STATS = [
    {"key": "xg60",   "label": "Expected Goals/60",  "group": "Offense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "I_F_xGoals")},
    {"key": "sa60",   "label": "Shot Attempts/60",   "group": "Offense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "I_F_shotAttempts")},
    {"key": "hdxg60", "label": "High-Danger xG/60",  "group": "Offense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "I_F_highDangerxGoals")},
    {"key": "pts60",  "label": "Points/60",          "group": "Offense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "I_F_points")},
    {"key": "pa60",   "label": "Primary Assists/60", "group": "Offense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "I_F_primaryAssists")},
    {"key": "oixg60", "label": "On-Ice xG For/60",   "group": "Offense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "OnIce_F_xGoals")},
    {"key": "gax",    "label": "Goals Above Expected", "group": "Offense", "fmt": "gax", "low": False,
     "fn": lambda r: num(r["I_F_goals"]) - num(r["I_F_xGoals"])},
    {"key": "corsi",  "label": "Corsi % (CF%)",      "group": "Two-Way", "fmt": "pct", "low": False,
     "fn": lambda r: num(r["onIce_corsiPercentage"]) * 100},
    {"key": "fenwick","label": "Fenwick % (FF%)",    "group": "Two-Way", "fmt": "pct", "low": False,
     "fn": lambda r: num(r["onIce_fenwickPercentage"]) * 100},
    {"key": "relxg",  "label": "Relative xG %",      "group": "Two-Way", "fmt": "pct", "low": False,
     "fn": lambda r: (num(r["onIce_xGoalsPercentage"]) - num(r["offIce_xGoalsPercentage"])) * 100},
    {"key": "netpen", "label": "Net Penalties Drawn", "group": "Two-Way", "fmt": "int", "low": False,
     "fn": lambda r: num(r["penaltiesDrawn"]) - num(r["penalties"])},
    {"key": "xga60",  "label": "xGoals Against/60",  "group": "Defense", "fmt": "rate", "low": True,
     "fn": lambda r: per60(r, "OnIce_A_xGoals")},
    {"key": "blk60",  "label": "Shots Blocked/60",   "group": "Defense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "shotsBlockedByPlayer")},
    {"key": "tk60",   "label": "Takeaways/60",       "group": "Defense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "I_F_takeaways")},
    {"key": "giv60",  "label": "Giveaways/60",       "group": "Defense", "fmt": "rate", "low": True,
     "fn": lambda r: per60(r, "I_F_giveaways")},
    {"key": "hit60",  "label": "Hits/60",            "group": "Defense", "fmt": "rate", "low": False,
     "fn": lambda r: per60(r, "I_F_hits")},
]
SKATER_GROUPS = ["Offense", "Two-Way", "Defense"]


# ------------------------------------------------------------------ goalies --
def save_pct(r):
    og = num(r["ongoal"])
    return (og - num(r["goals"])) / og if og > 0 else 0.0


def danger_sv(r, level):
    shots = num(r[level + "DangerShots"])
    goals = num(r[level + "DangerGoals"])
    return (shots - goals) / shots if shots > 0 else 0.0


def gsax(r):
    return num(r["xGoals"]) - num(r["goals"])


def gsax_per60(r):
    secs = num(r["icetime"])
    return (num(r["xGoals"]) - num(r["goals"])) / (secs / 3600) if secs > 0 else 0.0


def xg_per_shot(r):
    og = num(r["ongoal"])
    return num(r["xGoals"]) / og if og > 0 else 0.0


def rebounds_per_shot(r):
    og = num(r["ongoal"])
    return num(r["rebounds"]) / og if og > 0 else 0.0


STATS_G = [
    {"key": "sv",     "label": "Save %",               "group": "Overall", "fmt": "svp",  "low": False, "fn": save_pct},
    {"key": "gsax60", "label": "xGSA/60",              "group": "Overall", "fmt": "gax2", "low": False, "fn": gsax_per60},
    {"key": "gsax",   "label": "xGSA (total)",         "group": "Overall", "fmt": "gax",  "low": False, "fn": gsax},
    {"key": "rebsh",  "label": "Rebounds/Shot",        "group": "Overall", "fmt": "rate3", "low": True, "fn": rebounds_per_shot},
    {"key": "hdsv",   "label": "High-Danger Save %",   "group": "By Danger", "fmt": "svp", "low": False, "fn": lambda r: danger_sv(r, "high")},
    {"key": "mdsv",   "label": "Medium-Danger Save %", "group": "By Danger", "fmt": "svp", "low": False, "fn": lambda r: danger_sv(r, "medium")},
    {"key": "ldsv",   "label": "Low-Danger Save %",    "group": "By Danger", "fmt": "svp", "low": False, "fn": lambda r: danger_sv(r, "low")},
    {"key": "xgshot", "label": "Shot Quality Faced",   "group": "Workload", "fmt": "rate3", "low": False, "neutral": True, "fn": xg_per_shot},
    {"key": "sf60",   "label": "Shots Faced/60",       "group": "Workload", "fmt": "rate",  "low": False, "neutral": True, "fn": lambda r: per60(r, "ongoal")},
]
GOALIE_GROUPS = ["Overall", "By Danger", "Workload"]


def midrank_percentile(val, sorted_vals):
    n = len(sorted_vals)
    if n == 0:
        return None
    below = sum(1 for v in sorted_vals if v < val)
    equal = sum(1 for v in sorted_vals if v == val)
    return round(100 * (below + equal / 2) / n)


def group_members(stats):
    """Ordered {group: [stats]} for composites: skill stats only (drop neutral)."""
    groups = {}
    for s in stats:
        if s.get("neutral"):
            continue
        groups.setdefault(s["group"], []).append(s)
    return groups


# ------------------------------------------------------------------- awards --
# Each trophy is scored from the per-season group percentiles already computed
# (the 'all' situation). Weights are deliberately simple and easy to tweak.
#
# Awards demand a real body of work: a player needs at least this many games to
# be eligible for any trophy, on top of the looser per-season qualifier that
# gates the rest of the site.
AWARD_MIN_GP = 25
TROPHIES = [
    {"key": "hart",     "name": "Hart Trophy",     "sub": "",
     "desc": "The player judged to be the most valuable to his team."},
    {"key": "norris",   "name": "Norris Trophy",   "sub": "",
     "desc": "The defenseman who demonstrates the greatest all-round ability in the position."},
    {"key": "calder",   "name": "Calder Trophy",   "sub": "",
     "desc": "The player selected as the most proficient in his first year of competition in the NHL."},
    {"key": "vezina",   "name": "Vezina Trophy",   "sub": "",
     "desc": "The goalkeeper adjudged to be the best at this position."},
    {"key": "selke",    "name": "Selke Trophy",    "sub": "",
     "desc": "The forward who best excels in the defensive aspects of the game."},
]

# Trophies reward a full body of work, not a small elite sample. Each award score
# blends skill with a workload percentile so a part-timer with great rates can't
# out-rank a full-season driver. The same 0.3 weight is used on the leaderboard.
# Workload is per-game ice time (min/GP) for skaters -- how heavily a coach leans
# on them -- but TOTAL ice time for goalies, whose min/GP sits near 60 for everyone
# and so can't separate a workhorse starter from a backup.
LOAD_W = 0.36


def _g(p, name):
    return p["situations"]["all"]["groups"].get(name, {}).get("pct", 0)


# 5-on-5 group percentile. Selke leans on this so PK specialists aren't dragged
# down by all-situations defensive rates that bake in heavy shorthanded exposure.
def _g5(p, name):
    sit = p["situations"].get("5on5") or p["situations"]["all"]
    return sit["groups"].get(name, {}).get("pct", 0)


# cross-positional ("open") percentiles: skaters ranked F+D together, so a
# defenseman's offense is measured against forwards too. Used by mixed-pool
# awards (Hart, skater Calder). Falls back to within-pool if absent.
def _og(p, name):
    return p.get("_open", {}).get("groups", {}).get(name, {}).get("pct", _g(p, name))


def _gw(p, *names):
    return [{"label": n, "pct": _g(p, n)} for n in names]


def _g5w(p, *names):
    return [{"label": n, "pct": _g5(p, n)} for n in names]


def _ogw(p, *names):
    return [{"label": n, "pct": _og(p, n)} for n in names]


def _skater_overall_open(p):
    return 0.60 * _og(p, "Offense") + 0.30 * _og(p, "Two-Way") + 0.10 * _og(p, "Defense")


def _goalie_overall(p):
    return 0.60 * _g(p, "Overall") + 0.40 * _g(p, "By Danger")


def _load_ranker(pool):
    """fn(p) -> workload percentile within `pool`, on per-game ice time (min/GP),
    a usage signal. (Goalie workload is a full-season share instead -- see
    _goalie_load.)
    """
    metric = lambda x: x["toi_min"] / x["games"] if x.get("games") else 0
    vals = sorted(metric(x) for x in pool)
    return lambda p: midrank_percentile(metric(p), vals) or 0


# Goalie workload as a share of a full 82-game season rather than a rank against
# the busiest netminder (who tops out around 65 GP). A 64-game starter then reads
# ~78%, not a relative 100%, putting goalies on the same full-season footing the
# rest of the workload math assumes. Every goalie plays ~60 min/GP, so games --
# how much of the season they carried -- is the honest workload signal.
GOALIE_BASELINE_GP = 72
def _goalie_load(p):
    return min(100.0, p["games"] / GOALIE_BASELINE_GP * 100)


def _blend(skill, load):
    return skill * (1 - LOAD_W) + load * LOAD_W


def _top5(cands, score_fn, why_fn):
    scored = sorted(((score_fn(p), p) for p in cands), key=lambda t: (-t[0], t[1]["name"]))
    out = []
    for sc, p in scored[:5]:
        out.append({"id": p["id"], "name": p["name"], "team": p["team"],
                    "position": p["position"], "type": p["type"],
                    "games": p["games"], "score": round(sc, 1), "why": why_fn(p)})
    return out


def compute_awards(players, rookie_ids, allow_calder):
    # trophies require a full body of work; drop anyone short of the game minimum
    # before scoring so they neither place nor skew the workload percentiles
    players = [p for p in players if p["games"] >= AWARD_MIN_GP]
    skaters = [p for p in players if p["type"] == "skater"]
    forwards = [p for p in skaters if p["pool"] == "F"]
    dmen = [p for p in skaters if p["pool"] == "D"]
    goalies = [p for p in players if p["type"] == "goalie"]
    # workload: skaters on a min/GP usage percentile within their pool; goalies on
    # their share of a full 82-game season (see _goalie_load)
    load_sk = _load_ranker(skaters)
    load_f = _load_ranker(forwards)
    load_d = _load_ranker(dmen)
    load_g = _goalie_load

    # Hart = MVP across the whole league. Each player is scored on their own role
    # rather than one offense-led formula: forwards offense-led, defensemen
    # Norris-style (two-way/defense), goalies Vezina-style. Skaters are measured on
    # cross-positional ("open") percentiles -- a defenseman's value sits on the same
    # all-skater scale as a forward's, an honest apples-to-apples comparison. We do
    # NOT bump D onto a within-pool scale to manufacture appearances: if forwards
    # genuinely out-value them by this measure, the award should say so, and in
    # practice elite D land just below the forward/goalie cutoff. Workload is ranked
    # inside each player's own pool, so a #1-usage forward, defenseman and goalie all
    # earn full marks. Folding goalies in is inherently rough (save value and goal
    # value share no common unit), so a dominant netminder can top the race.
    def hart_value(p):
        if p["type"] == "goalie":
            return _blend(_goalie_overall(p), load_g(p))
        if p["pool"] == "D":
            return _blend(0.30 * _g(p, "Offense") + 0.40 * _g(p, "Two-Way")
                          + 0.30 * _g(p, "Defense"), load_d(p))
        return _blend(0.70 * _g(p, "Offense") + 0.25 * _g(p, "Two-Way")
                      + 0.05 * _og(p, "Defense"), load_f(p))

    def hart_why(p):
        return (_gw(p, "Overall", "By Danger") if p["type"] == "goalie"
                else _ogw(p, "Offense", "Two-Way", "Defense"))

    awards = {
        "hart": _top5(players, hart_value, hart_why),
        "norris": _top5(dmen,
            lambda p: _blend(0.34 * _g(p, "Two-Way") + 0.33 * _g(p, "Offense")
                             + 0.33 * _g(p, "Defense"), load_d(p)),
            lambda p: _gw(p, "Two-Way", "Offense", "Defense")),
        "vezina": _top5(goalies,
            lambda p: _blend(_goalie_overall(p), load_g(p)),
            lambda p: _gw(p, "Overall", "By Danger")),
        # Selke is scored on 5-on-5 so penalty-kill workhorses aren't punished
        # by the inflated against-rates that all-situations play bakes in.
        "selke": _top5(forwards,
            lambda p: _blend(0.45 * _g5(p, "Defense") + 0.45 * _g5(p, "Two-Way")
                             + 0.10 * _g5(p, "Offense"), load_f(p)),
            lambda p: _g5w(p, "Defense", "Two-Way", "Offense")),
    }
    if allow_calder:
        # skater rookies ranked among all skaters (open), goalie rookies among all
        # goalies. Workload mirrors the other awards: skater rookies on min/GP,
        # goalie rookies on total ice time -- both pool percentiles, so a full-load
        # rookie skater and a workhorse rookie goalie come out comparable.
        rookies = [p for p in players if p["id"] in rookie_ids]
        awards["calder"] = _top5(rookies,
            lambda p: _blend(_goalie_overall(p) if p["type"] == "goalie"
                             else _skater_overall_open(p),
                             load_g(p) if p["type"] == "goalie" else load_sk(p)),
            lambda p: _gw(p, "Overall", "By Danger") if p["type"] == "goalie"
                      else _ogw(p, "Offense", "Two-Way", "Defense"))
    return awards


# Player OVR: the same trophy-weighted skill composite the awards use (Hart for
# forwards, Norris for D, Vezina for goalies), blended 65/35 with workload, then
# re-ranked into a percentile within the pool. Precomputed per situation here so
# the leaderboard and the player-card trajectory charts read one shared number.
OVR_WEIGHTS = {
    "F": {"Offense": 0.70, "Two-Way": 0.22, "Defense": 0.08},
    "D": {"Offense": 0.30, "Two-Way": 0.40, "Defense": 0.30},
    "G": {"Overall": 0.60, "By Danger": 0.40},
}


def _ovr_skill(p, sit, weights):
    groups = p["situations"][sit]["groups"]
    s = w = 0.0
    for g, wt in weights.items():
        cell = groups.get(g)
        if not cell or cell.get("pct") is None:
            continue
        s += cell["pct"] * wt
        w += wt
    return s / w if w else None


def add_ovr(players):
    """Annotate each player's situation blocks with an 'ovr' percentile."""
    pools = {}
    for p in players:
        pools.setdefault(p["pool"], []).append(p)
    for pool, plist in pools.items():
        weights = OVR_WEIGHTS[pool]
        # skater workload is a within-pool min/GP percentile; goalie workload is a
        # share of a full 82-game season (see _goalie_load)
        if pool == "G":
            load_pct = _goalie_load
        else:
            metric = lambda x: x["toi_min"] / x["games"] if x["games"] else 0
            load_vals = sorted(metric(p) for p in plist)
            load_pct = lambda p: midrank_percentile(metric(p), load_vals) or 0
        for sit in SITUATIONS:
            raws = {}
            for p in plist:
                if sit not in p["situations"]:
                    continue
                skill = _ovr_skill(p, sit, weights)
                if skill is None:
                    continue
                load = load_pct(p)
                raws[p["id"]] = skill * (1 - LOAD_W) + load * LOAD_W
            ranked = sorted(raws.values())
            for p in plist:
                if p["id"] in raws:
                    p["situations"][sit]["ovr"] = midrank_percentile(raws[p["id"]], ranked)


def rank_pool(present, stats, groups, pool_key):
    """Rank players within pools defined by pool_key(r).

    present: {pid: (r, vals)} where vals maps stat key -> raw value.
    Returns {pid: {"stats": {...}, "groups": {...}}} with each stat's percentile
    and each group's composite (weighted mean of member percentiles, re-ranked
    within the same pool). Pass a constant pool_key for a cross-positional rank.
    """
    pools = {}
    for pid, (r, vals) in present.items():
        d = pools.setdefault(pool_key(r), {s["key"]: [] for s in stats})
        for s in stats:
            d[s["key"]].append(vals[s["key"]])
    sorted_pool = {pk: {k: sorted(vs) for k, vs in d.items()} for pk, d in pools.items()}

    # pass 1: per-stat percentiles + each player's raw group score, pooled for re-rank
    stat_outs, raw_groups, group_pool = {}, {}, {}
    for pid, (r, vals) in present.items():
        pk = pool_key(r)
        stat_out = {}
        for s in stats:
            v = vals[s["key"]]
            pct = midrank_percentile(v, sorted_pool[pk][s["key"]])
            if s.get("low") and pct is not None:
                pct = 100 - pct
            stat_out[s["key"]] = {"value": round(v, 3), "pct": pct}
        stat_outs[pid] = stat_out
        gscores = {}
        for g, members in groups.items():
            wsum = sum(m.get("weight", 1) for m in members)
            avg = sum(stat_out[m["key"]]["pct"] * m.get("weight", 1)
                      for m in members) / wsum
            gscores[g] = avg
            group_pool.setdefault(pk, {}).setdefault(g, []).append(avg)
        raw_groups[pid] = gscores
    sorted_gpool = {pk: {g: sorted(vs) for g, vs in d.items()}
                    for pk, d in group_pool.items()}

    # pass 2: re-rank each raw group score within its pool -> group percentile
    out = {}
    for pid, (r, vals) in present.items():
        pk = pool_key(r)
        groups_out = {g: {"avg": round(avg, 1),
                          "pct": midrank_percentile(avg, sorted_gpool[pk][g])}
                      for g, avg in raw_groups[pid].items()}
        out[pid] = {"stats": stat_outs[pid], "groups": groups_out}
    return out


def build_players(csv_path, stats, pool_fn, qualifier_fn, seed_fn, open_pool_fn=None):
    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    all_rows = {r["playerId"]: r for r in rows if r["situation"] == "all"}
    qualified = {pid for pid, r in all_rows.items() if qualifier_fn(r)}
    by_ps = {(r["playerId"], r["situation"]): r for r in rows}
    groups = group_members(stats)

    players = {}
    for pid in qualified:
        p = seed_fn(all_rows[pid])
        p["situations"] = {}
        players[pid] = p

    for sit in SITUATIONS:
        present = {}
        for pid in qualified:
            r = by_ps.get((pid, sit))
            if r is None:
                continue
            present[pid] = (r, {s["key"]: s["fn"](r) for s in stats})

        ranked = rank_pool(present, stats, groups, pool_fn)
        for pid, (r, vals) in present.items():
            players[pid]["situations"][sit] = {
                "toi_min": round(num(r["icetime"]) / 60, 1),
                "stats": ranked[pid]["stats"],
                "groups": ranked[pid]["groups"],
            }
        # cross-positional ("open") rank, 'all' only, used by mixed-pool awards.
        # Stashed under _open and stripped before season files are written.
        if open_pool_fn and sit == "all":
            open_ranked = rank_pool(present, stats, groups, open_pool_fn)
            for pid in present:
                players[pid]["_open"] = open_ranked[pid]
    return list(players.values())


def seed_skater(r):
    return {
        "id": r["playerId"], "name": fix_name(r), "team": fix_team(r["team"]),
        "position": r["position"], "type": "skater",
        "pool": "D" if r["position"] == "D" else "F",
        "games": int(num(r["games_played"])),
        "toi_min": round(num(r["icetime"]) / 60),
        "goals": int(num(r["I_F_goals"])),
        "assists": int(num(r["I_F_primaryAssists"]) + num(r["I_F_secondaryAssists"])),
        "points": int(num(r["I_F_points"])),
    }


def seed_goalie(r):
    secs = num(r["icetime"])
    return {
        "id": r["playerId"], "name": fix_name(r), "team": fix_team(r["team"]),
        "position": "G", "type": "goalie", "pool": "G",
        "games": int(num(r["games_played"])),
        "toi_min": round(secs / 60),
        "gaa": round(num(r["goals"]) / (secs / 3600), 2) if secs > 0 else 0,
        "svp": round(save_pct(r), 3),
    }


def meta_stats(stats):
    return [{"key": s["key"], "label": s["label"], "group": s["group"],
             "fmt": s["fmt"], "low": s["low"], "neutral": s.get("neutral", False)}
            for s in stats]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    seasons_desc, headshot_seasons = [], {}
    index_entries = {}   # playerId -> search entry (most recent wins for name/team)
    awards_by_season = {}
    seen_ids = set()     # ascending pass -> first appearance = rookie (Calder proxy)

    for yy in SEASONS:
        label = season_label(yy)
        skaters = build_players(
            os.path.join(DATA_DIR, f"skaters{yy:02d}.csv"), STATS,
            pool_fn=lambda r: "D" if r["position"] == "D" else "F",
            qualifier_fn=lambda r: num(r["icetime"]) / 60 > 200 or num(r["games_played"]) > 20,
            seed_fn=seed_skater,
            open_pool_fn=lambda r: "S")     # all skaters together, for mixed-pool awards
        players = skaters
        if yy in GOALIE_SEASONS:
            players = players + build_players(
                os.path.join(DATA_DIR, f"goalies{yy:02d}.csv"), STATS_G,
                pool_fn=lambda r: "G",
                qualifier_fn=lambda r: num(r["games_played"]) > 15 or num(r["icetime"]) / 60 > 600,
                seed_fn=seed_goalie)

        players.sort(key=lambda p: p["name"])
        add_ovr(players)                # stamp each situation block with an OVR percentile
        rookie_ids = {p["id"] for p in players if p["id"] not in seen_ids}
        awards_by_season[label] = compute_awards(
            players, rookie_ids, allow_calder=(yy != SEASONS[0]))
        seen_ids.update(p["id"] for p in players)

        for p in players:               # _open is awards-only; keep season files lean
            p.pop("_open", None)
        with open(os.path.join(OUT_DIR, f"season_{label}.json"), "w") as f:
            json.dump({"season": label, "players": players}, f, separators=(",", ":"))

        headshot_seasons[label] = headshot_code(yy)
        seasons_desc.append(label)
        for p in players:                       # ascending years -> latest overwrites
            e = index_entries.setdefault(p["id"], {
                "id": p["id"], "name": p["name"], "position": p["position"],
                "team": p["team"], "type": p["type"], "seasons": []})
            e["name"], e["position"], e["team"], e["type"] = \
                p["name"], p["position"], p["team"], p["type"]
            e["seasons"].append(label)

    seasons_desc = list(reversed(seasons_desc))
    for e in index_entries.values():            # latest season first for the dropdown
        e["seasons"] = sorted(e["seasons"], reverse=True)
    index_list = sorted(index_entries.values(), key=lambda e: e["name"])

    with open(os.path.join(OUT_DIR, "index.json"), "w") as f:
        json.dump({
            "seasons": seasons_desc,
            "default_season": "2025-26",
            "situations": SITUATIONS,
            "headshot_seasons": headshot_seasons,
            "stats": meta_stats(STATS), "groups": SKATER_GROUPS,
            "stats_goalie": meta_stats(STATS_G), "groups_goalie": GOALIE_GROUPS,
        }, f, separators=(",", ":"))
    with open(os.path.join(OUT_DIR, "players_index.json"), "w") as f:
        json.dump(index_list, f, separators=(",", ":"))
    with open(os.path.join(OUT_DIR, "awards.json"), "w") as f:
        json.dump({"trophies": TROPHIES, "by_season": awards_by_season},
                  f, separators=(",", ":"))

    print(f"Seasons: {len(seasons_desc)} ({seasons_desc[-1]} .. {seasons_desc[0]})")
    print(f"Unique players (search index): {len(index_list)}")


if __name__ == "__main__":
    main()
