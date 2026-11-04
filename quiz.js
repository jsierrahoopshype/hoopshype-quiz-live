/* HoopsHype NBA Quiz Live: game engine and screen.
   Events (chat, gifts, likes, follows, shares) arrive from the local bridge (bridge/quiz-bridge.mjs)
   over /events, or from the built-in practice simulator when the page is opened with ?practice=1.

   Operator keys (click the quiz window first): N = skip question, P = pause/resume,
   B = start a blitz round, M = sound on/off, L = next look, R = reset stream scores. */
(() => {
'use strict';

// ------------------------------------------------------------------ config
const DEFAULTS = {
  imgBase: 'https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face-fill-320/',
  // cut-out head-and-uniform photos, used by the looks that show players without a circle frame
  cutBase: 'https://jsierrahoopshype.github.io/nba-headshots/players/headshots/head-uniform-480/',
  layout: 'broadcast',                 // starting look; press L in the quiz window to switch (the choice is remembered)
  questionsUrl: 'https://raw.githubusercontent.com/jsierrahoopshype/hoopshype-quiz-live/HEAD/data/questions.json',
  questionsPerGame: 8,
  battleSlot: 4,                       // a chat battle is dropped in as question #5 of every game
  // seconds per question: 12 at most when you pick an answer (A/B/C/D, true/false, A or B),
  // 15 at most when you have to type something (a player, a team, a number)
  times: { guess: 15, mc: 12, tf: 10, hl: 10, battle: 12, board: 15, closest: 15, anyof: 15, order: 12, predict: 10, speed: 6,
           reveal: 3.5, speedReveal: 2, intro: 4, recap: 6, voteResult: 3 },
  blitzTimes: { guess: 10, mc: 7, tf: 6, hl: 6, battle: 8, board: 10, closest: 10, anyof: 10, order: 8 },
  // game shows: every 3rd game is a Survivor game, every 2nd game ends with a 5-question speed round
  survivorEvery: 3, survivorBonus: 300, speedEvery: 2, speedBase: 25,
  // tonight's games (for Predict tonight) and their finals, from the public nba-alt-standings repo
  scheduleUrl: 'https://raw.githubusercontent.com/jsierrahoopshype/nba-alt-standings/HEAD/data/schedule_2026-27.json',
  finalsBase: 'https://raw.githubusercontent.com/jsierrahoopshype/nba-alt-standings/HEAD/data/games/',
  predictPoints: [300, 200, 100], predictExact: 500,
  points: { easy: 50, medium: 75, hard: 100, rank: [50, 30, 20], board: 40, battle: 20, follow: 25, share: 50, perCoin: 10, closest: [150, 100, 50], exact: 300 },
  typedMin: 15, statLineExtra: 5,
  currentShare: 0.65,                  // about 2 of every 3 questions are about today's players and this season
  afterFirstCorrect: 5,                // seconds left once somebody names the player
  likeGoal: 1500, likeGoalGrowth: 1.4,
  // The 4 theme-vote columns. Each is tied to one gift; every coin of that gift is one vote.
  // Names must match TikTok's gift names exactly. The bridge window prints every gift name it sees.
  themeGifts: ['Rose', 'Ice Cream Cone', 'GG', 'Finger Heart'],
  powerups: { hint: 30, double: 99, blitz: 199 },   // coin thresholds for any other gift
  blitzLength: 3,
  diffMix: { easy: 0.3, medium: 0.45, hard: 0.25 },   // was 50/40/10: harder games
};
let CFG = DEFAULTS;

// ------------------------------------------------------------------ looks
// Press L in the quiz window to switch. The pick is saved in saved/quiz-settings.json, shared by practice and LIVE.
// ?layout=matchup in the address previews one look without saving it.
const LAYOUTS = {
  broadcast: { name: 'Broadcast', cutouts: false },
  courtside: { name: 'Courtside', cutouts: false },
};
// Parked for now (Nov 2026: "just use Broadcast and Courtside"). Their styles stay in quiz.css; add them back here to bring them back.
const PARKED_LAYOUTS = {
  matchup: { name: 'Matchup', cutouts: true },        // the new Player Comparison videos: indigo, Poppins, team colours, cut-outs
  scoreboard: { name: 'Scoreboard', cutouts: true },
};
let LAYOUT = 'broadcast';
// Team colours (the trade card's table, picked to read on dark backgrounds)
const TEAM_COLORS = {
  ATL: '#E03A3E', BOS: '#00A35C', BKN: '#A1A1A4', CHA: '#00A3B4', CHI: '#CE1141', CLE: '#FDBB30', DAL: '#0A7BD1', DEN: '#FEC524',
  DET: '#C8102E', GSW: '#FFC72C', HOU: '#CE1141', IND: '#FDBB30', LAC: '#C8102E', LAL: '#FDB927', MEM: '#5D76A9', MIA: '#E0234E',
  MIL: '#2E9E5B', MIN: '#3D8BD1', NOP: '#B4975A', NYK: '#F58426', OKC: '#007AC1', ORL: '#0077C0', PHI: '#006BB6', PHX: '#E56020',
  POR: '#E03A3E', SAC: '#8A5CC2', SAS: '#C4CED4', TOR: '#CE1141', UTA: '#9B6BDF', WAS: '#E31837',
};
// Team logos in nba-headshots are filed by NBA team id
const LOGO_BASE = 'https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/';
const TEAM_IDS = { ATL: 37, BOS: 38, CLE: 39, NOP: 40, CHI: 41, DAL: 42, DEN: 43, GSW: 44, HOU: 45, LAC: 46, LAL: 47, MIA: 48, MIL: 49, MIN: 50, BKN: 51,
  NYK: 52, ORL: 53, IND: 54, PHI: 55, PHX: 56, POR: 57, SAC: 58, SAS: 59, OKC: 60, TOR: 61, UTA: 62, MEM: 63, WAS: 64, DET: 65, CHA: 66 };
const logoUrl = code => `${LOGO_BASE}${1610612700 + TEAM_IDS[code]}.svg`;
const params = new URLSearchParams(location.search);
const PRACTICE = params.has('practice');
const LAYOUT_PREVIEW = LAYOUTS[params.get('layout')] ? params.get('layout') : null;

// ------------------------------------------------------------------ utils
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const now = () => Date.now();
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = n => Math.round(n).toLocaleString('en-US');
function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
// Does a chat message name this player? Exact, contained as whole words, or a small typo.
function nameMatch(text, accept) {
  const t = norm(text);
  if (!t) return false;
  for (const a of accept) {
    if (t === a) return true;
    if (a.length >= 4 && (' ' + t + ' ').includes(' ' + a + ' ')) return true;
    const tol = a.length >= 10 ? 2 : a.length >= 6 ? 1 : 0;
    if (tol && lev(t, a) <= tol) return true;
  }
  return false;
}
function acceptFor(name) {
  const n = norm(name), parts = n.split(' ');
  const acc = [n];
  if (parts.length > 1 && parts[parts.length - 1].length >= 4) acc.push(parts[parts.length - 1]);
  return acc;
}
function parseNumber(text, q) {
  const s = String(text).toLowerCase().replace(/\s/g, '');
  const m = s.match(/\$?(\d[\d.,]*)(k|m|million|millones)?/);
  if (!m) return null;
  let raw = m[1];
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, '');   // 28,289 or 28.289
  else raw = raw.replace(/,/g, '.');
  let v = parseFloat(raw);
  if (!isFinite(v)) return null;
  const unit = m[2];
  const inMillions = /million/i.test(q.sub || '');
  if (unit === 'k') v *= 1000;
  if (unit && unit.startsWith('m') && !inMillions) v *= 1e6;
  if (inMillions && v >= 100000) v = v / 1e6;
  return v;
}
// Photo only when one exists: never an empty circle. A photo that fails to load removes its own frame.
// Looks with cut-outs (see LAYOUTS) show the head-and-uniform photo for big faces, falling back to the round face photo.
const photo = (f, cls = '') => {
  if (!f) return '';
  const cut = LAYOUTS[LAYOUT] && LAYOUTS[LAYOUT].cutouts && cls !== 'xs';
  const src = (cut ? CFG.cutBase : CFG.imgBase) + encodeURIComponent(f);
  return `<div class="photo ${cls}${cut ? ' cut' : ''}"><img src="${src}" alt="" data-f="${esc(f)}" onerror="HHQphotoErr(this)"></div>`;
};
window.HHQphotoErr = img => {
  const box = img.parentNode;
  if (box.classList.contains('cut')) { box.classList.remove('cut'); img.src = CFG.imgBase + encodeURIComponent(img.dataset.f); }
  else box.remove();
};
function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

// ------------------------------------------------------------------ sound (simple WebAudio blips, no files)
let audio = null, muted = false;
function beep(freq, dur = 0.12, type = 'sine', vol = 0.08) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audio.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur); o.stop(audio.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  correct: () => { beep(880, .1); setTimeout(() => beep(1320, .16), 90); },
  tick: () => beep(520, .05, 'square', .03),
  reveal: () => { beep(660, .12); setTimeout(() => beep(990, .2), 120); },
  gift: () => { beep(1046, .08, 'triangle'); setTimeout(() => beep(1568, .14, 'triangle'), 80); },
};

// ------------------------------------------------------------------ state
const S = {
  data: null, themes: [], used: new Set(store('hhq_used') || []),
  game: 0, theme: null, queue: [], qi: 0, q: null, phase: 'boot',
  tStart: 0, tEnd: 0, dur: 1, paused: false, pausedLeft: 0,
  answered: new Map(), correct: [], closest: new Map(), filled: [], battleVotes: [0, 0],
  gameScores: new Map(), streamScores: new Map(), gameTeams: new Map(),
  names: new Map(), streaks: new Map(), dry: 0, qLog: [], chatters: new Set(), seenToday: new Set(),
  voteThemes: [], votes: [0, 0, 0, 0],
  mult: 1, multBy: null, qMult: 1, blitzLeft: 0, blitzQueued: 0,
  likes: 0, likeGoal: DEFAULTS.likeGoal, likeBase: 0,
  revealPlan: null, struck: new Set(), stats: null, connected: false, statusText: '',
};
const displayName = u => S.names.get(u) || (P.names && P.names[u]) || u;
// Trophy count: every night and every week someone finished first. "🏆3" next to their name.
const trophies = u => { const t = P.titles && P.titles[u]; return t ? (t.n || 0) + (t.w || 0) : 0; };
const trophyTag = u => { const n = trophies(u); return n ? ` <span class="troph">🏆${n > 1 ? n : ''}</span>` : ''; };
// Name plus trophies plus team tag, e.g. "thunderup 🏆3 OKC"
const who = u => esc(displayName(u)) + trophyTag(u) + (P.teams[u] ? ` <span class="team">${P.teams[u]}</span>` : '');

