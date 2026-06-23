# Raw data (not committed)

`build_data.py` reads its source CSVs from this folder. They are **deliberately
kept out of git** (see `.gitignore`) because they're large build inputs, not part
of the published site — the site only needs the generated JSON in `docs/data/`.

Before running `python3 build_data.py`, place these MoneyPuck CSVs here:

- `skaters09.csv` … `skaters26.csv`  (suffix = ending year; 09 = 2008-09)
- `goalies09.csv` … `goalies26.csv`

Source: MoneyPuck per-season player summaries (https://moneypuck.com/data.htm).
