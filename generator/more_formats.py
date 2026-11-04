"""
More question formats for the HoopsHype NBA Quiz Live (Nov 2026).

Each generator reads one public repo's data (downloaded into sources/ by fetch_sources.sh) and is
fully optional: if its file is missing or its format changes, it prints a warning and adds nothing,
so the rest of the bank still builds. Nothing here reads the HoopsHype rumors archive.

Formats
  Teammates        "Name a player who played with both A and B"            type anyof  (typed)
  Born today       "This player was born on this day in 1995"              type guess  (q.mmdd: only shown that day)
  Hometowns        "Born in Akron, Ohio..."                               type guess
  Before the NBA   "Which club did Luka Doncic play for before the NBA?"   type mc
  Shot charts      a season's shot chart, name the player                  type guess  (q.shots)
  2K ratings       "What is his NBA 2K27 rating?"                          type closest
  Pick the season  four facts, type the year the season started           type closest (q.facts)
  Odd one out      three share a team/college/draft class, pick the one who doesn't   type mc
  Order it         three players, type the order (e.g. BAC)                type order
  Award voting     "Who finished 3rd in the 2011 MVP vote?"                type mc
  Draft combine    whose wingspan/vertical was bigger                      type hl
  Head to head     who won more games against the other since 2016-17      type hl
  Clutch           more clutch points / buzzer-beating game-winners        type hl
  Streaks          the longer streak of 20-point games etc.                type hl
  Beat Vegas       furthest ahead of its preseason win total (today)       type mc     (q.validOn)
  Arenas           which arena drew the biggest crowds                     type mc
  GM survey        "GMs picked who as ..."                                 type mc
  Referees         most Finals games worked etc. (one a night)             type mc     (q.rare)
  Last night       who led last night's Knicks game in scoring             type guess  (q.validOn)
"""
import collections, csv, datetime, gzip, io, json, os, re, urllib.request

B = None   # build_questions module, set by register()


def register(mod):
    global B
    B = mod


def _path(src, rel):
    return os.path.join(src, rel)


def _load_json(src, rel):
    p = _path(src, rel)
    if not os.path.exists(p):
        print(f"  (skipped: {rel} not downloaded)")
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def safe(fn):
    """Run one generator; a broken source never stops the whole build."""
    def run(*a, **k):
        before = len(a[0].qs)
        try:
            fn(*a, **k)
        except Exception as e:  # noqa: BLE001
            print(f"  WARNING {fn.__name__} failed: {e!r}")
        print(f"  {fn.__name__}: +{len(a[0].qs) - before}")
    run.__name__ = fn.__name__
    return run


def pid_of(p):
    """NBA person id from the headshot file name (2544-lebron-james.webp -> 2544)."""
    if not p or not p.img:
        return None
    m = re.match(r"(\d+)-", p.img)
    return int(m.group(1)) if m else None


def et_today():
    # US Eastern date, close enough without tz data: UTC-5 (the quiz runs in the evening ET)
    return (datetime.datetime.utcnow() - datetime.timedelta(hours=5)).date()


def first_last(p):
    return f"{p.seasons[0]['y'] - 1}" if p.seasons else ""


# =====================================================================================
# 1. Teammates: name anyone who played with both A and B
# =====================================================================================
@safe
def gen_teammate_link(bank, PL, famous):
    roster = collections.defaultdict(set)
    for p in PL.values():
        for s in p.seasons:
            roster[(s["team"], s["y"])].add(p.name)
    mates = collections.defaultdict(set)
    for names in roster.values():
        for n in names:
            mates[n] |= names
    for n in mates:
        mates[n].discard(n)
    pool = [p for p in famous if (p.last or 0) >= 2003 and p.fame >= 8 * B.STAR]
    rnd = bank.rnd
    made = 0
    for _ in range(6000):
        if made >= 260:
            break
        a, b = rnd.sample(pool, 2)
        if b.name in mates[a.name]:
            continue                     # they played together: too easy to confuse
        common = sorted(mates[a.name] & mates[b.name])
        if not 2 <= len(common) <= 14:
            continue
        answers = []
        for n in common:
            p = B.players_by_key_all.get(B.norm(n))
            answers.append({"name": n, "accept": B.accept_names(p, B.players_by_key_all) if p else [B.norm(n)],
                            "img": p.img if p else None, "fame": round(p.fame, 1) if p else 0})
        answers.sort(key=lambda x: -x["fame"])
        diff = "easy" if len(common) >= 8 else "medium" if len(common) >= 4 else "hard"
        q = {"type": "anyof", "theme": "Teammates", "difficulty": diff,
             "prompt": f"Name a player who was a teammate of both {a.name} and {b.name}",
             "sides": [{"name": a.name, "img": a.img}, {"name": b.name, "img": b.img}],
             "answers": answers, "answer": answers[0]["name"],
             "fact": f"{len(common)} players were teammates of both"}
        bank.add(q)
        made += 1