// ------------------------------------------------------------------ standings that carry over between streams
// Saved by the bridge to saved/hoopshype-quiz-state.json. A "day" is a US Eastern date that ends at midnight ET.
// Weeks start Monday, so the weekly board resets at midnight ET going into Monday.
// log: every point scored in the last hour, as [unix seconds, user, points], for the rolling 15-minute and 1-hour boards
// titles: { user: { n: nights won, w: weeks won } }, kept forever. awarded: which nights/weeks were already handed out.
const P = { days: {}, weeks: {}, gifters: {}, teams: {}, names: {}, log: [], titles: {}, awarded: { n: [], w: [] }, preds: {}, rare: {} };
function etDate(d = new Date()) {
  return new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));   // the day ends at midnight ET
}
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nightKey = () => ymd(etDate());
function weekKey() { const d = etDate(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
const today = () => (P.days[nightKey()] ||= { scores: {} });
const thisWeek = () => (P.weeks[weekKey()] ||= { scores: {}, teams: {} });
function champion() {
  // top scorer of the most recent day before today
  const key = Object.keys(P.days).filter(k => k < nightKey()).sort().pop();
  if (!key) return null;
  const top = Object.entries(P.days[key].scores).sort((a, b) => b[1] - a[1])[0];
  return top ? { u: top[0], pts: top[1], night: key } : null;
}
function addPoints(u, pts) {
  if (!pts) return;
  S.gameScores.set(u, (S.gameScores.get(u) || 0) + pts);
  S.streamScores.set(u, (S.streamScores.get(u) || 0) + pts);
  const d = today().scores, w = thisWeek();
  d[u] = (d[u] || 0) + pts;
  w.scores[u] = (w.scores[u] || 0) + pts;
  const t = P.teams[u];
  if (t) { w.teams[t] = (w.teams[t] || 0) + pts; S.gameTeams.set(t, (S.gameTeams.get(t) || 0) + pts); }
  P.log.push([Math.floor(now() / 1000), u, pts]);
  pruneLog();
  saveSoon();
}
function pruneLog() {
  const cut = Math.floor(now() / 1000) - 3600;
  let i = 0; while (i < P.log.length && P.log[i][0] < cut) i++;
  if (i) P.log.splice(0, i);
}

// ------------------------------------------------------------------ standings: last 15 minutes, last hour, today, this week
// The 15-minute board is the one a new viewer can climb right away, so it leads the rotation and stays up longest.
const WINDOWS = [
  { key: 'm15', label: 'Last 15 min', short: '15 min', secs: 8 },
  { key: 'h1', label: 'Last hour', short: 'hour', secs: 5 },
  { key: 'night', label: 'Today', short: 'today', secs: 5 },
  { key: 'week', label: 'This week', short: 'week', secs: 5 },
];
function scoresFor(key) {
  if (key === 'night') return today().scores;
  if (key === 'week') return thisWeek().scores;
  const cut = Math.floor(now() / 1000) - (key === 'm15' ? 900 : 3600);
  const m = {};
  for (const [t, u, p] of P.log) if (t >= cut) m[u] = (m[u] || 0) + p;
  return m;
}
const ranked = key => Object.entries(scoresFor(key)).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
function rankOf(key, u) {
  const list = ranked(key), i = list.findIndex(e => e[0] === u);
  return i < 0 ? null : { pos: i + 1, pts: list[i][1], toTop10: i >= 10 ? list[9][1] - list[i][1] + 1 : 0, of: list.length };
}
// Personal rank: anyone can type RANK (or "my rank", "score", "me") to see their spot on all four boards
const RANK_WORDS = new Set(['rank', 'my rank', 'ranking', 'score', 'my score', 'me', 'where am i', 'points', 'my points', 'stats', 'rango', 'puesto']);
const rankAsked = new Map();
const rankQ = [];
let rankShowing = null, rankTimer = null;
function askRank(u) {
  if (now() - (rankAsked.get(u) || 0) < 20000) return;   // once every 20 seconds per person
  rankAsked.set(u, now());
  if (!rankQ.includes(u) && rankShowing !== u) rankQ.push(u);
  if (rankQ.length > 4) rankQ.shift();
  if (!rankTimer) nextRank();
}
function nextRank() {
  rankShowing = rankQ.shift() || null;
  renderMe();
  renderStandings();
  rankTimer = rankShowing ? setTimeout(nextRank, 3600) : null;
}
function rankLine(u) {
  const parts = WINDOWS.map(w => { const r = rankOf(w.key, u); return `<span class="rk"><b>${r ? '#' + r.pos : '-'}</b> ${w.short}</span>`; });
  const r15 = rankOf('m15', u);
  const tail = !r15 ? 'Answer one to get on the board'
    : r15.pos === 1 ? 'Top of the last 15 minutes'
    : r15.pos <= 10 ? `${fmt(ranked('m15')[r15.pos - 2][1] - r15.pts + 1)} pts to move up`
    : `${fmt(r15.toTop10)} pts to the Top 10`;
  return `<span class="me-name">${who(u)}</span>${parts.join('')}<span class="me-tail">${tail}</span>`;
}
function renderMe() {
  const el = $('#st-me');
  if (!el) return;
  el.classList.toggle('on', !!rankShowing);
  el.innerHTML = rankShowing ? rankLine(rankShowing) : '<span>Type <b>RANK</b> in the chat to see your spot on all four boards</span>';
}
let saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 4000); }
async function saveNow() {
  // keep the file small: 3 weeks of nights, 8 weeks of weekly boards
  const dk = Object.keys(P.days).sort(); while (dk.length > 21) delete P.days[dk.shift()];
  const wk = Object.keys(P.weeks).sort(); while (wk.length > 8) delete P.weeks[wk.shift()];
  pruneLog();
  const body = JSON.stringify(P);
  try { const r = await fetch('/state' + (PRACTICE ? '?practice=1' : ''), { method: 'POST', body }); if (!r.ok) throw 0; }
  catch (e) { store(PRACTICE ? 'hhq_state_practice' : 'hhq_state', P); }   // no bridge (e.g. opened from GitHub): keep it in the browser
}
async function loadState() {
  let saved = null;
  try { const r = await fetch('/state' + (PRACTICE ? '?practice=1' : ''), { cache: 'no-store' }); if (r.ok) saved = await r.json(); } catch (e) {}
  if (!saved || !Object.keys(saved).length) saved = store(PRACTICE ? 'hhq_state_practice' : 'hhq_state') || {};
  Object.assign(P, { days: {}, weeks: {}, gifters: {}, teams: {}, names: {}, log: [], titles: {}, awarded: { n: [], w: [] }, preds: {}, rare: {} }, saved);
  if (!Array.isArray(P.log)) P.log = [];
  pruneLog();
}

// Hand out titles for every finished night and week that hasn't been awarded yet (runs at start-up and every minute)
function awardTitles() {
  const give = (kind, key, scores) => {
    if (P.awarded[kind].includes(key)) return;
    P.awarded[kind].push(key);
    const top = Object.entries(scores || {}).sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] <= 0) return;
    const t = (P.titles[top[0]] ||= { n: 0, w: 0 });
    t[kind] += 1;
    addAlert(`<b>${esc(displayName(top[0]))}</b> won ${kind === 'n' ? 'yesterday' : 'last week'}: 🏆${trophies(top[0])}`);
  };
  Object.keys(P.days).filter(k => k < nightKey()).sort().forEach(k => give('n', k, P.days[k].scores));
  Object.keys(P.weeks).filter(k => k < weekKey()).sort().forEach(k => give('w', k, P.weeks[k].scores));
  P.awarded.n = P.awarded.n.slice(-60); P.awarded.w = P.awarded.w.slice(-20);
  saveSoon();
}

// The defending champion gets called out the first time they chat each night
function greetChampion(u) {
  const c = champion();
  if (!c || c.u !== u || S.seenToday.has(u)) return;
  S.seenToday.add(u);
  addAlert(`Defending champion <b>${esc(displayName(u))}</b> is here. Can anyone beat them?`);
}

// ------------------------------------------------------------------ team battle
// Viewers type their team once (code, nickname or city) to join. "team bos" or "join celtics" switches.
const TEAMS = {
  ATL: ['Hawks', 'atlanta'], BOS: ['Celtics', 'boston'], BKN: ['Nets', 'brooklyn', 'bkn', 'bk'], CHA: ['Hornets', 'charlotte', 'cha'],
  CHI: ['Bulls', 'chicago'], CLE: ['Cavaliers', 'cleveland', 'cavs'], DAL: ['Mavericks', 'dallas', 'mavs'], DEN: ['Nuggets', 'denver'],
  DET: ['Pistons', 'detroit'], GSW: ['Warriors', 'golden state', 'dubs', 'gs'], HOU: ['Rockets', 'houston'], IND: ['Pacers', 'indiana'],
  LAC: ['Clippers', 'clips'], LAL: ['Lakers', 'lake show'], MEM: ['Grizzlies', 'memphis', 'grizz'], MIA: ['Heat', 'miami'],
  MIL: ['Bucks', 'milwaukee'], MIN: ['Timberwolves', 'minnesota', 'wolves'], NOP: ['Pelicans', 'new orleans', 'pels', 'nola'],
  NYK: ['Knicks', 'new york', 'ny'], OKC: ['Thunder', 'oklahoma city', 'okc'], ORL: ['Magic', 'orlando'], PHI: ['76ers', 'philadelphia', 'sixers', 'philly'],
  PHX: ['Suns', 'phoenix', 'phx', 'phoenix suns'], POR: ['Trail Blazers', 'portland', 'blazers'], SAC: ['Kings', 'sacramento'],
  SAS: ['Spurs', 'san antonio', 'sa'], TOR: ['Raptors', 'toronto', 'raps'], UTA: ['Jazz', 'utah', 'uta'], WAS: ['Wizards', 'washington', 'wiz', 'wsh'],
};
const TEAM_LOOKUP = (() => {
  const m = new Map();
  for (const [code, [nick, ...more]] of Object.entries(TEAMS)) [code, nick, ...more].forEach(a => m.set(norm(a), code));
  return m;
})();
function teamFromChat(text) {
  let t = norm(text);
  const m = t.match(/^(?:team|join|go|im|i am|vamos|let s go|lets go)\s+(.+)$/);
  if (m) t = m[1];
  const code = TEAM_LOOKUP.get(t) || null;
  // "magic" alone is usually Magic Johnson, not Orlando: needs "team magic"
  if (code && !m && t === 'magic') return null;
  return code ? { code, explicit: !!m } : null;
}
function maybeJoinTeam(u, text) {
  const hit = teamFromChat(text);
  if (!hit) return;
  // A bare team name (often an answer, like "Lakers" for "who drafted him?") only joins if you have no team yet.
  // Switching teams needs "team bos" or "join celtics".
  if (P.teams[u] && !hit.explicit) return;
  const code = hit.code;
  if (P.teams[u] === code) return;
  P.teams[u] = code;
  addAlert(`<b>${esc(displayName(u))}</b> joined Team ${TEAMS[code][0]}`);
  renderBoards(); saveSoon();
}
const isTF = q => q.type === 'mc' && q.options.length === 2 && q.options[0] === 'True';

