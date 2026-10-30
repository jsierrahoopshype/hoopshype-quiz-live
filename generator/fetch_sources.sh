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
# list of face-fill headshots that actually exist (the quiz only shows photos it knows are there)
gh api "repos/jsierrahoopshype/nba-headshots/git/trees/HEAD:players/headshots/face-fill-320" --jq '.tree[].path' \
  > sources/nba-headshots/face-fill-320.txt
echo "ok  face-fill-320 list ($(wc -l < sources/nba-headshots/face-fill-320.txt) files)"