# =====================================================================================
# 3 + 4. Born today and hometowns (bio.csv from salary-season-finder)
# =====================================================================================
def _bio_bits(p):
    b = p.bio or {}
    draft, pick = B.to_int(b.get("DRAFT")), B.to_int(b.get("PICK"))
    dr = f"Drafted in {draft}, pick {pick}" if draft and pick else (f"Went undrafted" if draft is None and (p.first or 0) > 1990 else None)
    pos = {"G": "Guard", "F": "Forward", "C": "Center", "G-F": "Guard-forward", "F-C": "Forward-center", "F-G": "Forward-guard",
           "C-F": "Center-forward"}.get((b.get("POS") or "").strip(), (b.get("POS") or "").strip())
    path = p.teams_path()
    teams = ", ".join(dict.fromkeys(t for t, _, _ in path)) if path else ""
    return dr, pos, teams


@safe
def gen_born_today(bank, PL, famous):
    for p in famous:
        b = p.bio or {}
        m = re.match(r"(\d+)/(\d+)/(\d{4})", b.get("BIRTHDAY") or "")
        if not m:
            continue
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        dr, pos, teams = _bio_bits(p)
        clues = [f"Born on this day in {y}"]
        if pos: clues.append(f"Position: {pos}")
        if dr: clues.append(dr)
        if teams: clues.append(f"Teams: {teams}")
        if len(clues) < 3:
            continue
        before = len(bank.qs)
        B.guess(bank, "Tonight in the NBA", p.difficulty, "Happy birthday! Who was born on this day?", p, clues, B.players_by_key_all,
                fact=f"Born {datetime.date(y, mo, d):%B} {d}, {y}")
        if len(bank.qs) > before:
            bank.qs[-1]["mmdd"] = f"{mo:02d}-{d:02d}"


@safe
def gen_hometowns(bank, PL, famous):
    for p in famous:
        b = p.bio or {}
        city, region, nat = (b.get("BIRTH CITY") or "").strip(), (b.get("BIRTH STATE / COUNTRY") or "").strip(), (b.get("NATIONALITY") or "").strip()
        if not city or not region:
            continue
        dr, pos, teams = _bio_bits(p)
        region = {"District Columbia": "D.C.", "District of Columbia": "D.C."}.get(region, region)
        clues = [f"Born in {city}, {region}"]
        if nat and nat not in region and nat != "United States": clues.append(f"Nationality: {nat}")
        col = (b.get("COLLEGE / TEAM") or "").strip()
        if col and col.lower() not in ("no college", "none"): clues.append(f"Before the NBA: {col}")
        if dr: clues.append(dr)
        if pos: clues.append(f"Position: {pos}")
        if len(clues) < 3:
            continue
        diff = {"easy": "medium", "medium": "hard", "hard": "hard"}[p.difficulty]   # birthplaces are harder than they look
        B.guess(bank, "Around the World", diff, "Where's he from? Name the player", p, clues[:4], B.players_by_key_all,
                fact=f"Born in {city}, {region}")


# =====================================================================================
# 5. Before the NBA: overseas clubs (nba-career-map)
# =====================================================================================
NBA_WORDS = set(B_NICKS := ["Hawks", "Celtics", "Nets", "Hornets", "Bulls", "Cavaliers", "Mavericks", "Nuggets", "Pistons", "Warriors", "Rockets",
                            "Pacers", "Clippers", "Lakers", "Grizzlies", "Heat", "Bucks", "Timberwolves", "Pelicans", "Knicks", "Thunder",
                            "Magic", "76ers", "Suns", "Trail Blazers", "Kings", "Spurs", "Raptors", "Jazz", "Wizards", "SuperSonics", "Bobcats",
                            "Bullets", "Braves", "Vipers", "Skyforce", "Legends", "G League", "Ignite"])


def _is_nba(team):
    return any(w in team for w in NBA_WORDS)


@safe
def gen_before_nba(bank, PL, famous, src):
    careers = _load_json(src, "nba-career-map/data/players/nba_players_careers.json")
    if not careers:
        return
    by_country = collections.defaultdict(set)
    pre = {}
    for c in careers:
        hist = c.get("career_history") or []
        first_nba = next((i for i, h in enumerate(hist) if _is_nba(h.get("team", "")) or h.get("country") == "USA"), None)
        clubs = []
        for h in hist[: first_nba if first_nba is not None else len(hist)]:
            t, ctry = (h.get("team") or "").strip(), (h.get("country") or "").strip()
            if t and ctry and ctry not in ("USA",) and not _is_nba(t) and not h.get("loan"):
                clubs.append((t, ctry))
        for h in hist:
            t, ctry = (h.get("team") or "").strip(), (h.get("country") or "").strip()
            if t and ctry and ctry not in ("USA", "Canada") and not _is_nba(t):
                by_country[ctry].add(t)
        if clubs:
            pre[B.norm(c.get("player", ""))] = clubs
    allclubs = sorted({t for s in by_country.values() for t in s})
    for p in PL.values():
        if not p.ok or p.key not in pre:
            continue
        clubs = pre[p.key]
        right, ctry = clubs[-1]
        mine = {t for t, _ in clubs}
        same = sorted(by_country[ctry] - mine)
        wrong = B.pick_others(bank.rnd, same, 3, {right})
        if len(wrong) < 3:
            wrong += B.pick_others(bank.rnd, allclubs, 3 - len(wrong), mine | set(wrong))
        if len(wrong) < 3:
            continue
        diff = "medium" if p.fame >= 20 else "hard"
        q_before = len(bank.qs)
        B.mc(bank, "Around the World", diff, f"Which club did {p.name} play for before the NBA?", right, wrong,
             fact=f"{p.name} before the NBA: " + ", ".join(f"{t} ({c})" for t, c in clubs), image=p.img)