// ------------------------------------------------------------------ question picking
// Dated questions: "last night" and Vegas questions are only good on the day they were built for,
// birthdays only on that day of the year, and the referee round runs once a night.
const etToday = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); return d; };
function usableToday(q) {
  // dated questions (this season's numbers, last night's games) are rebuilt about 5:45am ET, so yesterday's
  // copy keeps working until 8am ET
  if (q.validOn && q.validOn !== nightKey() && !(q.validOn === ymd(new Date(etDate().getTime() - 864e5)) && etDate().getHours() < 8)) return false;
  if (q.mmdd) { const d = etDate(); if (q.mmdd !== `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`) return false; }
  if (q.rare && P.rare && P.rare[nightKey()]) return false;
  return true;
}
const is2K = q => / 2K\d/.test(q.prompt || '');
const CHOICE = q => q.type === 'mc' || q.type === 'hl' || q.type === 'order';
function pickQueue(theme, opts = {}) {
  const all = S.data.questions;
  const base = q => q.type !== 'battle' && !(q.type === 'board' && q.slots.length > 6) && usableToday(q) && (!opts.choiceOnly || CHOICE(q));
  // boards with more than 6 names can't be filled in 15 seconds, so they sit out
  const pool = all.filter(q => base(q) && (theme === 'Mixed' || q.theme === theme));
  let fresh = pool.filter(q => !S.used.has(q.id));
  if (fresh.length < CFG.questionsPerGame * 2) {           // theme exhausted: forget its history
    pool.forEach(q => S.used.delete(q.id)); fresh = pool.slice();
  }
  const byDiff = { easy: [], medium: [], hard: [] };
  shuffle(fresh).forEach(q => (byDiff[q.difficulty] || byDiff.medium).push(q));
  const out = [], typeCount = {};
  const cap = { board: 1, closest: 2, order: 2, anyof: 2 };
  let guard = 0;
  while (out.length < CFG.questionsPerGame && guard++ < 400) {
    const r = Math.random();
    const d = r < CFG.diffMix.easy ? 'easy' : r < CFG.diffMix.easy + CFG.diffMix.medium ? 'medium' : 'hard';
    const list = byDiff[d].length ? byDiff[d] : (byDiff.medium.length ? byDiff.medium : byDiff.easy.length ? byDiff.easy : byDiff.hard);
    if (!list.length) break;
    const ok = q => (typeCount[q.type] || 0) < (cap[q.type] ?? 99) && (!out.length || out[out.length - 1].type !== q.type || guard > 200)
      && !(q.rare && out.some(x => x.rare)) && !(is2K(q) && out.some(is2K));
    // lean on today's players and this season; history fills the rest
    const wantCur = Math.random() < CFG.currentShare;
    let idx = list.findIndex(q => ok(q) && !!q.cur === wantCur);
    if (idx < 0) idx = list.findIndex(ok);
    if (idx < 0) { list.shift(); continue; }
    const q = list.splice(idx, 1)[0];
    typeCount[q.type] = (typeCount[q.type] || 0) + 1;
    out.push(q);
  }
  // a small theme (like Tonight in the NBA) is topped up with anything else
  if (out.length < CFG.questionsPerGame) {
    const ids = new Set(out.map(q => q.id));
    const extra = shuffle(all.filter(q => base(q) && !ids.has(q.id) && !S.used.has(q.id) && q.type !== 'board' && !q.rare));
    while (out.length < CFG.questionsPerGame && extra.length) { const q = extra.shift(); if (!(is2K(q) && out.some(is2K))) out.push(q); }
  }
  if (!opts.choiceOnly) {
    let battles = shuffle(all.filter(q => q.type === 'battle' && !S.used.has(q.id)));
    if (Math.random() < 0.8) battles = battles.filter(q => q.cur).concat(battles.filter(q => !q.cur));
    if (battles.length && out.length > CFG.battleSlot) out.splice(CFG.battleSlot, 0, battles[0]);
    // Predict tonight: one of tonight's games that hasn't tipped off yet, as question 3
    const pq = predictQuestion();
    if (pq) out.splice(Math.min(2, out.length), 0, pq);
  }
  if (opts.speed) {
    // speed round: five true-or-false questions in a row, 6 seconds each, points doubling
    const tf = shuffle(all.filter(q => isTF(q) && usableToday(q) && !S.used.has(q.id) && !out.includes(q))).slice(0, 5);
    tf.forEach((q, i) => out.push(Object.assign({}, q, { speed: i + 1 })));
  }
  return out;
}
async function reloadQuestions() {
  try {
    const r = await fetch(CFG.questionsUrl, { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    if (d && d.questions && d.questions.length > 1000) {
      S.data = d;
      S.themes = S.data.themes.filter(t => S.data.questions.filter(q => q.theme === t && usableToday(q)).length >= CFG.questionsPerGame * 2);
    }
  } catch (e) {}
}
function markUsed(q) { S.used.add(q.id); store('hhq_used', [...S.used].slice(-4000)); }
function rollVoteThemes() {
  const options = shuffle(S.themes.filter(t => t !== S.theme));
  S.voteThemes = options.slice(0, 3).concat(S.theme === 'Mixed' ? [options[3]] : ['Mixed']);
  S.votes = [0, 0, 0, 0];
  renderVote();
}

// ------------------------------------------------------------------ Predict tonight
// One of tonight's games that hasn't started: chat guesses the combined final score. Guesses are saved, and the
// next time the quiz runs after the game it reads the final from nba-alt-standings and pays the closest three.
let SCHEDULE = [];
async function loadSchedule() {
  try { const r = await fetch(CFG.scheduleUrl, { cache: 'no-store' }); if (r.ok) SCHEDULE = (await r.json()).games || []; } catch (e) {}
}
const TEAM_FULL = c => (TEAMS[c] ? TEAMS[c][0] : c);
function predictQuestion() {
  const tonight = nightKey(), soon = now() + 10 * 60 * 1000;
  const g = SCHEDULE.find(g => g.date === tonight && Date.parse(g.tip) > soon && !(P.preds[g.key] && P.preds[g.key].asked));
  if (!g) return null;
  return { type: 'closest', predict: { key: g.key, date: g.date }, theme: 'Tonight in the NBA', difficulty: 'medium', id: 'predict-' + g.key,
    prompt: `Predict tonight: ${TEAM_FULL(g.away)} at ${TEAM_FULL(g.home)}. Total points?`, sub: 'Both teams combined. Closest guess wins at the next stream',
    value: 0, answer: '' };
}
function lockPrediction(q) {
  const k = q.predict.key;
  const rec = (P.preds[k] ||= { date: q.predict.date, label: q.prompt.replace(/^Predict tonight: /, '').replace(/\. Total points\?$/, ''), entries: {}, asked: true });
  rec.asked = true;
  for (const [u, a] of S.closest) rec.entries[u] = Math.round(a.v);
  saveSoon();
}
async function settlePredictions() {
  for (const [k, rec] of Object.entries(P.preds)) {
    if (rec.date >= nightKey()) continue;                       // game is tonight or later
    let fin = null;
    try { const r = await fetch(`${CFG.finalsBase}${rec.date}/${k.split('_')[1]}.json`, { cache: 'no-store' }); if (r.ok) fin = await r.json(); } catch (e) {}
    const total = fin && fin.home && fin.away && fin.home.score != null ? fin.home.score + fin.away.score : null;
    if (total == null) { if (Date.parse(rec.date) < now() - 4 * 864e5) delete P.preds[k]; continue; }   // never finished: drop after 4 days
    const rows = Object.entries(rec.entries).map(([u, v]) => ({ u, v, d: Math.abs(v - total) })).sort((a, b) => a.d - b.d).slice(0, 3);
    rows.forEach((r, i) => addPoints(r.u, r.d === 0 ? CFG.predictExact : CFG.predictPoints[i]));
    addAlert(`Prediction result: ${esc(rec.label)} finished with <b>${total}</b> points.` +
      (rows.length ? ` Closest: <b>${esc(displayName(rows[0].u))}</b> (${rows[0].v}) +${rows[0].d === 0 ? CFG.predictExact : CFG.predictPoints[0]}` : ' Nobody guessed'));
    delete P.preds[k];
    saveSoon();
  }
}

// ------------------------------------------------------------------ game flow
function setPhase(p, secs) { S.phase = p; S.tStart = now(); S.dur = secs * 1000; S.tEnd = S.tStart + S.dur; S._lastTick = null; }
function startGame(theme) {
  S.game += 1;
  S.theme = theme;
  // game shows: Survivor every 3rd game (pick-an-answer questions only), a speed round at the end of every 2nd game
  S.survivor = S.game % CFG.survivorEvery === 0 ? { alive: new Set(), out: new Set(), started: false, over: false } : null;
  S.queue = pickQueue(theme, { choiceOnly: !!S.survivor, speed: !S.survivor && S.game % CFG.speedEvery === 0 });
  S.qi = 0; S.q = null;
  S.gameScores = new Map(); S.gameTeams = new Map(); S.qLog = []; S.dry = 0;
  S.stats = { answers: 0, players: new Set(), fastest: null, coins: 0 };
  rollVoteThemes();
  setPhase('intro', CFG.times.intro);
  renderIntro();
}
function nextQuestion() {
  if (S.qi >= S.queue.length) return endGame();
  const q = S.queue[S.qi];
  S.q = q; S.answered = new Map(); S.correct = []; S.closest = new Map(); S.struck = new Set(); S.chatters = new Set();
  S.filled = q.slots ? q.slots.map(() => null) : [];
  S.battleVotes = [0, 0];
  if (S.blitzQueued && !S.blitzLeft) { S.blitzLeft = S.blitzQueued; S.blitzQueued = 0; addAlert('<b>BLITZ ROUND</b>: double points, half the time'); }
  const blitz = S.blitzLeft > 0;
  const tType = q.speed ? 'speed' : q.predict ? 'predict' : isTF(q) ? 'tf' : q.type;
  let secs = (blitz && !q.speed ? CFG.blitzTimes[tType] : null) || CFG.times[tType] || 15;
  if (q.type === 'guess' || q.type === 'anyof') secs = typedSecs(q);
  S.qMult = (blitz ? 2 : 1) * S.mult;
  if (q.speed === 1) addAlert('<b>SPEED ROUND</b>: 5 true-or-false, 6 seconds each, points double every question');
  if (q.type === 'order') S.orderAns = new Map();
  setPhase('question', secs);
  planReveals(q, secs);
  renderQuestion();
  preload(S.queue[S.qi + 1]);
}
// Typed answers (a player or team name): at least 15 seconds or one second per character, whichever is longer,
// even in a blitz. "Whose season is this?" stat lines get 5 more seconds to read the table.
function typedSecs(q) {
  const chars = String(q.answer || '').length;
  return Math.max(CFG.typedMin, chars) + (q.statLine || /season is this/i.test(q.prompt || '') ? CFG.statLineExtra : 0);
}
function endQuestion() {
  const q = S.q;
  markUsed(q);
  if (q.type === 'mc' || q.type === 'hl') scoreChoice(q);
  if (q.type === 'order') scoreOrder(q);
  if (q.type === 'closest' && !q.predict) scoreClosest(q);
  if (q.predict) lockPrediction(q);
  if (q.type === 'battle') scoreBattle(q);
  if (q.rare) { P.rare[nightKey()] = true; saveSoon(); }
  if (S.survivor && CHOICE(q)) survivorStep(q);
  if (S.blitzLeft > 0) S.blitzLeft -= 1;
  if (S.mult > 1) { S.mult = 1; S.multBy = null; }
  logQuestion(q);
  setPhase('reveal', q.speed ? CFG.times.speedReveal : CFG.times.reveal);
  sfx.reveal();
  renderReveal();
}
// For the recap card ("hardest question") and for easing difficulty when chat keeps missing
function logQuestion(q) {
  if (q.type === 'battle') return;
  const got = q.type === 'board' ? S.filled.filter(f => f && !f.hint).length : q.type === 'closest' ? S.closest.size : S.correct.length;
  const tried = q.type === 'mc' || q.type === 'hl' || q.type === 'order' ? S.answered.size : q.type === 'closest' ? S.closest.size : S.chatters.size;
  const total = q.type === 'board' ? q.slots.length : tried;
  S.qLog.push({ q, got, tried, ratio: total ? got / total : 0 });
  // closest-number questions always have a "winner", so they don't count as a miss
  if (q.type !== 'closest') S.dry = got === 0 ? S.dry + 1 : 0;
  if (S.dry >= 3) { easeUp(); S.dry = 0; }
}
// Nobody got 3 in a row: swap the rest of this game's questions for easy ones from the same theme
function easeUp() {
  const all = S.data.questions;
  const inQueue = new Set(S.queue.map(q => q.id));
  const pool = shuffle(all.filter(q => q.difficulty === 'easy' && q.type !== 'battle' && !S.used.has(q.id) && !inQueue.has(q.id)
    && (S.theme === 'Mixed' || q.theme === S.theme)));
  let swapped = 0;
  for (let i = S.qi + 1; i < S.queue.length; i++) {
    const q = S.queue[i];
    if (q.type === 'battle' || q.difficulty === 'easy') continue;
    const j = pool.findIndex(x => x.type !== 'board');
    if (j < 0) break;
    S.queue[i] = pool.splice(j, 1)[0]; swapped++;
  }
  S.eased = swapped > 0;
}
function endGame() {
  S.survivorPaid = survivorPayout();
  setPhase('recap', CFG.times.recap); renderRecap(); makeRecapCards(); saveNow();
}
function afterRecap() {
  let best = -1, idx = 0;
  S.votes.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  S.nextTheme = best > 0 ? S.voteThemes[idx] : rnd(S.voteThemes);
  setPhase('voteResult', CFG.times.voteResult);
  renderVoteResult(S.nextTheme, best);
}
function tick() {
  if (S.paused || !S.data) return;
  const left = S.tEnd - now();
  updateClock(left);
  if (S.phase === 'question') {
    progressiveReveal();
    const sec = Math.ceil(left / 1000);
    if (left <= 5000 && left > 0 && sec !== S._lastTick) { S._lastTick = sec; sfx.tick(); }
  }
  if (left > 0) return;
  if (S.phase === 'intro') nextQuestion();
  else if (S.phase === 'question') endQuestion();
  else if (S.phase === 'reveal') { S.qi += 1; nextQuestion(); }
  else if (S.phase === 'recap') afterRecap();
  else if (S.phase === 'voteResult') startGame(S.nextTheme);
}

// ------------------------------------------------------------------ letter reveal plan
function planReveals(q, secs) {
  S.revealPlan = null;
  if (q.type !== 'guess') return;
  const letters = [];
  [...q.answer].forEach((c, i) => { if (/[a-z0-9]/i.test(c)) letters.push(i); });
  const order = shuffle(letters.slice()).slice(0, Math.floor(letters.length * 0.45));
  // with only 15 seconds, open with most clues showing and unlock the rest in the first half
  const startClues = Math.max(2, Math.ceil(q.clues.length * 0.6));
  const extra = q.clues.length - startClues;
  const T = secs * 1000;
  S.revealPlan = {
    shownLetters: new Set(),
    letterTimes: order.map((idx, i) => ({ idx, at: T * (0.2 + 0.75 * (i + 1) / (order.length + 1)) })),
    clueTimes: Array.from({ length: extra }, (_, i) => T * (0.05 + 0.45 * (i + 1) / (extra + 1))),
    shownClues: startClues, total: letters.length, zoom: q.imageMode === 'zoom',
  };
}
function progressiveReveal() {
  const P = S.revealPlan;
  if (!P) return;
  const t = now() - S.tStart;
  let changed = false;
  while (P.clueTimes.length && t >= P.clueTimes[0]) { P.clueTimes.shift(); P.shownClues++; changed = true; }
  while (P.letterTimes.length && t >= P.letterTimes[0].at) { P.shownLetters.add(P.letterTimes.shift().idx); changed = true; }
  if (changed) renderGuess();
  if (P.zoom) {
    const i = $('.zoombox img');
    if (i) i.style.transform = `scale(${(3.4 - 2.4 * Math.min(1, t / (S.dur * 0.85))).toFixed(3)})`;
  }
}
function hintNow(by) {
  const q = S.q;
  if (S.phase !== 'question' || !q) return;
  if (q.type === 'guess' && S.revealPlan) {
    const P = S.revealPlan;
    if (P.clueTimes.length) { P.clueTimes.shift(); P.shownClues++; }
    if (P.letterTimes.length) P.shownLetters.add(P.letterTimes.shift().idx);
    renderGuess();
    addAlert(`<b>${esc(by)}</b> unlocked a hint for everyone`);
  } else if (q.type === 'mc' && q.options.length > 2) {
    const wrong = q.options.map((_, i) => i).filter(i => i !== q.correct && !S.struck.has(i));
    if (wrong.length > 1) { S.struck.add(rnd(wrong)); renderQuestion(true); }
    addAlert(`<b>${esc(by)}</b> knocked out a wrong answer`);
  } else if (q.type === 'board') {
    const open = S.filled.map((f, i) => f ? null : i).filter(i => i != null);
    if (open.length) { S.filled[rnd(open)] = { u: null, hint: true }; renderQuestion(true); }
    addAlert(`<b>${esc(by)}</b> revealed a name on the board`);
  } else {
    S.tEnd += 8000; S.dur += 8000;
    addAlert(`<b>${esc(by)}</b> added 8 seconds`);
  }
}

// ------------------------------------------------------------------ answers
function onChat(u, text) {
  if (S.stats) S.stats.players.add(u);
  greetChampion(u);
  if (RANK_WORDS.has(norm(text).replace(/^!/, ''))) return askRank(u);
  maybeJoinTeam(u, text);
  const q = S.q;
  if (S.phase !== 'question' || !q || S.paused) return;
  S.chatters.add(u);
  if (q.type === 'guess') return answerGuess(q, u, text);
  if (q.type === 'mc') return answerChoice(q, u, choiceIndex(q, text));
  if (q.type === 'hl' || q.type === 'battle') return answerChoice(q, u, sideIndex(q, text));
  if (q.type === 'board') return answerBoard(q, u, text);
  if (q.type === 'closest') return answerClosest(q, u, text);
  if (q.type === 'anyof') return answerAnyOf(q, u, text);
  if (q.type === 'order') return answerOrder(q, u, text);
}
// ---- Teammates: any of several names is right. Each person scores once.
function answerAnyOf(q, u, text) {
  if (S.correct.some(c => c.u === u)) return;
  const hit = q.answers.find(a => nameMatch(text, a.accept));
  if (!hit) return;
  const rank = S.correct.length;
  registerCorrect(u, basePoints(q) + (CFG.points.rank[rank] || 0) * (S.qMult || 1));
  S.correct[S.correct.length - 1].said = hit.name;
}
// ---- Order it: type the three letters, e.g. BAC. Your first answer counts.
function answerOrder(q, u, text) {
  if (S.orderAns.has(u)) return;
  const t = String(text).toUpperCase().replace(/[^ABC]/g, '');
  if (t.length !== 3 || new Set(t).size !== 3) return;
  S.orderAns.set(u, { t, at: now() });
  S.answered.set(u, { idx: t === q.order ? 1 : 0, at: now() });
  S.stats.answers++;
  renderLive();
}
function scoreOrder(q) {
  const rows = [...S.orderAns.entries()].sort((a, b) => a[1].at - b[1].at);
  let rank = 0;
  for (const [u, a] of rows) {
    if (a.t === q.order) { registerCorrect(u, basePoints(q) + (CFG.points.rank[rank++] || 0) * (S.qMult || 1), true); }
    else if (a.t[0] === q.order[0]) { addPoints(u, Math.round(basePoints(q) * 0.4)); S.streaks.set(u, 0); S.partial = (S.partial || 0) + 1; }
    else S.streaks.set(u, 0);
  }
}
// ---- Survivor: answer every question right or you're out
function survivorStep(q) {
  const sv = S.survivor;
  if (sv.over) return;
  const right = new Set(S.correct.map(c => c.u));
  const answered = new Set(S.answered.keys());
  if (!sv.started) {
    answered.forEach(u => (right.has(u) ? sv.alive : sv.out).add(u));
    sv.started = answered.size > 0;
    sv.lastOut = sv.out.size;
    return;
  }
  let knocked = 0;
  for (const u of [...sv.alive]) if (!right.has(u)) { sv.alive.delete(u); sv.out.add(u); knocked++; }
  sv.lastOut = knocked;
  if (!sv.alive.size) sv.over = true;
}
function survivorPayout() {
  const sv = S.survivor;
  if (!sv || !sv.alive.size) return 0;
  const pts = CFG.survivorBonus * (sv.alive.size <= 3 ? 2 : 1);   // the last few standing get double
  sv.alive.forEach(u => addPoints(u, pts));
  return pts;
}
function choiceIndex(q, text) {
  const t = norm(text);
  if (isTF(q)) {
    if (['true', 't', 'yes', 'si', 'v', 'verdadero'].includes(t)) return 0;
    if (['false', 'f', 'no', 'falso'].includes(t)) return 1;
    return null;
  }
  const m = t.match(/^(?:option )?([abcd1-4])$/);
  if (m) return { a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3 }[m[1]];
  for (let i = 0; i < q.options.length; i++) {
    const o = norm(q.options[i]);
    if (t === o || (/[a-z]/.test(o) && nameMatch(text, acceptFor(q.options[i])))) return i;
  }
  return null;
}
function sideIndex(q, text) {
  const t = norm(text);
  if (['a', '1'].includes(t)) return 0;
  if (['b', '2'].includes(t)) return 1;
  for (let i = 0; i < 2; i++) if (nameMatch(text, acceptFor(q.sides[i].name))) return i;
  return null;
}
const basePoints = q => (q.speed ? CFG.speedBase * 2 ** (q.speed - 1) : (CFG.points[q.difficulty] || 60)) * (S.qMult || 1);
function answerGuess(q, u, text) {
  if (S.correct.some(c => c.u === u) || !nameMatch(text, q.accept)) return;
  const P = S.revealPlan;
  const frac = P && P.total ? P.shownLetters.size / P.total : 0;
  const rank = S.correct.length;
  registerCorrect(u, Math.round(basePoints(q) * (1 - 0.5 * frac)) + (CFG.points.rank[rank] || 0) * (S.qMult || 1));
  // the first right answer speeds up the end, but every typed question stays up at least 15 seconds
  // (20 for "Whose season is this?"), so everyone gets to read it and see the picture
  if (rank === 0) S.tEnd = Math.max(Math.min(S.tEnd, now() + CFG.afterFirstCorrect * 1000), S.tStart + minShowSecs(q) * 1000);
}
const minShowSecs = q => CFG.typedMin + (/season is this/i.test(q.prompt || '') ? CFG.statLineExtra : 0);
function answerChoice(q, u, idx) {
  if (idx == null || S.answered.has(u)) return;      // first answer counts: no spamming every option
  if (q.type === 'mc' && S.struck.has(idx)) return;
  S.answered.set(u, { idx, at: now() });
  S.stats.answers++;
  if (q.type === 'battle') S.battleVotes[idx]++;
  renderLive();
}
function scoreChoice(q) {
  const right = [...S.answered.entries()].filter(([, a]) => a.idx === q.correct).sort((a, b) => a[1].at - b[1].at);
  right.forEach(([u], rank) => registerCorrect(u, basePoints(q) + (CFG.points.rank[rank] || 0) * (S.qMult || 1), true));
  [...S.answered.entries()].filter(([, a]) => a.idx !== q.correct).forEach(([u]) => S.streaks.set(u, 0));
}
function scoreBattle() {
  const [a, b] = S.battleVotes;
  S.battleWin = a === b ? -1 : (a > b ? 0 : 1);
  if (S.battleWin < 0) return;
  const pts = CFG.points.battle * (S.qMult || 1);
  [...S.answered.entries()].filter(([, x]) => x.idx === S.battleWin).forEach(([u]) => { addPoints(u, pts); S.correct.push({ u, pts }); });
}
function answerBoard(q, u, text) {
  let hit = false;
  q.slots.forEach((s, i) => { if (!S.filled[i] && nameMatch(text, s.accept)) { S.filled[i] = { u }; hit = true; } });
  if (!hit) return;
  const pts = CFG.points.board * (S.qMult || 1);
  addPoints(u, pts);
  const prev = S.correct.find(c => c.u === u);
  if (prev) prev.pts += pts; else S.correct.push({ u, pts });
  S.stats.answers++;
  sfx.correct();
  setEvent(`<b>${esc(displayName(u))}</b> found one, +${pts}`);
  renderQuestion(true);
  renderBoards();
  if (S.filled.every(Boolean)) S.tEnd = Math.min(S.tEnd, now() + 2500);
}
function answerClosest(q, u, text) {
  const v = parseNumber(text, q);
  if (v == null) return;
  if (!S.closest.has(u)) S.stats.answers++;
  S.closest.set(u, { v, at: now() });
  renderLive();
}
function scoreClosest(q) {
  const rows = [...S.closest.entries()].map(([u, a]) => ({ u, v: a.v, d: Math.abs(a.v - q.value), at: a.at }))
    .sort((a, b) => a.d - b.d || a.at - b.at).slice(0, 3);
  rows.forEach((r, i) => {
    r.pts = (r.d === 0 ? CFG.points.exact : CFG.points.closest[i]) * (S.qMult || 1);
    addPoints(r.u, r.pts); S.correct.push({ u: r.u, pts: r.pts });
  });
  S.closestRows = rows;
}
// ", now #4 in the last 15 min" after a correct answer
function posNote(u) { const r = rankOf('m15', u); return r && r.pos <= 20 ? `, now #${r.pos} in the last 15 min` : ''; }
function registerCorrect(u, pts, quiet) {
  addPoints(u, pts);
  S.streaks.set(u, (S.streaks.get(u) || 0) + 1);
  S.correct.push({ u, pts, at: now() });
  if (!quiet) S.stats.answers++;
  if (S.correct.length === 1) {
    const secs = (now() - S.tStart) / 1000;
    if (!S.stats.fastest || secs < S.stats.fastest.s) S.stats.fastest = { u, s: secs };
    if (!quiet) { sfx.correct(); setEvent(`<b>${who(u)}</b> got it first, +${pts}${posNote(u)}. Still time to answer`); }
  } else if (!quiet) setEvent(`<b>${who(u)}</b> got it too, +${pts}${posNote(u)}. ${S.correct.length} correct so far`);
  renderBoards();
}

// ------------------------------------------------------------------ gifts, likes, social
function onGift(ev) {
  const u = ev.user, total = (ev.coins || 1) * (ev.count || 1);
  S.names.set(u, ev.nick || u);
  P.gifters[u] = (P.gifters[u] || 0) + total;
  P.names[u] = displayName(u);
  if (S.stats) S.stats.coins += total;
  addPoints(u, total * CFG.points.perCoin);
  sfx.gift();
  const who = `<b>${esc(displayName(u))}</b>`;
  const col = CFG.themeGifts.findIndex(g => norm(g) === norm(ev.gift));
  if (col >= 0 && S.voteThemes[col]) {
    S.votes[col] += total;
    renderVote();
    addAlert(`${who} voted ${esc(S.voteThemes[col])} (+${total})`);
  } else if (total >= CFG.powerups.blitz) {
    S.blitzQueued = CFG.blitzLength;
    addAlert(`${who} called a BLITZ ROUND`);
  } else if (total >= CFG.powerups.double) {
    S.mult = 2; S.multBy = displayName(u);
    addAlert(`${who} made the next question DOUBLE POINTS`);
  } else if (total >= CFG.powerups.hint) {
    if (S.phase === 'question') hintNow(displayName(u)); else addAlert(`Thanks ${who} for the ${esc(ev.gift)}`);
  } else {
    addAlert(`Thanks ${who} for the ${esc(ev.gift)}${ev.count > 1 ? ' x' + ev.count : ''}`);
  }
  renderBoards(); renderThemebar();
}
function onLikes(n, total) {
  S.likes = total != null ? Math.max(S.likes, total) : S.likes + n;
  if (S.likes - S.likeBase >= S.likeGoal) {
    S.likeBase = S.likes;
    S.likeGoal = Math.round(S.likeGoal * CFG.likeGoalGrowth / 100) * 100;
    S.blitzQueued = CFG.blitzLength;
    addAlert('<b>LIKE GOAL HIT</b>: blitz round coming, double points');
  }
  renderLikes();
}
function onSocial(kind, u) {
  const pts = kind === 'share' ? CFG.points.share : CFG.points.follow;
  addPoints(u, pts);
  addAlert(`<b>${esc(displayName(u))}</b> ${kind === 'share' ? 'shared the LIVE' : 'followed'}, +${pts} points`);
  renderBoards();
}
function onEvent(ev) {
  if (ev.user && ev.nick) { S.names.set(ev.user, ev.nick); P.names[ev.user] = ev.nick; }
  switch (ev.kind) {
    case 'chat': onChat(ev.user, ev.text); break;
    case 'gift': onGift(ev); break;
    case 'like': onLikes(ev.count || 1, ev.total); break;
    case 'follow': case 'share': onSocial(ev.kind, ev.user); break;
    case 'status': S.connected = !!ev.connected; S.statusText = ev.text || ''; break;
  }
}

// ------------------------------------------------------------------ screen: chrome
const body = () => $('#panel-body');
function renderThemebar() {
  const c = champion();
  $('#gameno').innerHTML = c ? `<span class="champ">Yesterday's champ: <b>${esc(displayName(c.u))}</b>${trophyTag(c.u)}</span>` : '';
  let tag = '';
  if (S.survivor && !['recap', 'voteResult'].includes(S.phase)) tag = `<span class="tag surv">SURVIVOR${S.survivor.started ? `: ${S.survivor.alive.size} LEFT` : ''}</span>`;
  else if (S.q && S.q.speed && (S.phase === 'question' || S.phase === 'reveal')) tag = `<span class="tag">SPEED ${S.q.speed}/5</span>`;
  else if (S.phase === 'question' || S.phase === 'reveal') {
    if (S.blitzLeft > 0) tag = '<span class="tag">BLITZ</span>';
    else if (S.qMult > 1) tag = '<span class="tag">DOUBLE POINTS</span>';
  }
  $('#theme-name').innerHTML = esc(S.theme || '') + tag;
  fitThemeName();
  const pips = S.queue.map((q, i) => {
    const st = S.phase === 'recap' || S.phase === 'voteResult' || i < S.qi ? 'done' : (i === S.qi && S.phase !== 'intro') ? 'now' : '';
    return `<span class="pip ${st}${q.type === 'battle' ? ' battle' : ''}"></span>`;
  }).join('');
  $('#pips').innerHTML = (S.game ? `<span class="gno">GAME ${S.game}</span>` : '') + pips;
}
// The game's name always shows in full: shrink the type until it fits next to the progress bar
function fitThemeName() {
  const el = $('#theme-name');
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth + 1 && size > 26) { size -= 2; el.style.fontSize = size + 'px'; }
}
function setInstruction(text, mode = 'go') {
  const el = $('#instruction');
  el.className = mode === 'go' ? '' : mode;
  $('#instr-text').textContent = text;
}
function updateClock(left) {
  const showClock = ['question', 'intro', 'recap'].includes(S.phase);
  const secs = Math.max(0, Math.ceil(left / 1000));
  $('#clock').textContent = !showClock ? '' : S.paused ? 'II' : String(secs);
  const frac = S.dur ? Math.max(0, Math.min(1, left / S.dur)) : 0;
  $('#timefill').style.width = (showClock ? frac * 100 : 0) + '%';
  const low = S.phase === 'question' && secs <= 5;
  $('#timebar').classList.toggle('low', low);
  $('#instruction').classList.toggle('low', low);
}
let eventDefault = '';
function setEvent(html) { eventDefault = html; if (!alertBusy) paintEvent(html, false); }
function paintEvent(html, alert) { const e = $('#eventline'); e.innerHTML = html ? `<span>${html}</span>` : ''; e.classList.toggle('alert', alert); }
const alertQ = [];
let alertBusy = false;
function addAlert(html) { alertQ.push(html); if (alertQ.length > 6) alertQ.shift(); if (!alertBusy) nextAlert(); }
function nextAlert() {
  if (!alertQ.length) { alertBusy = false; paintEvent(eventDefault, false); return; }
  alertBusy = true;
  paintEvent(alertQ.shift(), true);
  setTimeout(nextAlert, 2400);
}

// ------------------------------------------------------------------ screen: panels
const THEME_DESC = {
  'Career Paths': 'We list the teams. You name the player.',
  'Stat Lines': 'A real season stat line. Whose was it?',
  'Draft & Bio': 'Draft nights, colleges and hometowns.',
  'Awards & Rings': 'MVPs, Finals MVPs, rings and All-Star picks.',
  'Record Book': 'All-time and active career leaders.',
  'Money Talks': 'Salaries and career earnings.',
  'Jersey Kings': 'The NBA\'s best-selling jerseys.',
  'Around the World': 'The league\'s international stars.',
  'Name the Face': 'The photo zooms out. Name him first.',
  'Franchise Legends': 'Every team\'s top scorers since 2000-01.',
  'Teammates': 'Name anyone who played with both of them.',
  'Odd One Out': 'Three of them have something in common. Find the fourth.',
  'Head to Head': 'Who won more when they faced each other?',
  'Clutch & Streaks': 'Game-winners, clutch points and the longest streaks.',
  'Ratings & Votes': 'NBA 2K ratings, award votes and the GM survey.',
  'Around the League': 'Arenas, crowds and the officials.',
  'Tonight in the NBA': 'Last night, birthdays and the standings today.',
  'This Season': 'Leaders, stat races and the standings, as of this morning.',
  'Last Season': 'The 2025-26 season: leaders and award winners.',
  'Mixed': 'A bit of everything.',
};
function renderIntro() {
  renderThemebar();
  if (S.survivor) {
    body().innerHTML = `<div class="big-center"><div class="title">Survivor</div><div class="desc">${esc(S.theme)}: ${esc(THEME_DESC[S.theme] || '')}</div></div>
    <div class="rules">
      <div class="rule"><b>1</b>Answer the first question to get in</div>
      <div class="rule"><b>2</b>One wrong or missed answer and you're out</div>
      <div class="rule"><b>3</b>Everyone still standing at the end gets +${CFG.survivorBonus}. Three or fewer: double</div>
    </div>`;
    setInstruction(`${S.queue.length} questions. Starting in`, 'wait');
    setEvent('Survivor game: pick-an-answer questions only');
    renderBoards();
    return;
  }
  body().innerHTML = `<div class="big-center"><div class="title">${esc(S.theme)}</div><div class="desc">${esc(THEME_DESC[S.theme] || '')}</div></div>
    <div class="rules">
      <div class="rule"><b>1</b>Type your answer in the chat. Fastest scores most</div>
      <div class="rule"><b>2</b>Type RANK any time to see your spot. Win a day or a week for a 🏆</div>
      <div class="rule"><b>3</b>Type your team once (LAL, BOS, GSW...) to join the team battle</div>
      <div class="rule"><b>4</b>Send a theme's gift to pick the next game</div>
    </div>`;
  setInstruction(`${S.queue.length} questions. Starting in`, 'wait');
  setEvent(S.game > 1 ? 'New game. The 15-minute board keeps counting, so you can still climb it' : 'Welcome. No sign-up, just type in the chat');
  renderBoards();
}
function instructionFor(q) {
  if (q.type === 'guess') return 'Type the player\'s name';
  if (q.type === 'mc') return isTF(q) ? 'Type TRUE or FALSE' : 'Type A, B, C or D';
  if (q.type === 'hl') return 'Type A or B';
  if (q.type === 'battle') return 'Vote: type A or B';
  if (q.type === 'board') return 'Type as many names as you can';
  if (q.predict) return 'Type your guess for the total points';
  if (q.type === 'closest') return 'Type a number. Closest wins';
  if (q.type === 'anyof') return 'Type any player who fits';
  if (q.type === 'order') return 'Type the order, like BAC';
  return 'Type your answer';
}
function promptHtml(q) {
  return `<div class="prompt${q.prompt.length > 46 ? ' long' : ''}">${esc(q.prompt)}</div>` + (q.sub ? `<div class="sub">${esc(q.sub)}</div>` : '');
}
function renderQuestion(keepEvent) {
  renderThemebar();
  const q = S.q;
  setInstruction(instructionFor(q));
  if (!keepEvent) setEvent(q.speed ? `Speed round ${q.speed} of 5: worth ${basePoints(q)} points`
    : q.predict ? 'No right answer yet. We score it at the next stream, closest wins up to 500'
    : q.type === 'anyof' ? `${q.answers.length} players fit. Everyone who names one scores`
    : q.type === 'order' ? `Exact order: ${basePoints(q)} points. Top one right: ${Math.round(basePoints(q) * 0.4)}`
    : q.type === 'battle' ? 'No wrong answers. Everyone on the winning side scores'
    : q.type === 'board' ? `${CFG.points.board * (S.qMult || 1)} points for every name you find`
    : q.type === 'closest' ? 'Your last number counts. Top 3 closest score'
    : q.type === 'guess' ? 'Clues and letters appear as the clock runs down'
    : `Your first answer counts. Worth ${basePoints(q)} points`);
  if (q.type === 'guess') return renderGuess();
  let h = '';
  if (q.type === 'mc') {
    h += q.image ? `<div class="row-head">${photo(q.image, 'sm')}${promptHtml(q)}</div>` : promptHtml(q);
    h += '<div class="opts">' + q.options.map((o, i) => `<div class="opt${S.struck.has(i) ? ' struck' : ''}"><span class="k">${isTF(q) ? (i ? 'F' : 'T') : 'ABCD'[i]}</span><span class="t">${esc(o)}</span></div>`).join('') + '</div>';
  } else if (q.type === 'hl' || q.type === 'battle') {
    h += promptHtml(q) + vsHtml(q, false);
  } else if (q.type === 'board') {
    h += promptHtml(q) + slotsHtml(q, false) + `<div class="found">${S.filled.filter(Boolean).length} of ${q.slots.length} found</div>`;
  } else if (q.type === 'closest') {
    h += q.image ? `<div class="row-head">${photo(q.image, 'sm')}<div style="flex:1">${promptHtml(q)}</div></div>` : promptHtml(q);
    if (q.facts) h += '<div class="clues">' + q.facts.map((c, i) => `<div class="clue"><span class="n">${i + 1}</span><span>${esc(c)}</span></div>`).join('') + '</div>';
    h += `<div class="closest-body"><div class="guesscount" id="gcount">0<small>guesses</small></div></div>`;
  } else if (q.type === 'anyof') {
    h += promptHtml(q) + `<div class="vs">${q.sides.map(s => `<div class="side">${photo(s.img)}<div class="nm">${esc(s.name)}</div></div>`).join('')}</div>`;
  } else if (q.type === 'order') {
    h += promptHtml(q) + orderHtml(q, false);
  }
  body().innerHTML = h;
  renderLive();
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const colorDist = (a, b) => Math.hypot(...hexRgb(a).map((v, i) => v - hexRgb(b)[i]));
function sideColors(q) {
  const teams = q.sides.map(s => S.data.teams && S.data.teams[s.img]);
  const a = TEAM_COLORS[teams[0]] || '#8b7cf6';
  let b = TEAM_COLORS[teams[1]] || '#c4b5fd';
  if (colorDist(a, b) < 90) b = '#c4b5fd';
  if (colorDist(a, b) < 90) b = '#ffffff';
  return { teams, colors: [a, b] };
}
function vsHtml(q, reveal) {
  const t = S.battleVotes[0] + S.battleVotes[1];
  const sc = sideColors(q);
  const sides = q.sides.map((s, i) => {
    let cls = '';
    if (reveal && q.type === 'hl') cls = i === q.correct ? ' right' : ' fade';
    if (reveal && q.type === 'battle' && S.battleWin >= 0) cls = i === S.battleWin ? ' right' : ' fade';
    const val = q.type === 'hl' ? `<div class="val${reveal ? '' : ' hide'}">${reveal ? esc(s.value) : '?'}</div>` : '';
    const meta = q.type === 'battle' ? `<div class="meta">${esc(s.value || '')}</div>` : '';
    const tm = sc.teams[i] ? `<div class="tm"><img src="${logoUrl(sc.teams[i])}" alt="" onerror="this.remove()">${esc(TEAMS[sc.teams[i]][0])}</div>` : '';
    const pic = s.logo && TEAM_IDS[s.logo] ? `<div class="photo teamlogo"><img src="${logoUrl(s.logo)}" alt="" onerror="this.remove()"></div>` : photo(s.img);
    return `<div class="side${cls}" style="--tc:${sc.colors[i]}"><div class="k">${'AB'[i]}</div>${pic}${tm}<div class="nm">${esc(s.name)}</div>${val}${meta}</div>`;
  }).join('');
  let split = '';
  if (q.type === 'battle') {
    const pa = t ? Math.round(100 * S.battleVotes[0] / t) : 50;
    split = `<div class="split" style="--ta:${sc.colors[0]};--tb:${sc.colors[1]}"><div class="a" id="split-a" style="width:${pa}%">A ${t ? pa + '%' : ''}</div><div class="b" id="split-b">${t ? (100 - pa) + '%' : ''} B</div></div>`;
  }
  return `<div class="vs">${sides}</div>${split}`;
}
function orderHtml(q, reveal) {
  return '<div class="order">' + q.sides.map((s, i) => {
    const pos = q.order.indexOf('ABC'[i]);
    return `<div class="oside${reveal && pos === 0 ? ' right' : ''}"><div class="k">${'ABC'[i]}</div>${photo(s.img, 'sm')}<div class="nm">${esc(s.name)}</div>`
      + (reveal ? `<div class="val">${pos + 1}. ${esc(s.value)}</div>` : '') + '</div>';
  }).join('') + '</div>';
}
// Half-court shot chart (court units from the Shot Chart Studio data: rim at 250, 52.5, 10 units a foot)
function shotChartSvg(shots) {
  const dots = shots.map(([x, y, m]) => m
    ? `<circle cx="${250 + x}" cy="${52.5 + y}" r="5" class="mk"/>`
    : `<path d="M${245 + x} ${47.5 + y}l10 10m0 -10l-10 10" class="ms"/>`).join('');
  return `<svg class="court" viewBox="0 0 500 420" preserveAspectRatio="xMidYMin meet">
    <rect x="0" y="0" width="500" height="420" class="fl"/>
    <rect x="170" y="0" width="160" height="190" class="ln"/><circle cx="250" cy="190" r="60" class="ln"/>
    <path d="M30 0V140A237.5 237.5 0 0 0 470 140V0" class="ln"/><circle cx="250" cy="52.5" r="7.5" class="ln"/>
    <line x1="220" y1="40" x2="280" y2="40" class="ln"/>${dots}</svg>`;
}
function slotsHtml(q, reveal) {
  const one = q.slots.length <= 5 ? ' one' : '';
  return `<div class="slots${one}">` + q.slots.map((s, i) => {
    const f = S.filled[i];
    if (f) return `<div class="slot got"><span class="lab">${esc(s.label)}</span>${photo(s.img, 'xs')}<span><div class="who">${esc(s.name)}</div><div class="by">${f.hint ? 'gift hint' : esc(displayName(f.u))}</div></span></div>`;
    if (reveal) return `<div class="slot miss"><span class="lab">${esc(s.label)}</span>${photo(s.img, 'xs')}<span><div class="who">${esc(s.name)}</div><div class="by">missed</div></span></div>`;
    return `<div class="slot"><span class="lab">${esc(s.label)}</span><span class="blank"></span></div>`;
  }).join('') + '</div>';
}
function renderGuess() {
  const q = S.q, P = S.revealPlan;
  if (!q || q.type !== 'guess' || S.phase !== 'question') return;
  const shown = P ? P.shownClues : q.clues.length;
  let h = promptHtml(q);
  const zoom = q.imageMode === 'zoom' && q.image;
  if (zoom) h += `<div class="zoombox"><img src="${CFG.imgBase}${encodeURIComponent(q.image)}" alt=""></div>`;
  if (q.shots) h += `<div class="shotrow"><div class="shotwrap">${shotChartSvg(q.shots)}<div class="shotkey"><span class="mk-k"></span>Made <span class="ms-k"></span>Missed</div></div>`;
  h += `<div class="clues${zoom || q.shots ? ' compact' : ''}">` + q.clues.map((c, i) => i < shown
    ? `<div class="clue"><span class="n">${i + 1}</span><span>${esc(c)}</span></div>`
    : `<div class="clue locked"><span class="n">${i + 1}</span><span>Unlocks soon</span></div>`).join('') + '</div>';
  if (q.shots) h += '</div>';
  const letters = q.answer.replace(/ /g, '').length;
  let pos = 0;
  h += `<div class="letters${letters > 14 ? ' small' : ''}">` + q.answer.split(' ').map(w => {
    const tiles = [...w].map(ch => {
      const i = pos++;
      if (!/[a-z0-9]/i.test(ch)) return `<span class="tile p">${esc(ch)}</span>`;
      const on = P && P.shownLetters.has(i);
      return `<span class="tile${on ? ' on' : ''}">${on ? esc(ch.toUpperCase()) : ''}</span>`;
    }).join('');
    pos++;
    return `<span class="word">${tiles}</span>`;
  }).join('') + '</div>';
  const old = body().querySelector('.zoombox img');
  const keep = old ? old.style.transform : '';
  body().innerHTML = h;
  const z = body().querySelector('.zoombox img');
  if (z && keep) z.style.transform = keep;
  if (z) z.onerror = () => z.parentNode.remove();
}
function renderLive() {
  const q = S.q;
  if (!q || S.phase !== 'question') return;
  if ((q.type === 'mc' || q.type === 'hl' || q.type === 'order') && S.answered.size) {
    if (!S.correct.length) setEvent(`<b>${S.answered.size}</b> answer${S.answered.size === 1 ? '' : 's'} locked in`);
  } else if (q.type === 'battle') {
    const [a, b] = S.battleVotes, t = a + b;
    const pa = t ? Math.round(100 * a / t) : 50;
    const A = $('#split-a'), B = $('#split-b');
    if (A) { A.style.width = pa + '%'; A.textContent = `A ${t ? pa + '%' : ''}`; B.textContent = `${t ? (100 - pa) + '%' : ''} B`; }
    if (t) setEvent(`<b>${t}</b> vote${t === 1 ? '' : 's'} so far`);
  } else if (q.type === 'closest') {
    const g = $('#gcount'); if (g) g.innerHTML = `${S.closest.size}<small>guess${S.closest.size === 1 ? '' : 'es'}</small>`;
  }
}
function winnersHtml(n = 3) {
  return '<div class="winners">' + S.correct.slice(0, n).map((c, i) =>
    `<div class="winner"><span class="r">${i + 1}</span><span class="u">${who(c.u)}${(S.streaks.get(c.u) || 0) >= 3 ? ` (${S.streaks.get(c.u)} in a row)` : ''}</span><span class="pos">${(r => r ? '#' + r.pos + ' last 15 min' : '')(rankOf('m15', c.u))}</span><span class="p">+${c.pts}</span></div>`).join('') + '</div>';
}
function renderReveal() {
  renderThemebar();
  const q = S.q;
  let h = '';
  const nCorrect = S.correct.length;
  if (q.type === 'mc') {
    const counts = q.options.map((_, i) => [...S.answered.values()].filter(a => a.idx === i).length);
    const tot = counts.reduce((a, b) => a + b, 0) || 1;
    h += q.image ? `<div class="row-head">${photo(q.image, 'sm')}${promptHtml(q)}</div>` : promptHtml(q);
    h += '<div class="opts">' + q.options.map((o, i) => {
      const pct = Math.round(100 * counts[i] / tot);
      return `<div class="opt ${i === q.correct ? 'right' : 'fade'}"><div class="bar" style="width:calc(${pct}% - ${pct ? 0 : 0}px)"></div><span class="k">${isTF(q) ? (i ? 'F' : 'T') : 'ABCD'[i]}</span><span class="t">${esc(o)}</span><span class="pct">${counts.some(Boolean) ? pct + '%' : ''}</span></div>`;
    }).join('') + '</div>';
    setInstruction(`Answer: ${isTF(q) ? q.answer : 'ABCD'[q.correct] + ', ' + q.answer}`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> got it right. Fastest: <b>${esc(displayName(S.correct[0].u))}</b> +${S.correct[0].pts}` : 'Nobody got this one');
  } else if (q.type === 'hl') {
    h += promptHtml(q) + vsHtml(q, true);
    setInstruction(`Answer: ${'AB'[q.correct]}, ${q.answer}`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> got it right. Fastest: <b>${esc(displayName(S.correct[0].u))}</b> +${S.correct[0].pts}` : 'Nobody got this one');
  } else if (q.type === 'battle') {
    const t = S.battleVotes[0] + S.battleVotes[1];
    h += promptHtml(q) + vsHtml(q, true);
    if (S.battleWin >= 0) {
      setInstruction(`Chat picked ${q.sides[S.battleWin].name}`, 'answer');
      setEvent(`<b>${Math.round(100 * S.battleVotes[S.battleWin] / t)}%</b> of ${t} votes. Everyone on that side +${CFG.points.battle * (S.qMult || 1)}`);
    } else { setInstruction('It\'s a tie', 'answer'); setEvent(t ? `${t} votes, split down the middle` : 'No votes this time'); }
  } else if (q.type === 'board') {
    const got = S.filled.filter(f => f && !f.hint).length;
    h += promptHtml(q) + slotsHtml(q, true);
    setInstruction(`Chat found ${got} of ${q.slots.length}`, 'answer');
    const top = [...S.correct].sort((a, b) => b.pts - a.pts)[0];
    setEvent(top ? `Most found: <b>${esc(displayName(top.u))}</b> +${top.pts}` : 'Nobody found one this time');
  } else if (q.type === 'anyof') {
    const shown = q.answers.slice(0, 6);
    h += promptHtml(q) + '<div class="slots">' + shown.map(a => `<div class="slot got">${photo(a.img, 'xs')}<span><div class="who">${esc(a.name)}</div></span></div>`).join('') + '</div>';
    h += nCorrect ? winnersHtml(3) : '<div class="nobody">Nobody got one</div>';
    setInstruction(`${q.answers.length} answers worked`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> named one. First: <b>${esc(displayName(S.correct[0].u))}</b> with ${esc(S.correct[0].said || '')}` : (q.fact || ''));
  } else if (q.type === 'order') {
    h += promptHtml(q) + orderHtml(q, true);
    const top = q.sides['ABC'.indexOf(q.order[0])].name;
    setInstruction(`Answer: ${q.order}, ${top} first`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> got the exact order. Fastest: <b>${esc(displayName(S.correct[0].u))}</b> +${S.correct[0].pts}${S.partial ? `. ${S.partial} got the top one` : ''}`
      : S.partial ? `Nobody got the exact order. ${S.partial} got the top one right` : 'Nobody got this one');
    S.partial = 0;
  } else if (q.predict) {
    const n = (P.preds[q.predict.key] && Object.keys(P.preds[q.predict.key].entries).length) || 0;
    h += promptHtml(q) + `<div class="closest-body"><div class="guesscount">${fmt(n)}<small>predictions locked in</small></div></div>`;
    setInstruction('Scored at the next stream', 'answer');
    setEvent('Closest to the final total wins up to 500 points. Come back next stream to see who won');
  } else if (q.type === 'closest') {
    h += `<div class="ans-wrap">${photo(q.image)}<div><div class="ans-name">${esc(q.answer)}</div>${q.fact ? `<div class="ans-fact">${esc(q.fact)}</div>` : ''}<div class="ans-q">${esc(q.prompt)}</div></div></div>`;
    h += '<div class="cl-rows">' + (S.closestRows || []).map((r, i) => `<div class="cl-row"><span>${i + 1}. ${esc(displayName(r.u))} said ${fmt(r.v)}</span><span class="p">+${r.pts}</span></div>`).join('') + '</div>';
    if (!S.closestRows || !S.closestRows.length) h += '<div class="nobody">No guesses this time</div>';
    setInstruction(`The answer: ${q.answer}`, 'answer');
    setEvent(S.closestRows && S.closestRows.length ? `Closest: <b>${esc(displayName(S.closestRows[0].u))}</b> +${S.closestRows[0].pts}` : '');
  } else {   // guess
    const face = q.revealImage || q.image;
    h += `<div class="ans-wrap">${photo(face)}<div><div class="ans-name${q.answer.length > 16 ? ' mid' : ''}">${esc(q.answer)}</div>${q.fact ? `<div class="ans-fact">${esc(q.fact)}</div>` : ''}</div></div>`;
    h += nCorrect ? winnersHtml(4) : '<div class="nobody">Nobody got this one</div>';
    setInstruction(`The answer: ${q.answer}`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> named him` : '');
  }
  body().innerHTML = h;
  if (S.survivor && CHOICE(q) && !S.survivor.over) setEvent(S.survivor.started
    ? `<b>${S.survivor.alive.size}</b> still alive${S.survivor.lastOut ? `, ${S.survivor.lastOut} knocked out` : ''}. Survivors get +${CFG.survivorBonus} at the end`
    : 'Nobody answered, so Survivor starts with the next question');
  else if (S.survivor && S.survivor.over && CHOICE(q)) setEvent('Everyone is out. No survivors this game');
  renderBoards();
}
function renderRecap() {
  renderThemebar();
  const st = S.stats, top = [...S.gameScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  let h = `<div class="prompt">${esc(S.theme)}: final scores</div>`;
  h += '<div class="recap-list winners" style="margin-top:26px">' + (top.length ? top.map(([u, v], i) =>
    `<div class="winner"><span class="r">${i + 1}</span><span class="u">${who(u)}</span><span class="p">${fmt(v)}</span></div>`).join('')
    : '<div class="winner"><span class="u">No scores this game</span></div>') + '</div>';
  const facts = [`${fmt(st.answers)} answers from ${st.players.size} players`];
  const bestTeam = [...S.gameTeams.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bestTeam) facts.push(`Team of the game: ${TEAMS[bestTeam[0]][0]} +${fmt(bestTeam[1])}`);
  if (S.survivor) facts.unshift(S.survivor.alive.size ? `Survivors: ${[...S.survivor.alive].slice(0, 5).map(displayName).join(', ')}${S.survivor.alive.size > 5 ? ` and ${S.survivor.alive.size - 5} more` : ''} (+${S.survivorPaid} each)` : 'Survivor: nobody made it to the end');
  if (st.fastest) facts.push(`Fastest answer: ${displayName(st.fastest.u)} in ${st.fastest.s.toFixed(1)}s`);
  h += `<div class="ans-fact" style="margin-top:auto">${facts.map(esc).join('<br>')}</div>`;
  body().innerHTML = h;
  setInstruction('Next theme locks in', 'go');
  setEvent(top.length ? `<b>${esc(displayName(top[0][0]))}</b> wins game ${S.game}` : '');
}
// ------------------------------------------------------------------ recap cards for X and Bluesky
// After every game: a square (1080x1080) and a wide (1200x675) PNG saved to the recap-cards folder.
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function loadImg(file) {
  return new Promise(res => {
    if (!file) return res(null);
    const i = new Image(); i.crossOrigin = 'anonymous';
    const t = setTimeout(() => res(null), 5000);
    i.onload = () => { clearTimeout(t); res(i); }; i.onerror = () => { clearTimeout(t); res(null); };
    i.src = CFG.imgBase + encodeURIComponent(file);
  });
}
function hardestQuestion() {
  // a question only counts as "hard" if enough people tried it; fall back to anything people tried
  const sorted = list => list.sort((a, b) => a.ratio - b.ratio || b.tried - a.tried)[0] || null;
  const usable = S.qLog.filter(x => x.q.type !== 'closest');
  return sorted(usable.filter(x => x.tried >= 3 || x.q.type === 'board')) || sorted(usable.filter(x => x.tried > 0));
}
async function makeRecapCards() {
  const top = [...S.gameScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) return;                          // nobody played: nothing worth posting
  const hard = hardestQuestion();
  const face = hard ? await loadImg(hard.q.revealImage || hard.q.image || (hard.q.sides && hard.q.sides[hard.q.correct] && hard.q.sides[hard.q.correct].img)) : null;
  try { await document.fonts.ready; } catch (e) {}
  const logo = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'img/hoopshype-logo-white.png'; });
  const C = getComputedStyle(document.documentElement);
  const col = n => C.getPropertyValue(n).trim();
  const cond = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif', bodyF = 'Barlow, Arial, sans-serif';
  const gameNo = S.game, theme = S.theme;
  const hardLine = !hard ? '' : hard.q.type === 'board'
    ? `The hardest one of the game: chat found ${hard.got} of ${hard.q.slots.length}.`
    : hard.got === 0 ? `The hardest one of the game: nobody in chat got it.`
    : `The hardest one of the game: ${hard.got} of ${hard.tried} got it.`;
  let answer = '';
  if (hard) {
    const q = hard.q;
    if (q.type === 'board') answer = q.slots.slice(0, 3).map(s => s.name).join(', ') + (q.slots.length > 3 ? '...' : '');
    else if (q.type === 'hl') answer = `${q.sides[q.correct].name} (${q.sides[q.correct].value}) over ${q.sides[1 - q.correct].name} (${q.sides[1 - q.correct].value})`;
    else answer = q.answer;
  }

  const draw = (W, H, wide) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = col('--bg'); x.fillRect(0, 0, W, H);
    // masthead
    const mh = wide ? 96 : 120;
    x.fillStyle = '#000'; x.fillRect(0, 0, W, mh);
    x.fillStyle = col('--accent'); x.fillRect(0, mh, W, 8);
    x.textBaseline = 'middle';
    // the HoopsHype logo (white version for the black bar), then "NBA QUIZ"
    x.font = `800 ${wide ? 52 : 64}px ${cond}`; x.fillStyle = '#fff';
    let w1;
    if (logo) { const lh = wide ? 46 : 58, lw = logo.width * lh / logo.height; x.drawImage(logo, 56, mh / 2 - lh / 2, lw, lh); w1 = lw; }
    else { x.fillText('HOOPSHYPE', 56, mh / 2); w1 = x.measureText('HOOPSHYPE').width; }
    x.fillStyle = col('--accent'); x.fillRect(56 + w1 + 22, mh / 2 - 24, 5, 48);
    x.fillText('NBA QUIZ', 56 + w1 + 50, mh / 2);
    x.textBaseline = 'alphabetic';
    // left block: game, winner, podium
    const L = 56, leftW = wide ? 470 : W - 112;
    let y = mh + (wide ? 90 : 110);
    x.fillStyle = '#fff'; x.font = `800 ${wide ? 58 : 76}px ${cond}`;
    wrapLines(x, `GAME ${gameNo}: ${theme.toUpperCase()}`, leftW).forEach(l => { x.fillText(l, L, y); y += wide ? 58 : 74; });
    y += wide ? 14 : 18;
    x.fillStyle = col('--gold'); x.font = `800 ${wide ? 46 : 58}px ${cond}`;
    const tTag = P.teams[top[0][0]] ? ` (${P.teams[top[0][0]]})` : '';
    const tr = trophies(top[0][0]) ? ` 🏆${trophies(top[0][0])}` : '';
    wrapLines(x, `${displayName(top[0][0])}${tTag}${tr} wins with ${fmt(top[0][1])} points`, leftW).forEach(l => { x.fillText(l, L, y); y += wide ? 50 : 62; });
    x.fillStyle = '#c9ccd3'; x.font = `600 ${wide ? 30 : 36}px ${bodyF}`;
    top.slice(1).forEach(([u, v], i) => { y += 4; x.fillText(`${i + 2}. ${displayName(u)}: ${fmt(v)}`, L, y); y += wide ? 40 : 48; });
    // white panel: the hardest question
    if (hard) {
      const px = wide ? 560 : 40, py = wide ? mh + 40 : Math.max(y + 30, 520), pw = wide ? W - 600 : W - 80;
      const fs = wide ? 160 : 200;
      const textW = pw - 64 - (face ? fs + 30 : 0);
      // measure first so the white panel hugs its content instead of leaving a blank block
      x.font = `800 ${wide ? 40 : 50}px ${cond}`; const pl = Math.min(4, wrapLines(x, hard.q.prompt, textW).length);
      x.font = `800 ${wide ? 40 : 52}px ${cond}`; const al = Math.min(2, wrapLines(x, answer, pw - 64).length);
      x.font = `600 ${wide ? 26 : 32}px ${bodyF}`; const hl = wrapLines(x, hardLine, pw - 64).length;
      const textH = (wide ? 64 : 76) + pl * (wide ? 42 : 52);
      const contentH = Math.max(textH + 12, face ? 32 + fs + 50 : 0) + al * (wide ? 44 : 56) + hl * (wide ? 38 : 44) + 30;
      const maxH = wide ? H - mh - 140 : H - py - 120;
      const ph = Math.min(maxH, contentH);
      x.fillStyle = '#fff'; x.beginPath(); x.roundRect ? x.roundRect(px, py, pw, ph, 12) : x.rect(px, py, pw, ph); x.fill();
      if (face) {
        x.save(); x.beginPath(); x.arc(px + pw - 32 - fs / 2, py + 32 + fs / 2, fs / 2, 0, Math.PI * 2); x.clip();
        x.fillStyle = col('--tint'); x.fill(); x.drawImage(face, px + pw - 32 - fs, py + 32, fs, fs); x.restore();
      }
      let ty = py + (wide ? 64 : 76);
      x.fillStyle = col('--ink'); x.font = `800 ${wide ? 40 : 50}px ${cond}`;
      wrapLines(x, hard.q.prompt, textW).slice(0, 4).forEach(l => { x.fillText(l, px + 32, ty); ty += wide ? 42 : 52; });
      ty = Math.max(ty + 12, face ? py + 32 + fs + 50 : 0);
      x.fillStyle = col('--green'); x.font = `800 ${wide ? 40 : 52}px ${cond}`;
      wrapLines(x, answer, pw - 64).slice(0, 2).forEach(l => { x.fillText(l, px + 32, ty); ty += wide ? 44 : 56; });
      x.fillStyle = col('--sub'); x.font = `600 ${wide ? 26 : 32}px ${bodyF}`;
      wrapLines(x, hardLine, pw - 64).forEach(l => { ty += 6; x.fillText(l, px + 32, ty); ty += wide ? 32 : 38; });
    }
    // footer
    x.fillStyle = col('--accent'); x.fillRect(0, H - (wide ? 70 : 84), W, wide ? 70 : 84);
    x.fillStyle = '#fff'; x.font = `800 ${wide ? 36 : 42}px ${cond}`; x.textBaseline = 'middle';
    x.fillText(`PLAY LIVE ON TIKTOK: @${(CFG.handle || 'hoopshype').toUpperCase()}`, 56, H - (wide ? 35 : 42));
    return cv.toDataURL('image/png').split(',')[1];
  };
  const stamp = `${nightKey()}-${String(new Date().getHours()).padStart(2, '0')}${String(new Date().getMinutes()).padStart(2, '0')}`;
  const base = `hoopshype-quiz-${stamp}-game-${gameNo}`;
  for (const [suffix, W, H, wide] of [['square', 1080, 1080, false], ['wide', 1200, 675, true]]) {
    try {
      const png = draw(W, H, wide);
      await fetch('/card' + (PRACTICE ? '?practice=1' : ''), { method: 'POST', body: JSON.stringify({ name: `${base}-${suffix}.png`, png }) });
    } catch (e) { console.log('Recap card not saved', e); }
  }
}
function renderVoteResult(theme, votes) {
  S.lastVoteResult = [theme, votes];
  renderThemebar();
  body().innerHTML = `<div class="big-center"><div class="title">${esc(theme)}</div><div class="desc">${esc(THEME_DESC[theme] || '')}</div></div>`;
  setInstruction(`Up next: ${theme}`, 'wait');
  setEvent(votes > 0 ? `Picked by your gifts: <b>${fmt(votes)}</b> votes` : 'Picked at random. Send a gift to choose the next one');
}
function renderVote() {
  const max = Math.max(...S.votes);
  $('#vote-cols').innerHTML = S.voteThemes.map((t, i) => `<div class="vc${max > 0 && S.votes[i] === max ? ' lead' : ''}">
    <div class="top"><span class="gift">${esc(CFG.themeGifts[i] || '')}</span><span class="n">${S.votes[i]}</span></div><div class="th">${esc(t)}</div></div>`).join('');
}
let winIdx = 0, winSince = 0;
function rotateStandings() {
  if (now() - winSince < WINDOWS[winIdx].secs * 1000) return;
  winIdx = (winIdx + 1) % WINDOWS.length; winSince = now();
  renderStandings();
}
function renderStandings() {
  const w = WINDOWS[winIdx];
  $('#st-tabs').innerHTML = WINDOWS.map((x, i) => `<span class="tab${i === winIdx ? ' on' : ''}">${x.label}</span>`).join('');
  const rows = ranked(w.key).slice(0, 10);
  const cells = [];
  for (let i = 0; i < 10; i++) {
    const r = rows[i];
    cells.push(r ? `<li class="${r[0] === rankShowing ? 'hl' : ''}"><span class="n">${i + 1}</span><span class="u">${who(r[0])}</span><span class="s">${fmt(r[1])}</span></li>`
      : `<li class="open"><span class="n">${i + 1}</span><span class="u">${i === rows.length ? 'Open spot' : ''}</span><span class="s"></span></li>`);
  }
  $('#st-list').innerHTML = cells.join('');
}
function renderBoards() {
  renderStandings();
  renderMe();
  const teams = Object.entries(thisWeek().teams).sort((a, b) => b[1] - a[1]).slice(0, 3);
  $('#lb-team').innerHTML = teams.length ? teams.map(([t, v], i) => `<span class="it"><b>${i + 1}</b> ${esc(TEAMS[t][0])} <em>${fmt(v)}</em></span>`).join('')
    : '<span class="it">Type your team (LAL, BOS, GSW...) to join</span>';
  const gifts = Object.entries(P.gifters).sort((a, b) => b[1] - a[1]).slice(0, 3);
  $('#lb-gift').innerHTML = gifts.length ? gifts.map(([u, v], i) => `<span class="it"><b>${i + 1}</b> ${esc(displayName(u))} <em>${fmt(v)}</em></span>`).join('')
    : '<span class="it">Every gift coin is 10 points</span>';
}
function renderLikes() {
  const got = S.likes - S.likeBase;
  $('#likefill').style.width = Math.min(100, 100 * got / S.likeGoal) + '%';
  $('#liketext').textContent = `Tap likes: ${fmt(got)} / ${fmt(S.likeGoal)} unlocks a blitz round`;
}
function preload(q) {
  if (!q) return;
  [q.image, q.revealImage, ...(q.sides || []).map(s => s.img), ...(q.slots || []).map(s => s.img)]
    .filter(Boolean).forEach(f => { const i = new Image(); i.src = CFG.imgBase + encodeURIComponent(f); });
}
function fit() {
  const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  const st = $('#stage');
  st.style.transform = `scale(${s})`;
  st.style.left = ((window.innerWidth - 1080 * s) / 2) + 'px';
  st.style.top = ((window.innerHeight - 1920 * s) / 2) + 'px';
}

// ------------------------------------------------------------------ live events from the bridge
function connectBridge() {
  const open = () => {
    let es;
    try { es = new EventSource('/events'); } catch (e) { return setTimeout(open, 3000); }
    es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch (e) {} };
    es.onerror = () => { S.connected = false; S.statusText = 'Quiz bridge not running: start it with START-HOOPSHYPE-QUIZ.bat'; es.close(); setTimeout(open, 3000); };
  };
  open();
  // While the chat isn't connected, say so in the like bar instead of hiding it
  setInterval(() => { if (!S.connected) $('#liketext').textContent = S.statusText || 'Connecting to chat...'; else renderLikes(); }, 3000);
}

// ------------------------------------------------------------------ practice simulator (fake chat, gifts, likes)
function startPractice() {
  S.connected = true;
  // practice only: a few made-up past titles so the trophies show up
  if (!Object.keys(P.titles).length) Object.assign(P.titles, { stepbackthree: { n: 3, w: 1 }, mavsfan41: { n: 1, w: 0 }, knicksknation: { n: 2, w: 0 } });
  const bots = ['hoopsfan23', 'Lakeshow4L', 'bucketsgetter', 'mamba_mentality', 'jokicmagic', 'Celtics_17', 'curryrange30',
    'dunkcity', 'goatdebate', 'NBAnerd', 'courtvision', 'ballislife', 'triple_double', 'splash_bro', 'thunderup', 'mavsfan41',
    'heatculture', 'knicksknation', 'okc_boomer', 'spursway21', 'rim_protector', 'stepbackthree', 'fastbreak', 'hoopdreams'];
  const gifts = [['Rose', 1], ['Ice Cream Cone', 1], ['GG', 1], ['Finger Heart', 5], ['Doughnut', 30], ['Hand Hearts', 100], ['Hat and Mustache', 99], ['Corgi', 299]];
  const skill = { easy: 0.55, medium: 0.35, hard: 0.15 };
  const say = (u, text) => onEvent({ kind: 'chat', user: u, nick: u, text });
  setInterval(() => {
    const u = rnd(bots), q = S.q;
    if (!P.teams[u] && Math.random() < 0.3) return say(u, rnd(['LAL', 'Celtics', 'warriors', 'knicks', 'okc', 'go spurs', 'Heat']));
    if (S.phase !== 'question' || !q) { if (Math.random() < 0.3) say(u, rnd(['lets go', 'gg', 'next one', 'hi from Madrid'])); return; }
    const right = Math.random() < (skill[q.difficulty] || 0.35) * (0.4 + (now() - S.tStart) / S.dur);
    if (q.type === 'guess') say(u, right ? q.answer : rnd(['LeBron', 'Kobe Bryant', 'Tim Duncan', 'Chris Paul', 'idk']));
    else if (q.type === 'mc') say(u, isTF(q) ? (right === (q.correct === 0) ? 'true' : 'false') : (right ? 'ABCD'[q.correct] : rnd(['A', 'B', 'C', 'D'])));
    else if (q.type === 'hl') say(u, right ? 'AB'[q.correct] : rnd(['A', 'B']));
    else if (q.type === 'battle') say(u, Math.random() < 0.6 ? 'A' : 'B');
    else if (q.type === 'board') { const s = rnd(q.slots); say(u, right ? s.name.split(' ').slice(-1)[0] : rnd(['Shaq', 'Kobe', 'Iverson'])); }
    else if (q.type === 'closest') say(u, String(Math.round(q.value * (0.7 + Math.random() * 0.6))));
  }, 450);
  setInterval(() => {
    if (Math.random() < 0.35) { const [g, c] = rnd(gifts); onEvent({ kind: 'gift', user: rnd(bots), gift: g, coins: c, count: c === 1 ? 1 + Math.floor(Math.random() * 5) : 1 }); }
    onEvent({ kind: 'like', count: 20 + Math.floor(Math.random() * 60) });
    if (Math.random() < 0.08) onEvent({ kind: rnd(['follow', 'share']), user: rnd(bots) });
  }, 2500);
}

function applyLayout(name, save) {
  LAYOUT = LAYOUTS[name] ? name : 'broadcast';
  document.body.dataset.layout = LAYOUT;
  if (save) fetch('/settings', { method: 'POST', body: JSON.stringify({ layout: LAYOUT }) }).catch(() => store('hhq_layout', LAYOUT));
  // redraw what's on screen so photos switch between cut-outs and circles
  if (!S.data) return;
  if (S.phase === 'question') renderQuestion(true);
  else if (S.phase === 'reveal') renderReveal();
  else if (S.phase === 'intro') renderIntro();
  else if (S.phase === 'recap') renderRecap();
  else if (S.phase === 'voteResult' && S.lastVoteResult) renderVoteResult(...S.lastVoteResult);
}
async function loadLayout() {
  if (LAYOUT_PREVIEW) return applyLayout(LAYOUT_PREVIEW);
  let saved = null;
  try { const r = await fetch('/settings', { cache: 'no-store' }); if (r.ok) saved = (await r.json()).layout; } catch (e) {}
  applyLayout(saved || store('hhq_layout') || CFG.layout);
}

// ------------------------------------------------------------------ operator keys
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'n' && S.phase === 'question') S.tEnd = now();
  if (k === 'p') {
    S.paused = !S.paused;
    if (S.paused) S.pausedLeft = S.tEnd - now(); else S.tEnd = now() + S.pausedLeft;
    updateClock(S.pausedLeft);
  }
  if (k === 'b') { S.blitzQueued = CFG.blitzLength; addAlert('<b>BLITZ ROUND</b> coming up'); }
  if (k === 'm') muted = !muted;
  if (k === 'l') {   // next look
    const names = Object.keys(LAYOUTS);
    applyLayout(names[(names.indexOf(LAYOUT) + 1) % names.length], true);
    addAlert(`Look: <b>${LAYOUTS[LAYOUT].name}</b>. Press L for the next one`);
  }
  if (k === 'r') { S.streamScores = new Map(); renderBoards(); }   // stream-only scores; weekly board and champions are untouched
});

// ------------------------------------------------------------------ boot
async function boot() {
  fit(); window.addEventListener('resize', fit);
  try {
    const c = await fetch('config.json', { cache: 'no-store' });
    if (c.ok) { const user = await c.json(); CFG = Object.assign({}, DEFAULTS, user.quiz || {}, { handle: String(user.tiktokUsername || 'hoopshype').replace(/^@/, '') }); }
  } catch (e) {}
  S.likeGoal = CFG.likeGoal;
  await loadLayout();
  await loadState();
  if (!P.titles) P.titles = {};
  if (!P.awarded) P.awarded = { n: [], w: [] };
  // Prefer the copy the weekly GitHub job keeps fresh; fall back to the one in this folder
  for (const src of [CFG.questionsUrl, 'data/questions.json'].filter(Boolean)) {
    try { const r = await fetch(src, { cache: 'no-store' }); if (r.ok) { S.data = await r.json(); break; } } catch (e) {}
  }
  if (!S.data) { body().innerHTML = '<div class="big-center"><div class="title">No questions found</div></div>'; return; }
  // only themes with enough questions today can be voted for (a source that failed to download leaves its theme empty)
  S.themes = S.data.themes.filter(t => S.data.questions.filter(q => q.theme === t && usableToday(q)).length >= CFG.questionsPerGame * 2);
  renderLikes(); renderBoards();
  setInterval(tick, 200);
  setInterval(rotateStandings, 500);
  awardTitles(); setInterval(awardTitles, 60000);
  setInterval(reloadQuestions, 60 * 60 * 1000);   // the morning rebuild reaches a stream that runs past it
  await loadSchedule(); settlePredictions(); setInterval(settlePredictions, 10 * 60 * 1000);
  setInterval(() => { renderStandings(); if (rankShowing) renderMe(); }, 15000);   // rolling windows drop old points even when nobody scores
  if (PRACTICE) startPractice(); else connectBridge();
  startGame(params.get('theme') || 'Mixed');
}
boot();
// Save standings when the window closes, so a quick restart doesn't lose the night
window.addEventListener('beforeunload', () => { try { navigator.sendBeacon('/state' + (PRACTICE ? '?practice=1' : ''), JSON.stringify(P)); } catch (e) {} });
// Test hooks: play one specific question, or end the current one
window.HHQ = { onEvent, state: S, saved: P, startGame, pickQueue, settlePredictions, loadSchedule, renderBoards: () => { renderBoards(); renderThemebar(); }, play(q) { S.queue = [q]; S.qi = 0; nextQuestion(); }, end() { S.tEnd = now(); } };
})();
