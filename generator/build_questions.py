#!/usr/bin/env python3
"""
HoopsHype NBA Quiz Live - question bank builder.

Reads public HoopsMatic data repos (laid out as <src>/<repo>/<path>) and writes
data/questions.json for the live quiz page.

Usage:
  python generator/build_questions.py --src sources --out data/questions.json

The GitHub Action (.github/workflows/rebuild-questions.yml) downloads the same
files from raw.githubusercontent.com into sources/ and runs this weekly, so
career totals and salaries stay current without anyone touching it.

Nothing here reads the HoopsHype rumors archive.
"""
import argparse, csv, json, random, re, unicodedata, collections, os, sys, hashlib

# ---------------------------------------------------------------- inputs
SOURCES = {
    "stats":    "salary-season-finder/data_sources/stats.csv",
    "bio":      "salary-season-finder/data_sources/bio.csv",
    "awards":   "salary-season-finder/data_sources/awards.csv",
    "salaries": "salary-season-finder/data_sources/salaries_historical.csv",
    "leaders":  "nba-milestones/data/leaderboards_live.json",
    "feats":    "nba-stat-streaks/feats-data.js",
    "jersey":   "nba-jersey-sales/docs/data/season-rankings.json",
    "heads":    "nba-headshots/players/metadata/players_all.json",
    "facefill": "nba-headshots/face-fill-320.txt",   # file list, written by the fetch step
    "sneakers": "nba-sneakers/site/search/players.json",
}

CURRENT_END_YEAR = 2027   # 2026-27 season; partial season excluded from "season line" questions
STAT_ORDER = ["PTS", "REB", "AST", "STL", "BLK", "3PM"]   # 3-pointers always last

# ---------------------------------------------------------------- helpers
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " "))
    return re.sub(r"\s+", " ", s).strip()

def season(y):
    """End year -> '2015-16'."""
    y = int(y)
    return f"{y-1}-{str(y)[2:]}"

def money(v):
    if v >= 1_000_000:
        m = v / 1_000_000
        return f"${m:.1f}M" if m < 100 else f"${m:.0f}M"
    return f"${v/1000:.0f}K"

def num(v):
    return f"{int(round(v)):,}"

def to_int(x):
    try:
        return int(float(str(x).replace(",", "").replace("$", "")))
    except Exception:
        return None

def to_float(x):
    try:
        return float(str(x).replace(",", ""))
    except Exception:
        return None

def height_in(h):
    m = re.match(r"(\d+)-(\d+)", h or "")
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None

# Franchise code + season end year -> name at the time
def team_name(code, y):
    y = int(y)
    hist = {
        "OKC": [(2008, "Seattle SuperSonics"), (9999, "Oklahoma City Thunder")],
        "BKN": [(1977, "New York Nets"), (2012, "New Jersey Nets"), (9999, "Brooklyn Nets")],
        "NOP": [(2013, "New Orleans Hornets"), (9999, "New Orleans Pelicans")],
        "CHA": [(2002, "Charlotte Hornets"), (2004, None), (2014, "Charlotte Bobcats"), (9999, "Charlotte Hornets")],
        "MEM": [(2001, "Vancouver Grizzlies"), (9999, "Memphis Grizzlies")],
        "WAS": [(1973, "Baltimore Bullets"), (1974, "Capital Bullets"), (1997, "Washington Bullets"), (9999, "Washington Wizards")],
        "SAC": [(1957, "Rochester Royals"), (1972, "Cincinnati Royals"), (1985, "Kansas City Kings"), (9999, "Sacramento Kings")],
        "LAC": [(1978, "Buffalo Braves"), (1984, "San Diego Clippers"), (9999, "LA Clippers")],
        "UTA": [(1979, "New Orleans Jazz"), (9999, "Utah Jazz")],
        "GSW": [(1962, "Philadelphia Warriors"), (1971, "San Francisco Warriors"), (9999, "Golden State Warriors")],
        "HOU": [(1971, "San Diego Rockets"), (9999, "Houston Rockets")],
        "ATL": [(1951, "Tri-Cities Blackhawks"), (1955, "Milwaukee Hawks"), (1968, "St. Louis Hawks"), (9999, "Atlanta Hawks")],
        "DET": [(1957, "Fort Wayne Pistons"), (9999, "Detroit Pistons")],
        "LAL": [(1960, "Minneapolis Lakers"), (9999, "Los Angeles Lakers")],
        "PHI": [(1963, "Syracuse Nationals"), (9999, "Philadelphia 76ers")],
        "CHI": [(9999, "Chicago Bulls")],
    }
    fixed = {
        "BOS": "Boston Celtics", "NYK": "New York Knicks", "MIL": "Milwaukee Bucks", "CLE": "Cleveland Cavaliers",
        "PHX": "Phoenix Suns", "POR": "Portland Trail Blazers", "IND": "Indiana Pacers", "SAS": "San Antonio Spurs",
        "DEN": "Denver Nuggets", "DAL": "Dallas Mavericks", "MIN": "Minnesota Timberwolves", "ORL": "Orlando Magic",
        "MIA": "Miami Heat", "TOR": "Toronto Raptors", "BAL": "Baltimore Bullets", "WSC": "Washington Capitols",
        "CHS": "Chicago Stags", "STB": "St. Louis Bombers", "PRO": "Providence Steamrollers", "INO": "Indianapolis Olympians",
        "PIT": "Pittsburgh Ironmen", "TOH": "Toronto Huskies", "CLR": "Cleveland Rebels", "SHE": "Sheboygan Red Skins",
        "AND": "Anderson Packers", "DTF": "Detroit Falcons", "DNN": "Denver Nuggets",
    }
    if code in hist:
        for until, name in hist[code]:
            if y <= until:
                return name
    return fixed.get(code)