# =====================================================================================
# 6. Shot charts (shards from the public cdechoch/nba-data-archive dataset on Hugging Face)
# =====================================================================================
HF_SHOTS = "https://huggingface.co/datasets/cdechoch/nba-data-archive/resolve/main/shot-chart-shards"


def _fetch(url, dest, timeout=40):
    if os.path.exists(dest):
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "hoopshype-quiz-live question builder"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"    could not fetch {url}: {e}")
        return False


@safe
def gen_shot_charts(bank, PL, famous, src):
    shot_dir = _path(src, "shot-chart-shards")
    online = os.environ.get("QUIZ_FETCH_SHOTS") == "1"
    pool = [p for p in famous if pid_of(p) and (p.last or 0) >= 2000][:160]
    for p in pool:
        pid = pid_of(p)
        dest = os.path.join(shot_dir, f"{pid}.json")
        if not os.path.exists(dest):
            if not online or not _fetch(f"{HF_SHOTS}/players/{pid // 100}/{pid}.json", dest):
                continue
        try:
            shard = json.load(open(dest, encoding="utf-8"))
            cols = shard["shots"]
        except Exception:
            continue
        n = len(cols["x"])
        by_season = collections.defaultdict(list)
        for i in range(n):
            if cols["po"][i] == 1:
                continue
            by_season[cols["s"][i]].append(i)
        if not by_season:
            continue
        sy, idx = max(by_season.items(), key=lambda kv: len(kv[1]))
        if len(idx) < 400:
            continue
        made = sum(cols["m"][i] for i in idx)
        threes = sum(cols["3"][i] for i in idx)
        step = max(1, len(idx) // 260)
        shots = [[int(round(cols["x"][i])), int(round(cols["y"][i])), int(cols["m"][i])] for i in idx[::step]][:260]
        # shot "s" is the season START year in the shard (1996 = 1996-97)
        end_y = int(sy) + 1
        team = next((B.team_name(s["team"], s["y"]) for s in p.seasons if s["y"] == end_y), None)
        clues = [f"Season: {B.season(end_y)}", f"{B.num(len(idx))} shots, {100 * made / len(idx):.1f}% made",
                 f"{100 * threes / len(idx):.0f}% of his shots were threes"]
        if team: clues.append(f"Team: {team}")
        before = len(bank.qs)
        B.guess(bank, "Shot Charts", p.difficulty, "Whose shot chart is this?", p, clues, B.players_by_key_all,
                fact=f"{p.name}, {B.season(end_y)}")
        if len(bank.qs) > before:
            bank.qs[-1]["shots"] = shots


# =====================================================================================
# 7. NBA 2K ratings (nba-player-data)
# =====================================================================================
@safe
def gen_2k(bank, PL, famous, src):
    rows = _load_json(src, "nba-player-data/nba2k.json")
    if not rows:
        return
    for r in rows:
        p = B.players_by_key_all.get(B.norm(r.get("Full Name", "")))
        if not B.okp(p):
            continue
        eds = [(k, B.to_int(v)) for k, v in r.items() if re.fullmatch(r"2[Kk]\d\d", k) and B.to_int(v)]
        if not eds:
            continue
        eds = [kv for kv in eds if int(kv[0][2:]) >= 10]          # NBA 2K10 and newer only
        if not eds:
            continue
        eds.sort(key=lambda kv: int(kv[0][2:]))
        latest = eds[-1]
        picks = [latest] + ([max(eds[:-1], key=lambda kv: kv[1])] if len(eds) > 2 else [])
        for k, v in picks:
            ed = "NBA 2K" + k[2:]
            B.closest(bank, "Ratings & Votes", "medium" if v >= 85 else "hard", f"What was {p.name}'s overall rating in {ed}?",
                      v, str, sub="Type a number. Closest wins", p=p)


# =====================================================================================
# 8. Pick the season: four facts from one year
# =====================================================================================
@safe
def gen_pick_season(bank, PL, famous):
    by_year = collections.defaultdict(dict)
    for p in PL.values():
        for a, y, team in p.awards:
            if a in ("Most Valuable Player", "Rookie of the Year", "Finals MVP", "Defensive Player of the Year", "Sixth Man of the Year"):
                by_year[y].setdefault(a, p.name)
            if a == "NBA Champion":
                by_year[y].setdefault("champ", team)
    scorers = collections.defaultdict(list)
    for p in PL.values():
        for s in p.seasons:
            if s["gp"] >= 58:
                scorers[s["y"]].append((s["PTS"] / s["gp"], p.name))
    for y in range(2001, B.CURRENT_END_YEAR):   # modern era only
        f = by_year.get(y, {})
        facts = []
        if f.get("Most Valuable Player"): facts.append(f"MVP: {f['Most Valuable Player']}")
        if f.get("champ"): facts.append(f"Champion: {f['champ']}")
        if f.get("Rookie of the Year"): facts.append(f"Rookie of the Year: {f['Rookie of the Year']}")
        if scorers.get(y):
            ppg, n = max(scorers[y])
            facts.append(f"Top scorer: {n} ({ppg:.1f} ppg)")
        if f.get("Defensive Player of the Year") and len(facts) < 4: facts.append(f"Defensive Player of the Year: {f['Defensive Player of the Year']}")
        if len(facts) < 4:
            continue
        q = {"type": "closest", "theme": "Awards & Rings", "difficulty": "medium" if y >= 2005 else "hard",
             "prompt": "Which season was this?", "sub": "Type the year it started (2002 for 2002-03). Closest wins",
             "value": y - 1, "answer": B.season(y), "facts": facts[:4]}
        bank.add(q)


# =====================================================================================
# 11. Odd one out
# =====================================================================================
@safe
def gen_odd_one_out(bank, PL, famous):
    rnd = bank.rnd
    ok = [p for p in famous if (p.last or 0) >= 2001]
    # same team, same season
    roster = collections.defaultdict(list)
    for p in ok:
        for s in p.seasons:
            if s["gp"] >= 30:
                roster[(s["team"], s["y"])].append(p)
    keys = [k for k, v in roster.items() if len(v) >= 3 and k[1] >= 2001]
    rnd.shuffle(keys)
    for team, y in keys[:220]:
        three = rnd.sample(roster[(team, y)], 3)
        odd = [p for p in ok if team not in p.franchises() and any(s["y"] == y for s in p.seasons)]
        if not odd:
            continue
        o = rnd.choice(odd)
        tn = B.team_name(team, y)
        B.mc(bank, "Odd One Out", "medium", f"Three of them played for the {B.season(y)} {tn}. Who didn't?",
             o.name, [p.name for p in three], fact=f"{o.name} never played for the {B.NICK.get(team, tn)}")
    # same college
    col = collections.defaultdict(list)
    for p in ok:
        c = (p.bio or {}).get("COLLEGE / TEAM", "").strip()
        if c and c.lower() not in ("no college", "none", ""):
            col[c].append(p)
    for c, ps in col.items():
        if len(ps) < 3:
            continue
        for _ in range(min(4, len(ps) - 2)):
            three = rnd.sample(ps, 3)
            others = [p for p in ok if (p.bio or {}).get("COLLEGE / TEAM", "").strip() != c and (p.bio or {}).get("COLLEGE / TEAM", "").strip()]
            o = rnd.choice(others)
            B.mc(bank, "Odd One Out", "hard", f"Three of them went to {c}. Who didn't?", o.name, [p.name for p in three],
                 fact=f"{o.name} went to {(o.bio or {}).get('COLLEGE / TEAM', '').strip()}")
    # same draft class
    dc = collections.defaultdict(list)
    for p in ok:
        d = B.to_int((p.bio or {}).get("DRAFT"))
        if d and d >= 1996:
            dc[d].append(p)
    for d, ps in dc.items():
        if len(ps) < 3:
            continue
        for _ in range(4):
            three = rnd.sample(ps, 3)
            others = [p for p in ok if B.to_int((p.bio or {}).get("DRAFT")) and abs(B.to_int(p.bio["DRAFT"]) - d) in (1, 2, 3)]
            if not others:
                continue
            o = rnd.choice(others)
            B.mc(bank, "Odd One Out", "medium", f"Three of them were drafted in {d}. Who wasn't?", o.name, [p.name for p in three],
                 fact=f"{o.name} was drafted in {o.bio['DRAFT']}")


# =====================================================================================
# 12. Order it
# =====================================================================================
def order_q(bank, theme, diff, prompt, items, fmt, lower_first=False):
    """items: [(player, value)] x3, values distinct. Answer = letters in the right order."""
    if len({v for _, v in items}) < 3 or not all(B.okp(p) for p, _ in items):
        return
    ranked = sorted(range(3), key=lambda i: items[i][1], reverse=not lower_first)
    q = {"type": "order", "theme": theme, "difficulty": diff, "prompt": prompt,
         "sides": [{"name": p.name, "img": p.img, "value": fmt(v)} for p, v in items],
         "order": "".join("ABC"[i] for i in ranked),
         "answer": " > ".join(items[i][0].name for i in ranked)}
    bank.add(q)


@safe
def gen_order_it(bank, PL, famous):
    rnd = bank.rnd
    ok = [p for p in famous if p.ok]
    metrics = [
        ("career points, most first", "Record Book", lambda p: p.tot["PTS"], lambda v: f"{B.num(v)} pts"),
        ("career rebounds, most first", "Record Book", lambda p: p.tot["REB"], lambda v: f"{B.num(v)} reb"),
        ("career assists, most first", "Record Book", lambda p: p.tot["AST"], lambda v: f"{B.num(v)} ast"),
        ("career earnings, most first", "Money Talks", lambda p: sum(p.salary.values()), B.money),
        ("height, tallest first", "Draft & Bio", lambda p: B.height_in((p.bio or {}).get("HEIGHT")) or 0, lambda v: f"{v // 12}'{v % 12}\""),
        ("All-Star selections, most first", "Awards & Rings", lambda p: p.allstar, lambda v: f"{v}x All-Star"),
    ]
    for label, theme, f, fmt in metrics:
        pool = [p for p in ok if f(p)]
        for _ in range(70):
            three = rnd.sample(pool, 3)
            vals = [f(p) for p in three]
            if len(set(vals)) < 3:
                continue
            spread = (max(vals) - min(vals)) / max(1, max(vals))
            diff = "easy" if spread > 0.5 else "medium" if spread > 0.2 else "hard"
            order_q(bank, theme, diff, f"Put them in order: {label}", list(zip(three, vals)), fmt)


# =====================================================================================
# 13. Award voting (nba-player-data/awardVotes.json)
# =====================================================================================
AWARD_LABEL = {"MVP": "MVP", "DPOY": "Defensive Player of the Year", "ROY": "Rookie of the Year", "Sixth Man": "Sixth Man of the Year",
               "MIP": "Most Improved Player", "Clutch": "Clutch Player of the Year"}
ORD = {2: "2nd", 3: "3rd", 4: "4th", 5: "5th"}


@safe
def gen_award_votes(bank, PL, famous, src):
    rows = _load_json(src, "nba-player-data/awardVotes.json")
    if not rows:
        return
    races = collections.defaultdict(dict)
    for r in rows:
        y, a, rk = B.to_int(r.get("YEAR")), r.get("AWARD"), B.to_int(r.get("RNK"))
        if y and a in AWARD_LABEL and rk and y >= 2001:
            races[(a, y)].setdefault(rk, r["PLAYER"].strip())
    for (a, y), ranks in races.items():
        top = [ranks.get(i) for i in range(1, 7)]
        if not all(top[:5]):
            continue
        for place in (2, 3):
            right = ranks[place]
            wrong = [n for i, n in ranks.items() if i != place and i <= 6][:5]
            B.mc(bank, "Ratings & Votes", "hard" if place == 3 else "medium",
                 f"Who finished {ORD[place]} in the {B.season(y)} {AWARD_LABEL[a]} vote?", right, B.pick_others(bank.rnd, wrong, 3, {right}),
                 fact=f"{B.season(y)} {AWARD_LABEL[a]}: 1. {ranks[1]}, 2. {ranks[2]}, 3. {ranks[3]}")


# =====================================================================================
# 14. Draft combine (nba-draft-combine)
# =====================================================================================
def _inches(v):
    v = float(v)
    ft, inch = divmod(v, 12)
    return f"{int(ft)}'{inch:.2f}".rstrip("0").rstrip(".") + '"'


@safe
def gen_combine(bank, PL, famous, src):
    c = _load_json(src, "nba-draft-combine/data/combine.json")
    if not c:
        return
    best = {}
    for row in c["players"]:
        p = B.players_by_key_all.get(B.norm(row.get("player", "")))
        if B.okp(p):
            best[p.name] = (p, row["metrics"])
    metrics = [("Wingspan (in)", "Whose wingspan measured longer at the draft combine?", _inches),
               ("Max Vertical Leap (in)", "Who jumped higher at the draft combine? (max vertical)", lambda v: f'{float(v):g}"'),
               ("Standing reach (in)", "Whose standing reach was longer at the draft combine?", _inches),
               ("Hand Length (in)", "Who had the bigger hands at the draft combine? (hand length)", lambda v: f'{float(v):g}"')]
    rnd = bank.rnd
    for key, prompt, fmt in metrics:
        pool = [(p, m[key]["raw"]) for p, m in best.values() if m.get(key, {}).get("raw")]
        for _ in range(60):
            if len(pool) < 2:
                break
            (a, av), (b, bv) = rnd.sample(pool, 2)
            if abs(av - bv) < 0.75:
                continue
            B.hl(bank, "Draft & Bio", "medium", prompt, a, av, b, bv, fmt)


# =====================================================================================
# 15. Head to head since 2016-17 (aderoa/nba-boxscores)
# =====================================================================================
@safe
def gen_head_to_head(bank, PL, famous, src):
    games, played = {}, collections.defaultdict(dict)
    years = list(range(2017, 2027))
    for y in years:
        gp, bp = _path(src, f"nba-boxscores/data/{y}/games.ndjson"), _path(src, f"nba-boxscores/data/{y}/boxscores.ndjson")
        if not (os.path.exists(gp) and os.path.exists(bp)):
            continue
        for line in open(gp, encoding="utf-8"):
            g = json.loads(line)
            if not str(g.get("gameId", "")).startswith("002") or g.get("homeScore") is None or g.get("awayScore") is None:
                continue
            hw = g["homeScore"] > g["awayScore"]
            games[g["gameId"]] = {g["home"]: hw, g["away"]: not hw}
        for line in open(bp, encoding="utf-8"):
            r = json.loads(line)
            if r.get("min", 0) and r["gameId"] in games:
                played[B.norm(r["name"])][r["gameId"]] = r["team"]
    if not games:
        print("  (skipped: no box scores downloaded)")
        return
    stars = [p for p in famous if p.key in played and len(played[p.key]) >= 150 and p.fame >= 15 * B.STAR]
    rnd = bank.rnd
    seen = set()
    for _ in range(4000):
        if len(seen) >= 160:
            break
        a, b = rnd.sample(stars, 2)
        k = tuple(sorted((a.key, b.key)))
        if k in seen:
            continue
        ga, gb = played[a.key], played[b.key]
        both = [g for g in ga if g in gb and ga[g] != gb[g]]
        if len(both) < 12:
            continue
        aw = sum(1 for g in both if games[g][ga[g]])
        bw = len(both) - aw
        if aw == bw:
            continue
        seen.add(k)
        B.hl(bank, "Head to Head", "medium" if abs(aw - bw) >= 4 else "hard",
             f"Since 2016-17, who has won more of their head-to-head games?", a, aw, b, bw, lambda v: f"{v} wins",
             fact=f"{len(both)} regular-season games against each other")


# =====================================================================================
# 16. Clutch points and buzzer-beaters
# =====================================================================================
@safe
def gen_clutch(bank, PL, famous, src):
    p_ = _path(src, "clutch-leaderboard/clutch_splits.csv.gz")
    if os.path.exists(p_):
        tot = collections.Counter()
        with gzip.open(p_, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["ROW_TYPE"] == "PLAYER" and r["PHASE"] == "RS" and r["WINDOW"] == "w5":
                    tot[B.norm(r["PLAYER_NAME"])] += B.to_int(r["PTS"]) or 0
        pool = [(p, tot[p.key]) for p in famous if tot.get(p.key, 0) >= 300]
        for _ in range(90):
            (a, av), (b, bv) = bank.rnd.sample(pool, 2)
            if abs(av - bv) / max(av, bv) < 0.08:
                continue
            B.hl(bank, "Clutch & Streaks", "medium", "Who has scored more clutch points since 1996-97?", a, av, b, bv,
                 lambda v: f"{B.num(v)} pts", fact="Clutch: last 5 minutes, score within 5 points, regular season")
    bz = _load_json(src, "buzzer-beaters/docs/buzzer-beaters.json")
    if bz:
        names, rows = bz["shots"]["players"], bz["shots"]["rows"]
        gw = collections.Counter(names[r[2]] for r in rows if r[2] is not None and len(r) > 13 and r[13] and r[11])
        # "S. Curry" -> the one famous player with that initial and last name
        idx = collections.defaultdict(list)
        for p in famous:
            parts = p.name.split()
            if len(parts) >= 2:
                idx[f"{parts[0][0]}. {' '.join(parts[1:])}"].append(p)
        pool = [(idx[n][0], c) for n, c in gw.items() if len(idx.get(n, [])) == 1 and c >= 2]
        for _ in range(60):
            if len(pool) < 2:
                break
            (a, av), (b, bv) = bank.rnd.sample(pool, 2)
            B.hl(bank, "Clutch & Streaks", "hard", "Who has hit more buzzer-beating game-winners since 1996-97?", a, av, b, bv,
                 lambda v: f"{v} game-winners", fact="Made shots in the final seconds that won the game")


# =====================================================================================
# 17. Streaks (nba-stat-streaks)
# =====================================================================================
STREAK_LABEL = {"pts20": "20+ points", "pts30": "30+ points", "pts10": "10+ points", "reb10": "10+ rebounds", "ast10": "10+ assists",
                "dd": "a double-double", "td": "a triple-double", "stl2": "2+ steals", "blk3": "3+ blocks", "tpm3": "3+ threes"}


@safe
def gen_streaks(bank, PL, famous, src):
    p_ = _path(src, "nba-stat-streaks/streaks-data.js")
    if not os.path.exists(p_):
        print("  (skipped: streaks-data.js not downloaded)")
        return
    s = open(p_, encoding="utf-8").read()
    data, _ = json.JSONDecoder().raw_decode(s, s.index("=") + 1)
    by_pid = {pid_of(p): p for p in PL.values() if pid_of(p)}
    for key, label in STREAK_LABEL.items():
        rows = (data.get(key) or {}).get("regular") or []
        best = {}
        for r in rows:
            m = re.search(r"-(\d+)$", r[1])
            p = by_pid.get(int(m.group(1))) if m else None
            if B.okp(p) and p.name not in best:
                best[p.name] = (p, r[2])
        pool = list(best.values())
        for _ in range(25):
            if len(pool) < 2:
                break
            (a, av), (b, bv) = bank.rnd.sample(pool, 2)
            B.hl(bank, "Clutch & Streaks", "hard", f"Who had the longer streak of games with {label}?", a, av, b, bv,
                 lambda v: f"{v} straight", fact="Regular season, consecutive games")


# =====================================================================================
# 18. Beat Vegas today (nba-alt-standings)
# =====================================================================================
FULL = {"ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets", "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls",
        "CLE": "Cleveland Cavaliers", "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons", "GSW": "Golden State Warriors",
        "HOU": "Houston Rockets", "IND": "Indiana Pacers", "LAC": "LA Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
        "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves", "NOP": "New Orleans Pelicans", "NYK": "New York Knicks",
        "OKC": "Oklahoma City Thunder", "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns", "POR": "Portland Trail Blazers",
        "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs", "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards"}


@safe
def gen_vegas(bank, src):
    st = _load_json(src, "nba-alt-standings/data/standings.json")
    vg = _load_json(src, "nba-alt-standings/data/vegas_lines_2026-27.json")
    if not st or not vg:
        return
    rows = []
    for t, r in st["teams"].items():
        line = (vg["teams"].get(t) or {}).get("line")
        if line and r.get("gp", 0) >= 3:
            pace = 82 * r["w"] / r["gp"]
            rows.append((pace - line, t, r, line))
    if len(rows) < 8:
        return
    rows.sort(reverse=True)
    today = et_today().isoformat()
    for top, label in ((rows, "furthest AHEAD of"), (rows[::-1], "furthest BEHIND")):
        right = top[0]
        wrong = [x for x in bank.rnd.sample(top[5:], 3)]
        txt = lambda x: f"{FULL[x[1]]} ({x[2]['w']}-{x[2]['l']})"
        q_before = len(bank.qs)
        B.mc(bank, "Tonight in the NBA", "medium", f"Right now, which team is {label} its preseason Vegas win total?",
             txt(right), [txt(x) for x in wrong],
             fact=f"{FULL[right[1]]}: on pace for {82 * right[2]['w'] / right[2]['gp']:.0f} wins, Vegas said {right[3]}")
        if len(bank.qs) > q_before:
            bank.qs[-1]["validOn"] = today


# =====================================================================================
# 19. Arenas and crowds (nba-attendance)
# =====================================================================================
@safe
def gen_arenas(bank, src):
    p_ = _path(src, "nba-attendance/output/arena_baselines_all.csv")
    m_ = _path(src, "nba-attendance/data/arena_mapping.csv")
    if not os.path.exists(p_):
        print("  (skipped: arena data not downloaded)")
        return
    city = {}
    if os.path.exists(m_):
        for r in csv.DictReader(open(m_, encoding="utf-8-sig")):
            if r.get("type") == "home":
                city[r["building"]] = r["city"]
    by_season = collections.defaultdict(list)
    for r in csv.DictReader(open(p_, encoding="utf-8-sig")):
        if r["gameType"] == "Regular Season" and B.to_int(r["games"]) and B.to_int(r["games"]) >= 25 and B.to_float(r["mean_attendance"]):
            by_season[B.to_int(r["season"])].append((B.to_float(r["mean_attendance"]), r["building"]))
    lab = lambda b: f"{b} ({city[b]})" if b in city else b
    for y, rows in by_season.items():
        if y < 2005 or len(rows) < 20:
            continue
        rows.sort(reverse=True)
        for which, lst in (("biggest", rows), ("smallest", rows[::-1])):
            right = lst[0]
            wrong = bank.rnd.sample(lst[6:], 3)
            B.mc(bank, "Around the League", "hard", f"Which arena drew the {which} average crowd in {B.season(y)}?",
                 lab(right[1]), [lab(w[1]) for w in wrong], fact=f"{lab(right[1])}: {B.num(right[0])} fans a game")


# =====================================================================================
# 20. GM survey (nba-gm-survey)
# =====================================================================================
@safe
def gen_gm_survey(bank, src):
    p_ = _path(src, "nba-gm-survey/data/gm_survey.csv")
    if not os.path.exists(p_):
        print("  (skipped: gm_survey.csv not downloaded)")
        return
    qs = collections.defaultdict(list)
    for r in csv.DictReader(open(p_, encoding="utf-8-sig")):
        y, rk = B.to_int(r["season_end_year"]), B.to_int(r["rank"])
        if y and y >= 2012 and rk and r["answer"] and r["response_type"] == "ranked":
            qs[(y, r["question"].strip())].append((rk, r["answer"].strip(), r["percentage"]))
    for (y, ques), rows in qs.items():
        if len(ques) > 95 or "?" not in ques:
            continue
        rows.sort()
        names = list(dict.fromkeys(n for _, n, _ in rows))
        if len(names) < 4 or rows[0][0] != 1 or (len(rows) > 1 and rows[1][0] == 1):
            continue
        right = names[0]
        if right.lower() in ("other", "others", "none"):
            continue
        B.mc(bank, "Ratings & Votes", "hard", f"{B.season(y)} GM Survey: {ques}", right, names[1:4],
             fact=f"{right} got {rows[0][2]} of the GM votes")


# =====================================================================================
# 21. Referee round (nbareferees), one a night
# =====================================================================================
@safe
def gen_referees(bank, src):
    lb = _load_json(src, "nbareferees/data/leaderboards.json")
    if not lb:
        return
    boards = {"most_finals_games": "has worked the most NBA Finals games", "most_game7s": "has worked the most Game 7s",
              "most_career_games_active": "has worked the most career games among active referees",
              "most_playoff_games": "has worked the most playoff games"}
    for key, what in boards.items():
        rows = lb.get(key) or []
        if len(rows) < 10:
            continue
        right = rows[0]["name"]
        wrong = [r["name"] for r in bank.rnd.sample(rows[6:], 3)]
        B.mc(bank, "Around the League", "hard", f"Referee round: which official {what}?", right, wrong)
        if bank.qs and bank.qs[-1]["answer"] == right:
            bank.qs[-1]["rare"] = True


# =====================================================================================
# 2. Last night's top scorers (ESPN scoreboard, the same feed nba-alt-standings uses)
# =====================================================================================
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
ESPN_ABBR = {"GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS", "PHO": "PHX", "BRK": "BKN"}


@safe
def gen_last_night(bank, PL, src):
    day = et_today() - datetime.timedelta(days=1)
    dest = _path(src, f"espn/scoreboard-{day:%Y%m%d}.json")
    if not os.path.exists(dest) and os.environ.get("QUIZ_FETCH_ESPN") == "1":
        _fetch(ESPN.format(f"{day:%Y%m%d}"), dest)
    sb = _load_json(src, f"espn/scoreboard-{day:%Y%m%d}.json")
    if not sb:
        return
    today = et_today().isoformat()
    evs = sb.get("events", [])
    done = [e for e in evs if (e.get("status", {}).get("type", {}) or {}).get("completed")]
    print(f"    ESPN {day}: {len(evs)} games, {len(done)} final")
    if done:
        c0 = ((done[0].get("competitions") or [{}])[0].get("competitors") or [{}])[0]
        print("    leader boards seen:", [l.get("name") for l in (c0.get("leaders") or [])][:8], "keys:", sorted(c0.keys())[:20])
    for ev in sb.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        if not (ev.get("status", {}).get("type", {}).get("completed")):
            continue
        cs = comp.get("competitors") or []
        if len(cs) != 2:
            continue
        score = {}
        for c in cs:
            ab = (c.get("team") or {}).get("abbreviation", "")
            score[c.get("homeAway")] = (ESPN_ABBR.get(ab, ab), B.to_int(c.get("score")))
        for c in cs:
            ab = (c.get("team") or {}).get("abbreviation", "")
            code = ESPN_ABBR.get(ab, ab)
            if code not in FULL:
                continue
            opp = score["away" if c.get("homeAway") == "home" else "home"]
            pts_lead = next((l for l in (c.get("leaders") or []) if l.get("name") in ("points", "pointsPerGame")), None)
            if not pts_lead or not pts_lead.get("leaders"):
                continue
            top = pts_lead["leaders"][0]
            name = ((top.get("athlete") or {}).get("displayName") or "").strip()
            p = B.players_by_key_all.get(B.norm(name))
            if not p:
                print(f"    no player match for {name!r}")
                continue
            nick = B.NICK.get(code, FULL[code])
            onick = B.NICK.get(opp[0], opp[0])
            mine = B.to_int(c.get("score"))
            res = "beat" if mine > opp[1] else "lost to"
            clues = [f"Last night: {nick} {res} the {onick}, {mine}-{opp[1]}", f"He scored {top.get('displayValue')} points",
                     f"Team: {FULL[code]}"]
            before = len(bank.qs)
            B.guess(bank, "Tonight in the NBA", "medium", f"Who led the {nick} in scoring last night?", p, clues, B.players_by_key_all,
                    fact=f"{name}: {top.get('displayValue')} points vs. the {onick}")
            if len(bank.qs) > before:
                bank.qs[-1]["validOn"] = today


def run_all(bank, PL, famous, P, src):
    print("More formats:")
    gen_teammate_link(bank, PL, famous)
    gen_born_today(bank, PL, famous)
    gen_hometowns(bank, PL, famous)
    gen_before_nba(bank, PL, famous, src)
    gen_shot_charts(bank, PL, famous, src)
    gen_2k(bank, PL, famous, src)
    gen_pick_season(bank, PL, famous)
    gen_odd_one_out(bank, PL, famous)
    gen_order_it(bank, PL, famous)
    gen_award_votes(bank, PL, famous, src)
    gen_combine(bank, PL, famous, src)
    gen_head_to_head(bank, PL, famous, src)
    gen_clutch(bank, PL, famous, src)
    gen_streaks(bank, PL, famous, src)
    gen_vegas(bank, src)
    gen_arenas(bank, src)
    gen_gm_survey(bank, src)
    gen_referees(bank, src)
    gen_last_night(bank, PL, src)
