/* HoopsHype NBA Quiz Live: game engine and screen.
   Events (chat, gifts, likes, follows, shares) arrive from the local bridge (bridge/quiz-bridge.mjs)
   over /events, or from the built-in practice simulator when the page is opened with ?practice=1.

   Operator keys (click the quiz window first): N = skip question, P = pause/resume,
   B = start a blitz round, M = sound on/off, R = reset stream scores. */
(() => {
'use strict';

// ------------------------------------------------------------------ config
const DEFAULTS = {
  imgBase: 'https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face-fill-320/',
  questionsUrl: 'https://raw.githubusercontent.com/jsierrahoopshype/hoopshype-quiz-live/HEAD/data/questions.json',
  questionsPerGame: 8,
  battleSlot: 4,                       // a chat battle is dropped in as question #5 of every game
  times: { guess: 45, mc: 20, tf: 14, hl: 15, battle: 18, board: 75, closest: 25, reveal: 8, intro: 7, recap: 10, voteResult: 6 },
  blitzTimes: { guess: 25, mc: 10, tf: 8, hl: 8, battle: 10, board: 40, closest: 14 },
  points: { easy: 50, medium: 75, hard: 100, rank: [50, 30, 20], board: 40, battle: 20, follow: 25, share: 50, perCoin: 10, closest: [150, 100, 50], exact: 300 },
  afterFirstCorrect: 8,                // seconds left once somebody names the player
  likeGoal: 1500, likeGoalGrowth: 1.4,
  // The 4 theme-vote columns. Each is tied to one gift; every coin of that gift is one vote.
  // Names must match TikTok's gift names exactly. The bridge window prints every gift name it sees.
  themeGifts: ['Rose', 'Ice Cream Cone', 'GG', 'Finger Heart'],
  powerups: { hint: 30, double: 99, blitz: 199 },   // coin thresholds for any other gift
  blitzLength: 3,
  diffMix: { easy: 0.5, medium: 0.4, hard: 0.1 },
};
let CFG = DEFAULTS;
const params = new URLSearchParams(location.search);
const PRACTICE = params.has('practice');

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
const photo = (f, cls = '') => f ? `<div class="photo ${cls}"><img src="${CFG.imgBase}${encodeURIComponent(f)}" alt="" onerror="this.parentNode.remove()"></div>` : '';
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
// Name plus team tag, e.g. "thunderup (OKC)"
const who = u => esc(displayName(u)) + (P.teams[u] ? ` <span class="team">${P.teams[u]}</span>` : '');

// ------------------------------------------------------------------ standings that carry over between streams
// Saved by the bridge to saved/hoopshype-quiz-state.json. A "night" is a US Eastern date that rolls over
// at 6am ET, so a late game night stays one night. Weeks start Monday, so the weekly board resets on Mondays.
const P = { days: {}, weeks: {}, gifters: {}, teams: {}, names: {} };
function etDate(d = new Date()) {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setHours(et.getHours() - 6);
  return et;
}
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nightKey = () => ymd(etDate());
function weekKey() { const d = etDate(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
const today = () => (P.days[nightKey()] ||= { scores: {} });
const thisWeek = () => (P.weeks[weekKey()] ||= { scores: {}, teams: {} });
function champion() {
  // top scorer of the most recent night before tonight
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
  saveSoon();
}
let saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 4000); }
async function saveNow() {
  // keep the file small: 3 weeks of nights, 8 weeks of weekly boards
  const dk = Object.keys(P.days).sort(); while (dk.length > 21) delete P.days[dk.shift()];
  const wk = Object.keys(P.weeks).sort(); while (wk.length > 8) delete P.weeks[wk.shift()];
  const body = JSON.stringify(P);
  try { const r = await fetch('/state' + (PRACTICE ? '?practice=1' : ''), { method: 'POST', body }); if (!r.ok) throw 0; }
  catch (e) { store(PRACTICE ? 'hhq_state_practice' : 'hhq_state', P); }   // no bridge (e.g. opened from GitHub): keep it in the browser
}
async function loadState() {
  let saved = null;
  try { const r = await fetch('/state' + (PRACTICE ? '?practice=1' : ''), { cache: 'no-store' }); if (r.ok) saved = await r.json(); } catch (e) {}
  if (!saved || !Object.keys(saved).length) saved = store(PRACTICE ? 'hhq_state_practice' : 'hhq_state') || {};
  Object.assign(P, { days: {}, weeks: {}, gifters: {}, teams: {}, names: {} }, saved);
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
function pickQueue(theme) {
  const all = S.data.questions;
  const pool = all.filter(q => q.type !== 'battle' && (theme === 'Mixed' || q.theme === theme));
  let fresh = pool.filter(q => !S.used.has(q.id));
  if (fresh.length < CFG.questionsPerGame * 2) {           // theme exhausted: forget its history
    pool.forEach(q => S.used.delete(q.id)); fresh = pool.slice();
  }
  const byDiff = { easy: [], medium: [], hard: [] };
  shuffle(fresh).forEach(q => (byDiff[q.difficulty] || byDiff.medium).push(q));
  const out = [], typeCount = {};
  const cap = { board: 1, closest: 2 };
  let guard = 0;
  while (out.length < CFG.questionsPerGame && guard++ < 400) {
    const r = Math.random();
    const d = r < CFG.diffMix.easy ? 'easy' : r < CFG.diffMix.easy + CFG.diffMix.medium ? 'medium' : 'hard';
    const list = byDiff[d].length ? byDiff[d] : (byDiff.medium.length ? byDiff.medium : byDiff.easy.length ? byDiff.easy : byDiff.hard);
    if (!list.length) break;
    const idx = list.findIndex(q => (typeCount[q.type] || 0) < (cap[q.type] ?? 99) && (!out.length || out[out.length - 1].type !== q.type || guard > 200));
    if (idx < 0) { list.shift(); continue; }
    const q = list.splice(idx, 1)[0];
    typeCount[q.type] = (typeCount[q.type] || 0) + 1;
    out.push(q);
  }
  const battles = shuffle(all.filter(q => q.type === 'battle' && !S.used.has(q.id)));
  if (battles.length && out.length > CFG.battleSlot) out.splice(CFG.battleSlot, 0, battles[0]);
  return out;
}
function markUsed(q) { S.used.add(q.id); store('hhq_used', [...S.used].slice(-4000)); }
function rollVoteThemes() {
  const options = shuffle(S.themes.filter(t => t !== S.theme));
  S.voteThemes = options.slice(0, 3).concat(S.theme === 'Mixed' ? [options[3]] : ['Mixed']);
  S.votes = [0, 0, 0, 0];
  renderVote();
}

// ------------------------------------------------------------------ game flow
function setPhase(p, secs) { S.phase = p; S.tStart = now(); S.dur = secs * 1000; S.tEnd = S.tStart + S.dur; S._lastTick = null; }
function startGame(theme) {
  S.game += 1;
  S.theme = theme;
  S.queue = pickQueue(theme);
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
  const tType = isTF(q) ? 'tf' : q.type;
  const secs = (blitz ? CFG.blitzTimes[tType] : null) || CFG.times[tType] || 20;
  S.qMult = (blitz ? 2 : 1) * S.mult;
  setPhase('question', secs);
  planReveals(q, secs);
  renderQuestion();
  preload(S.queue[S.qi + 1]);
}
function endQuestion() {
  const q = S.q;
  markUsed(q);
  if (q.type === 'mc' || q.type === 'hl') scoreChoice(q);
  if (q.type === 'closest') scoreClosest(q);
  if (q.type === 'battle') scoreBattle(q);
  if (S.blitzLeft > 0) S.blitzLeft -= 1;
  if (S.mult > 1) { S.mult = 1; S.multBy = null; }
  logQuestion(q);
  setPhase('reveal', CFG.times.reveal);
  sfx.reveal();
  renderReveal();
}
// For the recap card ("hardest question") and for easing difficulty when chat keeps missing
function logQuestion(q) {
  if (q.type === 'battle') return;
  const got = q.type === 'board' ? S.filled.filter(f => f && !f.hint).length : q.type === 'closest' ? S.closest.size : S.correct.length;
  const tried = q.type === 'mc' || q.type === 'hl' ? S.answered.size : q.type === 'closest' ? S.closest.size : S.chatters.size;
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
function endGame() { setPhase('recap', CFG.times.recap); renderRecap(); makeRecapCards(); saveNow(); }
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
  const startClues = q.clues.length >= 4 ? 2 : 1;
  const extra = q.clues.length - startClues;
  const T = secs * 1000;
  S.revealPlan = {
    shownLetters: new Set(),
    letterTimes: order.map((idx, i) => ({ idx, at: T * (0.2 + 0.75 * (i + 1) / (order.length + 1)) })),
    clueTimes: Array.from({ length: extra }, (_, i) => T * (0.08 + 0.6 * (i + 1) / (extra + 1))),
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
  maybeJoinTeam(u, text);
  const q = S.q;
  if (S.phase !== 'question' || !q || S.paused) return;
  S.chatters.add(u);
  if (q.type === 'guess') return answerGuess(q, u, text);
  if (q.type === 'mc') return answerChoice(q, u, choiceIndex(q, text));
  if (q.type === 'hl' || q.type === 'battle') return answerChoice(q, u, sideIndex(q, text));
  if (q.type === 'board') return answerBoard(q, u, text);
  if (q.type === 'closest') return answerClosest(q, u, text);
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
const basePoints = q => (CFG.points[q.difficulty] || 60) * (S.qMult || 1);
function answerGuess(q, u, text) {
  if (S.correct.some(c => c.u === u) || !nameMatch(text, q.accept)) return;
  const P = S.revealPlan;
  const frac = P && P.total ? P.shownLetters.size / P.total : 0;
  const rank = S.correct.length;
  registerCorrect(u, Math.round(basePoints(q) * (1 - 0.5 * frac)) + (CFG.points.rank[rank] || 0) * (S.qMult || 1));
  if (rank === 0) S.tEnd = Math.min(S.tEnd, now() + CFG.afterFirstCorrect * 1000);
}
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
function registerCorrect(u, pts, quiet) {
  addPoints(u, pts);
  S.streaks.set(u, (S.streaks.get(u) || 0) + 1);
  S.correct.push({ u, pts, at: now() });
  if (!quiet) S.stats.answers++;
  if (S.correct.length === 1) {
    const secs = (now() - S.tStart) / 1000;
    if (!S.stats.fastest || secs < S.stats.fastest.s) S.stats.fastest = { u, s: secs };
    if (!quiet) { sfx.correct(); setEvent(`<b>${who(u)}</b> got it first, +${pts}. Still time to answer`); }
  } else if (!quiet) setEvent(`<b>${who(u)}</b> got it too, +${pts}. ${S.correct.length} correct so far`);
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
  $('#gameno').innerHTML = c ? `<span class="champ">Last night's champ: <b>${esc(displayName(c.u))}</b></span>` : '';
  let tag = '';
  if (S.phase === 'question' || S.phase === 'reveal') {
    if (S.blitzLeft > 0) tag = '<span class="tag">BLITZ</span>';
    else if (S.qMult > 1) tag = '<span class="tag">DOUBLE POINTS</span>';
  }
  $('#theme-name').innerHTML = esc(S.theme || '') + tag;
  const pips = S.queue.map((q, i) => {
    const st = S.phase === 'recap' || S.phase === 'voteResult' || i < S.qi ? 'done' : (i === S.qi && S.phase !== 'intro') ? 'now' : '';
    return `<span class="pip ${st}${q.type === 'battle' ? ' battle' : ''}"></span>`;
  }).join('');
  $('#pips').innerHTML = (S.game ? `<span class="gno">GAME ${S.game}</span>` : '') + pips;
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
  setTimeout(nextAlert, 3000);
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
  'Mixed': 'A bit of everything.',
};
function renderIntro() {
  renderThemebar();
  body().innerHTML = `<div class="big-center"><div class="title">${esc(S.theme)}</div><div class="desc">${esc(THEME_DESC[S.theme] || '')}</div></div>
    <div class="rules">
      <div class="rule"><b>1</b>Type your answer in the chat. Fastest scores most</div>
      <div class="rule"><b>2</b>Type your team once (LAL, BOS, GSW...) to join the team battle</div>
      <div class="rule"><b>3</b>Send a theme's gift to pick the next game</div>
    </div>`;
  setInstruction(`${S.queue.length} questions. Starting in`, 'wait');
  setEvent(S.game > 1 ? 'Scores for this game reset. The stream leaderboard keeps counting' : 'Welcome. No sign-up, just type in the chat');
  renderBoards();
}
function instructionFor(q) {
  if (q.type === 'guess') return 'Type the player\'s name';
  if (q.type === 'mc') return isTF(q) ? 'Type TRUE or FALSE' : 'Type A, B, C or D';
  if (q.type === 'hl') return 'Type A or B';
  if (q.type === 'battle') return 'Vote: type A or B';
  if (q.type === 'board') return 'Type as many names as you can';
  if (q.type === 'closest') return 'Type a number. Closest wins';
  return 'Type your answer';
}
function promptHtml(q) {
  return `<div class="prompt${q.prompt.length > 46 ? ' long' : ''}">${esc(q.prompt)}</div>` + (q.sub ? `<div class="sub">${esc(q.sub)}</div>` : '');
}
function renderQuestion(keepEvent) {
  renderThemebar();
  const q = S.q;
  setInstruction(instructionFor(q));
  if (!keepEvent) setEvent(q.type === 'battle' ? 'No wrong answers. Everyone on the winning side scores'
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
    h += `<div class="closest-body"><div class="guesscount" id="gcount">0<small>guesses</small></div></div>`;
  }
  body().innerHTML = h;
  renderLive();
}
function vsHtml(q, reveal) {
  const t = S.battleVotes[0] + S.battleVotes[1];
  const sides = q.sides.map((s, i) => {
    let cls = '';
    if (reveal && q.type === 'hl') cls = i === q.correct ? ' right' : ' fade';
    if (reveal && q.type === 'battle' && S.battleWin >= 0) cls = i === S.battleWin ? ' right' : ' fade';
    const val = q.type === 'hl' ? `<div class="val${reveal ? '' : ' hide'}">${reveal ? esc(s.value) : '?'}</div>` : '';
    const meta = q.type === 'battle' ? `<div class="meta">${esc(s.value || '')}</div>` : '';
    return `<div class="side${cls}"><div class="k">${'AB'[i]}</div>${photo(s.img)}<div class="nm">${esc(s.name)}</div>${val}${meta}</div>`;
  }).join('');
  let split = '';
  if (q.type === 'battle') {
    const pa = t ? Math.round(100 * S.battleVotes[0] / t) : 50;
    split = `<div class="split"><div class="a" id="split-a" style="width:${pa}%">A ${t ? pa + '%' : ''}</div><div class="b" id="split-b">${t ? (100 - pa) + '%' : ''} B</div></div>`;
  }
  return `<div class="vs">${sides}</div>${split}`;
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
  h += `<div class="clues${zoom ? ' compact' : ''}">` + q.clues.map((c, i) => i < shown
    ? `<div class="clue"><span class="n">${i + 1}</span><span>${esc(c)}</span></div>`
    : `<div class="clue locked"><span class="n">${i + 1}</span><span>Unlocks soon</span></div>`).join('') + '</div>';
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
  if ((q.type === 'mc' || q.type === 'hl') && S.answered.size) {
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
    `<div class="winner"><span class="r">${i + 1}</span><span class="u">${who(c.u)}${(S.streaks.get(c.u) || 0) >= 3 ? ` (${S.streaks.get(c.u)} in a row)` : ''}</span><span class="p">+${c.pts}</span></div>`).join('') + '</div>';
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
    x.font = `800 ${wide ? 52 : 64}px ${cond}`; x.fillStyle = '#fff'; x.fillText('HOOPSHYPE', 56, mh / 2);
    const w1 = x.measureText('HOOPSHYPE').width;
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
    wrapLines(x, `${displayName(top[0][0])}${tTag} wins with ${fmt(top[0][1])} points`, leftW).forEach(l => { x.fillText(l, L, y); y += wide ? 50 : 62; });
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
function renderBoards() {
  const fill = (sel, entries) => {
    const rows = entries.slice(0, 4);
    $(sel).innerHTML = rows.length ? rows.map(([u, v], i) => `<li><span class="u">${i + 1}. ${esc(displayName(u))}</span><span class="s">${fmt(v)}</span></li>`).join('')
      : '<li class="empty">Nobody yet</li>';
  };
  fill('#lb-week', Object.entries(thisWeek().scores).sort((a, b) => b[1] - a[1]));
  fill('#lb-gift', Object.entries(P.gifters).sort((a, b) => b[1] - a[1]));
  const teams = Object.entries(thisWeek().teams).sort((a, b) => b[1] - a[1]).slice(0, 4);
  $('#lb-team').innerHTML = teams.length ? teams.map(([t, v], i) => `<li><span class="u">${i + 1}. ${esc(TEAMS[t][0])}</span><span class="s">${fmt(v)}</span></li>`).join('')
    : '<li class="empty">Type your team to join</li>';
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
  await loadState();
  // Prefer the copy the weekly GitHub job keeps fresh; fall back to the one in this folder
  for (const src of [CFG.questionsUrl, 'data/questions.json'].filter(Boolean)) {
    try { const r = await fetch(src, { cache: 'no-store' }); if (r.ok) { S.data = await r.json(); break; } } catch (e) {}
  }
  if (!S.data) { body().innerHTML = '<div class="big-center"><div class="title">No questions found</div></div>'; return; }
  S.themes = S.data.themes.slice();
  renderLikes(); renderBoards();
  setInterval(tick, 200);
  if (PRACTICE) startPractice(); else connectBridge();
  startGame(params.get('theme') || 'Mixed');
}
boot();
// Save standings when the window closes, so a quick restart doesn't lose the night
window.addEventListener('beforeunload', () => { try { navigator.sendBeacon('/state' + (PRACTICE ? '?practice=1' : ''), JSON.stringify(P)); } catch (e) {} });
// Test hooks: play one specific question, or end the current one
window.HHQ = { onEvent, state: S, saved: P, renderBoards: () => { renderBoards(); renderThemebar(); }, play(q) { S.queue = [q]; S.qi = 0; nextQuestion(); }, end() { S.tEnd = now(); } };
})();
