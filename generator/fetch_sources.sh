#!/usr/bin/env bash
# Downloads the public HoopsMatic data files the question builder reads into ./sources/<repo>/<path>.
# Used by the weekly GitHub Action. All repos are public, so no keys are needed.
set -euo pipefail
cd "$(dirname "$0")/.."
get() {  # owner repo path
  mkdir -p "sources/$2/$(dirname "$3")"
  curl -fsSL "https://raw.githubusercontent.com/$1/$2/HEAD/$3" -o "sources/$2/$3"
  echo "ok  $2/$3"
}
get jsierrahoopshype salary-season-finder data_sources/stats.csv
get jsierrahoopshype salary-season-finder data_sources/bio.csv
get jsierrahoopshype salary-season-finder data_sources/awards.csv
get jsierrahoopshype salary-season-finder data_sources/salaries_historical.csv
get aderoa           nba-milestones       data/leaderboards_live.json
get jsierrahoopshype nba-stat-streaks     feats-data.js
get jsierrahoopshype nba-jersey-sales     docs/data/season-rankings.json
get jsierrahoopshype nba-headshots        players/metadata/players_all.json
get jsierrahoopshype nba-sneakers         site/search/players.json
# Nov 2026 formats (generator/more_formats.py)
get jsierrahoopshype nba-career-map       data/players/nba_players_careers.json
get jsierrahoopshype nba-player-data      nba2k.json
get jsierrahoopshype nba-player-data      awardVotes.json
get jsierrahoopshype nba-draft-combine    data/combine.json
get jsierrahoopshype buzzer-beaters       docs/buzzer-beaters.json
get jsierrahoopshype clutch-leaderboard   clutch_splits.csv.gz
get jsierrahoopshype nba-stat-streaks     streaks-data.js
get jsierrahoopshype nba-alt-standings    data/standings.json
get jsierrahoopshype nba-alt-standings    data/vegas_lines_2026-27.json
get jsierrahoopshype nba-attendance       output/arena_baselines_all.csv
get jsierrahoopshype nba-attendance       data/arena_mapping.csv
get jsierrahoopshype nba-gm-survey        data/gm_survey.csv
get jsierrahoopshype nbareferees          data/leaderboards.json
# head-to-head results since 2016-17 (about 80 MB, read once per run)
for y in 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026; do
  get aderoa nba-boxscores data/$y/games.ndjson
  get aderoa nba-boxscores data/$y/boxscores.ndjson
done
# list of face-fill headshots that actually exist (the quiz only shows photos it knows are there)
gh api "repos/jsierrahoopshype/nba-headshots/git/trees/HEAD:players/headshots/face-fill-320" --jq '.tree[].path' \
  > sources/nba-headshots/face-fill-320.txt
echo "ok  face-fill-320 list ($(wc -l < sources/nba-headshots/face-fill-320.txt) files)"