# Current-franchise nickname for short labels
NICK = {"ATL":"Hawks","BOS":"Celtics","BKN":"Nets","CHA":"Hornets","CHI":"Bulls","CLE":"Cavaliers","DAL":"Mavericks",
        "DEN":"Nuggets","DET":"Pistons","GSW":"Warriors","HOU":"Rockets","IND":"Pacers","LAC":"Clippers","LAL":"Lakers",
        "MEM":"Grizzlies","MIA":"Heat","MIL":"Bucks","MIN":"Timberwolves","NOP":"Pelicans","NYK":"Knicks","OKC":"Thunder",
        "ORL":"Magic","PHI":"76ers","PHX":"Suns","POR":"Trail Blazers","SAC":"Kings","SAS":"Spurs","TOR":"Raptors",
        "UTA":"Jazz","WAS":"Wizards"}
NBA30 = sorted(NICK)

# ---------------------------------------------------------------- load
def load(src):
    P = {}
    def path(k):
        return os.path.join(src, SOURCES[k])

    players = collections.defaultdict(lambda: {"seasons": [], "awards": [], "salary": {}, "bio": {}})

    # season stat lines (one row per player-team-season, no TOT rows)
    with open(path("stats"), newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        head = next(r)
        ix = {h: i for i, h in enumerate(head) if h not in ("FG%", "3P%", "FT%") or h not in {}}
        for row in r:
            if len(row) < 26:
                continue
            name, yr, team = row[3].strip(), to_int(row[4]), row[5].strip()
            if not name or not yr or not re.fullmatch(r"[A-Z]{3}", team):
                continue
            gp = to_int(row[6]) or 0
            s = {
                "y": yr, "team": team, "gp": gp,
                "PTS": to_int(row[8]) or 0, "REB": to_int(row[20]) or 0, "AST": to_int(row[21]) or 0,
                "STL": to_int(row[22]) or 0, "BLK": to_int(row[23]) or 0, "3PM": to_int(row[12]) or 0,
                "fga": to_int(row[10]) or 0,
            }
            players[name]["seasons"].append(s)

    with open(path("bio"), newline="", encoding="utf-8") as f:
        for b in csv.DictReader(f):
            n = b["PLAYER"].strip()
            if n:
                players[n]["bio"] = b

    with open(path("awards"), newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            if len(row) < 7:
                continue
            award, yr, name = row[2].strip(), to_int(row[3]), row[5].strip()
            if award and yr and name:
                players[name]["awards"].append((award, yr, row[6].strip()))

    with open(path("salaries"), newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            if len(row) < 4:
                continue
            team, yr, name, sal = row[0].strip(), to_int(row[1]), row[2].strip(), to_int(row[3])
            if name and yr and sal and sal > 0:
                d = players[name]["salary"]
                d[yr] = d.get(yr, 0) + sal

    P["players"] = players
    P["leaders"] = json.load(open(path("leaders"), encoding="utf-8"))

    s = open(path("feats"), encoding="utf-8").read()
    dec = json.JSONDecoder()
    blobs = {}
    for m in re.finditer(r"window\.(\w+)\s*=\s*", s):
        obj, _ = dec.raw_decode(s, m.end())
        blobs[m.group(1)] = obj
    P["feats"] = blobs

    P["jersey"] = json.load(open(path("jersey"), encoding="utf-8"))

    heads = json.load(open(path("heads"), encoding="utf-8"))["players"]
    files = set()
    if os.path.exists(path("facefill")):
        files = {l.strip() for l in open(path("facefill"), encoding="utf-8") if l.strip()}
    img = {}
    for h in (heads if isinstance(heads, list) else heads.values()):
        fn = (h.get("headshot") or {}).get("filename") or ""
        stem = fn.rsplit(".", 1)[0]
        if stem and f"{stem}.webp" in files:
            img[norm(h["full_name"])] = f"{stem}.webp"
    P["img"] = img
    return P

# ---------------------------------------------------------------- player model
class Player:
    def __init__(self, name, raw):
        self.name = name
        self.key = norm(name)
        self.seasons = sorted(raw["seasons"], key=lambda s: (s["y"], s["team"]))
        self.awards = raw["awards"]
        self.salary = raw["salary"]
        self.bio = raw["bio"]
        self.tot = collections.Counter()
        for s in self.seasons:
            for k in STAT_ORDER + ["gp"]:
                self.tot[k] += s[k]
        self.aw = collections.Counter(a for a, _, _ in self.awards)
        self.allstar = self.aw["All-Star"]
        self.mvp = self.aw["Most Valuable Player"]
        self.rings = self.aw["NBA Champion"]
        self.first = self.seasons[0]["y"] if self.seasons else None
        self.last = self.seasons[-1]["y"] if self.seasons else None
        self.active = self.last == CURRENT_END_YEAR
        # fame drives difficulty and who gets asked about at all
        self.fame = (self.allstar * 3 + self.mvp * 8 + self.aw["Hall of Fame"] * 6 + self.aw["NBA Top-75"] * 6
                     + self.tot["PTS"] / 2500 + self.aw["All-NBA First Team"] * 2 + self.aw["Rookie of the Year"] * 2
                     + (3 if self.active and self.tot["PTS"] > 6000 else 0))
        self.img = None

    def teams_path(self):
        """Ordered list of (team_name_at_time, from_year, to_year), collapsing consecutive seasons."""
        out = []
        for s in self.seasons:
            nm = team_name(s["team"], s["y"])
            if not nm:
                continue
            if out and out[-1][0] == nm and s["y"] - out[-1][2] <= 1:
                out[-1][2] = s["y"]
            elif out and out[-1][0] == nm and s["y"] == out[-1][2]:
                continue
            else:
                out.append([nm, s["y"], s["y"]])
        # drop exact duplicate stints from mid-season trades listed in odd order
        return out

    def franchises(self):
        return {s["team"] for s in self.seasons}

    @property
    def difficulty(self):
        levels = ["easy", "medium", "hard"]
        i = 0 if self.fame >= 30 else 1 if self.fame >= 12 else 2
        # a TikTok crowd skews young: pre-1995 careers are a level harder unless the player is an icon
        if (self.last or 0) < 1995 and self.fame < 60:
            i = min(2, i + 1)
        return levels[i]

def build_players(P):
    out = {}
    for name, raw in P["players"].items():
        if not raw["seasons"]:
            continue
        p = Player(name, raw)
        p.img = P["img"].get(p.key)
        out[name] = p
    return out

# Names chat can type for a player
def accept_names(p, all_players):
    acc = {p.key}
    parts = p.key.split()
    if len(parts) >= 2:
        last = parts[-1]
        first = parts[0]
        famous = [q for q in all_players.values() if q.fame >= 6 and q.key != p.key]
        if len(last) >= 4 and not any(q.key.split()[-1] == last for q in famous):
            acc.add(last)
        if len(first) >= 5 and not any(q.key.split()[0] == first for q in famous):
            acc.add(first)
        if len(parts) > 2:
            acc.add(" ".join(parts[-2:]))
    nick = {
        "shaquille oneal": ["shaq"], "giannis antetokounmpo": ["giannis"], "lebron james": ["lebron", "bron"],
        "nikola jokic": ["jokic", "joker"], "kevin durant": ["kd"], "michael jordan": ["mj", "jordan"],
        "magic johnson": ["magic"], "kareem abduljabbar": ["kareem"], "shai gilgeousalexander": ["sga", "shai"],
        "luka doncic": ["luka"], "stephen curry": ["steph", "curry"], "dwyane wade": ["dwade", "wade"],
        "allen iverson": ["ai", "iverson"], "tim duncan": ["duncan"], "kobe bryant": ["kobe"],
        "victor wembanyama": ["wemby", "wembanyama"], "hakeem olajuwon": ["hakeem", "dream"],
        "anthony davis": ["ad"], "chris paul": ["cp3"], "karlanthony towns": ["kat"], "paul george": ["pg13"],
        "dirk nowitzki": ["dirk"], "wilt chamberlain": ["wilt"], "kawhi leonard": ["kawhi"],
        "joel embiid": ["embiid"], "jayson tatum": ["tatum"], "russell westbrook": ["westbrook", "russ"],
    }
    acc.update(nick.get(p.key, []))
    return sorted(acc)

# ---------------------------------------------------------------- question factory
class Bank:
    def __init__(self, seed=7):
        self.qs = []
        self.seen = set()
        self.rnd = random.Random(seed)

    def add(self, q):
        sig = hashlib.md5(json.dumps({k: q[k] for k in ("type", "prompt", "answer", "sides", "clues") if k in q}, sort_keys=True, default=str).encode()).hexdigest()[:10]
        if sig in self.seen:
            return
        self.seen.add(sig)
        q["id"] = sig
        self.qs.append(q)

def pick_others(rnd, pool, n, exclude):
    pool = [x for x in pool if x not in exclude]
    rnd.shuffle(pool)
    out = []
    for x in pool:
        if x not in out:
            out.append(x)
        if len(out) == n:
            break
    return out

def mc(bank, theme, diff, prompt, correct, wrong, fact=None, image=None, sub=None):
    if len(wrong) < 3 or correct in wrong:
        return
    opts = wrong[:3] + [correct]
    bank.rnd.shuffle(opts)
    q = {"type": "mc", "theme": theme, "difficulty": diff, "prompt": prompt,
         "options": opts, "correct": opts.index(correct), "answer": correct}
    if fact: q["fact"] = fact
    if image: q["image"] = image
    if sub: q["sub"] = sub
    bank.add(q)

def guess(bank, theme, diff, prompt, p, clues, players, fact=None, image=None, image_mode=None):
    q = {"type": "guess", "theme": theme, "difficulty": diff, "prompt": prompt, "clues": clues,
         "answer": p.name, "accept": accept_names(p, players)}
    if fact: q["fact"] = fact
    if image:
        q["image"] = image
        q["imageMode"] = image_mode or "plain"
    elif p.img and image_mode != "none":
        q["revealImage"] = p.img          # headshot shown only on the answer screen
    bank.add(q)

def hl(bank, theme, diff, prompt, a, av, b, bv, fmt, fact=None, lower_wins=False):
    if av == bv:
        return
    win = (0 if av < bv else 1) if lower_wins else (0 if av > bv else 1)
    q = {"type": "hl", "theme": theme, "difficulty": diff, "prompt": prompt,
         "sides": [{"name": a.name, "img": a.img, "value": fmt(av)}, {"name": b.name, "img": b.img, "value": fmt(bv)}],
         "correct": win, "answer": [a.name, b.name][win]}
    if fact: q["fact"] = fact
    bank.add(q)

def board(bank, theme, diff, prompt, rows, players_by_key, fact=None, seconds=75):
    slots = []
    for label, name in rows:
        p = players_by_key_all.get(norm(name))
        acc = accept_names(p, players_by_key_all) if p else [norm(name)]
        slots.append({"label": label, "name": name, "accept": acc, "img": p.img if p else None})
    q = {"type": "board", "theme": theme, "difficulty": diff, "prompt": prompt, "slots": slots,
         "answer": ", ".join(n for _, n in rows), "seconds": seconds}
    if fact: q["fact"] = fact
    bank.add(q)

def closest(bank, theme, diff, prompt, value, unit_fmt, fact=None, sub=None, p=None):
    q = {"type": "closest", "theme": theme, "difficulty": diff, "prompt": prompt, "value": value,
         "answer": unit_fmt(value)}
    if sub: q["sub"] = sub
    if fact: q["fact"] = fact
    if p is not None and p.img: q["image"] = p.img; q["imageMode"] = "plain"
    bank.add(q)

players_by_key_all = {}

# ---------------------------------------------------------------- generators
def gen_career_paths(bank, PL, famous):
    for p in famous:
        path = p.teams_path()
        if len(path) < 3:
            continue
        clues = [f"{t} ({season(a)}" + ("" if a == b else f" to {season(b)}") + ")" for t, a, b in path]
        if len(clues) > 9:
            continue
        guess(bank, "Career Paths", p.difficulty, "Whose NBA career path is this?", p, clues, PL,
              fact=f"{p.name}: {len(path)} stops, {num(p.tot['PTS'])} career points")
        # never played for
        played = {t for t, _, _ in path}
        cur = sorted({team_name(c, 2026) for c in NBA30} - played)
        if len(played) >= 3:
            right = bank.rnd.choice(cur)
            wrong = bank.rnd.sample(sorted(played), 3)
            mc(bank, "Career Paths", p.difficulty, f"Which team did {p.name} NEVER play for?", right, wrong,
               fact=f"{p.name} played for: " + ", ".join(t for t, _, _ in path))

def gen_season_lines(bank, PL, famous):
    for p in famous:
        by_year = collections.defaultdict(list)
        for s in p.seasons:
            by_year[s["y"]].append(s)
        best = []
        for y, rows in by_year.items():
            if len(rows) != 1 or y >= CURRENT_END_YEAR:
                continue
            s = rows[0]
            if s["gp"] < 45:
                continue
            ppg, rpg, apg = s["PTS"] / s["gp"], s["REB"] / s["gp"], s["AST"] / s["gp"]
            score = ppg + rpg * 0.8 + apg
            if ppg >= 24 or rpg >= 13 or apg >= 10:
                best.append((score, s))
        best.sort(key=lambda x: -x[0])
        for _, s in best[:2]:
            g = s["gp"]
            line = []
            for k in STAT_ORDER:
                v = s[k] / g
                if k in ("STL", "BLK", "3PM") and v < 1.0:
                    continue
                line.append(f"{v:.1f} {k}")
            tn = team_name(s["team"], s["y"])
            clues = [f"Season: {season(s['y'])}", " · ".join(line), f"{g} games played", f"Team: {tn}"]
            guess(bank, "Stat Lines", p.difficulty, "Whose season is this?", p, clues, PL,
                  fact=f"{p.name}, {season(s['y'])} {tn}")

def gen_bio(bank, PL, famous):
    for p in famous:
        b = p.bio
        if not b or ((p.first or 0) < 1980 and p.fame < 50):
            continue
        clues = []
        place = ", ".join(x for x in [b.get("BIRTH CITY", "").strip(), b.get("BIRTH STATE / COUNTRY", "").strip()] if x)
        if place:
            clues.append(f"Born in {place}")
        col = b.get("COLLEGE / TEAM", "").strip()
        if col and col.lower() not in ("none", "-"):
            clues.append(f"Before the NBA: {col}")
        dy, pk, tm = to_int(b.get("DRAFT")), to_int(b.get("PICK")), b.get("TEAM", "").strip()
        if dy and pk and tm:
            tn = team_name(tm, dy + 1)
            clues.append(f"Drafted {dy}, No. {pk} pick" + (f" by the {tn}" if tn else ""))
        elif dy is None and b.get("DRAFT", "").strip().lower().startswith("und"):
            clues.append("Went undrafted")
        if b.get("HEIGHT"):
            clues.append(f"Listed at {b['HEIGHT'].replace('-', chr(39))}\"" + (f", {b['POS']}" if b.get("POS") else ""))
        if p.allstar:
            clues.append(f"{p.allstar}x All-Star")
        if len(clues) >= 4:
            guess(bank, "Draft & Bio", p.difficulty, "Who is this player?", p, clues, PL)

def gen_draft_mc(bank, PL, famous):
    drafted = [p for p in famous if to_int(p.bio.get("DRAFT")) and to_int(p.bio.get("PICK")) and p.bio.get("TEAM", "").strip()]
    colleges = sorted({p.bio["COLLEGE / TEAM"].strip() for p in PL.values() if p.bio and p.bio.get("COLLEGE / TEAM", "").strip() and p.fame >= 2})
    for p in drafted:
        dy, pk, tm = to_int(p.bio["DRAFT"]), to_int(p.bio["PICK"]), p.bio["TEAM"].strip()
        tn = team_name(tm, dy + 1)
        if not tn:
            continue
        others = pick_others(bank.rnd, [team_name(c, dy + 1) for c in NBA30 if team_name(c, dy + 1)], 3, {tn})
        mc(bank, "Draft & Bio", p.difficulty, f"Which team drafted {p.name}?", tn, others,
           fact=f"{p.name}: No. {pk} pick, {dy}", sub=f"{dy} NBA Draft")
        # pick number
        cands = [c for c in sorted({max(1, pk + d) for d in (-9, -5, -3, -2, 2, 3, 5, 9, 12)} - {pk}) if c <= 60]
        if len(cands) < 3:
            continue
        wrong = [f"No. {x}" for x in bank.rnd.sample(cands, 3)]
        mc(bank, "Draft & Bio", "medium" if p.difficulty == "easy" else "hard",
           f"Where was {p.name} picked in the {dy} draft?", f"No. {pk}", wrong, fact=f"Drafted by the {tn}")
        col = p.bio.get("COLLEGE / TEAM", "").strip()
        if col and col.lower() not in ("none",):
            mc(bank, "Draft & Bio", p.difficulty, f"Where did {p.name} play before the NBA?", col,
               pick_others(bank.rnd, colleges, 3, {col}))

def gen_international(bank, PL, famous):
    intl = [p for p in famous if p.bio.get("NATIONALITY") and p.bio["NATIONALITY"] != "United States"]
    nats = sorted({p.bio["NATIONALITY"] for p in PL.values() if p.bio.get("NATIONALITY") and p.bio["NATIONALITY"] != "United States"})
    for p in intl:
        nat = p.bio["NATIONALITY"]
        mc(bank, "Around the World", p.difficulty, f"Where is {p.name} from?", nat,
           pick_others(bank.rnd, nats, 3, {nat}), image=p.img)
    # country -> guess the star
    by_nat = collections.defaultdict(list)
    for p in intl:
        by_nat[p.bio["NATIONALITY"]].append(p)
    for nat, ps in by_nat.items():
        ps.sort(key=lambda p: -p.fame)
        top = ps[0]
        if top.fame >= 15:
            clues = [f"From {nat}", f"{top.allstar}x All-Star" if top.allstar else f"{num(top.tot['PTS'])} career points",
                     f"NBA debut: {season(top.first)}"]
            path = top.teams_path()
            if path:
                clues.append(f"Played for the {path[0][0]}")
            guess(bank, "Around the World", top.difficulty, "Name the international star", top, clues, PL)
        if len(ps) >= 6:
            rows = [(f"{num(q.tot['PTS'])} pts", q.name) for q in sorted(ps, key=lambda q: -q.tot["PTS"])[:6]]
            board(bank, "Around the World", "hard", f"Name the top 6 scorers from {nat} in NBA history", rows, PL)

def gen_awards(bank, PL, famous):
    winners = collections.defaultdict(list)   # (award, year) -> names
    for p in PL.values():
        for a, y, team in p.awards:
            winners[(a, y)].append(p)
    allstars_by_year = collections.defaultdict(list)
    for (a, y), ps in winners.items():
        if a == "All-Star":
            allstars_by_year[y] = ps
    for (a, y), ps in winners.items():
        if a not in ("Most Valuable Player", "Finals MVP", "Defensive Player of the Year", "Rookie of the Year",
                     "Sixth Man of the Year", "Most Improved Player", "Scoring Leader", "All-Star MVP"):
            continue
        if len(ps) != 1 or y < 1970:
            continue
        w = ps[0]
        pool = [q.name for q in (allstars_by_year.get(y) or []) if q.name != w.name]
        if a in ("Rookie of the Year",):
            pool = [q.name for q in PL.values() if q.first == y and q.fame >= 4 and q.name != w.name]
        if a in ("Sixth Man of the Year", "Most Improved Player"):
            pool = [q.name for q in PL.values() if any(s["y"] == y for s in q.seasons) and 6 <= q.fame and q.name != w.name]
        diff = "easy" if a in ("Most Valuable Player",) and w.fame >= 30 else ("medium" if w.fame >= 12 else "hard")
        label = {"Scoring Leader": "the scoring title"}.get(a, a)
        mc(bank, "Awards & Rings", diff, f"Who won {label} in {season(y)}?", w.name,
           pick_others(bank.rnd, pool, 3, {w.name}))
        if a in ("Most Valuable Player", "Finals MVP", "Defensive Player of the Year"):
            guess(bank, "Awards & Rings", diff, f"{season(y)} {a}", w,
                  [f"{a}, {season(y)}", f"Team that season: {next((t for aa, yy, t in w.awards if aa == a and yy == y), '')}",
                   f"Career: {w.allstar}x All-Star", f"Rings: {w.rings}"], PL)
    # boards: MVP by decade
    for start in (1980, 1990, 2000, 2010, 2016):
        rows = []
        for y in range(start + 1, start + 11):
            ws = winners.get(("Most Valuable Player", y)) or []
            if len(ws) == 1:
                rows.append((season(y), ws[0].name))
        if len(rows) == 10:
            board(bank, "Awards & Rings", "medium", f"Name every MVP from {rows[0][0]} to {rows[-1][0]}", rows, PL, seconds=90)
    for start in (1990, 2000, 2010, 2016):
        rows = []
        for y in range(start + 1, start + 11):
            ws = winners.get(("Finals MVP", y)) or []
            if len(ws) == 1:
                rows.append((season(y), ws[0].name))
        if len(rows) == 10:
            board(bank, "Awards & Rings", "medium", f"Name every Finals MVP from {rows[0][0]} to {rows[-1][0]}", rows, PL, seconds=90)
    # All-Star counts, rings: higher/lower + closest
    stars = [p for p in famous if p.allstar >= 3 and ((p.last or 0) >= 1985 or p.fame >= 45)]
    for _ in range(260):
        a, b = bank.rnd.sample(stars, 2)
        if abs(a.allstar - b.allstar) >= 1:
            hl(bank, "Awards & Rings", "medium", "Who made more All-Star teams?", a, a.allstar, b, b.allstar, lambda v: f"{v}x")
    ringers = [p for p in famous if p.rings >= 1 and p.fame >= 15 and ((p.last or 0) >= 1985 or p.fame >= 45)]
    for _ in range(140):
        a, b = bank.rnd.sample(ringers, 2)
        if a.rings != b.rings:
            hl(bank, "Awards & Rings", "medium", "Who has more championship rings?", a, a.rings, b, b.rings,
               lambda v: f"{v} ring" + ("s" if v != 1 else ""))
    for p in stars:
        if p.allstar >= 6:
            vals = sorted({max(1, p.allstar + d) for d in (-4, -2, 2, 3, 5)} - {p.allstar})
            mc(bank, "Awards & Rings", p.difficulty, f"How many All-Star selections does {p.name} have?",
               str(p.allstar), [str(v) for v in bank.rnd.sample(vals, 3)], image=p.img)

def gen_leaders(bank, PL, P):
    labels = {"PTS": "points", "REB": "rebounds", "AST": "assists", "STL": "steals", "BLK": "blocks", "FG3M": "3-pointers"}
    L = P["leaders"]["stats"]
    for code, word in labels.items():
        rows = L[code]["rows"]
        for n in (5, 10):
            board(bank, "Record Book", "easy" if n == 5 else "medium",
                  f"Name the top {n} in career {word} (regular season)",
                  [(num(r["total"]), r["name"]) for r in rows[:n]], PL, seconds=60 if n == 5 else 90)
        top = [r for r in rows[:120]]
        for _ in range(70):
            a, b = bank.rnd.sample(top, 2)
            pa, pb = PL.get(a["name"]) or players_by_key_all.get(norm(a["name"])), PL.get(b["name"]) or players_by_key_all.get(norm(b["name"]))
            if pa and pb and pa.fame >= 8 and pb.fame >= 8:
                hl(bank, "Record Book", "medium", f"Who has more career {word}?", pa, a["total"], pb, b["total"], num)
        for r in rows[:60]:
            p = players_by_key_all.get(norm(r["name"]))
            if p and not p.active and p.fame >= 10:
                closest(bank, "Record Book", p.difficulty, f"How many career {word} did {p.name} finish with?",
                        r["total"], num, sub="Closest answer wins", p=p,
                        fact=f"No. {r['rank']} all time")
        # rank MC
        for r in rows[:25]:
            p = players_by_key_all.get(norm(r["name"]))
            if not p:
                continue
            others = [x["name"] for x in rows[:40] if x["name"] != r["name"]]
            if r["rank"] <= 10:
                ranks = [str(x) for x in range(1, 16) if x != r["rank"]]
                mc(bank, "Record Book", "hard", f"Where does {r['name']} rank in career {word}?", f"No. {r['rank']}",
                   [f"No. {x}" for x in bank.rnd.sample(ranks, 3)], fact=f"{num(r['total'])} {word}", image=p.img)

def gen_feats(bank, PL, P):
    F = P["feats"]["FEAT_DATA"]
    names = P["feats"]["STREAK_PLAYERS"]
    labels = P["feats"].get("FEAT_LABELS", {})
    nice = {"td": "triple-doubles", "p50": "50-point games", "p40": "40-point games", "p60": "60-point games",
            "r20": "20-rebound games", "a20": "20-assist games", "f5x5": "5x5 games"}
    for code, rows in F.items():
        word = nice.get(code, labels.get(code, code))
        def nm(slug):
            return (names.get(slug) or [slug])[0]
        if len(rows) >= 8:
            board(bank, "Record Book", "medium", f"Name the top 8 players in career {word}",
                  [(str(r[2]), nm(r[1])) for r in rows[:8]], PL, seconds=80)
        top = rows[:40]
        for _ in range(40):
            a, b = bank.rnd.sample(top, 2)
            pa, pb = players_by_key_all.get(norm(nm(a[1]))), players_by_key_all.get(norm(nm(b[1])))
            if pa and pb:
                hl(bank, "Record Book", "medium", f"Who has more career {word}?", pa, a[2], pb, b[2], str)
        for r in rows[:12]:
            p = players_by_key_all.get(norm(nm(r[1])))
            if p:
                closest(bank, "Record Book", "hard", f"How many {word} does {p.name} have in his career?", r[2], str,
                        sub="Closest answer wins", p=p, fact=f"No. {r[0]} all time")

def gen_money(bank, PL, famous):
    paid = [p for p in PL.values() if p.salary]
    by_year = collections.defaultdict(list)
    for p in paid:
        for y, v in p.salary.items():
            by_year[y].append((v, p))
    for y, rows in by_year.items():
        rows.sort(key=lambda x: -x[0])
        if len(rows) < 30:
            continue
        top = rows[:10]
        mc(bank, "Money Talks", "medium", f"Who was the highest-paid player in {season(y)}?", top[0][1].name,
           [p.name for _, p in top[1:4]], fact=f"{top[0][1].name}: {money(top[0][0])}")
        board(bank, "Money Talks", "hard", f"Name the top 5 highest-paid players of {season(y)}",
              [(money(v), p.name) for v, p in top[:5]], PL, seconds=75)
        # higher/lower within a season among well-known names
        pool = [(v, p) for v, p in rows[:80] if p.fame >= 9]
        for _ in range(12):
            if len(pool) < 2:
                break
            (av, a), (bv, b) = bank.rnd.sample(pool, 2)
            if abs(av - bv) / max(av, bv) > 0.04:
                hl(bank, "Money Talks", "medium", f"Who earned more in {season(y)}?", a, av, b, bv, money)
    # career earnings
    earners = sorted(((sum(p.salary.values()), p) for p in paid if p.fame >= 10), key=lambda x: -x[0])
    board(bank, "Money Talks", "medium", "Name the top 8 in career NBA salary earnings",
          [(money(v), p.name) for v, p in earners[:8]], PL, seconds=90,
          fact="Salaries since 1990-91")
    for v, p in earners[:120]:
        if not p.active and min(p.salary) >= 1991:
            closest(bank, "Money Talks", p.difficulty, f"How much did {p.name} earn in NBA salary over his career?",
                    round(v / 1_000_000), lambda m: f"${m}M", sub="Answer in millions. Closest wins", p=p)
    for _ in range(160):
        (av, a), (bv, b) = bank.rnd.sample(earners[:150], 2)
        if abs(av - bv) / max(av, bv) > 0.05:
            hl(bank, "Money Talks", "medium", "Who earned more in his NBA career?", a, av, b, bv, money,
               fact="Career salary since 1990-91")

def gen_jersey(bank, PL, P):
    J = P["jersey"]
    for s, d in J.items():
        rows = d.get("rows") or []
        if not rows:
            continue
        no1 = [r for r in rows if r["pos"] == 1]
        if len(no1) == 1:
            w = players_by_key_all.get(norm(no1[0]["player"]))
            pool = [r["player"] for r in rows[1:6]] or []
            if len(pool) < 3:
                # season with only the No. 1 known: borrow stars of that season
                y = int(s[:4]) + 1
                pool = [p.name for p in PL.values() if any(x["y"] == y for x in p.seasons) and p.fame >= 25 and p.name != no1[0]["player"]]
            mc(bank, "Jersey Kings", "medium", f"Who had the No. 1 selling NBA jersey in {s}?", no1[0]["player"],
               pick_others(bank.rnd, pool, 3, {no1[0]["player"]}), image=None, fact="Per the NBA's official jersey sales lists")
        full = [r for r in rows if r["pos"] <= 5 and not r.get("shared")]
        if len(full) >= 5:
            board(bank, "Jersey Kings", "medium", f"Name the top 5 jersey sellers of {s}",
                  [(f"No. {r['pos']}", r["player"]) for r in sorted(full, key=lambda r: r["pos"])[:5]], PL, seconds=70)

def gen_heights(bank, PL, famous):
    tall = [p for p in famous if height_in(p.bio.get("HEIGHT")) and p.fame >= 10]
    for _ in range(140):
        a, b = bank.rnd.sample(tall, 2)
        ha, hb = height_in(a.bio["HEIGHT"]), height_in(b.bio["HEIGHT"])
        if abs(ha - hb) >= 2:
            hl(bank, "Draft & Bio", "medium", "Who is taller?", a, ha, b, hb, lambda v: f"{v//12}'{v%12}\"")
    drafted = [p for p in famous if to_int(p.bio.get("PICK")) and p.fame >= 10]
    for _ in range(140):
        a, b = bank.rnd.sample(drafted, 2)
        pa, pb = to_int(a.bio["PICK"]), to_int(b.bio["PICK"])
        if pa != pb:
            hl(bank, "Draft & Bio", "medium", "Who was drafted higher?", a, pa, b, pb, lambda v: f"No. {v}", lower_wins=True)
    for p in drafted:
        dy = to_int(p.bio.get("DRAFT"))
        if dy and p.fame >= 15:
            closest(bank, "Draft & Bio", p.difficulty, f"What year was {p.name} drafted?", dy, str,
                    sub="Closest year wins", p=p)

def gen_no1_picks(bank, PL):
    by = {}
    for p in PL.values():
        if to_int(p.bio.get("PICK")) == 1 and to_int(p.bio.get("DRAFT")):
            by.setdefault(to_int(p.bio["DRAFT"]), []).append(p)
    for start in (1990, 2000, 2010, 2015):
        rows = [(str(y), by[y][0].name) for y in range(start, start + 10) if len(by.get(y, [])) == 1]
        if len(rows) >= 8:
            board(bank, "Draft & Bio", "medium", f"Name every No. 1 pick from {rows[0][0]} to {rows[-1][0]}", rows, PL, seconds=90)
    for y, ps in by.items():
        if len(ps) == 1 and y >= 1980:
            p = ps[0]
            pool = [q.name for q in PL.values() if to_int(q.bio.get("DRAFT")) == y and 2 <= (to_int(q.bio.get("PICK")) or 99) <= 10]
            mc(bank, "Draft & Bio", "medium" if p.fame >= 12 else "hard", f"Who was the No. 1 pick in the {y} draft?",
               p.name, pick_others(bank.rnd, pool, 3, {p.name}))

def gen_faces(bank, PL, famous):
    for p in famous:
        if p.img and p.fame >= 10:
            guess(bank, "Name the Face", p.difficulty, "Who is this?", p,
                  [f"NBA debut: {season(p.first)}", f"{num(p.tot['PTS'])} career points",
                   f"Teams: {len(p.teams_path())}"], PL, image=p.img, image_mode="zoom")

def gen_franchise(bank, PL):
    tot = collections.defaultdict(collections.Counter)
    for p in PL.values():
        for s in p.seasons:
            if s["team"] in NBA30:
                tot[s["team"]][p.name] += s["PTS"]
    for code, c in tot.items():
        top = c.most_common(6)
        board(bank, "Franchise Legends", "medium", f"Name the {NICK[code]}' top 6 scorers in franchise history",
              [(num(v), n) for n, v in top], PL, seconds=80, fact="Regular season, includes the franchise's earlier cities")
        mc(bank, "Franchise Legends", "medium", f"Who is the {NICK[code]}' all-time leading scorer?", top[0][0],
           [n for n, _ in top[1:4]], fact=f"{num(top[0][1])} points")

def gen_battles(bank, PL, famous):
    elite = sorted([p for p in famous if p.fame >= 35], key=lambda p: -p.fame)[:60]
    prompts = ["Better career?", "Who would you build a team around?", "Who had the better peak?", "Better player?"]
    for _ in range(220):
        a, b = bank.rnd.sample(elite, 2)
        if abs(a.fame - b.fame) > 40:
            continue
        q = {"type": "battle", "theme": "Chat Battles", "difficulty": "easy", "prompt": bank.rnd.choice(prompts),
             "sides": [{"name": a.name, "img": a.img, "value": f"{a.allstar}x All-Star · {a.rings} ring" + ("s" if a.rings != 1 else "")},
                       {"name": b.name, "img": b.img, "value": f"{b.allstar}x All-Star · {b.rings} ring" + ("s" if b.rings != 1 else "")}],
             "answer": ""}
        bank.add(q)
    active = sorted([p for p in famous if p.active and p.fame >= 15], key=lambda p: -p.fame)[:30]
    for _ in range(120):
        a, b = bank.rnd.sample(active, 2)
        q = {"type": "battle", "theme": "Chat Battles", "difficulty": "easy",
             "prompt": bank.rnd.choice(["Who has the better season?", "Better player right now?", "Who would you rather have?"]),
             "sides": [{"name": a.name, "img": a.img, "value": ""}, {"name": b.name, "img": b.img, "value": ""}], "answer": ""}
        bank.add(q)

def gen_true_false(bank, PL, famous):
    for p in famous:
        if p.fame < 15:
            continue
        path = p.teams_path()
        played = {t for t, _, _ in path}
        others = sorted({team_name(c, 2026) for c in NBA30} - played)
        if bank.rnd.random() < 0.5 and path:
            t = bank.rnd.choice(sorted(played))
            truth = True
        else:
            t = bank.rnd.choice(others)
            truth = False
        q = {"type": "mc", "theme": "Career Paths", "difficulty": p.difficulty, "prompt": f"True or false: {p.name} played for the {t}.",
             "options": ["True", "False"], "correct": 0 if truth else 1, "answer": "True" if truth else "False",
             "fact": f"{p.name} played for: " + ", ".join(x for x, _, _ in path)}
        if p.img: q["image"] = p.img
        bank.add(q)

# ---------------------------------------------------------------- main
THEMES = ["Career Paths", "Stat Lines", "Draft & Bio", "Awards & Rings", "Record Book", "Money Talks",
          "Jersey Kings", "Around the World", "Name the Face", "Franchise Legends"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="sources")
    ap.add_argument("--out", default="data/questions.json")
    a = ap.parse_args()

    P = load(a.src)
    PL = build_players(P)
    players_by_key_all.update({p.key: p for p in PL.values()})
    # live audiences want names they know: big careers of any era, or solid players from 1995 on
    famous = sorted([p for p in PL.values() if p.fame >= 14 or (p.fame >= 7 and (p.last or 0) >= 1996)],
                    key=lambda p: -p.fame)

    bank = Bank()
    gen_career_paths(bank, PL, famous)
    gen_true_false(bank, PL, famous)
    gen_season_lines(bank, PL, famous)
    gen_bio(bank, PL, famous)
    gen_draft_mc(bank, PL, famous)
    gen_no1_picks(bank, PL)
    gen_heights(bank, PL, famous)
    gen_international(bank, PL, famous)
    gen_awards(bank, PL, famous)
    gen_leaders(bank, PL, P)
    gen_feats(bank, PL, P)
    gen_money(bank, PL, famous)
    gen_jersey(bank, PL, P)
    gen_faces(bank, PL, famous)
    gen_franchise(bank, PL)
    gen_battles(bank, PL, famous)

    # every themed game also needs names chat can type for any player (letter reveal of mc answers etc.)
    out = {
        "generated": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "themes": THEMES,
        "count": len(bank.qs),
        "questions": bank.qs,
    }
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    # only rewrite when the questions themselves changed, so the weekly job doesn't commit noise
    try:
        old = json.load(open(a.out, encoding="utf-8"))
        if old.get("questions") == out["questions"]:
            print("Questions unchanged, file left as is")
            return
    except Exception:
        pass
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    c = collections.Counter((q["theme"], q["type"]) for q in bank.qs)
    for k, v in sorted(c.items()):
        print(f"{k[0]:<20} {k[1]:<8} {v}")
    print("TOTAL", len(bank.qs))

if __name__ == "__main__":
    main()
